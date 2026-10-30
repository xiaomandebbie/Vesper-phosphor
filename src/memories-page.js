// 记忆页 /memories：他的几个记忆库摆在一起。
//
// 小满 2026-10-30：「记忆我可能会装很多个库所以先把 ombre brain 作为其中的一条」
//
// 所以这一页是个**列表**，不是把 Ombre 直接开在这儿。以后多一个库
// 就往 LIBRARIES 里加一条，不动版式。
//
// 每条要说清两件事：这个库装的是什么、现在接没接上。
// 没接上的不藏起来，置灰并写明要填哪个变量——和菜单里那些「没配置」一个路子。
//
// 小满 2026-10-31 01:36：Latent 出货了，加成第一条。
// 它和别的库不一样：别的是「要用的时候去查」，Latent 的人格文件是「一直读着」。
// ⚠ 但这一页只是窗口：能看见四件套在不在、人格文件长什么样。
// 真正把 persona.md 拼进每次请求是 gateway 那边的事，不在这儿。

import fs from 'node:fs';
import path from 'node:path';
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

// Latent 的产出目录。ship 出货后里面有四件套。
// 认的是 persona.md 在不在——目录建了但还没 ship，不算接上。
function latentDir() {
  const dir = (process.env.LATENT_DATA_DIR || '').trim();
  if (!dir) return '';
  try {
    return fs.existsSync(path.join(dir, 'persona.md')) ? dir : '';
  } catch {
    return '';
  }
}

// 现在有哪几个库。以后加库就往这儿添一条。
function libraries() {
  const ombre = ombreDashboardBase();
  const latent = latentDir();
  return [
    {
      key: 'latent',
      name: 'Latent',
      what: '他的人格文件。不是查来的——每次开口之前它已经在那儿了',
      href: latent ? '/memories/latent' : '',
      note: '没配 LATENT_DATA_DIR，或者还没 ship',
      meta: latent ? '十二节 · 未解决清单 · 会话线索' : '',
    },
    {
      key: 'ombre',
      name: 'Ombre Brain',
      what: '他自己记下的长期记忆。醒来先读它，也能自己搜、自己存',
      href: ombre ? '/memory/' : '',
      note: '没配 OMBRE_BRAIN_URL',
      meta: ombre ? '浏览 · 搜索 · 改 · 删' : '',
    },
    {
      key: 'dreams',
      name: '夜梦',
      what: `他夜里做的梦。正文不在${escapeHtml(
        AI_NAME
      )}那边——某个词碎到它，它自己会浮上来`,
      href: '/dreams',
      meta: '主旋律 · 只言片语 · 想起来之后的全文',
    },
    {
      key: 'jar',
      name: '星星罐',
      what: '咽下去的话。一天一颗，放进去不能改、不能撒',
      href: '/moments/star-jar',
      meta: '你也能往里面放',
    },
    {
      key: 'books',
      name: '共读批注',
      what: '同一本书旁边各自写的话。他读到那段时看得见你写的',
      href: '/books',
      meta: '两条进度线 · 共享批注',
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
          `<span class="lib-note">${escapeHtml(lib.note || '还没接上')}</span></div></div>`
        );
      }
      return (
        `<a class="lib" href="${lib.href}"><div class="lib-in">${inner}</div>` +
        `<span class="lib-go" aria-hidden="true">\u203a</span></a>`
      );
    })
    .join('');
}

// Latent 详情：四件套在不在、人格文件分了哪几节。
// 只读，不在这页改任何东西——改人格文件走 memory_init.py。
function renderLatent(dir) {
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(dir, rel), 'utf8');
    } catch {
      return '';
    }
  };
  const has = (rel) => {
    try {
      return fs.existsSync(path.join(dir, rel));
    } catch {
      return false;
    }
  };

  const persona = read('persona.md');
  const hint = read('\u5f15\u5bfc\u53e5.txt').trim();

  const parts = [
    ['\u4eba\u683c\u6587\u4ef6', 'persona.md'],
    ['\u8bb0\u5fc6\u5e93', 'corpus'],
    ['\u7d22\u5f15\u6458\u8981', 'memory/index'],
    ['MCP \u914d\u7f6e', 'mcp-config.json'],
    ['\u5199\u56de\u843d\u70b9', 'corpus/timeline'],
  ]
    .map(([label, rel]) => {
      const ok = has(rel);
      return (
        `<li class="${ok ? 'on' : 'miss'}">` +
        `<span class="tick">${ok ? '\u2713' : '\u2014'}</span>` +
        `<span class="pl">${label}</span><code>${escapeHtml(rel)}</code></li>`
      );
    })
    .join('');

  // 人格文件的节标题。空节不会出现在这儿——leave_empty 的节压根没落盘。
  const heads = (persona.match(/^##\s+.+$/gm) || []).map((s) => s.replace(/^##\s+/, '').trim());
  const headList = heads.length
    ? heads.map((h) => `<span class="sec">${escapeHtml(h)}</span>`).join('')
    : '<span class="sec miss">\u4e00\u8282\u90fd\u6ca1\u6709</span>';

  const chars = persona.replace(/\s/g, '').length;

  return `<header class="hero">
      <h1 class="title">Latent</h1>
      <p class="subtitle" lang="en">Persona <span aria-hidden="true">\u2726</span> always on</p>
    </header>
    <section class="card">
      <h2>\u56db\u4ef6\u5957</h2>
      <ul class="parts">${parts}</ul>
      <p class="dir">${escapeHtml(dir)}</p>
    </section>
    <section class="card">
      <h2>\u4eba\u683c\u6587\u4ef6 \u00b7 ${heads.length} \u8282 \u00b7 ${chars} \u5b57</h2>
      <div class="secs">${headList}</div>
    </section>
    ${
      hint
        ? `<section class="card">
      <h2>\u5f15\u5bfc\u53e5</h2>
      <pre class="hint">${escapeHtml(hint)}</pre>
    </section>`
        : ''
    }
    <section class="card warn">
      <h2>\u6ce8\u5165\u8fd8\u6ca1\u63a5\u4e0a</h2>
      <p>\u8fd9\u4e00\u9875\u53ea\u662f\u7a97\u53e3\u3002\u81ea\u5efa\u524d\u7aef\u6ca1\u6709\u5bbf\u4e3b\u66ff\u4f60\u6ce8\u5165\u4eba\u683c\u6587\u4ef6\u2014\u2014
      \u8981\u8ba9\u4ed6\u771f\u7684\u8bfb\u5230\uff0c\u5f97\u628a <code>persona.md</code> \u62fc\u8fdb gateway \u6bcf\u6b21\u8bf7\u6c42\uff1a
      \u9010\u5b57\u5b8c\u6574\u3001\u6bcf\u8f6e\u90fd\u5728\u3001\u6bcf\u4f1a\u8bdd\u4ece\u78c1\u76d8\u91cd\u8bfb\u3001\u6574\u5757\u8fde\u7eed\u3001\u6613\u53d8\u5185\u5bb9\u540e\u7f6e\u3002</p>
      <p>\u9a8c\u8bc1\u6cd5\uff1a\u5f00\u65b0\u4f1a\u8bdd\u95ee\u4e00\u4ef6\u53ea\u6709\u4eba\u683c\u6587\u4ef6\u91cc\u624d\u6709\u7684\u4e8b\uff0c\u4e0d\u7ecf\u63d0\u793a\u7b54\u4e0a\u6765\u624d\u7b97\u751f\u6548\u3002</p>
    </section>
    <p class="foot"><a href="${PREFIX}">\u2039 \u56de\u8bb0\u5fc6</a></p>`;
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
  .foot a { color: var(--accent); text-decoration: none; }
  .card { margin-bottom: 12px; padding: 14px 16px; background: var(--card);
    border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); }
  .card h2 { margin: 0 0 10px; font-size: 13px; font-weight: 600; color: var(--accent); }
  .card p { margin: 0 0 8px; font-size: 12px; line-height: 1.75; color: var(--muted); }
  .card p:last-child { margin-bottom: 0; }
  .card code { font-size: 11px; color: var(--gold); background: #fdf7f2;
    border-radius: 5px; padding: 1px 5px; }
  .card.warn { background: #fffaf4; border-color: #f0e2d2; }
  .parts { list-style: none; margin: 0; padding: 0; }
  .parts li { display: flex; align-items: center; gap: 8px; padding: 5px 0;
    font-size: 12px; border-bottom: 1px dashed var(--line); }
  .parts li:last-child { border-bottom: 0; }
  .parts .tick { flex: none; width: 14px; text-align: center; color: #5a9e6f; font-size: 12px; }
  .parts li.miss .tick { color: #c9b8ce; }
  .parts .pl { flex: none; min-width: 72px; color: var(--ink); }
  .dir { margin-top: 10px !important; font-size: 11px !important; color: #a597ab !important;
    word-break: break-all; }
  .secs { display: flex; flex-wrap: wrap; gap: 6px; }
  .sec { font-size: 11px; color: var(--muted); background: #faf4f7;
    border: 1px solid var(--line); border-radius: 999px; padding: 2px 10px; }
  .sec.miss { color: #c08; background: #fff4f7; }
  .hint { margin: 0; padding: 10px 12px; background: #faf7fb; border: 1px solid var(--line);
    border-radius: 10px; font-size: 11px; line-height: 1.7; color: var(--ink);
    white-space: pre-wrap; word-break: break-word; font-family: ui-monospace, Menlo, monospace; }
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

  // Latent 详情。没配就 404，和列表里置灰那条对得上。
  app.get(`${PREFIX}/latent`, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const dir = latentDir();
    if (!dir) {
      res.status(404).send(
        layout(`<header class="hero"><h1 class="title">Latent</h1></header>
        <section class="card warn"><h2>\u8fd8\u6ca1\u63a5\u4e0a</h2>
        <p>\u6ca1\u914d <code>LATENT_DATA_DIR</code>\uff0c\u6216\u8005\u8be5\u76ee\u5f55\u4e0b\u8fd8\u6ca1\u6709 <code>persona.md</code>\u3002</p>
        <p>\u51fa\u8d27\u8d70\uff1a<code>memory_init.py --step ship</code>\u3002</p></section>
        <p class="foot"><a href="${PREFIX}">\u2039 \u56de\u8bb0\u5fc6</a></p>`)
      );
      return;
    }
    res.send(layout(renderLatent(dir)));
  });

  console.log(`memories: \u8bb0\u5fc6\u9875 ${PREFIX}`);
  return { enabled: true };
}