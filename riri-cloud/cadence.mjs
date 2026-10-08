/**
 * Reply timing is based on the actual conversation rhythm, never a random
 * imitation of human typing. GPU cold starts and X polling are outside this.
 * Pure functions shared by Worker and Node tests.
 */
const modes={
 adaptive:{active:4500,new:18000,resumed:75000},
 quick:{active:2500,new:8000,resumed:30000},
 relaxed:{active:12000,new:45000,resumed:135000}
};
export function cadence({lastSentMs=0,lastInboundMs=0,nowMs=Date.now(),mode='adaptive'}={}){
 const times=modes[mode]||modes.adaptive;
 const validSent=Number.isFinite(lastSentMs)&&lastSentMs>0&&lastSentMs<=nowMs;
 const elapsed=validSent?nowMs-lastSentMs:Infinity;
 const active=validSent&&elapsed<=4*60*1000;
 const resumed=validSent&&elapsed>=35*60*1000;
 const kind=active?'active':resumed?'resumed':'new';
 // Idle is short between rapid turns; longer after a long break.
 const quietMs=times[kind];
 return {kind,quietMs,mode:modes[mode]?mode:'adaptive'};
}
export function dueForBatch(batch,activity={},settings={},nowMs=Date.now()){
 if(!batch.length)throw Error('empty_batch');
 const latest=batch.at(-1);
 const choice=cadence({
   lastSentMs:Number(activity.last_sent_ms)||0,
   lastInboundMs:Number(activity.last_inbound_ms)||0,
   nowMs:Math.max(nowMs,latest.timestamp_ms),
   mode:settings.mode||'adaptive'
 });
 const at=latest.timestamp_ms+choice.quietMs;
 return {...choice,at,ready:at<=nowMs};
}
export function validPace(mode){return Object.hasOwn(modes,mode);}
