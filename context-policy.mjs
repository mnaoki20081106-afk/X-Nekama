// A conservative review filter, not a live weather/news fact checker.
export const contextRules=[
 ['weather','(?:今日|今夜|今朝|今|明日|外|こっち|こちら).{0,24}(?:天気|晴れ|快晴|雨|雪|暑い|寒い|暖かい|涼しい|台風)|(?:雨|雪).{0,12}(?:降って|止んだ|やんだ)|(?:晴れて|土砂降り|快晴|いい天気|良い天気)|(?:天気|気温|予報).{0,16}(?:です|だね|だよ|らしい|℃|度)'],
 ['current_events','(?:速報|ニュース|地震|津波|洪水|災害|大雨警報|避難|訃報|亡くな|逮捕|選挙|当選|炎上|戦争|テロ)|(?:今日|今|昨日|明日|今年).{0,24}(?:発表|開催|中止|優勝|発売|公開|値上げ|値下げ|障害|復旧)'],
 ['english_context','\\b(?:weather|raining|sunny|snowing|breaking news|earthquake|tsunami|election)\\b']
];
export function contextReviewReason(text){
 const value=String(text||'').normalize('NFKC').replace(/\s+/g,' ');
 const match=contextRules.find(([,pattern])=>new RegExp(pattern,'iu').test(value));
 return match?'天気・時事に依存する表現があります。投稿時点の地域・日時・事実を確認できないため自動投稿を保留しました。状況に依存しない文章へ編集してください。':'';
}
export const contextPrompt='予約日時とキャラクターの地域を基準にしてください。最新の天気・ニュース・災害・イベント開催・発売・スポーツ結果を確認できる情報源は今回提供していません。「今日はいい天気」など、投稿時点の天気や時事を推測で断定しないでください。生成時の状況を未来の予約日に流用せず、お手本投稿の日時や出来事も現在の事実として扱わないでください。確認できない話題は使わず、状況に依存しない趣味・好み・日常の気持ちを中心に作成してください。';
