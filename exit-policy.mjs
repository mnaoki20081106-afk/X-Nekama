export const TRACE_URL='https://www.cloudflare.com/cdn-cgi/trace';
export function validExitIP(value){
 const parts=String(value||'').split('.');
 if(parts.length!==4||!parts.every(p=>/^(0|[1-9]\d{0,2})$/.test(p)&&Number(p)<=255))return false;
 const [a,b]=parts.map(Number);
 return ![0,10,127].includes(a)&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127);
}
export function validExitConfig(ip,country){return validExitIP(ip)&&/^[A-Z]{2}$/.test(String(country||''));}
export function parseExitTrace(text){
 const fields={};
 for(const line of String(text||'').replace(/\r/g,'').split('\n')){
  const at=line.indexOf('=');if(at<1)continue;
  const key=line.slice(0,at),value=line.slice(at+1);
  if(['ip','loc','warp'].includes(key)){if(Object.hasOwn(fields,key))return null;fields[key]=value;}
 }
 return fields;
}
export function matchesExit({ip,country},expectedIP,expectedCountry){
 return validExitConfig(expectedIP,expectedCountry)&&ip===expectedIP&&country===expectedCountry;
}
export function verifiedGateway(data,{mode='warp',ip='',country='JP'}={}){
 return data?.ok===true&&(mode==='shared'?data.mode==='shared'&&matchesExit(data,ip,country):mode==='warp'&&data.warp==='verified');
}
