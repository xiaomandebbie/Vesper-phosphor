// 个人页 /me：后台和自定义。
//
// 小满 2026-10-30：「个人里面放后台和自定义」
//
// 这两样之前在右上角那个三条杠里，淹在一长条页面里。现在单独一格。
//
// 顺带放两个开关：节律（normal / low-frequency）和退出登录。
// 节律那个走现有的 POST /wake/mode——silent 不给按，那是人工开关
// （见 README 「设计上的几个故意」），从页面上轻易点到不对。

import { getWakeState } from './state.js';
import { getProfile } from './moments-store.js';
import { pm2LogsDir } from './logs-page.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/me';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderWho() {
  let ai = 'TA';
  let me = '\u6211';
  let aiAvatar = '';
  let myAvatar = '';
  try {
    const a = getProfile('assistant');
    const u = getProfile('user');
    ai = a.name;
    me = u.name;
    aiAvatar = a.avatarUrl || '';
    myAvatar = u.avatarUrl || '';
  } catch (err) {
    console.error('me page: \u8bfb\u4e0d\u5230\u540d\u5b57', err.message);
  }
  const face = (url, name) =>
    url
      ? `<img class="face" src="${escapeHtml(url)}" alt="" />`
      : `<span class="face blank" aria-hidden="true">${escapeHtml(Array.from(name)[0] || '\u2726')}</span>`;
  return `<div class="who">
    <div class="who-pair">${face(myAvatar, me)}${face(aiAvatar, ai)}</div>
    <p class="who-names">${escapeHtml(me)} <span aria-hidden="true">\u00b7</span> ${escapeHtml(ai)}</p>
  </div>`;
}

function renderMode() {
  let mode = 'normal';
  try {
    mode = String(getWakeState()?.mode ?? 'normal');
  } catch {
    mode = 'normal';
  }
  const label =
    mode === 'silent'
      ? '\u6682\u505c\u4e2d'
      : mode === 'low-frequency'
        ? '\u4f4e\u9891\uff08\u95f4\u9694\u4f1a\u62c9\u957f\uff09'
        : '\u6b63\u5e38';
  // silent 是人工开关，页面上不给按——轻易点到就等于从他的世界里消失
  const hint =
    mode === 'silent'
      ? '\u73b0\u5728\u662f\u6682\u505c\u72b6\u6001\uff0c\u8981\u6062\u590d\u5f97\u7528\u63a5\u53e3\uff08POST /wake/mode\uff09\u3002'
      : '\u4ed6\u81ea\u5df1\u4e5f\u80fd\u8c03\u8fd9\u4e2a\u3002\u6682\u505c\uff08silent\uff09\u53ea\u7559\u7ed9\u63a5\u53e3\uff0c\u8fd9\u91cc\u4e0d\u653e\u6309\u94ae\u3002';
  return `<div class="row flat">
    <div class="row-in">
      <span class="row-name">\u5524\u9192\u8282\u5f8b</span>
      <span class="row-what">${hint}</span>
    </div>
    <span class="row-val">${label}</span>
  </div>`;
}

function renderRows() {
  const hasLogs = Boolean(pm2LogsDir());
  const rows = [
    {
      name: '\u81ea\u5b9a\u4e49',
      what: '\u6539\u4ed6\u548c\u4f60\u7684\u5934\u50cf\u3001\u540d\u5b57',
      href: '/moments/profile',
    },
    {
      name: '\u540e\u53f0\u65e5\u5fd7',
      what: hasLogs
        ? 'VPS \u4e0a\u6240\u6709 pm2 \u8fdb\u7a0b\u6700\u8fd1\u7684\u65e5\u5fd7\uff0c\u6309\u8fdb\u7a0b\u5206\u5f00\u770b'
        : '\u627e\u4e0d\u5230 pm2 \u65e5\u5fd7\u76ee\u5f55',
      href: hasLogs ? '/logs' : '',
      note: '\u53ef\u7528 PM2_LOGS_DIR \u6307\u5b9a',
    },
    {
      name: '\u6536\u85cf',
      what: '\u4f60\u6536\u8d77\u6765\u7684\u90a3\u51e0\u6761\u52a8\u6001',
      href: '/moments/favorites',
    },
  ];
  return rows
    .map((r) => {
      const inner = `<div class="row-in"><span class="row-name">${r.name}</span><span class="row-what">${r.what}</span></div>`;
      if (!r.href) {
        return `<div class="row off">${inner}<span class="row-note">${escapeHtml(
          r.note || '\u6ca1\u914d\u7f6e'
        )}</span></div>`;
      }
      return `<a class="row" href="${r.href}">${inner}<span class="row-go" aria-hidden="true">\u203a</span></a>`;
    })
    .join('');
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 18px; }
  .title { margin: 0; font-size: 26px; font-weight: 200; letter-spacing: 0.3em; padding-left: 0.3em;
    color: #5b2e52; }
  .subtitle { margin: 5px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }

  .who { text-align: center; margin: 0 0 20px; }
  .who-pair { display: flex; align-items: center; justify-content: center; gap: -10px; }
  .face { width: 54px; height: 54px; border-radius: 50%; object-fit: cover;
    border: 2px solid var(--card); box-shadow: 0 2px 8px rgba(60, 30, 60, 0.14); }
  .face.blank { display: flex; align-items: center; justify-content: center;
    background: #f3e9ef; color: var(--accent); font-size: 20px; }
  .who-pair .face + .face { margin-left: -12px; }
  .who-names { margin: 8px 0 0; font-size: 13px; color: var(--muted); }

  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); color: inherit; text-decoration: none; }
  .row:active { background: #faf4f7; }
  .row.off { opacity: 0.62; }
  .row.flat { box-shadow: none; }
  .row-in { flex: 1; min-width: 0; }
  .row-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .row-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .row-val { flex: none; font-size: 12px; color: var(--gold); }
  .row-note { flex: none; font-size: 11px; color: #a597ab; border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 9px; }
  .row-go { flex: none; color: var(--gold); font-size: 18px; }

  .out { margin: 22px 0 0; text-align: center; }
  .out button { min-height: 40px; padding: 0 22px; border-radius: 14px; border: 1px solid var(--line);
    background: var(--card); color: var(--muted); font-size: 13px; }
  .out button:active { background: #faf4f7; }
  .foot { margin: 16px 6px 0; font-size: 11px; line-height: 1.7; color: #a597ab; text-align: center; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u4e2a\u4eba \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function registerMeRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(
        layout(`<header class="hero">
        <h1 class="title">\u4e2a\u4eba</h1>
        <p class="subtitle" lang="en">Me <span aria-hidden="true">\u2726</span> \u8bbe\u7f6e</p>
      </header>
      ${renderWho()}
      ${renderRows()}
      ${renderMode()}
      <form class="out" method="POST" action="/logout">
        <button type="submit">\u9000\u51fa\u767b\u5f55</button>
      </form>
      <p class="foot">\u9000\u51fa\u4e4b\u540e\u8981\u91cd\u65b0\u8f93\u4e00\u6b21\u5bc6\u7801\u3002</p>`)
      );
    } catch (err) {
      console.error('me page: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('<p class="foot">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>'));
    }
  });

  console.log(`me: \u4e2a\u4eba\u9875 ${PREFIX}`);
  return { enabled: true };
}
