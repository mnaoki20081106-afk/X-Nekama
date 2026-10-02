import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {createVerifiedEgressFetch,isAllowedXTarget,probeWarp} from './egress.mjs';
import {serverVPN} from './vpn.mjs';

const host=process.env.X_EGRESS_HOST||'127.0.0.1';
const port=Number(process.env.X_EGRESS_PORT||8788);
const token=String(process.env.X_EGRESS_TOKEN||'');
const maxBody=Number(process.env.X_EGRESS_MAX_BODY||12*1024*1024);
if(token.length<24)throw new Error('X_EGRESS_TOKEN must be at least 24 characters');

const transport=process.env.X_VPN_MODE==='gluetun'?serverVPN.fetch:globalThis.fetch;
const verifiedFetch=createVerifiedEgressFetch({fetchImpl:transport});
const sameToken=value=>{
  const a=Buffer.from(String(value||'')),b=Buffer.from(token);
  return a.length===b.length&&timingSafeEqual(a,b);
};
const json=(res,status,data,headers={})=>{
  const body=Buffer.from(JSON.stringify(data));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','content-length':body.length,...headers});
  res.end(body);
};
async function readBody(req){
  const chunks=[];let size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>maxBody)throw Object.assign(new Error('request body too large'),{status:413});
    chunks.push(chunk);
  }
  return chunks.length?Buffer.concat(chunks):undefined;
}
function targetHeaders(req){
  const headers=new Headers();
  for(const [name,value] of Object.entries(req.headers)){
    const lower=name.toLowerCase();
    if(['host','connection','content-length','x-xnekama-target','x-xnekama-egress-token','x-xnekama-redirect'].includes(lower))continue;
    if(Array.isArray(value))for(const item of value)headers.append(name,item);
    else if(value!=null)headers.set(name,String(value));
  }
  return headers;
}
function responseHeaders(response){
  const out={};
  for(const [name,value] of response.headers){
    const lower=name.toLowerCase();
    if(['connection','content-length','content-encoding','transfer-encoding','set-cookie'].includes(lower))continue;
    out[name]=value;
  }
  const setCookies=response.headers.getSetCookie?.()||[];
  if(setCookies.length)out['set-cookie']=setCookies;
  return out;
}

const server=http.createServer(async(req,res)=>{
  try{
    const local=new URL(req.url||'/','http://localhost');
    if(!sameToken(req.headers['x-xnekama-egress-token']))return json(res,401,{error:'unauthorized'});
    if(local.pathname==='/healthz'&&req.method==='GET'){
      const status=await probeWarp(transport);
      return json(res,status.ready?200:503,{ok:status.ready,warp:status.ready?'verified':'unavailable'});
    }
    if(local.pathname!=='/fetch')return json(res,404,{error:'not_found'});

    const rawTarget=String(req.headers['x-xnekama-target']||'');
    let target;
    try{target=new URL(rawTarget)}catch{return json(res,400,{error:'bad_target'})}
    if(!isAllowedXTarget(target))return json(res,403,{error:'target_not_allowed'});

    const method=String(req.method||'GET').toUpperCase();
    const body=['GET','HEAD'].includes(method)?undefined:await readBody(req);
    const redirect=String(req.headers['x-xnekama-redirect']||'follow');
    const upstream=await verifiedFetch(target,{
      method,
      headers:targetHeaders(req),
      body,
      redirect:['follow','manual','error'].includes(redirect)?redirect:'follow'
    });
    const bytes=Buffer.from(await upstream.arrayBuffer());
    const headers=responseHeaders(upstream);
    headers['content-length']=bytes.length;
    if(upstream.url)headers['x-xnekama-final-url']=upstream.url;
    res.writeHead(upstream.status,headers);
    res.end(bytes);
  }catch(error){
    const status=Number(error?.status)||502;
    json(res,status,{error:error?.code||'egress_failed',message:String(error?.message||error).slice(0,300)},
      error?.code==='VPN_REQUIRED'?{'x-xnekama-egress-error':'VPN_REQUIRED'}:{});
  }
});

server.listen(port,host,()=>{
  console.log(`X-Nekama VPN egress listening on http://${host}:${port}/fetch`);
  console.log('X requests are blocked unless the host is verified as WARP-connected.');
});
