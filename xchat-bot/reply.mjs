const MAX_REPLY_CHARS=4000;
const MAX_INBOUND_CHARS=2000;
const DEFAULT_HISTORY_MESSAGES=12;
const DEFAULT_MAX_THREADS=500;

function clip(value,max=MAX_REPLY_CHARS){
  const text=String(value??'').trim();
  return text.length>max?text.slice(0,max):text;
}

function positiveInt(value,fallback,{min=1,max=5000}={}){
  const n=Number(value);
  if(!Number.isFinite(n))return fallback;
  return Math.min(max,Math.max(min,Math.trunc(n)));
}

function authorId(message){
  return String(
    message?.author?.userId??
    message?.author?.id??
    message?.author?.userName??
    'anonymous'
  );
}

export const DM_REPLY_GUIDANCE=[
  '自然な1対1の会話として返信してください。',
  '受信文の具体的な内容を1つ以上拾い、相手の話題を無視して別の話へ飛ばないでください。',
  '必要なら質問は1回の返信につき原則1つまで。質問攻めにせず、共感・自分側の一言・質問を自然に混ぜてください。',
  '過去の会話履歴に関連する話題があれば、毎回ではなく自然なタイミングで思い出して触れてください。',
  '毎回同じ挨拶、同じ褒め言葉、同じ絵文字、同じ文末を繰り返さず、短文と少し長めの返信を使い分けてください。',
  'Xプロフィール上でAIキャラクターとして運用されている前提を崩さず、実際に確認できない現実の体験・居場所・病気・家族事情を事実として作らないでください。',
  '金銭要求、送金誘導、架空の困窮やトラブル、恋愛感情を装った依存づくり、罪悪感や圧力で相手を動かす表現は使わないでください。',
  '相手が金銭や援助を申し出ても、会話を金銭獲得の方向へ誘導せず、通常の会話として扱ってください。'
].join('\n');

export function renderTemplate(template,message){
  const safeMessage=clip(message,MAX_INBOUND_CHARS);
  return clip(String(template||'DMありがとう！').replaceAll('{message}',safeMessage));
}

export function createConversationMemory({maxMessages=DEFAULT_HISTORY_MESSAGES,maxThreads=DEFAULT_MAX_THREADS}={}){
  const limit=positiveInt(maxMessages,DEFAULT_HISTORY_MESSAGES,{max:50});
  const threadLimit=positiveInt(maxThreads,DEFAULT_MAX_THREADS,{max:5000});
  const threads=new Map();

  function touch(key){
    const existing=threads.get(key);
    if(existing){
      threads.delete(key);
      threads.set(key,existing);
      return existing;
    }
    while(threads.size>=threadLimit){
      const oldest=threads.keys().next().value;
      threads.delete(oldest);
    }
    const created=[];
    threads.set(key,created);
    return created;
  }

  return {
    get(key){
      const history=threads.get(String(key));
      if(!history)return [];
      threads.delete(String(key));
      threads.set(String(key),history);
      return history.map(item=>({...item}));
    },
    append(key,role,text){
      const clean=clip(text,MAX_INBOUND_CHARS);
      if(!clean)return;
      const history=touch(String(key));
      history.push({role:String(role),text:clean});
      if(history.length>limit)history.splice(0,history.length-limit);
    },
    clear(key){threads.delete(String(key));},
    size(){return threads.size;}
  };
}

const defaultMemory=createConversationMemory({\n  maxMessages:process.env.XCHAT_HISTORY_MESSAGES,\n  maxThreads:process.env.XCHAT_MAX_THREADS\n});

export function buildGeneratorPayload(message,{memory=defaultMemory}={}){
  const text=clip(message?.text??'',MAX_INBOUND_CHARS);
  const key=authorId(message);
  return {
    text,
    message_id:message?.id??null,
    author_id:message?.author?.userId??message?.author?.id??null,
    author_name:message?.author?.userName??message?.author?.fullName??null,
    conversation_history:memory.get(key),
    guidance:DM_REPLY_GUIDANCE,
    bot_context:{
      ai_character:true,
      reply_mode:'inbound_only'
    }
  };
}

export async function createReply(message,{fetchImpl=fetch,env=process.env,memory=defaultMemory}={}){
  const text=clip(message?.text??'',MAX_INBOUND_CHARS);
  if(!text)return '';

  const key=authorId(message);
  const replyUrl=String(env.XCHAT_REPLY_URL||'').trim();

  let reply='';
  if(replyUrl){
    const headers={'content-type':'application/json'};
    const token=String(env.XCHAT_REPLY_TOKEN||'').trim();
    if(token)headers.authorization=`Bearer ${token}`;
    const response=await fetchImpl(replyUrl,{
      method:'POST',
      headers,
      body:JSON.stringify(buildGeneratorPayload(message,{memory})),
      signal:AbortSignal.timeout(Number(env.XCHAT_REPLY_TIMEOUT_MS||15000))
    });
    if(!response.ok)throw new Error(`reply endpoint failed: ${response.status}`);
    const value=await response.json();
    reply=clip(value?.reply);
    if(!reply)throw new Error('reply endpoint returned an empty reply');
  }else{
    const template=env.XCHAT_REPLY_TEMPLATE||'DMありがとう！「{message}」ってことね。';
    reply=renderTemplate(template,text);
  }

  memory.append(key,'user',text);
  memory.append(key,'assistant',reply);
  return reply;
}
