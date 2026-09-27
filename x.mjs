// XActions' maintained HTTP client is vendored under Apache-2.0; see vendor/xactions/LICENSE.
import {TwitterHttpClient} from './vendor/xactions/src/scrapers/twitter/http/client.js';
import {TwitterAuth} from './vendor/xactions/src/scrapers/twitter/http/auth.js';
import {scrapeProfile} from './vendor/xactions/src/scrapers/twitter/http/profile.js';
import {scrapeTweets} from './vendor/xactions/src/scrapers/twitter/http/tweets.js';
import {postTweet} from './vendor/xactions/src/scrapers/twitter/http/actions.js';
import {uploadImage} from './vendor/xactions/src/scrapers/twitter/http/media.js';
import {readFile} from 'node:fs/promises';
function stageError(error,stage){if(error&&typeof error==='object'){error.deliveryStage=stage;return error}const wrapped=new Error(String(error));wrapped.deliveryStage=stage;return wrapped}

async function xApiRequest(token,path,{method='GET',body}={}){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
 try{
  const response=await fetch(`https://api.x.com${path}`,{
   method,
   headers:{authorization:`Bearer ${token}`,...(body?{'content-type':'application/json'}:{})},
   body:body?JSON.stringify(body):undefined,
   signal:controller.signal
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok){
   const message=json?.detail||json?.title||json?.errors?.[0]?.detail||json?.errors?.[0]?.message||json?.message||`X API HTTP ${response.status}`;
   const error=new Error(String(message));error.status=response.status;error.response=response;throw error;
  }
  return json;
 }finally{clearTimeout(timer)}
}

export async function verifyApiToken(token){
 const json=await xApiRequest(token,'/2/users/me?user.fields=description,username,name');
 const u=json?.data;if(!u?.username)throw Error('X APIからログイン中ユーザーを確認できませんでした');
 return {id:String(u.id||''),username:u.username,name:u.name||u.username,bio:u.description||''};
}
export async function checkApiBio(token,username){
 const who=await verifyApiToken(token);
 if(who.username.toLowerCase()!==String(username).toLowerCase())throw Error(`X APIの接続先が @${who.username} です`);
 if(!/AI/i.test(who.bio||'')||!/(架空|バーチャル)/.test(who.bio||''))throw Error('X上のプロフィールに架空AIキャラクターの表記がありません');
 return who;
}
export async function publishApi(token,text,imagePath,altText=''){
 const mediaIds=[];
 if(imagePath){
  try{
   const bytes=await readFile(imagePath);
   if(bytes.length>5*1024*1024)throw Error('X APIの画像上限は5MBです');
   const upload=await xApiRequest(token,'/2/media/upload',{method:'POST',body:{media:bytes.toString('base64'),media_category:'tweet_image'}});
   const mediaId=upload?.data?.id;
   if(!mediaId)throw Error('X APIのメディアIDを確認できませんでした');
   mediaIds.push(String(mediaId));
  }catch(error){throw stageError(error,'upload')}
 }
 let result;
 try{
  result=await xApiRequest(token,'/2/tweets',{method:'POST',body:{
   text:String(text||''),
   ...(mediaIds.length?{media:{media_ids:mediaIds},made_with_ai:true}:{})
  }});
 }catch(error){throw stageError(error,'submit')}
 const id=result?.data?.id;
 if(!id){const error=new Error('X APIの返答から投稿IDを確認できません。X上の投稿有無を確認してください。');error.deliveryStage='submit';throw error}
 return String(id);
}
export async function login(username,password,email=''){
 const auth=new TwitterAuth();
 const who=await auth.loginWithCredentials(username,password,email);
 return {who,cookies:Object.entries(auth.getCookies()).map(([k,v])=>`${k}=${v}`).join('; ')};
}
export async function verify(cookies){const auth=new TwitterAuth();return auth.loginWithCookies(cookies)}
export async function ensureBio(cookies,username,bio){
 if(!/AI/i.test(bio)||!/(架空|バーチャル)/.test(bio))throw Error('Xプロフィールには架空AIキャラクターと明記してください');
 if(bio.length>160)throw Error('Xプロフィールは160文字以内で入力してください');
 const client=new TwitterHttpClient({cookies,rateLimitStrategy:'error'});
 const current=await scrapeProfile(client,username);
 if(current.bio!==bio){await client.rest('/1.1/account/update_profile.json',{body:{description:bio}})}
 const updated=await scrapeProfile(client,username);
 if(!/AI/i.test(updated.bio||'')||!/(架空|バーチャル)/.test(updated.bio||''))throw Error('XプロフィールへのAI表記を確認できませんでした');
 return updated;
}
export async function checkBio(cookies,username){
 const current=await scrapeProfile(new TwitterHttpClient({cookies,rateLimitStrategy:'error'}),username);
 if(!/AI/i.test(current.bio||'')||!/(架空|バーチャル)/.test(current.bio||''))throw Error('X上のプロフィールに架空AIキャラクターの表記がありません。接続を更新してください');
}
export async function collect(cookies,username,limit=500){
 const client=new TwitterHttpClient({cookies,rateLimitStrategy:'error'});
 const [profile,posts]=await Promise.all([scrapeProfile(client,username),scrapeTweets(client,username,{limit})]);
 return {profile,posts};
}
export async function publish(cookies,text,imagePath,altText){
 const client=new TwitterHttpClient({cookies,rateLimitStrategy:'error'});
 const mediaIds=[];
 if(imagePath){
  try{const media=await uploadImage(client,await readFile(imagePath),{altText});mediaIds.push(media.mediaId)}
  catch(error){throw stageError(error,'upload')}
 }
 let result;
 try{result=await postTweet(client,text,{mediaIds})}
 catch(error){throw stageError(error,'submit')}
 const id=result?.rest_id??result?.legacy?.id_str??result?.tweet?.rest_id;
 if(!id){const error=new Error('Xの返答から投稿IDを確認できません。重複投稿を避けるため、Xで投稿有無を確認してから再試行してください。');error.deliveryStage='submit';throw error}
 return String(id);
}
