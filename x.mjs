// XActions' maintained HTTP client is vendored under Apache-2.0; see vendor/xactions/LICENSE.
import {TwitterHttpClient} from './vendor/xactions/src/scrapers/twitter/http/client.js';
import {TwitterAuth} from './vendor/xactions/src/scrapers/twitter/http/auth.js';
import {scrapeProfile} from './vendor/xactions/src/scrapers/twitter/http/profile.js';
import {scrapeTweets} from './vendor/xactions/src/scrapers/twitter/http/tweets.js';
import {postTweet} from './vendor/xactions/src/scrapers/twitter/http/actions.js';
import {uploadImage} from './vendor/xactions/src/scrapers/twitter/http/media.js';
import {readFile} from 'node:fs/promises';
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
 if(imagePath){const media=await uploadImage(client,await readFile(imagePath),{altText});mediaIds.push(media.mediaId)}
 const result=await postTweet(client,text,{mediaIds});
 const id=result?.rest_id??result?.legacy?.id_str??result?.tweet?.rest_id;
 if(!id)throw new Error('Xの返答から投稿IDを確認できません。重複投稿を避けるため、Xで投稿有無を確認してから再試行してください。');
 return String(id);
}
