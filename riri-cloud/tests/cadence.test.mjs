import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cadence,dueForBatch,validPace} from '../cadence.mjs';
const h=60*60*1000;
const base=1_800_000_000_000;
test('a live reply-rally gets a short debounced response',()=>{
 const t=cadence({lastSentMs:base-20000,nowMs:base});
 assert.equal(t.kind,'active');assert.equal(t.quietMs,4500);
 assert.deepEqual(dueForBatch([{timestamp_ms:base-8000},{timestamp_ms:base-4500}],{last_sent_ms:base-20000},{mode:'adaptive'},base).ready,true);
 assert.equal(dueForBatch([{timestamp_ms:base-2000}],{last_sent_ms:base-20000},{mode:'adaptive'},base).ready,false);
});
test('first new DM and resuming after an hour use different pacing',()=>{
 assert.equal(cadence({nowMs:base}).quietMs,18000);
 assert.equal(cadence({lastSentMs:base-h,nowMs:base}).quietMs,75000);
 assert.equal(cadence({lastSentMs:base-5*h,nowMs:base,mode:'relaxed'}).quietMs,135000);
});
test('quick and relaxed modes are explicit; unknown reverts to adaptive',()=>{
 assert.equal(validPace('quick'),true);
 assert.equal(validPace('relaxed'),true);
 assert.equal(validPace('other'),false);
 assert.equal(cadence({lastSentMs:base-3000,nowMs:base,mode:'quick'}).quietMs,2500);
 assert.equal(cadence({lastSentMs:base-3000,nowMs:base,mode:'relaxed'}).quietMs,12000);
 assert.equal(cadence({lastSentMs:base-3000,nowMs:base,mode:'other'}).quietMs,4500);
});
test('new incoming message postpones just that conversation',()=>{
 const a=[{timestamp_ms:base-10000}];
 const b=[{timestamp_ms:base-10000},{timestamp_ms:base-1000}];
 const recent={last_sent_ms:base-5000};
 assert.equal(dueForBatch(a,recent,{},base).ready,true);
 assert.equal(dueForBatch(b,recent,{},base).ready,false);
});
test('future timestamps never dispatch early',()=>{
 assert.equal(dueForBatch([{timestamp_ms:base+60000}],{}, {},base).ready,false);
});
