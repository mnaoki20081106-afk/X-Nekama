#import <UIKit/UIKit.h>
void RiriCloudflareBegin(UIViewController *presenter, NSString *ownID, void (^completion)(NSDictionary *, NSString *));
void RiriCloudflareTokenBegin(UIViewController *presenter, NSString *ownID, NSString *token, void (^completion)(NSDictionary *, NSString *));
