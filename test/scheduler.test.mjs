import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';

// Replace only transport dependencies in a separate test process. The real
// server, SQLite queue, claim, encryption and delivery policy still execute.
test('server queue waits for VPN, survives restart, and stops ambiguous replays',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'xnekama-queue-'));
 const loader=join(dir,'transport.mjs'),mode=join(dir,'mode'),count=join(dir,'sent');
 const env={...process.env,DATA_DIR:dir,PORT:'0',ADMIN_PASSWORD:'test-password',APP_SECRET:'s'.repeat(48)};
 const mockVPN=`import {readFileSync} from 'node:fs';export const serverVPN={check:async()=>({connected:readFileSync(${JSON.stringify(mode)},'utf8')!=='offline',message:'VPN待機中'})};`;
 const mockX=`import {readFileSync,appendFileSync} from 'node:fs';export async function checkBio(){};export async function publish(){appendFileSync(${JSON.stringify(count)},'sent\\n');if(readFileSync(${JSON.stringify(mode)},'utf8')==='ambiguous')throw Object.assign(Error('ECONNRESET'),{deliveryStage:'submit'});return '1234567890123456789';}`;
 await writeFile(loader,`import {registerHooks} from 'node:module';import {randomBytes,scryptSync,createCipheriv} from 'node:crypto';
 const {row,run}=await import(${JSON.stringify(new URL('../db.mjs',import.meta.url).href)});
 if(!row('SELECT id FROM accounts WHERE id=?','a')){
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',scryptSync(process.env.APP_SECRET,'x-nekama-sessions-v1',32),iv);
  const session=Buffer.concat([iv,c.update('auth_token=test; ct0=test'),c.final(),c.getAuthTag()]).toString('base64');
  run('INSERT INTO accounts(id,username,display_name,character_name,session_cipher,enabled) VALUES(?,?,?,?,?,1)','a','test','Test','Test',session);
  run("INSERT INTO drafts(id,account_id,text,status,scheduled_at) VALUES(?,?,?,'scheduled',?)",'d','a','test post','2020-01-01T00:00:00.000Z');
 }
 const mockEgress='export function createVerifiedEgressFetch(){return async()=>{throw Error(\"unexpected network\")}}';
 const modules={'./egress.mjs':mockEgress,'./vpn.mjs':${JSON.stringify(mockVPN)},'./x.mjs':${JSON.stringify(mockX)}};
 registerHooks({resolve(specifier,context,next){if(context.parentURL?.endsWith('/server.mjs')&&modules[specifier])return {url:'data:text/javascript,'+encodeURIComponent(modules[specifier]),shortCircuit:true};return next(specifier,context)}});
 `);
 let child,db;
 async function start(){
  child=spawn(process.execPath,['--import',loader,'server.mjs'],{env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server timeout')),8000);child.stdout.on('data',d=>{if(d.toString().includes('X-Nekama:')){clearTimeout(timer);resolve()}});child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'))})});
 }
 async function stop(){if(!child)return;child.kill();await once(child,'exit');child=null;}
 async function waitFor(predicate){const end=Date.now()+5000;while(Date.now()<end){if(predicate())return;await new Promise(r=>setTimeout(r,50));}throw Error('scheduler timeout');}
 try{
  await writeFile(mode,'offline');await start();db=new DatabaseSync(join(dir,'app.sqlite'));
  const draft=()=>db.prepare('SELECT * FROM drafts WHERE id=?').get('d');
  await waitFor(()=>draft().last_error_kind==='vpn_wait');
  assert.equal(draft().status,'scheduled');assert.equal(draft().attempt_count,0);
  await stop();await writeFile(mode,'online');await start();
  await waitFor(()=>draft().status==='posted');assert.equal(draft().x_post_id,'1234567890123456789');assert.equal(draft().attempt_count,1);
  await stop();db.prepare("UPDATE drafts SET status='scheduled',text='今日はいい天気',attempt_count=0,x_post_id=NULL").run();await start();
  await waitFor(()=>draft().status==='needs_review');assert.equal(draft().last_error_kind,'context_review');assert.equal(draft().attempt_count,0);
  assert.equal((await readFile(count,'utf8')).trim().split('\n').length,1);
  await stop();db.prepare("UPDATE drafts SET text='test post',last_error_kind='',error=NULL").run();
  await stop();db.prepare("UPDATE drafts SET status='scheduled',attempt_count=0,x_post_id=NULL").run();await writeFile(mode,'ambiguous');await start();
  await waitFor(()=>draft().status==='failed');assert.equal(draft().last_error_kind,'ambiguous');assert.equal(draft().attempt_count,1);
  await stop();await writeFile(mode,'online');await start();
  await new Promise(r=>setTimeout(r,1200));assert.equal(draft().status,'failed');assert.equal((await readFile(count,'utf8')).trim().split('\n').length,2);
 }finally{await stop();db?.close();await rm(dir,{recursive:true,force:true});}
});
