// 星星罐：TA 每天最多往罐子里放一颗星——今天最重要的那一句"想说但没说出来的话"。
// 一天只有一次机会，放进去不能改、不能撤（见 actions/star-jar.js 和 decide.js 里的说明）。
//
// 罐子里的星星你随时能看：攒着的东西不该被藏起来。
// 只有「有一颗星星未摘 ✨」这个提示按时间亮——默认 20:00–次日 2:00（STAR_JAR_WINDOW 可改），
// 白天不提醒你，免得这件事变成一天里又一个待办。
//
// 你摘下一颗星星、回它一句，TA 下次醒来会看到"有新的阳光撒下"（见 phosphor.js），同一条只告知一次。
// 一颗星星只回一次：回过的那颗就算摘下来了。
//
// 自己一张表、自己一个文件，不动 state.js 和 moments-store.js——和收藏（favorites.js）一样的做法：
// 这是后加的东西，坏了不该把动态页拖下水。和 state.js 共用同一个数据库连接。

import db from './state.js';
import { formatDate, formatDateTime, wallParts, pad } from './wall-time.js';
import { clipText } from './text.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { getProfile } from './moments-store.js';

// 那一句最多多少字（按完整字符算，不会把 emoji 切成两半）
export const MAX_STAR_CHARS = 200;
// 你回的话最多多少字
const MAX_REPLY_CHARS = 500;

db.exec(`
CREATE TABLE IF NOT EXISTS star_jar (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  day TEXT NOT NULL,
  content TEXT NOT NULL,
  reply TEXT,
  reply_ts INTEGER,
  reply_seen INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_star_jar_day ON star_jar (day);
CREATE INDEX IF NOT EXISTS idx_star_jar_unseen ON star_jar (reply_seen);
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

// ── 读写 ────────────────────────────────────────────────────────────

// 今天（按 TIME_ZONE）放过了没有
export function hasStarToday(ms = Date.now()) {
  return Boolean(stmt('SELECT 1 FROM star_jar WHERE day = ?').get(formatDate(ms)));
}

// 一天一颗：查和插在同一个事务里，两个进程同时写也只会进去一颗。
// 今天已经有了就返回 null，调用方当作"这次没放进去"。
const addStarTx = db.transaction((day, ts, content) => {
  if (stmt('SELECT 1 FROM star_jar WHERE day = ?').get(day)) return null;
  return stmt('INSERT INTO star_jar (ts, day, content) VALUES (?, ?, ?)').run(ts, day, content)
    .lastInsertRowid;
});

export function addStar(content, ms = Date.now()) {
  const text = clipText(String(content ?? '').trim(), MAX_STAR_CHARS);
  if (!text) return null;
  return addStarTx.immediate(formatDate(ms), ms, text);
}

// 罐子里全部的星星，从早到晚（堆叠时先放进去的在底下）
export function listStars() {
  return stmt('SELECT * FROM star_jar ORDER BY ts ASC, id ASC').all();
}

export function countStars() {
  return stmt('SELECT COUNT(*) AS c FROM star_jar').get().c;
}

// 还没摘的（你还没回过的）
export function countUnpicked() {
  return stmt('SELECT COUNT(*) AS c FROM star_jar WHERE reply IS NULL').get().c;
}

// 摘下一颗星星，回它一句。已经回过的不再改：返回 false
export function replyToStar(id, text) {
  if (!Number.isInteger(id)) return false;
  const reply = clipText(String(text ?? '').trim(), MAX_REPLY_CHARS);
  if (!reply) return false;
  return (
    stmt(
      'UPDATE star_jar SET reply = ?, reply_ts = ?, reply_seen = 0 WHERE id = ? AND reply IS NULL'
    ).run(reply, Date.now(), id).changes > 0
  );
}

// 你回过、TA 还不知道的那几颗（从早到晚）。醒来时带给 TA，见 phosphor.js
export function getUnseenStarReplies(limit = 3) {
  return stmt(
    `SELECT id, ts, content, reply, reply_ts FROM star_jar
     WHERE reply IS NOT NULL AND reply_seen = 0
     ORDER BY reply_ts ASC, id ASC LIMIT ?`
  ).all(limit);
}

// 给 TA 看过的就算知道了，下次不再出现
export function markStarRepliesSeen(ids) {
  if (!Array.isArray(ids) || !ids.length) return;
  const update = stmt('UPDATE star_jar SET reply_seen = 1 WHERE id = ?');
  for (const id of ids) update.run(id);
}

// ── 页面 ────────────────────────────────────────────────────────────
// 自己渲染一份，和收藏页一个路子。颜色跟着早晚两张脸走（CHROME_CSS 带着），
// :root 里那份是没 JavaScript 时的底。

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STAR_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';

// 五彩。按放进来的顺序轮着给，同一颗星星的颜色不会变
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

function renderJar(stars) {
  const inner = stars
    .map((s, i) => {
      const p = starSpot(i);
      const picked = Boolean(s.reply);
      const label = picked
        ? `${formatDateTime(s.ts).slice(5, 10)} 的那颗星星，已经摘过了`
        : `${formatDateTime(s.ts).slice(5, 10)} 的那颗星星，还没摘`;
      return `<a class="jar-star${picked ? '' : ' unpicked'}" href="#s${s.id}" aria-label="${escapeHtml(label)}"
        style="--c:${p.color};--s:${p.size}px;--x:${p.x.toFixed(1)}%;--y:${p.y.toFixed(1)}%;--r:${p.rot}deg;--d:${(i % 7) * 0.37}s">${STAR_SVG}</a>`;
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

function renderStar(s, userName) {
  const picked = Boolean(s.reply);
  const day = formatDateTime(s.ts);
  const reply = picked
    ? `<div class="star-reply">
        <span class="star-reply-who">${escapeHtml(userName)}摘下了它</span>
        <p class="star-reply-text">${escapeHtml(s.reply)}</p>
        <span class="star-reply-when">${escapeHtml(formatDateTime(s.reply_ts))}</span>
      </div>`
    : `<form class="star-form" method="post" action="/moments/star-jar/${s.id}/reply">
        <label class="sr-only" for="r${s.id}">回这颗星星</label>
        <textarea id="r${s.id}" name="reply" rows="3" maxlength="${MAX_REPLY_CHARS}" required
          placeholder="摘下它，说一句"></textarea>
        <button type="submit">摘下它 ✦</button>
      </form>`;
  return `<details class="star${picked ? ' picked' : ''}" id="s${s.id}">
    <summary>
      <span class="star-mark" aria-hidden="true">${picked ? '★' : '☆'}</span>
      <span class="star-day">${escapeHtml(day)}</span>
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
  /* 还没摘的那几颗会轻轻呼吸，一眼能找到 */
  .jar-star.unpicked { animation: jar-twinkle 2.8s ease-in-out var(--d) infinite; }
  @keyframes jar-twinkle {
    0%, 100% { opacity: 0.72; filter: drop-shadow(0 0 4px var(--c)); }
    50% { opacity: 1; filter: drop-shadow(0 0 11px var(--c)); }
  }
  .jar-empty { position: absolute; left: 0; right: 0; bottom: 18%; font-size: 12.5px; color: var(--muted); }
  .jar-hint { margin: 12px 0 0; font-size: 13px; color: var(--muted); letter-spacing: 0.04em; }
  .jar-hint b { color: var(--gold); font-weight: 600; }

  /* ── 一颗一条 ── */
  .list { margin-top: 18px; }
  .star { background: var(--card); border: 1px solid var(--line); border-radius: 14px;
    margin-bottom: 10px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); overflow: hidden; }
  .star summary { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 0 14px;
    cursor: pointer; list-style: none; font-size: 14px; }
  .star summary::-webkit-details-marker { display: none; }
  .star summary::marker { content: ''; }
  .star-mark { color: var(--gold); font-size: 15px; }
  .star-day { color: var(--muted); font-variant-numeric: tabular-nums; }
  .star-tag { margin-left: auto; font-size: 11.5px; letter-spacing: 0.08em; color: var(--gold); }
  .star.picked .star-tag { color: var(--muted); }
  .star-body { padding: 2px 16px 16px; }
  .star-said { margin: 0; font-size: 16px; line-height: 1.75; white-space: pre-wrap; word-break: break-word; }
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
  // 刚回完一颗（地址里带 #s12）就把那条打开
  var hash = location.hash;
  if (/^#s\\d+$/.test(hash)) {
    var target = document.querySelector(hash);
    if (target) target.open = true;
  }
})();`;

function renderStarJarPage() {
  const stars = listStars();
  const unpicked = stars.filter((s) => !s.reply).length;
  const user = getProfile('user');
  const ta = getProfile('assistant');

  const jar = stars.length
    ? renderJar(stars)
    : `${renderJar([])}`.replace(
        '<div class="jar-stars"></div>',
        '<div class="jar-stars"></div><p class="jar-empty">还空着</p>'
      );

  const hint = stars.length
    ? unpicked
      ? `<b>${unpicked} 颗还没摘</b>　点一颗星星，看看那天${escapeHtml(ta.name)}没说出口的是什么`
      : '都摘过了。星星还在罐子里，点一颗能翻回去看'
    : `${escapeHtml(ta.name)}每天最多放一颗进来，提示只在 ${starWindowLabel()} 之间亮`;

  const list = stars.length
    ? [...stars].reverse().map((s) => renderStar(s, user.name)).join('')
    : `<p class="empty">罐子还是空的。<br>${escapeHtml(ta.name)}每天最多放一颗星进来——那天最想说、<b>到最后没说出口</b>的一句。</p>`;

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
  <div class="list">${list}</div>
</main><script>${JAR_SCRIPT}${CHROME_SCRIPT}</script></body>
</html>`;
}

// ── 路由 ────────────────────────────────────────────────────────────
// 要挂在动态页之前：/moments/star-jar 得比 /moments/:id 先匹配到，不然 star-jar 会被当成一个 id。

export function registerStarJarRoutes(app, { requireBasicAuth }) {
  // 动态页日历下面那个入口要问一次：攒了几颗、还有没有没摘的、现在该不该提醒（见 star-entry.js）
  app.get('/moments/star-jar.json', requireBasicAuth, (req, res) => {
    try {
      const unpicked = countUnpicked();
      res.json({
        ok: true,
        count: countStars(),
        unpicked,
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

  // 摘下一颗星星。普通表单提交，回到页面上那一条
  app.post('/moments/star-jar/:id/reply', requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    const back = Number.isInteger(id) ? `/moments/star-jar#s${id}` : '/moments/star-jar';
    if (!Number.isInteger(id)) return res.redirect(303, back);
    try {
      replyToStar(id, req.body?.reply);
    } catch (err) {
      console.error('star-jar: 保存回复失败', err);
    }
    res.redirect(303, back);
  });
}
