import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {verifyApiToken,checkApiBio,publishApi} from './x.mjs';

test('verifyApiToken reads the OAuth2 user identity',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.match(String(url),/^https:\/\/api\.x\.com\/2\/users\/me/);
  assert.equal(options.headers.authorization,'Bearer token');
  return new Response(JSON.stringify({data:{id:'123',username:'nekama_test',name:'Nekama',description:'架空AIキャラクター'}}),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const who=await verifyApiToken('token');
  assert.equal(who.username,'nekama_test');
  assert.equal(who.bio,'架空AIキャラクター');
  await checkApiBio('token','nekama_test');
 }finally{globalThis.fetch=original}
});

test('checkApiBio rejects a mismatched account or missing AI disclosure',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>new Response(JSON.stringify({data:{id:'123',username:'other',name:'Other',description:'普通のプロフィール'}}),{status:200,headers:{'content-type':'application/json'}});
 try{
  await assert.rejects(()=>checkApiBio('token','nekama_test'),/接続先/);
 }finally{globalThis.fetch=original}
});

test('publishApi uploads image through X API v2 then creates an AI-disclosed post',async()=>{
 const original=globalThis.fetch;
 const dir=await mkdtemp(join(tmpdir(),'x-nekama-'));
 const imagePath=join(dir,'image.jpg');
 await writeFile(imagePath,Buffer.from([0xff,0xd8,0xff,0xd9]));
 const calls=[];
 globalThis.fetch=async(url,options)=>{
  const body=options?.body?JSON.parse(options.body):null;
  calls.push({url:String(url),method:options?.method,body,authorization:options?.headers?.authorization});
  if(String(url)==='https://api.x.com/2/media/upload'){
   assert.equal(body.media_category,'tweet_image');
   assert.ok(body.media.length>0);
   return new Response(JSON.stringify({data:{id:'media123'}}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(String(url)==='https://api.x.com/2/tweets'){
   assert.deepEqual(body.media,{media_ids:['media123']});
   assert.equal(body.made_with_ai,true);
   assert.equal(body.text,'テスト投稿');
   return new Response(JSON.stringify({data:{id:'post456',text:'テスト投稿'}}),{status:201,headers:{'content-type':'application/json'}});
  }
  throw new Error('unexpected URL '+url);
 };
 try{
  const id=await publishApi('token','テスト投稿',imagePath,'alt');
  assert.equal(id,'post456');
  assert.equal(calls.length,2);
  assert.equal(calls[0].authorization,'Bearer token');
 }finally{
  globalThis.fetch=original;
  await rm(dir,{recursive:true,force:true});
 }
});

test('publishApi sends text-only posts without media metadata',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://api.x.com/2/tweets');
  const body=JSON.parse(options.body);
  assert.equal(body.text,'本文だけ');
  assert.equal(body.media,undefined);
  assert.equal(body.made_with_ai,undefined);
  return new Response(JSON.stringify({data:{id:'post789'}}),{status:201,headers:{'content-type':'application/json'}});
 };
 try{
  assert.equal(await publishApi('token','本文だけ',null,''),'post789');
 }finally{globalThis.fetch=original}
});
