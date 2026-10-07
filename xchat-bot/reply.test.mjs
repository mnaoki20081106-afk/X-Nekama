import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DM_REPLY_GUIDANCE,
  createConversationMemory,
  createReply,
  renderTemplate
} from './reply.mjs';

test('template reply inserts inbound text',()=>{
  assert.equal(renderTemplate('受信: {message}','こんにちは'),'受信: こんにちは');
});

test('empty inbound message is ignored',async()=>{
  assert.equal(await createReply({text:'   '},{env:{},memory:createConversationMemory()}),'');
});

test('external reply endpoint is supported without leaking token into body',async()=>{
  let seen;
  const fetchImpl=async(url,init)=>{
    seen={url,init,body:JSON.parse(init.body)};
    return {ok:true,status:200,json:async()=>({reply:'自動返信'})};
  };
  const reply=await createReply(
    {id:'m1',text:'hello',author:{id:'u1'}},
    {
      fetchImpl,
      env:{XCHAT_REPLY_URL:'https://reply.invalid/generate',XCHAT_REPLY_TOKEN:'secret'},
      memory:createConversationMemory()
    }
  );
  assert.equal(reply,'自動返信');
  assert.equal(seen.init.headers.authorization,'Bearer secret');
  assert.equal(seen.body.text,'hello');
  assert.equal('token' in seen.body,false);
  assert.deepEqual(seen.body.conversation_history,[]);
  assert.equal(seen.body.guidance,DM_REPLY_GUIDANCE);
  assert.equal(seen.body.bot_context.ai_character,true);
  assert.equal(seen.body.bot_context.reply_mode,'inbound_only');
});

test('conversation history is sent on the next DM from the same author',async()=>{
  const bodies=[];
  const replies=['やっほー！','それ覚えてるよ'];
  const fetchImpl=async(_url,init)=>{
    bodies.push(JSON.parse(init.body));
    return {ok:true,status:200,json:async()=>({reply:replies[bodies.length-1]})};
  };
  const memory=createConversationMemory({maxMessages:8});
  const options={fetchImpl,env:{XCHAT_REPLY_URL:'https://reply.invalid/generate'},memory};

  await createReply({id:'m1',text:'猫が好き',author:{id:'u1'}},options);
  await createReply({id:'m2',text:'昨日の話覚えてる？',author:{id:'u1'}},options);

  assert.deepEqual(bodies[0].conversation_history,[]);
  assert.deepEqual(bodies[1].conversation_history,[
    {role:'user',text:'猫が好き'},
    {role:'assistant',text:'やっほー！'}
  ]);
});

test('conversation histories are isolated by author',async()=>{
  const bodies=[];
  const fetchImpl=async(_url,init)=>{
    bodies.push(JSON.parse(init.body));
    return {ok:true,status:200,json:async()=>({reply:'ok'})};
  };
  const memory=createConversationMemory();
  const options={fetchImpl,env:{XCHAT_REPLY_URL:'https://reply.invalid/generate'},memory};

  await createReply({text:'A',author:{id:'u1'}},options);
  await createReply({text:'B',author:{id:'u2'}},options);

  assert.equal(bodies[1].author_id,'u2');
  assert.deepEqual(bodies[1].conversation_history,[]);
});

test('conversation memory is bounded',()=>{
  const memory=createConversationMemory({maxMessages:3,maxThreads:2});
  memory.append('u1','user','1');
  memory.append('u1','assistant','2');
  memory.append('u1','user','3');
  memory.append('u1','assistant','4');
  assert.deepEqual(memory.get('u1'),[
    {role:'assistant',text:'2'},
    {role:'user',text:'3'},
    {role:'assistant',text:'4'}
  ]);

  memory.append('u2','user','x');
  memory.append('u3','user','y');
  assert.equal(memory.size(),2);
  assert.deepEqual(memory.get('u1'),[]);
});
