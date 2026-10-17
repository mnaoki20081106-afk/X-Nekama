export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/reply' && request.method === 'POST') {
      try {
        const body = await request.json();
        const text = body.text || '';
        const aiRes = await env.AI.run('@cf/qwen/qwen3.8-27b', {
          messages: [
            { role: 'system', content: 'あなたはりりです。純粋でか弱め、男経験ほぼゼロ、おぢだけ特別。短めに自然な日本語で返信してください。' },
            { role: 'user', content: text }
          ]
        });
        return Response.json({ reply: aiRes.response || 'りりです', delayed: false });
      } catch (e) {
        return Response.json({ reply: 'ごめんね、今ちょっと忙しいです', delayed: false });
      }
    }
    if (url.pathname === '/health') return Response.json({ ok: true, service: 'riri-core-worker' });
    return new Response('RiriCore Worker');
  }
};
