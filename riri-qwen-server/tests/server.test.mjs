import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
const dir=mkdtempSync(join(tmpdir(),'riri-qwen-'));let calls=0,bodies=[];
const fake=http.createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);calls++;const body=JSON.parse(Buffer.concat(chunks));bodies.push(body);res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({choices:[{finish_reason:'stop',message:{content:body.max_completion_tokens===8?'OK':'<think>x</think>自然な返信'}}]}));});
await new Promise(r=>fake.listen(0,'127.0.0.1',r));
process.env.BOT_SECRET='s'.repeat(40);process.env.OWN_USER_ID='123';process.env.RIRI_DB_PATH=join(dir,'test.sqlite');process.env.QWEN_BASE_URL=`http://127.0.0.1:${fake.address().port}`;process.env.QWEN_MODEL='qwen3.8';
const mod=await import(`../server.mjs?${Date.now()}`);after(async()=>{await new Promise(r=>fake.close(r));rmSync(dir,{recursive:true,force:true});});
function req(method,path,value,secret=process.env.BOT_SECRET){const payload=value===undefined?null:Buffer.from(JSON.stringify(value));return{method,url:path,headers:{host:'test','x-bot-secret':secret},async *[Symbol.asyncIterator](){if(payload)yield payload;}};}
function res(){return{status:0,body:null,writeHead(s){this.status=s;},end(v){this.body=v?JSON.parse(Buffer.from(v)):null;}};}
async function call(method,path,value,secret){const r=res();await mod.handle(req(method,path,value,secret),r);return r;}
const msg=(id='m1',extra={})=>({sender_id:'456',message_id:id,conversation_id:'c1',text:'こんにちは',timestamp_ms:1,...extra});
test('setup uses real model and auth',async()=>{assert.equal((await call('GET','/setup-check',undefined,'bad')).status,403);const r=await call('GET','/setup-check');assert.equal(r.status,200);assert.equal(r.body.own_user_id,'123');assert.equal(r.body.model,'qwen3.8');});
test('own messages are skipped',async()=>{const before=calls;const r=await call('POST','/ingest',msg('own',{sender_id:'123'}));assert.equal(r.body.status,'skipped_own');assert.equal(calls,before);});
test('generate once, claim once, ack',async()=>{assert.equal((await call('POST','/ingest',msg())).body.status,'draft');assert.equal((await call('POST','/ingest',msg())).body.status,'draft');const c=await call('POST','/claim',{message_id:'m1',conversation_id:'c1'});assert.deepEqual(c.body.replies,['自然な返信']);assert.equal((await call('POST','/claim',{message_id:'m1',conversation_id:'c1'})).status,409);assert.equal((await call('POST','/ack',{message_id:'m1',status:'submitted'})).status,200);});
test('history and non-thinking config reach Qwen',async()=>{await call('POST','/profile',{prompt:'猫っぽく話す'});await call('POST','/ingest',msg('m2',{text:'元気？',timestamp_ms:2}));const p=bodies.at(-1);assert.equal(p.messages[0].content,'猫っぽく話す');assert.deepEqual(p.messages.slice(1).map(x=>x.role),['user','assistant','user']);assert.equal(p.chat_template_kwargs.enable_thinking,false);});
test('parser strips think',()=>assert.equal(mod.replyText({choices:[{finish_reason:'stop',message:{content:'<think>x</think>返答'}}]}),'返答'));
