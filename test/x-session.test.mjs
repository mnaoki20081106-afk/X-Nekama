import test from 'node:test';
import assert from 'node:assert/strict';
import {verify,ensureBio,checkBio,publish} from '../x.mjs';
import {TwitterHttpClient} from '../vendor/xactions/src/scrapers/twitter/http/client.js';

// Keep signing/discovery offline in wrapper tests; recovery tests opt in below.
process.env.VITEST='1';
const cookies='auth_token=session; ct0=csrf';
const bio='架空AIキャラクター';
const json=value=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
const profile=description=>({data:{user:{result:{rest_id:'1',legacy:{screen_name:'sample',description}}}}});

test('auth, profile and separate submission clients retain the same session headers',async()=>{
 const calls=[];
 const transport={fetch:async(url,init)=>{
  calls.push({url,init});
  if(url.includes('verify_credentials'))return json({id_str:'1',screen_name:'sample'});
  if(url.includes('CreateTweet'))return json({data:{create_tweet:{tweet_results:{result:{rest_id:'42'}}}}});
  return json(profile(bio));
 }};
 await verify(cookies,transport);
 await checkBio(cookies,'sample',transport);
 assert.equal(await publish(cookies,'こんにちは',null,null,transport),'42');
 await checkBio(cookies,'sample',transport);
 assert.equal(calls.length,4);
 assert.equal(new Set(calls.map(c=>c.init.headers['user-agent'])).size,1);
 for(const {init} of calls){
  assert.ok(init.headers['user-agent']);
  assert.equal(init.headers.cookie,cookies);
  assert.equal(init.headers['x-csrf-token'],'csrf');
  assert.equal(init.headers['accept-language'],'en-US,en;q=0.9');
 }
});

test('unchanged bio needs one read; changed bio is written then verified',async()=>{
 for(const changed of [false,true]){
  let current=changed?'old':bio;
  const calls=[];
  const transport={fetch:async(url,init)=>{
   calls.push(url);
   if(url.includes('update_profile')){current=new URLSearchParams(init.body).get('description');return json({});}
   return json(profile(current));
  }};
  assert.equal((await ensureBio(cookies,'sample',bio,transport)).bio,bio);
  assert.equal(calls.length,changed?3:1);
 }
});

test('profile update must still confirm disclosure from the server response',async()=>{
 const transport={fetch:async(url)=>json(url.includes('update_profile')?{}:profile('old'))};
 await assert.rejects(()=>ensureBio(cookies,'sample',bio,transport),/AI表記/);
});

test('stale GraphQL IDs recover reads but never replay writes',async()=>{
 for(const mutation of [true,false]){
  const sent=[];
  let refreshes=0;
  const client=new TwitterHttpClient({cookies,transactionId:false,autoRefreshQueryIds:true,maxRetries:0,fetch:async(url)=>{
   if(url.includes('/i/api/graphql/')){
    sent.push(url);
    if(sent.length>1)return json({data:{ok:true}});
   }
   return new Response('Query not found',{status:404});
  }});
  client._refreshedQueryId=async()=>{refreshes++;return 'fresh-id'};
  const operation=mutation?'SessionTestWrite':'SessionTestRead';
  const request=()=>client.graphql('old-id',operation,{}, {mutation});
  if(mutation){await assert.rejects(request);assert.equal(sent.length,1);assert.equal(refreshes,0);}
  else{assert.deepEqual((await request()).data,{ok:true});assert.equal(sent.length,2);assert.equal(refreshes,1);}
 }
});
