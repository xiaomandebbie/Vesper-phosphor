// 星星罐：两个人各自攒"咽下去的话"的地方。同一只罐子，两种星星。
//
// TA 放的（who='assistant'）：今天最重要的那一句想说但没说出来的话。一天一颗，
//   放进去不能改、不能撤（见 actions/star-jar.js 和 decide.js）——这条规矩是为了别让模型回头改口。
// 你放的（who='user'）：同样一天一颗（这个仪式感是罐子的意义），但**能改、能删**。
//   冻住你自己的话没有道理。
//
// 两边都能摘对方的星星：在一颗星星下面回一句就算摘下了它，一颗只回一次。
//   你摘 TA 的 → TA 下次醒来看到"有新的阳光撒下"（见 phosphor.js），同一条只告知一次。
//   TA 摘你的 → 醒来时会看到你放进来、它还没回过的星星，回不回、回哪颗由它自己定；不占那次醒来的动作。
//
// 罐子里的星星随时能看：攒着的东西不该被藏起来。
// 只有「有一颗星星未摘 ✨」这个提示按时间亮——默认 20:00–次日 2:00（STAR_JAR_WINDOW 可改），
// 白天不提醒你，免得这件事变成一天里又一个待办。
//
// 自己一张表、自己一个文件，不动 state.js 和 moments-store.js——和收藏（favorites.js）一样的做法。
// 和 state.js 共用同一个数据库连接。

import db from './state.js';
import { formatDate, formatDateTime, wallParts, pad } from './wall-time.js';
import { clipText } from './text.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { getProfile } from './moments-store.js';

// TA 那一句最多多少字（按完整字符算，不会把 emoji 切成两半）
export const MAX_STAR_CHARS = 200;
// 你那一句最多多少字。比 TA 宽一点：这是你自己的地方
export const MAX_MINE_CHARS = 500;
// 摘星时回的那句最多多少字
export const MAX_REPLY_CHARS = 500;

db.exec(`
CREATE TABLE IF NOT EXISTS star_jar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  who TEXT NOT NULL DEFAULT 'assistant',
  content TEXT NOT NULL,
  reply TEXT,
  reply_ts INTEGER,
  reply_seen INTEGER NOT NULL DEFAULT 0
);
`);

// 老库兼容。who 列是后加的：那时只有 TA 会放，所以老数据全归 assistant。
// 已经有这列时 ALTER 会报错，直接忽略。
try {
  db.exec("ALTER TABLE star_jar ADD COLUMN who TEXT NOT NULL DEFAULT 'assistant'");
} catch {
  // column already exists
}

// 老库上唯一索引是单独加在 day 上的（那时一天就是一颗）。
// 现在两边各自一天一颗，得按 (who, day) 算，不然你放了 TA 当天就放不进来了。
db.exec(`
DROP INDEX IF EXISTS idx_star_jar_day;
CREATE UNIQUE INDEX IF NOT EXISTS idx_star_jar_who_day ON star_jar (who, day);
CREATE INDEX IF NOT EXISTS idx_star_jar_unseen ON star_jar (who, reply_seen);
CREATE INDEX IF NOT EXISTS idx_star_jar_unpicked ON star_jar (who, reply);
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

const normWho = (who) => (who === 'user' ? 'user' : 'assistant');

// ── 提示亮不亮的时间窗 ──────────────────────────────────────────────
// .env 的 STAR_JAR_WINDOW 写成 "20-2"（开始-结束，按 TIME_ZONE 的整点）。不填是 20-2；
// 两头一样（比如 0-0）= 一直亮。跨午夜是正常写法，结束小时比开始小就按跨夜算。
const WINDOW = (() => {
  const fallback = { start: 20, end: 2 };
  const m = /^(\d{1,2})\s*-\s*(\d{1,2})$/.exec(String(process.env.STAR_JAR_WINDOW ?? '').trim());
  if (!m) return fallback;
  const start = Number(m[1]);
  const end = Number(m[2]);
  const ok = (n) => Number.isInteger(n) && n >= 0 && n <= 23;
  return ok(start) && ok(end) ? { start, end } : fallback;
})();

export function inStarWindow(ms = Date.now()) {
  if (WINDOW.start === WINDOW.end) return true;
  const { h } = wallParts(ms);
  return WINDOW.start < WINDOW.end
    ? h >= WINDOW.start && h < WINDOW.end
    : h >= WINDOW.start || h < WINDOW.end;
}

export function starWindowLabel() {
  return `${pad(WINDOW.start)}:00–${pad(WINDOW.end)}:00`;
}

// ── 放进去 ───────────────────────────────────────────────────────

// 今天（按 TIME_ZONE）这边放过了没有
export function hasStarToday(ms = Date.now(), who = 'assistant') {
  return Boolean(stmt('SELECT 1 FROM star_jar WHERE who = ? AND day = ?').get(normWho(who), formatDate(ms)));
}

// 一天一颗：查和插在同一个事务里，两个进程同时写也只会进去一颗。
// 今天已经有了就返回 null，调用方当作"这次没放进去"。
const addStarTx = db.transaction((who, day, ts, content) => {
  if (stmt('SELECT 1 FROM star_jar WHERE who = ? AND day = ?').get(who, day)) return null;
  return stmt('INSERT INTO star_jar (ts, day, who, content) VALUES (?, ?, ?, ?)').run(ts, day, who, content)
    .lastInsertRowid;
});

export function addStar(content, { who = 'assistant', ms = Date.now() } = {}) {
  const w = normWho(who);
  const text = clipText(String(content ?? '').trim(), w === 'user' ? MAX_MINE_CHARS : MAX_STAR_CHARS);
  if (!text) return null;
  return addStarTx.immediate(w, formatDate(ms), ms, text);
}

// ── 你那颗：改、删 ─────────────────────────────────────────────
// 都带 who='user' 条件：网页上改不到 TA 那几颗。

export function getMyStarToday(ms = Date.now()) {
  return stmt("SELECT * FROM star_jar WHERE who = 'user' AND day = ?").get(formatDate(ms));
}

export function editMyStar(id, text) {
  if (!Number.isInteger(id)) return false;
  const content = clipText(String(text ?? '').trim(), MAX_MINE_CHARS);
  if (!content) return false;
  return stmt("UPDATE star_jar SET content = ? WHERE id = ? AND who = 'user'").run(content, id).changes > 0;
}

export function deleteMyStar(id) {
  if (!Number.isInteger(id)) return false;
  return stmt("DELETE FROM star_jar WHERE id = ? AND who = 'user'").run(id).changes > 0;
}

// ── 摘下来 ────────────────────────────────────────────────────

// 摘下一颗星星，回它一句。by 是摘的人：你只能摘 TA 的，TA 只能摘你的。
// 已经回过的不再改（AND reply IS NULL）：一颗只回一次。
export function replyToStar(id, text, { by = 'user' } = {}) {
  if (!Number.isInteger(id)) return false;
  const reply = clipText(String(text ?? '').trim(), MAX_REPLY_CHARS);
  if (!reply) return false;
  const target = normWho(by) === 'user' ? 'assistant' : 'user';
  return (
    stmt(
      `UPDATE star_jar SET reply = ?, reply_ts = ?, reply_seen = 0
       WHERE id = ? AND who = ? AND reply IS NULL`
    ).run(reply, Date.now(), id, target).changes > 0
  );
}

// 你摘了 TA 的星星、TA 还不知道的那几颗（从早到晚）。醒来时带给 TA，见 phosphor.js
export function getUnseenStarReplies(limit = 3) {
  return stmt(
    `SELECT id, ts, content, reply, reply_ts FROM star_jar
     WHERE who = 'assistant' AND reply IS NOT NULL AND reply_seen = 0
     ORDER BY reply_ts ASC, id ASC LIMIT ?`
  ).all(limit);
}

// 给 TA 看过的就算知道了，下次不再出现
export function markStarRepliesSeen(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const update = stmt('UPDATE star_jar SET reply_seen = 1 WHERE id = ?');
  for (const id of ids) update.run(id);
}

// 你放进来、TA 还没摘的那几颗（从早到晚）。醒来时带给 TA，回不回由它自己定。
// 这里不做"看过就不再出现"：你的星星就待在罐子里，它哪天想回都行。
export function getUnpickedMyStars(limit = 3) {
  return stmt(
    `SELECT id, ts, content FROM star_jar
     WHERE who = 'user' AND reply IS NULL
     ORDER BY ts ASC, id ASC LIMIT ?`
  ).all(limit);
}

// ── 读 ────────────────────────────────────────────────────────

// 罐子里全部的星星，从早到晚（堆叠时先放进去的在底下）
export function listStars() {
  return stmt('SELECT * FROM star_jar ORDER BY ts ASC, id ASC').all();
}

export function countStars() {
  return stmt('SELECT COUNT(*) AS c FROM star_jar').get().c;
}

// 还没摘的。不带 who 就是"等你摘的"（TA 放的那几颗），给动态页入口用
export function countUnpicked(who = 'assistant') {
  return stmt('SELECT COUNT(*) AS c FROM star_jar WHERE who = ? AND reply IS NULL').get(normWho(who)).c;
}

// ── 页面 ──────────────────────────────────────────────────────
// 自己渲染一份，和收藏页一个路子。颜色跟着早晚两张脸走（CHROME_CSS 带着），
// :root 里那份是没 JavaScript 时的底。

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// TA 的星星是五角，你的是四角的光——靠形状分，不只靠颜色，色弱也分得清
const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';
const SPARK_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 1.6l2.2 7.4 7.4 2.2-7.4 2.2L12 22.4l-2.2-9 -7.4-2.2 7.4-2.2z"/></svg>';

// 五彩。按放进来的顺序转着给，同一颗星星的颜色不会变
const STAR_COLORS = ['#f7a8c4', '#f8d27a', '#9fd8f2', '#bba7f2', '#9fe7c0', '#f6b593', '#f291b2'];

// 罐子里的位置：按序号算，刷新页面不会乱跳。一行 6 颗，往上堆。
// 堆到第 8 行（48 颗）以后就不再往上长了，挤在一起看起来就是"满了"。
function starSpot(i) {
  const rnd = (seed) => {
    const x = Math.sin((i + 1) * seed) * 10000;
    return x - Math.floor(x);
  };
  const row = Math.min(Math.floor(i / 6), 7);
  const col = i % 6;
  return {
    x: Math.min(6 + col * 14 + rnd(12.9898) * 8, 84),
    y: 5 + row * 7.5 + rnd(78.233) * 5,
    size: 15 + Math.round(rnd(45.164) * 8),
    rot: Math.round(rnd(93.989) * 50 - 25),
    color: STAR_COLORS[i % STAR_COLORS.length],
  };
}

function renderJar(stars, names) {
  const inner = stars
    .map((s, i) => {
      const p = starSpot(i);
      const mine = s.who === 'user';
      const picked = Boolean(s.reply);
      const whose = mine ? names.user : names.ta;
      const label = `${formatDateTime(s.ts).slice(5, 10)} ${whose}放的那颗，${picked ? '已经摘过了' : '还没摘'}`;
      return `<a class="jar-star${mine ? ' mine' : ''}${picked ? '' : ' unpicked'}" href="#s${s.id}" aria-label="${escapeHtml(label)}"
        style="--c:${p.color};--s:${p.size}px;--x:${p.x.toFixed(1)}%;--y:${p.y.toFixed(1)}%;--r:${p.rot}deg;--d:${(i % 7) * 0.37}s">${mine ? SPARK_SVG : STAR_SVG}</a>`;
    })
    .join('');
  return `<div class="jar">
    <i class="jar-cork" aria-hidden="true"></i>
    <i class="jar-neck" aria-hidden="true"></i>
    <div class="jar-body">
      <i class="jar-floor" aria-hidden="true"></i>
      <div class="jar-stars">${inner}</div>
      <i class="jar-shine" aria-hidden="true"></i>
    </div>
  </div>`;
}

// 今天你那颗：没放就是一个输入框，放过了就是「改一改 / 拿出来」
function renderMineToday(mine, userName) {
  if (!mine) {
    return `<section class="mine-box" aria-label="今天放一颗">
      <form class="star-form mine-form" method="post" action="/moments/star-jar/mine">
        <label class="mine-label" for="mine-new">今天你还没放——有什么话咽下去了？</label>
        <textarea id="mine-new" name="content" rows="3" maxlength="${MAX_MINE_CHARS}" required
          placeholder="写下来，放进罐子"></textarea>
        <button type="submit">放进罐子 ✦</button>
        <p class="mine-note">一天一颗，但你这颗随时能改、能删。${escapeHtml(userName)}的星星是四角的光</p>
      </form>
    </section>`;
  }
  const picked = Boolean(mine.reply);
  return `<section class="mine-box done" aria-label="今天你放的那颗">
    <p class="mine-label">今天你放进去的：</p>
    <p class="mine-said">${escapeHtml(mine.content)}</p>
    <details class="mine-edit">
      <summary>改一改</summary>
      <form class="star-form" method="post" action="/moments/star-jar/${mine.id}/edit">
        <label class="sr-only" for="mine-edit-${mine.id}">改今天这颗</label>
        <textarea id="mine-edit-${mine.id}" name="content" rows="3" maxlength="${MAX_MINE_CHARS}" required>${escapeHtml(mine.content)}</textarea>
        <button type="submit">存下来</button>
      </form>
      <form method="post" action="/moments/star-jar/${mine.id}/delete"
        onsubmit="return confirm('把今天这颗拿出来？')">
        <button type="submit" class="mine-del">拿出来</button>
      </form>
      ${picked ? '<p class="mine-note">它已经被摘过了，改正文不会动那句回复。</p>' : ''}
    </details>
  </section>`;
}

function renderStar(s, names) {
  const mine = s.who === 'user';
  const picked = Boolean(s.reply);
  const whose = mine ? names.user : names.ta;
  // 摘的人是对方：你放的由 TA 摘，TA 放的由你摘
  const picker = mine ? names.ta : names.user;
  const reply = picked
    ? `<div class="star-reply">
        <span class="star-reply-who">${escapeHtml(picker)}摘下了它</span>
        <p class="star-reply-text">${escapeHtml(s.reply)}</p>
        <span class="star-reply-when">${escapeHtml(formatDateTime(s.reply_ts))}</span>
      </div>`
    : mine
      ? `<p class="star-waiting">还没被摘。${escapeHtml(names.ta)}下次醒来会看到它，回不回由它自己定。</p>`
      : `<form class="star-form" method="post" action="/moments/star-jar/${s.id}/reply">
          <label class="sr-only" for="r${s.id}">回这颗星星</label>
          <textarea id="r${s.id}" name="reply" rows="3" maxlength="${MAX_REPLY_CHARS}" required
            placeholder="摘下它，说一句"></textarea>
          <button type="submit">摘下它 ✦</button>
        </form>`;
  return `<details class="star${picked ? ' picked' : ''}${mine ? ' is-mine' : ''}" id="s${s.id}">
    <summary>
      <span class="star-mark" aria-hidden="true">${mine ? '✦' : picked ? '★' : '☆'}</span>
      <span class="star-who">${escapeHtml(whose)}</span>
      <span class="star-day">${escapeHtml(formatDateTime(s.ts))}</span>
      <span class="star-tag">${picked ? '已摘' : '未摘'}</span>
    </summary>
    <div class="star-body">
      <p class="star-said">${escapeHtml(s.content)}</p>
      ${reply}
    </div>
  </details>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --bg1: #efe7f4; --bg2: #f9f0ee; --bg3: #fdf8f2;
    --t1: #463a7c; --t2: #9b4a7a; --t3: #c4832f;
    --glass: rgba(255, 255, 255, 0.72); }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 10px 0 16px; }
  .title { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0.2em; padding-left: 0.2em; color: #5b2e52; }
  .subtitle { margin: 6px 0 0; font-size: 13px; letter-spacing: 0.16em; color: var(--muted); }
  .back-link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px;
    color: var(--accent); text-decoration: none; font-size: 14px; }

  /* ── 罐子 ──
     玻璃是半透明的白，底下一摊暖光，星星堆在光里。
     瓶身用 border-radius 捏出圆肩和圆底，不画 SVG：要跟着早晚换颜色，CSS 变量更顺手。 */
  .jar-wrap { margin: 2px 0 18px; text-align: center; }
  .jar { position: relative; width: 212px; height: 272px; margin: 0 auto; }
  .jar-cork { position: absolute; left: 50%; top: 0; transform: translateX(-50%);
    width: 74px; height: 27px; border-radius: 9px 9px 5px 5px;
    background: linear-gradient(180deg, #cb9c6c 0%, #b07c50 55%, #9a6940 100%);
    box-shadow: inset 0 -3px 7px rgba(60, 30, 10, 0.26); }
  .jar-neck { position: absolute; left: 50%; top: 25px; transform: translateX(-50%);
    width: 62px; height: 20px;
    background: linear-gradient(90deg, var(--glass), rgba(255, 255, 255, 0.24) 45%, var(--glass));
    border-left: 1px solid var(--glass); border-right: 1px solid var(--glass); }
  .jar-body { position: absolute; left: 0; right: 0; top: 43px; bottom: 0; overflow: hidden;
    border: 1px solid var(--glass);
    border-radius: 42% 42% 26% 26% / 20% 20% 11% 11%;
    background: linear-gradient(170deg, rgba(255, 255, 255, 0.46) 0%, rgba(226, 214, 240, 0.2) 55%, rgba(255, 255, 255, 0.34) 100%);
    box-shadow: inset 0 0 28px rgba(255, 255, 255, 0.55), 0 10px 24px rgba(60, 30, 60, 0.12); }
  .jar-floor { position: absolute; left: 6%; right: 6%; bottom: -14%; height: 46%;
    border-radius: 50%; background: radial-gradient(60% 60% at 50% 60%, rgba(255, 228, 180, 0.6), transparent 72%); }
  .jar-shine { position: absolute; left: 13%; top: 8%; width: 12px; height: 62%;
    border-radius: 999px; background: linear-gradient(180deg, rgba(255, 255, 255, 0.82), rgba(255, 255, 255, 0.08));
    filter: blur(1px); }
  .jar-stars { position: absolute; inset: 0; }
  .jar-star { position: absolute; left: var(--x); bottom: var(--y);
    display: block; width: var(--s); height: var(--s); color: var(--c); opacity: 0.94;
    transform: rotate(var(--r)); filter: drop-shadow(0 0 5px var(--c)); }
  .jar-star svg { display: block; width: 100%; height: 100%; }
  /* 你放的那几颗稍大一点、亮一点，形状也不同 */
  .jar-star.mine { opacity: 1; filter: drop-shadow(0 0 7px var(--c)); }
  /* 还没摘的那几颗会轻轻呼吸，一眼能找到 */
  .jar-star.unpicked { animation: jar-twinkle 2.8s ease-in-out var(--d) infinite; }
  @keyframes jar-twinkle {
    0%, 100% { opacity: 0.72; filter: drop-shadow(0 0 4px var(--c)); }
    50% { opacity: 1; filter: drop-shadow(0 0 11px var(--c)); }
  }
  .jar-empty { position: absolute; left: 0; right: 0; bottom: 18%; font-size: 12.5px; color: var(--muted); }
  .jar-hint { margin: 12px 0 0; font-size: 13px; color: var(--muted); letter-spacing: 0.04em; }
  .jar-hint b { color: var(--gold); font-weight: 600; }

  /* ── 今天你那颗 ── */
  .mine-box { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    padding: 14px 16px 16px; margin-bottom: 16px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .mine-box.done { border-left: 3px solid #d9a3c4; }
  .mine-label { margin: 0 0 8px; font-size: 13px; color: var(--accent); }
  .mine-said { margin: 0; font-size: 16px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
  .mine-note { margin: 8px 0 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
  .mine-form { margin: 0; }
  .mine-edit { margin-top: 10px; }
  .mine-edit > summary { list-style: none; display: inline-flex; align-items: center; min-height: 44px;
    font-size: 13px; color: var(--accent); cursor: pointer; }
  .mine-edit > summary::-webkit-details-marker { display: none; }
  .mine-edit > summary::marker { content: ''; }
  .mine-edit > summary::before { content: '✎'; margin-right: 5px; color: var(--gold); }
  .mine-del { min-height: 44px; padding: 0 14px; font-size: 13px; color: var(--accent);
    background: none; border: 1px solid var(--line); border-radius: 10px; cursor: pointer; }

  /* ── 一颗一条 ── */
  .list { margin-top: 18px; }
  .star { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    margin-bottom: 10px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); overflow: hidden; }
  .star.is-mine { border-left: 3px solid #d9a3c4; }
  .star summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px;
    cursor: pointer; list-style: none; font-size: 14px; }
  .star summary::-webkit-details-marker { display: none; }
  .star summary::marker { content: ''; }
  .star-mark { color: var(--gold); font-size: 15px; }
  .star-who { font-size: 13px; color: var(--accent); }
  .star-day { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
  .star-tag { margin-left: auto; font-size: 11.5px; letter-spacing: 0.08em; color: var(--gold); }
  .star.picked .star-tag { color: var(--muted); }
  .star-body { padding: 2px 16px 16px; }
  .star-said { margin: 0; font-size: 16px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
  .star-waiting { margin: 12px 0 0; font-size: 12.5px; line-height: 1.7; color: var(--muted); }
  .star-form { margin-top: 12px; display: grid; gap: 8px; }
  .star-form textarea { width: 100%; padding: 10px 12px; font: inherit; font-size: 15px; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; resize: vertical; }
  .star-form button { justify-self: start; min-height: 44px; padding: 0 18px; font-size: 14px;
    color: #fff; background: linear-gradient(135deg, #d77aa2, #b35a83); border: 0; border-radius: 10px; cursor: pointer; }
  .star-reply { margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: rgba(255, 228, 180, 0.22);
    border: 1px solid rgba(231, 197, 142, 0.5); }
  .star-reply-who { font-size: 12px; color: var(--gold); }
  .star-reply-text { margin: 4px 0 0; font-size: 14.5px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .star-reply-when { display: block; margin-top: 6px; font-size: 11px; color: var(--muted); }
  .star.flash { box-shadow: 0 0 0 2px rgba(247, 168, 196, 0.75); }
  .empty { color: var(--muted); font-size: 14px; margin: 24px 4px; line-height: 1.8; text-align: center; }
  .empty b { color: var(--gold); font-weight: 400; }
  a:focus-visible, button:focus-visible, summary:focus-visible, textarea:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* 入夜：玻璃压暗一点，不然深底上一只白瓶子很跳 */
  html[data-dark] { --glass: rgba(255, 255, 255, 0.3); }
  html[data-dark] .jar-body { background: linear-gradient(170deg, rgba(255, 255, 255, 0.14) 0%, rgba(120, 104, 158, 0.18) 55%, rgba(255, 255, 255, 0.1) 100%);
    box-shadow: inset 0 0 26px rgba(255, 255, 255, 0.16), 0 10px 24px rgba(10, 6, 20, 0.3); }
  html[data-dark] .jar-shine { background: linear-gradient(180deg, rgba(255, 255, 255, 0.42), rgba(255, 255, 255, 0.04)); }
  html[data-dark] .star-form textarea { background: var(--card); color: var(--ink); }
  html[data-dark] .star-form button { color: #fff; }
  html[data-dark] .mine-del { color: var(--gold); }
  html[data-dark] .star-reply { background: rgba(183, 121, 47, 0.16); border-color: rgba(183, 121, 47, 0.4); }

  @media (prefers-reduced-motion: reduce) {
    .jar-star.unpicked { animation: none; opacity: 1; }
  }
`;

// 点罐子里的星星，就展开下面对应那条。没有 JavaScript 时 href="#s12" 照样跳得到，只是不自动展开
const JAR_SCRIPT = `(function () {
  document.querySelectorAll('.jar-star').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var el = document.getElementById(a.getAttribute('href').slice(1));
      if (!el) return;
      e.preventDefault();
      el.open = true;
      el.classList.add('flash');
      setTimeout(function () { el.classList.remove('flash'); }, 1400);
      if (el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  });
  // 刚回完一颗、或者刚改完（地址里带 #s12）就把那条打开
  var hash = location.hash;
  if (/^#s\\d+$/.test(hash)) {
    var target = document.querySelector(hash);
    if (target) target.open = true;
  }
})();`;

function renderStarJarPage() {
  const stars = listStars();
  const user = getProfile('user');
  const ta = getProfile('assistant');
  const names = { user: user.name, ta: ta.name };
  const waitingForMe = stars.filter((s) => s.who !== 'user' && !s.reply).length;
  const mineToday = getMyStarToday();

  const jar = stars.length
    ? renderJar(stars, names)
    : `${renderJar([], names)}`.replace(
        '<div class="jar-stars"></div>',
        '<div class="jar-stars"></div><p class="jar-empty">还空着</p>'
      );

  const hint = stars.length
    ? waitingForMe
      ? `<b>${waitingForMe} 颗等你摘</b>　点一颗星星，看看那天${escapeHtml(ta.name)}没说出口的是什么`
      : '都摘过了。星星还在罐子里，点一颗能翻回去看'
    : `两边每天最多各放一颗，提示只在 ${starWindowLabel()} 之间亮`;

  const list = stars.length
    ? [...stars].reverse().map((s) => renderStar(s, names)).join('')
    : `<p class="empty">罐子还是空的。<br>两边每天最多各放一颗星——那天最想说、<b>到最后没说出口</b>的一句。</p>`;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>星星罐 · 晨暮星</title>
<script>document.documentElement.className += ' js';${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu('/moments/star-jar')}
  <header class="hero">
    <h1 class="title title-sm">星星罐</h1>
    <p class="subtitle">${stars.length ? `${stars.length} 颗` : 'Star Jar'}</p>
  </header>
  <a class="back-link" href="/moments">‹ 回到动态</a>
  <section class="jar-wrap">
    ${jar}
    <p class="jar-hint">${hint}</p>
  </section>
  ${renderMineToday(mineToday, user.name)}
  <div class="list">${list}</div>
</main><script>${JAR_SCRIPT}${CHROME_SCRIPT}</script></body>
</html>`;
}

// ── 路由 ────────────────────────────────────────────────────────────
// 要挂在动态页之前：/moments/star-jar 得比 /moments/:id 先匹配到，不然 star-jar 会被当成一个 id。

export function registerStarJarRoutes(app, { requireBasicAuth }) {
  // 动态页日历下面那个入口要问一次：攒了几颗、还有没有等你摘的、现在该不该提醒（见 star-entry.js）
  app.get('/moments/star-jar.json', requireBasicAuth, (req, res) => {
    try {
      const unpicked = countUnpicked('assistant');
      res.json({
        ok: true,
        count: countStars(),
        unpicked,
        mine_today: Boolean(getMyStarToday()),
        in_window: inStarWindow(),
        lit: unpicked > 0 && inStarWindow(),
      });
    } catch (err) {
      console.error('star-jar: 读取失败', err);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/moments/star-jar', requireBasicAuth, (req, res) => {
    try {
      res.send(renderStarJarPage());
    } catch (err) {
      console.error('star-jar: 渲染失败', err);
      res.status(500).send('星星罐出错了，看一下 vesper 的日志。');
    }
  });

  // 你今天放一颗。一天一颗：今天已经有了就不动（页面上那时显示的是改/删，不是新增）
  app.post('/moments/star-jar/mine', requireBasicAuth, (req, res) => {
    try {
      const id = addStar(req.body?.content, { who: 'user' });
      return res.redirect(303, id ? `/moments/star-jar#s${id}` : '/moments/star-jar');
    } catch (err) {
      console.error('star-jar: 放星星失败', err);
      return res.redirect(303, '/moments/star-jar');
    }
  });

  // 改你自己那颗。只能改 who='user' 的，TA 那几颗改不到
  app.post('/moments/star-jar/:id/edit', requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    const back = Number.isInteger(id) ? `/moments/star-jar#s${id}` : '/moments/star-jar';
    if (!Number.isInteger(id)) return res.redirect(303, back);
    try {
      editMyStar(id, req.body?.content);
    } catch (err) {
      console.error('star-jar: 改星星失败', err);
    }
    res.redirect(303, back);
  });

  // 拿出来。同样只能删你自己那颗
  app.post('/moments/star-jar/:id/delete', requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    if (Number.isInteger(id)) {
      try {
        deleteMyStar(id);
      } catch (err) {
        console.error('star-jar: 删星星失败', err);
      }
    }
    res.redirect(303, '/moments/star-jar');
  });

  // 你摘下 TA 的一颗星星。普通表单提交，回到页面上那一条
  app.post('/moments/star-jar/:id/reply', requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    const back = Number.isInteger(id) ? `/moments/star-jar#s${id}` : '/moments/star-jar';
    if (!Number.isInteger(id)) return res.redirect(303, back);
    try {
      replyToStar(id, req.body?.reply, { by: 'user' });
    } catch (err) {
      console.error('star-jar: 保存回复失败', err);
    }
    res.redirect(303, back);
  });
}
