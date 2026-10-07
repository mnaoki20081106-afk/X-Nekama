const MAX_REPLY_CHARS=4000;

function clip(value,max=MAX_REPLY_CHARS){
  const text=String(value??'').trim();
  return text.length>max?text.slice(0,max):text;
}

export function renderTemplate(template,message){
  const safeMessage=clip(message,2000);
  return clip(String(template||'DMありがとう！').replaceAll('{message}',safeMessage));
}

export async function createReply(message,{fetchImpl=fetch,env=process.env}={}){
  const text=clip(message?.text??'',2000);
  if(!text)return '';

  const replyUrl=String(env.XCHAT_REPLY_URL||'').trim();
  if(replyUrl){
    const headers={'content-type':'application/json'};
    const token=String(env.XCHAT_REPLY_TOKEN||'').trim();
    if(token)headers.authorization=`Bearer ${token}`;
    const response=await fetchImpl(replyUrl,{
      method:'POST',
      headers,
      body:JSON.stringify({
        text,
        message_id:message?.id??null,
        author_id:message?.author?.userId??message?.author?.id??null,
        author_name:message?.author?.userName??message?.author?.fullName??null
      }),
      signal:AbortSignal.timeout(Number(env.XCHAT_REPLY_TIMEOUT_MS||15000))
    });
    if(!response.ok)throw new Error(`reply endpoint failed: ${response.status}`);
    const value=await response.json();
    const reply=clip(value?.reply);
    if(!reply)throw new Error('reply endpoint returned an empty reply');
    return reply;
  }

  const template=env.XCHAT_REPLY_TEMPLATE||'DMありがとう！「{message}」ってことね。';
  return renderTemplate(template,text);
}
