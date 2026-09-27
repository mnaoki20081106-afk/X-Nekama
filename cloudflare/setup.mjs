import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {chmod,readFile,writeFile,unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';

const here=dirname(fileURLToPath(import.meta.url));
const configPath=join(here,'wrangler.toml');
const keyPath=join(here,'.token-encryption-key');
const wrangler=['--yes','wrangler@4'];
const doctor=process.argv.includes('--doctor');

function run(args,{allowFailure=false,input=null,quiet=false}={}){
 return new Promise((resolve,reject)=>{
  const child=spawn('npx',[...wrangler,...args],{
   cwd:here,
   stdio:['pipe','pipe','pipe'],
   shell:process.platform==='win32'
  });
  let out='',err='';
  child.stdout.on('data',d=>{out+=d;if(!quiet)process.stdout.write(d)});
  child.stderr.on('data',d=>{err+=d;if(!quiet)process.stderr.write(d)});
  if(input!=null)child.stdin.end(input);else child.stdin.end();
  child.on('error',reject);
  child.on('close',code=>{
   const result={code,out,err,all:out+'\n'+err};
   if(code===0||allowFailure)return resolve(result);
   reject(Object.assign(new Error(`wrangler failed: ${args.join(' ')}`),{result}));
  });
 });
}
function runInteractive(args){
 return new Promise((resolve,reject)=>{
  const child=spawn('npx',[...wrangler,...args],{cwd:here,stdio:'inherit',shell:process.platform==='win32'});
  child.on('error',reject);
  child.on('close',code=>code===0?resolve():reject(new Error(`wrangler failed: ${args.join(' ')}`)));
 });
}
function note(text=''){process.stdout.write(`\n[X-Nekama] ${text}\n`)}
function parseJson(text){
 const start=Math.min(...['{','['].map(x=>text.indexOf(x)).filter(x=>x>=0));
 if(!Number.isFinite(start))throw new Error('JSON output not found');
 return JSON.parse(text.slice(start));
}
function findUuid(value){
 if(typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value))return value;
 if(Array.isArray(value)){for(const x of value){const v=findUuid(x);if(v)return v}}
 if(value&&typeof value==='object'){for(const x of Object.values(value)){const v=findUuid(x);if(v)return v}}
 return null;
}
function slug(){
 if(existsSync(configPath)){
  try{
   const config=requireText(configPath);
   const m=config.match(/^name\s*=\s*"x-nekama-([a-z0-9-]+)"$/m);
   if(m)return m[1];
  }catch{}
 }
 return randomBytes(3).toString('hex');
}
function requireText(path){return requireText.cache?.get(path)||''}
requireText.cache=new Map();
async function loadExisting(){
 if(!existsSync(configPath))return;
 requireText.cache.set(configPath,await readFile(configPath,'utf8'));
}
async function ensureLogin(){
 let who=await run(['whoami','--json'],{allowFailure:true,quiet:true});
 if(who.code===0)return parseJson(who.out||who.err);
 note('Cloudflareへのログインが必要です。ブラウザが開きます。');
 await runInteractive(['login','--use-keyring']);
 who=await run(['whoami','--json'],{quiet:true});
 return parseJson(who.out||who.err);
}
async function ensureD1(name){
 let info=await run(['d1','info',name,'--json'],{allowFailure:true,quiet:true});
 if(info.code!==0){
  note(`D1を作成: ${name}`);
  await run(['d1','create',name],{quiet:false});
  info=await run(['d1','info',name,'--json'],{quiet:true});
 }
 const id=findUuid(parseJson(info.out||info.err));
 if(!id)throw new Error('D1 database_idを取得できませんでした');
 return id;
}
async function ensureR2(name){
 const info=await run(['r2','bucket','info',name,'--json'],{allowFailure:true,quiet:true});
 if(info.code!==0){
  note(`R2を作成: ${name}`);
  await run(['r2','bucket','create',name]);
 }
 note('R2の公開URLを明示的に無効化');
 await run(['r2','bucket','dev-url','disable',name,'--force'],{allowFailure:true,quiet:true});
}
async function ensureQueue(name){
 const list=await run(['queues','list'],{allowFailure:true,quiet:true});
 if(list.code===0&&list.all.includes(name))return;
 const created=await run(['queues','create',name],{allowFailure:true});
 if(created.code!==0&&!/already|exists|created/i.test(created.all))throw Object.assign(new Error(`Queue作成失敗: ${name}`),{result:created});
}
function renderConfig({worker,dbName,dbId,bucket,queue,dlq,baseUrl}){
 return `name = "${worker}"
main = "src/index.mjs"
compatibility_date = "2026-09-27"
compatibility_flags = ["nodejs_compat"]

[assets]
directory = "../public"
binding = "STATIC"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "${dbName}"
database_id = "${dbId}"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "MEDIA"
bucket_name = "${bucket}"

[[queues.producers]]
binding = "TASKS"
queue = "${queue}"

[[queues.consumers]]
queue = "${queue}"
max_batch_size = 10
max_batch_timeout = 5
max_retries = 3
retry_delay = 60
dead_letter_queue = "${dlq}"
max_concurrency = 4

[triggers]
crons = ["* * * * *"]

[vars]
PUBLIC_BASE_URL = "${baseUrl}"
`;
}
async function secretExists(){
 const result=await run(['secret','list','--config',configPath],{allowFailure:true,quiet:true});
 return result.code===0&&result.all.includes('TOKEN_ENCRYPTION_KEY');
}
async function encryptionKey(){
 if(existsSync(keyPath))return (await readFile(keyPath,'utf8')).trim();
 if(await secretExists()){
  throw new Error('Cloudflare側にTOKEN_ENCRYPTION_KEYがありますが、ローカルの復旧キーが見つかりません。既存データを壊すため自動ローテーションしません。以前の .token-encryption-key を復元してください。');
 }
 const key=randomBytes(32).toString('base64');
 await writeFile(keyPath,key+'\n',{mode:0o600});
 try{await chmod(keyPath,0o600)}catch{}
 return key;
}
async function deployWithSecret(key){
 const secretPath=join(tmpdir(),`x-nekama-secrets-${process.pid}.json`);
 await writeFile(secretPath,JSON.stringify({TOKEN_ENCRYPTION_KEY:key}),{mode:0o600});
 try{
  return await run(['deploy','--config',configPath,'--secrets-file',secretPath]);
 }finally{await unlink(secretPath).catch(()=>{})}
}
function workerUrl(output){
 const urls=output.match(/https:\/\/[A-Za-z0-9._-]+\.workers\.dev\/?/g)||[];
 return urls.at(-1)?.replace(/\/$/,'')||null;
}
async function health(url){
 const response=await fetch(url+'/api/auth',{headers:{accept:'application/json'}});
 if(!response.ok)throw new Error(`公開URLの疎通確認に失敗しました: HTTP ${response.status}`);
 const data=await response.json();
 if(typeof data.authenticated!=='boolean')throw new Error('公開URLがX-Nekamaとして応答していません');
}
async function doctorRun(){
 note('診断モード');
 await ensureLogin();
 if(!existsSync(configPath))throw new Error('wrangler.toml がありません。先に node setup.mjs を実行してください');
 const config=await readFile(configPath,'utf8');
 const db=config.match(/database_name\s*=\s*"([^"]+)"/)?.[1];
 const bucket=config.match(/bucket_name\s*=\s*"([^"]+)"/)?.[1];
 const queue=config.match(/\nqueue\s*=\s*"([^"]+)"/)?.[1];
 const baseUrl=config.match(/PUBLIC_BASE_URL\s*=\s*"([^"]+)"/)?.[1];
 if(!db||!bucket||!queue||!baseUrl)throw new Error('wrangler.toml の設定が不完全です');
 await run(['d1','info',db,'--json'],{quiet:true});
 await run(['r2','bucket','info',bucket,'--json'],{quiet:true});
 const queues=await run(['queues','list'],{quiet:true});
 if(!queues.all.includes(queue))throw new Error('Queueが見つかりません');
 if(!(await secretExists()))throw new Error('TOKEN_ENCRYPTION_KEY secretが見つかりません');
 await health(baseUrl);
 note(`OK: ${baseUrl}`);
}
async function main(){
 await loadExisting();
 if(doctor)return doctorRun();
 note('Cloudflare完全自動セットアップを開始');
 const identity=await ensureLogin();
 const accountName=identity?.accounts?.[0]?.name||identity?.account?.name||'Cloudflare';
 note(`ログイン確認: ${accountName}`);

 const id=slug();
 const worker=`x-nekama-${id}`;
 const dbName=`x-nekama-db-${id}`;
 const bucket=`x-nekama-media-${id}`;
 const queue=`x-nekama-tasks-${id}`;
 const dlq=`x-nekama-dlq-${id}`;

 const dbId=await ensureD1(dbName);
 await ensureR2(bucket);
 await ensureQueue(queue);
 await ensureQueue(dlq);

 await writeFile(configPath,renderConfig({worker,dbName,dbId,bucket,queue,dlq,baseUrl:'https://pending.invalid'}));
 note('D1 migrationを適用');
 await run(['d1','migrations','apply',dbName,'--remote','--config',configPath]);

 const key=await encryptionKey();
 note('Workerを初回デプロイ');
 const first=await deployWithSecret(key);
 const url=workerUrl(first.all);
 if(!url)throw new Error('Workers公開URLを自動取得できませんでした。deploy出力を確認してください');

 await writeFile(configPath,renderConfig({worker,dbName,dbId,bucket,queue,dlq,baseUrl:url}));
 note(`公開URLを自動設定: ${url}`);
 await deployWithSecret(key);

 await health(url);
 note('セットアップ完了');
 process.stdout.write(`
公開URL:
  ${url}

このURLをX-Nekamaの「完全自動予約」設定へ入力してください。

重要:
  ${keyPath}
はXセッション暗号化の復旧キーです。GitHubへcommitせず、安全な場所へバックアップしてください。

再診断:
  node setup.mjs --doctor
`);
}
main().catch(error=>{
 console.error('\n[X-Nekama] セットアップに失敗しました。');
 console.error(error.message||error);
 if(error.result?.all)console.error(error.result.all);
 process.exitCode=1;
});
