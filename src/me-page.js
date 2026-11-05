// 个人页 /me：后台和自定义。
//
// 小满 2026-10-30：「个人里面放后台和自定义」
//
// 这两样之前在右上角那个三条杠里，淹在一长条页面里。现在单独一格。
//
// 顺带放两个开关：节律（normal / low-frequency）和退出登录。
// 节律那个走现有的 POST /wake/mode——silent 不给按，那是人工开关
// （见 README 「设计上的几个故意」），从页面上轻易点到不对。
//
// ── 模型那一行（2026-11-05）──
//
// 只是一行带 › 的条目，和上面三行长得一样；具体的配置全在里面
// （/me/models）。小满：「要和其他外观一致，点进去更改」。
//
// 通知不在这一页单独占一行：它已经是「模型 · 连接 · 通知」里的一项。
// 小满 2026-11-05：「那就不需要个人还有一个通知入口了」。
// /me/push 这个页面本身留着，从模型页点进去。
//
// 那一行的 HTML 由 env-ui.js 自己生成，因为只有它知道配好了几条线路；
// 这边只管摆在哪。两边用的是同一套 .row 类名。

import { getWakeState } from './state.js';
import { getProfile } from './moments-store.js';
import { pm2LogsDir } from './logs-page.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { renderModelsRow } from './env-ui.js';

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
  let me = '我';
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
    console.error('me page: 读不到名字', err.message);
  }
  const face = (url, name) =>
    url
      ? `<img class="face" src="${escapeHtml(url)}" alt="" />`
      : `<span class="face blank" aria-hidden="true">${escapeHtml(Array.from(name)[0] || '✦')}</span>`;
  return `<div class="who">
    <div class="who-pair">${face(myAvatar, me)}${face(aiAvatar, ai)}</div>
    <p class="who-names">${escapeHtml(me)} <span aria-hidden="true">·</span> ${escapeHtml(ai)}</p>
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
      ? '暂停中'
      : mode === 'low-frequency'
        ? '低频（间隔会拉长）'
        : '正常';
  // silent 是人工开关，页面上不给按——轻易点到就等于从他的世界里消失
  const hint =
    mode === 'silent'
      ? '现在是暂停状态，要恢复得用接口（POST /wake/mode）。'
      : '他自己也能调这个。暂停（silent）只留给接口，这里不放按钮。';
  return `<div class="row flat">
    <div class="row-in">
      <span class="row-name">唤醒节律</span>
      <span class="row-what">${hint}</span>
    </div>
    <span class="row-val">${label}</span>
  </div>`;
}

function renderRows() {
  const hasLogs = Boolean(pm2LogsDir());
  const rows = [
    {
      name: '自定义',
      what: '改他和你的头像、名字',
      href: '/moments/profile',
    },
    {
      name: '后台日志',
      what: hasLogs
        ? 'VPS 上所有 pm2 进程最近的日志，按进程分开看'
        : '找不到 pm2 日志目录',
      href: hasLogs ? '/logs' : '',
      note: '可用 PM2_LOGS_DIR 指定',
    },
    {
      name: '收藏',
      what: '你收起来的那几条动态',
      href: '/moments/favorites',
    },
  ];
  return rows
    .map((r) => {
      const inner = `<div class="row-in"><span class="row-name">${r.name}</span><span class="row-what">${r.what}</span></div>`;
      if (!r.href) {
        return `<div class="row off">${inner}<span class="row-note">${escapeHtml(
          r.note || '没配置'
        )}</span></div>`;
      }
      return `<a class="row" href="${r.href}">${inner}<span class="row-go" aria-hidden="true">›</span></a>`;
    })
    .join('');
}

// 模型那一行。读不到时不该把整页拖下水，所以包一层 try。
// 通知在这一页上没有单独的行：它在 /me/models 里面。
function renderExtras() {
  try {
    return renderModelsRow();
  } catch (err) {
    console.error('me page: 模型那行没渲染出来', err.message);
    return '';
  }
}

const STYLE = `
  :root { --ink: #252525; --muted: #5e5e5e; --accent: #4d4d4d; --gold: #818181;
    --card: #fdfdfd; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 18px; }
  .title { margin: 0; font-size: 26px; font-weight: 200; letter-spacing: 0.3em; padding-left: 0.3em;
    color: #3a3a3a; }
  .subtitle { margin: 5px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }

  .who { text-align: center; margin: 0 0 20px; }
  .who-pair { display: flex; align-items: center; justify-content: center; gap: -10px; }
  .face { width: 54px; height: 54px; border-radius: 50%; object-fit: cover;
    border: 2px solid var(--card); box-shadow: 0 2px 8px rgba(39, 39, 39, 0.14); }
  .face.blank { display: flex; align-items: center; justify-content: center;
    background: #ececec; color: var(--accent); font-size: 20px; }
  .who-pair .face + .face { margin-left: -12px; }
  .who-names { margin: 8px 0 0; font-size: 13px; color: var(--muted); }

  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(39, 39, 39, 0.07); color: inherit; text-decoration: none; }
  .row:active { background: #f5f5f5; }
  .row.off { opacity: 0.62; }
  .row.flat { box-shadow: none; }
  .row-in { flex: 1; min-width: 0; }
  .row-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .row-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .row-val { flex: none; font-size: 12px; color: var(--gold); }
  .row-note { flex: none; font-size: 11px; color: #9b9b9b; border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 9px; }
  .row-go { flex: none; color: var(--gold); font-size: 18px; }

  .out { margin: 22px 0 0; text-align: center; }
  .out button { min-height: 40px; padding: 0 22px; border-radius: 14px; border: 1px solid var(--line);
    background: var(--card); color: var(--muted); font-size: 13px; }
  .out button:active { background: #f5f5f5; }
  .foot { margin: 16px 6px 0; font-size: 11px; line-height: 1.7; color: #9b9b9b; text-align: center; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>个人 · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}<\/script></body>
</html>`;
}

export function registerMeRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(
        layout(`<header class="hero">
        <h1 class="title">个人</h1>
        <p class="subtitle" lang="en">Me <span aria-hidden="true">✦</span> 设置</p>
      </header>
      ${renderWho()}
      ${renderRows()}
      ${renderExtras()}
      ${renderMode()}
      <form class="out" method="POST" action="/logout">
        <button type="submit">退出登录</button>
      </form>
      <p class="foot">退出之后要重新输一次密码。</p>`)
      );
    } catch (err) {
      console.error('me page: 渲染失败', err);
      res.status(500).send(layout('<p class="foot">这一页出错了。</p>'));
    }
  });

  console.log(`me: 个人页 ${PREFIX}`);
  return { enabled: true };
}
