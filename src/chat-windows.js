// 聊天窗这一层：开窗、改名、删窗，以及「哪些内容属于哪个窗」。
//
// 小满 2026-11-05：
//   「可以开新窗、删掉旧窗，自己命名窗」
//   「开了新窗相当于一次分割，之前的内容包括聊天和动作都在之前的窗，
//    新的动作和新的聊天记录就在新的窗」
//
// ── 为什么不给每条消息存 window_id ──
//
// 因为她说的是「分割」——这词本身就是时间上的。一个窗就是一段时间：
//
//   [自己的 created_at, 下一个更新的窗的 created_at)
//
// 最新那个窗的右边是开着的，所以新来的聊天和新做的动作自动落进它。
// 开新窗 = 记一个时间点，上一个窗的右边当场封上。
//
// 这比给 conversation_log 加一列 window_id 好在：
//   不用改表、不用回填历史（回填就要猜旧消息归哪个窗）；
//   conversation_log 是网关和 Aru 共用的同一本账，不该为了网页分窗动它；
//   动作卡片在 moments 表里，和动态页共用，同样不该动。
//
// 代价是：同一段时间里的东西没法拆到两个窗。但她要的就是按时间分，
// 所以这不是妥協。
//
// ── 最老那个窗往前敞开到底 ──
//
// 她最老的窗是 10-31 01:54 开的，但聊天和卡片比它早得多。
// 若按字面取 [created_at, 下一个)，10-31 之前的东西会落在所有窗外面——
// 谁都看不到。那就是「我的聊天记录没了」。
//
// 所以最老那个窗的左边是 0：它装下「第二个窗开之前的全部」。
// 这也符合直觉：第一次分割之前，所有东西本来就在同一个屋子里。
//
// ── 删窗删的是什么 ──
//
// 只删那个分割点，不删话。删掉之后那段时间并回前一个（更老的）窗里。
//
// 为什么不连话一起删：conversation_log 里的话是他的上文和记忆，
// Aru 那边读的是同一本。在这儿点一下「删窗」就把那几天从他脑子里抓掉，
// 是个没法撒回的动作——这种事不应该藏在一个小垃圾桶图标后面。
// 真要删话，那得是个单独、说清楚后果的动作。
//
// 最后一个窗不让删：删了就没地方说话了。

import db from './state.js';
import { listMomentsBetween } from './moments-store.js';
import { tidyActivityContent } from './actions/activity.js';
import { formatDateTime } from './wall-time.js';

const MAX_TITLE = 24;
const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';

// 和 chat-page.js 建的是同一张表。这儿再写一遍 IF NOT EXISTS，
// 是为了这个模块单独被引时也能用，不依赖加载顺序。
db.exec(`
CREATE TABLE IF NOT EXISTS chat_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  created_at INTEGER NOT NULL
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

// 从新到老
export function listWindows() {
  return stmt('SELECT id, title, created_at FROM chat_windows ORDER BY created_at DESC, id DESC').all();
}

export function getWindow(id) {
  if (!Number.isInteger(id)) return null;
  return stmt('SELECT id, title, created_at FROM chat_windows WHERE id = ?').get(id) || null;
}

// 第一次进来没窗，建一个。created_at 用 0：它得装下所有已经存在的历史。
export function ensureWindow() {
  const list = listWindows();
  if (list.length) return list;
  stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)').run(null, 0);
  console.log('chat: 建了第一个窗（装下之前全部历史）');
  return listWindows();
}

// 开新窗 = 在这一刻切一刀
export function newWindow(title = null) {
  const t = String(title ?? '').trim().slice(0, MAX_TITLE);
  return stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)')
    .run(t || null, Date.now()).lastInsertRowid;
}

export function renameWindow(id, title) {
  if (!Number.isInteger(id)) return 0;
  const t = String(title ?? '').trim().slice(0, MAX_TITLE);
  return stmt('UPDATE chat_windows SET title = ? WHERE id = ?').run(t || null, id).changes;
}

// 删掉这个分割点。话和卡片不动，它们并回前一个更老的窗。
export function dropWindow(id) {
  const n0 = Number(id);
  if (!Number.isInteger(n0)) return { error: '窗号不对' };
  const w = getWindow(n0);
  if (!w) return { error: '没有这个窗' };
  const n = stmt('SELECT COUNT(*) AS c FROM chat_windows').get().c;
  if (n <= 1) return { error: '这是最后一个窗，删了就没地方说话了' };
  stmt('DELETE FROM chat_windows WHERE id = ?').run(n0);
  console.log(`chat: 删了窗 #${n0}（话没删，并回上一个窗）`);
  return { ok: true };
}

export const titleOf = (w) =>
  w.title || (w.created_at ? `${formatDateTime(w.created_at).slice(5, 16)} 的窗` : '最开头那个窗');

// 这个窗管哪段时间。
//
// to = 下一个更新的窗开的那一刻；没有更新的就是 Infinity
//      （最新那个窗是开着口的，新东西落进它）。
// from = 自己的 created_at；但最老那个窗是 0——比它更早的历史也归它，
//        否则那些话落在所有窗外面，谁都看不到。
export function windowRange(id) {
  const w = getWindow(Number(id));
  if (!w) return null;
  const next = stmt(
    `SELECT created_at FROM chat_windows
     WHERE created_at > ? OR (created_at = ? AND id > ?)
     ORDER BY created_at ASC, id ASC LIMIT 1`
  ).get(w.created_at, w.created_at, w.id);
  const older = stmt(
    `SELECT 1 AS yes FROM chat_windows
     WHERE created_at < ? OR (created_at = ? AND id < ?)
     LIMIT 1`
  ).get(w.created_at, w.created_at, w.id);
  return {
    from: older ? w.created_at : 0,
    to: next ? next.created_at : Infinity,
    window: w,
    oldest: !older,
  };
}

// ── 这个窗里的聊天 ──
//
// conversation_log 和 conversation_archive 一起查：记录被整理过之后
// 旧话会搬进归档（见 state.js），只查前者的话老窗就空了。
//
// 返回前端认的形状（见 chat-page.js 的 paint / msgTs）：
//   { id, from: 'human'|'ai', text, ts, kind: 'reply' }
// id 只用于前端去重，所以用 ts 加下标拼一个稳定的。
export function listWindowMessages(id, limit = 200) {
  const r = windowRange(id);
  if (!r) return null;
  const to = Number.isFinite(r.to) ? r.to : Number.MAX_SAFE_INTEGER;
  const n = Math.min(Math.max(1, Number(limit) || 200), 500);

  let rows;
  try {
    rows = stmt(
      `SELECT ts, speaker, content FROM (
         SELECT ts, speaker, content FROM conversation_log      WHERE ts >= ? AND ts < ?
         UNION ALL
         SELECT ts, speaker, content FROM conversation_archive  WHERE ts >= ? AND ts < ?
       )
       ORDER BY ts DESC LIMIT ?`
    ).all(r.from, to, r.from, to, n);
  } catch (err) {
    console.error('chat: 读不到这个窗的聊天', err.message);
    return [];
  }

  return rows
    .reverse()
    .map((row, i) => ({
      id: `log-${row.ts}-${i}`,
      from: row.speaker === USER_NAME ? 'human' : 'ai',
      text: String(row.content ?? '').trim(),
      ts: row.ts,
      kind: 'reply',
    }))
    .filter((m) => m.text);
}

// ── 这个窗里的动作卡片 ──
//
// 小满：「聊天窗里面的动作卡片只显示用的工具名，详细的不用写，
// 这些在主页看得到」。
//
// 所以这边不带 detail，正文也切短到工具这一层。没有 detail，前端那边
// 就不把卡片画成可点的（见 chat-page.js 的 cardEl）——正好是她要的效果。
// 动态页（主页）一个字没改，它读的是同一条 moments 记录的完整 content 和 detail。
//
// 切法：掉开头的「允朔刚刚」，再切到第一个「：」或「，」。
//   「允朔刚刚逛了 Lutopia 论坛，翻了翻自己发过的东西」 → 「逛了 Lutopia 论坛」
//   「允朔刚刚存入了一条记忆：图片走正文」       → 「存入了一条记忆」
//   「黑猫在花园里收了一块 1 号」                 → 原样（本来就短）
export function toolLabel(raw) {
  let s = tidyActivityContent(raw);
  const nl = s.indexOf('\n');
  if (nl >= 0) s = s.slice(nl + 1);
  s = s.trim();
  for (const prefix of [`${AI_NAME}刚刚`, `${AI_NAME}`]) {
    if (prefix && s.startsWith(prefix)) {
      s = s.slice(prefix.length);
      break;
    }
  }
  const cut = [s.indexOf('：'), s.indexOf('，')].filter((i) => i > 0);
  if (cut.length) s = s.slice(0, Math.min(...cut));
  return s.trim();
}

// 卡片的时间那一行（content 第一行是「MM-DD HH:mm」，见 addActivityMoment）
function cardWhen(raw) {
  const s = tidyActivityContent(raw);
  const nl = s.indexOf('\n');
  return nl < 0 ? '' : s.slice(0, nl).trim();
}

export function windowCards(id, limit = 60) {
  const r = windowRange(id);
  if (!r) return [];
  const to = Number.isFinite(r.to) ? r.to : Date.now() + 60000;
  let rows;
  try {
    rows = listMomentsBetween(r.from, to);
  } catch (err) {
    console.error('chat: 读不到这个窗的卡片', err.message);
    return [];
  }
  return rows
    .filter((m) => m.kind === 'activity')
    .slice(0, Math.max(1, Number(limit) || 60))
    .map((m) => ({ id: m.id, ts: m.ts, when: cardWhen(m.content), body: toolLabel(m.content) }))
    .filter((c) => c.body);
}

// 列表里的预览：这个窗最后一下是什么
export function windowPreview(id) {
  const msgs = listWindowMessages(id, 1) || [];
  const cards = windowCards(id, 1);
  const last = [...msgs, ...cards.map((c) => ({ ts: c.ts, text: c.body }))]
    .sort((a, b) => b.ts - a.ts)[0];
  if (!last?.text) return '';
  const chars = Array.from(last.text);
  return chars.length > 30 ? `${chars.slice(0, 30).join('')}…` : last.text;
}
