#import "../RuntimeSafety.h"
#include <assert.h>

static int parentCalls, childCalls, parentHooks, childHooks;
@interface NXTestParent : NSObject
- (void)appear:(BOOL)animated;
@end
@implementation NXTestParent
- (void)appear:(BOOL)animated { assert(animated); ++parentCalls; }
@end
@interface NXTestChild : NXTestParent
@end
@implementation NXTestChild
- (void)appear:(BOOL)animated { ++childCalls; [super appear:animated]; }
@end
@interface NXTestInherited : NXTestParent
@end
@implementation NXTestInherited
@end

int main(void) {
    @autoreleasepool {
        // A valid ObjC root need not implement NSObject's class messages.
        Class root = objc_allocateClassPair(Nil, "NXForeignRuntimeRoot", 0);
        objc_registerClassPair(root);
        assert(!class_getClassMethod(root, @selector(isSubclassOfClass:)));
        assert(!NXClassInheritsFrom(root, NSObject.class));
        assert(!NXClassInheritsFrom(NSProxy.class, NSObject.class));
        assert(NXClassInheritsFrom(NXTestChild.class, NXTestParent.class));
        assert(!NXClassInheritsFrom(Nil, NSObject.class));
        assert(!NXClassInheritsFrom(NSObject.class, Nil));

        unsigned int count = 0;
        Class *classes = objc_copyClassList(&count);
        assert(classes && count);
        for (unsigned int i = 0; i < count; ++i) {
            (void)NXClassInheritsFrom(classes[i], NXTestParent.class);
        }
        free(classes);

        assert(NXHookVoidBoolMethod(NXTestParent.class, @selector(appear:), ^(id object, BOOL flag) {
            assert(flag); ++parentHooks;
        }));
        assert(NXHookVoidBoolMethod(NXTestChild.class, @selector(appear:), ^(id object, BOOL flag) {
            assert(flag); ++childHooks;
        }));
        [[NXTestChild new] appear:YES];
        assert(parentCalls == 1 && childCalls == 1);
        assert(parentHooks == 1 && childHooks == 1);

        assert(NXHookVoidBoolMethod(NXTestInherited.class, @selector(appear:), ^(id object, BOOL flag) {
            ++childHooks;
        }));
        [[NXTestInherited new] appear:YES];
        [[NXTestParent new] appear:YES];
        assert(parentCalls == 3 && childCalls == 1);
        assert(parentHooks == 3 && childHooks == 2);
        puts("Runtime root scan and superclass hook tests passed");
    }
    return 0;
}
