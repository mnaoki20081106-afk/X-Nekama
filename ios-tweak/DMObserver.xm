#import "RiriCoreClient.h"
#import <objc/runtime.h>

// NSURLSessionをフックしてDM関連の通信を観測
%hook NSURLSession

- (NSURLSessionDataTask *)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(void (^)(NSData *, NSURLResponse *, NSError *))completionHandler {
    NSString *url = request.URL.absoluteString;
    BOOL isDM = [url containsString:@"/dm/"] || [url containsString:@"direct_message"] || [url containsString:@"conversation"];

    if (!isDM) return %orig;

    void (^wrapped)(NSData *, NSURLResponse *, NSError *) = ^(NSData *data, NSURLResponse *response, NSError *error) {
        if (data && !error) {
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            // 簡易的なテキスト抽出（実際の応答形に合わせて調整が必要）
            NSString *text = nil;
            if ([json isKindOfClass:NSDictionary.class]) {
                text = json[@"text"] ?: json[@"message"][@"text"];
            }
            if (text.length) {
                [[RiriCoreClient shared] requestReplyForText:text authorId:@"dm" completion:^(NSString *reply, BOOL delayed) {
                    if (reply.length && !delayed) {
                        NSLog(@"[DMObserver] RiriCore reply: %@", reply);
                        // 返信送信は別途実装
                    }
                }];
            }
        }
        if (completionHandler) completionHandler(data, response, error);
    };

    return %orig(request, wrapped);
}

%end
