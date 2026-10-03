import {networkInterfaces} from 'node:os';
import {TRACE_URL,parseExitTrace,validExitConfig,matchesExit} from './exit-policy.mjs';

// The process must share Gluetun's network namespace and firewall. A health
// response by itself cannot make an independently networked process safe.
export function createVPNGate({fetch:transport=globalThis.fetch,interfaces=networkInterfaces,configured=['gluetun','warp'].includes(process.env.X_VPN_MODE),mode=process.env.X_VPN_MODE||'gluetun',interfaceName=process.env.X_VPN_INTERFACE||'tun0',exitMode=process.env.X_EXIT_MODE||'warp',expectedIP=process.env.X_EXIT_IP||'',expectedCountry=process.env.X_EXIT_COUNTRY||'JP'}={}){
 let state={required:true,connected:false,checked_at:null,message:'サーバーVPNが未設定です。予約投稿は待機します。'};
 async function check(){
  try{
   if(!configured)throw Error('サーバーVPNが未設定です。VPN付きComposeで起動してください。');
   if(!['warp','shared'].includes(exitMode))throw Error('VPN出口モードが不正です。');
   if(exitMode==='shared'&&(mode!=='gluetun'||!validExitConfig(expectedIP,expectedCountry)))throw Error('共通出口にはGluetunと固定IPv4・国コードの設定が必要です。');
   let exit={};
   if(mode==='warp'){
    const response=await transport('https://www.cloudflare.com/cdn-cgi/trace',{redirect:'error',signal:AbortSignal.timeout(3000)});
    if(response.status!==200||!/(?:^|\n)warp=(?:on|plus)(?:\n|$)/.test((await response.text()).replace(/\r/g,'')))throw Error('サーバーWARP接続を確認できません。');
   }else{
   if(!interfaces()[interfaceName]?.some(i=>!i.internal))throw Error('サーバーのVPNトンネルを確認できません。');
   const response=await transport('http://127.0.0.1:9999/',{redirect:'error',signal:AbortSignal.timeout(3000)});
   if(response.status!==200)throw Error('サーバーVPNが未接続です。予約投稿は復旧待ちです。');
   }
   if(exitMode==='shared'){
    const response=await transport(TRACE_URL,{redirect:'error',headers:{'cache-control':'no-cache'},signal:AbortSignal.timeout(3000)});
    const trace=parseExitTrace(await response.text());exit={ip:trace?.ip,country:trace?.loc};
    if(response.status!==200||(response.url&&response.url!==TRACE_URL)||!matchesExit(exit,expectedIP,expectedCountry))throw Error('VPN出口IPまたは国が共通出口の設定と一致しません。予約投稿は待機します。');
   }
   state={required:true,connected:true,checked_at:new Date().toISOString(),mode:exitMode,...exit,message:exitMode==='shared'?`共通VPN出口確認済み (${exit.ip} / ${exit.country})`:'サーバーVPN接続済み'};
  }catch(error){state={required:true,connected:false,checked_at:new Date().toISOString(),message:error.message||'VPN接続を確認できません。'};}
  return {...state};
 }
 async function assertConnected(){const result=await check();if(!result.connected)throw Object.assign(Error(result.message),{code:'VPN_UNAVAILABLE',status:503,deliveryStage:'preflight'});}
 async function guardedFetch(input,init={}){
  await assertConnected();
  const timeout=AbortSignal.timeout(30000);
  return transport(input,{...init,signal:init.signal?AbortSignal.any([init.signal,timeout]):timeout});
 }
 return {check,assertConnected,fetch:guardedFetch,status:()=>({...state})};
}

export const serverVPN=createVPNGate();
