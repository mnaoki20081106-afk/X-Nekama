#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static const void *kNKNekamaButtonKey = &kNKNekamaButtonKey;
static NSString * const NKProfileDefaultsKey = @"com.xnekama.profile.v1";

static UIWindow *NKKeyWindow(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (scene.activationState != UISceneActivationStateForegroundActive ||
            ![scene isKindOfClass:UIWindowScene.class]) {
            continue;
        }

        for (UIWindow *window in ((UIWindowScene *)scene).windows) {
            if (window.isKeyWindow) {
                return window;
            }
        }
    }

    return UIApplication.sharedApplication.windows.firstObject;
}

static UIViewController *NKTopViewController(void) {
    UIViewController *controller = NKKeyWindow().rootViewController;

    while (controller) {
        if (controller.presentedViewController) {
            controller = controller.presentedViewController;
            continue;
        }

        if ([controller isKindOfClass:UINavigationController.class]) {
            controller = ((UINavigationController *)controller).visibleViewController;
            continue;
        }

        if ([controller isKindOfClass:UITabBarController.class]) {
            controller = ((UITabBarController *)controller).selectedViewController;
            continue;
        }

        break;
    }

    return controller;
}

static UIView *NKFindSubviewWithClassFragment(UIView *view, NSString *fragment) {
    if (!view || fragment.length == 0) {
        return nil;
    }

    NSString *className = NSStringFromClass(view.class);
    if ([className containsString:fragment]) {
        return view;
    }

    for (UIView *subview in view.subviews) {
        UIView *result = NKFindSubviewWithClassFragment(subview, fragment);
        if (result) {
            return result;
        }
    }

    return nil;
}

static BOOL NKIsComposerController(UIViewController *controller) {
    if (!controller || !controller.view.window) {
        return NO;
    }

    NSString *className = NSStringFromClass(controller.class);
    if ([className containsString:@"Composer"] || [className containsString:@"Compose"]) {
        return YES;
    }

    // Confirmed present in X 12.29.
    return NKFindSubviewWithClassFragment(controller.view, @"T1ComposeRichTextView") != nil;
}

static NSString *NKComposerText(UIViewController *controller) {
    UIView *textView = NKFindSubviewWithClassFragment(controller.view, @"T1ComposeRichTextView");
    if (!textView) {
        return @"";
    }

    SEL textSelector = NSSelectorFromString(@"text");
    if (![textView respondsToSelector:textSelector]) {
        return @"";
    }

#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    id value = [textView performSelector:textSelector];
#pragma clang diagnostic pop

    return [value isKindOfClass:NSString.class] ? value : @"";
}

static NSDictionary *NKProfile(void) {
    NSDictionary *profile = [NSUserDefaults.standardUserDefaults dictionaryForKey:NKProfileDefaultsKey];
    return [profile isKindOfClass:NSDictionary.class] ? profile : @{};
}

static void NKSaveProfile(NSDictionary *profile) {
    [NSUserDefaults.standardUserDefaults setObject:profile forKey:NKProfileDefaultsKey];
    [NSUserDefaults.standardUserDefaults synchronize];
}

static NSString *NKString(NSDictionary *dict, NSString *key) {
    id value = dict[key];
    return [value isKindOfClass:NSString.class] ? value : @"";
}

static NSString *NKPostPrompt(UIViewController *controller) {
    NSDictionary *profile = NKProfile();
    NSString *draft = NKComposerText(controller);

    NSMutableArray<NSString *> *parts = [NSMutableArray arrayWithArray:@[
        @"X投稿を1件だけ作成してください。",
        @"説明や候補一覧は付けず、投稿本文だけを返してください。",
        @"自然な日本語にし、設定された人物像と口調を一貫させてください。"
    ]];

    NSString *age = NKString(profile, @"age");
    NSString *location = NKString(profile, @"location");
    NSString *personality = NKString(profile, @"personality");
    NSString *tone = NKString(profile, @"tone");

    if (age.length) [parts addObject:[NSString stringWithFormat:@"年齢: %@", age]];
    if (location.length) [parts addObject:[NSString stringWithFormat:@"所在地: %@", location]];
    if (personality.length) [parts addObject:[NSString stringWithFormat:@"性格: %@", personality]];
    if (tone.length) [parts addObject:[NSString stringWithFormat:@"口調: %@", tone]];
    if (draft.length) [parts addObject:[NSString stringWithFormat:@"投稿テーマ/下書き: %@", draft]];

    return [parts componentsJoinedByString:@"\n"];
}

static void NKOpenURL(NSURL *url) {
    if (!url) return;

    dispatch_async(dispatch_get_main_queue(), ^{
        [UIApplication.sharedApplication openURL:url options:@{} completionHandler:nil];
    });
}

static void NKOpenGrokWithPrompt(UIViewController *controller) {
    NSString *prompt = NKPostPrompt(controller);
    NSString *encoded = [prompt stringByAddingPercentEncodingWithAllowedCharacters:
                         NSCharacterSet.URLQueryAllowedCharacterSet];

    // X 12.29 includes this route in XAppLibraries.framework.
    NSString *urlString = [NSString stringWithFormat:@"https://www.x.com/i/grok?text=%@", encoded ?: @""];
    NKOpenURL([NSURL URLWithString:urlString]);
}

static void NKOpenImagine(void) {
    // X 12.29 contains the native twitter://imagine route and Grok Imagine composer integration.
    NKOpenURL([NSURL URLWithString:@"twitter://imagine"]);
}

static void NKPresentProfileEditor(UIViewController *controller) {
    NSDictionary *profile = NKProfile();

    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:@"Nekama プロファイル"
                                            message:@"投稿生成時にGrokへ渡す基本情報"
                                     preferredStyle:UIAlertControllerStyleAlert];

    NSArray<NSDictionary *> *fields = @[
        @{@"key": @"age", @"title": @"年齢"},
        @{@"key": @"location", @"title": @"所在地"},
        @{@"key": @"personality", @"title": @"性格"},
        @{@"key": @"tone", @"title": @"口調"}
    ];

    for (NSDictionary *field in fields) {
        [alert addTextFieldWithConfigurationHandler:^(UITextField *textField) {
            textField.placeholder = field[@"title"];
            textField.text = NKString(profile, field[@"key"]);
            textField.clearButtonMode = UITextFieldViewModeWhileEditing;
        }];
    }

    [alert addAction:[UIAlertAction actionWithTitle:@"キャンセル"
                                              style:UIAlertActionStyleCancel
                                            handler:nil]];

    [alert addAction:[UIAlertAction actionWithTitle:@"保存"
                                              style:UIAlertActionStyleDefault
                                            handler:^(__unused UIAlertAction *action) {
        NSMutableDictionary *updated = [NSMutableDictionary dictionary];
        for (NSUInteger i = 0; i < fields.count; i++) {
            NSString *value = alert.textFields[i].text ?: @"";
            updated[fields[i][@"key"]] = value;
        }
        NKSaveProfile(updated);
    }]];

    [controller presentViewController:alert animated:YES completion:nil];
}

static void NKPresentMenu(UIButton *sender) {
    UIViewController *controller = NKTopViewController();
    if (!controller) return;

    UIAlertController *sheet =
        [UIAlertController alertControllerWithTitle:@"X-Nekama"
                                            message:@"X内のGrokを使って投稿作成を補助します"
                                     preferredStyle:UIAlertControllerStyleActionSheet];

    [sheet addAction:[UIAlertAction actionWithTitle:@"Grokで投稿文を作る"
                                              style:UIAlertActionStyleDefault
                                            handler:^(__unused UIAlertAction *action) {
        NKOpenGrokWithPrompt(controller);
    }]];

    [sheet addAction:[UIAlertAction actionWithTitle:@"Grok Imagineで画像を作る"
                                              style:UIAlertActionStyleDefault
                                            handler:^(__unused UIAlertAction *action) {
        NKOpenImagine();
    }]];

    [sheet addAction:[UIAlertAction actionWithTitle:@"Nekamaプロファイル"
                                              style:UIAlertActionStyleDefault
                                            handler:^(__unused UIAlertAction *action) {
        NKPresentProfileEditor(controller);
    }]];

    [sheet addAction:[UIAlertAction actionWithTitle:@"閉じる"
                                              style:UIAlertActionStyleCancel
                                            handler:nil]];

    UIPopoverPresentationController *popover = sheet.popoverPresentationController;
    if (popover) {
        popover.sourceView = sender;
        popover.sourceRect = sender.bounds;
    }

    [controller presentViewController:sheet animated:YES completion:nil];
}

static void NKInstallButtonIfNeeded(void) {
    UIViewController *controller = NKTopViewController();
    if (!NKIsComposerController(controller)) {
        return;
    }

    if (objc_getAssociatedObject(controller, kNKNekamaButtonKey)) {
        return;
    }

    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.accessibilityLabel = @"X-Nekama";
    button.layer.cornerRadius = 22.0;
    button.layer.masksToBounds = YES;
    button.backgroundColor = UIColor.labelColor;
    [button setTitle:@"N" forState:UIControlStateNormal];
    [button setTitleColor:UIColor.systemBackgroundColor forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:17 weight:UIFontWeightBold];
    [button addTarget:nil action:@selector(nk_openNekamaMenu:) forControlEvents:UIControlEventTouchUpInside];

    [controller.view addSubview:button];

    UILayoutGuide *safeArea = controller.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [button.widthAnchor constraintEqualToConstant:44.0],
        [button.heightAnchor constraintEqualToConstant:44.0],
        [button.trailingAnchor constraintEqualToAnchor:safeArea.trailingAnchor constant:-14.0],
        [button.bottomAnchor constraintEqualToAnchor:safeArea.bottomAnchor constant:-82.0]
    ]];

    objc_setAssociatedObject(controller, kNKNekamaButtonKey, button, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

%hook UIViewController

- (void)viewDidAppear:(BOOL)animated {
    %orig;

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.20 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        NKInstallButtonIfNeeded();
    });
}

%new
- (void)nk_openNekamaMenu:(UIButton *)sender {
    NKPresentMenu(sender);
}

%end
