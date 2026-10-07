import http from 'node:http';
import {Chat} from 'chat';
import {createXchatAdapter} from '@chat-adapter/x/chat';
import {createMemoryState} from '@chat-adapter/state-memory';
import {createReply} from './reply.mjs';

const port=Number(process.env.XCHAT_PORT||3010);
const host=process.env.XCHAT_HOST||'127.0.0.1';
const pathName=process.env.XCHAT_WEBHOOK_PATH||'/api/webhooks/xchat';

function requestUrl(req){
  const forwarded=String(req.headers['x-forwarded-proto']||'').split(',')[0].trim();
  const protocol=forwarded||'https';
  const hostHeader=req.headers.host||`${host}:${port}`;
  return `${protocol}://${hostHeader}${req.url||pathName}`;
}

async function rawBody(req,max=2*1024*1024){
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>max)throw Object.assign(new Error('request too large'),{status:413});
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function toHeaders(source){
  const headers=new Headers();
  for(const [key,value] of Object.entries(source)){
    if(Array.isArray(value))headers.set(key,value.join(', '));
    else if(typeof value==='string')headers.set(key,value);
  }
  return headers;
}

async function writeWebResponse(res,response){
  for(const [key,value] of response.headers.entries())res.setHeader(key,value);
  res.statusCode=response.status;
  res.end(Buffer.from(await response.arrayBuffer()));
}

const xchat=createXchatAdapter({
  welcomeMessage:false,
  sendReadReceipts:true,
  verifySignatures:process.env.X_VERIFY_SIGNATURES!=='false'
});

const bot=new Chat({
  userName:process.env.X_BOT_USERNAME||'x-nekama',
  adapters:{xchat},
  state:createMemoryState()
});

bot.onDirectMessage(async(thread,message)=>{
  const reply=await createReply(message);
  if(reply)await thread.post(reply);
});

await bot.initialize();

const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    if(url.pathname==='/health'){
      res.writeHead(200,{'content-type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({ok:true,service:'xchat-bot'}));
    }
    if(url.pathname!==pathName||!['GET','POST'].includes(req.method||'')){
      res.writeHead(404,{'content-type':'application/json; charset=utf-8'});
      return res.end(JSON.stringify({error:'not found'}));
    }
    const body=req.method==='POST'?await rawBody(req):undefined;
    const request=new Request(requestUrl(req),{
      method:req.method,
      headers:toHeaders(req.headers),
      ...(body?{body}: {})
    });
    const response=await bot.webhooks.xchat(request);
    await writeWebResponse(res,response);
  }catch(error){
    console.error('xchat webhook:',error);
    res.writeHead(error?.status||500,{'content-type':'application/json; charset=utf-8'});
    res.end(JSON.stringify({error:'xchat webhook failed'}));
  }
});

server.listen(port,host,()=>{
  console.log(`X-Nekama XChat bot: http://${host}:${port}${pathName}`);
});

for(const signal of ['SIGINT','SIGTERM']){
  process.once(signal,()=>server.close(()=>process.exit(0)));
}
