#import "../SessionHook.h"
#include <assert.h>

static int parents, children, observations, guards;
@interface NXTestDataTask : NSObject
@property(nonatomic, copy) NXDataCompletion completion;
@end
@implementation NXTestDataTask
@end
@interface NXTestSession : NSObject
- (id)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(NXDataCompletion)completion;
@end
@implementation NXTestSession
- (id)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(NXDataCompletion)completion {
    ++parents;
    NXTestDataTask *task = [NXTestDataTask new];
    task.completion = completion;
    return task;
}
@end
@interface NXChildSession : NXTestSession
@end
@implementation NXChildSession
- (id)dataTaskWithRequest:(NSURLRequest *)request completionHandler:(NXDataCompletion)completion {
    ++children;
    return [super dataTaskWithRequest:request completionHandler:completion];
}
@end
@interface NXInheritedSession : NXTestSession
@end
@implementation NXInheritedSession
@end

int main(void) {
    @autoreleasepool {
        NSData *payload = [@"result" dataUsingEncoding:NSUTF8StringEncoding];
        NSError *failure = [NSError errorWithDomain:@"test" code:7 userInfo:nil];
        NSURLRequest *request = [NSURLRequest requestWithURL:[NSURL URLWithString:@"https://example.invalid/"]];
        void (^observe)(id, NSData *, NSError *) = ^(id task, NSData *data, NSError *error) {
            assert([task isKindOfClass:NXTestDataTask.class]);
            assert(data == payload && error == failure);
            ++observations;
        };
        void (^guard)(id) = ^(id task) { assert(task); ++guards; };
        assert(NXHookDataTaskFactory(NXTestSession.class, observe, guard));
        assert(NXHookDataTaskFactory(NXChildSession.class, observe, guard));
        __block int completions = 0;
        NXTestDataTask *task = [[NXChildSession new] dataTaskWithRequest:request completionHandler:^(NSData *data, NSURLResponse *response, NSError *error) {
            assert(data == payload && error == failure && response == nil);
            ++completions;
        }];
        assert(parents == 1 && children == 1 && guards == 2);
        task.completion(payload, nil, failure);
        assert(completions == 1 && observations == 2);

        NXTestDataTask *delegateTask = [[NXChildSession new] dataTaskWithRequest:request completionHandler:nil];
        assert(delegateTask.completion == nil);
        assert(parents == 2 && children == 2 && guards == 4);
        assert(observations == 2 && completions == 1);

        assert(NXHookDataTaskFactory(NXInheritedSession.class, observe, guard));
        NXTestDataTask *inherited = [[NXInheritedSession new] dataTaskWithRequest:request completionHandler:nil];
        assert(inherited.completion == nil && guards == 6 && parents == 3);
        // Installing an inherited method must not replace the parent's own hook.
        [[NXTestSession new] dataTaskWithRequest:request completionHandler:nil];
        assert(guards == 7 && parents == 4);
        puts("Session superclass hooks, nil completion and response forwarding tests passed");
    }
    return 0;
}
