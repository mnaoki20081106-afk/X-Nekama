import {TRACE_URL,validExitConfig,verifiedGateway} from './exit-policy.mjs';

export class VpnEgressError extends Error{
  constructor(message='WARP VPN is not verified'){
    super(message);
    this.name='VpnEgressError';
    this.code='VPN_REQUIRED';
    this.status=503;
    this.deliveryStage='preflight';
  }
}

export function isAllowedXTarget(input){
  try{
    const url=input instanceof URL?input:new URL(String(input));
    if(url.protocol!=='https:'||url.username||url.password||(url.port&&url.port!=='443'))return false;
    const h=url.hostname.toLowerCase();
    return h==='x.com'||h.endsWith('.x.com')||
      h==='twitter.com'||h.endsWith('.twitter.com')||
      h==='twimg.com'||h.endsWith('.twimg.com');
  }catch{return false}
}

export function traceHasWarp(text){
  return /(?:^|\n)warp=(?:on|plus)(?:\n|$)/.test(String(text||'').replace(/\r/g,''));
}

export async function probeWarp(fetchImpl=globalThis.fetch){
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation is required');
  try{
    const response=await fetchImpl(TRACE_URL,{
      method:'GET',
      headers:{accept:'text/plain','cache-control':'no-cache'},
      redirect:'error',signal:AbortSignal.timeout(3000)
    });
    const text=await response.text();
    return {ready:response.status===200&&traceHasWarp(text),status:response.status};
  }catch(error){
    return {ready:false,status:0,error:String(error?.message||error)};
  }
}

export function createVerifiedEgressFetch({fetchImpl=globalThis.fetch}={}){
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation is required');
  return async function verifiedEgressFetch(input,init){
    const check=await probeWarp(fetchImpl);
    if(!check.ready)throw new VpnEgressError();
    const timeout=AbortSignal.timeout(30000);
    return fetchImpl(input,{...init,signal:init?.signal?AbortSignal.any([init.signal,timeout]):timeout});
  };
}

export function createRemoteEgressFetch({endpoint,token,fetchImpl=globalThis.fetch,exitMode='warp',expectedIP='',expectedCountry='JP'}={}){
  const base=String(endpoint||'').trim();
  const secret=String(token||'');
  if(!base)throw new VpnEgressError('VPN egress endpoint is not configured');
  const url=new URL(base);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname)){
    throw new Error('VPN egress endpoint must use HTTPS');
  }
  if(secret.length<24)throw new Error('VPN egress token must be at least 24 characters');
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation is required');
  if(!['warp','shared'].includes(exitMode)||(exitMode==='shared'&&!validExitConfig(expectedIP,expectedCountry)))throw new VpnEgressError('共通出口のIPv4・国コードを設定してください');

  return async function remoteEgressFetch(input,init){
    if(exitMode==='shared'){
     try{
      const health=new URL(url);health.pathname=health.pathname.replace(/\/fetch\/?$/,'/healthz');health.search='';
      const response=await fetchImpl(health,{headers:{'x-xnekama-egress-token':secret},redirect:'error',signal:AbortSignal.timeout(3000)});
      if(response.status!==200||!verifiedGateway(await response.json(),{mode:exitMode,ip:expectedIP,country:expectedCountry}))throw new VpnEgressError('共通VPN出口を確認できません');
     }catch(error){throw error instanceof VpnEgressError?error:new VpnEgressError('共通VPN出口の確認が失敗しました');}
    }
    const original=new Request(input,init);
    const headers=new Headers(original.headers);
    headers.set('x-xnekama-target',original.url);
    headers.set('x-xnekama-egress-token',secret);
    headers.set('x-xnekama-redirect',original.redirect||'follow');
    const body=['GET','HEAD'].includes(original.method)?undefined:await original.arrayBuffer();
    const response=await fetchImpl(url,{
      method:original.method,
      headers,
      body,
      redirect:'manual',signal:AbortSignal.any([original.signal,AbortSignal.timeout(30000)])
    });
    if(response.headers.get('x-xnekama-egress-error')==='VPN_REQUIRED'){
      throw new VpnEgressError();
    }
    return response;
  };
}
