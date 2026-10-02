// XActions' maintained HTTP client is vendored under Apache-2.0; see vendor/xactions/LICENSE.
import {TwitterHttpClient} from './vendor/xactions/src/scrapers/twitter/http/client.js';
import {TwitterAuth} from './vendor/xactions/src/scrapers/twitter/http/auth.js';
import {scrapeProfile} from './vendor/xactions/src/scrapers/twitter/http/profile.js';
import {scrapeTweets} from './vendor/xactions/src/scrapers/twitter/http/tweets.js';
import {postTweet} from './vendor/xactions/src/scrapers/twitter/http/actions.js';
import {uploadImage} from './vendor/xactions/src/scrapers/twitter/http/media.js';
import {warpFetch} from './vpn.mjs';
import {readFile} from 'node:fs/promises';

function stageError(error,stage){if(error&&typeof error==='object'){if(!error.deliveryStage)error.deliveryStage=stage;return error}const wrapped=new Error(String(error));wrapped.deliveryStage=stage;return wrapped}
function authFor(transport={}){return new TwitterAuth({fetch:transport.fetch||warpFetch})}
function clientFor(cookies,transport={}){
 const options={cookies,rateLimitStrategy:'error',fetch:warpFetch,maxRetries:0};
 if(transport.fetch)options.fetch=transport.fetch;
 if(transport.proxy)options.proxy=transport.proxy;
 return new TwitterHttpClient(options);
}

export async function login(username,password,email='',transport={}){
 const auth=authFor(transport);
 const who=await auth.loginWithCredentials(username,password,email);
 return {who,cookies:Object.entries(auth.getCookies()).map(([k,v])=>`${k}=${v}`).join('; ')};
}
export async function verify(cookies,transport={}){return authFor(transport).loginWithCookies(cookies)}
export async function ensureBio(cookies,username,bio,transport={}){
 if(!/AI/i.test(bio)||!/(架空|バーチャル)/.test(bio))throw Error('Xプロフィールには架空AIキャラクターと明記してください');
 if(bio.length>160)throw Error('Xプロフィールは160文字以内で入力してください');
 const client=clientFor(cookies,transport);
 const current=await scrapeProfile(client,username);
 if(current.bio!==bio){await client.rest('/1.1/account/update_profile.json',{body:{description:bio}})}
 const updated=await scrapeProfile(client,username);
 if(!/AI/i.test(updated.bio||'')||!/(架空|バーチャル)/.test(updated.bio||''))throw Error('XプロフィールへのAI表記を確認できませんでした');
 return updated;
}
export async function checkBio(cookies,username,transport={}){
 const current=await scrapeProfile(clientFor(cookies,transport),username);
 if(!/AI/i.test(current.bio||'')||!/(架空|バーチャル)/.test(current.bio||''))throw Error('X上のプロフィールに架空AIキャラクターの表記がありません。接続を更新してください');
}
export async function collect(cookies,username,limit=500,transport={}){
 const client=clientFor(cookies,transport);
 const [profile,posts]=await Promise.all([scrapeProfile(client,username),scrapeTweets(client,username,{limit})]);
 return {profile,posts};
}
export async function publish(cookies,text,imagePath,altText,transport={}){
 const client=clientFor(cookies,transport);
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
