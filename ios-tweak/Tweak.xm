#import <UIKit/UIKit.h>
#import <PhotosUI/PhotosUI.h>
#import <objc/runtime.h>

@interface TFNTwitterAccount : NSObject
- (NSString *)accountID;
- (NSString *)username;
@end

@interface TFNTwitterComposition : NSObject
- (NSString *)text;
- (void)setText:(NSString *)text;
@end

@interface T1TweetComposeSingleTweetViewController : UIViewController
- (void)reloadCompositionText;
@end

@interface T1TweetComposeViewController : UIViewController
- (TFNTwitterAccount *)account;
- (TFNTwitterComposition *)activeComposition;
- (T1TweetComposeSingleTweetViewController *)t1_activeTweetViewController;
- (void)_t1_openGrokImagineViewControllerWithInitialPrompt:(NSString *)prompt;
- (void)_t1_syncAIDisclosureForComposition:(TFNTwitterComposition *)composition;
@end

@interface T1GrokTextPostComposerController : UIViewController
- (instancetype)initWithAccount:(TFNTwitterAccount *)account
                    initialText:(NSString *)initialText
               onAcceptRevision:(void (^)(NSString *revision))onAcceptRevision;
@end

static NSString * const XNProfilePrefix = @"com.xnekama.profile.";
static const void *XNButtonAssociationKey = &XNButtonAssociationKey;

static NSString *XNAccountKey(TFNTwitterAccount *account) {
    NSString *accountID = [account accountID];
    if (accountID.length > 0) {
        return accountID;
    }

    NSString *username = [account username];
    if (username.length > 0) {
        return username;
    }

    return @"unknown";
}

static NSString *XNProfileDefaultsKey(TFNTwitterAccount *account) {
    return [XNProfilePrefix stringByAppendingString:XNAccountKey(account)];
}

static NSMutableDictionary *XNLoadProfile(TFNTwitterAccount *account) {
    NSDictionary *stored =
        [[NSUserDefaults standardUserDefaults] dictionaryForKey:XNProfileDefaultsKey(account)];
    if ([stored isKindOfClass:NSDictionary.class]) {
        return [stored mutableCopy];
    }
    return [NSMutableDictionary dictionary];
}

static void XNSaveProfile(TFNTwitterAccount *account, NSDictionary *profile) {
    [[NSUserDefaults standardUserDefaults] setObject:profile
                                             forKey:XNProfileDefaultsKey(account)];
}

static NSString *XNString(NSDictionary *profile, NSString *key) {
    id value = profile[key];
    return [value isKindOfClass:NSString.class] ? value : @"";
}

static NSString *XNSafeAccountDirectoryName(TFNTwitterAccount *account) {
    NSString *accountKey = XNAccountKey(account);
    NSCharacterSet *bad =
        [[NSCharacterSet alphanumericCharacterSet] invertedSet];
    NSString *safe =
        [[accountKey componentsSeparatedByCharactersInSet:bad]
         componentsJoinedByString:@"_"];
    return safe.length > 0 ? safe : @"unknown";
}

static NSString *XNReferenceDirectory(TFNTwitterAccount *account) {
    NSArray<NSURL *> *urls =
        [[NSFileManager defaultManager] URLsForDirectory:NSApplicationSupportDirectory
                                               inDomains:NSUserDomainMask];
    NSURL *baseURL = urls.firstObject;
    if (!baseURL) {
        return nil;
    }

    NSURL *directory =
        [[[baseURL URLByAppendingPathComponent:@"X-Nekama" isDirectory:YES]
          URLByAppendingPathComponent:XNSafeAccountDirectoryName(account)
          isDirectory:YES] copy];

    NSError *error = nil;
    BOOL created =
        [[NSFileManager defaultManager] createDirectoryAtURL:directory
                                withIntermediateDirectories:YES
                                                 attributes:nil
                                                      error:&error];
    if (!created || error) {
        return nil;
    }
    return directory.path;
}

static NSString *XNReferencePath(TFNTwitterAccount *account, NSString *kind) {
    NSString *directory = XNReferenceDirectory(account);
    if (directory.length == 0) {
        return nil;
    }
    return [directory stringByAppendingPathComponent:
            [NSString stringWithFormat:@"%@.jpg", kind]];
}

static BOOL XNHasReference(TFNTwitterAccount *account, NSString *kind) {
    NSString *path = XNReferencePath(account, kind);
    return path.length > 0 &&
        [[NSFileManager defaultManager] fileExistsAtPath:path];
}

static NSString *XNProfileSummaryPrompt(NSDictionary *profile) {
    NSMutableArray<NSString *> *lines = [NSMutableArray array];

    NSDictionary<NSString *, NSString *> *labels = @{
        @"age": @"年齢",
        @"location": @"所在地",
        @"gender": @"性別・キャラクター設定",
        @"personality": @"性格",
        @"tone": @"口調",
        @"firstPerson": @"一人称",
        @"interests": @"趣味・好きなもの",
        @"visualNotes": @"外見・服装メモ",
        @"phoneCaseNotes": @"スマホケースの特徴"
    };

    NSArray<NSString *> *order = @[
        @"age", @"location", @"gender", @"personality", @"tone",
        @"firstPerson", @"interests", @"visualNotes", @"phoneCaseNotes"
    ];

    for (NSString *key in order) {
        NSString *value = XNString(profile, key);
        if (value.length > 0) {
            [lines addObject:
                [NSString stringWithFormat:@"%@: %@", labels[key], value]];
        }
    }

    return [lines componentsJoinedByString:@"\n"];
}

static NSString *XNBuildTextBrief(NSDictionary *profile, NSString *draft) {
    NSString *persona = XNProfileSummaryPrompt(profile);
    NSString *memo = draft.length > 0 ? draft : @"特になし";

    return [NSString stringWithFormat:
        @"このXアカウント用の投稿本文を1つ作成してください。\n"
         "本文以外の解説は出力しないでください。"
         "設定にない具体的事実は勝手に追加しないでください。\n"
         "%@\n"
         "今回の投稿テーマ・メモ: %@\n"
         "Xで自然に読める短い文章にしてください。",
         persona.length > 0 ? persona : @"人物設定: 未登録",
         memo];
}

static NSString *XNBuildImagePrompt(NSDictionary *profile, NSString *postText) {
    NSString *persona = XNProfileSummaryPrompt(profile);
    NSString *text =
        postText.length > 0 ? postText : @"投稿本文は未入力";

    return [NSString stringWithFormat:
        @"次のX投稿に添える、自然なスマートフォン写真風の画像を作成してください。\n"
         "%@\n"
         "投稿本文: %@\n"
         "過度に作り込まず、日常の写真として自然な構図・光・質感にしてください。"
         "画像内に文章・透かし・ロゴを追加しないでください。",
         persona.length > 0 ? persona : @"人物設定: 未登録",
         text];
}

static void XNShowAlert(UIViewController *presenter,
                        NSString *title,
                        NSString *message) {
    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:title
                                            message:message
                                     preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:
        [UIAlertAction actionWithTitle:@"OK"
                                 style:UIAlertActionStyleDefault
                               handler:nil]];
    [presenter presentViewController:alert animated:YES completion:nil];
}

@interface XNNekamaPanelViewController
    : UITableViewController <PHPickerViewControllerDelegate>
@property(nonatomic, weak) T1TweetComposeViewController *composeController;
@property(nonatomic, strong) TFNTwitterAccount *account;
@property(nonatomic, strong) NSMutableDictionary *profile;
@property(nonatomic, copy) NSString *pendingReferenceKind;
- (instancetype)initWithComposeController:
    (T1TweetComposeViewController *)composeController;
@end

@implementation XNNekamaPanelViewController

- (instancetype)initWithComposeController:
    (T1TweetComposeViewController *)composeController {
    self = [super initWithStyle:UITableViewStyleInsetGrouped];
    if (self) {
        _composeController = composeController;
        _account = [composeController account];
        _profile = XNLoadProfile(_account);
        self.title = @"Nekama";
    }
    return self;
}

- (void)viewDidLoad {
    [super viewDidLoad];

    self.navigationItem.leftBarButtonItem =
        [[UIBarButtonItem alloc]
            initWithBarButtonSystemItem:UIBarButtonSystemItemClose
                                 target:self
                                 action:@selector(xn_close)];
}

- (void)xn_close {
    [self dismissViewControllerAnimated:YES completion:nil];
}

- (NSInteger)numberOfSectionsInTableView:(UITableView *)tableView {
    return 4;
}

- (NSInteger)tableView:(UITableView *)tableView
 numberOfRowsInSection:(NSInteger)section {
    switch (section) {
        case 0: return 2;
        case 1: return 9;
        case 2: return 2;
        case 3: return 3;
        default: return 0;
    }
}

- (NSString *)tableView:(UITableView *)tableView
 titleForHeaderInSection:(NSInteger)section {
    switch (section) {
        case 0: return @"Xアカウント";
        case 1: return @"運用プロファイル";
        case 2: return @"画像生成の参考";
        case 3: return @"Grok";
        default: return nil;
    }
}

- (NSString *)xn_profileKeyForRow:(NSInteger)row {
    NSArray<NSString *> *keys = @[
        @"age", @"location", @"gender", @"personality", @"tone",
        @"firstPerson", @"interests", @"visualNotes", @"phoneCaseNotes"
    ];
    return keys[(NSUInteger)row];
}

- (NSString *)xn_profileLabelForRow:(NSInteger)row {
    NSArray<NSString *> *labels = @[
        @"年齢", @"所在地", @"性別・設定", @"性格", @"口調",
        @"一人称", @"趣味", @"外見・服装", @"スマホケース"
    ];
    return labels[(NSUInteger)row];
}

- (UITableViewCell *)tableView:(UITableView *)tableView
         cellForRowAtIndexPath:(NSIndexPath *)indexPath {
    static NSString *identifier = @"XNCell";

    UITableViewCell *cell =
        [tableView dequeueReusableCellWithIdentifier:identifier];

    if (!cell) {
        cell = [[UITableViewCell alloc]
            initWithStyle:UITableViewCellStyleValue1
          reuseIdentifier:identifier];
    }

    cell.accessoryType = UITableViewCellAccessoryNone;
    cell.textLabel.textColor = UIColor.labelColor;
    cell.detailTextLabel.textColor = UIColor.secondaryLabelColor;

    if (indexPath.section == 0) {
        if (indexPath.row == 0) {
            cell.textLabel.text = @"ユーザー名";
            cell.detailTextLabel.text = [self.account username] ?: @"";
        } else {
            cell.textLabel.text = @"アカウントID";
            cell.detailTextLabel.text = [self.account accountID] ?: @"";
        }
        cell.selectionStyle = UITableViewCellSelectionStyleNone;
        return cell;
    }

    if (indexPath.section == 1) {
        NSString *key = [self xn_profileKeyForRow:indexPath.row];
        cell.textLabel.text = [self xn_profileLabelForRow:indexPath.row];

        NSString *value = XNString(self.profile, key);
        cell.detailTextLabel.text = value.length > 0 ? value : @"未設定";
        cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
        cell.selectionStyle = UITableViewCellSelectionStyleDefault;
        return cell;
    }

    if (indexPath.section == 2) {
        NSString *kind =
            indexPath.row == 0 ? @"face" : @"phone_case";
        cell.textLabel.text =
            indexPath.row == 0 ? @"顔参考画像" : @"スマホケース画像";
        cell.detailTextLabel.text =
            XNHasReference(self.account, kind) ? @"登録済み" : @"未設定";
        cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
        cell.selectionStyle = UITableViewCellSelectionStyleDefault;
        return cell;
    }

    NSArray<NSString *> *labels = @[
        @"プロフィールから投稿文を作る",
        @"現在の本文をGrokで編集",
        @"投稿に合う画像をGrokで作る"
    ];

    cell.textLabel.text = labels[(NSUInteger)indexPath.row];
    cell.detailTextLabel.text = @"";
    cell.accessoryType = UITableViewCellAccessoryDisclosureIndicator;
    cell.selectionStyle = UITableViewCellSelectionStyleDefault;
    return cell;
}

- (void)xn_editProfileRow:(NSInteger)row {
    NSString *key = [self xn_profileKeyForRow:row];
    NSString *label = [self xn_profileLabelForRow:row];

    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:label
                                            message:nil
                                     preferredStyle:UIAlertControllerStyleAlert];

    [alert addTextFieldWithConfigurationHandler:^(UITextField *textField) {
        textField.text = XNString(self.profile, key);
        textField.clearButtonMode = UITextFieldViewModeWhileEditing;
    }];

    __weak typeof(self) weakSelf = self;

    [alert addAction:
        [UIAlertAction actionWithTitle:@"キャンセル"
                                 style:UIAlertActionStyleCancel
                               handler:nil]];

    [alert addAction:
        [UIAlertAction actionWithTitle:@"保存"
                                 style:UIAlertActionStyleDefault
                               handler:^(__unused UIAlertAction *action) {
        __strong typeof(weakSelf) self = weakSelf;
        if (!self) {
            return;
        }

        NSString *value = alert.textFields.firstObject.text ?: @"";
        if (value.length > 0) {
            self.profile[key] = value;
        } else {
            [self.profile removeObjectForKey:key];
        }

        XNSaveProfile(self.account, self.profile);
        [self.tableView reloadData];
    }]];

    [self presentViewController:alert animated:YES completion:nil];
}

- (void)xn_pickReference:(NSString *)kind {
    PHPickerConfiguration *configuration =
        [[PHPickerConfiguration alloc] init];

    configuration.selectionLimit = 1;
    configuration.filter = [PHPickerFilter imagesFilter];

    PHPickerViewController *picker =
        [[PHPickerViewController alloc]
            initWithConfiguration:configuration];

    picker.delegate = self;
    self.pendingReferenceKind = kind;

    [self presentViewController:picker animated:YES completion:nil];
}

- (void)picker:(PHPickerViewController *)picker
 didFinishPicking:(NSArray<PHPickerResult *> *)results {
    [picker dismissViewControllerAnimated:YES completion:nil];

    PHPickerResult *result = results.firstObject;
    NSString *kind = self.pendingReferenceKind;
    self.pendingReferenceKind = nil;

    if (!result || kind.length == 0) {
        return;
    }

    NSItemProvider *provider = result.itemProvider;

    if (![provider canLoadObjectOfClass:UIImage.class]) {
        XNShowAlert(self,
                    @"画像を読み込めません",
                    @"別の画像を選択してください。");
        return;
    }

    __weak typeof(self) weakSelf = self;

    [provider loadObjectOfClass:UIImage.class
              completionHandler:^(UIImage *image, NSError *error) {
        __strong typeof(weakSelf) self = weakSelf;
        if (!self) {
            return;
        }

        if (![image isKindOfClass:UIImage.class] || error) {
            dispatch_async(dispatch_get_main_queue(), ^{
                XNShowAlert(self,
                            @"画像を読み込めません",
                            error.localizedDescription ?:
                                @"読み込みに失敗しました。");
            });
            return;
        }

        NSData *jpeg = UIImageJPEGRepresentation(image, 0.92);
        NSString *path = XNReferencePath(self.account, kind);
        BOOL ok = path.length > 0 && [jpeg writeToFile:path atomically:YES];

        dispatch_async(dispatch_get_main_queue(), ^{
            if (!ok) {
                XNShowAlert(self,
                            @"保存できません",
                            @"参考画像の保存に失敗しました。");
            }
            [self.tableView reloadData];
        });
    }];
}

- (void)xn_presentNativeGrokTextWithInitialText:(NSString *)initialText {
    Class grokClass =
        NSClassFromString(@"T1GrokTextPostComposerController");

    if (!grokClass) {
        XNShowAlert(self,
                    @"Grokを開けません",
                    @"X 12.29のGrok文章編集クラスが見つかりません。");
        return;
    }

    T1TweetComposeViewController *compose = self.composeController;
    TFNTwitterAccount *account = [compose account];

    if (!account) {
        XNShowAlert(self,
                    @"アカウントを取得できません",
                    @"投稿画面を開き直してください。");
        return;
    }

    __weak T1TweetComposeViewController *weakCompose = compose;

    T1GrokTextPostComposerController *controller =
        [(T1GrokTextPostComposerController *)[grokClass alloc]
            initWithAccount:account
                initialText:initialText ?: @""
           onAcceptRevision:^(NSString *revision) {
        T1TweetComposeViewController *strongCompose = weakCompose;
        if (!strongCompose || revision.length == 0) {
            return;
        }

        TFNTwitterComposition *composition =
            [strongCompose activeComposition];

        if (!composition) {
            return;
        }

        [composition setText:revision];

        if ([strongCompose
                respondsToSelector:
                    @selector(_t1_syncAIDisclosureForComposition:)]) {
            [strongCompose
                _t1_syncAIDisclosureForComposition:composition];
        }

        T1TweetComposeSingleTweetViewController *active =
            [strongCompose t1_activeTweetViewController];

        if ([active respondsToSelector:@selector(reloadCompositionText)]) {
            [active reloadCompositionText];
        }
    }];

    if (!controller) {
        XNShowAlert(self,
                    @"Grokを開けません",
                    @"Grok文章編集画面の初期化に失敗しました。");
        return;
    }

    [self dismissViewControllerAnimated:YES completion:^{
        [compose presentViewController:controller
                              animated:YES
                            completion:nil];
    }];
}

- (void)xn_generateTextFromProfile {
    NSString *current =
        [[self.composeController activeComposition] text] ?: @"";

    NSString *brief =
        XNBuildTextBrief(self.profile, current);

    [self xn_presentNativeGrokTextWithInitialText:brief];
}

- (void)xn_editCurrentTextWithGrok {
    NSString *current =
        [[self.composeController activeComposition] text] ?: @"";

    if (current.length == 0) {
        XNShowAlert(self,
                    @"本文が空です",
                    @"先に少しメモを書くか、"
                     "「プロフィールから投稿文を作る」を使ってください。");
        return;
    }

    [self xn_presentNativeGrokTextWithInitialText:current];
}

- (void)xn_generateImage {
    T1TweetComposeViewController *compose = self.composeController;

    if (![compose
            respondsToSelector:
                @selector(_t1_openGrokImagineViewControllerWithInitialPrompt:)]) {
        XNShowAlert(self,
                    @"Grok Imagineを開けません",
                    @"X 12.29の画像生成入口が見つかりません。");
        return;
    }

    NSString *postText =
        [[compose activeComposition] text] ?: @"";

    NSString *prompt =
        XNBuildImagePrompt(self.profile, postText);

    [self dismissViewControllerAnimated:YES completion:^{
        [compose _t1_openGrokImagineViewControllerWithInitialPrompt:prompt];
    }];
}

- (void)tableView:(UITableView *)tableView
 didSelectRowAtIndexPath:(NSIndexPath *)indexPath {
    [tableView deselectRowAtIndexPath:indexPath animated:YES];

    if (indexPath.section == 1) {
        [self xn_editProfileRow:indexPath.row];
        return;
    }

    if (indexPath.section == 2) {
        [self xn_pickReference:
            indexPath.row == 0 ? @"face" : @"phone_case"];
        return;
    }

    if (indexPath.section == 3) {
        if (indexPath.row == 0) {
            [self xn_generateTextFromProfile];
        } else if (indexPath.row == 1) {
            [self xn_editCurrentTextWithGrok];
        } else {
            [self xn_generateImage];
        }
    }
}

- (NSString *)tableView:(UITableView *)tableView
 titleForFooterInSection:(NSInteger)section {
    if (section == 2) {
        return @"参考画像はアカウント別にXのアプリ領域へ保存します。"
                "X 12.29のGrok Imagineへ画像ファイル自体を安全に渡す経路は"
                "まだ接続していないため、現段階では保存のみです。";
    }

    if (section == 3) {
        return @"Grokの利用可否・回数・プラン判定はX本体に任せます。"
                "X-Nekamaは課金状態やFeature Flagを解除しません。";
    }

    return nil;
}

@end

static void XNEnsureNekamaButton(
    T1TweetComposeViewController *controller) {
    if (!controller.navigationItem) {
        return;
    }

    UIBarButtonItem *button =
        objc_getAssociatedObject(controller, XNButtonAssociationKey);

    if (!button) {
        button =
            [[UIBarButtonItem alloc] initWithTitle:@"Nekama"
                                             style:UIBarButtonItemStylePlain
                                            target:controller
                                            action:@selector(xn_openNekamaPanel)];

        button.accessibilityIdentifier =
            @"com.xnekama.compose.button";

        objc_setAssociatedObject(controller,
                                 XNButtonAssociationKey,
                                 button,
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    }

    NSMutableArray<UIBarButtonItem *> *items =
        [NSMutableArray array];

    if (controller.navigationItem.leftBarButtonItems.count > 0) {
        [items addObjectsFromArray:
            controller.navigationItem.leftBarButtonItems];
    } else if (controller.navigationItem.leftBarButtonItem) {
        [items addObject:controller.navigationItem.leftBarButtonItem];
    }

    if (![items containsObject:button]) {
        [items addObject:button];
        controller.navigationItem.leftBarButtonItems = items;
    }
}

%hook T1TweetComposeViewController

- (void)viewDidLoad {
    %orig;
    XNEnsureNekamaButton(self);
}

- (void)viewDidAppear:(BOOL)animated {
    %orig(animated);
    XNEnsureNekamaButton(self);
}

%new
- (void)xn_openNekamaPanel {
    XNNekamaPanelViewController *panel =
        [[XNNekamaPanelViewController alloc]
            initWithComposeController:self];

    UINavigationController *navigationController =
        [[UINavigationController alloc]
            initWithRootViewController:panel];

    navigationController.modalPresentationStyle =
        UIModalPresentationPageSheet;

    [self presentViewController:navigationController
                       animated:YES
                     completion:nil];
}

%end
