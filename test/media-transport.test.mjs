import test from 'node:test';
import assert from 'node:assert/strict';
import {TwitterHttpClient} from '../vendor/xactions/src/scrapers/twitter/http/client.js';
import {uploadImage} from '../vendor/xactions/src/scrapers/twitter/http/media.js';

test('scheduled image upload uses the upload host and correct request bodies',async()=>{
 const calls=[];
 const client=new TwitterHttpClient({cookies:'auth_token=test; ct0=test',transactionId:false,autoRefreshQueryIds:false,maxRetries:0,fetch:async(url,init)=>{
  calls.push({url,init});return new Response(JSON.stringify({media_id_string:'123',media_key:'key'}),{headers:{'content-type':'application/json'}});
 }});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSxQAAAAASUVORK5CYII=','base64');
 assert.equal((await uploadImage(client,png,{altText:'AI画像'})).mediaId,'123');
 assert.equal(calls.length,4);
 assert.equal(new URL(calls[0].url).hostname,'upload.x.com');
 assert.equal(new URLSearchParams(calls[0].init.body).get('command'),'INIT');
 assert.ok(calls[1].init.body instanceof FormData);
 assert.equal(calls[1].init.body.get('command'),'APPEND');
 assert.deepEqual(Buffer.from(await calls[1].init.body.get('media').arrayBuffer()),png);
 assert.equal(calls[1].init.headers['content-type'],undefined);
 assert.equal(new URLSearchParams(calls[2].init.body).get('command'),'FINALIZE');
 assert.equal(calls[3].init.headers['content-type'],'application/json');
 assert.equal(JSON.parse(calls[3].init.body).alt_text.text,'AI画像');

});

test('submission network failure is not retried by the zero-retry client',async()=>{
 let sent=0;
 const client=new TwitterHttpClient({transactionId:false,autoRefreshQueryIds:false,maxRetries:0,fetch:async()=>{sent++;throw Error('ECONNRESET')}});
 await assert.rejects(()=>client.request('https://x.com/i/api/graphql/query/CreateTweet',{method:'POST',body:{text:'test'}}));
 assert.equal(sent,1);
});
