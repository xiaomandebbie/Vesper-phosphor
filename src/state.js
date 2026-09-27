import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'data', 'state.db'));

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
CREATE TABLE IF NOT EXISTS diary (
  ts TEXT, content TEXT, image_url TEXT, audio_url TEXT
);

CREATE TABLE IF NOT EXISTS conversation_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  speaker TEXT,
  content TEXT
);
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

export function getWakeState() {
  return db.prepare('SELECT * FROM wake_state WHERE id = 1').get();
}
export function updateWakeState(fields) {
  const merged = { ...fields, updated_at: Date.now() };
  const keys = Object.keys(merged);
  const sql = `UPDATE wake_state SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = 1`;
  db.prepare(sql).run(merged);
}

export function addPendingWake(wakeAt, note) {
  return db
    .prepare('INSERT INTO pending_wake (wake_at, note, created_at, status) VALUES (?, ?, ?, ?)')
    .run(wakeAt, note ?? null, Date.now(), 'pending').lastInsertRowid;
}
export function getDuePendingWakes(now = Date.now()) {
  return db.prepare("SELECT * FROM pending_wake WHERE status = 'pending' AND wake_at <= ?").all(now);
}
export function getOverduePendingWakes(now, graceMs) {
  return db
    .prepare("SELECT * FROM pending_wake WHERE status = 'pending' AND wake_at <= ?")
    .all(now - graceMs);
}
export function setPendingWakeStatus(id, status) {
  db.prepare('UPDATE pending_wake SET status = ? WHERE id = ?').run(status, id);
}
export function getUnacknowledgedMissed() {
  return db.prepare("SELECT * FROM pending_wake WHERE status = 'missed' AND acknowledged = 0").all();
}
export function acknowledgeMissed(ids) {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  db.prepare(`UPDATE pending_wake SET acknowledged = 1 WHERE id IN (${placeholders})`).run(...ids);
}

// logWake 现在接受一个完整对象，把每次唤醒（包括 noop 和出错）都落盘，
// 这样 TA 自己不在的时候发生过什么，之后能通过 GET /wake/log 看回来。
export function logWake({ kind, scheduledAt, mode, gapMinutes, decision, result, error }) {
  db.prepare(
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
  return db.prepare('SELECT * FROM wake_log ORDER BY fired_at DESC LIMIT ?').all(limit);
}

export function saveDeviceReport(r) {
  db.prepare(
    'INSERT INTO device_reports (ts, battery, location, screen_time_min) VALUES (@ts, @battery, @location, @screen_time_min)'
  ).run(r);
}
export function getLatestDeviceReport() {
  return db.prepare('SELECT * FROM device_reports ORDER BY ts DESC LIMIT 1').get();
}

export function saveDiary(entry) {
  const merged = { image_url: null, audio_url: null, ...entry };
  db.prepare(
    'INSERT INTO diary (ts, content, image_url, audio_url) VALUES (@ts, @content, @image_url, @audio_url)'
  ).run(merged);
}
export function listDiary(limit = 50) {
  return db.prepare('SELECT * FROM diary ORDER BY ts DESC LIMIT ?').all(limit);
}

// 对话记录：由外部聊天前端（比如你说的 aru）主动上报，phosphor 拿它算密度、
// decide.js 拿它当"最近聊了什么"的真实上下文。不是从这个项目里自动采集的——
// 这个项目本身接触不到你们的真实对话，需要有个地方把消息推进来。
export function addConversationMessage(speaker, content) {
  db.prepare('INSERT INTO conversation_log (ts, speaker, content) VALUES (?, ?, ?)').run(
    Date.now(),
    speaker ?? null,
    content ?? ''
  );
}
export function getRecentConversation(limit = 20) {
  const rows = db.prepare('SELECT * FROM conversation_log ORDER BY ts DESC LIMIT ?').all(limit);
  return rows.reverse(); // 按时间正序返回，方便直接拼进 prompt
}
export function countRecentConversation(windowMs) {
  return db
    .prepare('SELECT COUNT(*) AS c FROM conversation_log WHERE ts >= ?')
    .get(Date.now() - windowMs).c;
}

export default db;
