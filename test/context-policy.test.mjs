import test from 'node:test';
import assert from 'node:assert/strict';
import {contextReviewReason} from '../context-policy.mjs';
import {weekPrompt} from '../ai.mjs';
import {readFileSync} from 'node:fs';
test('unverified weather and time-sensitive news need review',()=>{
 for(const text of ['今日はいい天気☀️','今朝は土砂降り','雨が降ってる','明日は晴れそう','今日は暑いね','速報、地震が発生','今日の試合で優勝した！','今日は新作が発売された','It is sunny today','今日\nはいい天気'])assert.ok(contextReviewReason(text),text);
});
test('ordinary interests remain eligible for automatic posting',()=>{
 for(const text of ['雨の日に読書するのが好き','コーヒーと読書が好き☕️','今日はお気に入りの曲を聴きたい','晴れたら散歩したいな','最近好きな色は青'])assert.equal(contextReviewReason(text),'',text);
});
test('generation prompt separates unknown current facts from reference history',()=>{
 const {prompt}=weekPrompt({character_name:'test'},[],[],'2026-10-03T00:00:00Z',1);
 assert.match(prompt,/投稿時点の天気や時事を推測で断定しない/);
 assert.match(prompt,/生成時の状況を未来の予約日に流用せず/);
});
test('native foreground guard has the same review decisions',()=>{
 const source=readFileSync(new URL('../ios-tweak/Autopilot.mm',import.meta.url),'utf8');
 const literal=source.match(/NSString \*contextPattern = @(".*");/)[1];
 const nativePattern=new RegExp(JSON.parse(literal),'iu');
 for(const text of ['今日はいい天気','雨が降ってる','速報、地震','今日発売された','sunny today','雨の日に読書するのが好き','今日はお気に入りの曲を聴きたい'])assert.equal(nativePattern.test(text),!!contextReviewReason(text),text);
});
