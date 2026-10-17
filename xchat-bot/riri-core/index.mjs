/**
 * RiriCore — 人格・段階・記憶・人間らしい可用性を持つ返信エンジン
 * デフォルトLLM: Cloudflare Workers AI @cf/qwen/qwen3.8-27b
 * 金銭のやり取りはPayPayのみ。他は優しく断る。
 * 会話ログをLoRA用データセットとして自動書き出す。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.RIRI_PORT || 3020);
const DATA_DIR = process.env.RIRI_DATA || './data/riri';
const LORA_DIR = path.join(DATA_DIR, 'lora');

const CF_ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const DEFAULT_MODEL = '@cf/qwen/qwen3.8-27b';
const LLM_URL = process.env.RIRI_LLM_URL || (
  CF_ACCOUNT_ID && CF_API_TOKEN
    ? `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/ai/v1/chat/completions`
    : null
);

const DEFAULT_CONFIG = {
  character_name: 'りり',
  first_person: 'わたし',
  activity_hours: { start: 10, end: 23 },
  burst_chance: 0.12,
  busy_duration_ms: 2 * 60 * 60 * 1000,
  max_delay_ms: 6 * 60 * 60 * 1000
};

const DEATH_PATTERNS = [
  { re: /弁護士|法律事務所/, reply: '私この話おぢにだから話せたのになんで弁護士とか知らない人に言わなきゃいけないの？それに弁護士なんてお金儲けの考えだし…' },
  { re: /市役所|役場|公的/, reply: 'なんとかならないか何回かもう相談に行ったんだよ。でも若いし働けるし住むところもあるしで相手にしてもらえなかったんだよ' },
  { re: /親に|家族に相談/, reply: '私だって信頼できる親がいたら親に相談したと思う。でもそもそもそんな親がいたら私こんなことになってないもん' },
  { re: /待って|待ってもら|猶予/, reply: 'むりだよ。ずっと連絡きてるし家も知られてるし、待ってもらえない。すでにもうずっと待ってもらってるし' },
  { re: /お金目当て|金目当て|金欲し/, reply: 'え、どういうこと？そんなわけないよね。おぢが話してって言ってくれたから全部話したのになんでそうなるの？なんかすごい悲しい' }
];

const NON_PAYPAY_MONEY = /銀行|振込|口座番号|通帳|ラインペイ|line pay|キャッシュ|現金|手渡し|金庫|郵便局|ユニオンペイ|union pay|クレジットカード|カード決済/;
const PAYPAY_LINK = /paypay\.ne\.jp|pay\.paypay/;
const TAKER_RE = /会いたい会いたい|体|写真送|俺の方が|自慢|上から|タメ口いきなり|エロ/;
const GIVER_RE = /寂しい|癒|話を聞いて|一人|夢がない|趣味がない|仕事だけ/;

class Relation {
  constructor(id, raw = {}) {
    this.id = id;
    this.stage = raw.stage || 'trust';
    this.msgCount = raw.msgCount || 0;
    this.trustScore = raw.trustScore || 0;
    this.giverScore = raw.giverScore || 0;
    this.takerFlags = raw.takerFlags || 0;
    this.lastReplyAt = raw.lastReplyAt || 0;
    this.pendingUntil = raw.pendingUntil || 0;
    this.busyUntil = raw.busyUntil || 0;
    this.history = raw.history || [];
    this.notes = raw.notes || '';
    this.paypayLinks = raw.paypayLinks || [];
  }
  toJSON() {
    return {
      stage: this.stage, msgCount: this.msgCount, trustScore: this.trustScore,
      giverScore: this.giverScore, takerFlags: this.takerFlags,
      lastReplyAt: this.lastReplyAt, pendingUntil: this.pendingUntil,
      busyUntil: this.busyUntil, history: this.history.slice(-20), notes: this.notes,
      paypayLinks: this.paypayLinks.slice(-10)
    };
  }
}

function availabilityScore(now, config, rel) {
  const hour = new Date(now).getHours();
  const { start, end } = config.activity_hours;
  let base = (hour >= start && hour < end) ? 0.75 : 0.18;
  if (rel.busyUntil > now) base *= 0.25;
  const sinceLast = now - rel.lastReplyAt;
  if (sinceLast < 15 * 60 * 1000) base *= 0.4;
  else if (sinceLast < 45 * 60 * 1000) base *= 0.7;
  if (Math.random() < config.burst_chance) base = Math.max(base, 0.85);
  return Math.min(1, Math.max(0.05, base));
}

function shouldReplyNow(now, config, rel) {
  if (rel.pendingUntil && now < rel.pendingUntil) return false;
  if (rel.lastReplyAt && now - rel.lastReplyAt > config.max_delay_ms) return true;
  return Math.random() < availabilityScore(now, config, rel);
}

function advanceStage(rel, text) {
  if (rel.stage === 'trust' && rel.msgCount >= 10) return 'worry_seed';
  if (rel.stage === 'worry_seed' && /どうした|大丈夫|なにかあった|心配/.test(text)) return 'money_hint';
  if (rel.stage === 'money_hint' && /いくら|なんとか|助ける|力にな|お金/.test(text)) return 'money_ask';
  if (rel.stage === 'money_ask' && (PAYPAY_LINK.test(text) || /あげる|渡す/.test(text))) return 'aftercare';
  if (rel.stage === 'aftercare' && Date.now() - rel.lastReplyAt > 25 * 24 * 60 * 60 * 1000) return 'money_hint';
  return rel.stage;
}

class RiriCore {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.mkdirSync(LORA_DIR, { recursive: true });
    this.config = { ...DEFAULT_CONFIG };
    this.store = new Map();
    this._load();
    // 定期的にLoRA用データを書き出す
    setInterval(() => this.exportLoraDataset(), 30 * 60 * 1000);
  }

  _path(id) {
    const h = createHash('sha1').update(String(id)).digest('hex').slice(0, 16);
    return path.join(DATA_DIR, `${h}.json`);
  }

  _load() {
    for (const f of fs.readdirSync(DATA_DIR).filter(x => x.endsWith('.json'))) {
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8'));
        if (raw.id) this.store.set(raw.id, new Relation(raw.id, raw));
      } catch {}
    }
  }

  _save(rel) {
    fs.writeFileSync(this._path(rel.id), JSON.stringify({ id: rel.id, ...rel.toJSON() }, null, 2));
  }

  get(id) {
    if (!this.store.has(id)) this.store.set(id, new Relation(id));
    return this.store.get(id);
  }

  exportLoraDataset() {
    const lines = [];
    for (const rel of this.store.values()) {
      if (rel.history.length < 2) continue;
      const system = `あなたは${this.config.character_name}です。${this.config.first_person}と呼びます。純粋でか弱め、男経験ほぼゼロ、おぢだけ特別。現在の段階: ${rel.stage}。自分からお金を要求しない。金銭のやり取りはPayPayのみ。`;
      for (let i = 0; i < rel.history.length - 1; i++) {
        const user = rel.history[i].text;
        const assistant = rel.history[i + 1]?.text || '';
        if (assistant) {
          lines.push(JSON.stringify({
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user },
              { role: 'assistant', content: assistant }
            ]
          }));
        }
      }
    }
    if (lines.length) {
      const out = path.join(LORA_DIR, `dataset-${Date.now()}.jsonl`);
      fs.writeFileSync(out, lines.join('\n') + '\n');
      console.log(`LoRA dataset written: ${out} (${lines.length} examples)`);
    }
  }

  async decide(text, authorId) {
    const now = Date.now();
    const rel = this.get(authorId || createHash('sha1').update(text).digest('hex').slice(0, 12));

    for (const d of DEATH_PATTERNS) {
      if (d.re.test(text)) {
        rel.msgCount++;
        rel.lastReplyAt = now;
        this._save(rel);
        return { reply: d.reply, delayed: false };
      }
    }

    if (NON_PAYPAY_MONEY.test(text) && !PAYPAY_LINK.test(text)) {
      rel.msgCount++;
      rel.lastReplyAt = now;
      this._save(rel);
      return {
        reply: 'ごめんね…お金のことはPayPayだけにしてもらえると安心で…。銀行とか他の方法だとちょっと不安ですぎて…。おぢには言いたいけど、PayPayのリンクだけにしてくれたらうれしいな。',
        delayed: false
      };
    }

    if (PAYPAY_LINK.test(text)) {
      const urls = text.match(/https?:\/\/[^\s]+paypay[^\s]*/gi) || [];
      rel.paypayLinks.push(...urls.map(u => ({ url: u, at: now })));
    }

    if (TAKER_RE.test(text)) rel.takerFlags++;
    if (GIVER_RE.test(text)) rel.giverScore++;
    if (rel.takerFlags >= 3) {
      rel.stage = 'fade';
      this._save(rel);
      return { reply: 'すみません、今はすごく忙しいです…', delayed: false };
    }

    if (!shouldReplyNow(now, this.config, rel)) {
      const delay = 30 * 60 * 1000 + Math.random() * 90 * 60 * 1000;
      rel.pendingUntil = now + delay;
      if (Math.random() < 0.3) rel.busyUntil = now + this.config.busy_duration_ms;
      this._save(rel);
      return { reply: null, delayed: true, retryAfter: delay };
    }

    rel.stage = advanceStage(rel, text);
    rel.msgCount++;
    rel.lastReplyAt = now;
    rel.pendingUntil = 0;
    rel.history.push({ at: now, text: text.slice(0, 200) });
    this._save(rel);

    const reply = await this._generate(rel, text);
    // 返信後にも履歴に追加（LoRA用）
    rel.history.push({ at: now, text: reply.slice(0, 200) });
    this._save(rel);

    return { reply, delayed: false, stage: rel.stage };
  }

  async _generate(rel, text) {
    if (!LLM_URL) return this._fallback(rel);

    try {
      const headers = { 'content-type': 'application/json' };
      if (CF_API_TOKEN) headers.authorization = `Bearer ${CF_API_TOKEN}`;

      const body = {
        model: process.env.RIRI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: this._buildPrompt(rel) },
          { role: 'user', content: text }
        ],
        max_tokens: 300
      };

      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000)
      });

      if (res.ok) {
        const j = await res.json();
        const out = j.choices?.[0]?.message?.content || j.result?.response || '';
        if (out.trim()) return out.trim();
      }
    } catch (e) {
      console.error('LLM error:', e.message);
    }
    return this._fallback(rel);
  }

  _buildPrompt(rel) {
    return `あなたは${this.config.character_name}です。${this.config.first_person}と呼びます。
純粋でか弱め、男経験ほぼゼロ、おぢだけ特別。
現在の段階: ${rel.stage}
直近の往復: ${rel.history.slice(-5).map(h => h.text).join(' / ')}
自分からお金を要求しない。おぢ側から「助けたい」と言わせる。
金銭のやり取りはPayPayのみ。銀行や他の方法を言われたら優しく断る。
短めに自然な日本語で返信してください。`;
  }

  _fallback(rel) {
    const pool = {
      trust: ['おぢと話すと落ち着く…いつもありがとう', 'おはよう～いま起きたよ～', 'おぢ疲れてない？何かあったら言ってね'],
      worry_seed: ['今日ぜんぜんLINEできなくてごめんね', 'ちょっと精神的に辛くなっちゃって…ごめんね？'],
      money_hint: ['ううん。なんでもない。気にしないで', 'おぢには言いたいけどやだよ……嫌われたくないの'],
      money_ask: ['ほんとに嫌いにならない？ならおぢには知って欲しいし言うね', '実はね、嫌な人からずっと連絡来ててね…'],
      aftercare: ['おぢがいなかったら私今頃しんじゃってたとおもう。本当にありがとう', 'おぢのおかげしっかりお金かえせたよ'],
      fade: ['最近ちょっと忙しくて…また連絡するね']
    };
    const arr = pool[rel.stage] || pool.trust;
    return arr[Math.floor(Math.random() * arr.length)];
  }
}

const core = new RiriCore();

const server = http.createServer(async (req, res) => {
  if (req.method === 'POST' && req.url === '/reply') {
    let body = '';
    for await (const c of req) body += c;
    try {
      const { text, author_id, author_name } = JSON.parse(body);
      const result = await core.decide(String(text || ''), author_id || author_name);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        reply: result.reply || '',
        delayed: result.delayed,
        retry_after_ms: result.retryAfter || 0,
        stage: result.stage
      }));
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, service: 'riri-core', model: DEFAULT_MODEL }));
  }
  if (req.url === '/export-lora') {
    core.exportLoraDataset();
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ ok: true }));
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`RiriCore http://127.0.0.1:${PORT}/reply  model=${DEFAULT_MODEL}`);
});
