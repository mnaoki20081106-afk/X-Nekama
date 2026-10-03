#pragma once
#import "RuntimeSafety.h"

typedef void (^NXDataCompletion)(NSData *, NSURLResponse *, NSError *);

// Preserve the original implementation per installed class, including super
// calls and requests that rely on delegate delivery instead of a completion.
static inline BOOL NXHookDataTaskFactory(Class cls,
                                        void (^observe)(id, NSData *, NSError *),
                                        void (^guard)(id)) {
    SEL selector = @selector(dataTaskWithRequest:completionHandler:);
    Method method = class_getInstanceMethod(cls, selector);
    if (!method) return NO;
    IMP original = method_getImplementation(method);
    if (!original) return NO;
    IMP replacement = imp_implementationWithBlock(^(id session, NSURLRequest *request, NXDataCompletion completion) {
        __block __weak id weakTask;
        NXDataCompletion wrapped = nil;
        if (completion) {
            wrapped = ^(NSData *data, NSURLResponse *response, NSError *error) {
                observe(weakTask, data, error);
                completion(data, response, error);
            };
        }
        id task = ((id (*)(id, SEL, id, NXDataCompletion))original)(session, selector, request, wrapped);
        weakTask = task;
        guard(task);
        return task;
    });
    if (!class_addMethod(cls, selector, replacement, method_getTypeEncoding(method))) {
        method_setImplementation(method, replacement);
    }
    return YES;
}
