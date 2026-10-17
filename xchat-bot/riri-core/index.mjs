/**
 * RiriCore — 人格・段階・記憶・人間らしい可用性を持つ返信エンジン
 * XCHAT_REPLY_URL から呼ばれる前提で動作。
 * 人格名・口調の細部は設定から注入可能（ハードコードしない）。
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const PORT = Number(process.env.RIRI_PORT || 3020);
const DATA_DIR = process.env.RIRI_DATA || './data/riri';
const LLM_URL = process.env.RIRI_LLM_URL || null; // 例: http://127.0.0.1:11434/api/chat or Cloudflare Workers AI

// ─── 設定（IPA管理画面から上書き可能） ───
const DEFAULT_CONFIG = {
  character_name: 'りり',
  first_person: 'わたし',
  activity_hours: { start: 10, end: 23 }, // 目安。絶対ではない
  burst_chance: 0.12,                    // スキマ時間の即返信確率
  busy_duration_ms: 2 * 60 * 60 * 1000,  // 忙しい状態の持続時間
  max_delay_ms: 6 * 60 * 60 * 1000       // これ以上放置したら強制返信
};

// ─── 不変則（マニュアルから抽出） ───
const STAGES = ['trust', 'worry_seed', 'money_hint', 'money_ask', 'aftercare', 'fade'];

const DEATH_PATTERNS = [
  { re: /弁護士|法律事務所/, reply: '私この話おぢにだから話せたのになんで弁護士とか知らない人に言わなきゃいけないの？それに弁護士なんてお金儲けの考えだし…' },
  { re: /市役所|役場|公的/, reply: 'なんとかならないか何回かもう相談に行ったんだよ。でも若いし働けるし住むところもあるしで相手にしてもらえなかったんだよ' },
  { re: /親に|家族に相談/, reply: '私だって信頼できる親がいたら親に相談したと思う。でもそもそもそんな親がいたら私こんなことになってないもん' },
  { re: /待って|待ってもら|猶予/, reply: 'むりだよ。ずっと連絡きてるし家も知られてるし、待ってもらえない。すでにもうずっと待ってもらってるし' },
  { re: /お金目当て|金目当て|金欲し/, reply: 'え、どういうこと？そんなわけないよね。おぢが話してって言ってくれたから全部話したのになんでそうなるの？なんかすごい悲しい' }
];

const TAKER_RE = /会いたい会いたい|体|写真送|俺の方が|自慢|上から|タメ口いきなり|エロ/;
const GIVER_RE = /寂しい|癒|話を聞いて|一人|夢がない|趣味がない|仕事だけ/;

// ─── 関係オブジェクト ───
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
  }
  toJSON() {
    return {
      stage: this.stage, msgCount: this.msgCount, trustScore: this.trustScore,
      giverScore: this.giverScore, takerFlags: this.takerFlags,
      lastReplyAt: this.lastReplyAt, pendingUntil: this.pendingUntil,
      busyUntil: this.busyUntil, history: this.history.slice(-20), notes: this.notes
    };
  }
}

// ─── 可用性モデル ───
function availabilityScore(now, config, rel) {
  const hour = new Date(now).getHours();
  const { start, end } = config.activity_hours;
  let base = (hour >= start && hour < end) ? 0.75 : 0.18;

  // 忙しい状態
  if (rel.busyUntil > now) base *= 0.25;

  // 直近の返信疲労
  const sinceLast = now - rel.lastReplyAt;
  if (sinceLast < 15 * 60 * 1000) base *= 0.4;
  else if (sinceLast < 45 * 60 * 1000) base *= 0.7;

  // スキマ時間バースト
  if (Math.random() < config.burst_chance) base = Math.max(base, 0.85);

  return Math.min(1, Math.max(0.05, base));
}

function shouldReplyNow(now, config, rel) {
  if (rel.pendingUntil && now < rel.pendingUntil) return false;
  if (rel.lastReplyAt && now - rel.lastReplyAt > config.max_delay_ms) return true;
  return Math.random() < availabilityScore(now, config, rel);
}

// ─── 段階進行 ───
function advanceStage(rel, text) {
  const lower = text.toLowerCase();
  if (rel.stage === 'trust' && rel.msgCount >= 10) return 'worry_seed';
  if (rel.stage === 'worry_seed' && /どうした|大丈夫|なにかあった|心配/.test(text)) return 'money_hint';
  if (rel.stage === 'money_hint' && /いくら|なんとか|助ける|力にな|お金/.test(text)) return 'money_ask';
  if (rel.stage === 'money_ask' && /振込|口座|paypay|line pay|渡す|あげる/.test(text)) return 'aftercare';
  if (rel.stage === 'aftercare' && Date.now() - rel.lastReplyAt > 25 * 24 * 60 * 60 * 1000) return 'money_hint';
  return rel.stage;
}

// ─── コア ───
class RiriCore {
  constructor() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    this.config = { ...DEFAULT_CONFIG };
    this.store = new Map();
    this._load();
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
    if (!this.store.has(id)) {
      const r = new Relation(id);
      this.store.set(id, r);
    }
    return this.store.get(id);
  }

  async decide(text, authorId) {
    const now = Date.now();
    const rel = this.get(authorId || createHash('sha1').update(text).digest('hex').slice(0, 12));

    // 死の言葉
    for (const d of DEATH_PATTERNS) {
      if (d.re.test(text)) {
        rel.msgCount++;
        rel.lastReplyAt = now;
        this._save(rel);
        return { reply: d.reply, delayed: false };
      }
    }

    // テイカー判定
    if (TAKER_RE.test(text)) rel.takerFlags++;
    if (GIVER_RE.test(text)) rel.giverScore++;
    if (rel.takerFlags >= 3) {
      rel.stage = 'fade';
      this._save(rel);
      return { reply: 'すみません、今はすごく忙しいです…', delayed: false };
    }

    // 可用性判定
    if (!shouldReplyNow(now, this.config, rel)) {
      const delay = 30 * 60 * 1000 + Math.random() * 90 * 60 * 1000;
      rel.pendingUntil = now + delay;
      if (Math.random() < 0.3) rel.busyUntil = now + this.config.busy_duration_ms;
      this._save(rel);
      return { reply: null, delayed: true, retryAfter: delay };
    }

    // 段階更新
    rel.stage = advanceStage(rel, text);
    rel.msgCount++;
    rel.lastReplyAt = now;
    rel.pendingUntil = 0;
    rel.history.push({ at: now, text: text.slice(0, 200) });
    this._save(rel);

    // 返信生成（LLMがあれば使う、なければルール）
    const reply = await this._generate(rel, text);
    return { reply, delayed: false, stage: rel.stage };
  }

  async _generate(rel, text) {
    if (LLM_URL) {
      try {
        const prompt = this._buildPrompt(rel, text);
        const res = await fetch(LLM_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ model: process.env.RIRI_MODEL || 'qwen2.5', messages: [{ role: 'system', content: prompt }, { role: 'user', content: text }], stream: false }),
          signal: AbortSignal.timeout(12000)
        });
        if (res.ok) {
          const j = await res.json();
          const out = j.message?.content || j.choices?.[0]?.message?.content || '';
          if (out.trim()) return out.trim();
        }
      } catch {}
    }
    return this._fallback(rel);
  }

  _buildPrompt(rel, text) {
    return `あなたは${this.config.character_name}です。${this.config.first_person}と呼びます。
純粋でか弱め、男経験ほぼゼロ、おぢだけ特別。
現在の段階: ${rel.stage}
直近の往復: ${rel.history.slice(-5).map(h => h.text).join(' / ')}
自分からお金を要求しない。おぢ側から「助けたい」と言わせる。
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

// ─── HTTP ───
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
    return res.end(JSON.stringify({ ok: true, service: 'riri-core' }));
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`RiriCore http://127.0.0.1:${PORT}/reply`);
});
