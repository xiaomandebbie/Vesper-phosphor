// 聊天攒着发。
//
// 小满 2026-10-30：「我可以逐条发送，可以发完再点一次让允朔读。也可以发完
// 不点，在允朔下一次唤醒的时候读取并回复。」
//
// 所以发出去的话不直接进 relay，先落这张表。两条出口：
//   点「让他读」  → flushPending()，按顺序递给 relay，他当场回
//   不点          → 他下次醒来时网关调 markPendingRead()，读到的是整批
//
// 为什么不改 Tidal_Echo 的 app.py：那边的 /app/send 就是「发即触发」，
// 攒着这层是晨暮星自己的事。上游代码不动，它以后怎么更新都不受影响——
// 和记忆库转发（memory-proxy.js）同一个做法。
//
// 密钥读文件，不进浏览器；这个模块是 relay 的唯一出口，echo-relay.js 和
// gateway.js 都从这儿走。
import fs from 'fs';
import db from './state.js';

const RELAY_URL = String(process.env.ECHO_RELAY_URL || 'http://127.0.0.1:3011').replace(/\/+$/, '');
const ENV_FILE = process.env.ECHO_RELAY_ENV || '/root/companion-relay/relay.env';

// 攒着的话。sent=0 是还没出去的；出去之后不删，置 sent=1，
// 万一 relay 那边丢了还能查到说过什么。
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
// via：这条是怎么到他那边的。relay = 她点了「让他读」当场递的；
// wake = 她没点，他下次醒来自己读到的。两条路径得分得清：
// 前者进了 relay 的库、会走 SSE 回来，后者只是注入进了那一轮的输入。
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

let cachedSecret;
export function relaySecret() {
  if (cachedSecret !== undefined) return cachedSecret;
  const direct = String(process.env.ECHO_RELAY_SECRET || '').trim();
  if (direct) {
    cachedSecret = direct;
    return cachedSecret;
  }
  try {
    const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^RELAY_SECRET=(.*)$/m);
    cachedSecret = (m ? m[1].trim() : '') || null;
  } catch {
    cachedSecret = null;
  }
  return cachedSecret;
}

export function relayBase() {
  return RELAY_URL;
}

// 打 relay 的统一出口。密钥在这儿加，调用方不用知道它。
export async function relayFetch(path, init = {}) {
  const secret = relaySecret();
  if (!secret) throw new Error('读不到 RELAY_SECRET');
  const headers = { ...(init.headers || {}), Authorization: 'Bearer ' + secret };
  return fetch(RELAY_URL + path, { ...init, headers });
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

// 按顺序递给 relay。一条失败就停下，剩下的留着下次再递——
// 半批递进去比一条也没递更难收拾，但顺序不能乱。
export async function flushPending(limit = 50) {
  const rows = listPending(limit);
  if (!rows.length) return { sent: 0, failed: 0, remaining: 0 };
  const mark = stmt("UPDATE chat_pending SET sent = 1, sent_at = ?, via = 'relay' WHERE id = ?");
  let sent = 0;
  let failed = 0;
  let error = null;
  for (const row of rows) {
    try {
      const r = await relayFetch('/app/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: row.text }),
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      mark.run(Date.now(), row.id);
      sent++;
    } catch (err) {
      failed++;
      error = err.message;
      break;
    }
  }
  if (sent) console.log('chat: 递了 ' + sent + ' 条攒着的话给 relay');
  if (error) console.error('chat: 递攒着的话失败', error);
  return { sent, failed, remaining: pendingCount(), error };
}

// 他醒来自己读到了（网关把这几句注入进了那一轮的输入，见 gateway.js）。
//
// 读到就算读过，和动态里 markUserMomentsSeen 一个道理：没回也不重复递。
// 这意味着这一轮如果上游报错，那几句话不会再出现在下一轮——
// 但数据还在表里，查得到。
//
// 和 flushPending 的区别：这条路径不打 relay，所以那几句话不会进 relay 的库、
// 也不会走 SSE 回来。网页上那几个半透气泡会停在半透状态，直到刷页；
// 刷页后它们不再出现在 pending 里。
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

export function dropPending(id) {
  if (!Number.isInteger(id)) return false;
  return stmt('DELETE FROM chat_pending WHERE id = ? AND sent = 0').run(id).changes > 0;
}
