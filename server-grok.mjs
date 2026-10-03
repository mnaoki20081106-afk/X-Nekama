import {chromium} from 'playwright';
import {warp,parseWarpProxy} from './warp-transport.mjs';
// DOM selectors from nirholas/XActions src/grokIntegration.js (Apache-2.0).
// A changed page, entitlement wall or incomplete JSON must fail closed.
export function unwrapGrokJSON(text){return JSON.parse(String(text||'').trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));}
export async function generateWithServerGrok(cookies,prompt,{validate,timeout=180000}={}){
 if(process.env.SERVER_GROK!=='1')throw Error('サーバーGrokは未設定です');
 await warp.ensure();
 const browser=await chromium.launch({headless:true,proxy:{server:parseWarpProxy(process.env.WARP_PROXY_URL),bypass:'<-loopback>'},args:['--disable-quic','--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1']});
 try{
  const context=await browser.newContext({locale:'ja-JP',serviceWorkers:'block'});
  const items=String(cookies).split(';').map(p=>{const i=p.indexOf('=');return i>0?{name:p.slice(0,i).trim(),value:p.slice(i+1).trim(),domain:'.x.com',path:'/',secure:true}:null;}).filter(Boolean);
  if(!items.some(c=>c.name==='auth_token')||!items.some(c=>c.name==='ct0'))throw Error('Xのログイン済みセッションを更新してください');
  await context.addCookies(items);const page=await context.newPage();
  await page.goto('https://x.com/i/grok',{waitUntil:'domcontentloaded',timeout:45000});
  const input=page.locator('[data-testid="grokInput"]'),send=page.locator('[data-testid="grokSendButton"]');
  await input.waitFor({state:'visible',timeout:30000});await input.fill(prompt);await send.click({timeout:15000});
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){
   await warp.ensure();const responses=page.locator('[data-testid="grokResponseText"]');
   if(await responses.count()){
    const text=await responses.last().innerText();
    try{const value=unwrapGrokJSON(text),result=validate?validate(value):value;if(await send.isEnabled())return result;}catch{/* Incomplete or invalid output stays outside the queue. */}
   }
   await page.waitForTimeout(1000);
  }
  throw Error('Grokの返答を確認できません。利用資格・上限・追加認証・画面変更を確認してください');
 }finally{await browser.close();}
}
