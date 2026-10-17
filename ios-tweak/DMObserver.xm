#import "RiriCoreClient.h"
#import <objc/runtime.h>

@interface DMSender : NSObject
+ (void)sendReply:(NSString *)text toConversation:(NSString *)conversationId;
@end

@implementation DMSender
+ (void)sendReply:(NSString *)text toConversation:(NSString *)conversationId {
    if (!text.length) return;
    // 簡易スタブ：XのDM送信エンドポイントを仮定
    // 実際のURL・トークンは実機確認が必要
    NSString *urlString = [NSString stringWithFormat:@"https://api.x.com/1.1/dm/conversations/%@/messages.json", conversationId ?: @"unknown"];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:[NSURL URLWithString:urlString]];
    req.HTTPMethod = @"POST";
    [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    // 認証ヘッダーは既存のセッションから取る必要がある
    NSDictionary *body = @{@"text": text};
    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];

    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        if (err) {
            NSLog(@"[DMSender] send failed: %@", err);
        } else {
            NSLog(@"[DMSender] send attempted: %@", text);
        }
    }] resume];
}
@end

%hook NSURLSession

- (NSURLSessionDataTask *)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(void (^)(NSData *, NSURLResponse *, NSError *))completionHandler {
    NSString *url = request.URL.absoluteString;
    BOOL isDM = [url containsString:@"/dm/"] || [url containsString:@"direct_message"] || [url containsString:@"conversation"];

    if (!isDM) return %orig;

    void (^wrapped)(NSData *, NSURLResponse *, NSError *) = ^(NSData *data, NSURLResponse *response, NSError *error) {
        if (data && !error) {
            NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
            NSString *text = nil;
            NSString *convId = nil;
            if ([json isKindOfClass:NSDictionary.class]) {
                text = json[@"text"] ?: json[@"message"][@"text"];
                convId = json[@"conversation_id"] ?: json[@"id"];
            }
            if (text.length) {
                [[RiriCoreClient shared] requestReplyForText:text authorId:convId ?: @"dm" completion:^(NSString *reply, BOOL delayed) {
                    if (reply.length && !delayed) {
                        [DMSender sendReply:reply toConversation:convId];
                    }
                }];
            }
        }
        if (completionHandler) completionHandler(data, response, error);
    };

    return %orig(request, wrapped);
}

%end
