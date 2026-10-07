export const MODEL = '@cf/qwen/qwen3-30b-a3b-fp8';
export function replyText(result) {
  const choice=result?.choices?.[0];
  if(choice?.finish_reason==='length') throw new Error('incomplete_reply');
  const content=choice?.message?.content ?? result?.response;
  if(typeof content!=='string') throw new Error('invalid_model_output');
  const clean=content.replace(/<think>[\s\S]*?<\/think>/g,'').trim();
  if(/<\/?think>/.test(clean)||!clean||clean.length>4000) throw new Error('invalid_model_output');
  return clean;
}
const DEFAULT_PROMPT = '日本語で親しみやすく自然に会話するAIキャラクターです。相手の発言をよく読み、短く具体的に返答してください。実際には確認していない現実の出来事を事実として断言しないでください。返答本文だけを書いてください。';
const json = (value, status=200) => Response.json(value, {status, headers:{'Cache-Control':'no-store'}});
export function validMessage(v) {
  return v && typeof v==='object' && !Array.isArray(v) &&
    ['sender_id','message_id','conversation_id','text'].every(k=>typeof v[k]==='string' && v[k].trim().length>0 && v[k].length <= (k==='text'?4000:200)) &&
    Number.isSafeInteger(v.timestamp_ms) && v.timestamp_ms>=0;
}
export async function authorized(request, secret) {
  if (!secret || secret.length<32) return false;
  const incoming = request.headers.get('X-Bot-Secret') || '';
  const digest = s=>crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));
  const [a,b]=await Promise.all([digest(incoming),digest(secret)]);
  const av=new Uint8Array(a),bv=new Uint8Array(b);let diff=0;
  for(let i=0;i<av.length;i++) diff|=av[i]^bv[i];
  return diff===0;
}
async function body(request) {
  // Bound actual bytes too, rather than relying on Content-Length.
  const reader=request.body?.getReader();if(!reader) throw new Error('invalid_body');
  const chunks=[];let total=0;
  try {
    while(true) {const {done,value}=await reader.read();if(done) break;total+=value.length;
      if(total>16384) {await reader.cancel();throw new Error('too_large');} chunks.push(value);}
  } finally {reader.releaseLock();}
  const data=new Uint8Array(total);let offset=0;for(const c of chunks){data.set(c,offset);offset+=c.length;}
  try{return JSON.parse(new TextDecoder().decode(data));}catch{throw new Error('invalid_body');}
}
export async function handle(request,env) {
  const path=new URL(request.url).pathname;
  if(path==='/health' && request.method==='GET') return json({status:'alive',service:'riri-cloudflare'});
  if(!await authorized(request,env.BOT_SECRET)) return json({error:'forbidden'},403);
  if(path==='/setup-check' && request.method==='GET') {
    await env.DB.prepare('SELECT 1 FROM messages LIMIT 1').all();
    // Real inference probe, not a falsely asserted model availability flag.
    try {await env.AI.run(MODEL,{messages:[{role:'user',content:'Reply OK.'}],max_tokens:8});}
    catch {return json({error:'ai_unavailable_or_quota',model_ready:false},503);}
    return json({service:'riri-bridge',mode:'cloudflare',model_ready:true,own_user_id:env.OWN_USER_ID,model:MODEL});
  }
  if(request.method!=='POST') return json({error:'not_found'},404);
  let v;try{v=await body(request);}catch(e){return json({error:e.message},e.message==='too_large'?413:400);}
  if(path==='/profile') {
    if(typeof v?.prompt!=='string'||!v.prompt.trim()||v.prompt.length>4000) return json({error:'invalid_profile'},400);
    await env.DB.prepare('INSERT INTO profile(id,prompt) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt').bind(v.prompt).run();
    return json({status:'saved'});
  }
  if(path==='/claim') {
    if(typeof v?.message_id!=='string'||typeof v?.conversation_id!=='string') return json({error:'invalid_fields'},400);
    const row=await env.DB.prepare("UPDATE messages SET status='claimed' WHERE message_id=? AND conversation_id=? AND status='draft' RETURNING reply")
      .bind(v.message_id,v.conversation_id).first();
    return row ? json({reply:row.reply}) : json({error:'already_claimed_or_not_ready'},409);
  }
  if(path==='/ack') {
    if(typeof v?.message_id!=='string'||!['submitted','unsupported','uncertain'].includes(v.status)) return json({error:'invalid_fields'},400);
    await env.DB.prepare("UPDATE messages SET status=? WHERE message_id=? AND status='claimed'").bind(v.status,v.message_id).run();
    return json({status:'recorded'});
  }
  if(path!=='/ingest') return json({error:'not_found'},404);
  if(!validMessage(v)) return json({error:'invalid_fields'},400);
  if(v.sender_id===env.OWN_USER_ID) return json({status:'skipped_own'});
  const inserted=await env.DB.prepare("INSERT OR IGNORE INTO messages(message_id,sender_id,conversation_id,text,timestamp_ms) VALUES(?,?,?,?,?)")
    .bind(v.message_id,v.sender_id,v.conversation_id,v.text,v.timestamp_ms).run();
  if(!inserted.meta.changes) {
    const existing=await env.DB.prepare('SELECT status FROM messages WHERE message_id=?').bind(v.message_id).first();
    return json({status:existing.status,message_id:v.message_id});
  }
  try {
    const profile=await env.DB.prepare('SELECT prompt FROM profile WHERE id=1').first();
    const history=await env.DB.prepare("SELECT text,reply,status FROM messages WHERE sender_id=? AND conversation_id=? AND message_id!=? AND timestamp_ms<=? ORDER BY timestamp_ms DESC LIMIT 6")
      .bind(v.sender_id,v.conversation_id,v.message_id,v.timestamp_ms).all();
    const messages=[{role:'system',content:(profile?.prompt||DEFAULT_PROMPT)+'\n/no_think'}];
    // History is bounded; claimed/submitted are not labelled delivery-confirmed.
    for(const item of history.results.reverse()) {
      messages.push({role:'user',content:item.text.slice(0,1000)});
      if(item.reply&&item.status==='submitted') messages.push({role:'assistant',content:item.reply.slice(0,1000)});
    }
    messages.push({role:'user',content:v.text});
    const result=await env.AI.run(MODEL,{messages,max_tokens:256});
    const reply=replyText(result);
    await env.DB.prepare("UPDATE messages SET status='draft',reply=? WHERE message_id=?").bind(reply,v.message_id).run();
    return json({status:'draft',message_id:v.message_id});
  } catch {
    await env.DB.prepare("UPDATE messages SET status='needs_review' WHERE message_id=?").bind(v.message_id).run();
    return json({error:'generation_unavailable_or_quota',message_id:v.message_id},503);
  }
}
export default {async fetch(request,env) {try{return await handle(request,env);}catch{return json({error:'service_unavailable'},503);}}};
