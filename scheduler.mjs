import {join} from 'node:path';
import {isMissed} from './source.mjs';
import {classifyDeliveryError,retryDelayMs} from './delivery.mjs';
export function createPublisher({row,all,run,requireAccount,acquirePublishLock,releasePublishLock,dataDir,decrypt,x,xTransport,warp,MAX_DELIVERY_ATTEMPTS=3}){
return async function publishDue(){
 const now=new Date().toISOString();
 if(!row("SELECT 1 FROM drafts d JOIN accounts a ON a.id=d.account_id WHERE d.status='scheduled' AND d.scheduled_at<=? AND a.enabled=1 AND a.session_cipher IS NOT NULL LIMIT 1",now))return;
 try{await warp.ensure()}catch{return;}
 const due=all("SELECT * FROM drafts WHERE status='scheduled' AND scheduled_at<=? AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY COALESCE(next_attempt_at,scheduled_at),scheduled_at LIMIT 10",now,now);
 for(const d of due){
  const a=requireAccount(d.account_id);
  if(!a.enabled||!a.session_cipher)continue;
  if(isMissed(d.scheduled_at)){run("UPDATE drafts SET status='failed',last_error_kind='missed',error='予約日時を15分以上過ぎました。確認して再予約してください' WHERE id=? AND status='scheduled'",d.id);continue;}
  try{await warp.ensure()}catch{return;}
  if(row("SELECT 1 FROM drafts WHERE account_id=? AND status='publishing' AND id<>?",a.id,d.id))continue;
  if(!acquirePublishLock(a.id,d.id))continue;
  let claimed=false;
  try{
   const claim=run("UPDATE drafts SET status='publishing',attempt_count=attempt_count+1,last_attempt_at=datetime('now'),updated_at=datetime('now') WHERE id=? AND status='scheduled'",d.id);
   if(!claim.changes)continue;
   claimed=true;
   const asset=d.image_id?row('SELECT * FROM assets WHERE id=?',d.image_id):null;
   if(d.image_style&&!asset)throw Error('投稿画像が未設定です。画像をセットしてから再予約してください');
   const imagePath=asset&&join(dataDir,'assets',asset.filename);
   const cookies=decrypt(a.session_cipher);
   await x.checkBio(cookies,a.username,xTransport);
   const current=requireAccount(a.id);
   if(!current.enabled||current.config_revision!==a.config_revision){run("UPDATE drafts SET status='scheduled',attempt_count=MAX(attempt_count-1,0) WHERE id=?",d.id);continue;}
   await warp.ensure();
   const xId=await x.publish(cookies,d.text,imagePath,`架空AIキャラクター ${a.character_name} の生成画像`,xTransport);
   run("UPDATE drafts SET status='posted',x_post_id=?,posted_at=datetime('now'),next_attempt_at=NULL,last_error_kind='',error=NULL,updated_at=datetime('now') WHERE id=?",xId,d.id);
  }catch(e){
   console.error('publish:',e);
   if(!claimed)continue;
   if(e?.code==='VPN_REQUIRED'){
    const next=new Date(Date.now()+60000).toISOString();
    run("UPDATE drafts SET status='scheduled',attempt_count=MAX(attempt_count-1,0),next_attempt_at=?,last_error_kind='vpn_required',error='WARP接続待ち',updated_at=datetime('now') WHERE id=?",next,d.id);
    continue;
   }
   const attempt=Number(d.attempt_count||0)+1;
   const info=classifyDeliveryError(e,e?.deliveryStage||'preflight');
   if(info.retryable&&attempt<MAX_DELIVERY_ATTEMPTS){
    const next=new Date(Date.now()+retryDelayMs(info.kind,attempt,info.retryAfterMs)).toISOString();
    run("UPDATE drafts SET status='scheduled',next_attempt_at=?,last_error_kind=?,error=?,updated_at=datetime('now') WHERE id=?",next,info.kind,`再試行待ち: ${info.message}`.slice(0,500),d.id);
   }else{
    const prefix=info.ambiguous?'送信結果を確認できません。X上の投稿有無を確認してください。 ':'';
    run("UPDATE drafts SET status='failed',next_attempt_at=NULL,last_error_kind=?,error=?,updated_at=datetime('now') WHERE id=?",info.kind,(prefix+info.message).slice(0,500),d.id);
   }
  }finally{releasePublishLock(a.id,d.id)}
 }
}
}
