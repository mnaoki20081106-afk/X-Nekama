
// Riri Cloudflare bridge. No paid inference or X write without explicit opt-in.
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const plain=v=>String(v??'').trim();
const required=(s)=>typeof s==='string'&&s.length>=32;
const goodId=(v)=>typeof v==='string'&&/^[0-9]{1,30}$/.test(v);
export function activeJST(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).formatToParts(date);
 const h=Number(parts.find(p=>p.type==='hour')?.value),m=Number(parts.find(p=>p.type==='minute')?.value),t=(h%24)*60+m;
 return (t>=420&&t<540)||(t>=720&&t<810)||(t>=1140||t<60);
}
export function monthJST(date=new Date()){const p=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit'}).formatToParts(date);return p.find(x=>x.type==='year').value+'-'+p.find(x=>x.type==='month').value;}
export function parseInbox(data,ownId){
 const root=data?.inbox_initial_state??data?.inbox_state??data;
 const entries=root?.entries;
 if(!entries || (typeof entries!=='object'))throw Error('unknown_inbox_format');
 const rows=Array.isArray(entries)?entries:Object.values(entries);
 const out=[];
 for(const entry of rows){
  const m=entry?.message??entry?.message_entry?.message??entry;
  const d=m?.message_data??m?.messageData??m;
  const id=plain(m?.id??m?.message_id??d?.id);
  const sender=plain(m?.sender_id??d?.sender_id??m?.sender?.id);
  const cid=plain(m?.conversation_id??d?.conversation_id??entry?.conversation_id);
  const content=plain(d?.text);
  if(!goodId(sender)||sender===ownId||!id||!cid||!content||content.length>4000)continue;
  if(!/^[0-9-]{1,120}$/.test(cid)||!/^[0-9]{1,40}$/.test(id))continue;
  const rawTime=Number(m?.time??d?.time??m?.created_timestamp??Date.now());
  const timestamp_ms=Number.isSafeInteger(rawTime)?rawTime:Date.now();
  out.push({sender_id:sender,message_id:id,conversation_id:cid,text:content,timestamp_ms});
 }
 return out.sort((a,b)=>a.timestamp_ms-b.timestamp_ms).slice(-30);
}
function timingSafeEqual(a,b){if(!a||!b)return false;const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);let z=x.length^y.length;for(let i=0;i<Math.max(x.length,y.length);i++)z|=(x[i]??0)^(y[i]??0);return z===0;}
function auth(req,secret){return required(secret)&&timingSafeEqual(req.headers.get('x-bot-secret'),secret);}
function admin(req,secret){return required(secret)&&timingSafeEqual(req.headers.get('x-admin-secret'),secret);}
function validMsg(v){return v&&goodId(v.sender_id)&&/^[0-9]{1,40}$/.test(v.message_id||'')&&/^[0-9-]{1,120}$/.test(v.conversation_id||'')&&typeof v.text==='string'&&v.text.trim().length>0&&v.text.length<=4000&&Number.isSafeInteger(v.timestamp_ms)&&v.timestamp_ms>=0;}
async function body(req){const s=await req.text();if(s.length>12000)throw Error('too_large');return JSON.parse(s);}
async function setting(db,k,defaultValue=''){const v=await db.prepare('SELECT value FROM settings WHERE key=?').bind(k).first();return v?.value??defaultValue;}
async function saveSetting(db,k,v){await db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind(k,String(v)).run();}
const estimate=v=>{const n=Number(v);return Number.isSafeInteger(n)&&n>=1&&n<=200?n:25;};
async function reserve(env){
 const db=env.DB,month=monthJST(),pred=estimate(env.ESTIMATED_REQUEST_CENTS),free=Number(env.INTERNAL_FREE_CENTS||1500);
 await db.prepare('INSERT OR IGNORE INTO spend(month,estimated_cents,approved_extra_cents) VALUES(?,0,0)').bind(month).run();
 const allow=Math.max(0,Math.min(2000,free))+(await db.prepare('SELECT approved_extra_cents FROM spend WHERE month=?').bind(month).first()).approved_extra_cents;
 const r=await db.prepare('UPDATE spend SET estimated_cents=estimated_cents+? WHERE month=? AND estimated_cents+?<=? RETURNING estimated_cents').bind(pred,month,pred,allow).first();
 return Boolean(r);
}
async function ingest(db,v,source='tweak'){
 if(!validMsg(v))return json({error:'invalid_fields'},400);
 const q=await db.prepare("INSERT OR IGNORE INTO messages(message_id,sender_id,conversation_id,text,timestamp_ms,source,status) VALUES(?,?,?,?,?,?,'queued')").bind(v.message_id,v.sender_id,v.conversation_id,v.text,v.timestamp_ms,source).run();
 return Boolean(q.meta.changes);
}
async function infer(env,msg){
 if(!env.MODAL_URL||!env.MODAL_SECRET)return false;
 if(!await reserve(env))return 'approval_required';
 const history=await env.DB.prepare("SELECT text,reply,status FROM messages WHERE conversation_id=? AND timestamp_ms<=? AND message_id<>? ORDER BY timestamp_ms DESC LIMIT 8").bind(msg.conversation_id,msg.timestamp_ms,msg.message_id).all();
 const messages=[{role:'system',content:plain(env.SYSTEM_PROMPT)||'あなたはXのDM自動応答AIです。自動応答だと尋ねられたら正直に説明します。短く自然な日本語で返してください。金銭の要求や身分の偽装をしないでください。'}];
 for(const x of history.results.reverse()){messages.push({role:'user',content:x.text});if(x.reply&&x.status==='sent')messages.push({role:'assistant',content:x.reply});}
 messages.push({role:'user',content:msg.text});
 const r=await fetch(env.MODAL_URL,{method:'POST',headers:{authorization:'Bearer '+env.MODAL_SECRET,'content-type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(480000)});
 if(!r.ok)throw Error('modal_http_'+r.status);
 const d=await r.json(),reply=plain(d?.reply);
 if(!reply||reply.length>4000)throw Error('invalid_model_output');
 await env.DB.prepare("UPDATE messages SET status='draft',reply=?,updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='generating'").bind(reply,msg.message_id).run();
 return true;
}
function xHeaders(env){
 if(!env.X_AUTH_TOKEN||!env.X_CT0||!env.X_WEB_BEARER)throw Error('x_auth_missing');
 return {'authorization':'Bearer '+env.X_WEB_BEARER,'cookie':'auth_token='+env.X_AUTH_TOKEN+'; ct0='+env.X_CT0,
 'x-csrf-token':env.X_CT0,'x-twitter-active-user':'yes','x-twitter-auth-type':'OAuth2Session','content-type':'application/json','referer':'https://x.com/'};
}
async function xRequest(env,url,options={}){
 const response=await fetch(url,{...options,headers:{...xHeaders(env),...(options.headers||{})},redirect:'error',signal:AbortSignal.timeout(25000)});
 if(!response.ok)throw Error('x_http_'+response.status);
 return response.json();
}
async function pollX(env){
 if(env.X_POLL_ENABLED!=='true')return 0;
 const data=await xRequest(env,'https://x.com/i/api/1.1/dm/inbox_initial_state.json?include_groups=true&include_inbox_timelines=true');
 const messages=parseInbox(data,plain(env.OWN_USER_ID));
 const initialized=await setting(env.DB,'x_initialized','');
 if(!initialized){
  for(const msg of messages)await ingest(env.DB,msg,'baseline');
  await env.DB.prepare("UPDATE messages SET status='ignored' WHERE source='baseline' AND status='queued'").run();
  await saveSetting(env.DB,'x_initialized','1');
  return 0;
 }
 let count=0;
 for(const msg of messages){if(await ingest(env.DB,msg,'poll'))count++;}
 return count;
}
async function sendX(env,msg){
 // No automatic retries on 429/5xx/timeouts: a remote send may have succeeded.
 const payload={cards_platform:'Web-12',conversation_id:msg.conversation_id,dm_users:false,include_cards:1,include_quote_count:true,recipient_ids:false,text:msg.reply};
 try{
  await xRequest(env,'https://x.com/i/api/1.1/dm/new2.json',{method:'POST',body:JSON.stringify(payload)});
  await env.DB.prepare("UPDATE messages SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='claimed'").bind(msg.message_id).run();
  return 'sent';
 }catch(error){
  await env.DB.prepare("UPDATE messages SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='claimed'").bind(msg.message_id).run();
  throw error;
 }
}
async function cycle(env){
 if(!activeJST()||env.AUTO_SEND_ENABLED!=='true')return {status:'inactive'};
 const found=await pollX(env);
 const pending=(await env.DB.prepare("SELECT * FROM messages WHERE status IN ('queued','draft') AND source IN ('poll','tweak') ORDER BY timestamp_ms ASC LIMIT 4").all()).results;
 let generated=0,sent=0,blocked=0;
 for(const msg of pending){
  let current=msg;
  if(current.status==='queued'){
   const lock=await env.DB.prepare("UPDATE messages SET status='generating',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='queued' RETURNING message_id").bind(msg.message_id).first();
   if(!lock)continue;
   try{
    const ok=await infer(env,msg);
    if(ok==='approval_required'){blocked++;await env.DB.prepare("UPDATE messages SET status='awaiting_approval' WHERE message_id=? AND status='generating'").bind(msg.message_id).run();continue;}
    if(!ok){await env.DB.prepare("UPDATE messages SET status='needs_review' WHERE message_id=? AND status='generating'").bind(msg.message_id).run();continue;}
    generated++;current=await env.DB.prepare('SELECT * FROM messages WHERE message_id=?').bind(msg.message_id).first();
   }catch(e){console.error('generate_failed',String(e));await env.DB.prepare("UPDATE messages SET status='needs_review' WHERE message_id=? AND status='generating'").bind(msg.message_id).run();continue;}
  }
  if(current?.status!=='draft'||env.X_POLL_ENABLED!=='true')continue;
  const locked=await env.DB.prepare("UPDATE messages SET status='claimed',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='draft' RETURNING message_id").bind(msg.message_id).first();
  if(!locked)continue;
  try{await sendX(env,current);sent++;}catch(e){console.error('x_send_uncertain',String(e));}
 }
 return {found,generated,sent,blocked};
}
export default {
 async scheduled(event,env,ctx){ctx.waitUntil(cycle(env).catch(e=>console.error('riri_cycle',String(e))));},
 async fetch(req,env){
  const path=new URL(req.url).pathname,db=env.DB;
  if(path==='/health')return json({ok:true,service:'riri-cloud'});
  if(path==='/admin/status'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   const month=monthJST(),budget=await db.prepare('SELECT * FROM spend WHERE month=?').bind(month).first();
   const counts=await db.prepare('SELECT status,COUNT(*) AS n FROM messages GROUP BY status').all();
   return json({month,active:activeJST(),x_poll_enabled:env.X_POLL_ENABLED==='true',auto_send_enabled:env.AUTO_SEND_ENABLED==='true',estimated_spend_cents:budget?.estimated_cents||0,free_internal_cents:Number(env.INTERNAL_FREE_CENTS||1500),approved_extra_cents:budget?.approved_extra_cents||0,counts:counts.results});
  }
  if(path==='/admin/approve'&&req.method==='POST'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   let v;try{v=await body(req);}catch{return json({error:'invalid_json'},400);}
   if(v.month!==monthJST()||!Number.isSafeInteger(v.additional_usd_cents)||v.additional_usd_cents<0||v.additional_usd_cents>600||v.confirm!==true)return json({error:'invalid_approval'},400);
   await db.prepare('INSERT INTO spend(month,estimated_cents,approved_extra_cents) VALUES(?,0,?) ON CONFLICT(month) DO UPDATE SET approved_extra_cents=excluded.approved_extra_cents').bind(v.month,v.additional_usd_cents).run();
   await db.prepare("UPDATE messages SET status='queued' WHERE status='awaiting_approval'").run();
   return json({status:'approved_compute_limit',month:v.month,additional_usd_cents:v.additional_usd_cents,note:'Does not initiate or authorize PayPay transfers.'});
  }
  if(!auth(req,env.BOT_SECRET))return json({error:'forbidden'},403);
  if(path==='/setup-check'&&req.method==='GET')return json({service:'riri-bridge',mode:'cloudflare-modal',model_ready:Boolean(env.MODAL_URL&&env.MODAL_SECRET),own_user_id:plain(env.OWN_USER_ID),model:'Qwen3.8-27B-FP8'});
  if(req.method!=='POST')return json({error:'not_found'},404);
  let v;try{v=await body(req);}catch{return json({error:'invalid_json'},400);}
  if(path==='/ingest'){
   if(!validMsg(v))return json({error:'invalid_fields'},400);
   if(v.sender_id===plain(env.OWN_USER_ID))return json({status:'skipped_own'});
   const created=await ingest(db,v);
   // Queue now; cron processes later so the tweak request never waits for GPU cold start.
   const row=await db.prepare('SELECT status FROM messages WHERE message_id=?').bind(v.message_id).first();
   return json({status:row?.status||'unknown',message_id:v.message_id});
  }
  if(path==='/claim'){
   const mid=plain(v.message_id),cid=plain(v.conversation_id);
   if(!mid||!cid)return json({error:'invalid_fields'},400);
   const item=await db.prepare("UPDATE messages SET status='claimed' WHERE message_id=? AND conversation_id=? AND status='draft' RETURNING reply").bind(mid,cid).first();
   return item?json({reply:item.reply,replies:[item.reply]}):json({error:'already_claimed_or_not_ready'},409);
  }
  if(path==='/ack'){
   if(!['submitted','unsupported','uncertain'].includes(v.status))return json({error:'invalid_fields'},400);
   await db.prepare("UPDATE messages SET status=?,updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='claimed'").bind(v.status==='submitted'?'sent':v.status,v.message_id).run();
   return json({status:'recorded'});
  }
  return json({error:'not_found'},404);
 }
};
