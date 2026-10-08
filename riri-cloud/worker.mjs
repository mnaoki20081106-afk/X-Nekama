
// Riri Cloudflare bridge. No paid inference or X write without explicit opt-in.
import {DEFAULT_PERSONA,validatePersona,buildConversation,groupReady,modelOutput} from './conversation.mjs';
import {dueForBatch,validPace} from './cadence.mjs';
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
 if(q.meta.changes){
  await db.prepare("INSERT INTO conversation_activity(conversation_id,last_inbound_ms) VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET last_inbound_ms=MAX(conversation_activity.last_inbound_ms,excluded.last_inbound_ms)").bind(v.conversation_id,v.timestamp_ms).run();
 }
 return Boolean(q.meta.changes);
}
const validConversationId=(v)=>typeof v==='string'&&/^[0-9-]{1,120}$/.test(v);
async function personaFor(env,cid){
 const row=await env.DB.prepare("SELECT config FROM persona_configs WHERE scope IN ('default',?) ORDER BY (scope=?) DESC LIMIT 1").bind(cid,cid).first();
 if(!row)return DEFAULT_PERSONA;
 try{return validatePersona(JSON.parse(row.config));}catch{return DEFAULT_PERSONA;}
}
async function memoryFor(env,cid){
 const row=await env.DB.prepare("SELECT summary FROM conversation_memory WHERE conversation_id=?").bind(cid).first();
 return row?.summary||'';
}
async function infer(env,batch,nowMs=Date.now()){
 if(!env.MODAL_URL||!env.MODAL_SECRET)return false;
 if(!await reserve(env))return 'approval_required';
 const cid=batch[0].conversation_id,latest=batch.at(-1);
 const [person,summary,history]=await Promise.all([
   personaFor(env,cid),memoryFor(env,cid),
   env.DB.prepare("SELECT text,reply,status FROM messages WHERE conversation_id=? AND timestamp_ms<? AND status NOT IN ('baseline','ignored','generating','queued') ORDER BY timestamp_ms DESC LIMIT 10").bind(cid,batch[0].timestamp_ms).all()
 ]);
 const messages=buildConversation({persona:person,summary,history:history.results.reverse(),batch:batch.slice(-6),now:new Date(nowMs)});
 const begun=Date.now();
 try{
  const r=await fetch(env.MODAL_URL,{method:'POST',headers:{authorization:'Bearer '+env.MODAL_SECRET,'content-type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(480000)});
  if(!r.ok)throw Error('modal_http_'+r.status);
  const result=modelOutput(await r.json());
  // Durable summary, scoped to the conversation. Truncated and scrubbed by policy.
  if(result.memory_summary){
    await env.DB.prepare("INSERT INTO conversation_memory(conversation_id,summary,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(conversation_id) DO UPDATE SET summary=excluded.summary,updated_at=CURRENT_TIMESTAMP")
     .bind(cid,result.memory_summary).run();
  }
  // Older messages are represented by the one combined answer; never reply to each separately.
  for(const msg of batch.slice(0,-1)){
    await env.DB.prepare("UPDATE messages SET status='rolled_up',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='generating'").bind(msg.message_id).run();
  }
  await env.DB.prepare("UPDATE messages SET status='draft',reply=?,updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='generating'").bind(result.reply,latest.message_id).run();
  await env.DB.prepare("INSERT INTO inference_metrics(created_at,conversation_id,elapsed_ms,ok) VALUES(CURRENT_TIMESTAMP,?,?,1)").bind(cid,Date.now()-begun).run();
  return true;
 }catch(error){
  await env.DB.prepare("INSERT INTO inference_metrics(created_at,conversation_id,elapsed_ms,ok) VALUES(CURRENT_TIMESTAMP,?,?,0)").bind(cid,Date.now()-begun).run();
  throw error;
 }
}
async function acquireLease(db,cid,nowMs){
 const until=nowMs+12*60*1000;
 const row=await db.prepare("INSERT INTO conversation_leases(conversation_id,lease_until) VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET lease_until=excluded.lease_until WHERE conversation_leases.lease_until<? RETURNING lease_until").bind(cid,until,nowMs).first();
 return row?.lease_until===until;
}
async function releaseLease(db,cid){await db.prepare("DELETE FROM conversation_leases WHERE conversation_id=?").bind(cid).run();}
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
async function sendX(env,msg,nowMs=Date.now()){
 // No automatic retries on 429/5xx/timeouts: a remote send may have succeeded.
 const payload={cards_platform:'Web-12',conversation_id:msg.conversation_id,dm_users:false,include_cards:1,include_quote_count:true,recipient_ids:false,text:msg.reply};
 try{
  await xRequest(env,'https://x.com/i/api/1.1/dm/new2.json',{method:'POST',body:JSON.stringify(payload)});
  await env.DB.prepare("UPDATE messages SET status='sent',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='claimed'").bind(msg.message_id).run();
  await env.DB.prepare("INSERT INTO conversation_activity(conversation_id,last_sent_ms) VALUES(?,?) ON CONFLICT(conversation_id) DO UPDATE SET last_sent_ms=MAX(conversation_activity.last_sent_ms,excluded.last_sent_ms)").bind(msg.conversation_id,nowMs).run();
  return 'sent';
 }catch(error){
  await env.DB.prepare("UPDATE messages SET status='uncertain',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='claimed'").bind(msg.message_id).run();
  throw error;
 }
}
async function armConversation(env,cid,whenMs){
 if(!env.RIRI_TIMERS||!validConversationId(cid))return false;
 const id=env.RIRI_TIMERS.idFromName(cid);
 const timer=env.RIRI_TIMERS.get(id);
 const r=await timer.fetch('https://riri.internal/arm',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversation_id:cid,when_ms:Math.max(Date.now()+1000,Math.round(whenMs))})});
 if(!r.ok)throw Error('timer_arm_failed');
 return true;
}
export class ConversationTimer{
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){
  if(new URL(request.url).pathname!=='/arm'||request.method!=='POST')return new Response('not_found',{status:404});
  const v=await request.json();
  if(!validConversationId(v.conversation_id)||!Number.isSafeInteger(v.when_ms))return new Response('invalid',{status:400});
  const original=await this.ctx.storage.get('conversation_id');
  if(original&&original!==v.conversation_id)return new Response('conversation_mismatch',{status:409});
  await this.ctx.storage.put('conversation_id',v.conversation_id);
  await this.ctx.storage.setAlarm(v.when_ms);
  return new Response('armed');
 }
 async alarm(){
  const cid=await this.ctx.storage.get('conversation_id');
  if(!validConversationId(cid))return;
  try{
   const result=await cycle(this.env,Date.now(),{onlyConversation:cid,skipPoll:true});
   // A newer inbound message or an inflight draft can require a later wakeup.
   const pending=(await this.env.DB.prepare("SELECT MAX(timestamp_ms) AS newest FROM messages WHERE conversation_id=? AND status='queued'").bind(cid).first());
   if(pending?.newest&&this.env.AUTO_SEND_ENABLED==='true'){
    const activity=await this.env.DB.prepare('SELECT last_sent_ms,last_inbound_ms FROM conversation_activity WHERE conversation_id=?').bind(cid).first()||{};
    const mode=validPace(this.env.DM_PACE)?this.env.DM_PACE:'adaptive';
    const next=dueForBatch([{timestamp_ms:pending.newest}],activity,{mode},Date.now());
    // No busy-spin when a generation is running; cron also catches stalled jobs.
    await this.ctx.storage.setAlarm(Math.max(Date.now()+15000,next.at));
   }
   return result;
  }catch(e){console.error('riri_alarm_error',String(e));await this.ctx.storage.setAlarm(Date.now()+60000);}
 }
}
export async function cycle(env,nowMs=Date.now(),options={}){
 if(!activeJST(new Date(nowMs))||env.AUTO_SEND_ENABLED!=='true')return {status:'inactive'};
 let found=0;
 const pollEvery=Math.max(1,Math.min(10,Number(env.X_POLL_EVERY_MINUTES)||2));
 if(!options.skipPoll&&Math.floor(nowMs/60000)%pollEvery===0)found=await pollX(env);
 const db=env.DB;
 let generated=0,sent=0,blocked=0,waiting=0;
 const drafts=(await db.prepare("SELECT * FROM messages WHERE status='draft' AND source IN ('poll','tweak') ORDER BY timestamp_ms ASC LIMIT 4").all()).results;
 for(const msg of drafts){
  if(options.onlyConversation&&msg.conversation_id!==options.onlyConversation)continue;
  if(env.X_POLL_ENABLED!=='true')continue;
  const lock=await db.prepare("UPDATE messages SET status='claimed',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='draft' RETURNING message_id").bind(msg.message_id).first();
  if(!lock)continue;
  try{await sendX(env,msg,nowMs);sent++;}catch(e){console.error('x_send_uncertain',String(e));}
 }
 const pending=(await db.prepare("SELECT * FROM messages WHERE status='queued' AND source IN ('poll','tweak') ORDER BY timestamp_ms ASC LIMIT 80").all()).results;
 // Get all same-conversation messages first, then compute a per-conversation deadline.
 const groups=groupReady(pending,nowMs,0,Math.max(1,Math.min(8,Number(env.MAX_GROUPS_PER_TICK)||4)));
 for(const batch of groups){
  const cid=batch[0].conversation_id;
  if(options.onlyConversation&&cid!==options.onlyConversation)continue;
  const activity=await db.prepare('SELECT last_sent_ms,last_inbound_ms FROM conversation_activity WHERE conversation_id=?').bind(cid).first()||{};
  const mode=validPace(env.DM_PACE)?env.DM_PACE:'adaptive';
  const due=dueForBatch(batch,activity,{mode},nowMs);
  if(!due.ready){
    if(env.RIRI_TIMERS&&!options.onlyConversation){
      try{await armConversation(env,cid,due.at);}catch(e){console.error('riri_timer_arm',String(e));}
    }
    waiting++;
    continue;
  }
  if(!(await acquireLease(db,cid,nowMs)))continue;
  try{
   // A queued conversation must not overtake a previous draft or in-flight answer.
   const busy=await db.prepare("SELECT message_id FROM messages WHERE conversation_id=? AND status IN ('draft','claimed','generating') LIMIT 1").bind(cid).first();
   if(busy)continue;
   const ids=[];
   for(const msg of batch){
    const changed=await db.prepare("UPDATE messages SET status='generating',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='queued' RETURNING message_id").bind(msg.message_id).first();
    if(changed)ids.push(msg.message_id);
   }
   if(ids.length!==batch.length){for(const id of ids)await db.prepare("UPDATE messages SET status='queued' WHERE message_id=? AND status='generating'").bind(id).run();continue;}
   try{
    const ok=await infer(env,batch,nowMs);
    if(ok==='approval_required'){
      blocked++;
      for(const id of ids)await db.prepare("UPDATE messages SET status='awaiting_approval' WHERE message_id=? AND status='generating'").bind(id).run();
      continue;
    }
    if(!ok){for(const id of ids)await db.prepare("UPDATE messages SET status='needs_review' WHERE message_id=? AND status='generating'").bind(id).run();continue;}
    generated++;
    // Messages arriving during inference make the generated draft stale.
    const newer=await db.prepare("SELECT message_id FROM messages WHERE conversation_id=? AND status='queued' AND timestamp_ms>? LIMIT 1").bind(cid,batch.at(-1).timestamp_ms).first();
    if(newer){
      await db.prepare("UPDATE messages SET status='superseded',updated_at=CURRENT_TIMESTAMP WHERE message_id=? AND status='draft'").bind(batch.at(-1).message_id).run();
      continue;
    }
    if(env.X_POLL_ENABLED==='true'){
      const last=await db.prepare('SELECT * FROM messages WHERE message_id=?').bind(batch.at(-1).message_id).first();
      const claimed=await db.prepare("UPDATE messages SET status='claimed' WHERE message_id=? AND status='draft' RETURNING message_id").bind(last.message_id).first();
      if(claimed){try{await sendX(env,last,nowMs);sent++;}catch(e){console.error('x_send_uncertain',String(e));}}
    }
   }catch(e){
    console.error('generate_failed',String(e));
    for(const id of ids)await db.prepare("UPDATE messages SET status='needs_review' WHERE message_id=? AND status='generating'").bind(id).run();
   }
  }finally{await releaseLease(db,cid);}
 }
 if(Math.floor(nowMs/60000)%60===0){
  await db.prepare("DELETE FROM inference_metrics WHERE created_at < datetime('now','-30 days')").run();
 }
 waiting=groups.length;
 return {found,generated,sent,blocked,waiting};
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
   return json({month,active:activeJST(),model_verified:(await setting(db,'model_verified_target',''))===env.MODAL_URL,x_poll_enabled:env.X_POLL_ENABLED==='true',auto_send_enabled:env.AUTO_SEND_ENABLED==='true',estimated_spend_cents:budget?.estimated_cents||0,free_internal_cents:Number(env.INTERNAL_FREE_CENTS||1500),approved_extra_cents:budget?.approved_extra_cents||0,counts:counts.results});
  }
  if(path==='/admin/check-model'&&req.method==='POST'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   let v;try{v=await body(req);}catch{return json({error:'invalid_json'},400);}
   if(v.confirm_compute_cost!==true)return json({error:'explicit_compute_consent_required'},400);
   if(!env.MODAL_URL||!env.MODAL_SECRET)return json({error:'model_not_configured'},503);
   if(!await reserve(env))return json({error:'approval_required'},402);
   try{
     const response=await fetch(env.MODAL_URL,{method:'POST',headers:{authorization:'Bearer '+env.MODAL_SECRET,'content-type':'application/json'},body:JSON.stringify({messages:[{role:'system',content:'日本語で簡潔に返してください。JSONでreplyとmemory_summaryを返してください。'},{role:'user',content:'接続確認です。こんにちは。'}]}),signal:AbortSignal.timeout(480000)});
     if(!response.ok)return json({error:'model_http_failure',status:response.status},503);
     const reply=modelOutput(await response.json());
     await saveSetting(db,'model_verified_target',env.MODAL_URL);
     return json({status:'model_verified',reply_length:reply.reply.length,model_ready:true});
   }catch(error){return json({error:'model_unavailable',detail:String(error?.message||error).slice(0,180)},503);}
  }
  if(path==='/admin/profile'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   const cid=new URL(req.url).searchParams.get('conversation_id');
   if(cid&&!validConversationId(cid))return json({error:'invalid_conversation_id'},400);
   const scope=cid||'default';
   if(req.method==='GET')return json({scope,persona:await personaFor(env,scope)});
   if(req.method==='DELETE'){
     await db.prepare("DELETE FROM persona_configs WHERE scope=?").bind(scope).run();
     return json({status:'deleted',scope});
   }
   if(req.method==='POST'){
     let value;try{value=await body(req);}catch{return json({error:'invalid_json'},400);}
     let profile;try{profile=validatePersona(value?.persona);}catch(e){return json({error:String(e.message)},400);}
     await db.prepare("INSERT INTO persona_configs(scope,config,updated_at) VALUES(?,?,CURRENT_TIMESTAMP) ON CONFLICT(scope) DO UPDATE SET config=excluded.config,updated_at=CURRENT_TIMESTAMP").bind(scope,JSON.stringify(profile)).run();
     return json({status:'saved',scope,persona:profile});
   }
   return json({error:'method_not_allowed'},405);
  }
  if(path==='/admin/memory'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   const cid=new URL(req.url).searchParams.get('conversation_id');
   if(!validConversationId(cid))return json({error:'invalid_conversation_id'},400);
   if(req.method==='GET'){
     const row=await db.prepare("SELECT summary,updated_at FROM conversation_memory WHERE conversation_id=?").bind(cid).first();
     return json({conversation_id:cid,memory:row||null});
   }
   if(req.method==='DELETE'){
     await db.prepare("DELETE FROM conversation_memory WHERE conversation_id=?").bind(cid).run();
     return json({status:'deleted',conversation_id:cid});
   }
   return json({error:'method_not_allowed'},405);
  }
  if(path==='/admin/metrics'&&req.method==='GET'){
   if(!admin(req,env.ADMIN_SECRET))return json({error:'forbidden'},403);
   const row=await db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN ok=1 THEN 1 ELSE 0 END) AS completed,ROUND(AVG(CASE WHEN ok=1 THEN elapsed_ms END)) AS average_ms, MAX(CASE WHEN ok=1 THEN elapsed_ms END) AS max_ms FROM inference_metrics WHERE created_at >= datetime('now','-7 days')").first();
   return json({period:'last_7_days',inference:row||null,note:'Metrics exclude X polling, GPU scheduling time before request, and message delivery confirmation.'});
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
  if(path==='/setup-check'&&req.method==='GET')return json({service:'riri-bridge',mode:'cloudflare-modal',model_ready:Boolean(env.MODAL_URL&&env.MODAL_SECRET&&(await setting(db,'model_verified_target',''))===env.MODAL_URL),own_user_id:plain(env.OWN_USER_ID),model:'Qwen3.8-27B-FP8'});
  if(req.method!=='POST')return json({error:'not_found'},404);
  let v;try{v=await body(req);}catch{return json({error:'invalid_json'},400);}
  if(path==='/ingest'){
   if(!validMsg(v))return json({error:'invalid_fields'},400);
   if(v.sender_id===plain(env.OWN_USER_ID))return json({status:'skipped_own'});
   const created=await ingest(db,v);
   // Wake a per-conversation alarm in seconds when the device pushes an event.
   // Do not hold a tweak request open for a GPU cold-start.
   if(created&&activeJST()&&env.AUTO_SEND_ENABLED==='true'&&env.RIRI_TIMERS){
     const activity=await db.prepare('SELECT last_sent_ms,last_inbound_ms FROM conversation_activity WHERE conversation_id=?').bind(v.conversation_id).first()||{};
     const due=dueForBatch([v],activity,{mode:env.DM_PACE||'adaptive'},Date.now());
     try{await armConversation(env,v.conversation_id,due.at);}catch(e){console.error('riri_timer_arm',String(e));}
   }
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
