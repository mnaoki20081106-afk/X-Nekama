import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createPublisher} from '../scheduler.mjs';
function fixture({vpn=true,submitError=null,disableDuringCheck=false}={}){
 const db=new DatabaseSync(':memory:');db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,enabled INTEGER,session_cipher TEXT,username TEXT,character_name TEXT,config_revision INTEGER);INSERT INTO accounts VALUES('a',1,'encrypted','character','Character',0);
 CREATE TABLE drafts(id TEXT PRIMARY KEY,account_id TEXT,status TEXT,scheduled_at TEXT,next_attempt_at TEXT,attempt_count INTEGER DEFAULT 0,last_attempt_at TEXT,last_error_kind TEXT,error TEXT,updated_at TEXT,posted_at TEXT,x_post_id TEXT,text TEXT,image_id TEXT,image_style TEXT);
 CREATE TABLE assets(id TEXT,filename TEXT);`);
 const row=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
 let sent=0;const lock=new Set();
 const publisher=createPublisher({row,all,run,requireAccount:id=>row('SELECT * FROM accounts WHERE id=?',id),dataDir:'/tmp',decrypt:()=>'',acquirePublishLock:id=>{if(lock.has(id))return false;lock.add(id);return true;},releasePublishLock:id=>lock.delete(id),xTransport:{},warp:{ensure:async()=>{if(!vpn)throw Error('VPN down');}},x:{checkBio:async()=>{if(disableDuringCheck)run('UPDATE accounts SET enabled=0,config_revision=1 WHERE id=?','a');},publish:async()=>{sent++;if(submitError)throw submitError;return '1234567890123456789';}}});
 const add=(id,secondsAgo=1,status='scheduled')=>run('INSERT INTO drafts(id,account_id,status,scheduled_at,text) VALUES(?,?,?,?,?)',id,'a',status,new Date(Date.now()-secondsAgo*1000).toISOString(),`text ${id}`);
 return {db,row,run,add,publisher,sent:()=>sent};
}
test('server sends due item without any iPhone and persists result across ticks',async()=>{const f=fixture();try{f.add('one');await f.publisher();assert.equal(f.sent(),1);assert.equal(f.row('SELECT status FROM drafts').status,'posted');await f.publisher();assert.equal(f.sent(),1);}finally{f.db.close();}});
test('VPN down leaves due queue intact without consuming delivery attempts',async()=>{const f=fixture({vpn:false});try{f.add('one');await f.publisher();assert.equal(f.sent(),0);assert.equal(f.row('SELECT status,attempt_count FROM drafts').status,'scheduled');assert.equal(f.row('SELECT attempt_count FROM drafts').attempt_count,0);}finally{f.db.close();}});
test('stale and unresolved submissions cannot burst-send after restart',async()=>{const f=fixture();try{f.add('stale',1000);f.add('unknown',1,'publishing');f.add('next');await f.publisher();assert.equal(f.sent(),0);assert.equal(f.row('SELECT status FROM drafts WHERE id=?','stale').status,'failed');assert.equal(f.row('SELECT status FROM drafts WHERE id=?','next').status,'scheduled');}finally{f.db.close();}});
test('disabling account during preflight prevents send',async()=>{const f=fixture({disableDuringCheck:true});try{f.add('one');await f.publisher();assert.equal(f.sent(),0);assert.equal(f.row('SELECT status FROM drafts').status,'scheduled');}finally{f.db.close();}});
test('ambiguous submit is not replayed by the next scheduler tick',async()=>{const f=fixture({submitError:Object.assign(Error('ECONNRESET'),{deliveryStage:'submit'})});try{f.add('one');await f.publisher();await f.publisher();assert.equal(f.sent(),1);assert.equal(f.row('SELECT status,last_error_kind FROM drafts').status,'failed');assert.equal(f.row('SELECT last_error_kind FROM drafts').last_error_kind,'ambiguous');}finally{f.db.close();}});
