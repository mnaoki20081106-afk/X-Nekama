import {test} from 'node:test';
import assert from 'node:assert/strict';
import {activeJST,monthJST,parseInbox} from '../worker.mjs';
const jst=(iso)=>new Date(iso);
test('morning/lunch/night JST; no activity at 10AM and 2AM',()=>{
 assert.equal(activeJST(jst('2026-10-07T22:10:00Z')),true);
 assert.equal(activeJST(jst('2026-10-08T03:15:00Z')),true);
 assert.equal(activeJST(jst('2026-10-08T15:30:00Z')),true);
 assert.equal(activeJST(jst('2026-10-08T01:00:00Z')),false);
 assert.equal(activeJST(jst('2026-10-08T17:00:00Z')),false);
});
test('month at JST boundary',()=>{assert.equal(monthJST(jst('2026-09-30T15:01:00Z')),'2026-10');});
test('incoming X legacy DM entries parsed and own messages skipped',()=>{
 const x={inbox_initial_state:{entries:{a:{message:{id:'1234',sender_id:'201',conversation_id:'201-101',message_data:{text:'おはよう',time:12345}}},b:{message:{id:'1235',sender_id:'101',conversation_id:'201-101',message_data:{text:'こっちから',time:12346}}}}}};
 assert.deepEqual(parseInbox(x,'101'),[{sender_id:'201',message_id:'1234',conversation_id:'201-101',text:'おはよう',timestamp_ms:12345}]);
});
test('unknown inbox structure fails closed',()=>assert.throws(()=>parseInbox({errors:[{}]},'101'),/unknown_inbox_format/));
