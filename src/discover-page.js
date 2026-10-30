// 发现页 /discover：除了记忆库和自定义，其他都摆在这儿。
//
// 小满 2026-10-30：「发现页面只要排列除了记忆库和自定义的其他内容」
//
// 记忆库在「记忆」那一栅，自定义在「个人」那一栅——各有归宿了，这儿不重复。
// 星星罐和共读也在记忆页列过，但那边强调的是「攒着的话」和「批注」；
// 这边当成景点列，进去是整个页面。同一个地方从两条路过去不冲突。
//
// 没配好的不藏起来，置灰并写明要填哪个变量——和菜单里那些「没配置」一个路子。
// 判断口径全走 page-chrome 已有的那几个函数，不自己再读一遍 .env：
// 两处各读一遍就是 Proof 那两个 TTL 那类坑的源头。

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
  return [
    {
      name: '\u52a8\u6001',
      what: `${AI_NAME}\u968f\u624b\u8bb0\u4e0b\u7684\u4e8b\uff0c\u4f60\u4e5f\u80fd\u53d1\u3002\u80fd\u70b9\u8d5e\u3001\u80fd\u7559\u8a00`,
      href: '/moments',
    },
    {
      name: '\u591c\u68a6',
      what: '\u4ed6\u591c\u91cc\u505a\u7684\u68a6\u3002\u60f3\u4e0d\u8d77\u6765\u4e4b\u524d\u53ea\u6709\u4e3b\u65cb\u5f8b\u548c\u4e00\u53e5\u53ea\u8a00\u7247\u8bed',
      href: '/dreams',
    },
    {
      name: '\u5fc3\u7eea',
      what: '\u6b64\u523b\u7684\u60c5\u7eea\uff0c\u6309\u4e94\u7ec4\u5206\u5f00\u770b\u3002\u2726 \u662f\u5e73\u5e38\u7684\u6837\u5b50',
      href: '/drives',
    },
    {
      name: '\u5171\u8bfb\u4e66\u67b6',
      what: '\u4e24\u4e2a\u4eba\u8bfb\u540c\u4e00\u672c\u4e66\uff0c\u5404\u81ea\u8bfb\u5230\u54ea\u91cc\u662f\u4e24\u6761\u7ebf',
      href: '/books',
    },
    {
      name: '\u661f\u661f\u7f50',
      what: '\u54bd\u4e0b\u53bb\u7684\u8bdd\u3002\u4e00\u5929\u4e00\u9897\uff0c\u4e0d\u80fd\u6539\u4e5f\u4e0d\u80fd\u6492',
      href: '/moments/star-jar',
    },
    {
      name: '\u97f3\u4e50',
      what: '\u7f51\u6613\u4e91\u64ad\u653e\u5668\u3002\u4ed6\u9192\u6765\u4f1a\u5f80\u6b4c\u5355\u91cc\u6536\u6b4c\u3001\u5199\u6279\u6ce8',
      href: musicEnabled() ? '/music/' : '',
      note: '\u6ca1\u914d MUSIC_PLAYER_URL',
    },
    {
      name: '\u5c0f\u9152\u9986',
      what: '\u4ed6\u7ed9\u81ea\u5df1\u659f\u7684\u3001\u9012\u7ed9\u4f60\u7684\u90a3\u51e0\u676f',
      href: barEnabled() ? '/bar' : '',
      note: '\u6ca1\u914d PROOF_AGENT_TOKEN_FILE',
    },
    {
      name: '\u65e5\u8bb0',
      what: 'heartbeat \u9192\u6765\u5199\u7684\u90a3\u4e9b\u6bb5',
      href: diaryDir() ? '/diary' : externalUrl('NAV_DIARY_URL'),
      note: '\u6ca1\u914d HEARTBEAT_DIARY_DIR',
    },
    {
      name: '\u5c0f\u94b1\u5305',
      what: '\u4ed6\u81ea\u5df1\u7684\u8d26\uff1a\u4f59\u989d\u3001\u6d41\u6c34\u3001\u8bb0\u7684\u90a3\u51e0\u7b14',
      href: '/wallet',
    },
    {
      name: '\u8bba\u575b',
      what: '\u4ed6\u81ea\u5df1\u901b\u7684\u90a3\u4e2a\u8bba\u575b\uff08\u4f60\u4e5f\u5728\u4e0a\u9762\uff09',
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
        `<span class="spot-name">${s.name}</span>` +
        `<span class="spot-what">${s.what}</span>`;
      if (!s.href) {
        return (
          `<div class="spot off"><div class="spot-in">${inner}</div>` +
          `<span class="spot-note">${escapeHtml(s.note || '\u8fd8\u6ca1\u63a5\u4e0a')}</span></div>`
        );
      }
      // 外部地址走星星转场（data-stars）；转发过来的 /music/ 不要进场记号
      const attrs = s.external
        ? ' data-stars rel="noopener"'
        : s.href === '/music/'
          ? ' data-no-stars'
          : '';
      return (
        `<a class="spot" href="${escapeHtml(s.href)}"${attrs}>` +
        `<div class="spot-in">${inner}</div>` +
        `<span class="spot-go" aria-hidden="true">\u203a</span></a>`
      );
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
  .spot { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); color: inherit; text-decoration: none; }
  .spot:active { background: #faf4f7; }
  .spot.off { opacity: 0.62; }
  .spot-in { flex: 1; min-width: 0; }
  .spot-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .spot-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .spot-note { flex: none; font-size: 11px; color: #a597ab; border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 9px; }
  .spot-go { flex: none; color: var(--gold); font-size: 18px; }
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
      res.status(500).send(layout('<p class="spot-what">\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>'));
    }
  });

  console.log(`discover: \u53d1\u73b0\u9875 ${PREFIX}`);
  return { enabled: true };
}
