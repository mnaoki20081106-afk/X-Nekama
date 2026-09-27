import test from 'node:test';
import assert from 'node:assert/strict';
import {imagePrompt,generateImage,generateWeek} from './ai.mjs';

const jpegBuffer=Buffer.from([0xff,0xd8,0xff,0xd9]);

test('imagePrompt keeps fictional-character and style context',()=>{
 const prompt=imagePrompt(
  {id:'a1',character_name:'ルナ'},
  {text:'カフェでゆっくりする投稿',image_style:'selfie'},
  [{category:'selfie',account_id:'a1',name:'自然光の窓際'}]
 );
 assert.match(prompt,/架空AIキャラクター/);
 assert.match(prompt,/自然光のスマートフォン自撮り/);
 assert.match(prompt,/自然光の窓際/);
});

test('generateImage uses generation endpoint without references',async()=>{
 const original=globalThis.fetch;
 process.env.XAI_API_KEY='test-key';
 let seen;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.x.ai/v1/images/generations'){
   seen={url:String(url),body:JSON.parse(options.body)};
   return new Response(JSON.stringify({data:[{url:'https://images.example/generated.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(String(url)==='https://images.example/generated.jpg'){
   return new Response(jpegBuffer,{status:200,headers:{'content-type':'image/jpeg'}});
  }
  throw new Error('unexpected URL '+url);
 };
 try{
  const result=await generateImage('test prompt',[]);
  assert.equal(seen.url,'https://api.x.ai/v1/images/generations');
  assert.equal(seen.body.model,process.env.XAI_IMAGE_MODEL||'grok-imagine-image-2.0');
  assert.equal(seen.body.response_format,'url');
  assert.equal(result.mime,'image/jpeg');
  assert.ok(result.data.length);
 }finally{globalThis.fetch=original}
});

test('generateImage uses singular image for one reference',async()=>{
 const original=globalThis.fetch;
 process.env.XAI_API_KEY='test-key';
 let body;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.x.ai/v1/images/edits'){
   body=JSON.parse(options.body);
   return new Response(JSON.stringify({data:[{url:'https://images.example/edited.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(String(url)==='https://images.example/edited.jpg')return new Response(jpegBuffer,{status:200});
  throw new Error('unexpected URL '+url);
 };
 try{
  await generateImage('test prompt',[{mime:'image/jpeg',data:jpegBuffer}]);
  assert.ok(body.image);
  assert.equal(body.images,undefined);
  assert.match(body.image.url,/^data:image\/jpeg;base64,/);
 }finally{globalThis.fetch=original}
});

test('generateImage uses images array for multiple references',async()=>{
 const original=globalThis.fetch;
 process.env.XAI_API_KEY='test-key';
 let body;
 globalThis.fetch=async(url,options)=>{
  if(String(url)==='https://api.x.ai/v1/images/edits'){
   body=JSON.parse(options.body);
   return new Response(JSON.stringify({data:[{url:'https://images.example/edited.jpg'}]}),{status:200,headers:{'content-type':'application/json'}});
  }
  if(String(url)==='https://images.example/edited.jpg')return new Response(jpegBuffer,{status:200});
  throw new Error('unexpected URL '+url);
 };
 try{
  const ref={mime:'image/png',data:Buffer.from([0x89,0x50,0x4e,0x47])};
  await generateImage('test prompt',[ref,ref]);
  assert.equal(body.image,undefined);
  assert.equal(body.images.length,2);
 }finally{globalThis.fetch=original}
});

test('generateWeek uses Responses API with server-side storage disabled',async()=>{
 const original=globalThis.fetch;
 process.env.XAI_API_KEY='test-key';
 globalThis.fetch=async(url,options)=>{
  assert.equal(String(url),'https://api.x.ai/v1/responses');
  const request=JSON.parse(options.body);
  assert.equal(request.model,process.env.XAI_TEXT_MODEL||'grok-4.7');
  assert.equal(request.store,false);
  assert.equal(request.text.format.type,'json_schema');
  return new Response(JSON.stringify({
   output:[{
    type:'message',
    content:[{
     type:'output_text',
     text:JSON.stringify({posts:[{
      text:'今日はのんびり。',
      date:'2026-09-28',
      time:'18:30',
      image_style:'selfie'
     }]})
    }]
   }]
  }),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const posts=await generateWeek(
   {character_name:'ルナ',age:20,gender:'女性',occupation:'学生',location:'東京',tone:'自然体',first_person:'私',personality:'穏やか',hobbies:'カフェ',bio:'架空のAIキャラクター',emoji_style:'',ng_topics:'',active_hours:'10:00-22:00'},
   [],
   [],
   '2026-09-27T00:00:00.000Z',
   1
  );
  assert.equal(posts.length,1);
  assert.equal(posts[0].image_style,'selfie');
  assert.equal(posts[0].scheduled_at,'2026-09-28T18:30:00+09:00');
 }finally{globalThis.fetch=original}
});


test('generateWeek spaces candidate dates by activity interval',async()=>{
 const original=globalThis.fetch;
 process.env.XAI_API_KEY='test-key';
 globalThis.fetch=async(_url,options)=>{
  const request=JSON.parse(options.body);
  const userInput=request.input.find(x=>x.role==='user')?.content||'';
  assert.match(userInput,/浮上頻度は3日に1回/);
  assert.match(userInput,/2026-09-28, 2026-10-01, 2026-10-04/);
  return new Response(JSON.stringify({
   output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({posts:[
    {text:'1件目',date:'2026-09-28',time:'18:00',image_style:null},
    {text:'2件目',date:'2026-10-01',time:'18:00',image_style:null},
    {text:'3件目',date:'2026-10-04',time:'18:00',image_style:null}
   ]})}]}]
  }),{status:200,headers:{'content-type':'application/json'}});
 };
 try{
  const posts=await generateWeek(
   {character_name:'ルナ',activity_interval_days:3,active_hours:'10:00-22:00'},
   [],[],
   '2026-09-27T00:00:00.000Z',
   3
  );
  assert.deepEqual(posts.map(p=>p.scheduled_at),[
   '2026-09-28T18:00:00+09:00',
   '2026-10-01T18:00:00+09:00',
   '2026-10-04T18:00:00+09:00'
  ]);
 }finally{globalThis.fetch=original}
});
