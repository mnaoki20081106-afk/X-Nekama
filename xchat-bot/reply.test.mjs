import test from 'node:test';
import assert from 'node:assert/strict';
import {createReply,renderTemplate} from './reply.mjs';

test('template reply inserts inbound text',()=>{
  assert.equal(renderTemplate('受信: {message}','こんにちは'),'受信: こんにちは');
});

test('empty inbound message is ignored',async()=>{
  assert.equal(await createReply({text:'   '},{env:{}}),'');
});

test('external reply endpoint is supported without leaking token into body',async()=>{
  let seen;
  const fetchImpl=async(url,init)=>{
    seen={url,init,body:JSON.parse(init.body)};
    return {ok:true,status:200,json:async()=>({reply:'自動返信'})};
  };
  const reply=await createReply({id:'m1',text:'hello',author:{id:'u1'}},{fetchImpl,env:{XCHAT_REPLY_URL:'https://reply.invalid/generate',XCHAT_REPLY_TOKEN:'secret'}});
  assert.equal(reply,'自動返信');
  assert.equal(seen.init.headers.authorization,'Bearer secret');
  assert.equal(seen.body.text,'hello');
  assert.equal('token' in seen.body,false);
});
