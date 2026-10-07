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

// Only call the explicitly named route when its runtime signature and conversation match.
// "submitted" means the app method returned, not server-confirmed delivery.
static void Deliver(id controller, NSDictionary *settings, NSString *messageID, NSString *conversationID) {
    NSDictionary *payload=@{@"message_id":messageID,@"conversation_id":conversationID};
    NSMutableURLRequest *claim=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[settings[@"origin"] stringByAppendingString:@"/claim"]]];
    claim.HTTPMethod=@"POST";claim.HTTPBody=[NSJSONSerialization dataWithJSONObject:payload options:0 error:NULL];
    [claim setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];[claim setValue:settings[@"secret"] forHTTPHeaderField:@"X-Bot-Secret"];
    __weak id weakController=controller;
    [[RiriSession() dataTaskWithRequest:claim completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        if(error||![response isKindOfClass:NSHTTPURLResponse.class]||((NSHTTPURLResponse *)response).statusCode!=200) return;
        NSError *parse=nil;id result=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:&parse]:nil;
        if(![result isKindOfClass:NSDictionary.class]||![result[@"reply"] isKindOfClass:NSString.class]) return;
        NSString *reply=result[@"reply"];if(!reply.length||reply.length>4000) return;
        dispatch_async(dispatch_get_main_queue(), ^{
            id target=weakController;NSString *state=@"unsupported";
            @try {
                SEL selector=NSSelectorFromString(@"sendMessageWithText:attachment:");
                Method method=target?class_getInstanceMethod(object_getClass(target),selector):NULL;
                NSMethodSignature *sig=method?[NSMethodSignature signatureWithObjCTypes:method_getTypeEncoding(method)]:nil;
                if([ReadString(target,ConversationGetter) isEqualToString:conversationID]&&sig.numberOfArguments==4&&!strcmp(Unqualified(sig.methodReturnType),"v")&&*Unqualified([sig getArgumentTypeAtIndex:2])=='@'&&*Unqualified([sig getArgumentTypeAtIndex:3])=='@') {
                    NSInvocation *inv=[NSInvocation invocationWithMethodSignature:sig];inv.target=target;inv.selector=selector;
                    id text=reply,attachment=nil;[inv setArgument:&text atIndex:2];[inv setArgument:&attachment atIndex:3];[inv invoke];state=@"submitted";
                }
            } @catch(NSException *e) {state=@"uncertain";}
            NSLog(@"[RiriDM] native submission status=%@",state);
            NSMutableURLRequest *ack=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[settings[@"origin"] stringByAppendingString:@"/ack"]]];
            ack.HTTPMethod=@"POST";ack.HTTPBody=[NSJSONSerialization dataWithJSONObject:@{@"message_id":messageID,@"status":state} options:0 error:NULL];
            [ack setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];[ack setValue:settings[@"secret"] forHTTPHeaderField:@"X-Bot-Secret"];
            [[RiriSession() dataTaskWithRequest:ack] resume];
        });
    }] resume];
}

static void Forward(id controller, id message) {
    @try {
        NSDictionary *settings=RiriConnection();
        if(!settings) return;
        NSString *text = ReadString(message, TextGetter);
        NSString *sender = ReadString(message, SenderGetter);
        NSString *messageID = ReadString(message, MessageGetter);
        NSString *convID = ReadString(controller, ConversationGetter);
        if([sender isEqualToString:settings[@"own_user_id"]]) return;
        // Existing bridge deduplicates by message_id: do not post an empty ID.
        if (!text.length || !sender.length || !messageID.length || !convID.length) {
            NSLog(@"[RiriDM] skipped: required getter missing, wrong type, or empty");
            return;
        }
        NSDictionary *body = @{
            @"text": text, @"sender_id": sender, @"message_id": messageID,
            @"conversation_id": convID,
            @"timestamp_ms": @((long long)(NSDate.date.timeIntervalSince1970 * 1000))
        };
        NSError *error = nil;
        NSData *json = [NSJSONSerialization dataWithJSONObject:body options:0 error:&error];
        if (!json) { NSLog(@"[RiriDM] JSON encoding failed"); return; }
        NSMutableURLRequest *request = [NSMutableURLRequest
            requestWithURL:[NSURL URLWithString:[settings[@"origin"] stringByAppendingString:@"/ingest"]]
            cachePolicy:NSURLRequestReloadIgnoringLocalCacheData timeoutInterval:90];
        request.HTTPMethod = @"POST";
        request.HTTPBody = json;
        [request setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];
        [request setValue:settings[@"secret"] forHTTPHeaderField:@"X-Bot-Secret"];
        __weak id weakController=controller;
        [[RiriSession() dataTaskWithRequest:request
            completionHandler:^(NSData *data, NSURLResponse *response, NSError *err) {
                if (err) { NSLog(@"[RiriDM] POST failed: code=%ld", (long)err.code); return; }
                if (![response isKindOfClass:NSHTTPURLResponse.class]) return;
                NSInteger status = ((NSHTTPURLResponse *)response).statusCode;
                NSLog(@"[RiriDM] POST status=%ld", (long)status);
                if(status==200&&data) {
                    NSError *parse=nil;id result=[NSJSONSerialization JSONObjectWithData:data options:0 error:&parse];
                    if([result isKindOfClass:NSDictionary.class]&&[result[@"status"] isEqual:@"draft"]&&weakController)
                        Deliver(weakController,settings,messageID,convID);
                }
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
