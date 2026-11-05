// 聊天攒着发。
//
// 小满 2026-10-30：「我可以逐条发送，可以发完再点一次让允朔读。也可以发完
// 不点，在允朔下一次唤醒的时候读取并回复。」
//
// 所以发出去的话不立刻问模型，先落这张表。两条出口：
//   点「让他读」  → flushPending()，合成一条递上去，他当场回
//   不点          → 他下次醒来时 phosphor 调 flushPending（见 phosphor.js）
//
// ── 2026-11-05：拔掉 relay ──
//
// 小满：「把 relay 什么的去掉，不用人家那一套了」。
//
// 原来这里是 Tidal_Echo relay 的唯一出口：读它的密钥、把话 POST 给它、
// 等它落库再通过 SSE 扇回来。现在改成递给自己的网关（见 chat-bus.js）——
// 和 Aru 里那个 aru-chat 走同一条线路，换供应商两边一起换。
//
// 表结构、函数名、返回形状全部没动：phosphor.js 和 gateway.js 还按原样引。
// via 这个列的含义跟着改了：原来 'relay' 是「进了别人的库」，
// 现在是 'chat'（她点了让他读）和 'wake'（他醒来自己读到）。
// 旧数据里那些 'relay' 不改，那是当时的事实。
import db from './state.js';
import { askUpstream, joinPending } from './chat-bus.js';

// 攒着的话。sent=0 是还没出去的；出去之后不删，置 sent=1，
// 万一上游那边丢了还能查到说过什么。
db.exec(`
CREATE TABLE IF NOT EXISTS chat_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  window_id INTEGER,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  sent_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_chat_pending_unsent ON chat_pending (sent, id);
`);

// 后加的列。已存在时会报错，忽略即可（和 moments-store.js 同一个做法）。
// via：这条是怎么到他那边的。chat = 她点了「让他读」当场递的；
// wake = 她没点，他下次醒来自己读到的。两条路径得分得清：
// 前者当场就有回复，后者是注入进了那一轮的输入。
try {
  db.exec('ALTER TABLE chat_pending ADD COLUMN via TEXT');
} catch {
  // column already exists
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

export function addPending(text, windowId = null) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  return stmt('INSERT INTO chat_pending (window_id, text, created_at) VALUES (?, ?, ?)').run(
    Number.isInteger(windowId) ? windowId : null,
    t.slice(0, 4000),
    Date.now()
  ).lastInsertRowid;
}

export function listPending(limit = 50) {
  return stmt(
    'SELECT id, window_id, text, created_at FROM chat_pending WHERE sent = 0 ORDER BY id ASC LIMIT ?'
  ).all(Math.min(Math.max(1, limit), 200));
}

export function pendingCount() {
  return stmt('SELECT COUNT(*) AS n FROM chat_pending WHERE sent = 0').get()?.n ?? 0;
}

// 点「让他读」：把攒着的几句合成一条递给网关，他当场回。
//
// 为何合成一条（而不是一条一条发）：她点这个的意思是「这几句一起读」。
// 逐条递他会回好几次，而且回第一句时看不到后面几句。
//
// 成功才标已读：上游报错时这几句话留在表里，下次再试。
// （这条是原来就有的规矩，没动。）
//
// 返回形状和以前一样：{ sent, failed, remaining, error }。
// sent 是「递上去几句话」，不是「发了几次请求」——phosphor 那边拿它打日志。
export async function flushPending(limit = 50) {
  const rows = listPending(limit);
  if (!rows.length) return { sent: 0, failed: 0, remaining: 0 };

  const text = joinPending(rows);
  if (!text) return { sent: 0, failed: 0, remaining: pendingCount() };

  let r;
  try {
    r = await askUpstream(text);
  } catch (err) {
    console.error('chat: 递攒着的话失败', err.message);
    return { sent: 0, failed: rows.length, remaining: pendingCount(), error: err.message };
  }

  if (!r.ok) {
    console.error('chat: 递攒着的话失败', r.error);
    return { sent: 0, failed: rows.length, remaining: pendingCount(), error: r.error };
  }

  const mark = stmt("UPDATE chat_pending SET sent = 1, sent_at = ?, via = 'chat' WHERE id = ?");
  const now = Date.now();
  for (const row of rows) mark.run(now, row.id);

  console.log(`chat: 递了 ${rows.length} 句攒着的话，他回了 ${r.text.length} 字`);
  return { sent: rows.length, failed: 0, remaining: pendingCount(), reply: r.text };
}

// 他醒来自己读到了（网关把这几句注入进了那一轮的输入）。
//
// 读到就算读过，和动态里 markUserMomentsSeen 一个道理：没回也不重复递。
// 这意味着这一轮如果上游报错，那几句话不会再出现在下一轮——
// 但数据还在表里，查得到。
export function markPendingRead(ids) {
  if (!Array.isArray(ids) || !ids.length) return 0;
  const mark = stmt("UPDATE chat_pending SET sent = 1, sent_at = ?, via = 'wake' WHERE id = ? AND sent = 0");
  const now = Date.now();
  let n = 0;
  for (const id of ids) {
    if (Number.isInteger(id)) n += mark.run(now, id).changes;
  }
  return n;
}

// 改攒着还没递出去的那条。已经递出去的改不了（sent = 0 这个条件）——
// 它已经进了他的上文，在这边改只是自己看见不同的字。
export function editPending(id, text) {
  if (!Number.isInteger(id)) return false;
  const t = String(text ?? '').trim();
  if (!t) return false;
  return stmt('UPDATE chat_pending SET text = ? WHERE id = ? AND sent = 0')
    .run(t.slice(0, 4000), id).changes > 0;
}

export function dropPending(id) {
  if (!Number.isInteger(id)) return false;
  return stmt('DELETE FROM chat_pending WHERE id = ? AND sent = 0').run(id).changes > 0;
}
