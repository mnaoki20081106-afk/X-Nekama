#import "RiriSetup.h"
#import "RiriCloudflare.h"
#import <UIKit/UIKit.h>
#import <Security/Security.h>

static NSDictionary *connection;
static BOOL hookAvailable;
static NSObject *Lock(void) { static NSObject *l; static dispatch_once_t once; dispatch_once(&once, ^{l=[NSObject new];}); return l; }
NSDictionary *RiriConnection(void) { @synchronized(Lock()) { return connection; } }
void RiriSetHookAvailable(BOOL available) { hookAvailable=available; }
static NSDictionary *KeyQuery(void) {
    return @{(__bridge id)kSecClass:(__bridge id)kSecClassGenericPassword,
             (__bridge id)kSecAttrService:@"local.riri.connection.v1",
             (__bridge id)kSecAttrAccount:@"bridge"};
}
static BOOL Save(NSDictionary *value) {
    NSData *data=[NSJSONSerialization dataWithJSONObject:value options:0 error:nil];
    NSDictionary *attributes=@{(__bridge id)kSecValueData:data,
        (__bridge id)kSecAttrAccessible:(__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly};
    OSStatus result=SecItemUpdate((__bridge CFDictionaryRef)KeyQuery(), (__bridge CFDictionaryRef)attributes);
    if(result==errSecItemNotFound) {
        NSMutableDictionary *q=[KeyQuery() mutableCopy]; [q addEntriesFromDictionary:attributes];
        result=SecItemAdd((__bridge CFDictionaryRef)q, NULL);
    }
    if(result==errSecSuccess) { @synchronized(Lock()) {connection=[value copy];} }
    return result==errSecSuccess;
}
@interface RiriNetwork : NSObject <NSURLSessionTaskDelegate>
@end
@implementation RiriNetwork
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler {
    completionHandler(nil); // Do not forward secrets to redirect destinations.
}
@end
NSURLSession *RiriSession(void) {
    static NSURLSession *session; static dispatch_once_t once;
    dispatch_once(&once, ^{
        NSURLSessionConfiguration *c=NSURLSessionConfiguration.ephemeralSessionConfiguration;
        c.HTTPCookieStorage=nil; c.URLCache=nil; c.timeoutIntervalForRequest=90;
        session=[NSURLSession sessionWithConfiguration:c delegate:[RiriNetwork new] delegateQueue:nil];
    });
    return session;
}
static NSString *Origin(NSString *input) {
    NSString *s=[input stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if(![s containsString:@"://"]) s=[@"https://" stringByAppendingString:s];
    NSURLComponents *c=[NSURLComponents componentsWithString:s];
    if(![c.scheme.lowercaseString isEqualToString:@"https"] || !c.host.length || c.user || c.password || c.query || c.fragment || (c.path.length && ![c.path isEqualToString:@"/"])) return nil;
    c.path=@""; return c.URL.absoluteString;
}
@interface RiriWizard : UIViewController
@property(nonatomic) NSInteger step;
@property(nonatomic) BOOL busy;
@property(nonatomic,strong) UIStackView *stack;
@property(nonatomic,strong) UITextField *host;
@property(nonatomic,strong) UITextField *secret;
@property(nonatomic,strong) UILabel *status;
@property(nonatomic,strong) UIButton *next;
@property(nonatomic,strong) NSURLSessionDataTask *task;
@end
@implementation RiriWizard
- (UILabel *)label:(NSString *)text {
    UILabel *l=[UILabel new]; l.text=text; l.numberOfLines=0;
    l.font=[UIFont preferredFontForTextStyle:UIFontTextStyleBody]; l.adjustsFontForContentSizeCategory=YES;
    [self.stack addArrangedSubview:l]; return l;
}
- (UIButton *)button:(NSString *)title action:(SEL)action {
    UIButton *b=[UIButton buttonWithType:UIButtonTypeSystem]; [b setTitle:title forState:UIControlStateNormal];
    b.titleLabel.font=[UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];
    [b addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];
    [b.heightAnchor constraintGreaterThanOrEqualToConstant:44].active=YES;
    [self.stack addArrangedSubview:b]; return b;
}
- (void)viewDidLoad {
    [super viewDidLoad]; self.title=@"Riri 初回設定"; self.modalInPresentation=YES;
    self.view.backgroundColor=UIColor.systemBackgroundColor;
    self.navigationItem.rightBarButtonItem=[[UIBarButtonItem alloc] initWithTitle:@"あとで" style:UIBarButtonItemStylePlain target:self action:@selector(close)];
    UIScrollView *scroll=[UIScrollView new]; scroll.translatesAutoresizingMaskIntoConstraints=NO;
    [self.view addSubview:scroll]; self.stack=[UIStackView new]; self.stack.axis=UILayoutConstraintAxisVertical;
    self.stack.spacing=18; self.stack.translatesAutoresizingMaskIntoConstraints=NO; [scroll addSubview:self.stack];
    [NSLayoutConstraint activateConstraints:@[
        [scroll.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],
        [scroll.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor],
        [scroll.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor], [scroll.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],
        [self.stack.topAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.topAnchor constant:24],
        [self.stack.bottomAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.bottomAnchor constant:-24],
        [self.stack.leadingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.leadingAnchor constant:24],
        [self.stack.trailingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.trailingAnchor constant:-24],
        [self.stack.widthAnchor constraintEqualToAnchor:scroll.frameLayoutGuide.widthAnchor constant:-48]]];
    [self render];
}
- (void)render {
    for(UIView *v in self.stack.arrangedSubviews) { [self.stack removeArrangedSubview:v]; [v removeFromSuperview]; }
    [self label:self.step==0 ? @"初回セットアップ" : @"接続確認"];
    if(self.step==0) {
        [self label:@"Ririを接続しましょう"];
        [self label:@"受信したDMをあなたのCloudflareアカウントへ送り、AIが返信を作成します。対応するXでは自動返信します。接続確認後に開始します。"];
        [self button:@"Cloudflareで無料セットアップ" action:@selector(cloudflare)];
        self.status=[self label:@"ログイン・許可後に専用の処理と会話保存先を自動作成します。無料プランでは枠を使い切ると返信を停止します。有料プランのアカウントでは料金が発生する場合があります。Cloudflareの利用規約への同意やメール確認が必要な場合があります。"] ;
        [self button:@"既存の接続先を設定" action:@selector(connectPage)];
    } else {
        [self label:@"接続先の設定"];
        [self button:@"Cloudflareで自動設定" action:@selector(cloudflare)];
        self.host=[UITextField new]; self.host.placeholder=@"https://dm.example.com"; self.host.keyboardType=UIKeyboardTypeURL;
        self.secret=[UITextField new]; self.secret.placeholder=@"接続キー"; self.secret.secureTextEntry=YES;
        for(UITextField *f in @[self.host,self.secret]) {
            f.borderStyle=UITextBorderStyleRoundedRect; f.autocapitalizationType=UITextAutocapitalizationTypeNone;
            f.autocorrectionType=UITextAutocorrectionTypeNo; [self.stack addArrangedSubview:f];
            [f.heightAnchor constraintGreaterThanOrEqualToConstant:44].active=YES;
        }
        self.host.accessibilityLabel=@"サーバーURL"; self.secret.accessibilityLabel=@"接続キー";
        NSDictionary *saved=RiriConnection(); self.host.text=saved[@"origin"]; self.secret.text=saved[@"secret"];
        [self button:@"接続コードを貼り付け" action:@selector(pastePair)];
        self.next=[self button:@"接続を確認して保存" action:@selector(check)];
        [self label:@"保存先とAIが使えることを確認し、接続キーを安全に保存します。"];
        self.status=[self label:@""];
    }
}
- (void)cloudflare {
    if(self.busy) return;
    UIAlertController *a=[UIAlertController alertControllerWithTitle:@"自分のXの数字ID" message:@"自分の送信に返信しないために使います。@ユーザー名ではなく数字IDを入力してください。" preferredStyle:UIAlertControllerStyleAlert];
    [a addTextFieldWithConfigurationHandler:^(UITextField *f){f.keyboardType=UIKeyboardTypeNumberPad;f.placeholder=@"数字ID";f.text=RiriConnection()[@"own_user_id"];}];
    [a addAction:[UIAlertAction actionWithTitle:@"キャンセル" style:UIAlertActionStyleCancel handler:nil]];
    [a addAction:[UIAlertAction actionWithTitle:@"ログインして自動設定" style:UIAlertActionStyleDefault handler:^(UIAlertAction *action){
        NSString *uid=a.textFields.firstObject.text;
        if(!uid.length||uid.length>30||[uid rangeOfCharacterFromSet:[NSCharacterSet characterSetWithCharactersInString:@"0123456789"].invertedSet].location!=NSNotFound){self.status.text=@"数字IDを入力してください。";return;}
        self.busy=YES;self.navigationItem.rightBarButtonItem.enabled=NO;self.status.text=@"Cloudflareにログイン後、接続先を作成します…";
        RiriCloudflareBegin(self,uid,^(NSDictionary *settings,NSString *error){
            self.busy=NO;self.navigationItem.rightBarButtonItem.enabled=YES;
            if(!settings){self.status.text=error;return;}
            self.step=2;[self render];self.host.text=settings[@"origin"];self.secret.text=settings[@"secret"];
            [self check];
        });
    }]];[self presentViewController:a animated:YES completion:nil];
}
- (void)connectPage {if(self.busy) return;self.step=2; [self render];}
- (void)pastePair {
    if(self.busy || !self.host.enabled) return;
    NSString *s=[UIPasteboard.generalPasteboard.string stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet];
    if(![s hasPrefix:@"RIRI1:"]) {self.status.text=@"RIRI1:で始まる接続コードをコピーしてください。"; return;}
    NSData *data=[[NSData alloc] initWithBase64EncodedString:[s substringFromIndex:6] options:0];
    id obj=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
    if(![obj isKindOfClass:NSDictionary.class] || ![obj[@"origin"] isKindOfClass:NSString.class] || ![obj[@"secret"] isKindOfClass:NSString.class]) {self.status.text=@"接続コードの形式が正しくありません。"; return;}
    NSString *origin=Origin(obj[@"origin"]);
    if(!origin) {self.status.text=@"有効なHTTPS接続先が必要です。"; return;}
    self.host.text=origin; self.secret.text=obj[@"secret"];
    self.status.text=@"接続先を確認してから、確認ボタンを押してください。";
}
- (void)check {
    if(self.busy) return;
    NSString *origin=Origin(self.host.text), *secret=self.secret.text;
    if(!origin || !secret.length || [secret hasPrefix:@"CHANGE_ME"]) {self.status.text=@"HTTPSのURLと接続キーを入力してください。"; return;}
    self.busy=YES; self.next.enabled=NO; self.status.text=@"接続を確認しています…"; [self.view endEditing:YES];
    NSMutableURLRequest *req=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[origin stringByAppendingString:@"/setup-check"]]];
    [req setValue:secret forHTTPHeaderField:@"X-Bot-Secret"];
    __weak RiriWizard *weakSelf=self;
    self.task=[RiriSession() dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
        NSInteger code=[response isKindOfClass:NSHTTPURLResponse.class] ? ((NSHTTPURLResponse *)response).statusCode : 0;
        id json=data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:nil] : nil;
        BOOL ok=!error && code==200 && [json isKindOfClass:NSDictionary.class] && [json[@"service"] isEqual:@"riri-bridge"] && [json[@"model_ready"] isEqual:@YES] && [json[@"own_user_id"] isKindOfClass:NSString.class];
        BOOL saved=ok && Save(@{@"origin":origin,@"secret":secret,@"own_user_id":json[@"own_user_id"]});
        dispatch_async(dispatch_get_main_queue(), ^{
            RiriWizard *s=weakSelf; if(!s) return;
            s.busy=NO; s.next.enabled=YES;
            if(saved) {
                s.status.text=[NSString stringWithFormat:@"接続設定を保存しました。\nXの数字ID: %@\n\n%@\n\n接続確認は完了しました。実際のDM受信・返信は別途確認してください。",json[@"own_user_id"],hookAvailable ? @"受信フックを登録しました。" : @"このXでは受信フックを登録できませんでした。対象バージョンの確認が必要です。"];
                [s.next setTitle:@"完了" forState:UIControlStateNormal];
                [s.next removeTarget:s action:@selector(check) forControlEvents:UIControlEventTouchUpInside];
                [s.next addTarget:s action:@selector(close) forControlEvents:UIControlEventTouchUpInside];
                s.host.text=origin; s.secret.text=secret; s.host.enabled=NO; s.secret.enabled=NO;
            } else if(ok) s.status.text=@"設定を保存できませんでした。アプリの署名・Keychain権限を確認してください。";
            else if(code==403) s.status.text=@"接続キーが一致しません。コピーし直してください。";
            else if(code==503) s.status.text=@"AIを利用できません。無料枠・Cloudflareの利用開始・接続先の稼働状態を確認してください。";
            else if(code==404) s.status.text=@"サーバーをチュートリアル対応版へ更新してください。";
            else s.status.text=@"接続できませんでした。URL・証明書・サーバーの稼働状態を確認してください。";
        });
    }]; [self.task resume];
}
- (void)close { if(self.busy) return; [self dismissViewControllerAnimated:YES completion:nil]; }
@end

@interface RiriSetupController : NSObject
@property(nonatomic,strong) UIButton *entry;
@property(nonatomic) BOOL offered;
@end
@implementation RiriSetupController
- (UIWindow *)window {
    for(UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if(scene.activationState==UISceneActivationStateForegroundActive && [scene isKindOfClass:UIWindowScene.class])
            for(UIWindow *w in ((UIWindowScene *)scene).windows) if(w.isKeyWindow) return w;
    }
    for(UIWindow *w in UIApplication.sharedApplication.windows) if(w.isKeyWindow) return w;
    return nil;
}
- (void)present {
    UIViewController *vc=[self window].rootViewController;
    while(vc.presentedViewController) vc=vc.presentedViewController;
    if(!vc || [vc isKindOfClass:RiriWizard.class] || ([vc isKindOfClass:UINavigationController.class] && [((UINavigationController *)vc).topViewController isKindOfClass:RiriWizard.class])) return;
    RiriWizard *wizard=[RiriWizard new]; wizard.step=RiriConnection() ? 2 : 0;
    UINavigationController *nav=[[UINavigationController alloc] initWithRootViewController:wizard]; nav.modalInPresentation=YES;
    [vc presentViewController:nav animated:YES completion:nil]; self.offered=YES;
}
- (void)active {
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), dispatch_get_main_queue(), ^{
        UIWindow *w=[self window]; if(!w) return;
        if(self.entry.superview!=w) {
            [self.entry removeFromSuperview]; self.entry=[UIButton buttonWithType:UIButtonTypeSystem];
            [self.entry setTitle:@"Riri設定" forState:UIControlStateNormal]; self.entry.backgroundColor=UIColor.secondarySystemBackgroundColor;
            self.entry.layer.cornerRadius=12; self.entry.translatesAutoresizingMaskIntoConstraints=NO;
            [self.entry addTarget:self action:@selector(present) forControlEvents:UIControlEventTouchUpInside]; [w addSubview:self.entry];
            [NSLayoutConstraint activateConstraints:@[[self.entry.trailingAnchor constraintEqualToAnchor:w.safeAreaLayoutGuide.trailingAnchor constant:-12], [self.entry.bottomAnchor constraintEqualToAnchor:w.safeAreaLayoutGuide.bottomAnchor constant:-64], [self.entry.widthAnchor constraintEqualToConstant:90], [self.entry.heightAnchor constraintEqualToConstant:44]]];
        }
        if(!self.offered && !RiriConnection()) [self present];
    });
}
@end
void RiriStartSetup(void) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_USER_INITIATED,0), ^{
        NSMutableDictionary *q=[KeyQuery() mutableCopy]; q[(__bridge id)kSecReturnData]=@YES;
        CFTypeRef result=NULL;
        if(SecItemCopyMatching((__bridge CFDictionaryRef)q,&result)==errSecSuccess) {
            NSData *data=CFBridgingRelease(result); id value=[NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            if([value isKindOfClass:NSDictionary.class] && [value[@"origin"] isKindOfClass:NSString.class] && Origin(value[@"origin"]) && [value[@"secret"] isKindOfClass:NSString.class])
                @synchronized(Lock()) {connection=[value copy];}
        }
        dispatch_async(dispatch_get_main_queue(), ^{
            static RiriSetupController *manager; manager=[RiriSetupController new];
            for(NSString *name in @[UIApplicationDidBecomeActiveNotification, UISceneDidActivateNotification])
                [NSNotificationCenter.defaultCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *n){[manager active];}];
            [manager active];
        });
    });
}
