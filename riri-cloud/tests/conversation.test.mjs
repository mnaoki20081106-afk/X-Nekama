import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_PERSONA,validatePersona,groupReady,buildConversation,modelOutput,redactForMemory,replyWindowJST,jstTime} from '../conversation.mjs';
const at=(s)=>new Date(s);
const msg=(id,cid,time,text,status='queued')=>({message_id:String(id),conversation_id:cid,timestamp_ms:time,text,status});
test('Japanese time boundaries across midnight',()=>{
 const cases=[['2026-10-07T21:59:59Z',false],['2026-10-07T22:00:00Z',true],['2026-10-07T23:59:00Z',true],['2026-10-08T00:00:00Z',false],['2026-10-08T03:00:00Z',true],['2026-10-08T04:30:00Z',false],['2026-10-08T10:00:00Z',true],['2026-10-08T16:00:00Z',true],['2026-10-08T16:00:01Z',false]];
 for(const [iso,want] of cases)assert.equal(replyWindowJST(at(iso)),want,iso);
 assert.equal(jstTime(at('2026-10-08T16:30:00Z')),90);
});
test('burst coalescing waits for most recent arrival and preserves all messages',()=>{
 const now=1000000;
 const a=[msg(1,'10-20',now-200000,'これ'),msg(2,'10-20',now-150000,'それ'),msg(3,'10-20',now-65000,'どう？')];
 assert.deepEqual(groupReady(a,now,60000).map(g=>g.map(v=>v.message_id)),[['1','2','3']]);
 assert.equal(groupReady([...a,msg(4,'10-20',now-10000,'追記')],now,60000).length,0);
 assert.equal(groupReady([...a,msg(5,'30-40',now-100000,'別の人')],now,60000).length,2);
});
test('long bursts are one conversation batch without losing message IDs',()=>{
 const rows=Array.from({length:13},(_,i)=>msg(i+1,'10-20',1000+i,'断片'+i));
 const grouped=groupReady(rows,100000,30000);
 assert.equal(grouped.length,1);assert.equal(grouped[0].length,13);
});
test('persona scope, length and restrictive fields are validated',()=>{
 const v=validatePersona({display_name:'Bot',tone:'大阪弁',interests:['ゲーム'],reply_length:'medium',about:'趣味の案内',interaction:'質問は具体的に'});
 assert.equal(v.tone,'大阪弁');
 assert.throws(()=>validatePersona({hidden_instructions:'hide AI'}),/unknown_persona_field/);
 assert.throws(()=>validatePersona({reply_length:'infinite'}),/invalid_reply_length/);
 assert.throws(()=>validatePersona({interests:Array(20).fill('a')}),/invalid_interests/);
 assert.equal(DEFAULT_PERSONA.display_name,'Riri AI');
});
test('long memory and prior turns are included but capped',()=>{
 const p=validatePersona({tone:'関西弁',interests:['漫画']});
 const payload=buildConversation({persona:p,summary:'漫画の話を覚える',history:[{text:'何読んだ？',reply:'漫画を読んだよ',status:'sent'}],batch:[msg(1,'c',5,'おすすめある？'),msg(2,'c',6,'短めにね')],now:new Date('2026-10-08T14:00:00Z')});
 assert.match(payload[0].content,/自動応答AI/);
 assert.match(payload[0].content,/関西弁/);
 assert.match(payload[1].content,/漫画の話を覚える/);
 assert.deepEqual(payload.slice(-3).map(x=>x.role),['user','assistant','user']);
 assert.match(payload.at(-1).content,/おすすめある？\n短めにね/);
});
test('memory excludes common sensitive strings',()=>{
 assert.equal(redactForMemory('パスワードはabcdef'),'');
 assert.equal(redactForMemory('秘密鍵: x'),'');
 assert.equal(redactForMemory('連絡は test@example.com'), '連絡は [redacted]');
 assert.equal(redactForMemory('好きなゲームはゼルダ'),'好きなゲームはゼルダ');
});
test('model JSON and text parsing, no thinking, invalid output',()=>{
 assert.deepEqual(modelOutput({reply:'{"reply":"了解！","memory_summary":"カレーが好き"}'}),{reply:'了解！',memory_summary:'カレーが好き'});
 assert.deepEqual(modelOutput({reply:'<think>内部</think>ありがとう',memory_summary:'親切な人'}),{reply:'ありがとう',memory_summary:'親切な人'});
 assert.throws(()=>modelOutput({reply:''}),/invalid_model_output/);
 assert.throws(()=>modelOutput({reply:'a'.repeat(2001)}),/invalid_model_output/);
});
