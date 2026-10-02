import {networkInterfaces} from 'node:os';

// The process must share Gluetun's network namespace and firewall. A health
// response by itself cannot make an independently networked process safe.
export function createVPNGate({fetch:transport=globalThis.fetch,interfaces=networkInterfaces,configured=['gluetun','warp'].includes(process.env.X_VPN_MODE),mode=process.env.X_VPN_MODE||'gluetun',interfaceName=process.env.X_VPN_INTERFACE||'tun0'}={}){
 let state={required:true,connected:false,checked_at:null,message:'サーバーVPNが未設定です。予約投稿は待機します。'};
 async function check(){
  try{
   if(!configured)throw Error('サーバーVPNが未設定です。VPN付きComposeで起動してください。');
   if(mode==='warp'){
    const response=await transport('https://www.cloudflare.com/cdn-cgi/trace',{redirect:'error',signal:AbortSignal.timeout(3000)});
    if(response.status!==200||!/(?:^|\n)warp=(?:on|plus)(?:\n|$)/.test((await response.text()).replace(/\r/g,'')))throw Error('サーバーWARP接続を確認できません。');
   }else{
   if(!interfaces()[interfaceName]?.some(i=>!i.internal))throw Error('サーバーのVPNトンネルを確認できません。');
   const response=await transport('http://127.0.0.1:9999/',{redirect:'error',signal:AbortSignal.timeout(3000)});
   if(response.status!==200)throw Error('サーバーVPNが未接続です。予約投稿は復旧待ちです。');
   }
   state={required:true,connected:true,checked_at:new Date().toISOString(),message:'サーバーVPN接続済み'};
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
