#import <Foundation/Foundation.h>
#ifdef __cplusplus
extern "C" {
#endif
void RiriStartSetup(void);
NSDictionary *RiriConnection(void);
NSURLSession *RiriSession(void);
void RiriSetHookAvailable(BOOL available);

#ifdef __cplusplus
}
#endif
