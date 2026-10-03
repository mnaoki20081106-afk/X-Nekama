import {Socks5ProxyAgent,fetch as proxyFetch} from 'undici';
export function parseWarpProxy(value){
 if(!value)throw Error('WARP_PROXY_URL 未設定: X通信は停止しています');
 const u=new URL(value);
 if(u.protocol!=='socks5:'||!['127.0.0.1','[::1]'].includes(u.hostname)||!u.port||u.username||u.password||u.search||u.hash||(u.pathname&&u.pathname!=='/'))throw Error('WARP_PROXY_URL は socks5://127.0.0.1:ポート にしてください');
 return u.href;
}
export class WarpTransport{
 constructor({proxy=process.env.WARP_PROXY_URL,fetchImpl=proxyFetch,agentFactory=url=>new Socks5ProxyAgent(url,{connectTimeout:5000}),now=()=>performance.now()}={}){Object.assign(this,{proxy,fetchImpl,agentFactory,now});this.verifiedAt=-Infinity;this.message='WARP未確認';this.pending=null;}
 getDispatcher(){if(!this.dispatcher)this.dispatcher=this.agentFactory(parseWarpProxy(this.proxy));return this.dispatcher;}
 async probe(){
  if(this.pending)return this.pending;
  this.pending=(async()=>{try{
   const r=await this.fetchImpl('https://www.cloudflare.com/cdn-cgi/trace',{dispatcher:this.getDispatcher(),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000)});
   const text=await r.text();if(r.status!==200||!/(?:^|\n)warp=(on|plus)(?:\r?\n|$)/.test(text))throw Error('WARP未確認');
   this.verifiedAt=this.now();this.message='WARP接続確認済み';return true;
  }catch(cause){this.verifiedAt=-Infinity;this.message='VPN未接続・投稿停止';throw Object.assign(Error(this.message),{code:'VPN_REQUIRED',deliveryStage:'preflight',cause});}})();
  try{return await this.pending}finally{this.pending=null;}
 }
 async ensure(){if(this.now()-this.verifiedAt>=3000)await this.probe();}
 async fetch(input,init={}){await this.ensure();try{return await this.fetchImpl(input,{...init,dispatcher:this.getDispatcher(),signal:init.signal?AbortSignal.any([init.signal,AbortSignal.timeout(45000)]):AbortSignal.timeout(45000)});}catch(error){this.verifiedAt=-Infinity;throw error;}}
 state(){return {required:true,ready:this.now()-this.verifiedAt<3000,configured:!!this.proxy,message:this.message};}
}
export const warp=new WarpTransport();
export const warpFetch=(input,init)=>warp.fetch(input,init);
