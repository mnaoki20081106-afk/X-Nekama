const TRACE_URL='https://www.cloudflare.com/cdn-cgi/trace';

export class VpnEgressError extends Error{
  constructor(message='WARP VPN is not verified'){
    super(message);
    this.name='VpnEgressError';
    this.code='VPN_REQUIRED';
    this.status=503;
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
      headers:{accept:'text/plain'},
      cache:'no-store',
      redirect:'error'
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
    return fetchImpl(input,init);
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
    return fetchImpl(url,{
      method:original.method,
      headers,
      body,
      redirect:'manual'
    });
  };
}
