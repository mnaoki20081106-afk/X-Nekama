#import "ServerManager.h"
#import "VPNGate.h"
#import <WebKit/WebKit.h>

static NSString *const NXServerURLKey=@"x-nekama.server-url";
static UIColor *NXServerBlue(void){return [UIColor colorWithRed:0.114 green:0.608 blue:0.941 alpha:1];}
@interface NXServerController:UIViewController<WKNavigationDelegate,NSURLSessionTaskDelegate>
@property(nonatomic,strong) WKWebView *web;
@property(nonatomic,strong) NSURL *server;
@property(nonatomic,strong) UILabel *status;
@property(nonatomic) BOOL configureOnAppear;
@property(nonatomic) NSUInteger connectionEpoch;
@property(nonatomic,strong) NSURLSession *probeSession;
@end
@implementation NXServerController
- (void)viewDidLoad {
 [super viewDidLoad];self.title=@"投稿予約";self.view.backgroundColor=UIColor.blackColor;
 self.navigationItem.leftBarButtonItem=[[UIBarButtonItem alloc]initWithImage:[UIImage systemImageNamed:@"xmark"] style:UIBarButtonItemStylePlain target:self action:@selector(close)];
 self.navigationItem.rightBarButtonItem=[[UIBarButtonItem alloc]initWithTitle:@"接続先" style:UIBarButtonItemStylePlain target:self action:@selector(configure)];
 self.toolbarItems=@[[[UIBarButtonItem alloc]initWithTitle:@"再読み込み" style:UIBarButtonItemStylePlain target:self action:@selector(load)],[[UIBarButtonItem alloc]initWithBarButtonSystemItem:UIBarButtonSystemItemFlexibleSpace target:nil action:nil],[[UIBarButtonItem alloc]initWithTitle:@"取得済み投稿を同期" style:UIBarButtonItemStylePlain target:self action:@selector(sync)]];
 [self.navigationController setToolbarHidden:NO];
 WKWebViewConfiguration *configuration=[WKWebViewConfiguration new];configuration.websiteDataStore=WKWebsiteDataStore.defaultDataStore;
 self.web=[[WKWebView alloc]initWithFrame:CGRectZero configuration:configuration];self.web.navigationDelegate=self;self.web.translatesAutoresizingMaskIntoConstraints=NO;self.web.opaque=NO;self.web.backgroundColor=UIColor.blackColor;[self.view addSubview:self.web];
 self.status=[UILabel new];self.status.numberOfLines=0;self.status.textColor=UIColor.whiteColor;self.status.font=[UIFont systemFontOfSize:15];self.status.textAlignment=NSTextAlignmentCenter;self.status.translatesAutoresizingMaskIntoConstraints=NO;self.status.text=@"サーバーの接続先を設定してください。\n予約はサーバーへ保存され、アプリを閉じても実行されます。";[self.view addSubview:self.status];
 [NSLayoutConstraint activateConstraints:@[[self.web.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],[self.web.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor],[self.web.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],[self.web.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],[self.status.centerYAnchor constraintEqualToAnchor:self.view.centerYAnchor],[self.status.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor constant:24],[self.status.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor constant:-24]]];
 [self load];
}
- (void)cancelVerification{self.connectionEpoch++;[self.probeSession invalidateAndCancel];self.probeSession=nil;}
- (void)close{[self cancelVerification];[self.navigationController dismissViewControllerAnimated:YES completion:nil];}
- (void)viewDidAppear:(BOOL)animated{[super viewDidAppear:animated];if(self.configureOnAppear){self.configureOnAppear=NO;[self configure];}}
- (void)configure{
 UIAlertController *a=[UIAlertController alertControllerWithTitle:@"自分のCloudflareサーバー" message:@"Cloudflareの公式画面で自分のアカウントへ配置し、作成したWorkerのURLを連携します。Cloudflareへのログインはブラウザで行います。VPN中継の設定も必要です。" preferredStyle:UIAlertControllerStyleActionSheet];
 [a addAction:[UIAlertAction actionWithTitle:@"Cloudflareでサーバーを作成" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action){
  NSURL *url=[NSURL URLWithString:@"https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fmnaoki20081106-afk%2FX-Nekama%2Ftree%2Fcodex%2Fserver-calendar-vpn-20261003"];
  [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
 }]];
 [a addAction:[UIAlertAction actionWithTitle:@"作成済みサーバーに接続" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action){[self enterURL];}]];
 [a addAction:[UIAlertAction actionWithTitle:@"接続を解除" style:UIAlertActionStyleDestructive handler:^(__unused UIAlertAction *action){
  [self cancelVerification];[self.web stopLoading];self.web.hidden=YES;self.server=nil;[NSUserDefaults.standardUserDefaults removeObjectForKey:NXServerURLKey];[NSUserDefaults.standardUserDefaults removeObjectForKey:@"x-nekama.core-url"];self.status.hidden=NO;self.status.text=@"接続を解除しました。サーバー上のデータと予約は削除されません。";
 }]];
 [a addAction:[UIAlertAction actionWithTitle:@"閉じる" style:UIAlertActionStyleCancel handler:nil]];
 if(a.popoverPresentationController){a.popoverPresentationController.barButtonItem=self.navigationItem.rightBarButtonItem;}
 [self presentViewController:a animated:YES completion:nil];
}
- (void)enterURL{
 UIAlertController *a=[UIAlertController alertControllerWithTitle:@"サーバーを連携" message:@"自分のCloudflareに作成したWorkerのHTTPS URLを入力してください。接続を確認してから保存します。" preferredStyle:UIAlertControllerStyleAlert];
 [a addTextFieldWithConfigurationHandler:^(UITextField *field){field.text=[NSUserDefaults.standardUserDefaults stringForKey:NXServerURLKey];field.placeholder=@"https://x-nekama.your-name.workers.dev";field.keyboardType=UIKeyboardTypeURL;field.autocapitalizationType=UITextAutocapitalizationTypeNone;field.autocorrectionType=UITextAutocorrectionTypeNo;}];
 [a addAction:[UIAlertAction actionWithTitle:@"キャンセル" style:UIAlertActionStyleCancel handler:nil]];
 [a addAction:[UIAlertAction actionWithTitle:@"確認して連携" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action){
  NSURLComponents *u=[NSURLComponents componentsWithString:[a.textFields.firstObject.text stringByTrimmingCharactersInSet:NSCharacterSet.whitespaceAndNewlineCharacterSet]];
  if(![u.scheme.lowercaseString isEqual:@"https"]||!u.host.length||u.user.length||u.password.length){[self message:@"接続先はHTTPS URLで入力してください。" title:@"接続先"];return;}
  u.path=@"/";u.query=nil;u.fragment=nil;[self verifyServer:u.URL];
 }]];[self presentViewController:a animated:YES completion:nil];
}
- (void)verifyServer:(NSURL *)server{
 if(!NXVPNReady()){[self message:@"VPNの接続確認が必要です。" title:@"サーバー連携"];return;}
 [self cancelVerification];NSUInteger epoch=self.connectionEpoch;
 self.status.hidden=NO;self.status.text=@"サーバーの種類を確認しています…";
 NSURL *probe=[NSURL URLWithString:@"api/instance" relativeToURL:server].absoluteURL;
 NSURLSessionConfiguration *config=NSURLSessionConfiguration.ephemeralSessionConfiguration;config.HTTPCookieStorage=nil;config.HTTPShouldSetCookies=NO;config.timeoutIntervalForRequest=8;config.timeoutIntervalForResource=10;
 NSURLSession *session=[NSURLSession sessionWithConfiguration:config delegate:self delegateQueue:nil];self.probeSession=session;
 NSMutableURLRequest *request=[NSMutableURLRequest requestWithURL:probe];[request setValue:@"application/json" forHTTPHeaderField:@"Accept"];
 [[session dataTaskWithRequest:request completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
  NSDictionary *info=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
  BOOL valid=!error&&[(NSHTTPURLResponse *)response statusCode]==200&&[response.URL.absoluteString isEqual:probe.absoluteString]&&[info isKindOfClass:NSDictionary.class]&&[info[@"product"] isEqual:@"x-nekama"]&&[info[@"protocol_version"] isEqual:@1]&&[info[@"platform"] isEqual:@"cloudflare-workers"];
  [session finishTasksAndInvalidate];
  dispatch_async(dispatch_get_main_queue(),^{
   if(epoch!=self.connectionEpoch)return;self.probeSession=nil;
   if(!NXVPNReady()||!valid){self.status.text=@"連携できませんでした。URL・デプロイ状態・VPNを確認してください。";[self message:self.status.text title:@"サーバー連携"];return;}
   [NSUserDefaults.standardUserDefaults setObject:server.absoluteString forKey:NXServerURLKey];[NSUserDefaults.standardUserDefaults setObject:server.absoluteString forKey:@"x-nekama.core-url"];[self load];
   if(![info[@"vpn_egress_configured"] boolValue])[self message:@"サーバーを連携しました。自動投稿を使う前にCloudflare側のVPN中継URL・認証Secretを設定してください。" title:@"VPN中継が未設定です"];
  });
 }] resume];
}
- (void)URLSession:(NSURLSession *)session task:(NSURLSessionTask *)task willPerformHTTPRedirection:(NSHTTPURLResponse *)response newRequest:(NSURLRequest *)request completionHandler:(void (^)(NSURLRequest *))completionHandler{completionHandler(nil);}
- (void)load{
 NSString *url=[NSUserDefaults.standardUserDefaults stringForKey:NXServerURLKey] ?: [NSUserDefaults.standardUserDefaults stringForKey:@"x-nekama.core-url"];if(!url.length){self.configureOnAppear=YES;return;}
 if(!NXVPNReady()){self.status.hidden=NO;self.status.text=@"VPNの接続確認が必要です。";return;}
 self.server=[NSURL URLWithString:url];self.web.hidden=NO;self.status.hidden=NO;self.status.text=@"サーバーに接続しています…";
 NSURLComponents *u=[NSURLComponents componentsWithURL:self.server resolvingAgainstBaseURL:NO];u.fragment=@"calendar";[self.web loadRequest:[NSURLRequest requestWithURL:u.URL]];
}
- (BOOL)sameOrigin:(NSURL *)url{return [url.scheme.lowercaseString isEqual:self.server.scheme.lowercaseString]&&[url.host.lowercaseString isEqual:self.server.host.lowercaseString]&&[(url.port?:@443)isEqual:(self.server.port?:@443)];}
- (void)webView:(WKWebView *)web decidePolicyForNavigationAction:(WKNavigationAction *)action decisionHandler:(void (^)(WKNavigationActionPolicy))handler{
 NSURL *url=action.request.URL;
 if(NXVPNReady()&&[self sameOrigin:url]){handler(WKNavigationActionPolicyAllow);return;}
 handler(WKNavigationActionPolicyCancel);
 if(action.navigationType==WKNavigationTypeLinkActivated&&NXVPNReady()&&[url.scheme isEqual:@"https"])[UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
}
- (void)webView:(WKWebView *)web didFinishNavigation:(WKNavigation *)navigation{self.status.hidden=YES;}
- (void)webView:(WKWebView *)web didFailProvisionalNavigation:(WKNavigation *)navigation withError:(NSError *)error{self.status.hidden=NO;self.status.text=@"サーバーへ接続できません。接続先・VPN・サーバーの稼働状態を確認してください。";}
- (void)message:(NSString *)text title:(NSString *)title{UIAlertController *a=[UIAlertController alertControllerWithTitle:title message:text preferredStyle:UIAlertControllerStyleAlert];[a addAction:[UIAlertAction actionWithTitle:@"OK" style:UIAlertActionStyleDefault handler:nil]];[self presentViewController:a animated:YES completion:nil];}
- (void)sync{
 if(!NXVPNReady()||![self sameOrigin:self.web.URL]){[self message:@"サーバーへ接続してログインしてください。" title:@"同期"];return;}
 NSDictionary *source=NXDeviceSource();if(![source[@"reference_posts"] count]){[self message:@"端末に取得済み投稿がありません。サーバーの「お手本アカウント」から取得できます。" title:@"同期"];return;}
 NSData *json=[NSJSONSerialization dataWithJSONObject:source options:0 error:nil];NSString *base64=[json base64EncodedStringWithOptions:0];
 // Data is base64 encoded; neither reference posts nor user settings execute as JS.
 NSString *script=[NSString stringWithFormat:@"(async()=>{try{const data=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob('%@'),c=>c.charCodeAt(0))));const r=await fetch('/api/device-source',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});const result=await r.json();if(!r.ok)throw Error(result.error||'同期失敗');return '取得済み '+result.count+' 件を同期しました';}catch(e){return e.message;}})()",base64];
 [self.web callAsyncJavaScript:[@"return await " stringByAppendingString:script] arguments:@{} inFrame:nil inContentWorld:WKContentWorld.pageWorld completionHandler:^(id result,NSError *error){[self message:error?@"同期できませんでした。":([result isKindOfClass:NSString.class]?result:@"同期結果を確認できません。") title:@"取得済み投稿の同期"]; }];
}
@end
static void NXOpenServerManager(UIViewController *presenter,BOOL configure){
 if(!presenter||presenter.presentedViewController||!NXVPNReady())return;
 NXServerController *controller=[NXServerController new];controller.configureOnAppear=configure;
 UINavigationController *nav=[[UINavigationController alloc]initWithRootViewController:controller];nav.modalPresentationStyle=UIModalPresentationFullScreen;nav.overrideUserInterfaceStyle=UIUserInterfaceStyleDark;nav.view.tintColor=NXServerBlue();
 [presenter presentViewController:nav animated:YES completion:nil];
}
void NXServerManagerOpen(UIViewController *presenter){NXOpenServerManager(presenter,NO);}
void NXServerManagerConnect(UIViewController *presenter){NXOpenServerManager(presenter,YES);}
@interface NXServerEntry:NSObject
@property(nonatomic,strong) NSMapTable *buttons;
@property(nonatomic,strong) NSTimer *timer;
@end
@implementation NXServerEntry
- (void)open:(UIButton *)button{NXServerManagerOpen(button.window.rootViewController);}
- (void)refresh{
 for(UIScene *scene in UIApplication.sharedApplication.connectedScenes){if(![scene isKindOfClass:UIWindowScene.class]||scene.activationState!=UISceneActivationStateForegroundActive)continue;
  for(UIWindow *window in ((UIWindowScene *)scene).windows){if(window.windowLevel!=UIWindowLevelNormal||!window.isKeyWindow||!window.rootViewController)continue;
   UIButton *button=[self.buttons objectForKey:window];if(!button){button=[UIButton buttonWithType:UIButtonTypeSystem];button.backgroundColor=NXServerBlue();button.tintColor=UIColor.whiteColor;button.layer.cornerRadius=24;[button setImage:[UIImage systemImageNamed:@"calendar.badge.clock"] forState:UIControlStateNormal];button.accessibilityLabel=@"投稿予約管理";[button addTarget:self action:@selector(open:) forControlEvents:UIControlEventTouchUpInside];[window addSubview:button];[self.buttons setObject:button forKey:window];}
   button.frame=CGRectMake(CGRectGetWidth(window.bounds)-64,CGRectGetHeight(window.bounds)-window.safeAreaInsets.bottom-204,48,48);button.hidden=!NXVPNReady()||window.rootViewController.presentedViewController!=nil;if(!button.hidden)[window bringSubviewToFront:button];
  }
 }
}
@end
void NXServerManagerInstall(void){dispatch_async(dispatch_get_main_queue(),^{static NXServerEntry *entry;entry=[NXServerEntry new];entry.buttons=[NSMapTable weakToStrongObjectsMapTable];entry.timer=[NSTimer timerWithTimeInterval:0.5 target:entry selector:@selector(refresh) userInfo:nil repeats:YES];[NSRunLoop.mainRunLoop addTimer:entry.timer forMode:NSRunLoopCommonModes];});}
