import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker,{cycle} from '../worker.mjs';
const ddl=readFileSync(new URL('../schema.sql',import.meta.url),'utf8');
const DAY=new Date('2026-10-08T12:02:00+09:00').getTime();
function makeDB(){
 const sql=new DatabaseSync(':memory:');sql.exec(ddl);
 return {
  raw:sql,
  prepare(query){return{
    bind(...args){return{
      async first(){return sql.prepare(query).get(...args)||null;},
      async all(){return{results:sql.prepare(query).all(...args)};},
      async run(){const o=sql.prepare(query).run(...args);return{meta:{changes:Number(o.changes)}};}
    }},
    async first(){return sql.prepare(query).get()||null;},
    async all(){return{results:sql.prepare(query).all()};},
    async run(){const o=sql.prepare(query).run();return{meta:{changes:Number(o.changes)}};}
  }}
 };
}
function context(overrides={}){
 const DB=makeDB();
 const env={DB,OWN_USER_ID:'101',BOT_SECRET:'b'.repeat(40),ADMIN_SECRET:'a'.repeat(40),
 MODAL_URL:'https://modal.test/api',MODAL_SECRET:'m'.repeat(40),
 X_POLL_ENABLED:'false',AUTO_SEND_ENABLED:'true',X_POLL_EVERY_MINUTES:'2',
 DM_QUIET_MS:'60000',ESTIMATED_REQUEST_CENTS:'1',INTERNAL_FREE_CENTS:'100',...overrides};
 return env;
}
function dm(id,cid,when,text){return{sender_id:'201',message_id:String(id),conversation_id:cid,text,timestamp_ms:when};}
async function ingest(env,data){const resp=await worker.fetch(new Request('https://worker.test/ingest',{method:'POST',headers:{'x-bot-secret':env.BOT_SECRET,'content-type':'application/json'},body:JSON.stringify(data)}),env);assert.equal(resp.status,200);return resp.json();}
async function admin(env,route,method='GET',data){const init={method,headers:{'x-admin-secret':env.ADMIN_SECRET}};if(data){init.headers['content-type']='application/json';init.body=JSON.stringify(data);}const response=await worker.fetch(new Request('https://worker.test'+route,init),env);return {status:response.status,json:await response.json()};}
test('persona admin CRUD and scoped profile fallback',async()=>{
 const env=context();const r=await admin(env,'/admin/profile?conversation_id=101-201');
 assert.equal(r.json.persona.display_name,'Riri AI');
 const saved=await admin(env,'/admin/profile?conversation_id=101-201','POST',{persona:{display_name:'Guide',tone:'関西弁',interests:['映画']}});
 assert.equal(saved.status,200);assert.equal(saved.json.persona.tone,'関西弁');
 const found=await admin(env,'/admin/profile?conversation_id=101-201');
 assert.equal(found.json.persona.display_name,'Guide');
 assert.equal((await admin(env,'/admin/profile?conversation_id=101-201','DELETE')).status,200);
 assert.equal((await admin(env,'/admin/profile?conversation_id=101-201')).json.persona.display_name,'Riri AI');
 assert.equal((await admin(env,'/admin/profile?conversation_id=bad','POST',{persona:{tone:'a'}})).status,400);
});
test('batch one reply, durable memory and subsequent conversation context',async()=>{
 const env=context();const requests=[];const original=globalThis.fetch;
 globalThis.fetch=async(url,opts)=>{requests.push(JSON.parse(opts.body));return Response.json({reply:'まとめて答えるね！',memory_summary:'カレーが好き'});};
 try{
  await ingest(env,dm(100,'101-201',DAY-180000,'こんにちは'));
  await ingest(env,dm(101,'101-201',DAY-90000,'お昼はカレー'));
  assert.equal((await cycle(env,DAY)).generated,1);
  const rows=env.DB.raw.prepare("SELECT message_id,status,reply FROM messages ORDER BY message_id").all();
  assert.deepEqual(rows.map(x=>x.status),['rolled_up','draft']);
  assert.equal(requests.length,1);assert.match(requests[0].messages.at(-1).content,/こんにちは\nお昼はカレー/);
  assert.equal((await admin(env,'/admin/memory?conversation_id=101-201')).json.memory.summary,'カレーが好き');
  await ingest(env,dm(102,'101-201',DAY+1000,'覚えてる？'));
  assert.equal((await cycle(env,DAY+190000)).generated,0); // draft blocks out-of-order response
  env.DB.raw.prepare("UPDATE messages SET status='sent' WHERE message_id='101'").run();
  const next=await cycle(env,DAY+190000);assert.equal(next.generated,1);
  assert.match(requests.at(-1).messages[1].content,/カレーが好き/);
  assert.equal((await admin(env,'/admin/memory?conversation_id=101-201','DELETE')).status,200);
  assert.equal((await admin(env,'/admin/memory?conversation_id=101-201')).json.memory,null);
  const metrics=await admin(env,'/admin/metrics');assert.equal(metrics.json.inference.completed,2);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});
test('budget stops before second request and waits for explicit approval',async()=>{
 const env=context({INTERNAL_FREE_CENTS:'1'});let requests=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{requests++;return Response.json({reply:'よろしく！',memory_summary:''});};
 try{
  await ingest(env,dm(100,'101-201',DAY-180000,'最初'));
  assert.equal((await cycle(env,DAY)).generated,1);
  await ingest(env,dm(200,'101-202',DAY-180000,'2件目'));
  const result=await cycle(env,DAY);assert.equal(result.blocked,1);
  assert.equal(requests,1);
  assert.equal(env.DB.raw.prepare("SELECT status FROM messages WHERE message_id='200'").get().status,'awaiting_approval');
  assert.equal((await admin(env,'/admin/approve','POST',{month:'2026-10',additional_usd_cents:1,confirm:false})).status,400);
  assert.equal((await admin(env,'/admin/approve','POST',{month:'2026-10',additional_usd_cents:1,confirm:true})).status,200);
  assert.equal(env.DB.raw.prepare("SELECT status FROM messages WHERE message_id='200'").get().status,'queued');
  assert.equal((await cycle(env,DAY)).generated,1);assert.equal(requests,2);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});
test('wrong admin key cannot inspect stored profile/memory',async()=>{
 const env=context();const res=await worker.fetch(new Request('https://worker.test/admin/memory?conversation_id=101-201',{headers:{'x-admin-secret':'wrong'}}),env);assert.equal(res.status,403);
});

test('GPU model readiness requires an explicitly confirmed real inference check',async()=>{
 const env=context();
 const first=await worker.fetch(new Request('https://worker.test/setup-check',{headers:{'x-bot-secret':env.BOT_SECRET}}),env);
 assert.equal((await first.json()).model_ready,false);
 assert.equal((await admin(env,'/admin/check-model','POST',{confirm_compute_cost:false})).status,400);
 let calls=0;const original=globalThis.fetch;
 globalThis.fetch=async()=>{calls++;return Response.json({reply:'こんにちは！',memory_summary:''});};
 try{
  const verified=await admin(env,'/admin/check-model','POST',{confirm_compute_cost:true});
  assert.equal(verified.status,200);assert.equal(verified.json.model_ready,true);assert.equal(calls,1);
  const ready=await worker.fetch(new Request('https://worker.test/setup-check',{headers:{'x-bot-secret':env.BOT_SECRET}}),env);
  assert.equal((await ready.json()).model_ready,true);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});

test('mock X legacy inbox → Qwen → X send exactly once even when polled twice',async()=>{
 const env=context({X_POLL_ENABLED:'true',X_AUTH_TOKEN:'test-token',X_CT0:'test-csrf',X_WEB_BEARER:'test-bearer'});
 env.DB.raw.prepare("INSERT INTO settings(key,value) VALUES('x_initialized','1')").run();
 const calls=[];const original=globalThis.fetch;
 globalThis.fetch=async(input,init={})=>{
  const url=String(input),method=init.method||'GET';calls.push({url,method});
  if(url.includes('inbox_initial_state'))return Response.json({inbox_initial_state:{entries:{a:{message:{id:'1001',sender_id:'201',conversation_id:'101-201',message_data:{text:'映画おすすめある？',time:DAY-120000}}}}}});
  if(url.includes('modal.test'))return Response.json({reply:'{"reply":"コメディはいかが？","memory_summary":"映画が好き"}'});
  if(url.includes('dm/new2.json'))return Response.json({status:'success'});
  throw Error('unexpected_mock_url');
 };
 try{
  assert.equal((await cycle(env,DAY)).generated,1);
  assert.equal(env.DB.raw.prepare("SELECT status FROM messages WHERE message_id='1001'").get().status,'sent');
  assert.equal((await cycle(env,DAY+120000)).generated,0);
  assert.equal(calls.filter(x=>x.url.includes('dm/new2')).length,1);
  assert.equal(calls.filter(x=>x.url.includes('modal.test')).length,1);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});
test('failed or ambiguous X POST is never retried automatically',async()=>{
 const env=context({X_POLL_ENABLED:'true',X_AUTH_TOKEN:'a',X_CT0:'b',X_WEB_BEARER:'c'});
 env.DB.raw.prepare("INSERT INTO settings(key,value) VALUES('x_initialized','1')").run();
 let sends=0;const original=globalThis.fetch;
 globalThis.fetch=async(input)=>{
  const u=String(input);
  if(u.includes('inbox_initial_state'))return Response.json({inbox_initial_state:{entries:{a:{message:{id:'1001',sender_id:'201',conversation_id:'101-201',message_data:{text:'やあ',time:DAY-120000}}}}}});
  if(u.includes('modal.test'))return Response.json({reply:'こんにちは！'});
  if(u.includes('dm/new2')){sends++;return Response.json({error:'possibly_accepted'}, {status:502});}
  throw Error('unexpected_mock_url');
 };
 try{
  await cycle(env,DAY);
  assert.equal(env.DB.raw.prepare("SELECT status FROM messages WHERE message_id='1001'").get().status,'uncertain');
  await cycle(env,DAY+120000);
  assert.equal(sends,1);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});

test('adaptive DM rally is ready a few seconds after latest message',async()=>{
 const env=context({X_POLL_ENABLED:'false'});
 const cid='101-201';
 env.DB.raw.prepare("INSERT INTO conversation_activity(conversation_id,last_sent_ms) VALUES(?,?)").run(cid,DAY-10000);
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({reply:'うん！',memory_summary:''})};
 try{
  await ingest(env,dm(77,cid,DAY-2000,'そうそう'));
  const soon=await cycle(env,DAY);assert.equal(soon.generated,0);
  assert.equal((await cycle(env,DAY+2499)).generated,0);
  assert.equal((await cycle(env,DAY+2500)).generated,1);
  assert.equal(requests,1);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});
test('resumed DM waits longer and later message postpones the reply',async()=>{
 const env=context({X_POLL_ENABLED:'false'});
 const cid='101-201';
 env.DB.raw.prepare("INSERT INTO conversation_activity(conversation_id,last_sent_ms) VALUES(?,?)").run(cid,DAY-3600000);
 const original=globalThis.fetch;let requests=0;
 globalThis.fetch=async()=>{requests++;return Response.json({reply:'また話そう',memory_summary:''})};
 try{
  await ingest(env,dm(77,cid,DAY-50000,'久しぶり'));
  await ingest(env,dm(78,cid,DAY-1000,'追記だよ'));
  assert.equal((await cycle(env,DAY+50000)).generated,0);
  assert.equal((await cycle(env,DAY+74000)).generated,1);
  assert.equal(requests,1);
 }finally{globalThis.fetch=original;env.DB.raw.close();}
});
