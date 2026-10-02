import test from 'node:test';
import assert from 'node:assert/strict';
import {createVPNGate} from '../vpn.mjs';

test('VPN gate never sends external traffic without configuration, tunnel and health',async()=>{
 let sent=0,healthy=true,tunnel=true;
 const fetch=async url=>{if(String(url).startsWith('http://127.0.0.1:9999/'))return new Response('',{status:healthy?200:503});sent++;return new Response('ok');};
 const interfaces=()=>tunnel?{tun0:[{internal:false,address:'10.0.0.2'}]}:{};
 const missing=createVPNGate({fetch,interfaces,configured:false});
 await assert.rejects(()=>missing.fetch('https://x.com'),{code:'VPN_UNAVAILABLE'});assert.equal(sent,0);
 const gate=createVPNGate({fetch,interfaces,configured:true});
 await gate.fetch('https://x.com');assert.equal(sent,1);
 healthy=false;
 await assert.rejects(()=>gate.fetch('https://x.com'),{code:'VPN_UNAVAILABLE'});assert.equal(sent,1);assert.equal(gate.status().connected,false);
 healthy=true;tunnel=false;
 await assert.rejects(()=>gate.fetch('https://x.com'),{code:'VPN_UNAVAILABLE'});assert.equal(sent,1);
 tunnel=true;
 await gate.fetch('https://x.com');assert.equal(sent,2);
});

test('VPN health failures and redirects stay closed',async()=>{
 for(const fetch of [async()=>{throw Error('timeout')},async()=>new Response('',{status:302})]){
  const gate=createVPNGate({configured:true,interfaces:()=>({tun0:[{internal:false}]}),fetch});
  assert.equal((await gate.check()).connected,false);
 }
});
