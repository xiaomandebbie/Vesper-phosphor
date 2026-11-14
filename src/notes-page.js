// 笔记本的网页：/notes 列四本，/notes/:slug 读正文并且能改。
//
// 小满 2026-11-15：「笔记本建立/晨暮星的发现页面我也要能读取」
//
// 样式照拄 discover-page.js 那套 .lib 卡片（类名也一样），两页看起来是一家的。
//
// 编辑是整篇替换，和 MCP 那边同一条规矩（见 notes.js 开头那段）。
// 区别是这边允许清空：网页上看得见自己在删什么，而 MCP 那边传空串很可能是失手。
//
// 旧版本只在这里翻得到，不进 MCP——让他看旧版就又回到「旧的跟新的打架」了。
import { BOOKS, SLUGS, isBook, titleOf, readNote, writeNote, listNotes, listVersions } from './notes.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/notes';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const whoName = (a) => (a === 'user' ? USER_NAME : AI_NAME);
const when = (ts) => (ts ? formatDateTime(ts).slice(5) : '');

// 和记忆页、发现页完全同一套，再加编辑要用的几个
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
  .intro { margin: 0 0 14px; font-size: 12px; line-height: 1.7; color: var(--muted); }
  .book { padding: 16px; background: var(--card); border: 1px solid var(--line);
    border-radius: 16px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); }
  .book h1 { margin: 0 0 4px; font-size: 17px; color: var(--accent); }
  .book .sub { margin: 0 0 14px; font-size: 11px; color: var(--gold); }
  .body { white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.8; }
  .body.blank { color: #a597ab; font-style: italic; }
  textarea { width: 100%; min-height: 46vh; padding: 12px; font-size: 14px; line-height: 1.8;
    color: var(--ink); background: #fffefc; border: 1px solid var(--line); border-radius: 12px;
    font-family: inherit; resize: vertical; }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 12px; }
  button { padding: 9px 20px; font-size: 14px; color: #fffdfb; background: var(--accent);
    border: none; border-radius: 999px; font-family: inherit; }
  button:active { opacity: 0.8; }
  .back { font-size: 13px; color: var(--gold); text-decoration: none; }
  .warn { margin: 10px 0 0; font-size: 11px; line-height: 1.7; color: #a597ab; }
  .ver { margin-top: 12px; padding: 12px 14px; background: #faf7f8; border: 1px solid var(--line);
    border-radius: 12px; }
  .ver .vh { font-size: 11px; color: var(--gold); margin-bottom: 6px; }
  .ver .vb { white-space: pre-wrap; word-break: break-word; font-size: 12px; line-height: 1.7;
    color: var(--muted); max-height: 11em; overflow: hidden; }
`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script></body>
</html>`;
}

function renderList() {
  const cards = listNotes()
    .map((n) => {
      const meta = n.empty
        ? '还是空的'
        : `${n.chars} 字 · ${whoName(n.updatedBy)} ${when(n.updatedAt)} 写的`;
      return (
        `<a class="lib${n.empty ? ' off' : ''}" href="${PREFIX}/${n.slug}">` +
        `<div class="lib-in">` +
        `<span class="lib-name">${escapeHtml(n.title)}</span>` +
        `<span class="lib-what">${escapeHtml(n.what)}</span>` +
        `<span class="lib-meta">${escapeHtml(meta)}</span>` +
        `</div><span class="lib-go" aria-hidden="true">\u203a</span></a>`
      );
    })
    .join('');
  const intro =
    `<p class="intro">四本固定，不新建。${escapeHtml(AI_NAME)}开工前读对应那一本、` +
    `收工整篇写回去；你也能在这里改。每次写都是整篇替换，过时的直接删。</p>`;
  return intro + cards;
}

function renderBook(slug, { editing = false, saved = false } = {}) {
  const n = readNote(slug);
  const sub = n.content
    ? `${n.content.length} 字 · ${whoName(n.updatedBy)} ${when(n.updatedAt)} 写的`
    : '还是空的';
  const head =
    `<h1>${escapeHtml(n.title)}</h1>` +
    `<p class="sub">${escapeHtml(sub)}${saved ? ' · 刚刚存了' : ''}</p>`;

  if (editing) {
    return (
      `<div class="book">${head}` +
      `<form method="post" action="${PREFIX}/${slug}">` +
      `<textarea name="content" placeholder="规则、进度、下次从哪接">${escapeHtml(n.content)}</textarea>` +
      `<div class="row"><button type="submit">整篇存下</button>` +
      `<a class="back" href="${PREFIX}/${slug}">不改了</a></div>` +
      `<p class="warn">存下会把原来那篇整个换掉（旧的还能在下面翻到）。</p>` +
      `</form></div>`
    );
  }

  const body = n.content
    ? `<div class="body">${escapeHtml(n.content)}</div>`
    : `<div class="body blank">还没写过。${escapeHtml(AI_NAME)}下次玩完会自己写，你也可以先写几句。</div>`;

  const versions = listVersions(slug)
    .map(
      (v) =>
        `<div class="ver"><div class="vh">换掉的那篇 · ${escapeHtml(whoName(v.author))} ` +
        `${escapeHtml(when(v.ts))} · ${v.content.length} 字</div>` +
        `<div class="vb">${escapeHtml(v.content)}</div></div>`
    )
    .join('');

  return (
    `<div class="book">${head}${body}` +
    `<div class="row"><a class="lib-go" style="font-size:14px" href="${PREFIX}/${slug}?edit=1">改一改</a>` +
    `<a class="back" href="${PREFIX}">回四本</a></div></div>` +
    versions
  );
}

export function registerNoteRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(layout('笔记本 · 晨暮星', renderList()));
    } catch (err) {
      console.error('notes page: 渲染失败', err);
      res.status(500).send(layout('笔记本', '<p class="lib-what">这一页出错了。</p>'));
    }
  });

  // 整篇替换。这边允许清空：网页上看得见自己在删什么。
  app.post(`${PREFIX}/:slug`, requireBasicAuth, (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!isBook(slug)) return res.status(404).send(layout('笔记本', '<p class="lib-what">没有这本。</p>'));
    try {
      writeNote(slug, req.body?.content ?? '', 'user');
    } catch (err) {
      console.error('notes page: 写入失败', err.message);
      return res.status(500).send(layout(titleOf(slug), '<p class="lib-what">没存上。</p>'));
    }
    res.redirect(302, `${PREFIX}/${slug}?saved=1`);
  });

  app.get(`${PREFIX}/:slug`, requireBasicAuth, (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!isBook(slug)) {
      return res
        .status(404)
        .send(layout('笔记本', `<p class="lib-what">没有这本。固定四本：${escapeHtml(SLUGS.join('、'))}。</p>`));
    }
    res.set('Cache-Control', 'no-store');
    try {
      res.send(
        layout(
          `${titleOf(slug)} · 笔记本`,
          renderBook(slug, { editing: req.query.edit === '1', saved: req.query.saved === '1' })
        )
      );
    } catch (err) {
      console.error('notes page: 渲染失败', err);
      res.status(500).send(layout('笔记本', '<p class="lib-what">这一页出错了。</p>'));
    }
  });

  console.log(`notes: 笔记本 ${PREFIX}（${SLUGS.length} 本）`);
  return { enabled: true, slugs: SLUGS, books: BOOKS };
}
