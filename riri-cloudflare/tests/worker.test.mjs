import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker, {replyText} from '../worker.mjs';

function fixture(t) {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../schema.sql',import.meta.url),'utf8'));
  t.after(()=>sqlite.close());
  // Run production SQL against real SQLite, with the D1 result contract.
  const DB={prepare(sql) {
    let values=[];const statement=sqlite.prepare(sql);
    return {bind(...args){values=args;return this;},
      async run(){const r=statement.run(...values);return {meta:{changes:Number(r.changes)}};},
      async first(){return statement.get(...values)||null;},
      async all(){return {results:statement.all(...values)};}};
  }};
  let calls=0;const inputs=[];
  const env={DB,BOT_SECRET:'a'.repeat(43),OWN_USER_ID:'123',AI:{async run(model,input){calls++;inputs.push(input);return {choices:[{finish_reason:'stop',message:{content:'こんにちは！',reasoning_content:'private'}}]};}}};
  const request=(path,value,secret=env.BOT_SECRET)=>worker.fetch(new Request('https://example.workers.dev'+path,{method:value===undefined?'GET':'POST',headers:{'X-Bot-Secret':secret},body:value===undefined?undefined:JSON.stringify(value)}),env);
  return {env,request,sqlite,inputs,get calls(){return calls;}};
}
const msg=(id='m1',extra={})=>({sender_id:'456',message_id:id,conversation_id:'c1',text:'こんにちは',timestamp_ms:1,...extra});

test('setup probes real AI; credentials required; own messages never stored',async t=>{
  const f=fixture(t);
  assert.equal((await f.request('/setup-check',undefined,'wrong')).status,403);
  assert.equal(f.calls,0);
  assert.equal((await (await f.request('/setup-check')).json()).model_ready,true);
  assert.equal(f.calls,1);
  assert.equal((await (await f.request('/ingest',msg('own',{sender_id:'123'}))).json()).status,'skipped_own');
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM messages').get().n,0);
  f.env.AI.run=async()=>{throw new Error('quota');};
  assert.equal((await f.request('/setup-check')).status,503);
});
test('duplicates generate once; concurrent claims return one reply; acknowledgements cannot reopen',async t=>{
  const f=fixture(t);
  const replies=await Promise.all([f.request('/ingest',msg()),f.request('/ingest',msg())]);
  assert.equal(f.calls,1);assert.ok(replies.every(r=>r.status===200));
  const claim={message_id:'m1',conversation_id:'c1'};
  assert.equal((await f.request('/claim',{...claim,conversation_id:'wrong'})).status,409);
  const claimed=await Promise.all([f.request('/claim',claim),f.request('/claim',claim)]);
  assert.deepEqual(claimed.map(r=>r.status).sort(),[200,409]);
  assert.equal((await claimed.find(r=>r.status===200).json()).reply,'こんにちは！');
  assert.equal((await f.request('/ack',{message_id:'m1',status:'draft'})).status,400);
  await f.request('/ack',{message_id:'m1',status:'submitted'});
  await f.request('/ack',{message_id:'m1',status:'unsupported'});
  assert.equal(f.sqlite.prepare('SELECT status FROM messages').get().status,'submitted');
  assert.equal((await f.request('/claim',claim)).status,409);
});
test('AI quota or incomplete output stops generation without retrying a duplicate',async t=>{
  const f=fixture(t);f.env.AI.run=async()=>{throw new Error('quota');};
  assert.equal((await f.request('/ingest',msg())).status,503);
  assert.equal((await (await f.request('/ingest',msg())).json()).status,'needs_review');
  assert.equal((await f.request('/claim',{message_id:'m1',conversation_id:'c1'})).status,409);
  assert.throws(()=>replyText({choices:[{finish_reason:'length',message:{content:'partial'}}]}));
  assert.throws(()=>replyText({response:'<think>unfinished'}));
  assert.equal(replyText({response:'<think>private</think>返答'}),'返答');
});
test('saved persona is used and conversation history is isolated',async t=>{
  const f=fixture(t);
  await f.request('/profile',{prompt:'猫のキャラクター'});
  await f.request('/ingest',msg('other',{conversation_id:'c2',text:'別の会話'}));
  await f.request('/ingest',msg('first'));
  await f.request('/claim',{message_id:'first',conversation_id:'c1'});
  await f.request('/ack',{message_id:'first',status:'submitted'});
  await f.request('/ingest',msg('next',{text:'元気？',timestamp_ms:2}));
  const messages=f.inputs.at(-1).messages;
  assert.equal(messages[0].content,'猫のキャラクター\n/no_think');
  assert.ok(!messages.some(m=>m.content==='別の会話'));
  assert.deepEqual(messages.slice(1).map(m=>m.role),['user','assistant','user']);
});
test('malformed payload and actual oversized streamed bytes are rejected',async t=>{
  const f=fixture(t);
  assert.equal((await f.request('/ingest',null)).status,400);
  assert.equal((await f.request('/ingest',msg('bad',{timestamp_ms:-1}))).status,400);
  const r=await worker.fetch(new Request('https://example/ingest',{method:'POST',headers:{'X-Bot-Secret':f.env.BOT_SECRET},body:new ReadableStream({start(c){c.enqueue(new Uint8Array(17000));c.close();}}),duplex:'half'}),f.env);
  assert.equal(r.status,413);assert.equal(f.calls,0);
});
