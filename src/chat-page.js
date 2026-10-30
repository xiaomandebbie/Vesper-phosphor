// 聊天页 /chat。
//
// 小满 2026-10-30：「聊天做不了可以先放个假窗口。动作卡片还是放聊天好了。
//   聊天可以开很多新窗。动作卡片放在最新的窗口里。
//   居中那种不要底色那些，有些阴影就可以。点击开始可以弹出详情，这个卡片可以有底色」
//
// ── 真的和假的分清 ──
//
// **真的**：动作卡片。那是 moments 表里 kind='activity' 的行，他每次做事真在写。
// **假的**：输入框和气泡。现在没有「在网页上跟他聊」这条路——聊天在 Aru 里，
// 唤醒走 wake-bridge 投消息。要真通得接 relay 后端，那是另一套部署。
//
// 所以输入框点下去会说清楚「还没接上」，不装成能发。假装能发比明说做不了更坑人。
//
// ── 多窗 ──
//
// 窗口存在 chat_windows，就两列：建的时间和名字。动作卡片不归属任何窗口，
// 是「最新那个窗口显示它们」——这样开新窗不用搬历史，老窗就是当时那一摹。
// 进页默认最新窗；?w=<id> 看旧的。
//
// ── 卡片长相 ──
//
// 她要的是居中、没底色、只有点阴影。所以列表里的卡片是透的，
// 只给文字一层很淡的 text-shadow 和一条细分隔。点开的详情才是带底色的卡。
// 那个暗黄边框（#E6B652）留给详情卡——她 09-30 定的那个色。

import db from './state.js';
import { listMomentsBetween } from './moments-store.js';
import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { formatDateTime } from './wall-time.js';

const PREFIX = '/chat';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 一次最多摆多少张卡。再多下拉很费力，而且老的那些在动态页都查得到
const LIMIT = 60;

db.exec(`
CREATE TABLE IF NOT EXISTS chat_windows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT,
  created_at INTEGER NOT NULL
);
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

function listWindows() {
  return stmt('SELECT id, title, created_at FROM chat_windows ORDER BY created_at DESC, id DESC').all();
}

// 第一次进来没有窗口，建一个——不让页面空着
function ensureWindow() {
  const list = listWindows();
  if (list.length) return list;
  stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)').run(null, Date.now());
  return listWindows();
}

function newWindow() {
  return stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)').run(null, Date.now()).lastInsertRowid;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 动作卡片的正文是「MM-DD HH:mm\n做了什么」两行（见 addActivityMoment）。
// 这儿拆开：时间单独摆，正文自己一行。
function splitCard(raw) {
  const text = tidyActivityContent(raw);
  const nl = text.indexOf('\n');
  if (nl < 0) return { when: '', body: text.trim() };
  return { when: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
}

function activityCards(now) {
  // 往前找七天，够摆满 LIMIT 张了
  const rows = listMomentsBetween(now - 7 * 86400000, now + 60000)
    .filter((m) => m.kind === 'activity')
    .slice(0, LIMIT);
  return rows.map((m) => {
    const { when, body } = splitCard(m.content);
    return { id: m.id, when, body, detail: tidyActivityDetail(m.detail) };
  });
}

function renderCards(cards) {
  if (!cards.length) {
    return `<p class="empty">\u8fd8\u6ca1\u6709\u884c\u52a8\u5361\u7247\u3002${escapeHtml(
      AI_NAME
    )}\u505a\u4e86\u4e8b\u4e4b\u540e\u4f1a\u51fa\u73b0\u5728\u8fd9\u91cc\u3002</p>`;
  }
  // 旧的在上、新的在下，和聊天一样从上往下读
  return cards
    .slice()
    .reverse()
    .map((c) => {
      const has = Boolean(c.detail);
      const inner =
        `<span class="card-when">${escapeHtml(c.when)}</span>` +
        `<span class="card-body">${escapeHtml(c.body)}</span>` +
        (has ? '<span class="card-more" aria-hidden="true">\u2726</span>' : '');
      if (!has) return `<div class="card">${inner}</div>`;
      return (
        `<button type="button" class="card tap" data-detail="${c.id}"` +
        ` aria-label="${escapeHtml(c.body)}\uff0c\u70b9\u5f00\u770b\u8be6\u60c5">${inner}</button>` +
        `<template data-for="${c.id}">${escapeHtml(c.detail)}</template>`
      );
    })
    .join('');
}

function renderWindowBar(list, currentId) {
  const items = list
    .map((w) => {
      const on = w.id === currentId;
      const label = w.title || formatDateTime(w.created_at).slice(5, 16);
      return (
        `<a class="win${on ? ' on' : ''}" href="${PREFIX}?w=${w.id}" data-no-stars` +
        `${on ? ' aria-current="page"' : ''}>${escapeHtml(label)}</a>`
      );
    })
    .join('');
  return (
    `<div class="wins">` +
    `<div class="wins-scroll">${items}</div>` +
    `<form method="POST" action="${PREFIX}/new" class="win-new">` +
    `<button type="submit" aria-label="\u5f00\u4e00\u4e2a\u65b0\u7a97">+</button></form>` +
    `</div>`
  );
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; --activity: #E6B652; --place: #9a6412; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }

  .hero { text-align: center; margin: 6px 0 14px; }
  .title { margin: 0; font-size: 26px; font-weight: 200; letter-spacing: 0.3em; padding-left: 0.3em;
    color: #5b2e52; }
  .subtitle { margin: 5px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }

  /* 窗口条：横着滑，右边一个加号 */
  .wins { display: flex; align-items: center; gap: 8px; margin: 0 0 16px; }
  .wins-scroll { flex: 1; display: flex; gap: 6px; overflow-x: auto; padding: 2px;
    -webkit-overflow-scrolling: touch; scrollbar-width: none; }
  .wins-scroll::-webkit-scrollbar { display: none; }
  .win { flex: none; min-height: 32px; display: inline-flex; align-items: center; padding: 0 12px;
    border-radius: 999px; background: var(--card); border: 1px solid var(--line);
    color: var(--muted); text-decoration: none; font-size: 12px; white-space: nowrap; }
  .win.on { background: var(--accent); border-color: var(--accent); color: #fffdfb; font-weight: 600; }
  .win-new { margin: 0; flex: none; }
  .win-new button { width: 32px; height: 32px; border-radius: 50%; border: 1px solid var(--line);
    background: var(--card); color: var(--accent); font-size: 18px; line-height: 1; }
  .win-new button:active { background: #f6eef3; }

  /* 行动卡片：居中、没底色、只有点阴影。
     按钮元素要把浏览器默认那套按钮样式全抹掉，不然会出现系统底色 */
  .card { display: block; width: 100%; margin: 0 0 14px; padding: 2px 10px; border: none;
    background: none; text-align: center; font: inherit; color: var(--muted);
    -webkit-appearance: none; appearance: none; }
  .card-when { display: block; font-size: 11px; color: var(--place); opacity: 0.75;
    font-variant-numeric: tabular-nums; }
  .card-body { display: block; margin-top: 2px; font-size: 13px; line-height: 1.6;
    color: var(--muted); text-shadow: 0 1px 2px rgba(60, 30, 60, 0.1); }
  .card-more { display: inline-block; margin-top: 3px; font-size: 10px; color: var(--activity); }
  .card.tap { cursor: pointer; border-radius: 14px; }
  .card.tap:active { background: rgba(122, 62, 93, 0.05); }
  .card.tap:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* 详情：这一张有底色，边框用她定的那个暗黄 */
  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: flex-end;
    justify-content: center; padding: 16px; background: rgba(43, 34, 51, 0.32); }
  .sheet.on { display: flex; }
  .sheet-box { width: 100%; max-width: 560px; max-height: 76vh; overflow-y: auto;
    background: var(--card); border: 1px solid var(--activity); border-radius: 18px;
    padding: 16px 18px 18px; box-shadow: 0 12px 34px rgba(60, 30, 60, 0.24);
    animation: up 0.22s ease-out; }
  @keyframes up { from { transform: translateY(14px); opacity: 0; } to { transform: none; opacity: 1; } }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 10px; }
  .sheet-when { font-size: 12px; color: var(--place); }
  .sheet-x { border: none; background: none; font-size: 20px; line-height: 1; color: var(--muted);
    padding: 6px 4px; }
  .sheet-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--accent); }
  .sheet-body { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap;
    word-break: break-word; color: var(--ink); }

  /* 假输入框。点下去会说清楚还没接上，不装成能发 */
  .composer { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 80;
    display: flex; gap: 8px; width: calc(100% - 24px); max-width: 420px; padding: 6px;
    background: rgba(255, 253, 251, 0.94); backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 4px 16px rgba(60, 30, 60, 0.1); }
  .composer input { flex: 1; height: 38px; padding: 0 12px; border-radius: 14px;
    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink); }
  .composer button { width: 38px; height: 38px; border-radius: 14px; border: none;
    background: var(--accent); color: #fffdfb; font-size: 15px; }
  body.vp-has-tabs main { padding-bottom: calc(150px + env(safe-area-inset-bottom, 0px)) !important; }

  .empty { text-align: center; font-size: 13px; line-height: 1.7; color: var(--muted); margin: 32px 10px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  html[data-face="night"] .win, html[data-face="dusk"] .win,
  html[data-face="night"] .win-new button, html[data-face="dusk"] .win-new button,
  html[data-face="night"] .composer, html[data-face="dusk"] .composer,
  html[data-face="night"] .sheet-box, html[data-face="dusk"] .sheet-box {
    background: var(--card); border-color: var(--line); }
  html[data-face="night"] .composer input, html[data-face="dusk"] .composer input {
    background: rgba(255, 255, 255, 0.06); color: var(--ink); }
`;

const SCRIPT = `(function () {
  var sheet = document.querySelector('[data-sheet]');
  if (!sheet) return;
  var box = sheet.querySelector('[data-sheet-body]');
  var when = sheet.querySelector('[data-sheet-when]');

  function open(id, label) {
    var tpl = document.querySelector('template[data-for="' + id + '"]');
    if (!tpl) return;
    box.textContent = tpl.content ? tpl.content.textContent : tpl.textContent;
    when.textContent = label || '';
    sheet.classList.add('on');
    document.body.style.overflow = 'hidden';
  }
  function close() {
    sheet.classList.remove('on');
    document.body.style.overflow = '';
  }

  document.addEventListener('click', function (e) {
    var card = e.target.closest ? e.target.closest('.card.tap') : null;
    if (card) {
      var w = card.querySelector('.card-when');
      open(card.getAttribute('data-detail'), w ? w.textContent : '');
      return;
    }
    if (e.target.closest && e.target.closest('[data-sheet-x]')) { close(); return; }
    if (e.target === sheet) close();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });

  // 假输入框：别装成能发
  var form = document.querySelector('[data-fake]');
  if (form) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = form.querySelector('input');
      if (input) { input.value = ''; input.blur(); }
      var tip = document.querySelector('[data-tip]');
      if (!tip) return;
      tip.classList.add('on');
      setTimeout(function () { tip.classList.remove('on'); }, 2600);
    });
  }
})();`;

const TIP_CSS = `
  .tip { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(124px + env(safe-area-inset-bottom, 0px)); z-index: 96;
    max-width: calc(100% - 40px); padding: 9px 16px; border-radius: 999px;
    background: rgba(43, 34, 51, 0.9); color: #fffdfb; font-size: 12px; line-height: 1.5;
    opacity: 0; pointer-events: none; transition: opacity 0.22s ease; }
  .tip.on { opacity: 1; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u804a\u5929 \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${TIP_CSS}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script><script>${SCRIPT}</script></body>
</html>`;
}

export function registerChatRoutes(app, { requireBasicAuth }) {
  app.post(`${PREFIX}/new`, requireBasicAuth, (req, res) => {
    try {
      const id = newWindow();
      console.log(`chat: \u5f00\u4e86\u4e00\u4e2a\u65b0\u7a97 #${id}`);
      return res.redirect(302, `${PREFIX}?w=${id}`);
    } catch (err) {
      console.error('chat: \u5f00\u65b0\u7a97\u5931\u8d25', err.message);
      return res.redirect(302, PREFIX);
    }
  });

  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = Date.now();
      const list = ensureWindow();
      const want = Number(req.query.w);
      const cur = list.find((w) => w.id === want) || list[0];
      // 行动卡片只在最新那个窗口里（她定的）。老窗就是当时那一摹。
      const newest = list[0];
      const cards = cur.id === newest.id ? activityCards(now) : [];
      const isOld = cur.id !== newest.id;

      res.send(
        layout(`<header class="hero">
        <h1 class="title">\u804a\u5929</h1>
        <p class="subtitle" lang="en">Chat <span aria-hidden="true">\u2726</span> ${escapeHtml(AI_NAME)}</p>
      </header>
      ${renderWindowBar(list, cur.id)}
      ${
        isOld
          ? '<p class="empty">\u8fd9\u662f\u4e2a\u65e7\u7a97\u3002\u884c\u52a8\u5361\u7247\u53ea\u5f80\u6700\u65b0\u90a3\u4e2a\u7a97\u91cc\u6446\u3002</p>'
          : renderCards(cards)
      }
      <form class="composer" data-fake onsubmit="return false">
        <input type="text" placeholder="\u8bf4\u70b9\u4ec0\u4e48\u2026" aria-label="\u8f93\u5165" />
        <button type="submit" aria-label="\u53d1\u9001">\u2191</button>
      </form>
      <div class="tip" data-tip role="status">\u7f51\u9875\u8fd9\u8fb9\u7684\u804a\u5929\u8fd8\u6ca1\u63a5\u4e0a\uff0c\u5148\u53bb Aru \u91cc\u8bf4\u3002\u8fd9\u4e00\u9875\u73b0\u5728\u662f\u7ed9\u884c\u52a8\u5361\u7247\u7528\u7684\u3002</div>
      <div class="sheet" data-sheet role="dialog" aria-modal="true">
        <div class="sheet-box">
          <div class="sheet-head">
            <span class="sheet-when" data-sheet-when></span>
            <button type="button" class="sheet-x" data-sheet-x aria-label="\u5173\u95ed">\u00d7</button>
          </div>
          <h2 class="sheet-title">\u505a\u8fd9\u4ef6\u4e8b\u7684\u65f6\u5019</h2>
          <pre class="sheet-body" data-sheet-body></pre>
        </div>
      </div>`)
      );
    } catch (err) {
      console.error('chat page: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('<p class="empty">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>'));
    }
  });

  console.log(`chat: \u804a\u5929\u9875 ${PREFIX}\uff08\u5047\u8f93\u5165\u6846\uff0c\u884c\u52a8\u5361\u7247\u8fdb\u6700\u65b0\u7a97\uff09`);
  return { enabled: true };
}
