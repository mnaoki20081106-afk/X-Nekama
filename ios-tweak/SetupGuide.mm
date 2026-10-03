#import "SetupGuide.h"

static NSString *const NXGuideStepKey=@"x-nekama.setup-guide.step";
static NSString *const NXGuideRoot=@"https://github.com/mnaoki20081106-afk/X-Nekama/blob/codex/server-calendar-vpn-20261003/docs/";
@interface NXSetupGuide:UIViewController
@property(nonatomic) NSInteger step;
@property(nonatomic,strong) UIStackView *stack;
@property(nonatomic,copy) dispatch_block_t connect;
@property(nonatomic,copy) dispatch_block_t manage;
- (void)nxShowStep:(NSInteger)step;
@end
@implementation NXSetupGuide
- (void)viewDidLoad{
 [super viewDidLoad];self.title=@"セットアップガイド";self.view.backgroundColor=UIColor.blackColor;
 self.navigationItem.rightBarButtonItem=[[UIBarButtonItem alloc]initWithTitle:@"最初から" style:UIBarButtonItemStylePlain target:self action:@selector(restart)];
 [self.navigationController setToolbarHidden:YES];
 self.step=MAX(0,MIN(4,[NSUserDefaults.standardUserDefaults integerForKey:NXGuideStepKey]));
 UIScrollView *scroll=[UIScrollView new];scroll.translatesAutoresizingMaskIntoConstraints=NO;[self.view addSubview:scroll];
 self.stack=[[UIStackView alloc]init];self.stack.axis=UILayoutConstraintAxisVertical;self.stack.spacing=20;self.stack.translatesAutoresizingMaskIntoConstraints=NO;[scroll addSubview:self.stack];
 [NSLayoutConstraint activateConstraints:@[[scroll.topAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.topAnchor],[scroll.bottomAnchor constraintEqualToAnchor:self.view.safeAreaLayoutGuide.bottomAnchor],[scroll.leadingAnchor constraintEqualToAnchor:self.view.leadingAnchor],[scroll.trailingAnchor constraintEqualToAnchor:self.view.trailingAnchor],[self.stack.topAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.topAnchor constant:24],[self.stack.bottomAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.bottomAnchor constant:-24],[self.stack.leadingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.leadingAnchor constant:24],[self.stack.trailingAnchor constraintEqualToAnchor:scroll.contentLayoutGuide.trailingAnchor constant:-24],[self.stack.widthAnchor constraintEqualToAnchor:scroll.frameLayoutGuide.widthAnchor constant:-48]]];
 [self render];
}
- (void)label:(NSString *)text font:(UIFont *)font color:(UIColor *)color{
 UILabel *label=[UILabel new];label.text=text;label.numberOfLines=0;label.font=font;label.textColor=color;label.adjustsFontForContentSizeCategory=YES;[self.stack addArrangedSubview:label];
}
- (void)button:(NSString *)title action:(SEL)action{
 UIButton *button=[UIButton buttonWithType:UIButtonTypeSystem];[button setTitle:title forState:UIControlStateNormal];button.titleLabel.numberOfLines=0;button.titleLabel.textAlignment=NSTextAlignmentCenter;button.titleLabel.font=[UIFont preferredFontForTextStyle:UIFontTextStyleHeadline];button.titleLabel.adjustsFontForContentSizeCategory=YES;button.backgroundColor=[UIColor colorWithWhite:0.12 alpha:1];button.layer.cornerRadius=16;button.contentEdgeInsets=UIEdgeInsetsMake(14,16,14,16);[button addTarget:self action:action forControlEvents:UIControlEventTouchUpInside];[self.stack addArrangedSubview:button];
}
- (void)render{
 for(UIView *view in self.stack.arrangedSubviews){[self.stack removeArrangedSubview:view];[view removeFromSuperview];}
 NSArray *titles=@[@"先に用意するもの",@"自分のCloudflareへ配置",@"VPN中継を設定",@"サーバーURLを連携",@"Xに接続して予約"];
 NSArray *body=@[
 @"CloudflareアカウントとGitHubアカウントを用意します。\n\n自動投稿には、常時稼働するVPN中継のHTTPS URLと、24文字以上の共通Secretも必要です。iPhoneと同じ出口を使う場合は、固定IPのWireGuard出口を用意します。\n\nCloudflareへのログインだけではVPN中継は作られません。まだない場合は、下の手順で準備してください。",
 @"「Cloudflareで配置」を押すと公式画面が開きます。\n\n① CloudflareとGitHubにログインする\n② 配置先が自分のアカウントか確認する\n③ Worker・DB・保存領域などの名前を確認する\n④ Deployを実行する\n\n必要なリソースの作成は公式フローが行います。VPNの設定値を求められたら、次の手順を確認してください。",
 @"自分のWorkerを開き、SettingsのVariables and Secretsで次を設定して保存・反映します。\n\nX_EGRESS_URL\n中継の https://…/fetch\n\nX_EGRESS_TOKEN（Secret）\n中継と同じ24文字以上の値\n\n共通出口の場合は、X_EXIT_MODEをshared、X_EXIT_IPを固定公開IPv4、X_EXIT_COUNTRYをJPなどの国コードにします。iPhone・中継の設定も揃えます。\n\nSecretはこのガイドには入力しません。設定後も実際のVPN接続確認が必要です。",
 @"配置が完了したWorkerの https://…workers.dev URLをコピーします。独自ドメインを使う場合はそのURLを入力します。\n\n「URLを入力して確認」から登録してください。アプリはサーバーの種類と応答を確認してから保存します。VPN中継の設定が不足している場合は案内を表示します。\n\n失敗した場合：デプロイ結果、URL、iPhoneのVPN接続を確認して、再試行できます。",
 @"「管理画面を開く」からXに接続します。追加認証が必要な場合は、管理画面のCookie接続を使います。\n\n管理画面でサーバーのVPN状態を確認し、口調・絵文字・お手本を設定して、カレンダーから予約してください。\n\n初回は自分で確認できる内容を1件予約し、予定時刻後にXで投稿を確認してください。\n\nこのガイドを進めただけでは実際の投稿成功は確認されません。アプリの連携解除だけでは、保存済みの予約は停止しません。"
 ];
 [self label:[NSString stringWithFormat:@"手順 %ld / 5",(long)self.step+1] font:[UIFont preferredFontForTextStyle:UIFontTextStyleSubheadline] color:self.view.tintColor];
 [self label:titles[self.step] font:[UIFont preferredFontForTextStyle:UIFontTextStyleTitle1] color:UIColor.whiteColor];
 [self label:body[self.step] font:[UIFont preferredFontForTextStyle:UIFontTextStyleBody] color:UIColor.whiteColor];
 if(self.step==0){[self button:@"Cloudflareを開く" action:@selector(dashboard)];[self button:@"GitHubを開く" action:@selector(github)];[self button:@"VPN中継の準備手順" action:@selector(vpnHelp)];}
 if(self.step==1)[self button:@"Cloudflareで配置" action:@selector(deploy)];
 if(self.step==2){[self button:@"Cloudflareの設定を開く" action:@selector(dashboard)];[self button:@"VPN中継の詳しい手順" action:@selector(vpnHelp)];}
 if(self.step==3)[self button:@"URLを入力して確認" action:@selector(connectNow)];
 if(self.step==4){NSString *url=[NSUserDefaults.standardUserDefaults stringForKey:@"x-nekama.server-url"]?:[NSUserDefaults.standardUserDefaults stringForKey:@"x-nekama.core-url"];[self label:url.length?[@"登録済みの接続先：\n" stringByAppendingString:url]:@"サーバーURLはまだ登録されていません。前の手順で連携してください。" font:[UIFont preferredFontForTextStyle:UIFontTextStyleFootnote] color:UIColor.secondaryLabelColor];[self button:@"管理画面を開く" action:@selector(manageNow)];}
 if(self.step<4)[self button:@"説明を確認して次へ" action:@selector(next)];
 if(self.step>0)[self button:@"前の手順へ" action:@selector(previous)];
 [self label:@"進行位置は保存されます。各項目の設定・動作を自動で完了扱いにはしません。" font:[UIFont preferredFontForTextStyle:UIFontTextStyleFootnote] color:UIColor.secondaryLabelColor];
}
- (void)nxShowStep:(NSInteger)step{self.step=MAX(0,MIN(4,step));[NSUserDefaults.standardUserDefaults setInteger:self.step forKey:NXGuideStepKey];[self render];[(UIScrollView *)self.stack.superview setContentOffset:CGPointZero animated:NO];}
- (void)next{[self nxShowStep:self.step+1];}
- (void)previous{[self nxShowStep:self.step-1];}
- (void)restart{[self nxShowStep:0];}
- (void)open:(NSString *)url{[UIApplication.sharedApplication openURL:[NSURL URLWithString:url] options:@{} completionHandler:nil];}
- (void)dashboard{[self open:@"https://dash.cloudflare.com/"];}
- (void)github{[self open:@"https://github.com/"];}
- (void)vpnHelp{[self open:[NXGuideRoot stringByAppendingString:@"SHARED_EXIT_JA.md"]];}
- (void)deploy{[self open:@"https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fmnaoki20081106-afk%2FX-Nekama%2Ftree%2Fcodex%2Fserver-calendar-vpn-20261003"];}
- (void)connectNow{dispatch_block_t action=self.connect;[self.navigationController popViewControllerAnimated:NO];if(action)action();}
- (void)manageNow{dispatch_block_t action=self.manage;[self.navigationController popViewControllerAnimated:NO];if(action)action();}
@end
void NXSetupGuideOpen(UINavigationController *navigation,dispatch_block_t connect,dispatch_block_t manage){
 if(!navigation||[navigation.topViewController isKindOfClass:NXSetupGuide.class])return;
 NXSetupGuide *guide=[NXSetupGuide new];guide.connect=connect;guide.manage=manage;[navigation pushViewController:guide animated:YES];
}
