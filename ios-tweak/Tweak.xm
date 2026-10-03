#import <UIKit/UIKit.h>
#import <SafariServices/SafariServices.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <mach-o/dyld.h>
#import "Autopilot.h"
#import "VPNGate.h"
#import "ServerManager.h"
#include <string.h>

static const void *kNXButtonKey = &kNXButtonKey;
static const void *kNXHelperKey = &kNXHelperKey;
static NSMutableDictionary<NSString *, NSValue *> *NXOriginalViewDidAppear;
static NSMutableSet<NSString *> *NXHookedClasses;
static NSMutableDictionary<NSString *, NSValue *> *NXOriginalGrokAttachmentDidAdd;
static NSMutableSet<NSString *> *NXHookedGrokAttachmentClasses;
static NSString *NXLastGrokAttachmentEvent;
static NSString * const NXGrokAttachmentNotification =
    @"com.xnekama.grokImagineAttachmentDidAdd";

static NSString *NXClassName(id object) {
    return object ? NSStringFromClass(object_getClass(object)) : @"";
}

static BOOL NXAnyClassExists(NSArray<NSString *> *names) {
    for (NSString *name in names) if (NSClassFromString(name)) return YES;
    return NO;
}

static BOOL NXLooksLikeComposerClass(Class cls) {
    if (!cls || ![cls isSubclassOfClass:UIViewController.class]) return NO;
    NSString *name = NSStringFromClass(cls);
    if ([name containsString:@"ComposerThreadViewController"] ||
        [name containsString:@"TweetCompose"] ||
        [name containsString:@"ComposeSingleTweet"]) {
        return YES;
    }

    Protocol *singleTweet = objc_getProtocol("_TtP15TwitterComposer45TweetComposeSingleTweetViewControllerProtocol_");
    return singleTweet && class_conformsToProtocol(cls, singleTweet);
}

static UIViewController *NXPresenter(UIViewController *controller) {
    UIViewController *presenter = controller;
    while (presenter.presentedViewController && !presenter.presentedViewController.isBeingDismissed) {
        presenter = presenter.presentedViewController;
    }
    return presenter;
}

static UIControl *NXFindImagineControl(UIView *view) {
    if (!view) return nil;
    NSString *name = NXClassName(view);
    if ([view isKindOfClass:UIControl.class] &&
        ([name containsString:@"GrokImagineComposerButton"] ||
         [name containsString:@"GrokImagineComposerToolbarButton"])) {
        return (UIControl *)view;
    }
    for (UIView *subview in view.subviews) {
        UIControl *control = NXFindImagineControl(subview);
        if (control) return control;
    }
    return nil;
}

static BOOL NXControlHasActionToken(UIControl *control, UIControlEvents event, NSString *token) {
    NSString *needle = token.lowercaseString;
    for (id target in control.allTargets) {
        NSArray<NSString *> *actions = [control actionsForTarget:target forControlEvent:event];
        for (NSString *action in actions) {
            if ([action.lowercaseString containsString:needle]) return YES;
        }
    }
    return NO;
}

static UIControl *NXFindControlWithActionToken(UIView *view, NSString *token, UIControlEvents *eventOut) {
    if (!view) return nil;
    if ([view isKindOfClass:UIControl.class]) {
        UIControl *control = (UIControl *)view;
        if (NXControlHasActionToken(control, UIControlEventTouchUpInside, token)) {
            if (eventOut) *eventOut = UIControlEventTouchUpInside;
            return control;
        }
        if (@available(iOS 14.0, *)) {
            if (NXControlHasActionToken(control, UIControlEventPrimaryActionTriggered, token)) {
                if (eventOut) *eventOut = UIControlEventPrimaryActionTriggered;
                return control;
            }
        }
    }
    for (UIView *subview in view.subviews) {
        UIControl *control = NXFindControlWithActionToken(subview, token, eventOut);
        if (control) return control;
    }
    return nil;
}

static BOOL NXTriggerControlAction(UIViewController *composer, NSString *token) {
    UIControlEvents event = 0;
    UIControl *control = NXFindControlWithActionToken(composer.view, token, &event);
    if (!control || event == 0) return NO;
    [control sendActionsForControlEvents:event];
    NSLog(@"[X-Nekama] triggered native control %@ for %@", NXClassName(control), token);
    return YES;
}

static NSArray<NSString *> *NXClassesImplementingSelector(SEL selector) {
    int count = objc_getClassList(NULL, 0);
    if (count <= 0) return @[];
    Class *classes = (__unsafe_unretained Class *)calloc((size_t)count, sizeof(Class));
    count = objc_getClassList(classes, count);
    NSMutableArray<NSString *> *matches = [NSMutableArray array];
    for (int i = 0; i < count; i++) {
        Class cls = classes[i];
        if (class_getInstanceMethod(cls, selector)) {
            NSString *name = NSStringFromClass(cls);
            if ([name containsString:@"Twitter"] || [name containsString:@"Grok"] ||
                [name containsString:@"Compose"] || [name hasPrefix:@"T1"]) {
                [matches addObject:name];
            }
        }
    }
    free(classes);
    return matches;
}

static IMP NXStoredIMPForObject(
    id object,
    NSDictionary<NSString *, NSValue *> *implementations
) {
    for (Class cls = object_getClass(object); cls; cls = class_getSuperclass(cls)) {
        NSValue *value = implementations[NSStringFromClass(cls)];
        if (!value) continue;
        IMP implementation = NULL;
        [value getValue:&implementation size:sizeof(implementation)];
        if (implementation) return implementation;
    }
    return NULL;
}

static Method NXOwnInstanceMethod(Class cls, SEL selector) {
    unsigned int count = 0;
    Method *methods = class_copyMethodList(cls, &count);
    Method result = NULL;
    for (unsigned int i = 0; i < count; i++) {
        if (method_getName(methods[i]) == selector) {
            result = methods[i];
            break;
        }
    }
    free(methods);
    return result;
}

static char NXUnqualifiedTypeCode(const char *type) {
    if (!type) return '\0';
    while (*type && strchr("rnNoORV", *type)) type++;
    return *type;
}

static BOOL NXIsExpectedGrokAttachmentCallback(Method method) {
    if (!method || method_getNumberOfArguments(method) != 5) return NO;

    char returnType[32] = {0};
    method_getReturnType(method, returnType, sizeof(returnType));
    if (NXUnqualifiedTypeCode(returnType) != 'v') return NO;

    for (unsigned int index = 2; index < 5; index++) {
        char argumentType[128] = {0};
        method_getArgumentType(method, index, argumentType, sizeof(argumentType));
        if (NXUnqualifiedTypeCode(argumentType) != '@') return NO;
    }
    return YES;
}

static NSString *NXRuntimeReport(UIViewController *composer) {
    NSBundle *bundle = NSBundle.mainBundle;
    NSString *version = [bundle objectForInfoDictionaryKey:@"CFBundleShortVersionString"] ?: @"?";
    NSString *build = [bundle objectForInfoDictionaryKey:@"CFBundleVersion"] ?: @"?";
    BOOL imagineButton = NXAnyClassExists(@[@"Grok.GrokImagineComposerButton", @"_TtC4Grok25GrokImagineComposerButton"]);
    BOOL imagineToolbar = NXAnyClassExists(@[@"Grok.GrokImagineComposerToolbarButton", @"_TtC4Grok32GrokImagineComposerToolbarButton"]);
    BOOL imagineManager = NXAnyClassExists(@[@"Grok.GrokImaginePresentationManager", @"_TtC4Grok30GrokImaginePresentationManager"]);
    UIControl *visibleImagine = NXFindImagineControl(composer.view);

    NSArray *attachmentDelegates =
        NXClassesImplementingSelector(NSSelectorFromString(@"grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:"));
    NSArray *promptDelegates =
        NXClassesImplementingSelector(NSSelectorFromString(@"grokImagineComposePromptInputDidSubmit:"));
    NSArray *textGenClasses =
        NXClassesImplementingSelector(NSSelectorFromString(@"postComposerTextGen"));
    NSArray *imageGenClasses =
        NXClassesImplementingSelector(NSSelectorFromString(@"postComposerImageGen"));
    NSArray *imagePromptClasses =
        NXClassesImplementingSelector(NSSelectorFromString(@"postComposerImageGenWithPrompt"));

    NSString *lastAttachment = NXLastGrokAttachmentEvent.length
        ? NXLastGrokAttachmentEvent
        : @"none";

    return [NSString stringWithFormat:
        @"X %@ (%@)\nComposer: %@\n\nGrok Imagine\nButton class: %@\nToolbar class: %@\nPresentationManager: %@\nVisible native button: %@\n\nNative postComposerTextGen:\n%@\n\nNative postComposerImageGen:\n%@\n\nNative postComposerImageGenWithPrompt:\n%@\n\nAttachment delegate classes:\n%@\n\nPrompt delegate classes:\n%@\n\nLast observed Grok attachment:\n%@",
        version, build, NSStringFromClass(composer.class),
        imagineButton ? @"YES" : @"NO",
        imagineToolbar ? @"YES" : @"NO",
        imagineManager ? @"YES" : @"NO",
        visibleImagine ? NXClassName(visibleImagine) : @"none",
        textGenClasses.count ? [textGenClasses componentsJoinedByString:@"\n"] : @"none",
        imageGenClasses.count ? [imageGenClasses componentsJoinedByString:@"\n"] : @"none",
        imagePromptClasses.count ? [imagePromptClasses componentsJoinedByString:@"\n"] : @"none",
        attachmentDelegates.count ? [attachmentDelegates componentsJoinedByString:@"\n"] : @"none",
        promptDelegates.count ? [promptDelegates componentsJoinedByString:@"\n"] : @"none",
        lastAttachment];
}

static void NXOpenGrokWithPrompt(NSString *prompt) {
    if (!prompt.length) return;
    NSCharacterSet *allowed = [NSCharacterSet URLQueryAllowedCharacterSet];
    NSString *escaped = [prompt stringByAddingPercentEncodingWithAllowedCharacters:allowed];
    NSURL *url =
        [NSURL URLWithString:[NSString stringWithFormat:@"https://www.x.com/i/grok?text=%@", escaped ?: @""]];
    if (!url) return;
    dispatch_async(dispatch_get_main_queue(), ^{
        [[UIApplication sharedApplication] openURL:url options:@{} completionHandler:nil];
    });
}

@interface NXNekamaHelper : NSObject
@property(nonatomic, weak) UIViewController *composer;
@property(nonatomic, weak) UINavigationController *notificationNavigation;
- (void)openNotificationManagement;
@end

@implementation NXNekamaHelper

- (void)notificationSettingsUnavailable {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"通知設定を開けません"
        message:@"このXの通知設定画面との互換性を確認できませんでした。Xの「設定とプライバシー → 通知 → 設定 → プッシュ通知」から変更してください。設定は変更していません。"
        preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"閉じる" style:UIAlertActionStyleCancel handler:nil]];
    [NXPresenter(self.composer) presentViewController:alert animated:YES completion:nil];
}

- (void)closeNotificationSettings {
    [self.notificationNavigation dismissViewControllerAnimated:YES completion:nil];
}

- (void)openNativeNotificationSettings {
    // Verified against the supplied X 12.29 (20) Objective-C metadata.
    Class cls = NSClassFromString(@"T1UnifiedNotificationsSettingsViewController");
    SEL initSelector = NSSelectorFromString(@"initWithAccount:");
    SEL accountSelector = NSSelectorFromString(@"account");
    Method initMethod = class_getInstanceMethod(cls,initSelector);
    Method accountMethod = class_getInstanceMethod(self.composer.class,accountSelector);
    if (!cls || ![cls isSubclassOfClass:UIViewController.class] || !initMethod || !accountMethod ||
        strcmp(method_getTypeEncoding(initMethod),"@24@0:8@16") != 0 ||
        strcmp(method_getTypeEncoding(accountMethod),"@16@0:8") != 0) {
        [self notificationSettingsUnavailable]; return;
    }
    @try {
        id account = ((id (*)(id,SEL))objc_msgSend)(self.composer,accountSelector);
        if (!account) { [self notificationSettingsUnavailable]; return; }
        UIViewController *settings = ((id (*)(id,SEL,id))objc_msgSend)([cls alloc],initSelector,account);
        UIViewController *presenter = NXPresenter(self.composer);
        if (!settings || !presenter) { [self notificationSettingsUnavailable]; return; }
        UINavigationController *navigation = [[UINavigationController alloc] initWithRootViewController:settings];
        settings.navigationItem.leftBarButtonItem = [[UIBarButtonItem alloc] initWithTitle:@"閉じる" style:UIBarButtonItemStyleDone target:self action:@selector(closeNotificationSettings)];
        navigation.modalPresentationStyle = UIModalPresentationFullScreen;
        self.notificationNavigation = navigation;
        [presenter presentViewController:navigation animated:YES completion:nil];
    } @catch (__unused NSException *exception) {
        [self notificationSettingsUnavailable];
    }
}

- (void)openNotificationManagement {
    UIAlertController *alert = [UIAlertController alertControllerWithTitle:@"通知を管理"
        message:@"交流用のおすすめ設定\n\nON：ダイレクトメッセージ、返信\nOFF：いいね、リポスト、新規フォロワー、おすすめ、ニュース、スペース、フォロー先の投稿通知など\n\n次のX設定画面の「設定 → プッシュ通知」で切り替えてください。「@ポストと返信」が共通の項目ならメンションも残ります。複数アカウントはそれぞれ設定してください。\n\nこの案内を開いただけでは設定は変わりません。X内の通知一覧には影響せず、再署名IPAのプッシュ受信も実機確認が必要です。"
        preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"Xの通知設定を開く" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [self openNativeNotificationSettings];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"iPhoneの通知許可を確認" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        [UIApplication.sharedApplication openURL:[NSURL URLWithString:UIApplicationOpenSettingsURLString] options:@{} completionHandler:nil];
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"閉じる" style:UIAlertActionStyleCancel handler:nil]];
    [NXPresenter(self.composer) presentViewController:alert animated:YES completion:nil];
}

- (void)configureCoreURL {NXServerManagerConnect(NXPresenter(self.composer));}
- (void)openCore {NXAutopilotPauseForServer();NXServerManagerOpen(NXPresenter(self.composer));}

- (void)askForPromptWithTitle:(NSString *)title
                  placeholder:(NSString *)placeholder
                       prefix:(NSString *)prefix {
    UIViewController *presenter = NXPresenter(self.composer);
    if (!presenter) return;
    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:title
                                            message:nil
                                     preferredStyle:UIAlertControllerStyleAlert];
    [alert addTextFieldWithConfigurationHandler:^(UITextField *field) {
        field.placeholder = placeholder;
        field.clearButtonMode = UITextFieldViewModeWhileEditing;
    }];
    [alert addAction:[UIAlertAction actionWithTitle:@"キャンセル"
                                             style:UIAlertActionStyleCancel
                                           handler:nil]];
    [alert addAction:[UIAlertAction actionWithTitle:@"Grokを開く"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        NSString *topic = alert.textFields.firstObject.text ?: @"";
        if (!topic.length) return;
        NXOpenGrokWithPrompt([prefix stringByAppendingString:topic]);
    }]];
    [presenter presentViewController:alert animated:YES completion:nil];
}

- (void)showDiagnostics {
    UIViewController *presenter = NXPresenter(self.composer);
    if (!presenter) return;
    NSString *report = NXRuntimeReport(self.composer);
    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:@"Nekama Runtime"
                                            message:report
                                     preferredStyle:UIAlertControllerStyleAlert];
    [alert addAction:[UIAlertAction actionWithTitle:@"コピー"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        UIPasteboard.generalPasteboard.string = report;
    }]];
    [alert addAction:[UIAlertAction actionWithTitle:@"閉じる"
                                             style:UIAlertActionStyleCancel
                                           handler:nil]];
    [presenter presentViewController:alert animated:YES completion:nil];
}

- (void)openNativeImagine {
    if (NXTriggerControlAction(self.composer, @"postcomposerimagegenwithprompt") ||
        NXTriggerControlAction(self.composer, @"postcomposerimagegen")) {
        return;
    }

    UIControl *control = NXFindImagineControl(self.composer.view);
    if (control) {
        [control sendActionsForControlEvents:UIControlEventTouchUpInside];
        return;
    }

    [self askForPromptWithTitle:@"Grokで画像生成"
                    placeholder:@"作りたい画像を説明"
                         prefix:@"X投稿用の画像を1枚生成してください。次の要件を優先してください。\n"];
}

- (void)openNativeTextGeneration {
    if (NXTriggerControlAction(self.composer, @"postcomposertextgen")) {
        return;
    }

    [self askForPromptWithTitle:@"投稿文を作成"
                    placeholder:@"今日の出来事・投稿テーマ"
                         prefix:@"Xに投稿する自然な日本語の投稿文を1つだけ作ってください。説明や候補一覧は不要です。テーマ: "];
}

- (void)buttonTapped:(UIButton *)sender {
    UIViewController *presenter = NXPresenter(self.composer);
    if (!presenter) return;
    UIAlertController *menu =
        [UIAlertController alertControllerWithTitle:@"Nekama"
                                            message:@"予約日時・お手本・口調・絵文字は投稿予約の管理画面から設定できます。"
                                     preferredStyle:UIAlertControllerStyleActionSheet];

    [menu addAction:[UIAlertAction actionWithTitle:@"端末で文章を生成・運用（前面のみ）"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        NXAutopilotOpen(NXPresenter(self.composer));
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"投稿予約・カレンダー・生成設定"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self openCore];
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"Cloudflare連携・接続先"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self configureCoreURL];
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"通知を管理（DM・返信中心）"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self openNotificationManagement];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"共通VPN出口を設定" style:UIAlertActionStyleDefault handler:^(__unused UIAlertAction *action) {
        NXVPNConfigure(NXPresenter(self.composer));
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"X内蔵Grokで投稿文を作る（実験）"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self openNativeTextGeneration];
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"X内蔵Grokで画像を作る（実験）"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self openNativeImagine];
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"ランタイム診断"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self showDiagnostics];
    }]];
    [menu addAction:[UIAlertAction actionWithTitle:@"キャンセル"
                                             style:UIAlertActionStyleCancel
                                           handler:nil]];

    UIPopoverPresentationController *popover = menu.popoverPresentationController;
    if (popover) {
        popover.sourceView = sender;
        popover.sourceRect = sender.bounds;
    }
    [presenter presentViewController:menu animated:YES completion:nil];
}
@end

static void NXAttachButton(UIViewController *controller) {
    if (!controller.view || objc_getAssociatedObject(controller, kNXButtonKey)) return;

    UIButton *button = [UIButton buttonWithType:UIButtonTypeSystem];
    button.translatesAutoresizingMaskIntoConstraints = NO;
    button.accessibilityIdentifier = @"x-nekama.ai-button";
    button.accessibilityLabel = @"Nekama";
    [button setTitle:@"✦" forState:UIControlStateNormal];
    button.titleLabel.font = [UIFont systemFontOfSize:23 weight:UIFontWeightSemibold];
    button.backgroundColor = [UIColor secondarySystemBackgroundColor];
    button.layer.cornerRadius = 24;
    button.layer.shadowOpacity = 0.18f;
    button.layer.shadowRadius = 8;
    button.layer.shadowOffset = CGSizeMake(0, 3);

    NXNekamaHelper *helper = [NXNekamaHelper new];
    helper.composer = controller;
    [button addTarget:helper action:@selector(buttonTapped:)
     forControlEvents:UIControlEventTouchUpInside];

    [controller.view addSubview:button];
    UILayoutGuide *safe = controller.view.safeAreaLayoutGuide;
    [NSLayoutConstraint activateConstraints:@[
        [button.widthAnchor constraintEqualToConstant:48],
        [button.heightAnchor constraintEqualToConstant:48],
        [button.trailingAnchor constraintEqualToAnchor:safe.trailingAnchor constant:-14],
        [button.bottomAnchor constraintEqualToAnchor:safe.bottomAnchor constant:-74],
    ]];

    objc_setAssociatedObject(controller, kNXButtonKey, button, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    objc_setAssociatedObject(controller, kNXHelperKey, helper, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    NSLog(@"[X-Nekama] attached to composer %@", NSStringFromClass(controller.class));
}

static void NXGrokAttachmentDidAdd(
    id self,
    SEL _cmd,
    id manager,
    id asset,
    id promptObject
) {
    IMP original = NXStoredIMPForObject(self, NXOriginalGrokAttachmentDidAdd);
    if (original && original != (IMP)NXGrokAttachmentDidAdd) {
        ((void (*)(id, SEL, id, id, id))original)(
            self, _cmd, manager, asset, promptObject
        );
    }

    NSString *prompt =
        [promptObject isKindOfClass:NSString.class] ? (NSString *)promptObject : nil;
    NSString *event = [NSString stringWithFormat:
        @"delegate=%@ asset=%@ promptLength=%lu",
        NSStringFromClass([self class]),
        asset ? NSStringFromClass([asset class]) : @"nil",
        (unsigned long)prompt.length
    ];

    @synchronized (NXHookedGrokAttachmentClasses) {
        NXLastGrokAttachmentEvent = event;
    }

    NSMutableDictionary *userInfo = [NSMutableDictionary dictionary];
    userInfo[@"delegateClass"] = NSStringFromClass([self class]);
    userInfo[@"assetClass"] = asset ? NSStringFromClass([asset class]) : @"nil";
    if (prompt) userInfo[@"prompt"] = prompt;

    [[NSNotificationCenter defaultCenter]
        postNotificationName:NXGrokAttachmentNotification
                      object:asset
                    userInfo:userInfo];

    NSLog(@"[X-Nekama] observed Grok attachment: %@", event);
}

static void NXHookGrokAttachmentObserverClass(Class cls) {
    if (!cls) return;

    SEL selector = NSSelectorFromString(
        @"grokImaginePresentationManagerAttachmentDidAdd:asset:withPrompt:"
    );
    Method method = NXOwnInstanceMethod(cls, selector);
    if (!NXIsExpectedGrokAttachmentCallback(method)) return;

    NSString *name = NSStringFromClass(cls);
    @synchronized (NXHookedGrokAttachmentClasses) {
        if ([NXHookedGrokAttachmentClasses containsObject:name]) return;

        IMP current = method_getImplementation(method);
        if (current == (IMP)NXGrokAttachmentDidAdd) {
            [NXHookedGrokAttachmentClasses addObject:name];
            return;
        }

        IMP previous = method_setImplementation(
            method,
            (IMP)NXGrokAttachmentDidAdd
        );
        NXOriginalGrokAttachmentDidAdd[name] =
            [NSValue value:&previous withObjCType:@encode(IMP)];
        [NXHookedGrokAttachmentClasses addObject:name];

        NSLog(@"[X-Nekama] observing Grok attachment callback on %@", name);
    }
}

static IMP NXOriginalIMPForObject(id object) {
    for (Class cls = object_getClass(object); cls; cls = class_getSuperclass(cls)) {
        NSValue *value = NXOriginalViewDidAppear[NSStringFromClass(cls)];
        if (value) {
            IMP original = NULL;
            [value getValue:&original size:sizeof(original)];
            return original;
        }
    }
    return NULL;
}

static void NXComposerViewDidAppear(id self, SEL _cmd, BOOL animated) {
    IMP original = NXOriginalIMPForObject(self);
    if (original && original != (IMP)NXComposerViewDidAppear) {
        ((void (*)(id, SEL, BOOL))original)(self, _cmd, animated);
    }
    if ([self isKindOfClass:UIViewController.class]) {
        NXAutopilotSetComposer((UIViewController *)self);
        NXAttachButton((UIViewController *)self);
    }
}

static void NXHookComposerClass(Class cls) {
    if (!cls || !NXLooksLikeComposerClass(cls)) return;
    NSString *name = NSStringFromClass(cls);
    @synchronized (NXHookedClasses) {
        if ([NXHookedClasses containsObject:name]) return;
        SEL selector = @selector(viewDidAppear:);
        Method method = class_getInstanceMethod(cls, selector);
        if (!method) return;
        IMP original = method_getImplementation(method);
        if (original == (IMP)NXComposerViewDidAppear) {
            [NXHookedClasses addObject:name];
            return;
        }
        const char *types = method_getTypeEncoding(method);
        if (class_addMethod(cls, selector, (IMP)NXComposerViewDidAppear, types)) {
            NXOriginalViewDidAppear[name] = [NSValue value:&original withObjCType:@encode(IMP)];
        } else {
            IMP previous = method_setImplementation(method, (IMP)NXComposerViewDidAppear);
            NXOriginalViewDidAppear[name] = [NSValue value:&previous withObjCType:@encode(IMP)];
        }
        [NXHookedClasses addObject:name];
        NSLog(@"[X-Nekama] hooked composer class %@", name);
    }
}

static void NXInstallHooks(void) {
    dispatch_async(dispatch_get_main_queue(), ^{
        int count = objc_getClassList(NULL, 0);
        if (count <= 0) return;
        Class *classes = (__unsafe_unretained Class *)calloc((size_t)count, sizeof(Class));
        count = objc_getClassList(classes, count);
        for (int i = 0; i < count; i++) {
            NXHookComposerClass(classes[i]);
            NXHookGrokAttachmentObserverClass(classes[i]);
        }
        free(classes);
    });
}

static void NXImageLoaded(__unused const struct mach_header *header, __unused intptr_t slide) {
    NXInstallHooks();
}

__attribute__((constructor)) static void NXBootstrap(void) {
    @autoreleasepool {
        NXAutopilotInstall();
        NXOriginalViewDidAppear = [NSMutableDictionary dictionary];
        NXHookedClasses = [NSMutableSet set];
        NXOriginalGrokAttachmentDidAdd = [NSMutableDictionary dictionary];
        NXHookedGrokAttachmentClasses = [NSMutableSet set];
        _dyld_register_func_for_add_image(NXImageLoaded);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            NXInstallHooks();
            NSLog(@"[X-Nekama] runtime bridge loaded");
        });
    }
}
