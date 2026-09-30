// 动态页需要的额外表和查询：纪念日、按日期查动态、行为提示、发动态的间隔、点赞、单条留言。
// 和 state.js 共用同一个数据库连接。
import db from './state.js';
import { formatDateTime } from './wall-time.js';

db.exec(`
CREATE TABLE IF NOT EXISTS anniversaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  date TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- 点赞：一条动态每人最多赞一次，再点一次就取消。author 是 'user'（你）或 'assistant'（TA）
CREATE TABLE IF NOT EXISTS moment_likes (
  moment_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  ts INTEGER NOT NULL,
  PRIMARY KEY (moment_id, author)
);
`);

// 后加的列。已存在时会报错，忽略即可。
// kind：动态分两种，post（TA 自己发的）和 activity（逛论坛、翻记忆这类行为的提示卡），老数据默认 post。
// detail：行为提示卡的详情（做了什么、工具返回了什么），点开卡片才显示。老卡片没有。
for (const sql of [
  "ALTER TABLE moments ADD COLUMN kind TEXT NOT NULL DEFAULT 'post'",
  'ALTER TABLE moments ADD COLUMN detail TEXT',
]) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
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

// 行为提示：两行，第一行 "MM-DD HH:mm"，第二行做了什么。detail 是点开后看到的详情，可以不传
export function addActivityMoment(text, detail = null) {
  const content = `${formatDateTime().slice(5)}\n${text}`;
  return stmt("INSERT INTO moments (ts, content, kind, detail) VALUES (?, ?, 'activity', ?)").run(
    Date.now(),
    content,
    detail || null
  ).lastInsertRowid;
}

// 上一条 TA 自己发的动态（不算行为提示）是什么时候，没有就是 null
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

// 单条留言，回复时用来确认被回复的那条存在、而且在同一条动态下
export function getComment(id) {
  if (!Number.isInteger(id)) return undefined;
  return stmt('SELECT * FROM moment_comments WHERE id = ?').get(id);
}

// 点赞 / 取消点赞。返回点完之后是不是赞着的状态
export function toggleLike(momentId, author) {
  const removed = stmt('DELETE FROM moment_likes WHERE moment_id = ? AND author = ?').run(momentId, author).changes;
  if (removed) return false;
  stmt('INSERT INTO moment_likes (moment_id, author, ts) VALUES (?, ?, ?)').run(momentId, author, Date.now());
  return true;
}

// 这条动态谁赞过，先赞的在前
export function listLikes(momentId) {
  return stmt('SELECT author, ts FROM moment_likes WHERE moment_id = ? ORDER BY ts ASC').all(momentId);
}
