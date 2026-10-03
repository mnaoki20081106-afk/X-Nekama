#pragma once
#import <Foundation/Foundation.h>
#import <objc/runtime.h>

// Runtime lists include NSProxy, Swift roots and third-party root classes.
// Inspect metadata without sending NSObject class methods to those roots.
static inline BOOL NXClassInheritsFrom(Class cls, Class base) {
    if (!base) return NO;
    for (Class current = cls; current; current = class_getSuperclass(current)) {
        if (current == base) return YES;
    }
    return NO;
}

// Each hook closes over its own original IMP. Looking it up using the receiver's
// dynamic class recurses when an overridden method calls the hooked superclass.
static inline BOOL NXHookVoidBoolMethod(Class cls, SEL selector,
                                       void (^after)(id, BOOL)) {
    Method method = class_getInstanceMethod(cls, selector);
    if (!method) return NO;
    IMP original = method_getImplementation(method);
    IMP replacement = imp_implementationWithBlock(^(id object, BOOL flag) {
        ((void (*)(id, SEL, BOOL))original)(object, selector, flag);
        after(object, flag);
    });
    if (!class_addMethod(cls, selector, replacement, method_getTypeEncoding(method))) {
        method_setImplementation(method, replacement);
    }
    return YES;
}
