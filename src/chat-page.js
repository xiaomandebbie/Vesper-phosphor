// 聊天：两层。
//
//   /chat      → 窗口列表（竖着排，每条带改名，顶上一个「开一个新窗」）
//   /chat/<id> → 那个窗的具体界面
//
// ── 这个文件为什么是整个重写的 ──
//
// 2026-10-30 这一天它被七个脚本轮流改过，原文早就对不上了：.nudge 那段叠成
// 两遍，var(--accent) 被灰度脚本吃成 `* 0 0`，最后一个脚本的「是否已改过」
// 判据用了 data-go，而同一个脚本上一步刚把 data-go 写进 JS 里，于是
// 输入框那一处被判成「已经改好」跳过了——两个按钮一个没动，JS 却在找
// 一个不存在的按钮。打补丁到这儿为止，整段重写。
//
// ── 聊天真的通了 ──
//
// 后端是 Tidal_Echo 的 relay（见 echo-relay.js、chat-queue.js）。
// 发出去的话先落本地队列，不立刻惊动他。两条出口：
//   点发送键（输入框空着）→ 按顺序递给 relay，他当场回
//   不点                  → 他下次唤醒自己读（见 gateway.js 的 injectPendingChat）
// 小满 10-30：「在输入的时候点发送键是发送。消息空的时候点发送键是让允朔回复。
// 唤醒的时候他可以读取到我只发送未让他回复的消息。」
//
// 所以发送和「让他回复」是同一个按钮，不是两个——两个挤在一起才是之前
// 老点错的根。
//
// 密钥不进浏览器：前端只打 /chat/api/*，走晨暮星自己的登录。
//
// ── 行动卡片 ──
//
// 和消息按时间混排（小满 10-30）。所以卡片不能服务端直接写成 HTML——
// 那样它们永远在最上面。现在当数据发下来，和历史消息、攒着的话一起
// 按时间戳排好再画。
//
// ── 时间戳的坑 ──
//
// relay 那边的 ts 和我们自己的 Date.now() 不一定同一个单位。秒和毫秒
// 混在一起排序，整批消息会被甩到几十年前，表现出来就是「消息不见了」。
// 所以统一过一道 normTs：小于 1e12 的当秒处理。

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
    return { id: m.id, ts: m.ts, when, body, detail: tidyActivityDetail(m.detail) };
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
  :root { --ink: #1a1a1a; --muted: #7a7a7a; --card: #ffffff; --line: #e4e4e4; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .new { margin: 0 0 14px; }
  .new button { width: 100%; min-height: 46px; border-radius: 16px; border: 1px dashed var(--line);
    background: rgba(255, 255, 255, 0.7); color: var(--ink); font-size: 14px; }
  .new button:active { background: #f2f2f2; }
  .win { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 13px 14px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
  .win-go { flex: 1; min-width: 0; color: inherit; text-decoration: none; }
  .win-go:active { opacity: 0.7; }
  .win-name { display: block; font-size: 15px; font-weight: 600; color: var(--ink); }
  .win-when { display: block; margin-top: 3px; font-size: 11px; color: #a0a0a0; }
  .win-last { display: block; margin-top: 5px; font-size: 12px; line-height: 1.5; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .win-tag { display: inline-block; margin-top: 5px; font-size: 10px; color: var(--muted);
    border: 1px solid var(--line); border-radius: 999px; padding: 0 7px; }
  .win-edit { flex: none; width: 38px; height: 38px; border-radius: 12px; border: 1px solid var(--line);
    background: none; color: var(--muted); font-size: 15px; }
  .win-edit:active { background: #f2f2f2; }
  .rename { display: none; gap: 6px; margin: 8px 0 0; }
  .rename.on { display: flex; }
  .rename input { flex: 1; min-width: 0; height: 38px; padding: 0 11px; border-radius: 12px;
    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink); }
  .rename button { flex: none; min-width: 52px; height: 38px; border-radius: 12px; border: none;
    background: #1a1a1a; color: #fdfdfd; font-size: 13px; }
  .foot { margin: 20px 6px 0; font-size: 11px; line-height: 1.7; color: #a0a0a0; }
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
  :root { --ink: #1a1a1a; --muted: #7a7a7a; --card: #ffffff; --line: #e4e4e4; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto;
    padding: 60px 16px 220px; }

  /* 顶条：窗的名字。返回键在左上角（tabs.js 负责插），所以这儿居中 */
  .room-top { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); left: 0; right: 0;
    z-index: 60; text-align: center; pointer-events: none; }
  .room-name { display: inline-block; max-width: 56%; padding: 8px 14px; border-radius: 999px;
    background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(10px); border: 1px solid var(--line);
    font-size: 13px; font-weight: 600; color: var(--ink);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06); }

  /* 行动卡片：居中、没底色。和消息按时间混在一起排 */
  .card { display: block; width: 100%; margin: 14px 0; padding: 2px 10px; border: none;
    background: none; text-align: center; font: inherit; color: var(--muted);
    -webkit-appearance: none; appearance: none; }
  .card-when { display: block; font-size: 11px; color: #9a9a9a; font-variant-numeric: tabular-nums; }
  .card-body { display: block; margin-top: 3px; font-size: 13px; line-height: 1.6; color: var(--muted); }
  .card-more { display: inline-block; margin-top: 3px; font-size: 10px; color: #b8b8b8; }
  .card.tap { cursor: pointer; border-radius: 14px; }
  .card.tap:active { background: rgba(0, 0, 0, 0.04); }

  /* 说过的话。一组 = 一次张口，里面按句子拆成几个气泡：
     每句左边都有头像（第二句起隐形占位，所以缩进对齐），
     名字只在第一句上面出一次，时间只跟在最后一个气泡旁边 */
  .grp { margin: 0 0 18px; }
  .ln { display: flex; align-items: flex-end; gap: 9px; margin-bottom: 6px; }
  .grp.me .ln { flex-direction: row-reverse; }
  .av { flex: none; width: 38px; height: 38px; border-radius: 50%; overflow: hidden;
    background: #f0f0f0; border: 1px solid var(--line); display: flex;
    align-items: center; justify-content: center; font-size: 14px; color: var(--ink); }
  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .av.ghost { visibility: hidden; }
  .who { margin: 0 0 5px 47px; font-size: 11px; color: var(--muted); }
  .grp.me .who { margin: 0 47px 5px 0; text-align: right; }
  .bub { max-width: 72%; padding: 11px 15px; border-radius: 18px; font-size: 15px;
    line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .grp.me .bub { background: #1a1a1a; color: #fdfdfd; border-bottom-right-radius: 6px; }
  .grp.ta .bub { background: #f0f0f0; color: var(--ink); border-bottom-left-radius: 6px; }
  .bub.draft { opacity: 0.72; }

  /* 时间和已读/未读：只跟在最后一个气泡旁边。
     flex-direction 已经把我这边翻过来了，所以同样 append 就是他的在右、我的在左 */
  .meta { flex: none; display: flex; flex-direction: column; align-items: flex-end;
    gap: 2px; padding-bottom: 3px; }
  .grp.me .meta { align-items: flex-start; }
  .at { font-size: 10px; color: #a0a0a0; font-variant-numeric: tabular-nums; }
  .seen { font-size: 10px; color: #b0b0b0; }
  .seen.unread { color: #6a6a6a; }

  /* 攒着还没递出去的：气泡半透，旁边一个小叉可以收回 */
  .grp.wait .bub { opacity: 0.55; }
  .undo { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line);
    background: var(--card); color: var(--muted); font-size: 13px; line-height: 1; padding: 0; }

  /* 思考链：默认只一条，点了才展开（和 Aru 那边一样） */
  .think { margin: 0 0 12px 47px; }
  .think-top { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
    background: none; border: 1px solid var(--line); border-radius: 999px;
    font: inherit; font-size: 11px; color: var(--muted); }
  .think-caret { font-size: 9px; transition: transform 0.15s; }
  .think.on .think-caret { transform: rotate(90deg); }
  .think-body { display: none; margin: 7px 0 0; padding: 10px 13px; border-radius: 12px;
    background: #f7f7f7; border: 1px dashed var(--line);
    font-size: 12px; line-height: 1.75; color: var(--muted);
    white-space: pre-wrap; word-break: break-word; }
  .think.on .think-body { display: block; }

  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }
  .typing { margin: 0 0 12px 47px; font-size: 12px; color: var(--muted); }

  /* 详情：居中，底下留出输入框和标签栏的高度 */
  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: center;
    justify-content: center; padding: 16px 16px calc(96px + env(safe-area-inset-bottom, 0px));
    background: rgba(0, 0, 0, 0.32); }
  .sheet.on { display: flex; }
  .sheet-box { width: 100%; max-width: 560px; max-height: 68vh; overflow-y: auto;
    background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 16px 18px 18px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18); }
  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    margin-bottom: 10px; }
  .sheet-when { font-size: 12px; color: var(--muted); }
  .sheet-x { border: none; background: none; font-size: 20px; line-height: 1; color: var(--muted);
    padding: 6px 4px; }
  .sheet-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--ink); }
  .sheet-body { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap;
    word-break: break-word; color: var(--ink); font-family: inherit; }

  /* 输入框。发送和「让他回复」是同一个按钮（小满 10-30）：
     输入框有字 = 发送，空着 = 把攒着的递给他让他回复。
     两个按钮挤在一起是之前点错的根，合成一个就不存在了 */
  .composer { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(76px + env(safe-area-inset-bottom, 0px)); z-index: 80;
    display: flex; gap: 8px; width: calc(100% - 24px); max-width: 440px; padding: 7px;
    background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(10px);
    border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); }
  .composer input { flex: 1; min-width: 0; height: 40px; padding: 0 13px; border-radius: 15px;
    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink);
    -webkit-appearance: none; appearance: none; }
  .go { flex: none; min-width: 44px; height: 40px; padding: 0 14px; border-radius: 15px;
    border: none; background: #1a1a1a; color: #fdfdfd; font-size: 14px; white-space: nowrap;
    -webkit-appearance: none; appearance: none; }
  .go:disabled { background: #d4d4d4; color: #fafafa; }

  .tip { position: fixed; left: 50%; transform: translateX(-50%);
    bottom: calc(130px + env(safe-area-inset-bottom, 0px)); z-index: 96;
    max-width: calc(100% - 40px); padding: 9px 16px; border-radius: 999px;
    background: rgba(26, 26, 26, 0.9); color: #fdfdfd; font-size: 12px; line-height: 1.5;
    opacity: 0; pointer-events: none; transition: opacity 0.22s ease; }
  .tip.on { opacity: 1; }

  .empty { text-align: center; font-size: 13px; line-height: 1.7; color: var(--muted); margin: 32px 10px; }
`;

// 注：这整段是模板字符串，里面不能出现 ${ —— 会被当成插值。字符串拼接一律用 +。
const ROOM_SCRIPT = `(function () {
  var main = document.querySelector('main');
  var stream = document.querySelector('[data-stream]');
  var tipEl = document.querySelector('[data-tip]');
  var form = document.querySelector('[data-send]');
  var input = form && form.querySelector('input');
  var btn = document.querySelector('[data-go]');
  if (!stream) return;

  // 进来停在最新那条（小满 10-30：「点击进入要定位到最新一条消息」）。
  // 不用 smooth：那样先看见几天前的再晃到底。
  function toBottom() {
    try {
      var last = stream.lastElementChild;
      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' });
      window.scrollTo(0, document.documentElement.scrollHeight);
    } catch (e) {}
  }

  // 底部留白：量输入框的实际位置，不写固定值。
  // 固定值总有算不准的时候（安全区、按钮文字变长、转屏），
  // 而标签栏在输入框下面，已经被这个距离包含。
  function fitBottom() {
    if (!main || !form) return;
    var top = form.getBoundingClientRect().top;
    var need = Math.max(160, Math.round(window.innerHeight - top + 28));
    main.style.paddingBottom = need + 'px';
  }

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

  // relay 那边的 ts 和我们的 Date.now() 不一定同一个单位。
  // 秒和毫秒混着排序，整批消息会被甩到几十年前 —— 表现出来就是「消息不见了」。
  function normTs(ts) {
    var n = Number(ts);
    if (!isFinite(n) || n <= 0) return 0;
    return n < 1e12 ? n * 1000 : n;
  }

  function hhmm(ts) {
    var n = normTs(ts);
    var d = n ? new Date(n) : new Date();
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
    x.textContent = '×';
    return x;
  }

  // 一组话。side 是 human 或 ai。read: 'read' 已读、'unread' 未读、不传不显示。
  // 返回最后一个气泡元素（流式草稿要接着往里写）。
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
      if (i === lines.length - 1) {
        var meta = document.createElement('div');
        meta.className = 'meta';
        var at = document.createElement('span');
        at.className = 'at';
        at.textContent = hhmm(ts);
        meta.appendChild(at);
        // 已读/未读只给自己发的。口径是「进没进了他的输入」，
        // 不是「他真的读懂了」—— 后者我确定不了。
        if (opts.read) {
          var sn = document.createElement('span');
          sn.className = 'seen' + (opts.read === 'unread' ? ' unread' : '');
          sn.textContent = opts.read === 'unread' ? '未读' : '已读';
          meta.appendChild(sn);
        }
        ln.appendChild(meta);
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
    caret.textContent = '▶';
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

  // 行动卡片。和消息按时间混排，所以这儿也是前端画。
  var details = {};
  function cardEl(c) {
    var has = !!c.detail;
    if (has) details[c.id] = c.detail;
    var el = document.createElement(has ? 'button' : 'div');
    el.className = 'card' + (has ? ' tap' : '');
    if (has) {
      el.type = 'button';
      el.setAttribute('data-detail', c.id);
    }
    var w = document.createElement('span');
    w.className = 'card-when';
    w.textContent = c.when || '';
    var b = document.createElement('span');
    b.className = 'card-body';
    b.textContent = c.body || '';
    el.appendChild(w);
    el.appendChild(b);
    if (has) {
      var m = document.createElement('span');
      m.className = 'card-more';
      m.setAttribute('aria-hidden', 'true');
      m.textContent = '✦';
      el.appendChild(m);
    }
    put(el);
  }

  var seen = {};
  var drafts = {};
  var mine = [];
  var pendingN = 0;

  function paint(it) {
    if (it.t === 'card') { cardEl(it.c); return; }
    if (it.t === 'pending') {
      group('human', it.text, it.ts, { wait: true, pid: it.id, read: 'unread' });
      return;
    }
    var m = it.m;
    var kind = m.kind || 'reply';
    if (kind === 'act') {
      var a = document.createElement('div');
      a.className = 'msg-act';
      a.textContent = m.text || '';
      put(a);
      return;
    }
    if (kind === 'thinking') { thinking(m.text || ''); return; }
    var human = m.from === 'human';
    // relay 历史里我的消息都已经递过了，所以都算已读
    group(human ? 'human' : 'ai', m.text || '', m.ts, human ? { read: 'read' } : {});
  }

  // SSE 推来的新消息：直接接在最后（它就是最新的）
  function add(m) {
    if (!m) return;
    if (m.id != null) {
      if (seen[m.id]) return;
      seen[m.id] = 1;
    }
    // 自己刚递出去的那条：SSE 会把它原样推回来。
    // 认领本地已经画好的，别让同一句话出现两遍。
    if (m.from === 'human') {
      for (var i = 0; i < mine.length; i++) {
        if (mine[i] === (m.text || '')) {
          mine.splice(i, 1);
          return;
        }
      }
    }
    paint({ t: 'msg', m: m });
    toBottom();
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
        var text = d.final_text || b.textContent || '';
        var g = b.closest ? b.closest('.grp') : null;
        if (g && g.parentNode) g.parentNode.removeChild(g);
        delete drafts[sid];
        setTyping(false);
        if (text.trim()) group('ai', text, Date.now());
        toBottom();
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

  // 按钮：输入框有字 = 发送，空着 = 让他回复。同一个键。
  function syncBtn() {
    if (!btn) return;
    var has = input && input.value.trim().length > 0;
    if (has) {
      btn.textContent = '↑';
      btn.disabled = false;
      btn.setAttribute('data-act', 'send');
      btn.setAttribute('aria-label', '发送');
    } else if (pendingN > 0) {
      btn.textContent = '让' + who.ai.name + '回复';
      btn.disabled = false;
      btn.setAttribute('data-act', 'flush');
      btn.setAttribute('aria-label', '让他读这些话并回复');
    } else {
      btn.textContent = '↑';
      btn.disabled = true;
      btn.removeAttribute('data-act');
    }
    fitBottom();
  }

  // ── 开场：卡片 + 历史 + 攒着的，按时间排好再画 ──
  var cards = [];
  try {
    var tag = document.querySelector('[data-cards]');
    if (tag) cards = JSON.parse(tag.textContent || '[]');
  } catch (e) { cards = []; }

  fetch('/chat/api/history?limit=60', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      var msgs = (d && d.messages) || [];
      for (var i = 0; i < msgs.length; i++) {
        if (msgs[i].id != null) seen[msgs[i].id] = 1;
      }
      return fetch('/chat/api/pending', { credentials: 'same-origin' })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) { return { msgs: msgs, pend: (p && p.pending) || [] }; })
        .catch(function () { return { msgs: msgs, pend: [] }; });
    })
    .then(function (all) {
      if (!all) return;
      var items = [];
      var i;
      for (i = 0; i < cards.length; i++) {
        items.push({ t: 'card', ts: normTs(cards[i].ts), c: cards[i] });
      }
      for (i = 0; i < all.msgs.length; i++) {
        items.push({ t: 'msg', ts: normTs(all.msgs[i].ts), m: all.msgs[i] });
      }
      for (i = 0; i < all.pend.length; i++) {
        items.push({
          t: 'pending', ts: normTs(all.pend[i].created_at),
          id: all.pend[i].id, text: all.pend[i].text
        });
      }
      items.sort(function (a, b) { return a.ts - b.ts; });
      for (i = 0; i < items.length; i++) paint(items[i]);
      pendingN = all.pend.length;
      syncBtn();
      fitBottom();
      toBottom();
      // 图片（头像）加载完会推一把布局，再停一次
      setTimeout(toBottom, 150);
      setTimeout(toBottom, 600);
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

  // 点思考链展开 / 卡片详情 / 收回攒着的那条
  var sheet = document.querySelector('[data-sheet]');
  var sbox = sheet && sheet.querySelector('[data-sheet-body]');
  var swhen = sheet && sheet.querySelector('[data-sheet-when]');
  function closeSheet() {
    if (!sheet) return;
    sheet.classList.remove('on');
    document.body.style.overflow = '';
  }
  document.addEventListener('click', function (e) {
    if (!e.target.closest) return;
    var th = e.target.closest('[data-think]');
    if (th) { th.parentNode.classList.toggle('on'); return; }
    var card = e.target.closest('.card.tap');
    if (card && sheet && sbox) {
      var id = card.getAttribute('data-detail');
      sbox.textContent = details[id] || '';
      var w = card.querySelector('.card-when');
      if (swhen) swhen.textContent = w ? w.textContent : '';
      sheet.classList.add('on');
      document.body.style.overflow = 'hidden';
      return;
    }
    if (e.target.closest('[data-sheet-x]') || e.target === sheet) { closeSheet(); return; }
    var dp = e.target.closest('[data-drop]');
    if (!dp) return;
    fetch('/chat/api/pending/' + dp.getAttribute('data-drop') + '/drop',
      { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d || !d.dropped) return;
        var g = dp.closest('.grp');
        if (g && g.parentNode) g.parentNode.removeChild(g);
        pendingN = d.pending;
        syncBtn();
      })
      .catch(function () {});
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  function doSend() {
    var text = input ? String(input.value || '').trim() : '';
    if (!text) return;
    if (input) input.value = '';
    // 先在本地画出来，不等往返 —— 打字发出去该立刻看见。
    // 半透是「还没递给他」，递出去之后才变实。
    var ph = group('human', text, Date.now(), { wait: true, read: 'unread' });
    toBottom();
    fetch('/chat/api/send', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: text })
    })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (d) {
        pendingN = d.pending;
        syncBtn();
        var g = ph && ph.closest ? ph.closest('.grp') : null;
        if (!g || !d.id) return;
        var lns = g.querySelectorAll('.ln');
        if (lns.length) lns[lns.length - 1].appendChild(undoBtn(d.id));
      })
      .catch(function (err) { toast('没存下：' + err.message); });
    syncBtn();
  }

  function doFlush() {
    if (!btn) return;
    btn.disabled = true;
    fetch('/chat/api/flush', { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) {
        if (!d) { syncBtn(); return; }
        pendingN = d.remaining;
        syncBtn();
        if (d.error) { toast('没递出去：' + d.error); return; }
        // 递出去了：不再半透，未读改已读，小叉收走
        var waiting = stream.querySelectorAll('.grp.wait');
        for (var i = 0; i < waiting.length; i++) {
          waiting[i].classList.remove('wait');
          var x = waiting[i].querySelector('[data-drop]');
          if (x && x.parentNode) x.parentNode.removeChild(x);
          var sn = waiting[i].querySelector('.seen');
          if (sn) { sn.textContent = '已读'; sn.classList.remove('unread'); }
          var txt = waiting[i].querySelector('.bub');
          if (txt) mine.push(txt.textContent);
        }
        if (d.sent) setTyping(true);
        toBottom();
      })
      .catch(function (err) { syncBtn(); toast('没递出去：' + err.message); });
  }

  function act() {
    if (input && input.value.trim()) doSend();
    else if (pendingN > 0) doFlush();
  }

  if (form) {
    form.addEventListener('submit', function (e) { e.preventDefault(); act(); });
  }
  if (btn) {
    btn.addEventListener('click', function (e) { e.preventDefault(); act(); });
  }
  if (input) {
    input.addEventListener('input', syncBtn);
    input.addEventListener('focus', function () { setTimeout(function () { fitBottom(); toBottom(); }, 300); });
    input.addEventListener('blur', function () { setTimeout(fitBottom, 300); });
  }

  syncBtn();
  fitBottom();
  toBottom();
  window.addEventListener('load', function () { fitBottom(); toBottom(); });
  window.addEventListener('resize', fitBottom);
  setTimeout(function () { fitBottom(); toBottom(); }, 120);
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

// 卡片不再服务端直接写成 HTML：要和消息按时间混排，必须交给前端。
// < 转成 \u003c：正文里如果出现 </script> 会把这个标签提前打断。
function renderCards(cards) {
  const json = JSON.stringify(cards).replace(/</g, '\\u003c');
  return `<script type="application/json" data-cards>${json}</script>`;
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
      ${renderCards(cards)}
      <div class="stream" data-stream
        data-ta-name="${escapeHtml(ta.name)}" data-ta-av="${escapeHtml(ta.avatarUrl || '')}"
        data-me-name="${escapeHtml(me.name)}" data-me-av="${escapeHtml(me.avatarUrl || '')}"></div>
      <form class="composer" data-send onsubmit="return false">
        <input type="text" placeholder="说点什么…" aria-label="输入" />
        <button type="submit" class="go" data-go aria-label="发送">↑</button>
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
