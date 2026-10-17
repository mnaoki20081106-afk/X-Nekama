const MAX_REPLY_CHARS=4000;

function clip(value,max=MAX_REPLY_CHARS){
  const text=String(value??'').trim();
  return text.length>max?text.slice(0,max):text;
}

export function renderTemplate(template,message){
  const safeMessage=clip(message,2000);
  return clip(String(template||'DMありがとう！').replaceAll('{message}',safeMessage));
}

// 遅延返信用キュー（メモリ。再起動で消える）
const delayedQueue = [];

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

    // 遅延返信
    if(value?.delayed && value?.retry_after_ms){
      delayedQueue.push({
        at: Date.now() + Number(value.retry_after_ms),
        message,
        author_id: message?.author?.userId ?? message?.author?.id
      });
      return ''; // 今は返信しない
    }

    const reply=clip(value?.reply);
    if(!reply)throw new Error('reply endpoint returned an empty reply');
    return reply;
  }

  const template=env.XCHAT_REPLY_TEMPLATE||'DMありがとう！「{message}」ってことね。';
  return renderTemplate(template,text);
}

// 定期的に遅延キューを処理（xchat-bot側で呼ぶ）
export function processDelayed(replyFn){
  const now = Date.now();
  const ready = delayedQueue.filter(item => item.at <= now);
  for (const item of ready) {
    delayedQueue.splice(delayedQueue.indexOf(item), 1);
    replyFn(item.message).catch(()=>{});
  }
}
