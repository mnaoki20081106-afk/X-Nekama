import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createPrivateKey,createPublicKey} from 'node:crypto';
import {createVPNGate} from '../vpn.mjs';
import {createRemoteEgressFetch} from '../egress.mjs';
import {createSharedExit} from '../tools/create-shared-exit.mjs';
import {parseExitTrace,verifiedGateway} from '../exit-policy.mjs';

test('shared VPN sends no X traffic until tunnel, health, exit IP and country agree',async()=>{
 let ip='203.0.113.8',country='JP',tunnel=true,health=true,sent=0;
 const gate=createVPNGate({configured:true,mode:'gluetun',exitMode:'shared',expectedIP:ip,expectedCountry:'JP',interfaces:()=>tunnel?{tun0:[{internal:false}]}:{},fetch:async url=>{
  if(String(url).startsWith('http://127.0.0.1:9999/'))return new Response('',{status:health?200:503});
  if(String(url).includes('/cdn-cgi/trace'))return new Response(`ip=${ip}\nloc=${country}\nwarp=off\n`);
  sent++;return new Response('sent');
 }});
 await gate.fetch('https://x.com');assert.equal(sent,1);
 for(const change of [()=>{ip='203.0.113.9'},()=>{ip='203.0.113.8';country='US'},()=>{country='JP';tunnel=false},()=>{tunnel=true;health=false}]){
  change();await assert.rejects(()=>gate.fetch('https://x.com'),{code:'VPN_UNAVAILABLE'});assert.equal(sent,1);
 }
 health=true;await gate.fetch('https://x.com');assert.equal(sent,2);assert.equal(gate.status().ip,'203.0.113.8');
});
test('missing fixed exit configuration cannot fall back to WARP',async()=>{
 const gate=createVPNGate({configured:true,mode:'warp',exitMode:'shared',fetch:async()=>{throw Error('must not reach network')}});
 assert.equal((await gate.check()).connected,false);
 assert.equal(parseExitTrace('ip=a\nip=b\nloc=JP'),null);
 assert.equal(verifiedGateway({ok:true,warp:'verified'},{mode:'shared',ip:'203.0.113.8',country:'JP'}),false);
});
test('Cloudflare transport preflight blocks wrong or unreachable shared gateway before forwarding credentials',async()=>{
 let data={ok:true,mode:'shared',ip:'203.0.113.8',country:'JP'},sent=0,offline=false;
 const fetch=createRemoteEgressFetch({endpoint:'https://gateway.example/fetch',token:'t'.repeat(32),exitMode:'shared',expectedIP:'203.0.113.8',expectedCountry:'JP',fetchImpl:async(url,init)=>{
  if(url.pathname==='/healthz'){assert.equal(init.headers['x-xnekama-egress-token'],'t'.repeat(32));if(offline)throw Error('timeout');return Response.json(data);}
  sent++;assert.equal(init.headers.get('cookie'),'session=test');return new Response('ok');
 }});
 await fetch('https://x.com',{headers:{cookie:'session=test'}});assert.equal(sent,1);
 data.country='US';await assert.rejects(()=>fetch('https://x.com'),{code:'VPN_REQUIRED'});assert.equal(sent,1);
 data.country='JP';offline=true;await assert.rejects(()=>fetch('https://x.com'),{code:'VPN_REQUIRED'});assert.equal(sent,1);
});
test('configuration generation pairs distinct valid phone/gateway keys with one exit and refuses overwrite',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'xnekama-shared-')),out=join(dir,'config');
 try{
  await createSharedExit({endpointIP:'203.0.113.8',out});
  const phone=await readFile(join(out,'iphone.conf'),'utf8'),gateway=await readFile(join(out,'gateway.conf'),'utf8'),server=await readFile(join(out,'wg0.conf'),'utf8');
  const key=config=>config.match(/PrivateKey = (.+)/)[1];assert.notEqual(key(phone),key(gateway));
  for(const config of [phone,gateway]){
   const der=Buffer.concat([Buffer.from('302e020100300506032b656e04220420','hex'),Buffer.from(key(config),'base64')]);
   const pub=createPublicKey(createPrivateKey({key:der,format:'der',type:'pkcs8'})).export({format:'der',type:'spki'}).subarray(-32).toString('base64');
   assert.ok(server.includes('PublicKey = '+pub));assert.match(config,/Endpoint = 203\.0\.113\.8:51820/);assert.match(config,/AllowedIPs = 0\.0\.0\.0\/0, ::\/0/);
  }
  assert.match(await readFile(join(out,'.env.shared-exit'),'utf8'),/X_EXIT_MODE=shared\nX_EXIT_IP=203.0.113.8\nX_EXIT_COUNTRY=JP/);
  assert.equal((await stat(join(out,'iphone.conf'))).mode&0o777,0o600);
  await assert.rejects(()=>createSharedExit({endpointIP:'203.0.113.8',out}),{code:'EEXIST'});
 }finally{await rm(dir,{recursive:true,force:true});}
});
