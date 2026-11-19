// 笔记本的网页：/notes 列四本，/notes/:slug 按板块读条目、添、改、删。
//
// 小满 2026-11-15：「笔记本建立/晨暮星的发现页面我也要能读取」
// 「像笔记本这种好多个本子的点进去最新修改过的在最上面，
//  哪个有新消息就在哪里标未读的数字」「还是黑白灰配色」
// 11-19：「分为：日记，攻略，疑惑」「今天的能改。往期只能阅读」
//
// 样式照拄 discover-page.js 那套 .lib 卡片（类名也一样），两页看起来是一家的。
// 角标是唯一的例外：墨色底白字，不用微信那个红。
//
// 往期日记不给「改这条」按钮，只标一个「已封」——和 notes.js 的 canEdit
// 一个口径。就算绕过页面直接 POST，editEntry 也会拒。
import db from './state.js';
import {
  BOOKS,
  SLUGS,
  SECTIONS,
  SECTION_KEYS,
  isBook,
  isSection,
  titleOf,
  sectionTitleOf,
  listNotes,
  listEntries,
  getEntry,
  addEntry,
  editEntry,
  deleteEntry,
  markRead,
  unreadCount,
  stampOf,
  todayDiary,
  canEdit,
  sectionCounts,
} from './notes.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/notes';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 她上次看这本是什么时候。渲染时要用它分「哪几条是新的」，
// 而 markRead 一调水位就挪到现在了——所以得在那之前先读下来。
const readMarkStmt = db.prepare('SELECT ts FROM note_reads WHERE slug = ?');
const readMarkOf = (slug) => readMarkStmt.get(slug)?.ts ?? 0;

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
// 几条就写几，超过 99 写 99+
const badge = (n) => (n > 0 ? `<span class="dot">${n > 99 ? '99+' : n}</span>` : '');

// 和记忆页、发现页同一套，再加角标、板块标题和条目要用的几个
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
  .lib-go { flex: none; color: var(--gold); font-size: 18px; }
  /* 未读角标。黑白灰：墨色底、白字，不用红 */
  .dot { display: inline-block; min-width: 18px; height: 18px; padding: 0 5px; margin-left: 6px;
    font-size: 11px; line-height: 18px; text-align: center; color: #fffdfb;
    background: var(--ink); border-radius: 999px; vertical-align: 2px; font-weight: 600; }
  .intro { margin: 0 0 14px; font-size: 12px; line-height: 1.7; color: var(--muted); }
  .head { display: flex; align-items: baseline; gap: 8px; margin: 0 0 4px; }
  .head h1 { margin: 0; font-size: 17px; color: var(--accent); }
  .sub { margin: 0 0 16px; font-size: 11px; color: var(--gold); }
  .sec { margin: 0 0 8px; padding-top: 6px; font-size: 12px; font-weight: 600; color: var(--accent);
    border-top: 1px solid var(--line); }
  .sec span { font-weight: 400; color: #a597ab; margin-left: 6px; }
  .en { padding: 13px 15px; margin-bottom: 10px; background: var(--card);
    border: 1px solid var(--line); border-radius: 14px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.06); }
  .en.fresh { border-color: #cdbcc6; background: #fffefd; }
  .en.sealed { background: #faf8f9; }
  .en-top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; flex-wrap: wrap;
    font-size: 11px; color: #a597ab; }
  .en-id { color: var(--gold); font-weight: 600; }
  .en-body { white-space: pre-wrap; word-break: break-word; font-size: 14px; line-height: 1.75; }
  .en-act { margin-top: 8px; display: flex; gap: 12px; align-items: center; }
  .en-act a, .en-act button { font-size: 11px; color: #a597ab; background: none; border: none;
    padding: 0; font-family: inherit; text-decoration: none; }
  .en-act .lock { color: #c0b4c6; }
  .blank { padding: 14px 15px; margin-bottom: 10px; font-size: 13px; line-height: 1.8;
    color: #a597ab; font-style: italic; background: var(--card);
    border: 1px solid var(--line); border-radius: 14px; }
  form.add { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
  textarea { width: 100%; min-height: 7em; padding: 11px; font-size: 14px; line-height: 1.75;
    color: var(--ink); background: #fffefc; border: 1px solid var(--line); border-radius: 12px;
    font-family: inherit; resize: vertical; }
  select { padding: 7px 10px; font-size: 13px; font-family: inherit; color: var(--ink);
    background: #fffefc; border: 1px solid var(--line); border-radius: 10px; }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  button.go { padding: 8px 18px; font-size: 13px; color: #fffdfb; background: var(--ink);
    border: none; border-radius: 999px; font-family: inherit; }
  button.go:active { opacity: 0.8; }
  .back { font-size: 13px; color: var(--gold); text-decoration: none; }
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

// 四本。listNotes 已经按最后改动倒序排好了，这儿不再排。
function renderList() {
  const cards = listNotes()
    .map((n) => {
      const today = todayDiary(n.slug);
      const meta = n.empty
        ? '还是空的'
        : `${n.count} 条 · ${whoName(n.lastBy)} ${when(n.lastAt)} 改过` +
          (today ? ' · 今天写了日记' : '');
      return (
        `<a class="lib${n.empty ? ' off' : ''}" href="${PREFIX}/${n.slug}">` +
        `<div class="lib-in">` +
        `<span class="lib-name">${escapeHtml(n.title)}${badge(n.unread)}</span>` +
        `<span class="lib-what">${escapeHtml(n.what)}</span>` +
        `<span class="lib-meta">${escapeHtml(meta)}</span>` +
        `</div><span class="lib-go" aria-hidden="true">\u203a</span></a>`
      );
    })
    .join('');
  const intro =
    `<p class="intro">四本固定，不新建。每本分三块：日记、攻略、疑惑。` +
    `${escapeHtml(AI_NAME)}开工前读对应那一本、收工只改变了的那几条；你也能在这里添、改、删。` +
    `往期日记已经封了，只能读。</p>`;
  return intro + cards;
}

// 一本里的条目，按板块分段。
// mark 传 MAX 就是一条也不标新（没未读的时候）。
function renderBook(slug, { editing = null, mark = Number.MAX_SAFE_INTEGER } = {}) {
  const all = listEntries(slug);
  const counts = sectionCounts(slug);
  const today = todayDiary(slug);
  const title = titleOf(slug);

  const head =
    `<div class="head"><h1>${escapeHtml(title)}</h1></div>` +
    `<p class="sub">${
      all.length
        ? SECTION_KEYS.map((k) => `${SECTIONS[k].title} ${counts[k] ?? 0}`).join(' · ')
        : '还是空的'
    }</p>`;

  const one = (e) => {
    const fresh = e.author === 'assistant' && e.updated_at > mark;
    const editable = canEdit(e);
    const isToday = e.section === 'diary' && today && e.id === today.id;

    if (editing === e.id && editable) {
      return (
        `<div class="en"><div class="en-top"><span class="en-id">#${e.id}</span>` +
        `<span>${escapeHtml(stampOf(e))}</span></div>` +
        `<form method="post" action="${PREFIX}/${slug}/${e.id}">` +
        `<textarea name="content">${escapeHtml(e.content)}</textarea>` +
        `<div class="row"><button class="go" type="submit">存这一条</button>` +
        `<a class="back" href="${PREFIX}/${slug}">不改了</a></div></form></div>`
      );
    }

    const tag = isToday ? '<span>今天</span>' : '';
    const act = editable
      ? `<a href="${PREFIX}/${slug}?edit=${e.id}">改这条</a>` +
        `<form method="post" action="${PREFIX}/${slug}/${e.id}" style="display:inline">` +
        `<input type="hidden" name="remove" value="1" />` +
        `<button type="submit">删掉</button></form>`
      : `<span class="lock">往期日记，已经封了</span>`;

    return (
      `<div class="en${fresh ? ' fresh' : ''}${editable ? '' : ' sealed'}">` +
      `<div class="en-top"><span class="en-id">#${e.id}</span>` +
      `<span>${escapeHtml(stampOf(e))}</span>` +
      `<span>${escapeHtml(whoName(e.author))}</span>${tag}</div>` +
      `<div class="en-body">${escapeHtml(e.content)}</div>` +
      `<div class="en-act">${act}</div></div>`
    );
  };

  let body = '';
  for (const key of SECTION_KEYS) {
    const list = all.filter((e) => e.section === key);
    body +=
      `<div class="sec">${SECTIONS[key].title}` +
      `<span>${escapeHtml(SECTIONS[key].what)}</span></div>`;
    body += list.length
      ? list.map(one).join('')
      : `<div class="blank">还没有。</div>`;
  }

  // 添一条。日记今天已经有了就不给选那一类——一天一条。
  const opts = SECTION_KEYS.filter((k) => !(k === 'diary' && today))
    .map((k) => `<option value="${k}">${SECTIONS[k].title}</option>`)
    .join('');
  const add =
    `<form class="add" method="post" action="${PREFIX}/${slug}/add">` +
    `<textarea name="content" placeholder="添一条——一条写一件事"></textarea>` +
    `<div class="row"><select name="section">${opts}</select>` +
    `<button class="go" type="submit">添一条</button>` +
    `<a class="back" href="${PREFIX}">回四本</a></div>` +
    (today ? `<p class="intro" style="margin:8px 0 0">今天的日记已经开了（#${today.id}），要追就改那一条。</p>` : '') +
    `</form>`;

  return head + body + add;
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

  // 添一条。要摆在 /:slug/:id 前面：否则 add 会被当成条目编号。
  app.post(`${PREFIX}/:slug/add`, requireBasicAuth, (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!isBook(slug)) return res.status(404).send(layout('笔记本', '<p class="lib-what">没有这本。</p>'));
    const content = String(req.body?.content ?? '').trim();
    const section = String(req.body?.section ?? '').trim();
    if (content) {
      try {
        // 日记一天一条：今天已经有了就归到攻略，别默默开第二条
        const sec =
          section === 'diary' && todayDiary(slug) ? 'guide' : isSection(section) ? section : undefined;
        addEntry(slug, content, 'user', sec);
      } catch (err) {
        console.error('notes page: 添失败', err.message);
      }
    }
    res.redirect(302, `${PREFIX}/${slug}`);
  });

  // 改一条，或者删一条（remove=1）。
  app.post(`${PREFIX}/:slug/:id`, requireBasicAuth, (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!isBook(slug)) return res.status(404).send(layout('笔记本', '<p class="lib-what">没有这本。</p>'));
    const id = Number(req.params.id);
    const entry = Number.isInteger(id) ? getEntry(id) : null;
    // 跳到别的本子里去改不行：编号是全库唯一的，不拦就能跨本改
    if (!entry || entry.slug !== slug) return res.redirect(302, `${PREFIX}/${slug}`);

    try {
      if (String(req.body?.remove ?? '') === '1') deleteEntry(id);
      else {
        const content = String(req.body?.content ?? '').trim();
        // 往期日记这儿也拦一道。editEntry 自己也会拒，两道不冲突。
        if (content) editEntry(id, content, 'user');
      }
    } catch (err) {
      console.error('notes page: 改/删失败', err.message);
    }
    res.redirect(302, `${PREFIX}/${slug}`);
  });

  app.get(`${PREFIX}/:slug`, requireBasicAuth, (req, res) => {
    const slug = String(req.params.slug ?? '').trim();
    if (!isBook(slug)) {
      return res
        .status(404)
        .send(
          layout(
            '笔记本',
            `<p class="lib-what">没有这本。固定四本：${escapeHtml(SLUGS.join('、'))}。</p>`
          )
        );
    }
    res.set('Cache-Control', 'no-store');
    try {
      // 水位要在 markRead 之前读：那一调就挪到现在，之后再读就分不出哪几条是新的了。
      // 没未读的时候传 MAX，一条也不标。
      const mark = unreadCount(slug) > 0 ? readMarkOf(slug) : Number.MAX_SAFE_INTEGER;
      const editing = Number(req.query.edit);
      const html = renderBook(slug, {
        editing: Number.isInteger(editing) ? editing : null,
        mark,
      });
      markRead(slug);
      res.send(layout(`${titleOf(slug)} · 笔记本`, html));
    } catch (err) {
      console.error('notes page: 渲染失败', err);
      res.status(500).send(layout('笔记本', '<p class="lib-what">这一页出错了。</p>'));
    }
  });

  console.log(`notes: 笔记本 ${PREFIX}（${SLUGS.length} 本 × ${SECTION_KEYS.length} 板块）`);
  return { enabled: true, slugs: SLUGS, books: BOOKS, sections: SECTION_KEYS };
}
