import * as xactions from '../../x.mjs';
import * as localAI from '../../ai.mjs';
import {writeFile,unlink} from 'node:fs/promises';

const SESSION_COOKIE='nk_session';
const SESSION_DAYS=30;
const MAX_IMAGE_BYTES=5*1024*1024;
const textEncoder=new TextEncoder();
const textDecoder=new TextDecoder();

const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff',...headers}
});
const problem=(status,message)=>json({error:message},status);
const uid=()=>crypto.randomUUID();
const nowIso=()=>new Date().toISOString();
const futureIso=ms=>new Date(Date.now()+ms).toISOString();
const base64url=bytes=>bytesToBase64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const fromBase64=value=>{
  const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
  const raw=atob(normalized+'='.repeat((4-normalized.length%4)%4));
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
};
const randomToken=(bytes=32)=>{const v=new Uint8Array(bytes);crypto.getRandomValues(v);return base64url(v)};
const bytesToBase64=bytes=>{let out='';const chunk=0x8000;for(let i=0;i<bytes.length;i+=chunk)out+=String.fromCharCode(...bytes.subarray(i,Math.min(bytes.length,i+chunk)));return btoa(out)};
async function sha256(value){return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',textEncoder.encode(value))))}
function cookieValue(request,name){
  const cookie=request.headers.get('cookie')||'';
  const found=cookie.split(';').map(x=>x.trim()).find(x=>x.startsWith(name+'='));
  return found?decodeURIComponent(found.slice(name.length+1)):'';
}
function sessionCookie(token,maxAge=SESSION_DAYS*86400){
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`;
}
function clearSessionCookie(){return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`}
function originAllowed(request,env){
  if(['GET','HEAD','OPTIONS'].includes(request.method))return true;
  const origin=request.headers.get('origin');
  if(!origin)return false;
  try{return new URL(origin).origin===new URL(env.PUBLIC_BASE_URL).origin}catch{return false}
}
async function readJson(request,limit=6*1024*1024){
  const length=Number(request.headers.get('content-length')||0);
  if(length>limit)throw Object.assign(new Error('payload_too_large'),{status:413});
  const text=await request.text();
  if(text.length>limit)throw Object.assign(new Error('payload_too_large'),{status:413});
  try{return text?JSON.parse(text):{}}catch{throw Object.assign(new Error('bad_json'),{status:400})}
}
async function encryptionKey(env){
  const raw=fromBase64(env.TOKEN_ENCRYPTION_KEY||'');
  if(raw.length!==32)throw new Error('TOKEN_ENCRYPTION_KEY must decode to 32 bytes');
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}
async function seal(env,value,aad){
  const iv=new Uint8Array(12);crypto.getRandomValues(iv);
  const key=await encryptionKey(env);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:textEncoder.encode(aad)},key,textEncoder.encode(value));
  const packed=new Uint8Array(iv.length+encrypted.byteLength);packed.set(iv);packed.set(new Uint8Array(encrypted),iv.length);
  return base64url(packed);
}
async function open(env,value,aad){
  const packed=fromBase64(value);if(packed.length<29)throw new Error('invalid ciphertext');
  const key=await encryptionKey(env),iv=packed.slice(0,12),cipher=packed.slice(12);
  const clear=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:textEncoder.encode(aad)},key,cipher);
  return textDecoder.decode(clear);
}
async function sessionUser(request,env){
  const token=cookieValue(request,SESSION_COOKIE);if(!token)return null;
  const hash=await sha256(token);
  const row=await env.DB.prepare(`SELECT u.id,u.login_x_user_id,u.login_username
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>CURRENT_TIMESTAMP`).bind(hash).first();
  return row||null;
}
async function requireUser(request,env){
  const user=await sessionUser(request,env);
  if(!user)throw Object.assign(new Error('unauthorized'),{status:401});
  return user;
}
async function makeSession(env,userId){
  const token=randomToken(32),hash=await sha256(token);
  await env.DB.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .bind(hash,userId,futureIso(SESSION_DAYS*86400000)).run();
  return token;
}
async function deleteSession(request,env){
  const token=cookieValue(request,SESSION_COOKIE);if(!token)return;
  await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await sha256(token)).run();
}
async function accountSession(env,account){
  if(!account?.session_cipher)throw Object.assign(new Error('x_session_missing'),{status:401});
  return open(env,account.session_cipher,`${account.owner_id}:${account.id}:session`);
}
function publicAccount(a){
  if(!a)return null;
  const copy={...a};
  delete copy.session_cipher;delete copy.owner_id;
  copy.session_status='connected';
  return copy;
}
async function resolveXSession(body){
  const cookies=String(body.cookies||'').trim();
  if(cookies){
    const who=await xactions.verify(cookies);
    return {who,cookies};
  }
  const username=String(body.username||'').replace(/^@/,'').trim();
  const password=String(body.password||'');
  const email=String(body.email||'').trim();
  if(!username||!password)throw Object.assign(new Error('x_login_required'),{status:400});
  const result=await xactions.login(username,password,email);
  return {who:result.who,cookies:result.cookies};
}
async function connectXSession(request,env){
  const current=await sessionUser(request,env);
  const body=await readJson(request,32768);
  let resolved;
  try{resolved=await resolveXSession(body)}
  catch(error){
    const message=String(error?.message||error);
    if(/two-factor|2FA|captcha|verification|LoginAcid/i.test(message)){
      throw Object.assign(new Error('cookie_login_required'),{status:400});
    }
    throw Object.assign(new Error('x_login_failed'),{status:Number(error?.status)||400});
  }
  const who=resolved.who;
  if(!who?.id||!who?.username)throw Object.assign(new Error('x_identity_missing'),{status:400});

  let ownerId=current?.id||null;
  let setCookie=null;
  if(!ownerId){
    const existing=await env.DB.prepare('SELECT id FROM users WHERE login_x_user_id=?').bind(String(who.id)).first();
    ownerId=existing?.id||uid();
    if(existing){
      await env.DB.prepare('UPDATE users SET login_username=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').bind(who.username,ownerId).run();
    }else{
      await env.DB.prepare('INSERT INTO users(id,login_x_user_id,login_username) VALUES(?,?,?)').bind(ownerId,String(who.id),who.username).run();
    }
    const token=await makeSession(env,ownerId);
    setCookie=sessionCookie(token);
  }

  let account;
  if(body.account_id){
    account=await ownedAccount(env,ownerId,String(body.account_id));
    if(String(account.x_user_id)!==String(who.id))throw Object.assign(new Error('x_account_mismatch'),{status:400});
  }else{
    account=await env.DB.prepare('SELECT * FROM accounts WHERE owner_id=? AND x_user_id=?').bind(ownerId,String(who.id)).first();
  }
  const accountId=account?.id||uid();
  const cipher=await seal(env,resolved.cookies,`${ownerId}:${accountId}:session`);
  const character=account?.character_name||who.name||who.username;
  const bio=account?.bio||`架空のAIキャラクター｜${character}`;
  try{
    await xactions.ensureBio(resolved.cookies,who.username,bio);
  }catch(error){
    throw Object.assign(new Error('x_profile_disclosure_failed'),{status:400});
  }
  if(account){
    await env.DB.prepare(`UPDATE accounts SET username=?,display_name=?,session_cipher=?,session_status='connected',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
      .bind(who.username,who.name||who.username,cipher,accountId,ownerId).run();
  }else{
    await env.DB.prepare(`INSERT INTO accounts(
      id,owner_id,x_user_id,username,display_name,character_name,bio,session_cipher,session_status
    ) VALUES(?,?,?,?,?,?,?,?, 'connected')`)
      .bind(accountId,ownerId,String(who.id),who.username,who.name||who.username,character,bio,cipher).run();
  }
  await audit(env,ownerId,current?'account_connect':'login',accountId);
  return json({ok:true,username:who.username,account_id:accountId},200,setCookie?{'set-cookie':setCookie}:{});
}
function imageInfo(dataUrl){
  const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl||''));
  if(!m)throw Object.assign(new Error('invalid_image'),{status:400});
  const raw=atob(m[2]);if(!raw.length||raw.length>MAX_IMAGE_BYTES)throw Object.assign(new Error('image_size'),{status:413});
  const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
  const real=bytes[0]===0xff&&bytes[1]===0xd8?'image/jpeg':
    bytes[0]===0x89&&bytes[1]===0x50?'image/png':
    String.fromCharCode(...bytes.slice(0,4))==='RIFF'&&String.fromCharCode(...bytes.slice(8,12))==='WEBP'?'image/webp':null;
  if(real!==m[1])throw Object.assign(new Error('invalid_image'),{status:400});
  return {bytes,mime:real};
}
const extFor=mime=>({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime]||'bin');
async function ownedAccount(env,ownerId,id){
  const row=await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND owner_id=?').bind(id,ownerId).first();
  if(!row)throw Object.assign(new Error('not_found'),{status:404});
  return row;
}
async function ownedDraft(env,ownerId,id){
  const row=await env.DB.prepare('SELECT * FROM drafts WHERE id=? AND owner_id=?').bind(id,ownerId).first();
  if(!row)throw Object.assign(new Error('not_found'),{status:404});
  return row;
}
async function ownedAsset(env,ownerId,id){
  const row=await env.DB.prepare('SELECT * FROM assets WHERE id=? AND owner_id=?').bind(id,ownerId).first();
  if(!row)throw Object.assign(new Error('not_found'),{status:404});
  return row;
}
async function ownedRef(env,ownerId,id){
  const row=await env.DB.prepare('SELECT * FROM refs WHERE id=? AND owner_id=?').bind(id,ownerId).first();
  if(!row)throw Object.assign(new Error('not_found'),{status:404});
  return row;
}

async function audit(env,ownerId,kind,objectId=null){
  await env.DB.prepare('INSERT INTO audit_events(id,owner_id,kind,object_id) VALUES(?,?,?,?)').bind(uid(),ownerId||null,kind,objectId).run();
}

async function stateResponse(env,user){
  const [accounts,refs,assets,drafts,jobs]=await Promise.all([
    env.DB.prepare('SELECT * FROM accounts WHERE owner_id=? ORDER BY created_at DESC').bind(user.id).all(),
    env.DB.prepare('SELECT id,username,display_name,account_id,summary,fetched_at,created_at FROM refs WHERE owner_id=? ORDER BY created_at DESC').bind(user.id).all(),
    env.DB.prepare('SELECT id,account_id,kind,category,name,mime,created_at FROM assets WHERE owner_id=? ORDER BY created_at DESC').bind(user.id).all(),
    env.DB.prepare('SELECT id,account_id,text,image_style,image_prompt,image_id,status,scheduled_at,posted_at,x_post_id,error,attempt_count,next_attempt_at,last_error_kind,created_at,updated_at FROM drafts WHERE owner_id=? ORDER BY COALESCE(scheduled_at,created_at) DESC LIMIT 500').bind(user.id).all(),
    env.DB.prepare('SELECT id,account_id,kind,status,detail,created_at,updated_at FROM jobs WHERE owner_id=? ORDER BY created_at DESC LIMIT 50').bind(user.id).all()
  ]);
  return json({
    user:{username:user.login_username},
    accounts:accounts.results.map(publicAccount),
    refs:refs.results,
    assets:assets.results,
    drafts:drafts.results,
    jobs:jobs.results,
    configured:true,
    generation_mode:'device_grok',
    auth_mode:'x_session'
  });
}
const accountFields=new Set(['display_name','character_name','age','gender','occupation','location','tone','first_person','personality','hobbies','bio','emoji_style','ng_topics','posting_frequency','activity_interval_days','active_hours','enabled','auto_approve','auto_generate_images']);
async function patchAccount(request,env,user,id){
  const current=await ownedAccount(env,user.id,id),body=await readJson(request,65536),values={};
  for(const [key,value] of Object.entries(body))if(accountFields.has(key))values[key]=value;
  for(const key of ['enabled','auto_approve'])if(key in values)values[key]=values[key]===true?1:0;
  if('auto_generate_images'in values){if(values.auto_generate_images===true)return problem(400,'画像生成は端末のX/Grokで行います');values.auto_generate_images=0;}
  if('activity_interval_days'in values){
    values.activity_interval_days=Number(values.activity_interval_days);
    if(!Number.isInteger(values.activity_interval_days)||values.activity_interval_days<1||values.activity_interval_days>365)return problem(400,'浮上頻度は1〜365日の整数で設定してください');
  }
  if('posting_frequency'in values){
    values.posting_frequency=Number(values.posting_frequency);
    if(!Number.isInteger(values.posting_frequency)||values.posting_frequency<1||values.posting_frequency>21)return problem(400,'投稿案数は1〜21件で設定してください');
  }
  if('age'in values&&values.age!==''){values.age=Number(values.age);if(!Number.isInteger(values.age)||values.age<18||values.age>120)return problem(400,'年齢は18〜120で設定してください')}
  const bio=String((values.bio??current.bio)||'');
  if(!/AI/i.test(bio)||!/(架空|バーチャル)/.test(bio))return problem(400,'プロフィールに架空のAIキャラクターである旨を記載してください');
  if(!Object.keys(values).length)return problem(400,'変更項目がありません');
  if('bio' in values && values.bio!==current.bio){
    try{
      const cookies=await accountSession(env,current);
      await xactions.ensureBio(cookies,current.username,String(values.bio));
    }catch{
      return problem(502,'XプロフィールのAI表記を更新できませんでした');
    }
  }
  const keys=Object.keys(values),sql=`UPDATE accounts SET ${keys.map(k=>k+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`;
  await env.DB.prepare(sql).bind(...keys.map(k=>values[k]??''),id,user.id).run();
  await audit(env,user.id,'account_update',id);
  return json({ok:true});
}
async function createAsset(request,env,user){
  const body=await readJson(request),accountId=body.account_id||null;
  if(accountId)await ownedAccount(env,user.id,accountId);
  const kind=body.kind==='base'?'base':'style';
  const categories=new Set(['purikura','bereal','selfie','mirror','candid','phone_case','outfit','accessory','background']);
  if(kind==='base'&&!accountId)return problem(400,'キャラクターを選択してください');
  if(kind==='style'&&!categories.has(String(body.category||'')))return problem(400,'画像カテゴリを選択してください');
  const {bytes,mime}=imageInfo(body.data);
  const id=uid(),key=`${user.id}/${id}.${extFor(mime)}`;
  await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'private, no-store'},customMetadata:{owner:user.id,asset:id}});
  try{
    await env.DB.prepare('INSERT INTO assets(id,owner_id,account_id,kind,category,name,mime,r2_key) VALUES(?,?,?,?,?,?,?,?)')
      .bind(id,user.id,accountId,kind,body.category||null,String(body.name||'').slice(0,100),mime,key).run();
  }catch(error){await env.MEDIA.delete(key);throw error}
  await audit(env,user.id,'asset_create',id);
  return json({id},201);
}
async function serveAsset(env,user,id){
  const asset=await ownedAsset(env,user.id,id),object=await env.MEDIA.get(asset.r2_key);
  if(!object)return problem(404,'画像が見つかりません');
  return new Response(object.body,{headers:{
    'content-type':asset.mime,
    'cache-control':'private, no-store, max-age=0',
    'content-security-policy':"default-src 'none'",
    'x-content-type-options':'nosniff'
  }});
}
async function deleteAsset(env,user,id){
  const asset=await ownedAsset(env,user.id,id);
  const used=await env.DB.prepare('SELECT id FROM drafts WHERE owner_id=? AND image_id=? LIMIT 1').bind(user.id,id).first();
  if(used)return problem(409,'投稿で使用中の画像は削除できません');
  await env.DB.prepare('DELETE FROM assets WHERE id=? AND owner_id=?').bind(id,user.id).run();
  await env.MEDIA.delete(asset.r2_key);
  await audit(env,user.id,'asset_delete',id);
  return json({ok:true});
}

async function removeGeneratedAssetIfUnused(env,ownerId,id){
  if(!id)return;
  const used=await env.DB.prepare('SELECT id FROM drafts WHERE owner_id=? AND image_id=? LIMIT 1').bind(ownerId,id).first();
  if(used)return;
  const asset=await env.DB.prepare("SELECT * FROM assets WHERE owner_id=? AND id=? AND (kind='generated' OR category='uploaded')").bind(ownerId,id).first();
  if(!asset)return;
  await env.DB.prepare('DELETE FROM assets WHERE id=? AND owner_id=?').bind(id,ownerId).run();
  await env.MEDIA.delete(asset.r2_key);
}
async function setDraftImageData(env,user,draft,data,name='投稿画像'){
  if(draft.status!=='needs_review')throw Object.assign(new Error('bad_state'),{status:409});
  if(!draft.image_style)throw Object.assign(new Error('no_image_style'),{status:400});
  const {bytes,mime}=imageInfo(data),id=uid(),key=`${user.id}/${id}.${extFor(mime)}`;
  await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:mime,cacheControl:'private, no-store'}});
  try{
    await env.DB.batch([
      env.DB.prepare("INSERT INTO assets(id,owner_id,account_id,kind,category,name,mime,r2_key) VALUES(?,?,?,'generated','uploaded',?,?,?)")
        .bind(id,user.id,draft.account_id,String(name||'投稿画像').slice(0,100),mime,key),
      env.DB.prepare('UPDATE drafts SET image_id=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?')
        .bind(id,draft.id,user.id)
    ]);
  }catch(error){await env.MEDIA.delete(key);throw error}
  await removeGeneratedAssetIfUnused(env,user.id,draft.image_id);
  return id;
}
async function fetchReferencePosts(env,user,ref,account,requestedLimit){
  const limit=Math.min(500,Math.max(20,Number(requestedLimit)||100));
  const cookies=await accountSession(env,account);
  const {profile,posts}=await xactions.collect(cookies,ref.username,limit);
  const statements=(posts||[]).slice(0,limit).filter(p=>p?.id&&p?.text).map(p=>env.DB.prepare(`INSERT INTO ref_posts(id,owner_id,ref_id,text,posted_at,metrics_json,media_json)
    VALUES(?,?,?,?,?,?,?) ON CONFLICT(owner_id,ref_id,id) DO UPDATE SET text=excluded.text,posted_at=excluded.posted_at,metrics_json=excluded.metrics_json,media_json=excluded.media_json`)
    .bind(String(p.id),user.id,ref.id,String(p.text).slice(0,4000),p.createdAt||null,JSON.stringify(p.metrics||{}),JSON.stringify(p.media||[])));
  if(statements.length)await env.DB.batch(statements);
  await env.DB.prepare('UPDATE refs SET display_name=?,account_id=?,fetched_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?')
    .bind(profile?.name||ref.username,account.id,ref.id,user.id).run();
  return statements.length;
}
async function buildAnalysisPack(env,user,ref){
  const rows=await env.DB.prepare('SELECT text,posted_at,media_json FROM ref_posts WHERE owner_id=? AND ref_id=? ORDER BY posted_at DESC LIMIT 120')
    .bind(user.id,ref.id).all();
  if(!rows.results.length)throw Object.assign(new Error('no_reference_posts'),{status:400});
  return {mode:'device_grok',kind:'analysis',ref_id:ref.id,prompt:localAI.analysisPrompt(ref,rows.results)};
}
async function importAnalysisPack(env,user,ref,input){
  const summary=localAI.parseAnalysisResult(input);
  await env.DB.prepare('UPDATE refs SET summary=? WHERE id=? AND owner_id=?').bind(summary,ref.id,user.id).run();
  return true;
}
async function createDraft(request,env,user){
  const body=await readJson(request),account=await ownedAccount(env,user.id,body.account_id);
  const text=String(body.text||'').trim();if(!text||text.length>280)return problem(400,'本文は1〜280文字で入力してください');
  const id=uid(),scheduled=body.scheduled_at?new Date(body.scheduled_at):null;
  if(scheduled&&!Number.isFinite(scheduled.getTime()))return problem(400,'予約日時を確認してください');
  await env.DB.prepare(`INSERT INTO drafts(id,owner_id,account_id,text,image_style,image_prompt,scheduled_at)
    VALUES(?,?,?,?,?,?,?)`).bind(id,user.id,account.id,text,body.image_style||null,String(body.image_prompt||''),scheduled?.toISOString()||null).run();
  await audit(env,user.id,'draft_create',id);
  return json({id},201);
}
async function patchDraft(request,env,user,id){
  const current=await ownedDraft(env,user.id,id);if(!['needs_review','scheduled'].includes(current.status))return problem(409,'編集できない状態です');
  const body=await readJson(request,65536),updates={},allowed=['text','image_style','image_prompt','scheduled_at','image_id'];
  for(const key of allowed)if(Object.hasOwn(body,key))updates[key]=body[key];
  if('text'in updates){updates.text=String(updates.text||'').trim();if(!updates.text||updates.text.length>280)return problem(400,'本文は1〜280文字で入力してください')}
  if('image_id'in updates&&updates.image_id)await ownedAsset(env,user.id,updates.image_id);
  if('scheduled_at'in updates&&updates.scheduled_at){const d=new Date(updates.scheduled_at);if(!Number.isFinite(d.getTime()))return problem(400,'予約日時を確認してください');updates.scheduled_at=d.toISOString()}
  if(!Object.keys(updates).length)return problem(400,'変更項目がありません');
  const keys=Object.keys(updates);
  await env.DB.prepare(`UPDATE drafts SET ${keys.map(k=>k+'=?').join(',')},updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
    .bind(...keys.map(k=>updates[k]??null),id,user.id).run();
  return json({ok:true});
}
async function scheduleDraft(request,env,user,id){
  const draft=await ownedDraft(env,user.id,id);if(draft.status!=='needs_review')return problem(409,'予約できない状態です');
  const body=await readJson(request,8192),date=new Date(body.scheduled_at||draft.scheduled_at||'');
  if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()+60000)return problem(400,'予約日時は1分以上先にしてください');
  if(draft.image_style&&!draft.image_id)return problem(400,'画像付き投稿には画像を設定してください');
  const queueKey=uid();
  await env.DB.prepare(`UPDATE drafts SET status='scheduled',scheduled_at=?,queue_key=?,attempt_count=0,next_attempt_at=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
    .bind(date.toISOString(),queueKey,id,user.id).run();
  await audit(env,user.id,'draft_schedule',id);
  return json({ok:true});
}
async function buildWeekPack(env,user,account,count){
  count=Math.min(21,Math.max(1,Number(count)||Number(account.posting_frequency)||7));
  const refs=await env.DB.prepare('SELECT username,summary,fetched_at FROM refs WHERE owner_id=? ORDER BY fetched_at DESC LIMIT 8').bind(user.id).all();
  const history=await env.DB.prepare('SELECT text FROM drafts WHERE owner_id=? AND account_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id,account.id).all();
  const interval=Math.min(365,Math.max(1,Number(account.activity_interval_days)||1));
  const future=await env.DB.prepare(`SELECT scheduled_at FROM drafts WHERE owner_id=? AND account_id=? AND status IN ('needs_review','scheduled','publishing') AND scheduled_at IS NOT NULL`)
    .bind(user.id,account.id).all();
  const futureTimes=future.results.map(x=>new Date(x.scheduled_at).getTime()).filter(t=>Number.isFinite(t)&&t>Date.now());
  const latest=futureTimes.length?Math.max(...futureTimes):null;
  const seed=latest?new Date(latest+(interval-1)*86400000).toISOString():new Date().toISOString();
  const pack=localAI.weekPrompt(account,refs.results,history.results,seed,count);
  return {mode:'device_grok',kind:'weekly',account_id:account.id,count,prompt:pack.prompt,dates:pack.dates};
}
async function importWeekPack(env,user,account,input,dates,count){
  const history=await env.DB.prepare('SELECT text FROM drafts WHERE owner_id=? AND account_id=? ORDER BY created_at DESC LIMIT 30').bind(user.id,account.id).all();
  const posts=localAI.parseWeekResult(input,{dates,history:history.results,count});
  const ids=[];
  for(const p of posts){
    const id=uid();
    const assets=await env.DB.prepare("SELECT id,account_id,category,name FROM assets WHERE owner_id=? AND (account_id=? OR account_id IS NULL) ORDER BY created_at DESC LIMIT 50").bind(user.id,account.id).all();
    const prompt=localAI.imagePrompt(account,p,assets.results);
    await env.DB.prepare('INSERT INTO drafts(id,owner_id,account_id,text,image_style,image_prompt,scheduled_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id,user.id,account.id,p.text,p.image_style,prompt,p.scheduled_at).run();
    ids.push(id);
  }
  if(account.auto_approve){
    for(const id of ids){
      const draft=await ownedDraft(env,user.id,id);
      if(draft.image_style)continue;
      const when=new Date(draft.scheduled_at).getTime();
      if(!Number.isFinite(when)||when<Date.now()+60000)continue;
      await env.DB.prepare("UPDATE drafts SET status='scheduled',queue_key=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(uid(),id,user.id).run();
    }
  }
  return ids;
}
async function buildImagePack(env,user,draft){
  const account=await ownedAccount(env,user.id,draft.account_id);
  if(!draft.image_style)throw Object.assign(new Error('no_image_style'),{status:400});
  const refs=await env.DB.prepare(`SELECT id,account_id,kind,category,name,mime FROM assets WHERE owner_id=? AND (account_id=? OR account_id IS NULL) AND (
    kind='base' OR category='phone_case' OR category=?
  ) ORDER BY CASE WHEN account_id=? THEN 0 ELSE 1 END,created_at DESC LIMIT 5`)
    .bind(user.id,account.id,draft.image_style,account.id).all();
  const styleAssets=await env.DB.prepare('SELECT id,account_id,category,name FROM assets WHERE owner_id=? AND (account_id=? OR account_id IS NULL) ORDER BY created_at DESC LIMIT 50')
    .bind(user.id,account.id).all();
  const prompt=String(draft.image_prompt||'').trim()||localAI.imagePrompt(account,draft,styleAssets.results);
  return {mode:'device_grok',kind:'image',draft_id:draft.id,prompt,references:refs.results.map(r=>({
    id:r.id,name:r.name||r.category||'reference',category:r.category,mime:r.mime,url:`/api/assets/${r.id}`
  }))};
}
async function publishDraft(env,draft){
  const account=await env.DB.prepare('SELECT * FROM accounts WHERE id=? AND owner_id=?').bind(draft.account_id,draft.owner_id).first();
  if(!account||!account.enabled)throw new Error('account disabled');
  const claimed=await env.DB.prepare(`UPDATE drafts SET status='publishing',attempt_count=attempt_count+1,last_attempt_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
    WHERE id=? AND owner_id=? AND status='scheduled'`).bind(draft.id,draft.owner_id).run();
  if(!claimed.meta.changes)return;
  let tempPath=null;
  try{
    const cookies=await accountSession(env,account);
    await xactions.checkBio(cookies,account.username);
    if(draft.image_id){
      const asset=await env.DB.prepare('SELECT * FROM assets WHERE id=? AND owner_id=?').bind(draft.image_id,draft.owner_id).first();
      if(!asset)throw Object.assign(new Error('image missing'),{deliveryStage:'upload'});
      const object=await env.MEDIA.get(asset.r2_key);if(!object)throw Object.assign(new Error('image missing'),{deliveryStage:'upload'});
      const ext=extFor(asset.mime);
      tempPath=`/tmp/xnekama-${uid()}.${ext}`;
      await writeFile(tempPath,new Uint8Array(await object.arrayBuffer()));
    }
    const postId=await xactions.publish(cookies,draft.text,tempPath,`架空AIキャラクター ${account.character_name} の生成画像`);
    if(!postId)throw Object.assign(new Error('post id unavailable'),{deliveryStage:'submit'});
    await env.DB.prepare(`UPDATE drafts SET status='posted',x_post_id=?,posted_at=CURRENT_TIMESTAMP,next_attempt_at=NULL,last_error_kind='',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
      .bind(String(postId),draft.id,draft.owner_id).run();
    await audit(env,draft.owner_id,'draft_posted',draft.id);
  }catch(error){
    const attempt=Number(draft.attempt_count||0)+1;
    const status=Number(error?.status||error?.response?.status||0);
    const stage=error?.deliveryStage||'preflight';
    const rateLimited=status===429||/rate limit/i.test(String(error?.message||''));
    const safeTransient=stage!=='submit'&&(!status||status>=500);
    const ambiguous=stage==='submit'&&(!status||status>=500);
    if((rateLimited||safeTransient)&&attempt<3){
      const next=futureIso(rateLimited?60000*Math.pow(2,attempt-1):30000*Math.pow(2,attempt-1));
      await env.DB.prepare(`UPDATE drafts SET status='scheduled',next_attempt_at=?,last_error_kind=?,error='再試行待ち',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
        .bind(next,rateLimited?'rate_limit':'transient',draft.id,draft.owner_id).run();
    }else{
      await env.DB.prepare(`UPDATE drafts SET status='failed',next_attempt_at=NULL,last_error_kind=?,error=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?`)
        .bind(ambiguous?'ambiguous':'rejected',ambiguous?'送信結果を確認できません。X上の投稿有無を確認してください。':'Xへの投稿に失敗しました。',draft.id,draft.owner_id).run();
    }
  }finally{
    if(tempPath)await unlink(tempPath).catch(()=>{});
  }
}
async function cronTick(env){
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at<=CURRENT_TIMESTAMP').run();
  const due=await env.DB.prepare(`SELECT * FROM drafts WHERE status='scheduled' AND scheduled_at<=CURRENT_TIMESTAMP
    AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY scheduled_at LIMIT 25`).all();
  for(const draft of due.results)await env.TASKS.send({type:'publish',draft_id:draft.id,owner_id:draft.owner_id});
}
async function queueMessage(env,message){
  const task=message.body||{};
  if(task.type==='publish'){
    const draft=await env.DB.prepare('SELECT * FROM drafts WHERE id=? AND owner_id=?').bind(task.draft_id,task.owner_id).first();
    if(draft&&draft.status==='scheduled')await publishDraft(env,draft);
    return;
  }
  if(task.type==='ref_fetch'){
    const job=await env.DB.prepare('SELECT * FROM jobs WHERE id=? AND owner_id=?').bind(task.job_id,task.owner_id).first();
    if(!job||job.status!=='queued')return;
    await env.DB.prepare("UPDATE jobs SET status='running',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(job.id,task.owner_id).run();
    try{
      const ref=await ownedRef(env,task.owner_id,task.ref_id),account=await ownedAccount(env,task.owner_id,task.account_id);
      const count=await fetchReferencePosts(env,{id:task.owner_id},ref,account,task.limit);
      await env.DB.prepare("UPDATE jobs SET status='done',detail=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(`${count}件取得`,job.id,task.owner_id).run();
    }catch{
      await env.DB.prepare("UPDATE jobs SET status='failed',detail='参考投稿の取得に失敗しました',updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(job.id,task.owner_id).run();
    }
  }
}
async function handleApi(request,env){
  const url=new URL(request.url),path=url.pathname,method=request.method;
  if((path==='/api/me'||path==='/api/auth')&&method==='GET'){
    const user=await sessionUser(request,env);return json({authenticated:!!user,mode:'x_session',user:user?{username:user.login_username}:null});
  }
  if(path==='/api/x-session'&&method==='POST')return connectXSession(request,env);
  if(path==='/api/logout'&&method==='POST'){
    await deleteSession(request,env);return json({ok:true},200,{'set-cookie':clearSessionCookie()});
  }
  if(path==='/api/me'&&method==='DELETE'){
    const user=await requireUser(request,env);
    const assets=await env.DB.prepare('SELECT r2_key FROM assets WHERE owner_id=?').bind(user.id).all();
    for(const asset of assets.results)await env.MEDIA.delete(asset.r2_key);
    await env.DB.prepare('DELETE FROM audit_events WHERE owner_id=?').bind(user.id).run();
    await env.DB.prepare('DELETE FROM users WHERE id=?').bind(user.id).run();
    return json({ok:true},200,{'set-cookie':clearSessionCookie()});
  }
  const user=await requireUser(request,env);
  if(path==='/api/state'&&method==='GET')return stateResponse(env,user);
  if(path==='/api/health'&&method==='GET')return json({ok:true});
  if(path==='/api/refs'&&method==='POST'){
    const body=await readJson(request,8192),username=String(body.username||'').replace(/^@/,'').trim();
    if(!/^[A-Za-z0-9_]{1,15}$/.test(username))return problem(400,'IDを確認してください');
    const id=uid();
    try{await env.DB.prepare('INSERT INTO refs(id,owner_id,username) VALUES(?,?,?)').bind(id,user.id,username).run()}
    catch{return problem(409,'このお手本アカウントは登録済みです')}
    return json({id},201);
  }
  if(path==='/api/ref-posts'&&method==='GET'){
    const refId=url.searchParams.get('ref_id')||'';await ownedRef(env,user.id,refId);
    const posts=await env.DB.prepare('SELECT id,text,posted_at,metrics_json,media_json FROM ref_posts WHERE owner_id=? AND ref_id=? ORDER BY posted_at DESC LIMIT 500').bind(user.id,refId).all();
    return json({posts:posts.results});
  }
  let refMatch=path.match(/^\/api\/refs\/([^/]+)$/);
  if(refMatch&&method==='DELETE'){
    await ownedRef(env,user.id,refMatch[1]);await env.DB.prepare('DELETE FROM refs WHERE id=? AND owner_id=?').bind(refMatch[1],user.id).run();return json({ok:true});
  }
  refMatch=path.match(/^\/api\/refs\/([^/]+)\/fetch$/);
  if(refMatch&&method==='POST'){
    const ref=await ownedRef(env,user.id,refMatch[1]),body=await readJson(request,8192),account=await ownedAccount(env,user.id,body.account_id);
    const limit=Number(body.limit)||100;if(!Number.isInteger(limit)||limit<20||limit>500)return problem(400,'公開版では20〜500件で指定してください');
    const job=uid();await env.DB.prepare("INSERT INTO jobs(id,owner_id,account_id,kind,status,detail) VALUES(?,?,?,'ref-fetch','queued','')").bind(job,user.id,account.id).run();
    await env.TASKS.send({type:'ref_fetch',job_id:job,owner_id:user.id,ref_id:ref.id,account_id:account.id,limit});return json({job},202);
  }
  refMatch=path.match(/^\/api\/refs\/([^/]+)\/analyze$/);
  if(refMatch&&method==='POST'){
    const ref=await ownedRef(env,user.id,refMatch[1]);
    return json(await buildAnalysisPack(env,user,ref));
  }
  refMatch=path.match(/^\/api\/refs\/([^/]+)\/analyze\/import$/);
  if(refMatch&&method==='POST'){
    const ref=await ownedRef(env,user.id,refMatch[1]),body=await readJson(request,65536);
    try{await importAnalysisPack(env,user,ref,body.result)}catch(error){return problem(400,String(error.message||error))}
    return json({ok:true});
  }
  let m=path.match(/^\/api\/accounts\/([^/]+)$/);
  if(m&&method==='PATCH')return patchAccount(request,env,user,m[1]);
  if(m&&method==='DELETE'){
    await ownedAccount(env,user.id,m[1]);
    const assets=await env.DB.prepare('SELECT r2_key FROM assets WHERE owner_id=? AND account_id=?').bind(user.id,m[1]).all();
    await env.DB.prepare('DELETE FROM accounts WHERE id=? AND owner_id=?').bind(m[1],user.id).run();
    for(const a of assets.results)await env.MEDIA.delete(a.r2_key);
    await audit(env,user.id,'account_delete',m[1]);return json({ok:true});
  }
  if(path==='/api/assets'&&method==='POST')return createAsset(request,env,user);
  m=path.match(/^\/api\/assets\/([^/]+)$/);
  if(m&&method==='GET')return serveAsset(env,user,m[1]);
  if(m&&method==='DELETE')return deleteAsset(env,user,m[1]);
  if(path==='/api/drafts'&&method==='POST')return createDraft(request,env,user);
  m=path.match(/^\/api\/drafts\/([^/]+)$/);
  if(m&&method==='PATCH')return patchDraft(request,env,user,m[1]);
  if(m&&method==='DELETE'){
    const d=await ownedDraft(env,user.id,m[1]);if(d.status!=='needs_review')return problem(409,'削除できない状態です');
    await env.DB.prepare('DELETE FROM drafts WHERE id=? AND owner_id=?').bind(d.id,user.id).run();return json({ok:true});
  }
  if(path==='/api/drafts/images/bulk'&&method==='POST'){
    const body=await readJson(request,60*1024*1024),items=body.items;
    if(!Array.isArray(items)||!items.length||items.length>10)return problem(400,'一度に1〜10枚を選択してください');
    const seen=new Set(),prepared=[];
    for(const item of items){
      if(!item?.draft_id||seen.has(item.draft_id))return problem(400,'同じ投稿への重複指定はできません');seen.add(item.draft_id);
      const draft=await ownedDraft(env,user.id,item.draft_id);
      if(draft.status!=='needs_review'||!draft.image_style)return problem(409,'画像待ちのレビュー投稿を指定してください');
      const image=imageInfo(item.data),id=uid(),key=`${user.id}/${id}.${extFor(image.mime)}`;
      prepared.push({draft,image,id,key,name:String(item.name||'投稿画像').slice(0,100)});
    }
    for(const p of prepared)await env.MEDIA.put(p.key,p.image.bytes,{httpMetadata:{contentType:p.image.mime,cacheControl:'private, no-store'}});
    try{
      const statements=[];
      for(const p of prepared){
        statements.push(env.DB.prepare("INSERT INTO assets(id,owner_id,account_id,kind,category,name,mime,r2_key) VALUES(?,?,?,'generated','uploaded',?,?,?)").bind(p.id,user.id,p.draft.account_id,p.name,p.image.mime,p.key));
        statements.push(env.DB.prepare('UPDATE drafts SET image_id=?,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?').bind(p.id,p.draft.id,user.id));
      }
      await env.DB.batch(statements);
    }catch(error){for(const p of prepared)await env.MEDIA.delete(p.key);throw error}
    for(const p of prepared)await removeGeneratedAssetIfUnused(env,user.id,p.draft.image_id);
    return json({count:prepared.length},201);
  }
  m=path.match(/^\/api\/drafts\/([^/]+)\/image$/);
  if(m&&method==='POST'){
    const draft=await ownedDraft(env,user.id,m[1]),body=await readJson(request);
    const id=await setDraftImageData(env,user,draft,body.data,body.name);return json({id},201);
  }
  if(m&&method==='DELETE'){
    const draft=await ownedDraft(env,user.id,m[1]);if(draft.status!=='needs_review')return problem(409,'レビュー待ちの投稿だけ画像を外せます');
    const old=draft.image_id;await env.DB.prepare('UPDATE drafts SET image_id=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?').bind(draft.id,user.id).run();
    await removeGeneratedAssetIfUnused(env,user.id,old);return json({ok:true});
  }
  m=path.match(/^\/api\/drafts\/([^/]+)\/resolve$/);
  if(m&&method==='POST'){
    const draft=await ownedDraft(env,user.id,m[1]);if(!['failed','publishing'].includes(draft.status))return problem(409,'確認対象の投稿ではありません');
    const body=await readJson(request,8192);
    if(body.outcome==='posted'){
      const postId=String(body.x_post_id||'');if(!/^\d{10,25}$/.test(postId))return problem(400,'Xの投稿IDを入力してください');
      await env.DB.prepare("UPDATE drafts SET status='posted',x_post_id=?,posted_at=CURRENT_TIMESTAMP,next_attempt_at=NULL,last_error_kind='',error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(postId,draft.id,user.id).run();
    }else if(body.outcome==='not_posted'){
      await env.DB.prepare("UPDATE drafts SET status='needs_review',scheduled_at=NULL,queue_key=NULL,next_attempt_at=NULL,last_attempt_at=NULL,last_error_kind='',attempt_count=0,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(draft.id,user.id).run();
    }else return problem(400,'X上の投稿状況を選択してください');
    return json({ok:true});
  }
  m=path.match(/^\/api\/drafts\/([^/]+)\/schedule$/);
  if(m&&method==='POST')return scheduleDraft(request,env,user,m[1]);
  m=path.match(/^\/api\/drafts\/([^/]+)\/unschedule$/);
  if(m&&method==='POST'){
    const d=await ownedDraft(env,user.id,m[1]);if(d.status!=='scheduled')return problem(409,'予約済みではありません');
    await env.DB.prepare("UPDATE drafts SET status='needs_review',queue_key=NULL,next_attempt_at=NULL,error=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=? AND owner_id=?").bind(d.id,user.id).run();
    return json({ok:true});
  }
  m=path.match(/^\/api\/drafts\/([^/]+)\/generate-image$/);
  if(m&&method==='POST'){
    const d=await ownedDraft(env,user.id,m[1]);if(d.status!=='needs_review')return problem(409,'レビュー待ちのみ生成できます');
    return json(await buildImagePack(env,user,d));
  }
  if(path==='/api/generate-week'&&method==='POST'){
    const body=await readJson(request,8192),account=await ownedAccount(env,user.id,body.account_id);
    return json(await buildWeekPack(env,user,account,body.count||account.posting_frequency||7));
  }
  if(path==='/api/generate-week/import'&&method==='POST'){
    const body=await readJson(request,512*1024),account=await ownedAccount(env,user.id,body.account_id);
    let ids;try{ids=await importWeekPack(env,user,account,body.result,Array.isArray(body.dates)?body.dates.map(String):[],Math.min(21,Math.max(1,Number(body.count)||7)))}catch(error){return problem(400,String(error.message||error))}
    return json({ids,count:ids.length},201);
  }
  return problem(404,'ページが見つかりません');
}
export default {
  async fetch(request,env){
    try{
      const url=new URL(request.url);
      if(url.pathname.startsWith('/api/')){
        if(!originAllowed(request,env))return problem(403,'送信元を確認してください');
        return await handleApi(request,env);
      }
      const response=await env.STATIC.fetch(request);
      const headers=new Headers(response.headers);
      headers.set('x-content-type-options','nosniff');
      headers.set('referrer-policy','no-referrer');
      headers.set('x-frame-options','DENY');
      headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
      headers.set('content-security-policy',"default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
      return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
    }catch(error){
      const status=Number(error?.status||0);
      if(status===401)return problem(401,'ログインしてください');
      if(status===429)return problem(429,'一時的に制限されています');
      if(status===404)return problem(404,'見つかりません');
      if(status===413)return problem(413,'データが大きすぎます');
      if(status===409)return problem(409,'現在の状態では実行できません');
      if(status===400){
        if(error?.message==='cookie_login_required')return problem(400,'このXアカウントは追加認証が必要です。ログイン済みCookieで接続してください');
        if(error?.message==='x_account_mismatch')return problem(400,'選択したアカウントとXセッションが一致しません');
        if(error?.message==='x_login_failed')return problem(400,'Xへのログインに失敗しました。Cookie接続も試してください');
        if(error?.message==='x_profile_disclosure_failed')return problem(400,'Xプロフィールへ架空AIキャラクター表記を反映できませんでした');
        return problem(400,'入力内容を確認してください');
      }
      return problem(500,'処理に失敗しました');
    }
  },
  async scheduled(_controller,env,ctx){ctx.waitUntil(cronTick(env))},
  async queue(batch,env){
    for(const message of batch.messages){
      try{await queueMessage(env,message);message.ack()}
      catch{message.retry({delaySeconds:60})}
    }
  }
};
