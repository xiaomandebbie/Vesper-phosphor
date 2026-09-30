import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// data/ 不在 git 里（.gitignore 忽略了 db 文件，git 也不跟踪空目录），
// 新 clone 下来没有这个目录，better-sqlite3 会直接报错。先建好。
const DATA_DIR = path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new Database(path.join(DATA_DIR, 'state.db'));

db.exec(`
CREATE TABLE IF NOT EXISTS wake_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  mode TEXT DEFAULT 'normal',
  next_wake_at INTEGER,
  mood TEXT DEFAULT '平静',
  updated_at INTEGER
);
INSERT OR IGNORE INTO wake_state (id, next_wake_at, updated_at)
  VALUES (1, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);

CREATE TABLE IF NOT EXISTS pending_wake (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wake_at INTEGER NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  acknowledged INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS wake_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  scheduled_at INTEGER,
  fired_at INTEGER NOT NULL,
  actions TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS device_reports (
  ts TEXT, battery REAL, location TEXT, screen_time_min INTEGER
);

-- 旧的日记表。日记已经换成"动态"，这张表留着不删，启动时会把里面的内容搬进 moments。
CREATE TABLE IF NOT EXISTS diary (
  ts TEXT, content TEXT, image_url TEXT, audio_url TEXT
);

CREATE TABLE IF NOT EXISTS conversation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  speaker TEXT,
  content TEXT
);
CREATE INDEX IF NOT EXISTS idx_conversation_log_ts ON conversation_log (ts);

-- 动态：TA 发的，像朋友圈。可以配图、配音。
CREATE TABLE IF NOT EXISTS moments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  content TEXT,
  image_url TEXT,
  audio_url TEXT
);

-- 动态下的留言。author 是 'user'（你）或 'assistant'（TA）。
-- reply_to：回复的是哪条留言，直接给动态留言时是 NULL。
-- handled：你的留言 TA 有没有看过（看过但没回也算）。TA 的回复写入时直接是 1。
CREATE TABLE IF NOT EXISTS moment_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  moment_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  reply_to INTEGER,
  handled INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_moment_comments_moment ON moment_comments (moment_id);
CREATE INDEX IF NOT EXISTS idx_moment_comments_pending ON moment_comments (author, handled);

-- 记录一次性迁移、上次清理时间这类小状态
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`);

// 兼容旧数据库：这几列是后加的，已存在时会报错，直接忽略。
const migrations = [
  "ALTER TABLE diary ADD COLUMN audio_url TEXT",
  "ALTER TABLE wake_log ADD COLUMN mode TEXT",
  "ALTER TABLE wake_log ADD COLUMN gap_minutes REAL",
  "ALTER TABLE wake_log ADD COLUMN decision TEXT",
  "ALTER TABLE wake_log ADD COLUMN result TEXT",
  "ALTER TABLE wake_log ADD COLUMN error TEXT",
];
for (const sql of migrations) {
  try {
    db.exec(sql);
  } catch (err) {
    // column already exists — 正常情况
  }
}

// 预编译语句缓存。
// 原来每次调用都 db.prepare() 一个新 Statement，用完丢给垃圾回收；
// 进程退出时 Node 在拆环境，这些还没回收的 Statement 才析构，
// 就撞上 RemoveEnvironmentCleanupHook / (env) != nullptr 断言。
// 缓存起来之后 Statement 数量固定、一直被引用，关库时统一收尾。
const stmtCache = new Map();
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

// 旧日记搬进动态，只做一次。
// 三个进程启动时都会跑到这里（pm2 会同时拉起它们），所以用 IMMEDIATE 事务先拿写锁，
// 再查 meta 表里有没有做过的标记。拿不到锁的进程会等前一个做完，然后看到标记就跳过，不会搬两遍。
const migrateDiaryToMoments = db.transaction(() => {
  if (stmt("SELECT 1 FROM meta WHERE key = 'diary_migrated'").get()) return 0;
  let count = 0;
  // moments 已经有东西（比如手动搬过）就只打标记，不再搬
  if (stmt('SELECT COUNT(*) AS c FROM moments').get().c === 0) {
    const insert = stmt('INSERT INTO moments (ts, content, image_url, audio_url) VALUES (?, ?, ?, ?)');
    for (const d of stmt('SELECT * FROM diary ORDER BY ts ASC').all()) {
      insert.run(Date.parse(d.ts) || Date.now(), d.content ?? '', d.image_url ?? null, d.audio_url ?? null);
      count++;
    }
  }
  stmt("INSERT INTO meta (key, value) VALUES ('diary_migrated', ?)").run(String(Date.now()));
  return count;
});
try {
  const n = migrateDiaryToMoments.immediate();
  if (n) console.log(`state: 已把 ${n} 篇旧日记搬进动态`);
} catch (err) {
  console.error('state: 旧日记搬进动态失败（不影响运行，下次启动会再试）:', err.message);
}

// ---------- meta：小状态 ----------

export function getMeta(key) {
  return stmt('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
}
export function setMeta(key, value) {
  stmt('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    String(value)
  );
}

export function getWakeState() {
  return stmt('SELECT * FROM wake_state WHERE id = 1').get();
}
export function updateWakeState(fields) {
  const merged = { ...fields, updated_at: Date.now() };
  const keys = Object.keys(merged);
  const sql = `UPDATE wake_state SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = 1`;
  stmt(sql).run(merged);
}

export function addPendingWake(wakeAt, note) {
  return stmt('INSERT INTO pending_wake (wake_at, note, created_at, status) VALUES (?, ?, ?, ?)')
    .run(wakeAt, note ?? null, Date.now(), 'pending').lastInsertRowid;
}
export function getDuePendingWakes(now = Date.now()) {
  return stmt("SELECT * FROM pending_wake WHERE status = 'pending' AND wake_at <= ?").all(now);
}
export function getOverduePendingWakes(now, graceMs) {
  return stmt("SELECT * FROM pending_wake WHERE status = 'pending' AND wake_at <= ?").all(now - graceMs);
}
export function setPendingWakeStatus(id, status) {
  stmt('UPDATE pending_wake SET status = ? WHERE id = ?').run(status, id);
}
export function getUnacknowledgedMissed() {
  return stmt("SELECT * FROM pending_wake WHERE status = 'missed' AND acknowledged = 0").all();
}
export function acknowledgeMissed(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  stmt(`UPDATE pending_wake SET acknowledged = 1 WHERE id IN (${placeholders})`).run(...ids);
}

// logWake 把每次唤醒（包括 noop 和出错）都落盘，TA 不在时发生过什么能通过 GET /wake/log 看回来。
export function logWake({ kind, scheduledAt, mode, gapMinutes, decision, result, error }) {
  stmt(
    `INSERT INTO wake_log (kind, scheduled_at, fired_at, actions, created_at, mode, gap_minutes, decision, result, error)
     VALUES (@kind, @scheduledAt, @firedAt, @actions, @createdAt, @mode, @gapMinutes, @decision, @result, @error)`
  ).run({
    kind,
    scheduledAt: scheduledAt ?? null,
    firedAt: Date.now(),
    actions: decision ? JSON.stringify(decision) : null,
    createdAt: Date.now(),
    mode: mode ?? null,
    gapMinutes: gapMinutes ?? null,
    decision: decision ? JSON.stringify(decision) : null,
    result: result !== undefined ? JSON.stringify(result) : null,
    error: error ?? null,
  });
}
export function getRecentWakeLog(limit = 20) {
  return stmt('SELECT * FROM wake_log ORDER BY fired_at DESC LIMIT ?').all(limit);
}

// 最近几次醒来选的动作（从早到晚），给模型看，避免总选同一个。
export function getRecentActions(limit = 8) {
  const rows = stmt(
    "SELECT fired_at, json_extract(decision, '$.action') AS action FROM wake_log WHERE decision IS NOT NULL ORDER BY fired_at DESC LIMIT ?"
  ).all(limit);
  return rows.reverse();
}

export function saveDeviceReport(r) {
  stmt(
    'INSERT INTO device_reports (ts, battery, location, screen_time_min) VALUES (@ts, @battery, @location, @screen_time_min)'
  ).run(r);
}
export function getLatestDeviceReport() {
  return stmt('SELECT * FROM device_reports ORDER BY ts DESC LIMIT 1').get();
}

// ---------- 动态 ----------

export function addMoment({ content, image_url = null, audio_url = null }) {
  return stmt('INSERT INTO moments (ts, content, image_url, audio_url) VALUES (?, ?, ?, ?)').run(
    Date.now(),
    content ?? '',
    image_url,
    audio_url
  ).lastInsertRowid;
}
export function getMoment(id) {
  if (!Number.isInteger(id)) return undefined;
  return stmt('SELECT * FROM moments WHERE id = ?').get(id);
}
export function listMoments(limit = 30) {
  return stmt('SELECT * FROM moments ORDER BY ts DESC, id DESC LIMIT ?').all(limit);
}
export function listMomentComments(momentId) {
  return stmt('SELECT * FROM moment_comments WHERE moment_id = ? ORDER BY ts ASC, id ASC').all(momentId);
}
export function addMomentComment({ momentId, author, content, replyTo = null, handled = 0 }) {
  return stmt(
    'INSERT INTO moment_comments (moment_id, ts, author, content, reply_to, handled) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(momentId, Date.now(), author, content, replyTo, handled ? 1 : 0).lastInsertRowid;
}
// 你留的、TA 还没看过的留言（从早到晚），带上那条动态的正文。
// 如果是回复某条留言，再带上被回复的那条（谁说的、说了什么），TA 才知道你在接哪句话。
export function getPendingComments(limit = 5) {
  return stmt(
    `SELECT c.id, c.moment_id, c.ts, c.content, m.content AS moment_content,
            p.author AS parent_author, p.content AS parent_content
     FROM moment_comments c
     JOIN moments m ON m.id = c.moment_id
     LEFT JOIN moment_comments p ON p.id = c.reply_to
     WHERE c.author = 'user' AND c.handled = 0
     ORDER BY c.ts ASC, c.id ASC LIMIT ?`
  ).all(limit);
}
export function markCommentsHandled(ids) {
  const update = stmt('UPDATE moment_comments SET handled = 1 WHERE id = ?');
  for (const id of ids) update.run(id);
}

// ---------- 对话记录 ----------

// 由聊天前端经网关上报，phosphor 拿它算密度、当"最近聊了什么"的真实上下文。
export function addConversationMessage(speaker, content) {
  stmt('INSERT INTO conversation_log (ts, speaker, content) VALUES (?, ?, ?)').run(
    Date.now(),
    speaker ?? null,
    content ?? ''
  );
}
export function getRecentConversation(limit = 20) {
  const rows = stmt('SELECT * FROM conversation_log ORDER BY ts DESC LIMIT ?').all(limit);
  return rows.reverse(); // 按时间正序返回，方便直接拼进 prompt
}
export function countRecentConversation(windowMs) {
  return stmt('SELECT COUNT(*) AS c FROM conversation_log WHERE ts >= ?').get(Date.now() - windowMs).c;
}

// 清理对话记录：删掉 cutoffTs 之前的，但不管多旧，最新的 keepMin 条总是留着，
// 免得清完之后"最近的对话"一条都没有（聊得少的时候，最近几条可能都在一天以前）。
// 返回删了多少条。
export function pruneConversationLog(cutoffTs, keepMin = 0) {
  const keep = Math.max(0, Math.floor(keepMin));
  return stmt(
    `DELETE FROM conversation_log
     WHERE ts < ?
       AND id NOT IN (SELECT id FROM conversation_log ORDER BY ts DESC, id DESC LIMIT ?)`
  ).run(cutoffTs, keep).changes;
}

// 关库。重复调用安全：已关就跳过。
export function closeDb() {
  if (db.open) {
    stmtCache.clear();
    db.close();
  }
}

// 三个进程（vesper / vesper-gateway / phosphor）都 import 这个文件，
// 所以在这里统一挂退出收尾：pm2 stop / restart 发 SIGINT，kill 发 SIGTERM，
// 正常退出或未捕获异常退出走 exit。
process.once('exit', closeDb);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    console.log(`received ${signal}, closing database and exiting`);
    closeDb();
    process.exit(0);
  });
}

export default db;
