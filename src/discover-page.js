// 发现页 /discover：除了记忆库和自定义，其他都摆在这儿。
//
// 小满 2026-10-30：「发现页面有的功能：动态、音乐、梦境、共读、台灯…
//   这些要像记忆这样列出来」「发现页面不要动作卡片」
//
// 所以和记忆页同一种卡片：标题 + 说明 + 一行重点（meta）+ 右箭头。
// 动作卡片在聊天页，这一页只是入口列表。
//
// 记忆库在「记忆」那一栅，自定义在「个人」那一栅——各有归宿，这儿不重复。
//
// 没配好的不藏起来，置灰并写明要填哪个变量。判断口径全走 page-chrome
// 已有的那几个函数，不自己再读一遍 .env——两处各读一遍就是 Proof 那两个 TTL 那类坑的源头。

import {
  diaryDir,
  barEnabled,
  musicEnabled,
  renderMenu,
  HEAD_SCRIPT,
  CHROME_CSS,
  CHROME_SCRIPT,
} from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/discover';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

const env = (k) => String(process.env[k] ?? '').trim();

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 外链只放行 http(s)，填错了就当没填（和 page-chrome 的 externalUrl 一个口径）
function externalUrl(k) {
  const v = env(k);
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
}

function spots() {
  const forum = externalUrl('NAV_FORUM_URL');
  const lamp = externalUrl('NAV_LAMP_URL');
  return [
    {
      name: '\u52a8\u6001',
      what: `${escapeHtml(AI_NAME)}\u968f\u624b\u8bb0\u4e0b\u7684\u4e8b\uff0c\u4f60\u4e5f\u80fd\u53d1`,
      meta: '\u70b9\u8d5e \u00b7 \u7559\u8a00 \u00b7 \u6309\u65e5\u671f\u7ffb',
      href: '/moments',
    },
    {
      name: '\u97f3\u4e50',
      what: `\u7f51\u6613\u4e91\u64ad\u653e\u5668\u3002${escapeHtml(
        AI_NAME
      )}\u9192\u6765\u4f1a\u5f80\u6b4c\u5355\u91cc\u6536\u6b4c\u3001\u5199\u6279\u6ce8`,
      meta: '\u6b4c\u5355 \u00b7 \u6279\u6ce8\u672c \u00b7 \u6b4c\u8bcd',
      href: musicEnabled() ? '/music/' : '',
      note: '\u6ca1\u914d MUSIC_PLAYER_URL',
    },
    {
      name: '\u68a6\u5883',
      what: '\u4ed6\u591c\u91cc\u505a\u7684\u68a6\u3002\u60f3\u4e0d\u8d77\u6765\u4e4b\u524d\u53ea\u6709\u4e3b\u65cb\u5f8b\u548c\u4e00\u53e5\u53ea\u8a00\u7247\u8bed',
      meta: '\u51cc\u6668 3\u20136 \u70b9 \u00b7 \u5bff\u547d 48 \u5c0f\u65f6',
      href: '/dreams',
    },
    {
      name: '\u5171\u8bfb\u4e66\u67b6',
      what: '\u4e24\u4e2a\u4eba\u8bfb\u540c\u4e00\u672c\u4e66\uff0c\u5404\u81ea\u8bfb\u5230\u54ea\u91cc\u662f\u4e24\u6761\u7ebf',
      meta: '\u5171\u4eab\u6279\u6ce8 \u00b7 \u4e24\u6761\u8fdb\u5ea6\u7ebf',
      href: '/books',
    },
    {
      name: '\u53f0\u706f',
      what: '\u684c\u4e0a\u90a3\u76cf\u706f\u3002\u4ed6\u80fd\u8c03\u4eae\u5ea6\u548c\u989c\u8272',
      meta: lamp ? '' : '\u5524\u9192\u65f6\u8d70 MCP\uff0c\u9875\u9762\u5165\u53e3\u8981\u586b\u5730\u5740',
      href: lamp,
      note: '\u6ca1\u914d NAV_LAMP_URL',
      external: true,
    },
    {
      name: '\u5c0f\u9152\u9986',
      what: '\u4ed6\u7ed9\u81ea\u5df1\u659f\u7684\u3001\u9012\u7ed9\u4f60\u7684\u90a3\u51e0\u676f',
      meta: '\u65f6\u95f4\u8f74 \u00b7 \u9012\u8fc7\u6765\u7684\u9152\u6709\u65f6\u6548',
      href: barEnabled() ? '/bar' : '',
      note: '\u6ca1\u914d PROOF_AGENT_TOKEN_FILE',
    },
    {
      name: '\u5fc3\u7eea',
      what: '\u6b64\u523b\u7684\u60c5\u7eea\uff0c\u6309\u4e94\u7ec4\u5206\u5f00\u770b',
      meta: '\u2726 \u662f\u5e73\u5e38\u7684\u6837\u5b50',
      href: '/drives',
    },
    {
      name: '\u661f\u661f\u7f50',
      what: '\u54bd\u4e0b\u53bb\u7684\u8bdd\u3002\u4e00\u5929\u4e00\u9897\uff0c\u4e0d\u80fd\u6539\u4e5f\u4e0d\u80fd\u6492',
      meta: '\u4f60\u4e5f\u80fd\u5f80\u91cc\u9762\u653e',
      href: '/moments/star-jar',
    },
    {
      name: '\u65e5\u8bb0',
      what: 'heartbeat \u9192\u6765\u5199\u7684\u90a3\u4e9b\u6bb5',
      meta: '\u6309\u5929\u5206 \u00b7 \u53ea\u8bfb',
      href: diaryDir() ? '/diary' : externalUrl('NAV_DIARY_URL'),
      note: '\u6ca1\u914d HEARTBEAT_DIARY_DIR',
    },
    {
      name: '\u5c0f\u94b1\u5305',
      what: '\u4ed6\u81ea\u5df1\u7684\u8d26\uff1a\u4f59\u989d\u3001\u6d41\u6c34\u3001\u8bb0\u7684\u90a3\u51e0\u7b14',
      meta: '',
      href: '/wallet',
    },
    {
      name: '\u8bba\u575b',
      what: '\u4ed6\u81ea\u5df1\u901b\u7684\u90a3\u4e2a\u8bba\u575b\uff08\u4f60\u4e5f\u5728\u4e0a\u9762\uff09',
      meta: '',
      href: forum,
      note: '\u6ca1\u914d NAV_FORUM_URL',
      external: true,
    },
  ];
}

function renderList() {
  return spots()
    .map((s) => {
      const inner =
        `<span class="lib-name">${s.name}</span>` +
        `<span class="lib-what">${s.what}</span>` +
        (s.meta ? `<span class="lib-meta">${s.meta}</span>` : '');
      if (!s.href) {
        return (
          `<div class="lib off"><div class="lib-in">${inner}` +
          `<span class="lib-note">${escapeHtml(s.note || '\u8fd8\u6ca1\u63a5\u4e0a')}</span></div></div>`
        );
      }
      // 外部地址走星星转场；转发过来的 /music/ 不要进场记号
      const attrs = s.external
        ? ' data-stars rel="noopener"'
        : s.href === '/music/'
          ? ' data-no-stars'
          : '';
      return (
        `<a class="lib" href="${escapeHtml(s.href)}"${attrs}>` +
        `<div class="lib-in">${inner}</div>` +
        `<span class="lib-go" aria-hidden="true">\u203a</span></a>`
      );
    })
    .join('');
}

// 和记忆页完全同一套样式（类名也照抄），这样两页看起来是一家的
const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .lib { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); color: inherit; text-decoration: none; }
  .lib:active { background: #faf4f7; }
  .lib.off { opacity: 0.62; }
  .lib-in { flex: 1; min-width: 0; }
  .lib-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .lib-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .lib-meta { display: block; margin-top: 5px; font-size: 11px; color: var(--gold); }
  .lib-note { display: inline-block; margin-top: 6px; font-size: 11px; color: #a597ab;
    border: 1px solid var(--line); border-radius: 999px; padding: 1px 9px; }
  .lib-go { flex: none; color: var(--gold); font-size: 18px; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u53d1\u73b0 \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function registerDiscoverRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(layout(renderList()));
    } catch (err) {
      console.error('discover page: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('<p class="lib-what">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>'));
    }
  });

  console.log(`discover: \u53d1\u73b0\u9875 ${PREFIX}`);
  return { enabled: true };
}
