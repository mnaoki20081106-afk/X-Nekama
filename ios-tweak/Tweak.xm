#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <objc/message.h>
#import <mach-o/dyld.h>

static const void *kNXButtonKey = &kNXButtonKey;
static const void *kNXHelperKey = &kNXHelperKey;
static NSMutableDictionary<NSString *, NSValue *> *NXOriginalViewDidAppear;
static NSMutableSet<NSString *> *NXHookedClasses;

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

    return [NSString stringWithFormat:
        @"X %@ (%@)\nComposer: %@\n\nGrok Imagine\nButton class: %@\nToolbar class: %@\nPresentationManager: %@\nVisible native button: %@\n\nNative postComposerTextGen:\n%@\n\nNative postComposerImageGen:\n%@\n\nNative postComposerImageGenWithPrompt:\n%@\n\nAttachment delegate classes:\n%@\n\nPrompt delegate classes:\n%@",
        version, build, NSStringFromClass(composer.class),
        imagineButton ? @"YES" : @"NO",
        imagineToolbar ? @"YES" : @"NO",
        imagineManager ? @"YES" : @"NO",
        visibleImagine ? NXClassName(visibleImagine) : @"none",
        textGenClasses.count ? [textGenClasses componentsJoinedByString:@"\n"] : @"none",
        imageGenClasses.count ? [imageGenClasses componentsJoinedByString:@"\n"] : @"none",
        imagePromptClasses.count ? [imagePromptClasses componentsJoinedByString:@"\n"] : @"none",
        attachmentDelegates.count ? [attachmentDelegates componentsJoinedByString:@"\n"] : @"none",
        promptDelegates.count ? [promptDelegates componentsJoinedByString:@"\n"] : @"none"];
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
@end

@implementation NXNekamaHelper

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
                                            message:@"X内蔵Grokを優先して利用します"
                                     preferredStyle:UIAlertControllerStyleActionSheet];

    [menu addAction:[UIAlertAction actionWithTitle:@"Grokで投稿文を作る"
                                             style:UIAlertActionStyleDefault
                                           handler:^(__unused UIAlertAction *action) {
        [self openNativeTextGeneration];
    }]];

    [menu addAction:[UIAlertAction actionWithTitle:@"Grokで画像を作る"
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

static IMP NXOriginalIMPForObject(id object) {
    for (Class cls = object_getClass(object); cls; cls = class_getSuperclass(cls)) {
        NSValue *value = NXOriginalViewDidAppear[NSStringFromClass(cls)];
        if (value) return value.pointerValue;
    }
    return NULL;
}

static void NXComposerViewDidAppear(id self, SEL _cmd, BOOL animated) {
    IMP original = NXOriginalIMPForObject(self);
    if (original && original != (IMP)NXComposerViewDidAppear) {
        ((void (*)(id, SEL, BOOL))original)(self, _cmd, animated);
    }
    if ([self isKindOfClass:UIViewController.class]) {
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
            NXOriginalViewDidAppear[name] = [NSValue valueWithPointer:original];
        } else {
            IMP previous = method_setImplementation(method, (IMP)NXComposerViewDidAppear);
            NXOriginalViewDidAppear[name] = [NSValue valueWithPointer:previous];
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
        for (int i = 0; i < count; i++) NXHookComposerClass(classes[i]);
        free(classes);
    });
}

static void NXImageLoaded(__unused const struct mach_header *header, __unused intptr_t slide) {
    NXInstallHooks();
}

__attribute__((constructor)) static void NXBootstrap(void) {
    @autoreleasepool {
        NXOriginalViewDidAppear = [NSMutableDictionary dictionary];
        NXHookedClasses = [NSMutableSet set];
        _dyld_register_func_for_add_image(NXImageLoaded);
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)),
                       dispatch_get_main_queue(), ^{
            NXInstallHooks();
            NSLog(@"[X-Nekama] runtime bridge loaded");
        });
    }
}
