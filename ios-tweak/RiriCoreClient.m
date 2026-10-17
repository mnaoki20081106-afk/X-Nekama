#import "RiriCoreClient.h"

@implementation RiriCoreClient

+ (instancetype)shared {
    static RiriCoreClient *instance;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ instance = [self new]; });
    return instance;
}

- (void)requestReplyForText:(NSString *)text authorId:(NSString *)authorId completion:(void (^)(NSString *reply, BOOL delayed))completion {
    NSString *urlString = [[NSUserDefaults standardUserDefaults] stringForKey:@"RiriCoreURL"];
    if (!urlString.length) {
        if (completion) completion(nil, NO);
        return;
    }
    NSURL *url = [NSURL URLWithString:[urlString stringByAppendingString:@"/reply"]];
    NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:url];
    req.HTTPMethod = @"POST";
    [req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
    NSDictionary *body = @{@"text": text ?: @"", @"author_id": authorId ?: @""};
    req.HTTPBody = [NSJSONSerialization dataWithJSONObject:body options:0 error:nil];

    [[[NSURLSession sharedSession] dataTaskWithRequest:req completionHandler:^(NSData *data, NSURLResponse *res, NSError *err) {
        if (err || !data) {
            if (completion) completion(nil, NO);
            return;
        }
        NSDictionary *json = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        NSString *reply = json[@"reply"];
        BOOL delayed = [json[@"delayed"] boolValue];
        if (completion) completion(reply, delayed);
    }] resume];
}

@end
