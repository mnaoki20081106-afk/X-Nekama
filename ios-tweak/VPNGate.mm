#import "VPNGate.h"
#import "VPNPolicy.h"
#import "VPNExitPolicy.h"
#import <objc/runtime.h>
#import <Network/Network.h>
#import <ifaddrs.h>
#import <net/if.h>
#include <mutex>

static std::mutex NXVPNMutex;
static NXVPNPolicy NXVPNState;
static const void *NXVPNLabelKey=&NXVPNLabelKey;
static const void *NXVPNSwitchLabelKey=&NXVPNSwitchLabelKey;
static NSDictionary *NXVPNConfig(void) {
    return [NSUserDefaults.standardUserDefaults dictionaryForKey:@"x-nekama.vpn-exit"] ?: @{@"mode":@"warp"};
}
static BOOL NXVPNShared(void) { return [NXVPNConfig()[@"mode"] isEqual:@"shared"]; }
static void NXVPNSetConfig(NSDictionary *config) {
    [NSUserDefaults.standardUserDefaults setObject:config forKey:@"x-nekama.vpn-exit"];
    std::lock_guard<std::mutex> lock(NXVPNMutex); NXVPNState.invalidate(UIApplication.sharedApplication.applicationState==UIApplicationStateActive);
}
void NXVPNConfigure(UIViewController *presenter) {
    UIAlertController *alert=[UIAlertController alertControllerWithTitle:@"共通VPN出口の設定" message:@"iPhone・投稿中継・Cloudflareに同じ固定IPv4と国コードを設定します。WireGuardの接続設定は別途iphone.confを取り込んでください。接続が確認できるまでXは表示しません。" preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *f){f.placeholder=@"固定の出口IPv4";f.text=NXVPNConfig()[@"expected_ip"];f.keyboardType=UIKeyboardTypeDecimalPad;}];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *f){f.placeholder=@"国コード（JP）";f.text=NXVPNConfig()[@"country"]?:@"JP";f.autocapitalizationType=UITextAutocapitalizationTypeAllCharacters;f.autocorrectionType=UITextAutocorrectionTypeNo;}];
    [alert addAction:[UIAlertAction actionWithTitle:@"共通出口を保存" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *a){
        NSString *ip=[alert.textFields[0].text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]?:@"";
        NSString *country=[[alert.textFields[1].text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet] uppercaseString]?:@"";
        if (!NXValidExitConfig(ip.UTF8String,country.UTF8String)) {
            UIAlertController *error=[UIAlertController alertControllerWithTitle:@"設定を確認してください" message:@"固定IPv4と2文字の国コードを入力してください。設定は変更していません。" preferredStyle:UIAlertControllerStyleAlert];
            [error addAction:[UIAlertAction actionWithTitle:@"閉じる" style:UIAlertActionStyleCancel handler:nil]];
            [presenter presentViewController:error animated:YES completion:nil];return;
        }
        NXVPNSetConfig(@{@"mode":@"shared",@"expected_ip":ip,@"country":country});
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"通常のWARPモードに戻す" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *a){NXVPNSetConfig(@{@"mode":@"warp"});}]];
    [alert addAction:[UIAlertAction actionWithTitle:@"キャンセル" style:UIAlertActionStyleCancel handler:nil]];
    [presenter presentViewController:alert animated:YES completion:nil];
}
void NXVPNOpenProvider(UIViewController *presenter) {
    if (!NXVPNShared()) { [UIApplication.sharedApplication openURL:[NSURL URLWithString:@"com.cloudflare.warp://"] options:@{} completionHandler:nil]; return; }
    UIAlertController *alert=[UIAlertController alertControllerWithTitle:@"WireGuardに接続" message:@"WireGuardアプリにiphone.confを取り込み、VPN構成の追加を許可して接続をONにしてください。WARPやSideStore用VPNでは共通出口を確認できません。接続したらXへ戻ってください。" preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"閉じる" style:UIAlertActionStyleCancel handler:nil]];
    [presenter presentViewController:alert animated:YES completion:nil];
}
static BOOL NXVPNIsTunnel(void) {
    struct ifaddrs *list = NULL; BOOL found = NO;
    if (getifaddrs(&list)) return NO;
    for (struct ifaddrs *a=list; a; a=a->ifa_next)
        if (a->ifa_name && a->ifa_addr && (a->ifa_flags & IFF_UP) && !strncmp(a->ifa_name,"utun",4)) { found=YES; break; }
    freeifaddrs(list); return found;
}
BOOL NXVPNReady(void) {
    std::lock_guard<std::mutex> lock(NXVPNMutex);
    return NXVPNState.ready(NSProcessInfo.processInfo.systemUptime,NXVPNIsTunnel());
}
static const void *NXVPNCoverKey=&NXVPNCoverKey;
static NSMutableSet *NXVPNHooked;
static NSHashTable<NSURLSessionTask *> *NXVPNPending;
static void NXVPNResumePending(void) {
    NSArray<NSURLSessionTask *> *tasks;
    @synchronized(NXVPNPending) {
        tasks=NXVPNPending.allObjects;
        [NXVPNPending removeAllObjects];
    }
    for (NSURLSessionTask *task in tasks) {
        if (task.state==NSURLSessionTaskStateCanceling || task.state==NSURLSessionTaskStateCompleted) continue;
        [task resume]; // The guard re-checks WARP and calls the original IMP only when ready.
    }
}
static BOOL NXVPNProbeTask(NSURLSessionTask *task) {
    NSURL *url=task.originalRequest.URL;
    return [task.taskDescription isEqualToString:@"X-Nekama private VPN probe"] &&
        [url.absoluteString isEqualToString:@"https://www.cloudflare.com/cdn-cgi/trace"];
}
void NXVPNGuardTask(NSURLSessionTask *task) {
    // The concrete implementation may override NSURLSessionTask.resume.
    @synchronized(NXVPNHooked) {
        for (Class cls=object_getClass(task); cls; cls=class_getSuperclass(cls)) {
            if (![cls isSubclassOfClass:NSURLSessionTask.class]) break;
            NSString *key=NSStringFromClass(cls); if ([NXVPNHooked containsObject:key]) continue;
            unsigned int count=0; Method *methods=class_copyMethodList(cls,&count);
            for (unsigned int i=0;i<count;i++) if (method_getName(methods[i])==@selector(resume)) {
                Method method=methods[i]; IMP original=method_getImplementation(method);
                IMP guarded=imp_implementationWithBlock(^(NSURLSessionTask *value){
                    if (!NXVPNProbeTask(value) && !NXVPNReady()) {
                        @synchronized(NXVPNPending) { [NXVPNPending addObject:value]; }
                        return;
                    }
                    @synchronized(NXVPNPending) { [NXVPNPending removeObject:value]; }
                    ((void(*)(id,SEL))original)(value,@selector(resume));
                });
                method_setImplementation(method,guarded); break;
            }
            free(methods); [NXVPNHooked addObject:key];
        }
    }
}

@interface NXVPNGate : NSObject
@property(nonatomic,strong) NSMapTable<UIWindowScene *,UIWindow *> *covers;
@property(nonatomic,strong) NSTimer *timer;
@property(nonatomic,strong) NSDate *lastProbe;
@property(nonatomic) BOOL busy;
@property(nonatomic,strong) nw_path_monitor_t pathMonitor;
+ (instancetype)shared;
- (void)refresh;
@end
@implementation NXVPNGate
+ (instancetype)shared { static NXVPNGate *gate; static dispatch_once_t once; dispatch_once(&once,^{ gate=[self new]; }); return gate; }
- (instancetype)init {
    if ((self=[super init])) _covers=[NSMapTable weakToStrongObjectsMapTable];
    return self;
}
- (void)start {
    NSNotificationCenter *center=NSNotificationCenter.defaultCenter;
    [center addObserver:self selector:@selector(active) name:UIApplicationDidBecomeActiveNotification object:nil];
    [center addObserver:self selector:@selector(inactive) name:UIApplicationWillResignActiveNotification object:nil];
    [center addObserver:self selector:@selector(refresh) name:UISceneWillConnectNotification object:nil];
    self.timer=[NSTimer timerWithTimeInterval:0.25 target:self selector:@selector(refresh) userInfo:nil repeats:YES];
    [NSRunLoop.mainRunLoop addTimer:self.timer forMode:NSRunLoopCommonModes];
    self.pathMonitor=nw_path_monitor_create();
    nw_path_monitor_set_queue(self.pathMonitor,dispatch_get_main_queue());
    nw_path_monitor_set_update_handler(self.pathMonitor,^(__unused nw_path_t path){
        // Every path transition discards the previous proof, including a pending result.
        { std::lock_guard<std::mutex> lock(NXVPNMutex); NXVPNState.invalidate(UIApplication.sharedApplication.applicationState==UIApplicationStateActive); }
        self.lastProbe=nil; [self refresh];
    });
    nw_path_monitor_start(self.pathMonitor);
    if (UIApplication.sharedApplication.applicationState==UIApplicationStateActive) [self active];
    else [self refresh];
}
- (void)active {
    { std::lock_guard<std::mutex> lock(NXVPNMutex); NXVPNState.invalidate(true); }
    self.lastProbe=nil; [self refresh];
}
- (void)inactive {
    { std::lock_guard<std::mutex> lock(NXVPNMutex); NXVPNState.invalidate(false); }
    [self showCovers:YES]; // Also cover the app-switcher snapshot.
}
- (void)connect:(UISwitch *)sender {
    [sender setOn:NO animated:YES]; // The UI never claims connection before proof.
    NXVPNOpenProvider(sender.window.rootViewController);
}
- (void)configure:(UIButton *)sender { NXVPNConfigure(sender.window.rootViewController); }
- (void)warp {
    [UIApplication.sharedApplication openURL:[NSURL URLWithString:@"com.cloudflare.warp://"] options:@{} completionHandler:nil];
}
- (UIWindow *)cover:(UIWindowScene *)scene {
    UIWindow *window=[self.covers objectForKey:scene]; if (window) return window;
    window=[[UIWindow alloc] initWithWindowScene:scene];
    objc_setAssociatedObject(window,NXVPNCoverKey,@YES,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    window.windowLevel=UIWindowLevelAlert+10000;
    UIViewController *controller=[UIViewController new]; window.rootViewController=controller;
    controller.view.backgroundColor=UIColor.blackColor;
    UILabel *label=[UILabel new]; label.textColor=UIColor.whiteColor; label.numberOfLines=0; label.textAlignment=NSTextAlignmentCenter;
    label.text=@"VPN未接続・確認待ち\n\nWARP接続を確認するまでXを表示しません。\n下のスイッチからWARPを開き、接続をONにしてXへ戻ってください。\n\n1.1.1.1のみ・SideStore VPNでは解除されません。";
    objc_setAssociatedObject(window,NXVPNLabelKey,label,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    UILabel *switchLabel=[UILabel new]; switchLabel.text=@"VPNを接続（WARPを開く）"; switchLabel.textColor=UIColor.whiteColor;
    objc_setAssociatedObject(window,NXVPNSwitchLabelKey,switchLabel,OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    UISwitch *connect=[UISwitch new]; connect.on=NO;
    [connect addTarget:self action:@selector(connect:) forControlEvents:UIControlEventValueChanged];
    UIStackView *row=[[UIStackView alloc] initWithArrangedSubviews:@[switchLabel,connect]]; row.axis=UILayoutConstraintAxisHorizontal; row.spacing=12;
    UIButton *configure=[UIButton buttonWithType:UIButtonTypeSystem];[configure setTitle:@"共通VPN出口を設定" forState:UIControlStateNormal];[configure addTarget:self action:@selector(configure:) forControlEvents:UIControlEventTouchUpInside];
    UIStackView *stack=[[UIStackView alloc] initWithArrangedSubviews:@[label,row,configure]]; stack.axis=UILayoutConstraintAxisVertical; stack.spacing=24; stack.translatesAutoresizingMaskIntoConstraints=NO;
    [controller.view addSubview:stack];
    [NSLayoutConstraint activateConstraints:@[[stack.leadingAnchor constraintEqualToAnchor:controller.view.safeAreaLayoutGuide.leadingAnchor constant:24],[stack.trailingAnchor constraintEqualToAnchor:controller.view.safeAreaLayoutGuide.trailingAnchor constant:-24],[stack.centerYAnchor constraintEqualToAnchor:controller.view.centerYAnchor]]];
    [self.covers setObject:window forKey:scene]; return window;
}
- (void)showCovers:(BOOL)locked {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes)
        if ([scene isKindOfClass:UIWindowScene.class]) [self cover:(UIWindowScene *)scene].hidden=!locked;
}
- (void)refresh {
    for(UIWindow *window in self.covers.objectEnumerator){
        UILabel *label=objc_getAssociatedObject(window,NXVPNLabelKey);
        UILabel *switchLabel=objc_getAssociatedObject(window,NXVPNSwitchLabelKey);
        switchLabel.text=NXVPNShared()?@"WireGuardの接続手順":@"VPNを接続（WARPを開く）";
        if(NXVPNShared())label.text=[NSString stringWithFormat:@"共通VPN出口の確認待ち\n\nWireGuardを接続してXへ戻ってください。\n設定した出口IP・国と一致するまでXを表示しません。\n\n出口: %@ / %@",NXVPNConfig()[@"expected_ip"]?:@"未設定",NXVPNConfig()[@"country"]?:@"未設定"];
        else label.text=@"VPN未接続・確認待ち\n\nWARPを接続してXへ戻ってください。\n1.1.1.1のみ・SideStore VPNでは解除されません。";
    }
    BOOL ready=NXVPNReady(); [self showCovers:!ready]; if (ready) NXVPNResumePending();
    if (UIApplication.sharedApplication.applicationState!=UIApplicationStateActive) return;
    if (self.busy || (self.lastProbe && -self.lastProbe.timeIntervalSinceNow<2)) return;
    self.lastProbe=NSDate.date; self.busy=YES;
    unsigned long epoch; { std::lock_guard<std::mutex> lock(NXVPNMutex); epoch=NXVPNState.epoch; }
    NSDictionary *exitConfig=NXVPNConfig();
    NSURLSessionConfiguration *configuration=NSURLSessionConfiguration.ephemeralSessionConfiguration;
    configuration.URLCache=nil; configuration.HTTPCookieStorage=nil; configuration.URLCredentialStorage=nil;
    configuration.requestCachePolicy=NSURLRequestReloadIgnoringLocalCacheData;
    NSURLSession *session=[NSURLSession sessionWithConfiguration:configuration];
    NSURLRequest *request=[NSURLRequest requestWithURL:[NSURL URLWithString:@"https://www.cloudflare.com/cdn-cgi/trace"] cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:3];
    NSURLSessionDataTask *task=[session dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        NSString *trace=data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
        BOOL shared=[exitConfig[@"mode"] isEqual:@"shared"];
        BOOL knownMode=shared||[exitConfig[@"mode"] isEqual:@"warp"];
        NSString *expectedIP=[exitConfig[@"expected_ip"] isKindOfClass:NSString.class]?exitConfig[@"expected_ip"]:@"";
        NSString *country=[exitConfig[@"country"] isKindOfClass:NSString.class]?exitConfig[@"country"]:@"";
        BOOL proof=knownMode&&trace&&NXExitProof(trace.UTF8String,shared,expectedIP.UTF8String,country.UTF8String);
        BOOL valid=!error && [response isKindOfClass:NSHTTPURLResponse.class] && ((NSHTTPURLResponse *)response).statusCode==200 && [response.URL.absoluteString isEqualToString:request.URL.absoluteString] && proof && NXVPNIsTunnel();
        dispatch_async(dispatch_get_main_queue(),^{
            self.busy=NO;
            { std::lock_guard<std::mutex> lock(NXVPNMutex); NXVPNState.result(epoch,valid,NSProcessInfo.processInfo.systemUptime); }
            [self refresh];
        }); [session finishTasksAndInvalidate];
    }];
    task.taskDescription=@"X-Nekama private VPN probe"; NXVPNGuardTask(task); [task resume];
}
@end
void NXVPNInstall(void) {
    NXVPNHooked=[NSMutableSet set];
    NXVPNPending=[NSHashTable weakObjectsHashTable];
    NXVPNGuardTask([NSURLSession.sharedSession dataTaskWithURL:[NSURL URLWithString:@"https://www.cloudflare.com/cdn-cgi/trace"]]);
    // Cover new windows before they become visible, including cold launch.
    Method method=class_getInstanceMethod(UIWindow.class,@selector(setHidden:)); IMP original=method_getImplementation(method);
    IMP visibility=imp_implementationWithBlock(^(UIWindow *window,BOOL hidden){
        if (!hidden && !objc_getAssociatedObject(window,NXVPNCoverKey) && !NXVPNReady() && window.windowScene)
            [[NXVPNGate shared] cover:window.windowScene].hidden=NO;
        ((void(*)(id,SEL,BOOL))original)(window,@selector(setHidden:),hidden);
    });
    if (!class_addMethod(UIWindow.class,@selector(setHidden:),visibility,method_getTypeEncoding(method))) method_setImplementation(method,visibility);
    dispatch_async(dispatch_get_main_queue(),^{ [[NXVPNGate shared] start]; });
}
