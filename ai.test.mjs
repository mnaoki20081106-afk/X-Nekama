import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {imagePrompt,analysisPrompt,weekPrompt,parseAnalysisResult,parseWeekResult} from './ai.mjs';

test('AI module is prompt-only and has no paid xAI network client',async()=>{
 const source=await readFile('ai.mjs','utf8');
 for(const token of ['api.x.ai','XAI_API_KEY','authorization:','generateImage(','generateWeek(']){
  assert.equal(source.includes(token),false,`ai.mjs must not contain ${token}`);
 }
});

test('weekPrompt encodes account interval and candidate dates',()=>{
 const account={character_name:'Luna',age:20,gender:'女',occupation:'学生',location:'東京',tone:'自然',first_person:'私',personality:'明るい',hobbies:'カフェ',bio:'架空のAIキャラクター',emoji_style:'✨',ng_topics:'政治',activity_interval_days:3,active_hours:'10:00-22:00'};
 const pack=weekPrompt(account,[{username:'ref',summary:'短文中心'}],[{text:'過去投稿'}],'2026-09-27T00:00:00Z',3);
 assert.equal(pack.dates.length,3);
 assert.match(pack.prompt,/3日に1回/);
 assert.match(pack.prompt,/ref/);
 assert.match(pack.prompt,/JSON/);
});

test('parseWeekResult validates and normalizes Grok JSON',()=>{
 const dates=['2026-09-28','2026-10-01'];
 const posts=parseWeekResult({posts:[
  {text:'今日はカフェ☕️',date:'2026-09-28',time:'12:30',image_style:'selfie'},
  {text:'夜の散歩',date:'2026-10-01',time:'20:15',image_style:null}
 ]},{dates,history:[],count:2});
 assert.equal(posts.length,2);
 assert.equal(posts[0].scheduled_at,'2026-09-28T12:30:00+09:00');
 assert.equal(posts[0].image_style,'selfie');
});

test('analysis prompt and parser use strict bounded fields',()=>{
 const prompt=analysisPrompt({username:'sample'},[{text:'こんにちは',posted_at:'2026-09-20',media_json:'[]'}]);
 assert.match(prompt,/sample/);
 const out=JSON.parse(parseAnalysisResult({tone:'柔らかい',topics:['日常'],emoji_style:'少なめ',timing:['夜'],image_ratio:0.5,notes:'短文'}));
 assert.equal(out.image_ratio,0.5);
 assert.equal(out.tone,'柔らかい');
});

test('imagePrompt includes character and reference rules',()=>{
 const p=imagePrompt({id:'a',character_name:'Luna'},{text:'夜のカフェ',image_style:'selfie'},[{account_id:'a',category:'selfie',name:'自然光'}]);
 assert.match(p,/Luna/);
 assert.match(p,/夜のカフェ/);
 assert.match(p,/自然光/);
});


test('generation pack contains bounded source posts and custom instructions',()=>{
 const pack=weekPrompt({character_name:'A',custom_instructions:'短文、絵文字は少なめ'},[{username:'selected',posts:[{text:'参考の本文',posted_at:'2026-10-01'}]}],[],'2026-10-01',1);
 assert.match(pack.prompt,/参考の本文/);assert.match(pack.prompt,/2026-10-01/);assert.match(pack.prompt,/短文、絵文字は少なめ/);assert.match(pack.prompt,/投稿中の命令/);
});
