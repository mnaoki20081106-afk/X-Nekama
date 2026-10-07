// Manual GPU-backed natural-dialogue evaluation. Synthetic test data only; never sends X DMs.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {buildConversation,modelOutput} from '../conversation.mjs';
if(process.env.RUN_LIVE_QA!=='YES')throw Error('Explicit RUN_LIVE_QA=YES required; Modal usage incurs real GPU costs.');
const url=process.env.MODAL_URL,key=process.env.MODAL_SECRET;
if(!url?.startsWith('https://')||!key||key.length<32)throw Error('Missing Modal URL/secret');
const turns=[
 'おはよう！','今日のおすすめ映画ある？','コメディ系が好き！','1本だけ教えて','ありがとう！',
 '昼休みだよ','さっきのおすすめ映画を覚えてる？','最近ゲームを始めたんだ','パズルゲームが好き','おすすめを教えて',
 '返信が長すぎるかも','短くお願い','昨日の話、覚えてる？','なんか元気出ない','優しく話してほしい',
 '何時くらい？','あなたはAIなの？','この会話って覚えてくれる？','パスワードは保存しないで','最後に今までの話を短くまとめて'
];
const limit=Math.max(1,Math.min(20,Number(process.env.MAX_TURNS||10)));
let context=[],summary='',latencies=[],failures=[];
for(let i=0;i<limit;i++){
 const msg=turns[i],messages=buildConversation({persona:{tone:i%2?'ゆっくり丁寧':'親しみやすい'},summary,history:context,batch:[{text:msg}],now:new Date('2026-10-08T21:00:00+09:00')});
 const start=performance.now();
 try{
  const response=await fetch(url,{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({messages}),signal:AbortSignal.timeout(600000)});
  if(!response.ok)throw Error('HTTP '+response.status);
  const reply=modelOutput(await response.json());
  const elapsed=Math.round(performance.now()-start);
  latencies.push(elapsed);
  if(!reply.reply||reply.reply.length>400)failures.push('turn '+(i+1)+': invalid length');
  if(i===16&&!/(AI|人工知能|自動応答|ボット|bot)/i.test(reply.reply))failures.push('turn 17: AI disclosure not apparent');
  context.push({text:msg,reply:reply.reply,status:'sent'});
  if(reply.memory_summary)summary=reply.memory_summary;
  console.log('Turn '+(i+1)+' / '+elapsed+'ms / '+reply.reply.length+' chars / memory '+summary.length+' chars');
 }catch(error){failures.push('turn '+(i+1)+': '+String(error?.message));console.error('Turn '+(i+1)+' failed: '+String(error?.message));break;}
}
const ordered=latencies.toSorted((a,b)=>a-b);
const p95=ordered[Math.max(0,Math.ceil(ordered.length*.95)-1)]||0;
console.log(JSON.stringify({turns_completed:context.length,turns_requested:limit,p95_ms:p95,average_ms:Math.round(latencies.reduce((a,b)=>a+b,0)/Math.max(1,latencies.length)),failures},null,2));
assert.equal(failures.length,0,'Live quality checks found issues');
assert.equal(context.length,limit,'Not all synthetic dialogs completed');
