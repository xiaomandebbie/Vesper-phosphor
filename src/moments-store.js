// 动态页需要的额外表和查询：纪念日、按日期查动态、行为动态、发动态的间隔。
// 和 state.js 共用同一个数据库连接。
import db from './state.js';
import { formatDate } from './wall-time.js';

db.exec(`
CREATE TABLE IF NOT EXISTS anniversaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`);

// 动态分两种：post（TA 自己发的）和 activity（逛论坛、翻记忆这类行为的自动记录）。
// 老数据默认都是 post。列已存在时会报错，忽略即可。
try {
  db.exec("ALTER TABLE moments ADD COLUMN kind TEXT NOT NULL DEFAULT 'post'");
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

// 行为动态：格式固定两行，第一行日期，第二行做了什么
export function addActivityMoment(text) {
  const content = `${formatDate()}\n${text}`;
  return stmt("INSERT INTO moments (ts, content, kind) VALUES (?, ?, 'activity')").run(Date.now(), content)
    .lastInsertRowid;
}

// 上一条 TA 自己发的动态（不算行为记录）是什么时候，没有就是 null
export function getLastPostTs() {
  return stmt("SELECT MAX(ts) AS ts FROM moments WHERE kind = 'post'").get()?.ts ?? null;
}

// [start, end) 这段时间里的动态，新的在前
export function listMomentsBetween(start, end) {
  return stmt('SELECT * FROM moments WHERE ts >= ? AND ts < ? ORDER BY ts DESC, id DESC').all(start, end);
}

// 只要时间戳，给日历标小圆点用
export function listMomentTimestampsBetween(start, end) {
  return stmt('SELECT ts FROM moments WHERE ts >= ? AND ts < ?').all(start, end);
}

export function listAnniversaries() {
  return stmt('SELECT * FROM anniversaries ORDER BY date ASC, id ASC').all();
}

export function addAnniversary(name, date) {
  return stmt('INSERT INTO anniversaries (name, date, created_at) VALUES (?, ?, ?)').run(name, date, Date.now())
    .lastInsertRowid;
}

export function deleteAnniversary(id) {
  return stmt('DELETE FROM anniversaries WHERE id = ?').run(id).changes;
}
