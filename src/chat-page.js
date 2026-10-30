// 聊天：两层。
//
// 小满 2026-10-30：「点击聊天是竖着列这的所有聊天窗，聊天窗名字可以改
//   再点进去就是具体聊天界面」
//
//   /chat      → 窗口列表（竖着排，每条带改名，顶上一个「开一个新窗」）
//   /chat/<id> → 那个窗的具体界面
//
// ── 聊天真的通了 ──
//
// 输入框不再是假的。后端是 Tidal_Echo 的 relay（见 echo-relay.js、chat-queue.js）：
// 发出去的话先落本地队列，不立刻惊动他。两条出口：
//   点「让他读」 → 按顺序递给 relay，他当场回
//   不点         → 他下次唤醒自己读（见 gateway.js）
// 小满 10-30：「可以发完再点一次让允朔读。也可以发完不点，在允朔下一次
// 唤醒的时候读取并回复。」
//
// 密钥不进浏览器：前端只打 /chat/api/*，走晨暮星自己的登录。
//
// ── 行动卡片归哪个窗 ──
//
// 不归属任何窗，是「最新那个窗显示它们」——这样开新窗不用搬历史，
// 老窗就是当时那一摹。她 2026-10-30 定的。
//
// ── 长相 ──
//
// 行动卡片：居中、没底色、只有点阴影。点开的详情才是带底色的卡，
// 边框用她 09-30 定的那个暗黄 #E6B652。
//
// 说过的话：逐句气泡，每句左边都有头像、只有第一句上面有名字，
// 时间只跟在最后一个气泡旁边——他的在右，我的在左。头像和名字用动态页
// 那同一份（moments-store.js 的 getProfile），不另开一套。
//
// 思考链默认收着，点了才展开（和 Aru 那边一样）。

import db from './state.js';
import { listMomentsBetween, getProfile } from './moments-store.js';
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

const titleOf = (w) => w.title || `${formatDateTime(w.created_at).slice(5, 16)} 的窗`;

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
  const body = chars.length > 28 ? `${chars.slice(0, 28).join('')}…` : c.body;
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

  /* 说过的话。一组 = 一次张口，里面按句子拆成几个气泡：
     每句左边都有头像（第二句起隐形占位，所以缩进对齐），
     名字只在第一句上面出一次，时间只跟在最后一个气泡旁边 */
  .grp { margin: 0 0 12px; }
  .ln { display: flex; align-items: flex-end; gap: 7px; margin-bottom: 3px; }
  .grp.me .ln { flex-direction: row-reverse; }
  .av { flex: none; width: 30px; height: 30px; border-radius: 50%; overflow: hidden;
    background: var(--card); border: 1px solid var(--line); display: flex;
    align-items: center; justify-content: center; font-size: 12px; color: var(--accent); }
  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av.ghost { visibility: hidden; }
  .who { margin: 0 0 3px 37px; font-size: 11px; color: var(--muted); }
  .grp.me .who { margin: 0 37px 3px 0; text-align: right; }
  .bub { max-width: 70%; padding: 8px 12px; border-radius: 15px; font-size: 14px;
    line-height: 1.65; white-space: pre-wrap; word-break: break-word;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .grp.me .bub { background: var(--accent); color: #fffdfb; border-bottom-right-radius: 5px; }
  .grp.ta .bub { background: var(--card); color: var(--ink); border: 1px solid var(--line);
    border-bottom-left-radius: 5px; }
  .bub.draft { opacity: 0.72; }
  .at { flex: none; font-size: 10px; color: #a597ab; font-variant-numeric: tabular-nums;
    padding-bottom: 2px; }

  /* 攒着还没递出去的：气泡半透，旁边一个小叉可以收回 */
  .grp.wait .bub { opacity: 0.55; }
  .undo { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line);
    background: var(--card); color: var(--muted); font-size: 12px; line-height: 1; padding: 0; }

  /* 思考链：默认只一条，点了才展开 */
  .think { margin: 0 0 8px 37px; }
  .think-top { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;
    background: none; border: 1px solid var(--line); border-radius: 999px;
    font: inherit; font-size: 11px; color: var(--muted); }
  .think-top:active { background: rgba(122, 62, 93, 0.05); }
  .think-caret { font-size: 9px; transition: transform 0.15s; }
  .think.on .think-caret { transform: rotate(90deg); }
  .think-body { display: none; margin: 6px 0 0; padding: 9px 12px; border-radius: 12px;
    background: rgba(122, 62, 93, 0.04); border: 1px dashed var(--line);
    font-size: 12px; line-height: 1.7; color: var(--muted);
    white-space: pre-wrap; word-break: break-word; }
  .think.on .think-body { display: block; }

  .msg-act { margin: 0 0 10px; text-align: center; font-size: 11px; color: var(--activity); }
  .typing { margin: 0 0 10px 37px; font-size: 12px; color: var(--muted); }

  /* 详情：这一张有底色。居中，底下留出输入框和标签栏的高度 */
  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: center;
    justify-content: center; padding: 16px 16px calc(96px + env(safe-area-inset-bottom, 0px));
    background: rgba(43, 34, 51, 0.32); }
  .sheet.on { display: flex; }
  .sheet-box { width: 100%; max-width: 560px; max-height: 68vh; overflow-y: auto;
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

  /* 输入框 */
  .composer { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(72px + env(safe-area-inset-bottom, 0px)); z-index: 80;
    display: flex; gap: 8px; width: calc(100% - 24px); max-width: 420px; padding: 6px;
    background: rgba(255, 253, 251, 0.94); backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: 20px; box-shadow: 0 4px 16px rgba(60, 30, 60, 0.1); }
  .composer input { flex: 1; height: 38px; padding: 0 12px; border-radius: 14px;
    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink); }
  .composer button { width: 38px; height: 38px; border-radius: 14px; border: none;
    background: var(--accent); color: #fffdfb; font-size: 15px; }
  body.vp-has-tabs main { padding-bottom: calc(190px + env(safe-area-inset-bottom, 0px)) !important; }

  /* 「让他读」：攒着话的时候才冒出来，浮在输入框上方 */
  .nudge { position: fixed; left: 50%; transform: translateX(-50%); z-index: 81;
    bottom: calc(118px + env(safe-area-inset-bottom, 0px)); display: none;
    align-items: center; gap: 6px; min-height: 34px; padding: 0 15px;
    background: var(--accent); color: #fffdfb; border: none; border-radius: 999px;
    font-size: 12px; box-shadow: 0 3px 12px rgba(60, 30, 60, 0.22); }
  .nudge.on { display: inline-flex; }
  .nudge:disabled { opacity: 0.6; }

  .tip { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(160px + env(safe-area-inset-bottom, 0px)); z-index: 96;
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
//
// 注：这整段是模板字符串，里面不能出现 ${ —— 会被当成插值。
// 所以字符串拼接一律用 +。
const ROOM_SCRIPT = `(function () {
  function toBottom() {
    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}
  }
  toBottom();
  window.addEventListener('load', toBottom);
  setTimeout(toBottom, 120);

  // 行动卡片的详情
  var sheet = document.querySelector('[data-sheet]');
  if (sheet) {
    var sbox = sheet.querySelector('[data-sheet-body]');
    var swhen = sheet.querySelector('[data-sheet-when]');
    var openSheet = function (id, label) {
      var tpl = document.querySelector('template[data-for="' + id + '"]');
      if (!tpl) return;
      sbox.textContent = tpl.content ? tpl.content.textContent : tpl.textContent;
      swhen.textContent = label || '';
      sheet.classList.add('on');
      document.body.style.overflow = 'hidden';
    };
    var closeSheet = function () {
      sheet.classList.remove('on');
      document.body.style.overflow = '';
    };
    document.addEventListener('click', function (e) {
      var card = e.target.closest ? e.target.closest('.card.tap') : null;
      if (card) {
        var w = card.querySelector('.card-when');
        openSheet(card.getAttribute('data-detail'), w ? w.textContent : '');
        return;
      }
      if (e.target.closest && e.target.closest('[data-sheet-x]')) { closeSheet(); return; }
      if (e.target === sheet) closeSheet();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
  }

  // ── 聊天 ──
  var stream = document.querySelector('[data-stream]');
  var tipEl = document.querySelector('[data-tip]');
  var nudge = document.querySelector('[data-nudge]');
  var nudgeN = document.querySelector('[data-nudge-n]');
  if (!stream) return;

  function attr(k, d) {
    var v = stream.getAttribute(k);
    return v ? v : d;
  }
  var who = {
    ai: { name: attr('data-ta-name', 'TA'), av: attr('data-ta-av', '') },
    human: { name: attr('data-me-name', '我'), av: attr('data-me-av', '') }
  };

  function toast(text) {
    if (!tipEl) return;
    tipEl.textContent = text;
    tipEl.classList.add('on');
    setTimeout(function () { tipEl.classList.remove('on'); }, 2800);
  }

  function hhmm(ts) {
    var d = ts ? new Date(ts) : new Date();
    var h = d.getHours(), m = d.getMinutes();
    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
  }

  // 逐句：句读点和换行都算一句。标点留在句尾，后面跟的引号、来号也跟着走。
  function sentences(text) {
    var s = String(text == null ? '' : text).trim();
    if (!s) return [];
    var out = [];
    var buf = '';
    var stop = '。！？!?…';
    var tail = '”’）)」』。！？!?…';
    for (var i = 0; i < s.length; i++) {
      var c = s.charAt(i);
      if (c === '\\n') {
        if (buf.trim()) out.push(buf.trim());
        buf = '';
        continue;
      }
      buf += c;
      if (stop.indexOf(c) >= 0) {
        while (i + 1 < s.length && tail.indexOf(s.charAt(i + 1)) >= 0) { buf += s.charAt(++i); }
        if (buf.trim()) out.push(buf.trim());
        buf = '';
      }
    }
    if (buf.trim()) out.push(buf.trim());
    return out.length ? out : [s];
  }

  var typingEl = null;
  function setTyping(on) {
    if (on && !typingEl) {
      typingEl = document.createElement('div');
      typingEl.className = 'typing';
      typingEl.textContent = who.ai.name + ' 正在说…';
      stream.appendChild(typingEl);
      toBottom();
    } else if (!on && typingEl) {
      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
      typingEl = null;
    }
  }

  function put(el) {
    if (typingEl) stream.insertBefore(el, typingEl);
    else stream.appendChild(el);
    toBottom();
  }

  function avatar(side, ghost) {
    var el = document.createElement('div');
    el.className = 'av' + (ghost ? ' ghost' : '');
    var info = who[side] || who.ai;
    if (info.av) {
      var img = document.createElement('img');
      img.src = info.av;
      img.alt = '';
      el.appendChild(img);
    } else {
      el.textContent = (info.name || '?').slice(0, 1);
    }
    return el;
  }

  function undoBtn(pid) {
    var x = document.createElement('button');
    x.type = 'button';
    x.className = 'undo';
    x.setAttribute('data-drop', pid);
    x.setAttribute('aria-label', '收回这条');
    x.textContent = '\\u00d7';
    return x;
  }

  // 一组话。side 是 human 或 ai。返回最后一个气泡元素（流式草稿要接着往里写）。
  function group(side, text, ts, opts) {
    opts = opts || {};
    var lines = opts.draft ? [text] : sentences(text);
    if (!lines.length) return null;
    var g = document.createElement('div');
    g.className = 'grp ' + (side === 'human' ? 'me' : 'ta') + (opts.wait ? ' wait' : '');

    var nm = document.createElement('div');
    nm.className = 'who';
    nm.textContent = (who[side] || who.ai).name;
    g.appendChild(nm);

    var last = null;
    for (var i = 0; i < lines.length; i++) {
      var ln = document.createElement('div');
      ln.className = 'ln';
      ln.appendChild(avatar(side, i > 0));
      var b = document.createElement('div');
      b.className = 'bub' + (opts.draft ? ' draft' : '');
      b.textContent = lines[i];
      ln.appendChild(b);
      // 时间只跟在最后一个气泡旁边。flex-direction 已经把我这边翻过来了，
      // 所以同样 append 就是他的在右、我的在左。
      if (i === lines.length - 1) {
        var at = document.createElement('span');
        at.className = 'at';
        at.textContent = hhmm(ts);
        ln.appendChild(at);
        if (opts.wait && opts.pid) ln.appendChild(undoBtn(opts.pid));
      }
      g.appendChild(ln);
      last = b;
    }
    put(g);
    return last;
  }

  function thinking(text) {
    var box = document.createElement('div');
    box.className = 'think';
    var top = document.createElement('button');
    top.type = 'button';
    top.className = 'think-top';
    top.setAttribute('data-think', '1');
    var caret = document.createElement('span');
    caret.className = 'think-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '\\u25b6';
    var label = document.createElement('span');
    label.textContent = '想了想';
    top.appendChild(caret);
    top.appendChild(label);
    var body = document.createElement('div');
    body.className = 'think-body';
    body.textContent = text;
    box.appendChild(top);
    box.appendChild(body);
    put(box);
  }

  var seen = {};
  var drafts = {};
  var mine = [];

  function add(m) {
    if (!m) return;
    if (m.id != null) {
      if (seen[m.id]) return;
      seen[m.id] = 1;
    }
    var kind = m.kind || 'reply';
    if (kind === 'act') {
      var a = document.createElement('div');
      a.className = 'msg-act';
      a.textContent = m.text || '';
      put(a);
      return;
    }
    if (kind === 'thinking') { thinking(m.text || ''); return; }
    // 自己刚发的那条：递出去之后 SSE 会把它原样推回来。
    // 认领本地已经画好的，别让同一句话出现两遍。
    if (m.from === 'human') {
      for (var i = 0; i < mine.length; i++) {
        if (mine[i] === (m.text || '')) {
          mine.splice(i, 1);
          return;
        }
      }
    }
    group(m.from === 'human' ? 'human' : 'ai', m.text || '', m.ts);
  }

  function onFrame(d) {
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ping' || d.type === 'reaction') return;
    if (d.type === 'typing') { setTyping(!!d.active); return; }
    if (d.type === 'reply_delta') {
      var sid = d.stream_id || 'one';
      var b = drafts[sid];
      if (!b) {
        b = group('ai', '', Date.now(), { draft: true });
        if (!b) return;
        drafts[sid] = b;
      }
      if (d.done) {
        // 收尾时把草稿整组换成逐句的正式气泡
        var text = d.final_text || b.textContent || '';
        var g = b.closest ? b.closest('.grp') : null;
        if (g && g.parentNode) g.parentNode.removeChild(g);
        delete drafts[sid];
        setTyping(false);
        if (text.trim()) group('ai', text, Date.now());
      } else if (typeof d.text === 'string') {
        // text 可能是累计的也可能是增量的，两种都兜着
        var cur = b.textContent || '';
        b.textContent = d.text.indexOf(cur) === 0 ? d.text : cur + d.text;
        toBottom();
      }
      return;
    }
    if (d.type) return;
    add(d);
  }

  function showNudge(n) {
    if (!nudge) return;
    if (n > 0) nudge.classList.add('on');
    else nudge.classList.remove('on');
    if (nudgeN) nudgeN.textContent = n > 0 ? '(' + n + ')' : '';
  }

  fetch('/chat/api/history?limit=60', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (d) {
        var list = d.messages || [];
        for (var i = 0; i < list.length; i++) add(list[i]);
      }
      // 攒着还没递出去的接在最后，刷页之后也还在
      return fetch('/chat/api/pending', { credentials: 'same-origin' });
    })
    .then(function (r) { return r && r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d) return;
      var list = d.pending || [];
      for (var i = 0; i < list.length; i++) {
        group('human', list[i].text, list[i].created_at, { wait: true, pid: list[i].id });
      }
      showNudge(list.length);
      toBottom();
    })
    .catch(function () {});

  try {
    var es = new EventSource('/chat/api/stream');
    es.onmessage = function (e) {
      if (!e.data) return;
      try { onFrame(JSON.parse(e.data)); } catch (err) {}
    };
    es.onerror = function () { setTyping(false); };
  } catch (err) {}

  // 点思考链展开 / 收回攒着的那条
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var th = e.target.closest('[data-think]');
    if (th) { th.parentNode.classList.toggle('on'); return; }
    var dp = e.target.closest('[data-drop]');
    if (!dp) return;
    fetch('/chat/api/pending/' + dp.getAttribute('data-drop') + '/drop',
      { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.dropped) return;
        var g = dp.closest('.grp');
        if (g && g.parentNode) g.parentNode.removeChild(g);
        showNudge(d.pending);
      })
      .catch(function () {});
  });

  var sendForm = document.querySelector('[data-send]');
  if (sendForm) {
    sendForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = sendForm.querySelector('input');
      var text = input ? String(input.value || '').trim() : '';
      if (!text) return;
      if (input) input.value = '';
      // 先在本地画出来，不等往返——打字发出去该立刻看见。
      // 半透是「还没递给他」，递出去之后才变实。
      var ph = group('human', text, Date.now(), { wait: true });
      fetch('/chat/api/send', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text })
      })
        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
        .then(function (d) {
          showNudge(d.pending);
          var g = ph && ph.closest ? ph.closest('.grp') : null;
          if (!g || !d.id) return;
          var lns = g.querySelectorAll('.ln');
          if (lns.length) lns[lns.length - 1].appendChild(undoBtn(d.id));
        })
        .catch(function (err) { toast('没存下：' + err.message); });
    });
  }

  // 点「让他读」：把攒着的按顺序递出去。不点就等他下次醒来自己读。
  if (nudge) {
    nudge.addEventListener('click', function () {
      nudge.disabled = true;
      fetch('/chat/api/flush', { method: 'POST', credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          nudge.disabled = false;
          if (!d) return;
          showNudge(d.remaining);
          if (d.error) { toast('没递出去：' + d.error); return; }
          // 递出去了，那几条不再是半透的
          var waiting = stream.querySelectorAll('.grp.wait');
          for (var i = 0; i < waiting.length; i++) {
            waiting[i].classList.remove('wait');
            var x = waiting[i].querySelector('[data-drop]');
            if (x && x.parentNode) x.parentNode.removeChild(x);
            var txt = waiting[i].querySelector('.bub');
            if (txt) mine.push(txt.textContent);
          }
          if (d.sent) setTyping(true);
        })
        .catch(function (err) { nudge.disabled = false; toast('没递出去：' + err.message); });
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
        <span class="win-when">${escapeHtml(formatDateTime(w.created_at).slice(5, 16))} 开的</span>
        ${
          isNewest
            ? `${last ? `<span class="win-last">${escapeHtml(last)}</span>` : ''}` +
              `<span class="win-tag">行动卡片在这里</span>`
            : ''
        }
      </a>
      <button type="button" class="win-edit" data-edit="${w.id}"
        aria-label="改名字">✎</button>
      <form class="rename" data-rename="${w.id}" method="POST" action="${PREFIX}/${w.id}/rename">
        <input type="text" name="title" value="${escapeHtml(w.title || '')}"
          placeholder="给这个窗起个名字" maxlength="${MAX_TITLE}" />
        <button type="submit">存</button>
      </form>
    </div>`;
    })
    .join('');
  return `<form class="new" method="POST" action="${PREFIX}/new">
    <button type="submit">＋ 开一个新窗</button>
  </form>
  ${items}
  <p class="foot">行动卡片只往最新那个窗里摆，老窗就是当时那一摹。</p>`;
}

function renderCards(cards) {
  if (!cards.length) return '';
  // 旧的在上、新的在下，和聊天一样从上往下读
  return cards
    .slice()
    .reverse()
    .map((c) => {
      const has = Boolean(c.detail);
      const inner =
        `<span class="card-when">${escapeHtml(c.when)}</span>` +
        `<span class="card-body">${escapeHtml(c.body)}</span>` +
        (has ? '<span class="card-more" aria-hidden="true">✦</span>' : '');
      if (!has) return `<div class="card">${inner}</div>`;
      return (
        `<button type="button" class="card tap" data-detail="${c.id}"` +
        ` aria-label="${escapeHtml(c.body)}，点开看详情">${inner}</button>` +
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
      console.log(`chat: 开了一个新窗 #${id}`);
      return res.redirect(302, `${PREFIX}/${id}`);
    } catch (err) {
      console.error('chat: 开新窗失败', err.message);
      return res.redirect(302, PREFIX);
    }
  });

  app.post(`${PREFIX}/:id/rename`, requireBasicAuth, form, (req, res) => {
    const id = Number(req.params.id);
    try {
      if (Number.isInteger(id)) renameWindow(id, req.body?.title);
    } catch (err) {
      console.error('chat: 改名失败', err.message);
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
      // 头像和名字用动态页那同一份，不另开一套
      const ta = getProfile('assistant');
      const me = getProfile('user');

      res.send(
        layout(
          `${titleOf(w)} · 晨暮星`,
          ROOM_STYLE,
          `<div class="room-top"><span class="room-name">${escapeHtml(titleOf(w))}</span></div>
      ${isNewest ? renderCards(cards) : ''}
      <div class="stream" data-stream
        data-ta-name="${escapeHtml(ta.name)}" data-ta-av="${escapeHtml(ta.avatarUrl || '')}"
        data-me-name="${escapeHtml(me.name)}" data-me-av="${escapeHtml(me.avatarUrl || '')}"></div>
      ${
        isNewest
          ? ''
          : '<p class="empty">这是个旧窗。行动卡片只往最新那个窗里摆。</p>'
      }
      <button type="button" class="nudge" data-nudge>↑ 让${escapeHtml(ta.name)}读 <span data-nudge-n></span></button>
      <form class="composer" data-send onsubmit="return false">
        <input type="text" placeholder="说点什么…" aria-label="输入" />
        <button type="submit" aria-label="发送">↑</button>
      </form>
      <div class="tip" data-tip role="status"></div>
      <div class="sheet" data-sheet role="dialog" aria-modal="true">
        <div class="sheet-box">
          <div class="sheet-head">
            <span class="sheet-when" data-sheet-when></span>
            <button type="button" class="sheet-x" data-sheet-x aria-label="关闭">×</button>
          </div>
          <h2 class="sheet-title">做这件事的时候</h2>
          <pre class="sheet-body" data-sheet-body></pre>
        </div>
      </div>`,
          ROOM_SCRIPT
        )
      );
    } catch (err) {
      console.error('chat room: 渲染失败', err);
      res.status(500).send(layout('出错了', ROOM_STYLE, '<p class="empty">这一页出错了。</p>', ''));
    }
  });

  // 窗口列表
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = Date.now();
      const list = ensureWindow();
      res.send(layout('聊天 · 晨暮星', LIST_STYLE, renderList(list, now), LIST_SCRIPT));
    } catch (err) {
      console.error('chat list: 渲染失败', err);
      res.status(500).send(layout('出错了', LIST_STYLE, '<p class="foot">这一页出错了。</p>', ''));
    }
  });

  console.log(`chat: 聊天两层（${PREFIX} 列表，${PREFIX}/<id> 具体窗），发出去先攒着`);
  return { enabled: true };
}
