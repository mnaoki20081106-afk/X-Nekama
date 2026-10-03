import test from 'node:test';
import assert from 'node:assert/strict';
import {TwitterHttpClient} from '../vendor/xactions/src/scrapers/twitter/http/client.js';
import {uploadChunked} from '../vendor/xactions/src/scrapers/twitter/http/media.js';

function fieldsOf(url,init={}){
  if(init.body instanceof FormData){
    return Object.fromEntries([...init.body.entries()].filter(([,value])=>typeof value==='string'));
  }
  const body=typeof init.body==='string'?new URLSearchParams(init.body):null;
  if(body?.has('command'))return Object.fromEntries(body);
  return Object.fromEntries(new URL(url).searchParams);
}

test('vendored XActions sends media INIT/APPEND/FINALIZE on the wire without replaying APPEND',async()=>{
  const requests=[];
  const fakeFetch=async(url,init={})=>{
    const fields=fieldsOf(String(url),init);
    requests.push({url:String(url),init,fields});
    if(fields.command==='INIT')return new Response(JSON.stringify({media_id_string:'42'}),{status:202,headers:{'content-type':'application/json'}});
    if(fields.command==='APPEND')return new Response(null,{status:204});
    if(fields.command==='FINALIZE')return new Response(JSON.stringify({media_id_string:'42',media_key:'3_42'}),{status:201,headers:{'content-type':'application/json'}});
    throw new Error('unexpected request '+url);
  };
  const client=new TwitterHttpClient({
    cookies:'auth_token=t; ct0=c',
    fetch:fakeFetch,
    maxRetries:0,
    transactionId:false,
    autoRefreshQueryIds:false
  });
  const bytes=Buffer.alloc(6*1024*1024,7);
  const result=await uploadChunked(client,bytes,'image/png','tweet_image');
  assert.equal(result.mediaId,'42');
  assert.equal(result.mediaKey,'3_42');
  assert.equal(requests[0].url,'https://upload.x.com/i/media/upload.json');
  assert.equal(requests[0].fields.command,'INIT');
  const appends=requests.filter(r=>r.fields.command==='APPEND');
  assert.equal(appends.length,2);
  assert.ok(appends.every(r=>r.init.body instanceof FormData));
  assert.equal(appends[0].fields.segment_index,'0');
  assert.equal(appends[1].fields.segment_index,'1');
  assert.equal(requests.filter(r=>r.fields.command==='FINALIZE').length,1);
});
