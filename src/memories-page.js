// 记忆页 /memories：他的几个记忆库摆在一起。
//
// 小满 2026-10-30：「记忆我可能会装很多个库所以先把 ombre brain 作为其中的一条」
//
// 所以这一页是个**列表**，不是把 Ombre 直接开在这儿。以后多一个库
// 就往 LIBRARIES 里加一条，不动版式。
//
// 每条要说清两件事：这个库装的是什么、现在接没接上。
// 没接上的不藏起来，置灰并写明要填哪个变量——和菜单里那些「没配置」一个路子。

import { ombreDashboardBase, renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/memories';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 现在有哪几个库。以后加库就往这儿添一条。
function libraries() {
  const ombre = ombreDashboardBase();
  return [
    {
      key: 'ombre',
      name: 'Ombre Brain',
      what: '\u4ed6\u81ea\u5df1\u8bb0\u4e0b\u7684\u957f\u671f\u8bb0\u5fc6\u3002\u9192\u6765\u5148\u8bfb\u5b83\uff0c\u4e5f\u80fd\u81ea\u5df1\u641c\u3001\u81ea\u5df1\u5b58',
      href: ombre ? '/memory/' : '',
      note: '\u6ca1\u914d OMBRE_BRAIN_URL',
      meta: ombre ? '\u6d4f\u89c8 \u00b7 \u641c\u7d22 \u00b7 \u6539 \u00b7 \u5220' : '',
    },
    {
      key: 'dreams',
      name: '\u591c\u68a6',
      what: `\u4ed6\u591c\u91cc\u505a\u7684\u68a6\u3002\u6b63\u6587\u4e0d\u5728${escapeHtml(
        AI_NAME
      )}\u90a3\u8fb9\u2014\u2014\u67d0\u4e2a\u8bcd\u788e\u5230\u5b83\uff0c\u5b83\u81ea\u5df1\u4f1a\u6d6e\u4e0a\u6765`,
      href: '/dreams',
      meta: '\u4e3b\u65cb\u5f8b \u00b7 \u53ea\u8a00\u7247\u8bed \u00b7 \u60f3\u8d77\u6765\u4e4b\u540e\u7684\u5168\u6587',
    },
    {
      key: 'jar',
      name: '\u661f\u661f\u7f50',
      what: '\u54bd\u4e0b\u53bb\u7684\u8bdd\u3002\u4e00\u5929\u4e00\u9897\uff0c\u653e\u8fdb\u53bb\u4e0d\u80fd\u6539\u3001\u4e0d\u80fd\u6492',
      href: '/moments/star-jar',
      meta: '\u4f60\u4e5f\u80fd\u5f80\u91cc\u9762\u653e',
    },
    {
      key: 'books',
      name: '\u5171\u8bfb\u6279\u6ce8',
      what: '\u540c\u4e00\u672c\u4e66\u65c1\u8fb9\u5404\u81ea\u5199\u7684\u8bdd\u3002\u4ed6\u8bfb\u5230\u90a3\u6bb5\u65f6\u770b\u5f97\u89c1\u4f60\u5199\u7684',
      href: '/books',
      meta: '\u4e24\u6761\u8fdb\u5ea6\u7ebf \u00b7 \u5171\u4eab\u6279\u6ce8',
    },
  ];
}

function renderList() {
  return libraries()
    .map((lib) => {
      const inner =
        `<span class="lib-name">${lib.name}</span>` +
        `<span class="lib-what">${lib.what}</span>` +
        (lib.meta ? `<span class="lib-meta">${lib.meta}</span>` : '');
      if (!lib.href) {
        return (
          `<div class="lib off"><div class="lib-in">${inner}` +
          `<span class="lib-note">${escapeHtml(lib.note || '\u8fd8\u6ca1\u63a5\u4e0a')}</span></div></div>`
        );
      }
      return (
        `<a class="lib" href="${lib.href}"><div class="lib-in">${inner}</div>` +
        `<span class="lib-go" aria-hidden="true">\u203a</span></a>`
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
  .hero { text-align: center; margin: 6px 0 20px; }
  .title { margin: 0; font-size: 26px; font-weight: 200; letter-spacing: 0.3em; padding-left: 0.3em;
    color: #5b2e52; }
  .subtitle { margin: 5px 0 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 12px; letter-spacing: 0.18em; color: var(--muted); }
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
  .foot { margin: 22px 6px 0; font-size: 11px; line-height: 1.7; color: #a597ab; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u8bb0\u5fc6 \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function registerMemoriesRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(
      layout(`<header class="hero">
        <h1 class="title">\u8bb0\u5fc6</h1>
        <p class="subtitle" lang="en">Memories <span aria-hidden="true">\u2726</span> ${escapeHtml(
          AI_NAME
        )}</p>
      </header>
      ${renderList()}
      <p class="foot">\u4ee5\u540e\u88c5\u4e86\u65b0\u7684\u8bb0\u5fc6\u5e93\uff0c\u5c31\u5f80\u8fd9\u4e00\u9875\u6dfb\u4e00\u6761\u3002</p>`)
    );
  });

  console.log(`memories: \u8bb0\u5fc6\u9875 ${PREFIX}`);
  return { enabled: true };
}
