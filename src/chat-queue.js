// 聊天攒着发。
//
// 小满 2026-10-30：「我可以逐条发送，可以发完再点一次让允朔读。也可以发完
// 不点，在允朔下一次唤醒的时候读取并回复。」
//
// 所以发出去的话不直接进 relay，先落这张表。两条出口：
//   点「让他读」  → flushPending()，按顺序递给 relay，他当场回
//   不点          → 他下次醒来时 phosphor 调 flushPending()，读到的是整批
//
// 为什么不改 Tidal_Echo 的 app.py：那边的 /app/send 就是「发即触发」，
// 攒着这层是晨暮星自己的事。上游代码不动，它以后怎么更新都不受影响——
// 和记忆库转发（memory-proxy.js）同一个做法。
//
// 密钥读文件，不进浏览器；这个模块是 relay 的唯一出口，echo-relay.js 和
// phosphor 都从这儿走。
import fs from 'fs';
import db from './state.js';

const RELAY_URL = String(process.env.ECHO_RELAY_URL || 'http://127.0.0.1:3011').replace(/\/+$/, '');
const ENV_FILE = process.env.ECHO_RELAY_ENV || '/root/companion-relay/relay.env';

// 攒着的话。sent=0 是还没递出去的；递出去之后不删，置 sent=1，
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
  const mark = stmt('UPDATE chat_pending SET sent = 1, sent_at = ? WHERE id = ?');
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

export function dropPending(id) {
  if (!Number.isInteger(id)) return false;
  return stmt('DELETE FROM chat_pending WHERE id = ? AND sent = 0').run(id).changes > 0;
}
