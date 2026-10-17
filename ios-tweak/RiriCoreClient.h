#pragma once
#import <Foundation/Foundation.h>

@interface RiriCoreClient : NSObject
+ (instancetype)shared;
- (void)requestReplyForText:(NSString *)text authorId:(NSString *)authorId completion:(void (^)(NSString *reply, BOOL delayed))completion;
@end
