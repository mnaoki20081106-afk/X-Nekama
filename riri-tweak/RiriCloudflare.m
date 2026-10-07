#import "RiriCloudflare.h"
#import "RiriSetup.h"
#import "RiriOAuthConfig.h"
#import "RiriWorkerSource.h"
#import <AuthenticationServices/AuthenticationServices.h>
#import <Security/Security.h>
#import <CommonCrypto/CommonDigest.h>
#include <string.h>
static NSString *B64(NSData *d) {return [[[d base64EncodedStringWithOptions:0] stringByReplacingOccurrencesOfString:@"+" withString:@"-"] stringByReplacingOccurrencesOfString:@"/" withString:@"_"] stringByReplacingOccurrencesOfString:@"=" withString:@""];}
static NSString *Random(void) {uint8_t b[32];if(SecRandomCopyBytes(kSecRandomDefault,32,b)!=errSecSuccess) return nil;return B64([NSData dataWithBytes:b length:32]);}
@interface RiriCF : NSObject <ASWebAuthenticationPresentationContextProviding>
@property(nonatomic,strong) UIViewController *presenter;
@property(nonatomic,strong) ASWebAuthenticationSession *auth;
@property(nonatomic,copy) void (^completion)(NSDictionary *,NSString *);
@property(nonatomic,copy) NSString *verifier;
@property(nonatomic,copy) NSString *state;
@property(nonatomic,copy) NSString *token;
@property(nonatomic,copy) NSString *ownID;
@property(nonatomic,copy) NSString *installID;
@property(nonatomic,copy) NSString *account;
@property(nonatomic,copy) NSString *database;
@property(nonatomic,copy) NSString *origin;
@property(nonatomic,copy) NSString *secret;
@property(nonatomic,strong) RiriCF *keepAlive;
@end
@implementation RiriCF
- (ASPresentationAnchor)presentationAnchorForWebAuthenticationSession:(ASWebAuthenticationSession *)session {return self.presenter.view.window;}
- (void)finish:(NSDictionary *)result error:(NSString *)error {
    dispatch_async(dispatch_get_main_queue(), ^{
        self.token=nil;self.verifier=nil;self.auth=nil;
        if(self.completion) self.completion(result,error);
        self.completion=nil;self.keepAlive=nil;
    });
}
- (void)start {
    if(!strlen(RIRI_CF_CLIENT_ID)||!strlen(RIRI_CF_REDIRECT_URI)||!strlen(RIRI_CF_SCOPES)) {
        [self finish:nil error:@"公開Cloudflare連携の登録情報が未設定です。開発者側の登録完了後に利用できます。既存サーバーへの接続は引き続き利用できます。"];return;
    }
    self.verifier=Random();self.state=Random();self.secret=RiriConnection()[@"secret"];if(self.secret.length<32) self.secret=Random();
    if(!self.verifier||!self.state||!self.secret) {[self finish:nil error:@"安全な接続キーを生成できませんでした。"];return;}
    unsigned char hash[CC_SHA256_DIGEST_LENGTH];NSData *bytes=[self.verifier dataUsingEncoding:NSUTF8StringEncoding];CC_SHA256(bytes.bytes,(CC_LONG)bytes.length,hash);
    NSURLComponents *url=[NSURLComponents componentsWithString:@"https://dash.cloudflare.com/oauth2/auth"];
    url.queryItems=@[[NSURLQueryItem queryItemWithName:@"client_id" value:@RIRI_CF_CLIENT_ID],[NSURLQueryItem queryItemWithName:@"redirect_uri" value:@RIRI_CF_REDIRECT_URI],[NSURLQueryItem queryItemWithName:@"response_type" value:@"code"],[NSURLQueryItem queryItemWithName:@"scope" value:@RIRI_CF_SCOPES],[NSURLQueryItem queryItemWithName:@"state" value:self.state],[NSURLQueryItem queryItemWithName:@"code_challenge" value:B64([NSData dataWithBytes:hash length:sizeof(hash)])],[NSURLQueryItem queryItemWithName:@"code_challenge_method" value:@"S256"]];
    self.auth=[[ASWebAuthenticationSession alloc] initWithURL:url.URL callbackURLScheme:@RIRI_CF_CALLBACK_SCHEME completionHandler:^(NSURL *callback,NSError *error){
        if(error||!callback){[self finish:nil error:@"ログインがキャンセルされたか、連携できませんでした。"];return;}
        NSMutableDictionary *params=[NSMutableDictionary new];for(NSURLQueryItem *item in [NSURLComponents componentsWithURL:callback resolvingAgainstBaseURL:NO].queryItems) if(item.value) params[item.name]=item.value;
        if(![params[@"state"] isEqualToString:self.state]||![params[@"code"] length]) {[self finish:nil error:@"認証結果を確認できませんでした。もう一度お試しください。"];return;}
        NSURLComponents *form=[NSURLComponents new];form.queryItems=@[[NSURLQueryItem queryItemWithName:@"grant_type" value:@"authorization_code"],[NSURLQueryItem queryItemWithName:@"code" value:params[@"code"]],[NSURLQueryItem queryItemWithName:@"client_id" value:@RIRI_CF_CLIENT_ID],[NSURLQueryItem queryItemWithName:@"redirect_uri" value:@RIRI_CF_REDIRECT_URI],[NSURLQueryItem queryItemWithName:@"code_verifier" value:self.verifier]];
        NSMutableURLRequest *req=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:@"https://dash.cloudflare.com/oauth2/token"]];req.HTTPMethod=@"POST";req.HTTPBody=[[form.percentEncodedQuery stringByReplacingOccurrencesOfString:@"+" withString:@"%2B"] dataUsingEncoding:NSUTF8StringEncoding];[req setValue:@"application/x-www-form-urlencoded" forHTTPHeaderField:@"Content-Type"];
        [[RiriSession() dataTaskWithRequest:req completionHandler:^(NSData *data,NSURLResponse *response,NSError *err){
            id json=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
            NSInteger status=[response isKindOfClass:NSHTTPURLResponse.class]?((NSHTTPURLResponse *)response).statusCode:0;
            if(err||status!=200||![json isKindOfClass:NSDictionary.class]||![json[@"access_token"] isKindOfClass:NSString.class]) {[self finish:nil error:@"Cloudflareの認証が完了しませんでした。"];return;}
            self.token=json[@"access_token"];[self accounts];
        }] resume];
    }];self.auth.presentationContextProvider=self;
    if(![self.auth start]) [self finish:nil error:@"認証画面を開けませんでした。"];
}
- (void)api:(NSString *)path method:(NSString *)method body:(id)body done:(void (^)(id,BOOL))done {
    NSMutableURLRequest *req=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[@"https://api.cloudflare.com/client/v4" stringByAppendingString:path]]];req.HTTPMethod=method;
    [req setValue:[@"Bearer " stringByAppendingString:self.token] forHTTPHeaderField:@"Authorization"];
    if(body){req.HTTPBody=[NSJSONSerialization dataWithJSONObject:body options:0 error:nil];[req setValue:@"application/json" forHTTPHeaderField:@"Content-Type"];}
    [[RiriSession() dataTaskWithRequest:req completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        id json=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
        NSInteger status=[response isKindOfClass:NSHTTPURLResponse.class]?((NSHTTPURLResponse *)response).statusCode:0;
        BOOL ok=!error&&status>=200&&status<300&&[json isKindOfClass:NSDictionary.class]&&[json[@"success"] boolValue];
        done(ok?json[@"result"]:nil,ok);
    }] resume];
}
- (void)accounts {
    [self api:@"/accounts?per_page=50" method:@"GET" body:nil done:^(id result,BOOL ok){
        if(!ok||![result isKindOfClass:NSArray.class]||![result count]){[self finish:nil error:@"Cloudflareアカウントへのアクセス権がありません。許可した権限を確認してください。"];return;}
        dispatch_async(dispatch_get_main_queue(), ^{
            if([result count]==1){self.account=result[0][@"id"];[self provision];return;}
            UIAlertController *sheet=[UIAlertController alertControllerWithTitle:@"利用するアカウント" message:@"あなたのアカウント内に専用の処理と保存先を作成します。" preferredStyle:UIAlertControllerStyleAlert];
            for(NSDictionary *item in result) [sheet addAction:[UIAlertAction actionWithTitle:item[@"name"]?:item[@"id"] style:UIAlertActionStyleDefault handler:^(UIAlertAction *a){self.account=item[@"id"];[self provision];}]];
            [sheet addAction:[UIAlertAction actionWithTitle:@"キャンセル" style:UIAlertActionStyleCancel handler:^(UIAlertAction *a){[self finish:nil error:@"設定をキャンセルしました。"];}]];[self.presenter presentViewController:sheet animated:YES completion:nil];
        });
    }];
}
- (NSString *)base {return [NSString stringWithFormat:@"/accounts/%@",self.account];}
- (NSString *)name {return [@"riri-" stringByAppendingString:self.installID];}
- (void)provision {
    NSString *path=[[self base] stringByAppendingString:@"/d1/database?per_page=100"];
    [self api:path method:@"GET" body:nil done:^(id result,BOOL ok){
        if(!ok||![result isKindOfClass:NSArray.class]) {[self finish:nil error:@"会話保存先を確認できませんでした。D1権限を確認してください。"];return;}
        for(NSDictionary *db in result) if([db[@"name"] isEqualToString:[self name]]) {self.database=db[@"uuid"];[self schema];return;}
        [self api:[[self base] stringByAppendingString:@"/d1/database"] method:@"POST" body:@{@"name":[self name]} done:^(id db,BOOL created){
            if(!created||![db[@"uuid"] isKindOfClass:NSString.class]) {[self finish:nil error:@"会話保存先を作成できませんでした。無料枠や権限を確認してください。"];return;}self.database=db[@"uuid"];[self schema];
        }];
    }];
}
- (void)schema {
    [self api:[NSString stringWithFormat:@"%@/d1/database/%@/query",[self base],self.database] method:@"POST" body:@{@"sql":@RIRI_SCHEMA_SOURCE} done:^(id result,BOOL ok){
        BOOL success=ok&&[result isKindOfClass:NSArray.class];for(NSDictionary *item in success?result:@[]) if(![item[@"success"] boolValue]) success=NO;
        if(!success){[self finish:nil error:@"会話保存先の初期化に失敗しました。再実行できます。"];return;}[self upload];
    }];
}
- (void)upload {
    NSDictionary *meta=@{@"main_module":@"worker.mjs",@"compatibility_date":@"2026-10-07",@"bindings":@[@{@"type":@"ai",@"name":@"AI"},@{@"type":@"d1",@"name":@"DB",@"id":self.database},@{@"type":@"secret_text",@"name":@"BOT_SECRET",@"text":self.secret},@{@"type":@"plain_text",@"name":@"OWN_USER_ID",@"text":self.ownID}]};
    NSString *boundary=NSUUID.UUID.UUIDString;NSMutableData *payload=[NSMutableData new];
    NSString *metadata=[[NSString alloc] initWithData:[NSJSONSerialization dataWithJSONObject:meta options:0 error:nil] encoding:NSUTF8StringEncoding];
    NSString *parts=[NSString stringWithFormat:@"--%@\r\nContent-Disposition: form-data; name=\"metadata\"\r\nContent-Type: application/json\r\n\r\n%@\r\n--%@\r\nContent-Disposition: form-data; name=\"worker.mjs\"; filename=\"worker.mjs\"\r\nContent-Type: application/javascript+module\r\n\r\n%@\r\n--%@--\r\n",boundary,metadata,boundary,@RIRI_WORKER_SOURCE,boundary];[payload appendData:[parts dataUsingEncoding:NSUTF8StringEncoding]];
    NSMutableURLRequest *req=[NSMutableURLRequest requestWithURL:[NSURL URLWithString:[NSString stringWithFormat:@"https://api.cloudflare.com/client/v4%@/workers/scripts/%@",[self base],[self name]]]];
    req.HTTPMethod=@"PUT";req.HTTPBody=payload;[req setValue:[@"Bearer " stringByAppendingString:self.token] forHTTPHeaderField:@"Authorization"];[req setValue:[@"multipart/form-data; boundary=" stringByAppendingString:boundary] forHTTPHeaderField:@"Content-Type"];
    [[RiriSession() dataTaskWithRequest:req completionHandler:^(NSData *data,NSURLResponse *response,NSError *error){
        id json=data?[NSJSONSerialization JSONObjectWithData:data options:0 error:nil]:nil;
        if(error||![json isKindOfClass:NSDictionary.class]||![json[@"success"] boolValue]){[self finish:nil error:@"処理を配置できませんでした。Workers・AI権限や無料枠を確認してください。"];return;}[self subdomain];
    }] resume];
}
- (void)subdomain {
    [self api:[[self base] stringByAppendingString:@"/workers/subdomain"] method:@"GET" body:nil done:^(id result,BOOL ok){
        if(ok&&[result[@"subdomain"] isKindOfClass:NSString.class]) {[self enable:result[@"subdomain"]];return;}
        [self api:[[self base] stringByAppendingString:@"/workers/subdomain"] method:@"PUT" body:@{@"subdomain":[self name]} done:^(id created,BOOL success){
            if(!success||![created[@"subdomain"] isKindOfClass:NSString.class]){[self finish:nil error:@"無料の接続URLを作成できませんでした。Cloudflare側でWorkersの利用開始を確認してください。"];return;}[self enable:created[@"subdomain"]];
        }];
    }];
}
- (void)enable:(NSString *)subdomain {
    [self api:[NSString stringWithFormat:@"%@/workers/scripts/%@/subdomain",[self base],[self name]] method:@"POST" body:@{@"enabled":@YES,@"previews_enabled":@NO} done:^(id result,BOOL ok){
        if(!ok){[self finish:nil error:@"接続URLを有効化できませんでした。"];return;}
        self.origin=[NSString stringWithFormat:@"https://%@.%@.workers.dev",[self name],subdomain];
        [self finish:@{@"origin":self.origin,@"secret":self.secret,@"own_user_id":self.ownID} error:nil];
    }];
}
@end
void RiriCloudflareBegin(UIViewController *presenter,NSString *ownID,void (^completion)(NSDictionary *,NSString *)) {
    RiriCF *flow=[RiriCF new];flow.keepAlive=flow;flow.presenter=presenter;flow.ownID=ownID;flow.completion=completion;
    NSString *install=[NSUserDefaults.standardUserDefaults stringForKey:@"riri.cf.install.v1"];
    if(!install){install=[[[NSUUID.UUID.UUIDString stringByReplacingOccurrencesOfString:@"-" withString:@""] lowercaseString] substringToIndex:12];[NSUserDefaults.standardUserDefaults setObject:install forKey:@"riri.cf.install.v1"];}
    flow.installID=install;[flow start];
}
