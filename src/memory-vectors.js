// 向量索引和语义召回。
//
// 小满 2026-11-05：「还有向量索引记忆召回怎么做」
//
// ── 关键词和语义的分工 ──
//
// 关键词那层（memory-store 的 searchAll，LIKE）单独就能用，现在已经在跑。
// 语义是在它之上多一层：她说「阳台的小花园」时，关键词找不到以前聊「盆栽」
// 那段，向量能。两层一起出候选，然后合并去重。
//
// ── 为什么不装向量数据库 ──
//
// 四类记忆加起来几百条，就算以后满了也就几千。千条 × 1024 维
// 点积一遍是几百万次浮点运算，在这台 VPS 上不到一毫秒。
// 装 sqlite-vss 要编译扩展、跟 better-sqlite3 的 ABI 绑定——
// 多一层能坏的东西，换不来任何好处。
//
// ── 归一化 ──
//
// 存进去之前先把向量除以自己的长度。这样余弦相似度 = 点积，
// 每次召回少算两个平方根。
//
// ── 指纹 ──
//
// 每条存一个文本指纹。正文改了指纹就变，下次建索引重算那一条；
// 没改的不重算。所以点「继续建」多少次都不会重复花钱。
//
// ── 为什么分批跑 ──
//
// 一次把几百条全 embed 很容易超时，而且中间挂了前面的全白做。
// 所以一次只做一小批，返回还剩多少，前端循环调。断了接着跑就行。

import db from './state.js';
import { getSettings } from './memory-store.js';

db.exec(`
CREATE TABLE IF NOT EXISTS memory_vectors (
  ref TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  text TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  dim INTEGER NOT NULL,
  vec BLOB NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mv_kind ON memory_vectors (kind);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 文本指纹。不用 crypto：这只是「改没改过」的开关，不是安全用途。
function fingerprint(s) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const t = String(s ?? '');
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    h1 = ((h1 ^ c) * 0x01000193) >>> 0;
    h2 = ((h2 + c * (i + 1)) * 0x85ebca6b) >>> 0;
  }
  return `${t.length.toString(36)}-${h1.toString(36)}-${h2.toString(36)}`;
}

// 要索引哪些东西。
//
// 信息卡和长期资料用「标题 + 正文开头」：整篇扔进去一条几千字，
// 一个向量表达不了那么多东西，反而什么都像。日记同理。
//
// 聊天原话（chat）不在这儿：那是两万多条，embed 一遍要真金白银，
// 而且关键词搜原话本来就准。以后真需要再说。
function collect() {
  const out = [];
  const take = (sql, kind, make) => {
    try {
      for (const r of stmt(sql).all()) {
        const text = make(r).trim();
        if (text) out.push({ kind, id: String(r.id), text: text.slice(0, 2000) });
      }
    } catch (err) {
      console.error(`vec: 读不到 ${kind}`, err.message);
    }
  };

  take('SELECT id, content FROM memory_entries', 'entry', (r) => r.content);
  take('SELECT id, title, summary, content FROM memory_docs', 'doc',
    (r) => `${r.title}\n${r.summary || ''}\n${String(r.content || '').slice(0, 1200)}`);
  take('SELECT id, subject, synopsis FROM memory_cards', 'card',
    (r) => `${r.subject}\n${String(r.synopsis || '').slice(0, 1200)}`);
  take('SELECT id, day, title, content FROM memory_journal', 'journal',
    (r) => `${r.day} ${r.title || ''}\n${String(r.content || '').slice(0, 1200)}`);

  return out;
}

// 谁还没做、谁的正文改了
function pending() {
  const have = new Map();
  try {
    for (const r of stmt('SELECT ref, fingerprint FROM memory_vectors').all()) {
      have.set(r.ref, r.fingerprint);
    }
  } catch {}
  const todo = [];
  const alive = new Set();
  for (const item of collect()) {
    const ref = `${item.kind}:${item.id}`;
    alive.add(ref);
    if (have.get(ref) !== fingerprint(item.text)) todo.push({ ...item, ref });
  }
  // 被删掉的记忆，向量也该走
  const stale = [...have.keys()].filter((ref) => !alive.has(ref));
  return { todo, stale };
}

export function status() {
  const s = getSettings();
  let done = 0;
  try {
    done = stmt('SELECT COUNT(*) AS c FROM memory_vectors').get().c;
  } catch {}
  const { todo, stale } = pending();
  return {
    configured: Boolean(s.embedding_base_url && s.embedding_model),
    enabled: s.semantic_recall === '1',
    model: s.embedding_model,
    done,
    todo: todo.length,
    stale: stale.length,
  };
}

// ── 调 embedding ──
//
// OpenAI 兼容的 /v1/embeddings。
//
// 地址写到哪一层都认，三种：
//   .../embeddings  → 原样用
//   .../v1          → 补 /embeddings
//   光域名          → 补 /v1/embeddings
//
// 2026-11-05：之前只判了第一种，其余一律补 /v1/embeddings——
// 她填的 https://api.siliconflow.cn/v1 就被拼成了 /v1/v1/embeddings，404。
async function embed(texts) {
  const s = getSettings();
  const base = String(s.embedding_base_url || '').trim();
  const model = String(s.embedding_model || '').trim();
  const key = String(s.embedding_api_key || '').trim();
  if (!base) throw new Error('还没填 embedding 的地址');
  if (!model) throw new Error('还没填 embedding 模型');

  const trimmed = base.replace(/\/+$/, '');
  const url = /\/embeddings$/.test(trimmed)
    ? trimmed
    : /\/v\d+$/.test(trimmed)
      ? `${trimmed}/embeddings`
      : `${trimmed}/v1/embeddings`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, input: texts }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).slice(0, 300);
    throw new Error(`${url} 返回 ${res.status}：${detail}`);
  }

  const body = await res.json();
  const rows = Array.isArray(body?.data) ? body.data : null;
  if (!rows || rows.length !== texts.length) {
    throw new Error(`返回的数量不对：要 ${texts.length} 个，得到 ${rows ? rows.length : 0} 个`);
  }
  return rows.map((r) => {
    const v = r?.embedding;
    if (!Array.isArray(v) || !v.length) throw new Error('返回里没有 embedding');
    return v;
  });
}

// 归一化成 Float32。全零向量直接拒：那算不出相似度。
function pack(v) {
  let sum = 0;
  for (const x of v) sum += x * x;
  const len = Math.sqrt(sum);
  if (!len || !Number.isFinite(len)) throw new Error('向量长度是 0');
  const f = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) f[i] = v[i] / len;
  return Buffer.from(f.buffer);
}

function unpack(buf) {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
}

// 做一批。返回这批做了多少、还剩多少。
export async function runBatch(size = 24) {
  const { todo, stale } = pending();

  // 先清掉死的，这不要钱
  if (stale.length) {
    const drop = stmt('DELETE FROM memory_vectors WHERE ref = ?');
    db.transaction(() => {
      for (const ref of stale) drop.run(ref);
    })();
  }

  if (!todo.length) return { ok: true, did: 0, left: 0, cleaned: stale.length };

  const batch = todo.slice(0, Math.min(Math.max(1, size), 64));
  const vecs = await embed(batch.map((b) => b.text));

  const put = stmt(
    'INSERT INTO memory_vectors (ref, kind, ref_id, text, fingerprint, dim, vec, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?)' +
      ' ON CONFLICT(ref) DO UPDATE SET text = excluded.text, fingerprint = excluded.fingerprint,' +
      ' dim = excluded.dim, vec = excluded.vec, updated_at = excluded.updated_at'
  );
  const now = Date.now();
  db.transaction(() => {
    for (let i = 0; i < batch.length; i++) {
      const b = batch[i];
      const v = vecs[i];
      put.run(b.ref, b.kind, b.id, b.text, fingerprint(b.text), v.length, pack(v), now);
    }
  })();

  console.log(`vec: 做了 ${batch.length} 条，还剩 ${todo.length - batch.length}`);
  return { ok: true, did: batch.length, left: todo.length - batch.length, cleaned: stale.length };
}

export function clearIndex() {
  try {
    stmt('DELETE FROM memory_vectors').run();
    console.log('vec: 索引清空了');
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ── 语义召回 ──
//
// 返回 [{ kind, id, text, score }]，分数是余弦相似度（0—1）。
// 没配好、没开、索引是空的都返回空数组——谁调它都不用先检查。
export async function semanticRecall(query, topK = 6, minScore = 0.3) {
  const s = getSettings();
  if (s.semantic_recall !== '1') return [];
  if (!s.embedding_base_url || !s.embedding_model) return [];
  const q = String(query ?? '').trim();
  if (!q) return [];

  let rows;
  try {
    rows = stmt('SELECT kind, ref_id, text, dim, vec FROM memory_vectors').all();
  } catch {
    return [];
  }
  if (!rows.length) return [];

  let qv;
  try {
    const [raw] = await embed([q.slice(0, 2000)]);
    qv = unpack(pack(raw));
  } catch (err) {
    console.error('vec: 这轮没语义召回', err.message);
    return [];
  }

  const out = [];
  for (const r of rows) {
    if (r.dim !== qv.length) continue; // 换过模型、维度不同的跳过
    const v = unpack(r.vec);
    let dot = 0;
    for (let i = 0; i < qv.length; i++) dot += qv[i] * v[i];
    if (dot >= minScore) out.push({ kind: r.kind, id: r.ref_id, text: r.text, score: dot });
  }
  out.sort((a, b) => b.score - a.score);
  return out.slice(0, Math.min(Math.max(1, topK), 20));
}

// 测一下连不连得上。真发一次请求，但只一句话。
export async function testConnection() {
  try {
    const [v] = await embed(['测一下']);
    return { ok: true, message: `通了。返回 ${v.length} 维。` };
  } catch (err) {
    return { error: err.message };
  }
}
