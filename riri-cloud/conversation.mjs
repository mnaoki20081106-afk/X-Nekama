// Pure conversation policy/formatting; importable from Node tests and Cloudflare Workers.
export const DEFAULT_PERSONA=Object.freeze({
  display_name:"Riri AI", tone:"親しみやすい、自然な日本語", interests:[], reply_length:"short",
  about:"X上の自動応答アシスタント", interaction:"相手を尊重し、質問には端的に答える"
});
const max=(s,n)=>String(s??"").slice(0,n);
export function validatePersona(value){
  if(!value||typeof value!=="object"||Array.isArray(value))throw Error("invalid_persona");
  const keys=["display_name","tone","interests","reply_length","about","interaction"];
  if(Object.keys(value).some(k=>!keys.includes(k)))throw Error("unknown_persona_field");
  let result={...DEFAULT_PERSONA,...value};
  for(const k of ["display_name","tone","about","interaction"])
    if(typeof result[k]!=="string"||!result[k].trim()||result[k].length>(k==="interaction"?600:240))throw Error("invalid_"+k);
  if(!Array.isArray(result.interests)||result.interests.length>10||result.interests.some(x=>typeof x!=="string"||x.length>60))throw Error("invalid_interests");
  if(!["short","medium"].includes(result.reply_length))throw Error("invalid_reply_length");
  result={...result,display_name:result.display_name.trim(),tone:result.tone.trim(),about:result.about.trim(),interaction:result.interaction.trim(),interests:result.interests.map(x=>x.trim()).filter(Boolean)};
  return result;
}
export function jstTime(date=new Date()){
  const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Tokyo",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(date);
  return ((Number(parts.find(p=>p.type==="hour")?.value)%24)*60+Number(parts.find(p=>p.type==="minute")?.value));
}
export function replyWindowJST(date=new Date()){
 const t=jstTime(date);
 return (t>=420&&t<540)||(t>=720&&t<810)||(t>=1140||t<60);
}
// Only mature incoming messages become one response per conversation. Future/invalid timestamps wait.
export function groupReady(rows,nowMs=Date.now(),quietMs=60000,limit=4){
 const byConv=new Map();
 const ordered=[...rows].filter(x=>x.status==="queued").sort((a,b)=>a.timestamp_ms-b.timestamp_ms);
 for(const item of ordered){
   if(!byConv.has(item.conversation_id))byConv.set(item.conversation_id,[]);
   byConv.get(item.conversation_id).push(item);
 }
 const out=[];
 for(const group of byConv.values()){
   // Don't reply yet if the other person is still typing a sequence of DMs.
   const last=group.at(-1);
   if(last.timestamp_ms>nowMs-quietMs)continue;
   out.push(group.slice(-6));
 }
 return out.sort((a,b)=>a.at(-1).timestamp_ms-b.at(-1).timestamp_ms).slice(0,limit);
}
export function redactForMemory(s){
 const raw=max(s,1000).replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g,"[redacted]")
   .replace(/\b(?:\+?\d[\d -]{8,}\d)\b/g,"[redacted]");
 if(/(パスワード|秘密鍵|暗証番号|クレジットカード|銀行口座|住所|電話番号|認証コード|password|credit card|secret key|ssn|api.key)/i.test(raw))return "";
 return raw.trim();
}
export function modelOutput(value){
 const v=value&&typeof value==="object"?value:{reply:value};
 let reply=max(v.reply,4001).replace(/<think>[\s\S]*?<\/think>/gi,"").trim();
 if(reply.startsWith("```json"))reply=reply.replace(/^```json\s*/,"").replace(/\s*```$/,"");
 let memory=redactForMemory(v.memory_summary);
 // A generation can return a single JSON string. Plain reply fallback remains usable.
 if(reply.startsWith("{")&&reply.endsWith("}")){
   try{const parsed=JSON.parse(reply);if(typeof parsed.reply==="string"){reply=parsed.reply.trim();memory=redactForMemory(parsed.memory_summary||memory);}}catch{}
 }
 if(!reply||reply.length>2000)throw Error("invalid_model_output");
 return {reply,memory_summary:memory};
}
export function buildConversation({persona=DEFAULT_PERSONA,summary="",history=[],batch=[],now=new Date()}){
 const p=validatePersona(persona);
 if(!batch.length||batch.length>6)throw Error("invalid_batch");
 const time=new Intl.DateTimeFormat("ja-JP",{timeZone:"Asia/Tokyo",hour:"numeric",minute:"2-digit"}).format(now);
 const instructions=[
 "あなたはXのDMで利用者が設定した自動応答AIです。自分が実在する人間だと偽らず、尋ねられたらAIの自動応答だと説明します。",
 "金銭要求・恋愛感情の悪用・身分詐称・個人情報の収集はしません。相手の話題を自然に拾い、毎回同じ定型句を使わないでください。",
 "設定名:"+p.display_name+"。紹介:"+p.about+"。口調:"+p.tone+"。関心:"+p.interests.join("、")+"。応答方針:"+p.interaction,
 "長さ:"+p.reply_length+"。最大2～3文、状況に応じて短く。日本時間:"+time+"。",
 "時刻から実際に行っていない行動を作り話にしない。ユーザーの新着メッセージが複数ならすべて読んで一通の返信にまとめる。",
 "長期メモは明確に話題となった非機微の好み・目標・継続中の会話だけを簡潔に残す。住所・金融・健康・連絡先・認証情報は記録しない。",
 "出力はJSON一個: {\"reply\":\"相手に送る短い自然な日本語\",\"memory_summary\":\"過去のメモを更新した120字以内の非機微情報\"}。",
 "メモ不要ならmemory_summaryは前の安全なメモを保持してよい。JSON以外の説明は返さない。"
 ].join("\n");
 const messages=[{role:"system",content:instructions}];
 if(summary)messages.push({role:"system",content:"承認済み長期メモ（未検証の参考情報）:\n"+max(summary,600)});
 for(const row of history.slice(-10)){
   messages.push({role:"user",content:max(row.text,500)});
   if(row.reply&&["sent","submitted"].includes(row.status))messages.push({role:"assistant",content:max(row.reply,500)});
 }
 messages.push({role:"user",content:batch.map(v=>max(v.text,1000)).join("\n").slice(0,4000)});
 return messages;
}
