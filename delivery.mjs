import {createHash} from 'node:crypto';

const normalize=text=>String(text??'').normalize('NFKC').replace(/\s+/g,' ').trim();

export function fingerprintPost(text){
 return createHash('sha256').update(normalize(text)).digest('hex');
}

function numericStatus(error){
 for(const value of [error?.status,error?.statusCode,error?.response?.status,error?.code]){
  const n=Number(value);
  if(Number.isInteger(n)&&n>=100&&n<=599)return n;
 }
 return 0;
}

function retryAfterMs(error){
 const raw=error?.retryAfterMs??error?.retry_after_ms??error?.response?.headers?.get?.('retry-after');
 if(raw==null)return 0;
 const n=Number(raw);
 if(Number.isFinite(n)&&n>0)return n>1000?n:n*1000;
 const at=Date.parse(String(raw));
 return Number.isFinite(at)?Math.max(0,at-Date.now()):0;
}

export function classifyDeliveryError(error,stage=error?.deliveryStage||'preflight'){
 const message=String(error?.message||error||'投稿処理に失敗しました');
 const lower=message.toLowerCase();
 const status=numericStatus(error);
 if(status===429||/too many requests|rate.?limit|429/.test(lower)){
  return {kind:'rate_limit',retryable:true,ambiguous:false,retryAfterMs:retryAfterMs(error),message};
 }
 if(status===401||status===403||/unauthori[sz]ed|forbidden|authentication|login|expired|temporarily locked/.test(lower)){
  return {kind:'auth',retryable:false,ambiguous:false,retryAfterMs:0,message};
 }
 if((status>=400&&status<500)||/duplicate|not allowed|not permitted|invalid|unsupported|character count|media ids|permission/.test(lower)){
  return {kind:'rejected',retryable:false,ambiguous:false,retryAfterMs:0,message};
 }
 const transient=status>=500||/fetch failed|timeout|timed out|socket|network|econnreset|econnrefused|enotfound|service unavailable/.test(lower);
 if(stage==='submit'){
  return {kind:'ambiguous',retryable:false,ambiguous:true,retryAfterMs:0,message};
 }
 if(transient){
  return {kind:'transient',retryable:true,ambiguous:false,retryAfterMs:retryAfterMs(error),message};
 }
 return {kind:'unknown',retryable:false,ambiguous:false,retryAfterMs:0,message};
}

export function retryDelayMs(kind,attempt,retryAfter=0){
 if(Number.isFinite(retryAfter)&&retryAfter>0)return Math.min(6*60*60*1000,Math.max(30_000,retryAfter));
 const index=Math.max(0,Math.min(2,Number(attempt||1)-1));
 const table=kind==='rate_limit'?[60_000,5*60_000,15*60_000]:[30_000,2*60_000,5*60_000];
 return table[index];
}
