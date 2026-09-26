import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';

test('login, storage, disclosure, draft and scheduling guard',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'xnekama-')),port=32000+Math.floor(Math.random()*1000);
 const child=spawn(process.execPath,['server.mjs'],{cwd:process.cwd(),env:{...process.env,DATA_DIR:dir,PORT:String(port),ADMIN_PASSWORD:'test-password',APP_SECRET:'a'.repeat(48)},stdio:['ignore','pipe','pipe']});
 try{
  const ready=Promise.race([new Promise((resolve,reject)=>{child.stdout.on('data',d=>{if(d.toString().includes('X-Nekama:'))resolve()});child.on('exit',()=>reject(new Error('server exited')))}),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('startup timeout')),8000);timer.unref()})]);
  await ready;
  const root=`http://127.0.0.1:${port}`;let cookie='';
  const send=async(path,method='GET',body)=>{const res=await fetch(root+path,{method,headers:{...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return {res,json:await res.json()}};
  assert.equal((await send('/api/state')).res.status,401);
  let r=await send('/api/login','POST',{password:'wrong'});assert.equal(r.res.status,401);
  r=await send('/api/login','POST',{password:'test-password'});assert.equal(r.res.status,200);cookie=r.res.headers.get('set-cookie').split(';')[0];
  r=await send('/api/accounts','POST',{username:'ai_character',character_name:'ルナ'});assert.equal(r.res.status,201);const id=r.json.id;
  r=await send(`/api/accounts/${id}`,'PATCH',{bio:'現実の人間です'});assert.equal(r.res.status,400);
  r=await send('/api/refs','POST',{username:'reference_ai'});assert.equal(r.res.status,201);
  r=await send('/api/drafts','POST',{account_id:id,text:'架空のAIキャラが夜景を眺めています',scheduled_at:new Date(Date.now()+3600000).toISOString()});assert.equal(r.res.status,201);const draft=r.json.id;
  r=await send(`/api/drafts/${draft}/schedule`,'POST');assert.equal(r.res.status,400);
  r=await send('/api/state');assert.equal(r.json.accounts[0].character_name,'ルナ');assert.equal(r.json.accounts[0].session_cipher,undefined);assert.equal(r.json.refs[0].username,'reference_ai');
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jSxQAAAAASUVORK5CYII=';
  r=await send('/api/assets','POST',{kind:'style',category:'selfie',data:png});assert.equal(r.res.status,201);const asset=r.json.id;
  const image=await fetch(root+'/api/assets/'+asset,{headers:{cookie}});assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');
  r=await send(`/api/drafts/${draft}`,'PATCH',{text:'編集した投稿',image_style:'selfie'});assert.equal(r.res.status,200);
  r=await send('/api/state');assert.equal(r.json.drafts[0].text,'編集した投稿');assert.match(r.json.drafts[0].image_prompt,/編集した投稿/);
  r=await send(`/api/drafts/${draft}/image`,'POST',{name:'個別投稿画像',data:png});assert.equal(r.res.status,201);
  r=await send('/api/state');assert.ok(r.json.drafts[0].image_id);assert.equal(r.json.assets.filter(a=>a.category==='uploaded').length,1);
  r=await send(`/api/drafts/${draft}`,'PATCH',{image_style:'mirror'});assert.equal(r.res.status,200);
  r=await send('/api/state');assert.equal(r.json.drafts[0].image_id,null);assert.equal(r.json.assets.filter(a=>a.category==='uploaded').length,0);
  r=await send(`/api/drafts/${draft}/image`,'POST',{name:'差し替え画像',data:png});assert.equal(r.res.status,201);
  r=await send(`/api/drafts/${draft}/image`,'DELETE');assert.equal(r.res.status,200);
  r=await send('/api/state');assert.equal(r.json.drafts[0].image_id,null);
  r=await send('/api/drafts/images/bulk','POST',{items:[{draft_id:draft,name:'投稿画像',data:png}]});assert.equal(r.res.status,201);
  r=await send('/api/state');assert.ok(r.json.drafts[0].image_id);
  r=await send('/api/drafts/images/bulk','POST',{items:[{draft_id:draft,data:png},{draft_id:draft,data:png}]});assert.equal(r.res.status,400);
 }finally{child.kill();await once(child,'exit').catch(()=>{});await rm(dir,{recursive:true,force:true})}
});
