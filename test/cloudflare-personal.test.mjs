import test from 'node:test';
import assert from 'node:assert/strict';
import {selectCloudflareAccount} from '../cloudflare/account-policy.mjs';
import worker from '../cloudflare/src/index.mjs';

const first={id:'a'.repeat(32),name:'Personal'},second={id:'b'.repeat(32),name:'Other'};
test('Cloudflare provisioning selects the only authorized account',()=>{
 assert.deepEqual(selectCloudflareAccount({accounts:[first]}),first);
 assert.throws(()=>selectCloudflareAccount({accounts:[]}),/配置先/);
});
test('multiple Cloudflare accounts require an explicit or saved selection',()=>{
 const identity={accounts:[first,second]};
 assert.throws(()=>selectCloudflareAccount(identity),/配置先/);
 assert.equal(selectCloudflareAccount(identity,{requested:second.id}).id,second.id);
 assert.equal(selectCloudflareAccount(identity,{saved:first.id}).id,first.id);
});
test('Cloudflare setup rejects unauthorized accounts and silent account changes',()=>{
 const identity={accounts:[first,second]};
 assert.throws(()=>selectCloudflareAccount(identity,{requested:'c'.repeat(32)}),/アクセス/);
 assert.throws(()=>selectCloudflareAccount(identity,{requested:'bad'}),/32桁/);
 assert.throws(()=>selectCloudflareAccount(identity,{requested:second.id,saved:first.id}),/別のCloudflare/);
});
test('native discovery works before X login and reveals no credentials or user data',async()=>{
 const env={X_EGRESS_URL:'https://private.example/fetch',X_EGRESS_TOKEN:'secret'.repeat(8),X_EXIT_MODE:'shared',DB:{prepare(){throw Error('must not access user data')}}};
 const r=await worker.fetch(new Request('https://personal.workers.dev/api/instance'),env);
 assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
 const text=await r.text();assert.doesNotMatch(text,/secret|private\.example|owner_id/);
 assert.deepEqual(JSON.parse(text),{product:'x-nekama',protocol_version:1,platform:'cloudflare-workers',deployment_model:'user-account',vpn_egress_configured:true,exit_mode:'shared'});
});
test('discovery does not claim an unconfigured gateway is ready',async()=>{
 const r=await worker.fetch(new Request('https://personal.workers.dev/api/instance'),{});
 assert.equal((await r.json()).vpn_egress_configured,false);
});
