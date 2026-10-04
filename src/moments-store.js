// 动态页需要的额外表和查询：纪念日、按日期查动态、行为提示、发动态的间隔、点赞、单条留言、头像和名字。
// 以及你自己发的动态（author='user'）：发、改、删，和"TA 还没看到的那几条"。
// 和 state.js 共用同一个数据库连接。
import fs from 'fs';
import path from 'path';
import db from './state.js';
import { formatDateTime } from './wall-time.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const AVATAR_DIR = path.join(MEDIA_DIR, 'avatars');
// 头像在浏览器里已经裁成 256×256 的 JPEG，一般几十 KB。这里再兜一道上限
const MAX_AVATAR_BYTES = 512 * 1024;
// 你发的动态最多多少字。比 TA 的宽很多：你可能想写长一点的东西
export const MAX_USER_MOMENT_CHARS = 2000;

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

-- 头像和名字。who 是 'user'（你）或 'assistant'（TA）。name 为空就用 .env 里的称呼，avatar_url 为空就用名字首字
CREATE TABLE IF NOT EXISTS profiles (
  who TEXT PRIMARY KEY,
  name TEXT,
  avatar_url TEXT,
  updated_at INTEGER NOT NULL
);
`);

// 后加的列。已存在时会报错，忽略即可。
// kind：动态分两种，post（有人自己发的）和 activity（逛论坛、翻记忆这类行为的提示卡），老数据默认 post。
// detail：行为提示卡的详情（做了什么、工具返回了什么），点开卡片才显示。老卡片没有。
// author：这条是谁发的。这列是后加的，那时只有 TA 会发，所以老数据全归 assistant。
// seen_by_ta：你发的这条 TA 醒来看过没有（看过但没回也算）。TA 自己发的用不上这列。
for (const sql of [
  "ALTER TABLE moments ADD COLUMN kind TEXT NOT NULL DEFAULT 'post'",
  'ALTER TABLE moments ADD COLUMN detail TEXT',
  "ALTER TABLE moments ADD COLUMN author TEXT NOT NULL DEFAULT 'assistant'",
  'ALTER TABLE moments ADD COLUMN seen_by_ta INTEGER NOT NULL DEFAULT 0',
]) {
  try {
    db.exec(sql);
  } catch {
    // column already exists
  }
}

db.exec("CREATE INDEX IF NOT EXISTS idx_moments_unseen ON moments (author, seen_by_ta)");

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
  return stmt(
    "INSERT INTO moments (ts, content, kind, detail, author) VALUES (?, ?, 'activity', ?, 'assistant')"
  ).run(Date.now(), content, detail || null).lastInsertRowid;
}

// 上一条 TA 自己发的动态（不算行为提示）是什么时候，没有就是 null。
// 只算 TA 的：那 6 小时冷却是为了别让 TA 刷屏，你发多少条都不应该占它的额度。
export function getLastPostTs() {
  return stmt("SELECT MAX(ts) AS ts FROM moments WHERE kind = 'post' AND author = 'assistant'").get()?.ts ?? null;
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

// ---------- 你自己发的动态 ----------
// 和 TA 发的进同一张表，只是 author='user'。两条规则和 TA 不一样：
//   不吃 6 小时冷却（那是防 TA 刷屏的），且能改能删。
// 改、删都带 author='user' 条件：网页上动不了 TA 发的那些。

export function addUserMoment(content) {
  const text = String(content ?? '').trim();
  if (!text) return null;
  return stmt(
    "INSERT INTO moments (ts, content, kind, author, seen_by_ta) VALUES (?, ?, 'post', 'user', 0)"
  ).run(Date.now(), text.slice(0, MAX_USER_MOMENT_CHARS)).lastInsertRowid;
}

export function editUserMoment(id, content) {
  if (!Number.isInteger(id)) return false;
  const text = String(content ?? '').trim();
  if (!text) return false;
  return (
    stmt("UPDATE moments SET content = ? WHERE id = ? AND author = 'user'")
      .run(text.slice(0, MAX_USER_MOMENT_CHARS), id).changes > 0
  );
}

// 删你自己那条，连带它下面的留言和点赞一起清掉，不留孤儿行。
// 收藏表（moment_favorites）里的死条目由 favorites.js 的 pruneFavorites 自己清。
const deleteUserMomentTx = db.transaction((id) => {
  const row = stmt("SELECT id FROM moments WHERE id = ? AND author = 'user'").get(id);
  if (!row) return false;
  stmt('DELETE FROM moment_comments WHERE moment_id = ?').run(id);
  stmt('DELETE FROM moment_likes WHERE moment_id = ?').run(id);
  stmt('DELETE FROM moments WHERE id = ?').run(id);
  return true;
});

export function deleteUserMoment(id) {
  if (!Number.isInteger(id)) return false;
  return deleteUserMomentTx(id);
}

// 你发的、TA 醒来还没看到的那几条（从早到晚）。见 phosphor.js
export function getUnseenUserMoments(limit = 3) {
  return stmt(
    `SELECT id, ts, content FROM moments
     WHERE author = 'user' AND kind = 'post' AND seen_by_ta = 0
     ORDER BY ts ASC, id ASC LIMIT ?`
  ).all(limit);
}

// 给 TA 看过的就算看过了，下次不再重复。没回也算看过（和留言一个道理）
export function markUserMomentsSeen(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const update = stmt('UPDATE moments SET seen_by_ta = 1 WHERE id = ?');
  for (const id of ids) update.run(id);
}

// ---------- 头像和名字 ----------
// 只影响动态页上怎么显示。TA 做决定时怎么称呼你，还是看 .env 的 USER_DISPLAY_NAME / AI_DISPLAY_NAME。

export const PROFILE_WHO = ['assistant', 'user'];

export function defaultName(who) {
  return who === 'user' ? process.env.USER_DISPLAY_NAME || '我' : process.env.AI_DISPLAY_NAME || 'TA';
}

// 返回 { who, name, customName, avatarUrl }。name 是最终显示的名字，customName 是自己填的（可能为空）
export function getProfile(who) {
  const key = who === 'user' ? 'user' : 'assistant';
  const row = stmt('SELECT name, avatar_url FROM profiles WHERE who = ?').get(key);
  const customName = String(row?.name ?? '').trim();
  return { who: key, name: customName || defaultName(key), customName, avatarUrl: row?.avatar_url || null };
}

function ensureProfile(who) {
  stmt('INSERT OR IGNORE INTO profiles (who, name, avatar_url, updated_at) VALUES (?, NULL, NULL, ?)').run(
    who,
    Date.now()
  );
}

// 名字传空字符串就是恢复默认
export function saveProfileName(who, name) {
  ensureProfile(who);
  stmt('UPDATE profiles SET name = ?, updated_at = ? WHERE who = ?').run(name || null, Date.now(), who);
}

// 只认真正的 JPEG / PNG / WebP 文件头，不信 data URL 里自己写的类型
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.length > 8 && buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'png';
  if (buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

// 只删自己存的头像文件，路径不对就不动
function removeAvatarFile(url) {
  const m = /^\/media\/avatars\/([\w.-]+)$/.exec(String(url ?? ''));
  if (!m) return;
  try {
    fs.unlinkSync(path.join(AVATAR_DIR, m[1]));
  } catch {
    // 文件已经不在了
  }
}

// dataUrl 是浏览器裁好的 data:image/jpeg;base64,...。成功返回 { url }，失败返回 { error }
export function saveProfileAvatar(who, dataUrl) {
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(dataUrl ?? '').trim());
  if (!m) return { error: '头像格式不对，换一张图片试试' };
  const buf = Buffer.from(m[1], 'base64');
  if (!buf.length || buf.length > MAX_AVATAR_BYTES) return { error: '头像太大了，换一张小一点的' };
  const ext = sniffImage(buf);
  if (!ext) return { error: '头像格式不对，换一张图片试试' };

  fs.mkdirSync(AVATAR_DIR, { recursive: true });
  const filename = `${who}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(AVATAR_DIR, filename), buf);
  const url = `/media/avatars/${filename}`;

  const old = getProfile(who).avatarUrl;
  ensureProfile(who);
  stmt('UPDATE profiles SET avatar_url = ?, updated_at = ? WHERE who = ?').run(url, Date.now(), who);
  if (old && old !== url) removeAvatarFile(old);
  return { url };
}

export function resetProfileAvatar(who) {
  const old = getProfile(who).avatarUrl;
  ensureProfile(who);
  stmt('UPDATE profiles SET avatar_url = NULL, updated_at = ? WHERE who = ?').run(Date.now(), who);
  removeAvatarFile(old);
}
