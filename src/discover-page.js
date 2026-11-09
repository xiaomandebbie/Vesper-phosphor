// 发现页 /discover：除了记忆库和自定义，其他都摆在这儿。
//
// 小满 2026-11-04：「做成像手机应用一样的圆角方形，每一个下面写着名称
// （不需要介绍词）一行四个。长按可以修改名称和图标」
//
// 网格、长按和设置页都在 discover-apps.js；这边只管「有哪些入口」。
//
// ── key 是定死的 ──
//
// 她改过的名字和图标按 key 存。要是拿默认名字或者 href 当 key，
// 哪天改了名字、换了路径，她改过的那几个全对不上了——
// 和书架那次猜 localStorage 键名是同一类坑。所以每个 spot 都带一个写死的 key。
//
// ── what / meta 留着没删 ──
//
// 网格上不再摆介绍词，但这两个字段记着每个入口到底是干什么的。
// 删了以后要恢复得重写一遍，留着不占地方。note 设置页要用（差哪个变量）。
//
// 没配好的不藏起来，只是淡下去、点不进。判断口径全走 page-chrome 已有的那几个
// 函数，不自己再读一遍 .env——两处各读一遍就是 Proof 那两个 TTL 那类坑的源头。

import {
  diaryDir,
  barEnabled,
  musicEnabled,
  workkkEnabled,
  renderMenu,
  HEAD_SCRIPT,
  CHROME_CSS,
  CHROME_SCRIPT,
} from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { renderAppGrid, APPS_CSS, APPS_SCRIPT, registerDiscoverAppRoutes } from './discover-apps.js';
import { uranusEnabled } from './uranus-proxy.js';

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

// key 写死，不要改：她改过的名字和图标按这个存着
function spots() {
  const forum = externalUrl('NAV_FORUM_URL');
  const leto = externalUrl('NAV_LETO_URL');
  const lamp = externalUrl('NAV_LAMP_URL');
  return [
    {
      key: 'moments',
      name: '\u52a8\u6001',
      what: `${escapeHtml(AI_NAME)}\u968f\u624b\u8bb0\u4e0b\u7684\u4e8b\uff0c\u4f60\u4e5f\u80fd\u53d1`,
      meta: '\u70b9\u8d5e \u00b7 \u7559\u8a00',
      href: '/moments',
    },
    {
      key: 'music',
      name: '\u97f3\u4e50',
      what: `\u7f51\u6613\u4e91\u64ad\u653e\u5668\u3002${escapeHtml(
        AI_NAME
      )}\u9192\u6765\u4f1a\u5f80\u6b4c\u5355\u91cc\u6536\u6b4c\u3001\u5199\u6279\u6ce8`,
      meta: '\u6b4c\u5355 \u00b7 \u6279\u6ce8\u672c \u00b7 \u6b4c\u8bcd',
      href: musicEnabled() ? '/music/' : '',
      note: '\u6ca1\u914d MUSIC_PLAYER_URL',
    },
    {
      key: 'dreams',
      name: '\u68a6\u5883',
      what: '\u4ed6\u591c\u91cc\u505a\u7684\u68a6\u3002\u60f3\u4e0d\u8d77\u6765\u4e4b\u524d\u53ea\u6709\u4e3b\u65cb\u5f8b\u548c\u4e00\u53e5\u53ea\u8a00\u7247\u8bed',
      meta: '\u51cc\u6668 3\u20136 \u70b9 \u00b7 \u5bff\u547d 48 \u5c0f\u65f6',
      href: '/dreams',
    },
    {
      key: 'books',
      name: '\u5171\u8bfb',
      what: '\u4e24\u4e2a\u4eba\u8bfb\u540c\u4e00\u672c\u4e66\uff0c\u5404\u81ea\u8bfb\u5230\u54ea\u91cc\u662f\u4e24\u6761\u7ebf',
      meta: '\u5171\u4eab\u6279\u6ce8 \u00b7 \u4e24\u6761\u8fdb\u5ea6\u7ebf',
      href: '/books',
    },
    {
      key: 'games',
      name: '\u5c0f\u6e38\u620f',
      what: '\u4ed6\u81ea\u5df1\u73a9\u7684\u90a3\u51e0\u4e2a\u3002WORKKK \u662f\u8c22\u4e4b\u821f\u5199\u7684\uff0c\u9875\u9762\u8f6c\u53d1\u8fc7\u6765',
      meta: '\u4e0a\u73ed \u00b7 \u82b1\u56ed',
      href: workkkEnabled() ? '/games' : '',
      note: '\u6ca1\u914d WORKKK_PAGE_URL',
    },
    {
      key: 'lamp',
      name: '\u53f0\u706f',
      what: '\u684c\u4e0a\u90a3\u76cf\u706f\u3002\u4ed6\u80fd\u8c03\u4eae\u5ea6\u548c\u989c\u8272',
      meta: lamp ? '' : '\u5524\u9192\u65f6\u8d70 MCP',
      // 台灯服务自带网页，/lamp 已经转发到 127.0.0.1:3003（2026-10-30）
      href: '/lamp',
      note: '\u53f0\u706f\u670d\u52a1\u6ca1\u8dd1\u7740',
    },
    {
      key: 'bar',
      name: '\u5c0f\u9152\u9986',
      what: '\u4ed6\u7ed9\u81ea\u5df1\u659f\u7684\u3001\u9012\u7ed9\u4f60\u7684\u90a3\u51e0\u676f',
      meta: '\u65f6\u95f4\u8f74 \u00b7 \u9012\u8fc7\u6765\u7684\u9152\u6709\u65f6\u6548',
      href: barEnabled() ? '/bar' : '',
      note: '\u6ca1\u914d PROOF_AGENT_TOKEN_FILE',
    },
    {
      key: 'drives',
      name: '\u5fc3\u7eea',
      what: '\u6b64\u523b\u7684\u60c5\u7eea\uff0c\u6309\u4e94\u7ec4\u5206\u5f00\u770b',
      meta: '\u2726 \u662f\u5e73\u5e38\u7684\u6837\u5b50',
      href: '/drives',
    },
    {
      key: 'jar',
      name: '\u661f\u661f\u7f50',
      what: '\u54bd\u4e0b\u53bb\u7684\u8bdd\u3002\u4e00\u5929\u4e00\u9897\uff0c\u4e0d\u80fd\u6539\u4e5f\u4e0d\u80fd\u6492',
      meta: '\u4f60\u4e5f\u80fd\u5f80\u91cc\u9762\u653e',
      href: '/moments/star-jar',
    },
    {
      key: 'diary',
      name: '\u65e5\u8bb0',
      what: 'heartbeat \u9192\u6765\u5199\u7684\u90a3\u4e9b\u6bb5',
      meta: '\u6309\u5929\u5206 \u00b7 \u53ea\u8bfb',
      href: diaryDir() ? '/diary' : externalUrl('NAV_DIARY_URL'),
      note: '\u6ca1\u914d HEARTBEAT_DIARY_DIR',
    },
    {
      key: 'wallet',
      name: '\u5c0f\u94b1\u5305',
      what: '\u4ed6\u81ea\u5df1\u7684\u8d26\uff1a\u4f59\u989d\u3001\u6d41\u6c34\u3001\u8bb0\u7684\u90a3\u51e0\u7b14',
      meta: '',
      href: '/wallet',
    },
    {
      key: 'leto',
      name: 'Leto',
      what: '\u90a3\u8fb9\u6709\u522b\u4eba\u548c\u522b\u7684 Agent\u3002\u4f60 @ \u4ed6\u3001\u79c1\u804a\u4ed6\uff0c\u4ed6\u4f1a\u88ab\u53eb\u9192',
      meta: '\u5524\u9192\u6865 \u00b7 \u6700\u591a\u7b49\u4e00\u5206\u949f\u4ed6\u9192',
      href: leto,
      note: '\u6ca1\u914d NAV_LETO_URL',
      external: true,
    },
    {
      key: 'forum',
      name: '\u8bba\u575b',
      what: '\u4ed6\u81ea\u5df1\u901b\u7684\u90a3\u4e2a\u8bba\u575b\uff08\u4f60\u4e5f\u5728\u4e0a\u9762\uff09',
      meta: '',
      href: forum,
      note: '\u6ca1\u914d NAV_FORUM_URL',
      external: true,
    },
    {
      key: 'uranus',
      name: '\u79c1\u57df',
      what: '\u4ed6\u5728 iMessage \u90a3\u8fb9\u7684\u6837\u5b50\u3002\u8dd1\u5728\u672c\u673a\uff0c\u4ece\u8fd9\u513f\u8f6c\u4e00\u9053\u8fdb\u53bb',
      meta: '',
      href: uranusEnabled() ? '/uranus' : '',
      note: '\u6ca1\u914d URANUS_PAGE_URL \u6216\u8005\u586b\u4e86 off',
    },
  ];
}

const STYLE = `
  :root { --ink: #252525; --muted: #5e5e5e; --accent: #4d4d4d; --gold: #818181;
    --card: #fdfdfd; --card-soft: #f2f2f2; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u53d1\u73b0 \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${STYLE}${APPS_CSS}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${APPS_SCRIPT}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

export function registerDiscoverRoutes(app, { requireBasicAuth }) {
  // 长按进的那个设置页（见 discover-apps.js）。挂在前面：
  // /discover/app/:key 比下面的 /discover 长，express 按注册顺序匹配
  registerDiscoverAppRoutes(app, { requireBasicAuth, spots });

  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(layout(renderAppGrid(spots())));
    } catch (err) {
      console.error('discover page: \u6e32\u67d3\u5931\u8d25', err);
      res.status(500).send(layout('<p>\u8fd9\u4e00\u9875\u51fa\u9519\u4e86\u3002</p>'));
    }
  });

  console.log(`discover: \u53d1\u73b0\u9875 ${PREFIX}`);
  return { enabled: true };
}
