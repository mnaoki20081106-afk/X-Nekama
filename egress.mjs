const TRACE_URL='https://www.cloudflare.com/cdn-cgi/trace';

export class VpnEgressError extends Error{
  constructor(message='WARP VPN is not verified'){
    super(message);
    this.name='VpnEgressError';
    this.code='VPN_REQUIRED';
    this.status=503;
    this.deliveryStage='preflight';
  }
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

export function createRemoteEgressFetch({endpoint,token,fetchImpl=globalThis.fetch}={}){
  const base=String(endpoint||'').trim();
  const secret=String(token||'');
  if(!base)throw new VpnEgressError('VPN egress endpoint is not configured');
  const url=new URL(base);
  if(url.protocol!=='https:'&&!['localhost','127.0.0.1','::1'].includes(url.hostname)){
    throw new Error('VPN egress endpoint must use HTTPS');
  }
  if(secret.length<24)throw new Error('VPN egress token must be at least 24 characters');
  if(typeof fetchImpl!=='function')throw new TypeError('fetch implementation is required');

  return async function remoteEgressFetch(input,init){
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
