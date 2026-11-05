// 世界书：哪些背景该进这一轮。
//
// 小满 2026-11-05：「世界书（可以加世界书，编辑条目，常驻/关键词激活，
// 注入方式前/后，设置优先级之类的）」
//
// ── 字段名不是我想的 ──
//
// 都是从她那份备份的 objects/world_book_entries.jsonl 里读出来的真名：
//   bookId / content / position / priority / injectDepth / scanDepth
//   constantActive / caseSensitive / useRegex / role
//   keywordsJSON / requiredKeywordsJSON / excludedKeywordsJSON
// 所以导入的时候是一对一，不用翻译字段。
//
// position 那六个值也对过两处：备份里真实出现的 after_collaborator_prompt，
// 以及 Polaris 自己讲的六个位置（角色定义前/后、环境信息之后、
// 对话上方/下方、按深度）。两边一致。
//
// ── 激活怎么算 ──
//
// 常驻（constant_active）每轮都进。
// 其他的按关键词扫最近 scan_depth 条消息：
//   keywords        命中任一就算命中
//   required        这几个要全有（在命中的基础上再卡一道）
//   excluded        出现任一就不进
// 然后按 priority 降序、再按 token 预算收。
//
// 预算超了先扣优先级低的——不是随便扣：她设优先级就是为了这一刻。
//
// ── 为什么不做粘滞/冷却/概率 ──
//
// Polaris 那边有这几项，她备份里没一条用到（都是默认值）。
// 先把列留好，逻辑不写：没人用的分支写了也验不了，不如等真要用再做。

import db from './state.js';

db.exec(`
CREATE TABLE IF NOT EXISTS world_books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  scan_depth INTEGER NOT NULL DEFAULT 4,
  token_budget INTEGER NOT NULL DEFAULT 2000,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS world_book_entries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  constant_active INTEGER NOT NULL DEFAULT 0,
  keywords TEXT,
  required_keywords TEXT,
  excluded_keywords TEXT,
  case_sensitive INTEGER NOT NULL DEFAULT 0,
  use_regex INTEGER NOT NULL DEFAULT 0,
  position TEXT NOT NULL DEFAULT 'after_collaborator_prompt',
  inject_depth INTEGER,
  scan_depth INTEGER,
  priority INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'system',
  probability_percent INTEGER,
  sticky_turns INTEGER,
  cooldown_turns INTEGER,
  delay_turns INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wbe_book ON world_book_entries (book_id, sort_order);
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
const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

// 和 Polaris 一致的六个位置。键是存进库的值，值是页面上的说法。
export const POSITIONS = {
  before_collaborator_prompt: '角色定义前',
  after_collaborator_prompt: '角色定义后',
  environment_top: '环境信息之后',
  chat_top: '对话上方',
  chat_bottom: '对话下方',
  at_depth: '按深度插入',
};

export const ROLES = { system: '系统', user: '她说的', assistant: '他说的' };

function parseList(raw) {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
  } catch {
    return String(raw)
      .split(/[,\u3001\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
}

// 页面上用逗号或换行分隔，这边统一成 JSON 数组
export function toKeywordList(raw) {
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw ?? '')
    .split(/[,\uFF0C\u3001\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function rowToEntry(r) {
  return {
    ...r,
    enabled: !!r.enabled,
    constantActive: !!r.constant_active,
    caseSensitive: !!r.case_sensitive,
    useRegex: !!r.use_regex,
    keywords: parseList(r.keywords),
    requiredKeywords: parseList(r.required_keywords),
    excludedKeywords: parseList(r.excluded_keywords),
  };
}

// ── 书 ──

export function listBooks() {
  try {
    return stmt('SELECT * FROM world_books ORDER BY sort_order ASC, created_at ASC')
      .all()
      .map((b) => ({
        ...b,
        enabled: !!b.enabled,
        entryCount: stmt('SELECT COUNT(*) AS c FROM world_book_entries WHERE book_id = ?').get(b.id).c,
      }));
  } catch (err) {
    console.error('wb: 读不到书', err.message);
    return [];
  }
}

export function getBook(id) {
  try {
    const b = stmt('SELECT * FROM world_books WHERE id = ?').get(String(id));
    return b ? { ...b, enabled: !!b.enabled } : null;
  } catch {
    return null;
  }
}

export function saveBook({ id, title, description, enabled, scanDepth, tokenBudget, sortOrder }) {
  const t = String(title ?? '').trim();
  if (!t) return { error: '书要有名字' };
  const ts = now();
  const sd = Math.min(Math.max(1, Number(scanDepth) || 4), 50);
  const tb = Math.min(Math.max(100, Number(tokenBudget) || 2000), 20000);
  try {
    if (id && getBook(id)) {
      stmt(
        'UPDATE world_books SET title = ?, description = ?, enabled = ?, scan_depth = ?,' +
          ' token_budget = ?, sort_order = ?, updated_at = ? WHERE id = ?'
      ).run(t.slice(0, 120), String(description ?? '').slice(0, 1000), enabled ? 1 : 0, sd, tb,
        Number(sortOrder) || 0, ts, String(id));
      return { ok: true, id: String(id) };
    }
    const nid = id ? String(id) : newId('wb');
    stmt(
      'INSERT INTO world_books (id, title, description, enabled, scan_depth, token_budget,' +
        ' sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(nid, t.slice(0, 120), String(description ?? '').slice(0, 1000), enabled ? 1 : 0, sd, tb,
      Number(sortOrder) || 0, ts, ts);
    console.log(`wb: 新书「${t}」`);
    return { ok: true, id: nid };
  } catch (err) {
    console.error('wb: 书存不下', err.message);
    return { error: err.message };
  }
}

// 删书连条目一起删——条目离了书没意义，留着就是孤儿行。
export function dropBook(id) {
  try {
    stmt('DELETE FROM world_book_entries WHERE book_id = ?').run(String(id));
    return stmt('DELETE FROM world_books WHERE id = ?').run(String(id)).changes > 0;
  } catch (err) {
    console.error('wb: 删不掉', err.message);
    return false;
  }
}

// ── 条目 ──

export function listEntries(bookId) {
  try {
    return stmt('SELECT * FROM world_book_entries WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC')
      .all(String(bookId))
      .map(rowToEntry);
  } catch (err) {
    console.error('wb: 读不到条目', err.message);
    return [];
  }
}

export function getEntry(id) {
  try {
    const r = stmt('SELECT * FROM world_book_entries WHERE id = ?').get(String(id));
    return r ? rowToEntry(r) : null;
  } catch {
    return null;
  }
}

export function saveEntry(e) {
  const content = String(e?.content ?? '').trim();
  if (!content) return { error: '条目正文是空的' };
  if (!e?.bookId && !e?.id) return { error: '不知道这条属于哪本书' };
  const pos = Object.prototype.hasOwnProperty.call(POSITIONS, String(e.position))
    ? String(e.position)
    : 'after_collaborator_prompt';
  const role = Object.prototype.hasOwnProperty.call(ROLES, String(e.role)) ? String(e.role) : 'system';
  const ts = now();
  const vals = [
    String(e.title ?? '').slice(0, 120),
    content,
    e.enabled === false ? 0 : 1,
    e.constantActive ? 1 : 0,
    JSON.stringify(toKeywordList(e.keywords)),
    JSON.stringify(toKeywordList(e.requiredKeywords)),
    JSON.stringify(toKeywordList(e.excludedKeywords)),
    e.caseSensitive ? 1 : 0,
    e.useRegex ? 1 : 0,
    pos,
    e.injectDepth === '' || e.injectDepth == null ? null : Number(e.injectDepth),
    e.scanDepth === '' || e.scanDepth == null ? null : Number(e.scanDepth),
    Number(e.priority) || 0,
    Number(e.sortOrder) || 0,
    role,
  ];
  try {
    const old = e.id ? getEntry(e.id) : null;
    if (old) {
      stmt(
        'UPDATE world_book_entries SET title = ?, content = ?, enabled = ?, constant_active = ?,' +
          ' keywords = ?, required_keywords = ?, excluded_keywords = ?, case_sensitive = ?, use_regex = ?,' +
          ' position = ?, inject_depth = ?, scan_depth = ?, priority = ?, sort_order = ?, role = ?,' +
          ' updated_at = ? WHERE id = ?'
      ).run(...vals, ts, String(e.id));
      return { ok: true, id: String(e.id) };
    }
    const nid = e.id ? String(e.id) : newId('wbe');
    stmt(
      'INSERT INTO world_book_entries (id, book_id, title, content, enabled, constant_active,' +
        ' keywords, required_keywords, excluded_keywords, case_sensitive, use_regex, position,' +
        ' inject_depth, scan_depth, priority, sort_order, role, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(nid, String(e.bookId), ...vals, ts, ts);
    return { ok: true, id: nid };
  } catch (err) {
    console.error('wb: 条目存不下', err.message);
    return { error: err.message };
  }
}

export function dropEntry(id) {
  try {
    return stmt('DELETE FROM world_book_entries WHERE id = ?').run(String(id)).changes > 0;
  } catch {
    return false;
  }
}

// ── 激活判定 ──
//
// recent 是最近几条消息的文本（从早到晚）。扫多少条：条目自己的 scan_depth
// 优先，空着就用书的——和 Polaris 那边一个规矩。

function hit(text, word, caseSensitive, useRegex) {
  if (!word) return false;
  if (useRegex) {
    try {
      return new RegExp(word, caseSensitive ? '' : 'i').test(text);
    } catch {
      return false;
    }
  }
  return caseSensitive ? text.includes(word) : text.toLowerCase().includes(word.toLowerCase());
}

// 粗估 token：中文一字算一个，其余四个字符算一个。
// 不准，但预算这事宁可估多了。
export function roughTokens(s) {
  const text = String(s ?? '');
  let cjk = 0;
  for (const ch of text) if (/[\u3400-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/.test(ch)) cjk++;
  return cjk + Math.ceil((Array.from(text).length - cjk) / 4);
}

// 返回这一轮该进的条目，已经按优先级收过预算。
export function selectEntries(recentTexts = []) {
  const books = listBooks().filter((b) => b.enabled);
  if (!books.length) return [];

  const picked = [];
  for (const book of books) {
    for (const e of listEntries(book.id)) {
      if (!e.enabled) continue;
      if (e.constantActive) {
        picked.push({ ...e, book, why: '常驻' });
        continue;
      }
      if (!e.keywords.length) continue;

      const depth = Math.min(Math.max(1, e.scan_depth || book.scan_depth || 4), 50);
      const text = recentTexts.slice(-depth).join('\n');
      if (!text) continue;

      if (e.excludedKeywords.some((w) => hit(text, w, e.caseSensitive, e.useRegex))) continue;
      const matched = e.keywords.find((w) => hit(text, w, e.caseSensitive, e.useRegex));
      if (!matched) continue;
      if (e.requiredKeywords.length &&
          !e.requiredKeywords.every((w) => hit(text, w, e.caseSensitive, e.useRegex))) continue;

      picked.push({ ...e, book, why: `命中「${matched}」` });
    }
  }

  // 优先级高的在前；同级按自己的排序值
  picked.sort((a, b) => b.priority - a.priority || a.sort_order - b.sort_order);

  // 按每本书各自的预算收。超了先扣优先级低的那些。
  const used = new Map();
  const out = [];
  for (const e of picked) {
    const cost = roughTokens(e.content);
    const spent = used.get(e.book.id) || 0;
    if (spent + cost > e.book.token_budget) continue;
    used.set(e.book.id, spent + cost);
    out.push(e);
  }
  return out;
}

// 按位置分组，给拼 messages 的那一层用（见 memory-inject.js）
export function groupByPosition(entries) {
  const out = {};
  for (const key of Object.keys(POSITIONS)) out[key] = [];
  for (const e of entries) (out[e.position] ||= []).push(e);
  return out;
}

export function counts() {
  try {
    return {
      books: stmt('SELECT COUNT(*) AS c FROM world_books').get().c,
      entries: stmt('SELECT COUNT(*) AS c FROM world_book_entries').get().c,
    };
  } catch {
    return { books: 0, entries: 0 };
  }
}
