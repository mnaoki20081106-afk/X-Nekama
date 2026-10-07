#import <Foundation/Foundation.h>
#import <objc/runtime.h>
#include <string.h>
%config(generator=internal);

// Replace only with getters verified for the target app version.
static NSString * const TextGetter = @"text";
static NSString * const SenderGetter = @"sender_id";
static NSString * const MessageGetter = @"messageID";
static NSString * const ConversationGetter = @"conversationID";
#import "RiriSetup.h"

static const char *Unqualified(const char *type) {
    while (*type && strchr("rnNoORV", *type)) ++type;
    return type;
}

// Never interpret an integer/pointer return value as an Objective-C object.
static id ReadObject(id target, NSString *name) {
    SEL sel = NSSelectorFromString(name);
    Method method = target ? class_getInstanceMethod(object_getClass(target), sel) : NULL;
    if (!method) return nil;
    NSMethodSignature *sig = [NSMethodSignature signatureWithObjCTypes:method_getTypeEncoding(method)];
    if (sig.numberOfArguments != 2 || *Unqualified(sig.methodReturnType) != '@') return nil;
    NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
    inv.target = target;
    inv.selector = sel;
    [inv invoke];
    __unsafe_unretained id value = nil;
    [inv getReturnValue:&value];
    return value;
}

static NSString *ReadString(id target, NSString *name) {
    id value = ReadObject(target, name);
    if ([value isKindOfClass:NSString.class]) return [value copy];
    if ([value isKindOfClass:NSNumber.class]) return [value stringValue];
    return nil;
}

static void Forward(id controller, id message) {
    @try {
        NSDictionary *settings=RiriConnection();
        if(!settings) return;
        NSString *text = ReadString(message, TextGetter);
        NSString *sender = ReadString(message, SenderGetter);
        NSString *messageID = ReadString(message, MessageGetter);
        // Existing bridge deduplicates by message_id: do not post an empty ID.
        if (!text.length || !sender.length || !messageID.length) {
            NSLog(@"[RiriDM] skipped: required getter missing, wrong type, or empty");
            return;
        }
        NSDictionary *body = @{
            @"text": text, @"sender_id": sender, @"message_id": messageID,
            @"conversation_id": ReadString(controller, ConversationGetter) ?: @"",
            @"timestamp_ms": @((long long)(NSDate.date.timeIntervalSince1970 * 1000))
        };
        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:body options:0 error:&error];
        if (!json) { NSLog(@"[RiriDM] JSON encoding failed"); return; }
        NSMutableURLRequest *request = [NSMutableURLRequest
            requestWithURL:[NSURL URLWithString:[settings[@"origin"] stringByAppendingString:@"/ingest"]]
            cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:10];
        request.HTTPMethod = @"POST";
        request.HTTPBody = json;
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        [request setValue:settings[@"secret"] forHTTPHeaderField:@"X-Bot-Secret"];
        [[RiriSession() dataTaskWithRequest:request
            completionHandler:^(NSData *data, NSURLResponse *response, NSError *err) {
                if (err) { NSLog(@"[RiriDM] POST failed: code=%ld", (long)err.code); return; }
                if (![response isKindOfClass:NSHTTPURLResponse.class]) return;
                NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
                NSLog(@"[RiriDM] POST status=%ld", (long)status);
            }] resume];
    } @catch (NSException *exception) {
        NSLog(@"[RiriDM] extraction failed: %@", exception.name);
    }
}

%group RiriReceive
%hook DMConversationViewController
- (void)directMessageReceived:(id)message {
    %orig;
    Forward(self, message);
}
%end
%end

%ctor {
    @autoreleasepool {
        RiriStartSetup();
        Class cls = NSClassFromString(@"DMConversationViewController");
        Method method = cls ? class_getInstanceMethod(cls, NSSelectorFromString(@"directMessageReceived:")) : NULL;
        if (!method) { NSLog(@"[RiriDM] hook disabled: class/method absent"); return; }
        NSMethodSignature *sig = [NSMethodSignature signatureWithObjCTypes:method_getTypeEncoding(method)];
        if (sig.numberOfArguments != 3 || strcmp(Unqualified(sig.methodReturnType), "v") ||
            *Unqualified([sig getArgumentTypeAtIndex:2]) != '@') {
            NSLog(@"[RiriDM] hook disabled: incompatible signature"); return;
        }
        %init(RiriReceive);
        RiriSetHookAvailable(YES);
        NSLog(@"[RiriDM] receive hook installed");
    }
}
