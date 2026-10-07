import http from 'node:http';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,timingSafeEqual} from 'node:crypto';

const HOST=process.env.RIRI_HOST||'0.0.0.0';
const PORT=Number(process.env.RIRI_PORT||8787);
const DB_PATH=resolve(process.env.RIRI_DB_PATH||'./data/riri.sqlite');
const BOT_SECRET=String(process.env.BOT_SECRET||'');
const OWN_USER_ID=String(process.env.OWN_USER_ID||'');
const QWEN_BASE_URL=String(process.env.QWEN_BASE_URL||'http://127.0.0.1:8000').replace(/\/$/,'');
const QWEN_MODEL=String(process.env.QWEN_MODEL||'qwen3.8');
const QWEN_API_KEY=String(process.env.QWEN_API_KEY||'');
const TIMEOUT=Number(process.env.QWEN_TIMEOUT_MS||90000);
const DEFAULT_PROMPT=String(process.env.SYSTEM_PROMPT||'あなたはXのDMで自然に会話する日本語AIです。会話履歴を踏まえ、短く自然に返答してください。返答本文だけを書いてください。');
if(BOT_SECRET.length<32)throw new Error('BOT_SECRET must be 32+ characters');
if(!/^\d{1,30}$/.test(OWN_USER_ID))throw new Error('OWN_USER_ID must be the numeric X user id');
mkdirSync(dirname(DB_PATH),{recursive:true});
const db=new DatabaseSync(DB_PATH);
db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'));

const send=(res,status,value)=>{const body=Buffer.from(JSON.stringify(value));res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':body.length});res.end(body);};
const digest=v=>createHash('sha256').update(String(v)).digest();
function authorized(req){const incoming=String(req.headers['x-bot-secret']||'');return !!incoming&&timingSafeEqual(digest(incoming),digest(BOT_SECRET));}
async function readJSON(req,max=16384){let size=0,chunks=[];for await(const c of req){size+=c.length;if(size>max)throw Object.assign(new Error('too_large'),{status:413});chunks.push(c);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('invalid_body'),{status:400});}}
const text=(v,max)=>typeof v==='string'&&v.trim()&&v.length<=max?v.trim():'';
function validMessage(v){return v&&text(v.sender_id,64)&&text(v.message_id,200)&&text(v.conversation_id,200)&&text(v.text,4000)&&Number.isSafeInteger(v.timestamp_ms)&&v.timestamp_ms>=0;}
export function replyText(result){const choice=result?.choices?.[0];if(!choice||choice.finish_reason==='length')throw new Error('incomplete_reply');const out=String(choice.message?.content??'').replace(/<think>[\s\S]*?<\/think>/gi,'').replace(/<\/?think>/gi,'').trim();if(!out||out.length>4000)throw new Error('invalid_model_output');return out;}
async function qwen(messages,maxTokens=256){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),TIMEOUT);try{const response=await fetch(`${QWEN_BASE_URL}/v1/chat/completions`,{method:'POST',signal:controller.signal,headers:{'content-type':'application/json',...(QWEN_API_KEY?{authorization:`Bearer ${QWEN_API_KEY}`}:{})},body:JSON.stringify({model:QWEN_MODEL,messages,temperature:0.7,top_p:0.8,top_k:20,max_completion_tokens:maxTokens,chat_template_kwargs:{enable_thinking:false,preserve_thinking:false}})});if(!response.ok)throw new Error(`qwen_http_${response.status}`);return response.json();}finally{clearTimeout(timer);}}
async function generate(v){const profile=db.prepare('SELECT prompt FROM profile WHERE id=1').get();const messages=[{role:'system',content:String(profile?.prompt||DEFAULT_PROMPT).slice(0,8000)}];const history=db.prepare("SELECT text,reply,status FROM messages WHERE conversation_id=? AND message_id<>? AND timestamp_ms<=? ORDER BY timestamp_ms DESC LIMIT 12").all(v.conversation_id,v.message_id,v.timestamp_ms).reverse();for(const row of history){messages.push({role:'user',content:String(row.text).slice(0,1600)});if(row.reply&&row.status==='submitted')messages.push({role:'assistant',content:String(row.reply).slice(0,1600)});}messages.push({role:'user',content:v.text});return replyText(await qwen(messages));}

export async function handle(req,res){
 const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
 if(req.method==='GET'&&url.pathname==='/health')return send(res,200,{ok:true,service:'riri-qwen-server'});
 if(!authorized(req))return send(res,403,{error:'forbidden'});
 if(req.method==='GET'&&url.pathname==='/setup-check'){try{replyText(await qwen([{role:'user',content:'「OK」だけ返してください。'}],8));return send(res,200,{service:'riri-bridge',mode:'self-hosted',model_ready:true,own_user_id:OWN_USER_ID,model:QWEN_MODEL});}catch(error){return send(res,503,{error:'model_unavailable',model_ready:false,detail:String(error?.message||error)});}}
 if(req.method!=='POST')return send(res,404,{error:'not_found'});
 let v;try{v=await readJSON(req);}catch(error){return send(res,error.status||400,{error:error.message});}
 if(url.pathname==='/profile'){const prompt=text(v?.prompt,8000);if(!prompt)return send(res,400,{error:'invalid_profile'});db.prepare("INSERT INTO profile(id,prompt) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET prompt=excluded.prompt").run(prompt);return send(res,200,{status:'saved'});}
 if(url.pathname==='/claim'){const mid=text(v?.message_id,200),cid=text(v?.conversation_id,200);if(!mid||!cid)return send(res,400,{error:'invalid_fields'});const row=db.prepare("UPDATE messages SET status='claimed',updated_at=datetime('now') WHERE message_id=? AND conversation_id=? AND status='draft' RETURNING reply").get(mid,cid);return row?send(res,200,{reply:row.reply,replies:[row.reply]}):send(res,409,{error:'already_claimed_or_not_ready'});}
 if(url.pathname==='/ack'){const mid=text(v?.message_id,200),status=String(v?.status||'');if(!mid||!['submitted','unsupported','uncertain'].includes(status))return send(res,400,{error:'invalid_fields'});db.prepare("UPDATE messages SET status=?,updated_at=datetime('now') WHERE message_id=? AND status='claimed'").run(status,mid);return send(res,200,{status:'recorded'});}
 if(url.pathname!=='/ingest')return send(res,404,{error:'not_found'});
 if(!validMessage(v))return send(res,400,{error:'invalid_fields'});
 if(v.sender_id===OWN_USER_ID)return send(res,200,{status:'skipped_own'});
 const inserted=db.prepare("INSERT OR IGNORE INTO messages(message_id,sender_id,conversation_id,text,timestamp_ms,status) VALUES(?,?,?,?,?,'generating')").run(v.message_id,v.sender_id,v.conversation_id,v.text,v.timestamp_ms);
 if(!inserted.changes){const row=db.prepare('SELECT status FROM messages WHERE message_id=?').get(v.message_id);return send(res,200,{status:row?.status||'unknown',message_id:v.message_id});}
 try{const reply=await generate(v);db.prepare("UPDATE messages SET status='draft',reply=?,updated_at=datetime('now') WHERE message_id=?").run(reply,v.message_id);return send(res,200,{status:'draft',message_id:v.message_id});}catch(error){db.prepare("UPDATE messages SET status='needs_review',updated_at=datetime('now') WHERE message_id=?").run(v.message_id);return send(res,503,{error:'generation_unavailable',message_id:v.message_id,detail:String(error?.message||error)});}
}

if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){const server=http.createServer((req,res)=>handle(req,res).catch(error=>{console.error(error);if(!res.headersSent)send(res,500,{error:'internal_error'});}));server.listen(PORT,HOST,()=>console.log(`Riri bridge ${HOST}:${PORT} -> ${QWEN_MODEL} @ ${QWEN_BASE_URL}`));for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>server.close(()=>{db.close();process.exit(0);}));}
