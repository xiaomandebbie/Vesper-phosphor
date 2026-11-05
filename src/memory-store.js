// 记忆的数据层。
//
// 小满 2026-11-05：「刚刚那个备份里面所有的记忆相关的都做一份给晨暮星，
// 注入逻辑也一样」「反正备份里面有的都要做好功能，然后可以直接导入」
//
// ── 五类东西，各自的质地不同 ──
//
// 条目（entries）   每一轮都注入。所以要短。生日、固定约定、东西放哪儿。
// 长期资料（docs） 只注入标题，正文要读的时候再翻。人物设定、说明书。
// 信息卡（cards）   同上，但它是按主题持续追写的——标题命中就把正文带进来。
// 日记（journal）  自动总结，一天一篇。最近几篇进上下文，老的靠检索。
// 设置（settings） 开关和预算。
//
// ── 为什么 id 是 TEXT 而不是自增 ──
//
// Aru 备份里的 id 是 UUID（条目、资料）或者 mev_xxx（信息卡）。
// 用 TEXT 直接装原 id，导入就是一条对一条，还能幂等：
// 同一份备份导两次不会变成双份（INSERT OR REPLACE 按 id）。
// 自己新建的用 mem_/doc_/card_ 前缀加时间戳，和导入的分得清。
//
// ── 字段名照备份来 ──
//
// 2026-11-05 读过真实的 objects/*.jsonl，每行是
//   { id, objectType, payload, provenance, createdAt, updatedAt }
// 这边的列名跟 payload 里的 key 对应，导入器就不用做映射。
// 猜字段名赔过四次时间，这次先读再建表。

import db from './state.js';

db.exec(`
CREATE TABLE IF NOT EXISTS memory_entries (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  tags TEXT,
  source TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_docs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  summary TEXT,
  content TEXT NOT NULL,
  char_count INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_cards (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  synopsis TEXT NOT NULL,
  source_ids TEXT,
  source_count INTEGER,
  recorded_start_at INTEGER,
  recorded_end_at INTEGER,
  revision INTEGER,
  generator TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS memory_journal (
  id TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  auto_rewrite INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_journal_day ON memory_journal (day DESC);

CREATE TABLE IF NOT EXISTS memory_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
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

const now = () => Date.now();
const newId = (prefix) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

function parseJSON(raw, fallback) {
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// ── 设置 ──
//
// 默认值照她手机上那几张图：跳对话记忆开、每轮 6K、
// 语义索引关（要先配 embedding 模型）、记忆目录里列信息卡开。
export const SETTING_DEFAULTS = {
  cross_conversation_recall: '1',
  recall_budget: '6000',
  semantic_recall: '0',
  maps_information_cards: '1',
  maps_long_term_references: '1',
  journal_enabled: '1',
  journal_auto: '1',
  journal_timing: 'next_day',
  journal_min_chars: '5000',
  journal_model: '',
  journal_prompt: '',
  embedding_base_url: '',
  embedding_api_key: '',
  embedding_model: '',
  recent_journal_count: '3',
  recall_top_k: '6',
};

export const RECALL_BUDGETS = ['3000', '6000', '12000'];

export function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  let rows = [];
  try {
    rows = stmt('SELECT key, value FROM memory_settings').all();
  } catch (err) {
    console.error('memory: 读不到设置，用默认', err.message);
    return out;
  }
  for (const r of rows) {
    if (Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, r.key)) out[r.key] = r.value;
  }
  return out;
}

export function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(SETTING_DEFAULTS, key)) {
    return { error: `没这个设置：${key}` };
  }
  try {
    stmt(
      'INSERT INTO memory_settings (key, value, updated_at) VALUES (?, ?, ?)\n' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    ).run(key, String(value ?? ''), now());
    return { ok: true };
  } catch (err) {
    console.error('memory: 设置存不下', err.message);
    return { error: err.message };
  }
}

// ── 条目记忆：每一轮都注入 ──

export function listEntries(limit = 500) {
  try {
    return stmt('SELECT * FROM memory_entries ORDER BY created_at ASC LIMIT ?')
      .all(Math.min(Math.max(1, limit), 2000))
      .map((r) => ({ ...r, tags: parseJSON(r.tags, []) }));
  } catch (err) {
    console.error('memory: 读不到条目', err.message);
    return [];
  }
}

export function countEntries() {
  try {
    return stmt('SELECT COUNT(*) AS c FROM memory_entries').get().c;
  } catch {
    return 0;
  }
}

export function addEntry(content, tags = [], source = 'manual') {
  const text = String(content ?? '').trim();
  if (!text) return { error: '内容是空的' };
  const id = newId('mem');
  const t = now();
  try {
    stmt(
      'INSERT INTO memory_entries (id, content, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(id, text.slice(0, 4000), JSON.stringify(Array.isArray(tags) ? tags : []), source, t, t);
  } catch (err) {
    console.error('memory: 条目存不下', err.message);
    return { error: err.message };
  }
  console.log(`memory: 新条目 ${id}`);
  return { ok: true, id };
}

export function updateEntry(id, content, tags) {
  const text = String(content ?? '').trim();
  if (!text) return { error: '内容是空的' };
  try {
    const n = tags === undefined
      ? stmt('UPDATE memory_entries SET content = ?, updated_at = ? WHERE id = ?')
          .run(text.slice(0, 4000), now(), String(id)).changes
      : stmt('UPDATE memory_entries SET content = ?, tags = ?, updated_at = ? WHERE id = ?')
          .run(text.slice(0, 4000), JSON.stringify(Array.isArray(tags) ? tags : []), now(), String(id)).changes;
    return n ? { ok: true } : { error: '找不到这条' };
  } catch (err) {
    return { error: err.message };
  }
}

export function dropEntry(id) {
  try {
    return stmt('DELETE FROM memory_entries WHERE id = ?').run(String(id)).changes > 0;
  } catch {
    return false;
  }
}

// ── 长期资料：只注入标题 ──

export function listDocs() {
  try {
    return stmt(
      'SELECT id, title, summary, char_count, created_at, updated_at FROM memory_docs ORDER BY updated_at DESC'
    ).all();
  } catch (err) {
    console.error('memory: 读不到资料', err.message);
    return [];
  }
}

export function getDoc(id) {
  try {
    return stmt('SELECT * FROM memory_docs WHERE id = ?').get(String(id)) || null;
  } catch {
    return null;
  }
}

export function saveDoc({ id, title, summary, content }) {
  const t = String(title ?? '').trim();
  const body = String(content ?? '');
  if (!t) return { error: '资料要有标题' };
  const ts = now();
  try {
    if (id && getDoc(id)) {
      stmt('UPDATE memory_docs SET title = ?, summary = ?, content = ?, char_count = ?, updated_at = ? WHERE id = ?')
        .run(t.slice(0, 120), String(summary ?? '').slice(0, 500), body, Array.from(body).length, ts, String(id));
      return { ok: true, id: String(id) };
    }
    const newer = id ? String(id) : newId('doc');
    stmt(
      'INSERT INTO memory_docs (id, title, summary, content, char_count, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(newer, t.slice(0, 120), String(summary ?? '').slice(0, 500), body, Array.from(body).length, ts, ts);
    console.log(`memory: 新资料「${t}」`);
    return { ok: true, id: newer };
  } catch (err) {
    console.error('memory: 资料存不下', err.message);
    return { error: err.message };
  }
}

export function dropDoc(id) {
  try {
    return stmt('DELETE FROM memory_docs WHERE id = ?').run(String(id)).changes > 0;
  } catch {
    return false;
  }
}

// ── 信息卡：按主题持续追写 ──

export function listCards(limit = 200) {
  try {
    return stmt(
      'SELECT id, subject, synopsis, source_count, recorded_start_at, recorded_end_at, revision, updated_at\n' +
        ' FROM memory_cards ORDER BY updated_at DESC LIMIT ?'
    ).all(Math.min(Math.max(1, limit), 500));
  } catch (err) {
    console.error('memory: 读不到信息卡', err.message);
    return [];
  }
}

export function getCard(id) {
  try {
    const r = stmt('SELECT * FROM memory_cards WHERE id = ?').get(String(id));
    return r ? { ...r, source_ids: parseJSON(r.source_ids, []) } : null;
  } catch {
    return null;
  }
}

export function saveCard({ id, subject, synopsis, sourceIds, recordedStartAt, recordedEndAt, generator }) {
  const sub = String(subject ?? '').trim();
  const syn = String(synopsis ?? '').trim();
  if (!sub) return { error: '信息卡要有标题' };
  if (!syn) return { error: '信息卡要有正文' };
  const ts = now();
  const ids = Array.isArray(sourceIds) ? sourceIds : [];
  try {
    const old = id ? getCard(id) : null;
    if (old) {
      stmt(
        'UPDATE memory_cards SET subject = ?, synopsis = ?, source_ids = ?, source_count = ?,\n' +
          ' recorded_start_at = ?, recorded_end_at = ?, revision = ?, updated_at = ? WHERE id = ?'
      ).run(
        sub.slice(0, 200), syn, JSON.stringify(ids), ids.length,
        recordedStartAt ?? old.recorded_start_at, recordedEndAt ?? old.recorded_end_at,
        (old.revision || 1) + 1, ts, String(id)
      );
      return { ok: true, id: String(id), updated: true };
    }
    const newer = id ? String(id) : newId('card');
    stmt(
      'INSERT INTO memory_cards (id, subject, synopsis, source_ids, source_count,\n' +
        ' recorded_start_at, recorded_end_at, revision, generator, created_at, updated_at)\n' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(
      newer, sub.slice(0, 200), syn, JSON.stringify(ids), ids.length,
      recordedStartAt ?? ts, recordedEndAt ?? ts, 1, String(generator ?? 'manual'), ts, ts
    );
    console.log(`memory: 新信息卡「${sub}」`);
    return { ok: true, id: newer };
  } catch (err) {
    console.error('memory: 信息卡存不下', err.message);
    return { error: err.message };
  }
}

export function dropCard(id) {
  try {
    return stmt('DELETE FROM memory_cards WHERE id = ?').run(String(id)).changes > 0;
  } catch {
    return false;
  }
}

// ── 日记 ──

export function listJournal(limit = 60, offset = 0) {
  try {
    return stmt(
      'SELECT id, day, title, substr(content, 1, 160) AS excerpt, length(content) AS len, updated_at\n' +
        ' FROM memory_journal ORDER BY day DESC, updated_at DESC LIMIT ? OFFSET ?'
    ).all(Math.min(Math.max(1, limit), 200), Math.max(0, offset));
  } catch (err) {
    console.error('memory: 读不到日记', err.message);
    return [];
  }
}

export function getJournal(id) {
  try {
    return stmt('SELECT * FROM memory_journal WHERE id = ?').get(String(id)) || null;
  } catch {
    return null;
  }
}

// 最近几篇，给注入用
export function recentJournal(n = 3) {
  try {
    return stmt('SELECT id, day, title, content FROM memory_journal ORDER BY day DESC LIMIT ?')
      .all(Math.min(Math.max(1, n), 10));
  } catch {
    return [];
  }
}

export function saveJournal({ id, day, title, content, autoRewrite = 1 }) {
  const d = String(day ?? '').trim();
  const body = String(content ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return { error: '日期要是 YYYY-MM-DD' };
  if (!body) return { error: '日记是空的' };
  const ts = now();
  try {
    if (id && getJournal(id)) {
      // 改过的日记不再被自动重写——和 Aru 那边一个规矩
      stmt('UPDATE memory_journal SET day = ?, title = ?, content = ?, auto_rewrite = 0, updated_at = ? WHERE id = ?')
        .run(d, String(title ?? '').slice(0, 120), body, ts, String(id));
      return { ok: true, id: String(id) };
    }
    const newer = id ? String(id) : newId('day');
    stmt(
      'INSERT INTO memory_journal (id, day, title, content, auto_rewrite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(newer, d, String(title ?? '').slice(0, 120), body, autoRewrite ? 1 : 0, ts, ts);
    return { ok: true, id: newer };
  } catch (err) {
    console.error('memory: 日记存不下', err.message);
    return { error: err.message };
  }
}

export function dropJournal(id) {
  try {
    return stmt('DELETE FROM memory_journal WHERE id = ?').run(String(id)).changes > 0;
  } catch {
    return false;
  }
}

// ── 指令（系统提示词）──
//
// 存在 memory_settings 里没意义（它不是开关），但也不值得单开一张表。
// 用 chat_look 那张表旁边的做法：一个 key 一条记录。
db.exec(`
CREATE TABLE IF NOT EXISTS memory_prompt (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
`);

export function getPrompt() {
  try {
    return stmt("SELECT content FROM memory_prompt WHERE key = 'main'").get()?.content ?? '';
  } catch {
    return '';
  }
}

export function savePrompt(content) {
  try {
    stmt(
      "INSERT INTO memory_prompt (key, content, updated_at) VALUES ('main', ?, ?)\n" +
        'ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    ).run(String(content ?? ''), now());
    console.log('memory: 指令改了');
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

// ── 搜──
//
// 用 LIKE，不上 FTS：这些表最多几千行， LIKE 跑得动，
// 而 FTS5 要建影子表和触发器，多一层能坏的东西。以后慢了再说。
export function searchAll(query, limit = 20) {
  const q = String(query ?? '').trim();
  if (!q) return [];
  const like = `%${q.replace(/[%_]/g, '')}%`;
  const n = Math.min(Math.max(1, limit), 50);
  const out = [];
  const push = (rows, kind) => {
    for (const r of rows) out.push({ kind, ...r });
  };
  try {
    push(stmt('SELECT id, content AS text, updated_at FROM memory_entries WHERE content LIKE ? LIMIT ?').all(like, n), 'entry');
    push(stmt('SELECT id, title AS text, updated_at FROM memory_docs WHERE title LIKE ? OR content LIKE ? LIMIT ?').all(like, like, n), 'doc');
    push(stmt('SELECT id, subject AS text, updated_at FROM memory_cards WHERE subject LIKE ? OR synopsis LIKE ? LIMIT ?').all(like, like, n), 'card');
    push(stmt('SELECT id, day AS text, updated_at FROM memory_journal WHERE content LIKE ? LIMIT ?').all(like, n), 'journal');
  } catch (err) {
    console.error('memory: 搜不了', err.message);
  }
  return out.sort((a, b) => b.updated_at - a.updated_at).slice(0, n);
}

export function counts() {
  const one = (sql) => {
    try {
      return stmt(sql).get().c;
    } catch {
      return 0;
    }
  };
  return {
    entries: one('SELECT COUNT(*) AS c FROM memory_entries'),
    docs: one('SELECT COUNT(*) AS c FROM memory_docs'),
    cards: one('SELECT COUNT(*) AS c FROM memory_cards'),
    journal: one('SELECT COUNT(*) AS c FROM memory_journal'),
  };
}
