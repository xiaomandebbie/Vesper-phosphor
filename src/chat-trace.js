// 思考链和召回要落盘。
//
// 小满 2026-11-05：「一开始有思考链，退出重进思考链就没了」
// 「我也想看到他召回的内容，像 aru 这样点一下消息，点详情可以看到召回」
//
// ── 为什么之前刷新就没 ──
//
// 思考链之前只走 SSE：当场推过去画出来，一个字没落盘。
// 退出重进时页面读的是 /chat/api/history，而 conversation_log 只有
// ts / speaker / content 三列——所以当场看得见、刷新就空。召回同理。
//
// ── 为什么不给 conversation_log 加列 ──
//
// 那张表网关每轮追写、phosphor 拿它算密度、decide 拿它当上文，
// Aru 和网页共用同一本账。为了网页显示动它不值得。
//
// 所以单开一张侧表，按时间对应。配对用 ts：
//   记痕迹时记下那一刻，前端按消息的 ts 找最近的一条。
//   不用消息 id：conversation_log 没自增主键，前端的 id 是 `log-<ts>-<i>`
//   这种拼出来的临时值，跳一页就可能变。ts 是真实的。
//
// ── 召回存什么 ──
//
// 存那一轮真正被带进上下文的那段文本（memory-inject 拼的
// <memory_directory> / <recalled> / <recent_days>）。不存参数、不存分数：
// 她要看的是「他那一轮到底想起了什么」。

import db from './state.js';

db.exec(`
CREATE TABLE IF NOT EXISTS chat_trace (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  reasoning TEXT,
  recalled TEXT,
  tools TEXT
);
CREATE INDEX IF NOT EXISTS idx_chat_trace_ts ON chat_trace (ts);
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

// 配对窗口。两分钟：一轮回话从开始到落库最多几十秒，
// 但带工具循环的可能转三轮，留宽一点。
const MATCH_MS = 120000;

// 存一轮。哪一项都可以是空的，全空就不存。
export function saveTrace({ reasoning, recalled, tools } = {}) {
  const r = String(reasoning ?? '').trim();
  const c = String(recalled ?? '').trim();
  const t = Array.isArray(tools) && tools.length ? JSON.stringify(tools) : '';
  if (!r && !c && !t) return null;
  try {
    return stmt('INSERT INTO chat_trace (ts, reasoning, recalled, tools) VALUES (?, ?, ?, ?)')
      .run(Date.now(), r || null, c || null, t || null).lastInsertRowid;
  } catch (err) {
    console.error('trace: 存不下来', err.message);
    return null;
  }
}

export function listTraces(from, to) {
  try {
    return stmt(
      'SELECT id, ts, reasoning, recalled, tools FROM chat_trace' +
        ' WHERE ts >= ? AND ts <= ? ORDER BY ts ASC'
    ).all(Number(from) || 0, Number(to) || Date.now() + MATCH_MS);
  } catch (err) {
    console.error('trace: 读不到', err.message);
    return [];
  }
}

// 给它们配上消息。
//
// 思考链是在回话**之前**产生的，所以一条痕迹该跟它后面最近的
// 那条 ai 消息配。一条痕迹只配一条消息，配过就不再用。
export function attachTraces(messages) {
  if (!Array.isArray(messages) || !messages.length) return messages;
  const ais = messages.filter((m) => m.from === 'ai' && m.ts);
  if (!ais.length) return messages;

  const first = messages[0]?.ts || 0;
  const last = messages[messages.length - 1]?.ts || Date.now();
  const rows = listTraces(first - MATCH_MS, last + MATCH_MS);
  if (!rows.length) return messages;

  const used = new Set();
  for (const row of rows) {
    let best = null;
    let bestGap = Infinity;
    for (const m of ais) {
      if (used.has(m)) continue;
      // 消息要在痕迹之后（先想再说），或者最多早 5 秒
      const gap = m.ts - row.ts;
      if (gap < -5000 || gap > MATCH_MS) continue;
      const d = Math.abs(gap);
      if (d < bestGap) {
        bestGap = d;
        best = m;
      }
    }
    if (!best) continue;
    used.add(best);
    if (row.reasoning) best.reasoning = row.reasoning;
    if (row.recalled) best.recalled = row.recalled;
    if (row.tools) {
      try {
        best.tools = JSON.parse(row.tools);
      } catch {}
    }
  }
  return messages;
}

export function traceCount() {
  try {
    return stmt('SELECT COUNT(*) AS c FROM chat_trace').get().c;
  } catch {
    return 0;
  }
}
