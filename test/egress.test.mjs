import test from 'node:test';
import assert from 'node:assert/strict';
import {createRemoteEgressFetch,createVerifiedEgressFetch,traceHasWarp,VpnEgressError} from '../egress.mjs';

test('trace parser only accepts Cloudflare WARP on/plus',()=>{
  assert.equal(traceHasWarp('fl=1\nwarp=on\nip=1.2.3.4\n'),true);
  assert.equal(traceHasWarp('warp=plus\n'),true);
  assert.equal(traceHasWarp('warp=off\n'),false);
  assert.equal(traceHasWarp('notwarp=on\n'),false);
});

test('local verified transport blocks the X request when WARP is absent',async()=>{
  const calls=[];
  const fake=async(input)=>{
    const url=String(input);
    calls.push(url);
    if(url.includes('/cdn-cgi/trace'))return new Response('fl=1\nwarp=off\n',{status:200});
    return new Response('{}',{status:200});
  };
  const guarded=createVerifiedEgressFetch({fetchImpl:fake});
  await assert.rejects(()=>guarded('https://x.com/i/api/test'),error=>{
    assert.ok(error instanceof VpnEgressError);
    assert.equal(error.code,'VPN_REQUIRED');
    assert.equal(error.deliveryStage,'preflight');
    return true;
  });
  assert.equal(calls.length,1);
});

test('local verified transport checks WARP before forwarding',async()=>{
  const calls=[];
  const fake=async(input)=>{
    const url=String(input);
    calls.push(url);
    if(url.includes('/cdn-cgi/trace'))return new Response('fl=1\nwarp=on\n',{status:200});
    return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});
  };
  const guarded=createVerifiedEgressFetch({fetchImpl:fake});
  const response=await guarded('https://x.com/i/api/test');
  assert.equal(response.status,200);
  assert.equal(calls.length,2);
  assert.match(calls[0],/cloudflare\.com\/cdn-cgi\/trace/);
  assert.equal(calls[1],'https://x.com/i/api/test');
});

test('remote transport preserves X headers/body and uses the authenticated gateway',async()=>{
  let captured;
  const fake=async(input,init)=>{
    captured={url:String(input),init,request:new Request(input,init)};
    return new Response('{"ok":true}',{status:200,headers:{'content-type':'application/json'}});
  };
  const remote=createRemoteEgressFetch({
    endpoint:'https://egress.example/fetch',
    token:'abcdefghijklmnopqrstuvwxyz123456',
    fetchImpl:fake
  });
  const response=await remote('https://api.x.com/1.1/test.json',{
    method:'POST',
    headers:{authorization:'Bearer original','content-type':'application/json','x-csrf-token':'csrf'},
    body:'{"value":1}',
    redirect:'manual'
  });
  assert.equal(response.status,200);
  assert.equal(captured.url,'https://egress.example/fetch');
  assert.equal(captured.request.headers.get('x-xnekama-target'),'https://api.x.com/1.1/test.json');
  assert.equal(captured.request.headers.get('x-xnekama-egress-token'),'abcdefghijklmnopqrstuvwxyz123456');
  assert.equal(captured.request.headers.get('x-xnekama-redirect'),'manual');
  assert.equal(captured.request.headers.get('authorization'),'Bearer original');
  assert.equal(await captured.request.text(),'{"value":1}');
});

test('remote transport turns gateway VPN rejection into a preflight error',async()=>{
  const remote=createRemoteEgressFetch({
    endpoint:'https://egress.example/fetch',
    token:'abcdefghijklmnopqrstuvwxyz123456',
    fetchImpl:async()=>new Response('{"error":"VPN_REQUIRED"}',{
      status:503,
      headers:{'x-xnekama-egress-error':'VPN_REQUIRED','content-type':'application/json'}
    })
  });
  await assert.rejects(()=>remote('https://x.com/i/api/test'),error=>{
    assert.equal(error.code,'VPN_REQUIRED');
    assert.equal(error.deliveryStage,'preflight');
    return true;
  });
});
