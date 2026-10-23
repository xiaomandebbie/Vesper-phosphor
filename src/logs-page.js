// 后台日志 /logs：VPS 上所有 pm2 进程最近的日志。给小满自己看的。
//
// 小满 2026-10-23：「VPS 上面所有 pm2 进程最近的 50 条日志…每分钟刷新一次…
//   是可以选择进程点击查看那种。不要挤在一起」
//
// **不花 token。** 这一页只读 pm2 已经写在磁盘上的日志文件，在浏览器里渲染，
// 一次模型调用都没有；每分钟刷新也只是前端再取一次本机文件。
//
// ── 为什么读文件而不跑 pm2 命令 ──
//
// `pm2 jlist` 要 spawn 一个进程，几百毫秒，而且得猜对 pm2 在哪、权限够不够；
// pm2 不在 PATH 里整页就打不开。日志文件本来就在 ~/.pm2/logs 下，名字有规律：
//   <进程名>-out.log / <进程名>-error.log
// 读文件不需要额外权限，也不依赖 pm2 还在不在。
//
// ── 只读末尾 ──
//
// 日志文件可能几十兆，整份读进来会把内存吃光。所以从末尾倒着读 TAIL_BYTES
// 字节，切成行，取最后 LIMIT 条。倒着读的第一行很可能是半截的，丢掉。
//
// ── out 和 error 怎么合到一起 ──
//
// ecosystem.config.cjs 里写了 time: true，所以每行前面有时间戳，两份能按时间排到一起。
// 认不出时间戳的行挂在上一条后面（多行的报错栈就是这样），不单独算一条。
//
// 时间戳是 pm2 按**服务器本地时间**写的，而这台服务器是 UTC。直接显示会差八小时，
// 所以按 UTC 解析、再按 TIME_ZONE 显示。服务器本身就是 +08 的话会多加一次，
// 那种情况在 .env 里写 PM2_LOG_TIME=local。
//
// ── 安全 ──
//
// 日志里会有 key、token（上游报错常带请求体）。这一页和其他页一样走
// VESPER_BASIC_USER / PASS，别把它开到认证外面。不想要就写 PM2_LOGS_DIR=off。
// 进程名只从目录里真实存在的文件里认，不拿查询参数拼路径——不然 ?p=../../etc/passwd 就进来了。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { TIME_ZONE } from './wall-time.js';

const PREFIX = '/logs';

// 一个进程显示最近几条。.env 的 PM2_LOG_LINES 可改，不填是 50，上限 500
const LIMIT = (() => {
  const n = Number(String(process.env.PM2_LOG_LINES ?? '').trim());
  return Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 50;
})();

const TAIL_BYTES = 256 * 1024;
const REFRESH_MS = 60000;

const LOG_FILE = /^(.+)-(out|error)\.log$/;
const TS = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:[.,]\d+)?\s*:?\s?/;

const TIME_IS_LOCAL = /^local$/i.test(String(process.env.PM2_LOG_TIME ?? '').trim());

// 自己格式化，不用 wall-time 的 formatDateTime——日志要看到秒，而那边到分钟
let FMT = null;
try {
  FMT = new Intl.DateTimeFormat('zh-CN', {
    timeZone: TIME_ZONE,
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
} catch {
  FMT = null;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function pm2LogsDir() {
  const raw = String(process.env.PM2_LOGS_DIR ?? '').trim();
  if (/^(off|0|false|no)$/i.test(raw)) return '';
  const dir = raw || path.join(os.homedir(), '.pm2', 'logs');
  try {
    return fs.statSync(dir).isDirectory() ? dir : '';
  } catch {
    return '';
  }
}

// 目录里有哪些进程。最近写过日志的排前面——刚出事的那个就在最上面
function listProcesses(dir) {
  const map = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  for (const name of names) {
    const m = LOG_FILE.exec(name);
    if (!m) continue;
    const file = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    const cur = map.get(m[1]) || { name: m[1], files: [], mtime: 0 };
    cur.files.push({ file, size: st.size, stream: m[2] === 'error' ? 'error' : 'out' });
    cur.mtime = Math.max(cur.mtime, st.mtimeMs);
    map.set(m[1], cur);
  }
  return [...map.values()].sort((a, b) => b.mtime - a.mtime);
}

function tailText(file, size) {
  if (!size) return '';
  const start = Math.max(0, size - TAIL_BYTES);
  const len = size - start;
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, start);
  } catch {
    return '';
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // 关不掉也没关系
      }
    }
  }
  const text = buf.toString('utf8');
  return start > 0 ? text.slice(text.indexOf('\n') + 1) : text;
}

function displayTime(datePart, timePart) {
  if (!FMT) return `${datePart.slice(5)} ${timePart}`;
  const ms = Date.parse(`${datePart}T${timePart}${TIME_IS_LOCAL ? '' : 'Z'}`);
  if (!Number.isFinite(ms)) return `${datePart.slice(5)} ${timePart}`;
  try {
    return FMT.format(ms).replace(/\//g, '-');
  } catch {
    return `${datePart.slice(5)} ${timePart}`;
  }
}

function parseEntries(text, stream) {
  const out = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) continue;
    const m = TS.exec(line);
    if (m) {
      const ms = Date.parse(`${m[1]}T${m[2]}${TIME_IS_LOCAL ? '' : 'Z'}`);
      out.push({
        ts: Number.isFinite(ms) ? ms : 0,
        time: displayTime(m[1], m[2]),
        stream,
        text: line.slice(m[0].length),
      });
      continue;
    }
    if (out.length) out[out.length - 1].text += `\n${line}`;
    else out.push({ ts: 0, time: '', stream, text: line });
  }
  return out;
}

function readProcessLog(proc) {
  const all = [];
  for (const f of proc.files) all.push(...parseEntries(tailText(f.file, f.size), f.stream));
  all.sort((a, b) => a.ts - b.ts);
  return all.slice(-LIMIT);
}

function renderTabs(list, current) {
  // data-no-stars：换进程不走星星转场。看日志要来回点，每次等 0.9 秒难受；
  // 有 JavaScript 时还会被下面的脚本接成原地刷新
  const items = list
    .map((p) => {
      const here = p.name === current;
      return `<a class="tab${here ? ' on' : ''}" href="${PREFIX}?p=${encodeURIComponent(
        p.name
      )}" data-no-stars${here ? ' aria-current="page"' : ''}>${escapeHtml(p.name)}</a>`;
    })
    .join('');
  return `<nav class="tabs" aria-label="进程">${items}</nav>`;
}

function renderEntries(entries) {
  if (!entries.length) return '<p class="empty">这个进程还没写过日志。</p>';
  // 新的在上面——打开就看见最近发生什么，不用滚到底
  return `<ol class="lines">${entries
    .slice()
    .reverse()
    .map(
      (e) => `<li class="line ${e.stream === 'error' ? 'err' : 'out'}">
      <div class="meta"><span class="t">${escapeHtml(e.time || '—')}</span><span class="tag">${
        e.stream === 'error' ? 'error' : 'out'
      }</span></div>
      <pre class="msg">${escapeHtml(e.text)}</pre>
    </li>`
    )
    .join('')}</ol>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  body::before { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 12% 18%, rgba(230, 182, 82, 0.9) 50%, transparent 51%),
      radial-gradient(1px 1px at 78% 9%, rgba(215, 121, 159, 0.8) 50%, transparent 51%),
      radial-gradient(2px 2px at 88% 36%, rgba(230, 182, 82, 0.7) 50%, transparent 51%),
      radial-gradient(1px 1px at 30% 62%, rgba(215, 121, 159, 0.7) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 64% 78%, rgba(230, 182, 82, 0.8) 50%, transparent 51%),
      radial-gradient(1px 1px at 8% 88%, rgba(155, 74, 122, 0.6) 50%, transparent 51%); }
  main { position: relative; z-index: 1; max-width: 760px; margin: 0 auto; padding: 22px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 18px; }
  .sparkles { margin: 0 0 4px; height: 18px; color: var(--gold); font-size: 14px; letter-spacing: 0.6em; padding-left: 0.6em; }
  .sparkles span { display: inline-block; animation: twinkle 3.2s ease-in-out infinite; }
  .sparkles span:nth-child(2) { animation-delay: 1s; color: #d7799f; }
  .sparkles span:nth-child(3) { animation-delay: 2s; }
  @keyframes twinkle { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
  @media (prefers-reduced-motion: reduce) { .sparkles span { animation: none; opacity: 0.8; } }
  .title { margin: 0; font-family: "Songti SC", "STSong", serif; font-size: 42px; font-weight: 700;
    letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .stamp { margin: 10px 0 0; font-size: 12px; color: var(--muted); }
  .stamp .dot { color: #6aa84f; }
  .tabs { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 16px; }
  .tab { display: inline-flex; align-items: center; min-height: 38px; padding: 0 14px; border-radius: 999px;
    background: var(--card); border: 1px solid var(--line); color: var(--ink); text-decoration: none;
    font-size: 14px; box-shadow: 0 1px 2px rgba(60, 30, 60, 0.06); }
  .tab:hover { border-color: #d9c9d4; }
  .tab.on { background: var(--accent); border-color: var(--accent); color: #fffdfb; font-weight: 600; }
  .tab.on::before { content: '\u2726'; margin-right: 6px; font-size: 11px; color: #f0d9a6; }
  .tab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .note { font-size: 12px; line-height: 1.6; color: var(--muted); margin: -6px 2px 16px; }
  .lines { list-style: none; margin: 0; padding: 0; }
  .line { background: var(--card); border: 1px solid var(--line); border-left: 4px solid #cbb8c6;
    border-radius: 12px; padding: 10px 14px 12px; margin-bottom: 10px; box-shadow: 0 1px 2px rgba(60, 30, 60, 0.05); }
  .line.err { border-left-color: #c2607f; background: #fffafb; }
  .meta { display: flex; align-items: center; gap: 10px; margin-bottom: 6px; }
  .meta .t { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .meta .tag { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--muted);
    border: 1px solid var(--line); border-radius: 999px; padding: 1px 7px; }
  .line.err .meta .tag { color: #a8415f; border-color: #eec3d0; }
  .msg { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }
  .empty, .notice { background: var(--card); border-radius: 14px; padding: 16px; font-size: 14px; line-height: 1.6;
    border-left: 4px solid var(--gold); }
  @media (max-width: 420px) { .title { font-size: 34px; } .msg { font-size: 12px; } }
`;

// 换进程和每分钟刷新都用 fetch 原地换，不重新加载整页。
// 用 location.reload 的话，星星转场每分钟要演一遍，看日志的人会被烦死。
// 拿同一个地址的 HTML 再解一遍，渲染逻辑就不用在前后端各写一份。
// 页面在后台（document.hidden）时不取，回到前台立刻补一次。
const REFRESH_SCRIPT = `(function () {
  var box = document.querySelector('[data-logs]');
  if (!box || !window.fetch || !window.DOMParser) return;
  var stamp = document.querySelector('[data-stamp]');
  var busy = false;

  function here() { return location.pathname + location.search; }

  function load(url, push) {
    if (busy) return;
    busy = true;
    fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
      .then(function (html) {
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var nb = doc.querySelector('[data-logs]');
        if (nb) box.innerHTML = nb.innerHTML;
        var ns = doc.querySelector('[data-stamp]');
        if (ns && stamp) stamp.innerHTML = ns.innerHTML;
        var nt = doc.querySelector('.tabs');
        var tabs = document.querySelector('.tabs');
        if (nt && tabs) tabs.innerHTML = nt.innerHTML;
        var t = doc.querySelector('title');
        if (t) document.title = t.textContent;
        if (push) history.pushState({}, '', url);
      })
      .catch(function () {})
      .then(function () { busy = false; });
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a.tab') : null;
    if (!a) return;
    e.preventDefault();
    load(a.getAttribute('href'), true);
  });

  window.addEventListener('popstate', function () { load(here(), false); });
  setInterval(function () { if (!document.hidden) load(here(), false); }, ${REFRESH_MS});
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(here(), false); });
})();`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main><script>${CHROME_SCRIPT}</script><script>${REFRESH_SCRIPT}</script></body>
</html>`;
}

function renderHero(current, now) {
  const when = FMT ? FMT.format(now).replace(/\//g, '-') : new Date(now).toISOString().slice(5, 19);
  return `<header class="hero">
    <p class="sparkles" aria-hidden="true"><span>\u2726</span><span>\u2727</span><span>\u22c6</span></p>
    <h1 class="title">晨暮星</h1>
    <p class="subtitle"><span lang="en">Logs</span> <span aria-hidden="true">\u2726</span> 后台日志</p>
    <p class="stamp" data-stamp><span class="dot" aria-hidden="true">\u25cf</span> ${escapeHtml(
      current || '没选进程'
    )} \u00b7 ${escapeHtml(when)} 更新 \u00b7 每分钟自己刷</p>
  </header>`;
}

export function registerLogRoutes(app, { requireBasicAuth }) {
  const dir = pm2LogsDir();
  if (!dir) {
    console.log('logs: 找不到 pm2 日志目录，/logs 没挂（可以用 PM2_LOGS_DIR 指定）');
    return { enabled: false };
  }

  app.get(PREFIX, requireBasicAuth, (req, res) => {
    const now = Date.now();
    try {
      const list = listProcesses(dir);
      res.set('Cache-Control', 'no-store');

      if (!list.length) {
        return res.send(
          layout(
            '后台日志 · 晨暮星',
            `${renderHero('', now)}<div class="notice" role="status">${escapeHtml(dir)} 里没找到 *-out.log / *-error.log。pm2 是不是用别的用户跑的？在 .env 里用 PM2_LOGS_DIR 指个目录。</div>`
          )
        );
      }

      // 进程名只从真实存在的文件里认，认不出就用最近写过日志的那个
      const want = String(req.query.p ?? '').trim();
      const proc = list.find((p) => p.name === want) || list[0];
      const entries = readProcessLog(proc);

      res.send(
        layout(
          `${proc.name} · 后台日志 · 晨暮星`,
          `${renderHero(proc.name, now)}
    ${renderTabs(list, proc.name)}
    <p class="note">最近 ${LIMIT} 条，新的在上面；out 和 error 按时间排在一起。这一页只读本机文件，不调模型。日志里可能有 key 和 token，只给自己看。</p>
    <div data-logs>${renderEntries(entries)}</div>`
        )
      );
    } catch (err) {
      console.error('logs page: 渲染失败', err);
      res
        .status(500)
        .send(
          layout(
            '出错了',
            `${renderHero('', now)}<div class="notice" role="alert">这一页出错了：${escapeHtml(err.message)}</div>`
          )
        );
    }
  });

  console.log(`logs: 后台日志 ${PREFIX}，读 ${dir}，每个进程最近 ${LIMIT} 条`);
  return { enabled: true, dir, limit: LIMIT };
}
