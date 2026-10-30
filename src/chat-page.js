// 聊天：两层。
//
// 小满 2026-10-30：「点击聊天是竖着列这的所有聊天窗，聊天窗名字可以改
//   再点进去就是具体聊天界面」
//
//   /chat      → 窗口列表（竖着排，每条带改名，顶上一个「开一个新窗」）
//   /chat/<id> → 那个窗的具体界面
//
// ── 真的和假的分清 ──
//
// **真的**：行动卡片。那是 moments 表里 kind='activity' 的行，他每次做事真在写。
// **假的**：输入框。现在没有「在网页上跟他聊」这条路——聊天在 Aru 里，
// 唤醒走 wake-bridge 投消息。要真通得接 relay 后端，那是另一套部署。
// 所以输入框点下去会说清楚「还没接上」，不装成能发。
//
// ── 行动卡片归哪个窗 ──
//
// 不归属任何窗，是「最新那个窗显示它们」——这样开新窗不用搬历史，
// 老窗就是当时那一摹。她 2026-10-30 定的。
//
// ── 卡片长相 ──
//
// 她要的是居中、没底色、只有点阴影。所以列表里的卡片是透的，
// 只给文字一层很淡的 text-shadow。点开的详情才是带底色的卡，
// 边框用她 09-30 定的那个暗黄 #E6B652。

import db from './state.js';
import { listMomentsBetween } from './moments-store.js';
import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { formatDateTime } from './wall-time.js';

const PREFIX = '/chat';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const LIMIT = 60;
const MAX_TITLE = 24;

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

function getWindow(id) {
  if (!Number.isInteger(id)) return null;
  return stmt('SELECT id, title, created_at FROM chat_windows WHERE id = ?').get(id) || null;
}

// 第一次进来没有窗口，建一个——不让列表空着
function ensureWindow() {
  const list = listWindows();
  if (list.length) return list;
  stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)').run(null, Date.now());
  return listWindows();
}

function newWindow() {
  return stmt('INSERT INTO chat_windows (title, created_at) VALUES (?, ?)').run(null, Date.now()).lastInsertRowid;
}

function renameWindow(id, title) {
  const t = String(title ?? '').trim().slice(0, MAX_TITLE);
  return stmt('UPDATE chat_windows SET title = ? WHERE id = ?').run(t || null, id).changes;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const titleOf = (w) => w.title || `${formatDateTime(w.created_at).slice(5, 16)} \u7684\u7a97`;

// 行动卡片的正文是「MM-DD HH:mm\n做了什么」两行（见 addActivityMoment）
function splitCard(raw) {
  const text = tidyActivityContent(raw);
  const nl = text.indexOf('\n');
  if (nl < 0) return { when: '', body: text.trim() };
  return { when: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
}

function activityCards(now) {
  const rows = listMomentsBetween(now - 7 * 86400000, now + 60000)
    .filter((m) => m.kind === 'activity')
    .slice(0, LIMIT);
  return rows.map((m) => {
    const { when, body } = splitCard(m.content);
    return { id: m.id, when, body, detail: tidyActivityDetail(m.detail) };
  });
}

// 最近一张卡片的摘要，摆在列表里当预览
function latestLine(now) {
  const cards = activityCards(now);
  if (!cards.length) return '';
  const c = cards[0];
  const chars = Array.from(c.body);
  const body = chars.length > 28 ? `${chars.slice(0, 28).join('')}\u2026` : c.body;
  return `${c.when}\u3000${body}`;
}

const LIST_STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; --activity: #E6B652; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .new { margin: 0 0 14px; }
  .new button { width: 100%; min-height: 46px; border-radius: 16px; border: 1px dashed var(--line);
    background: rgba(255, 253, 251, 0.7); color: var(--accent); font-size: 14px; }
  .new button:active { background: #f6eef3; }
  .win { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 13px 14px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); }
  .win-go { flex: 1; min-width: 0; color: inherit; text-decoration: none; }
  .win-go:active { opacity: 0.7; }
  .win-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .win-when { display: block; margin-top: 3px; font-size: 11px; color: #a597ab; }
  .win-last { display: block; margin-top: 5px; font-size: 12px; line-height: 1.5; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .win-tag { display: inline-block; margin-top: 5px; font-size: 10px; color: var(--gold);
    border: 1px solid var(--activity); border-radius: 999px; padding: 0 7px; }
  .win-edit { flex: none; width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--line);
    background: none; color: var(--muted); font-size: 15px; }
  .win-edit:active { background: #f6eef3; }
  .rename { display: none; gap: 6px; margin: 8px 0 0; }
  .rename.on { display: flex; }
  .rename input { flex: 1; min-width: 0; height: 38px; padding: 0 11px; border-radius: 12px;
    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink); }
  .rename button { flex: none; min-width: 52px; height: 38px; border-radius: 12px; border: none;
    background: var(--accent); color: #fffdfb; font-size: 13px; }
  .foot { margin: 20px 6px 0; font-size: 11px; line-height: 1.7; color: #a597ab; }
`;

const LIST_SCRIPT = `(function () {
  document.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('[data-edit]') : null;
    if (!btn) return;
    var box = document.querySelector('[data-rename="' + btn.getAttribute('data-edit') + '"]');
    if (!box) return;
    var on = box.classList.toggle('on');
    if (on) {
      var input = box.querySelector('input');
      if (input) { input.focus(); input.select(); }
    }
  });
})();`;

const ROOM_STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; --activity: #E6B652; --place: #9a6412; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 60px 16px 48px; }

  /* 顶条：窗的名字。返回键在左上角（tabs.js 负责插），所以这儿居中 */
  .room-top { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); left: 0; right: 0;
    z-index: 60; text-align: center; pointer-events: none; }
  .room-name { display: inline-block; max-width: 56%; padding: 8px 14px; border-radius: 999px;
    background: rgba(255, 253, 251, 0.94); backdrop-filter: blur(10px); border: 1px solid var(--line);
    font-size: 13px; font-weight: 600; color: var(--accent);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    box-shadow: 0 2px 10px rgba(60, 30, 60, 0.1); }

  /* 行动卡片：居中、没底色、只有点阴影。
     按钮元素要把浏览器默认那套按钮样式全抹掉 */
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

  /* 详情：这一张有底色 */
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

  /* 假输入框 */
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

  .tip { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(124px + env(safe-area-inset-bottom, 0px)); z-index: 96;
    max-width: calc(100% - 40px); padding: 9px 16px; border-radius: 999px;
    background: rgba(43, 34, 51, 0.9); color: #fffdfb; font-size: 12px; line-height: 1.5;
    opacity: 0; pointer-events: none; transition: opacity 0.22s ease; }
  .tip.on { opacity: 1; }

  .empty { text-align: center; font-size: 13px; line-height: 1.7; color: var(--muted); margin: 32px 10px; }
  html[data-face="night"] .room-name, html[data-face="dusk"] .room-name,
  html[data-face="night"] .composer, html[data-face="dusk"] .composer,
  html[data-face="night"] .sheet-box, html[data-face="dusk"] .sheet-box {
    background: var(--card); border-color: var(--line); }
  html[data-face="night"] .composer input, html[data-face="dusk"] .composer input {
    background: rgba(255, 255, 255, 0.06); color: var(--ink); }
`;

// 进来就停在最新那条（她 10-30 提的）。滚三次：立刻、load 后、120ms 后——
// 字体加载完和 fixed 元素入场都会推一把布局。不用 smooth：那样先看见几天前的再晃到底。
const ROOM_SCRIPT = `(function () {
  function toBottom() {
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}
  }
  toBottom();
  window.addEventListener('load', toBottom);
  setTimeout(toBottom, 120);

  var sheet = document.querySelector('[data-sheet]');
  if (sheet) {
    var box = sheet.querySelector('[data-sheet-body]');
    var when = sheet.querySelector('[data-sheet-when]');
    var open = function (id, label) {
      var tpl = document.querySelector('template[data-for="' + id + '"]');
      if (!tpl) return;
      box.textContent = tpl.content ? tpl.content.textContent : tpl.textContent;
      when.textContent = label || '';
      sheet.classList.add('on');
      document.body.style.overflow = 'hidden';
    };
    var close = function () {
      sheet.classList.remove('on');
      document.body.style.overflow = '';
    };
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
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
  }

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

function layout(title, style, body, script) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${style}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script><script>${script}</script></body>
</html>`;
}

function renderList(list, now) {
  const newest = list[0];
  const last = latestLine(now);
  const items = list
    .map((w) => {
      const isNewest = newest && w.id === newest.id;
      return `<div class="win">
      <a class="win-go" href="${PREFIX}/${w.id}">
        <span class="win-name">${escapeHtml(titleOf(w))}</span>
        <span class="win-when">${escapeHtml(formatDateTime(w.created_at).slice(5, 16))} \u5f00\u7684</span>
        ${
          isNewest
            ? `${last ? `<span class="win-last">${escapeHtml(last)}</span>` : ''}` +
              `<span class="win-tag">\u884c\u52a8\u5361\u7247\u5728\u8fd9\u91cc</span>`
            : ''
        }
      </a>
      <button type="button" class="win-edit" data-edit="${w.id}"
        aria-label="\u6539\u540d\u5b57">\u270e</button>
      <form class="rename" data-rename="${w.id}" method="POST" action="${PREFIX}/${w.id}/rename">
        <input type="text" name="title" value="${escapeHtml(w.title || '')}"
          placeholder="\u7ed9\u8fd9\u4e2a\u7a97\u8d77\u4e2a\u540d\u5b57" maxlength="${MAX_TITLE}" />
        <button type="submit">\u5b58</button>
      </form>
    </div>`;
    })
    .join('');
  return `<form class="new" method="POST" action="${PREFIX}/new">
    <button type="submit">\uff0b \u5f00\u4e00\u4e2a\u65b0\u7a97</button>
  </form>
  ${items}
  <p class="foot">\u884c\u52a8\u5361\u7247\u53ea\u5f80\u6700\u65b0\u90a3\u4e2a\u7a97\u91cc\u6446\uff0c\u8001\u7a97\u5c31\u662f\u5f53\u65f6\u90a3\u4e00\u6479\u3002</p>`;
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

export function registerChatRoutes(app, { requireBasicAuth }) {
  // 表单用 urlencoded，挂在这几条路由自己身上，不动全局
  const form = (req, res, next) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return next();
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) req.destroy();
    });
    req.on('end', () => {
      const out = {};
      for (const pair of raw.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
        const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        out[k] = v;
      }
      req.body = out;
      next();
    });
    req.on('error', () => next());
  };

  app.post(`${PREFIX}/new`, requireBasicAuth, (req, res) => {
    try {
      const id = newWindow();
      console.log(`chat: \u5f00\u4e86\u4e00\u4e2a\u65b0\u7a97 #${id}`);
      return res.redirect(302, `${PREFIX}/${id}`);
    } catch (err) {
      console.error('chat: \u5f00\u65b0\u7a97\u5931\u8d25', err.message);
      return res.redirect(302, PREFIX);
    }
  });

  app.post(`${PREFIX}/:id/rename`, requireBasicAuth, form, (req, res) => {
    const id = Number(req.params.id);
    try {
      if (Number.isInteger(id)) renameWindow(id, req.body?.title);
    } catch (err) {
      console.error('chat: \u6539\u540d\u5931\u8d25', err.message);
    }
    return res.redirect(302, PREFIX);
  });

  // 具体窗。放在列表路由前面，否则 /chat/12 会被列表那条接走
  app.get(`${PREFIX}/:id(\\d+)`, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = Date.now();
      const w = getWindow(Number(req.params.id));
      if (!w) return res.redirect(302, PREFIX);
      const list = listWindows();
      const isNewest = list.length && list[0].id === w.id;
      const cards = isNewest ? activityCards(now) : [];

      res.send(
        layout(
          `${titleOf(w)} \u00b7 \u6668\u66ae\u661f`,
          ROOM_STYLE,
          `<div class="room-top"><span class="room-name">${escapeHtml(titleOf(w))}</span></div>
      ${
        isNewest
          ? renderCards(cards)
          : '<p class="empty">\u8fd9\u662f\u4e2a\u65e7\u7a97\u3002\u884c\u52a8\u5361\u7247\u53ea\u5f80\u6700\u65b0\u90a3\u4e2a\u7a97\u91cc\u6446\u3002</p>'
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
      </div>`,
          ROOM_SCRIPT
        )
      );
    } catch (err) {
      console.error('chat room: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('\u51fa\u9519\u4e86', ROOM_STYLE, '<p class="empty">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>', ''));
    }
  });

  // 窗口列表
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = Date.now();
      const list = ensureWindow();
      res.send(layout('\u804a\u5929 \u00b7 \u6668\u66ae\u661f', LIST_STYLE, renderList(list, now), LIST_SCRIPT));
    } catch (err) {
      console.error('chat list: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('\u51fa\u9519\u4e86', LIST_STYLE, '<p class="foot">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>', ''));
    }
  });

  console.log(`chat: \u804a\u5929\u4e24\u5c42\uff08${PREFIX} \u5217\u8868\uff0c${PREFIX}/<id> \u5177\u4f53\u7a97\uff09`);
  return { enabled: true };
}
