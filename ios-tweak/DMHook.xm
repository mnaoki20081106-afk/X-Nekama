#import "RiriCoreClient.h"
#import <objc/runtime.h>

// DM受信フックスタブ（クラス名はバージョン依存）
%hook T1DirectMessageConversationViewController

- (void)didReceiveMessage:(id)message {
    %orig;
    NSString *text = nil;
    if ([message respondsToSelector:@selector(text)]) {
        text = [message valueForKey:@"text"];
    }
    if (!text.length) return;

    NSString *authorId = @"unknown";
    if ([message respondsToSelector:@selector(senderID)]) {
        authorId = [[message valueForKey:@"senderID"] description];
    }

    [[RiriCoreClient shared] requestReplyForText:text authorId:authorId completion:^(NSString *reply, BOOL delayed) {
        if (!reply.length || delayed) return;
        // 返信送信は別途実装が必要（Composerを開くなど）
        NSLog(@"[RiriCore] reply ready: %@", reply);
    }];
}

%end
