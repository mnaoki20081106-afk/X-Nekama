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
