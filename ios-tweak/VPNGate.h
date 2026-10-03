#import <UIKit/UIKit.h>
void NXVPNInstall(void);
BOOL NXVPNReady(void);
void NXVPNGuardTask(NSURLSessionTask *task);
void NXVPNConfigure(UIViewController *presenter);
void NXVPNOpenProvider(UIViewController *presenter);
