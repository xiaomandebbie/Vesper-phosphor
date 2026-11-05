// 记忆的编辑入口，挂在导览 Memory 那一条下面（/memories/manage/…）。
//
// 小满 2026-11-05：「编辑入口在导览 Memory 界面」
// 「记忆条目布局参考 aru 的做」「设置的内容也放在个人」
//
// 六块：指令、条目、长期资料、信息卡、世界书、日记。
// 设置和导入不在这儿列入口——她要求摆到个人页，所以这边只留路由。
//
// ── 条目页为什么改成气泡 ──
//
// 之前每条是「输入框 + 存 + 删 + 时间」四件套，十条就是四十个控件，
// 读起来像表格不像记忆。Aru 那边是：一条一个气泡，点进去才改，
// 右下角一个垃圾桶。所以这边按那个来：气泡里就是正文，改过了「存」才出来。
//
// Aru 条目页顶上那两个开关（读取全局条目 / 不共享到全局）没做：
// 它们管的是多位协作者之间怎么共享，晨暮星这边只有他一个。
// 做两个点了也不生效的开关，比没有更坏。

import {
  getSettings, setSetting, SETTING_DEFAULTS, RECALL_BUDGETS,
  getPrompt, savePrompt,
  listEntries, addEntry, updateEntry, dropEntry,
  listDocs, getDoc, saveDoc, dropDoc,
  listCards, getCard, saveCard, dropCard,
  listJournal, getJournal, saveJournal, dropJournal,
  counts,
} from './memory-store.js';
import {
  listBooks, getBook, saveBook, dropBook,
  listEntries as listWbEntries, getEntry as getWbEntry,
  saveEntry as saveWbEntry, dropEntry as dropWbEntry,
  POSITIONS, ROLES,
} from './world-books.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { formatDateTime } from './wall-time.js';

const P = '/memories/manage';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

const STYLE = `
  :root{--ink:#252525;--muted:#5e5e5e;--accent:#4d4d4d;--gold:#818181;
    --card:#fdfdfd;--soft:#f2f2f2;--line:#e2e2e2;--bub:#eef3fb;--bub-line:#dde6f3}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;color:var(--ink);
    font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
  main{position:relative;z-index:1;max-width:620px;margin:0 auto;padding:18px 16px 60px}
  .hero{text-align:center;margin:6px 0 14px}
  .title{margin:0;font-size:23px;font-weight:200;letter-spacing:.26em;padding-left:.26em;color:#3a3a3a}
  .subs{display:flex;gap:6px;overflow-x:auto;margin:0 -16px 16px;padding:0 16px 4px;
    -webkit-overflow-scrolling:touch}
  .subs::-webkit-scrollbar{display:none}
  .sub{flex:none;padding:7px 13px;border-radius:999px;border:1px solid var(--line);
    background:var(--card);color:var(--muted);font-size:13px;text-decoration:none;white-space:nowrap}
  .sub.on{background:#1a1a1a;color:#fdfdfd;border-color:#1a1a1a}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;
    padding:15px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .sect{margin:20px 2px 9px;font-size:12px;letter-spacing:.14em;color:var(--muted)}
  .row{display:flex;align-items:center;gap:10px}
  .row-in{flex:1;min-width:0}
  .nm{display:block;font-size:14.5px;font-weight:600;color:var(--accent)}
  .wt{display:block;margin-top:4px;font-size:12px;line-height:1.6;color:var(--muted);
    word-break:break-word}
  .go{flex:none;color:var(--gold);font-size:18px;text-decoration:none}
  label{display:block;margin:0 0 5px;font-size:12.5px;color:var(--muted)}
  input,select,textarea{width:100%;padding:9px 11px;font:inherit;font-size:16px;color:var(--ink);
    background:#fff;border:1px solid var(--line);border-radius:10px}
  textarea{min-height:110px;line-height:1.65;resize:vertical}
  .f{margin-bottom:11px}
  .two{display:flex;gap:9px}
  .two>div{flex:1;min-width:0}
  .hint{margin:6px 0 0;font-size:11.5px;line-height:1.6;color:var(--muted)}
  .hint code{padding:1px 5px;border-radius:5px;font-size:11px;background:var(--soft)}
  button{min-height:40px;padding:0 16px;border:0;border-radius:11px;background:var(--accent);
    color:#fff;font-size:14px}
  button.ghost{background:none;color:var(--accent);border:1px solid var(--line)}
  button.sm{min-height:33px;padding:0 11px;font-size:13px}
  button.danger{background:none;color:#8a2a2a;border:1px solid var(--line)}
  .acts{display:flex;flex-wrap:wrap;gap:9px;margin-top:4px}
  .tag{flex:none;font-size:10.5px;border-radius:999px;padding:2px 9px;border:1px solid var(--line);
    color:var(--muted)}
  .tag.on{background:var(--soft);color:var(--accent)}
  .sw{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:11px 0;border-top:1px solid var(--line)}
  .sw:first-child{border-top:0}
  .back{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;
    font-size:13px;color:var(--accent);text-decoration:none}
  .empty{margin:10px 2px;font-size:12.5px;line-height:1.7;color:var(--muted)}

  /* 条目：照 Aru 那个样子——输入框带一个 +，下面一条一个气泡 */
  .add{display:flex;align-items:flex-end;gap:9px;background:var(--bub);
    border:1px solid var(--bub-line);border-radius:16px;padding:11px 12px;margin-bottom:14px}
  .add textarea{flex:1;min-height:44px;background:none;border:0;padding:4px 2px;
    font-size:15px;line-height:1.6;resize:none}
  .add textarea:focus{outline:none}
  .add button{flex:none;width:40px;min-height:40px;padding:0;border-radius:50%;
    font-size:21px;line-height:1}
  .bub{background:var(--bub);border:1px solid var(--bub-line);border-radius:16px;
    padding:13px 14px 9px;margin-bottom:10px}
  .bub textarea{width:100%;min-height:0;background:none;border:0;padding:0;
    font-size:15px;line-height:1.7;color:var(--ink);resize:none;overflow:hidden}
  .bub textarea:focus{outline:none}
  .bub-foot{display:flex;align-items:center;gap:9px;margin-top:7px}
  .bub-when{flex:1;font-size:10.5px;color:#9aa6b8;font-variant-numeric:tabular-nums}
  .bub-foot button{min-height:30px;padding:0 10px;font-size:12.5px;border-radius:9px}
  .bub-foot .keep{display:none;background:#1a1a1a}
  .bub.dirty .keep{display:inline-block}
  .bub-foot .bin{background:none;border:0;color:#9aa6b8;font-size:15px;padding:0 4px;min-height:30px}
`;

const SUBS = [
  ['/prompt', '指令'],
  ['/entries', '条目'],
  ['/docs', '长期资料'],
  ['/cards', '信息卡'],
  ['/books', '世界书'],
  ['/journal', '日记'],
];

function layout(here, title, body, script) {
  const subs = SUBS.map(([p, label]) =>
    `<a class="sub${p === here ? ' on' : ''}" href="${P}${p}">${esc(label)}</a>`
  ).join('');
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}${STYLE}</style>
</head>
<body><main>${renderMenu('/memories')}
<header class="hero"><h1 class="title">${esc(title)}</h1></header>
<div class="subs">${subs}</div>
${body}</main>
${renderTabs('/memories')}
<script>${script || ''}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

const when = (ts) => (ts ? formatDateTime(ts).slice(0, 16) : '');

// ── 指令 ──

function promptPage() {
  const v = getPrompt();
  return layout('/prompt', '指令',
    `<div class="card">
      <form method="post" action="${P}/prompt">
        <div class="f">
          <label for="p">系统提示词</label>
          <textarea id="p" name="content" style="min-height:300px"
            placeholder="他是谁、怎么说话、你们之间的规矩…">${esc(v)}</textarea>
        </div>
        <div class="acts"><button type="submit">保存</button></div>
      </form>
      <p class="hint">这段摆在每次请求最前面。空着就用 <code>CHAT_PERSONA</code>
        或那段最小的底。备份里 <code>collaborator_prompts</code> 的正文就是这一格。</p>
    </div>`);
}

// ── 条目：Aru 那种气泡 ──

const ENTRY_SCRIPT = `(function () {
  // 气泡里的 textarea 跟着内容长，不出滚动条
  function grow(el) {
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
  }
  document.querySelectorAll('.bub textarea').forEach(function (el) {
    grow(el);
    var was = el.value;
    el.addEventListener('input', function () {
      grow(el);
      // 改过了「存」才出来；改回原样就再收起去
      el.closest('.bub').classList.toggle('dirty', el.value !== was);
    });
  });
  var add = document.querySelector('.add textarea');
  if (add) add.addEventListener('input', function () { grow(add); });
})();`;

function entriesPage() {
  const rows = listEntries();
  const items = rows.map((r) => `<div class="bub">
    <form method="post" action="${P}/entries/${esc(r.id)}">
      <textarea name="content" rows="1">${esc(r.content)}</textarea>
      <div class="bub-foot">
        <span class="bub-when">${esc(when(r.created_at))}</span>
        <button type="submit" class="keep">存</button>
        <button type="submit" class="bin" name="drop" value="1"
          aria-label="删掉这条" onclick="return confirm('删掉这条？')">垃</button>
      </div>
    </form>
  </div>`).join('');
  return layout('/entries', '条目记忆',
    `<form class="add" method="post" action="${P}/entries">
      <textarea name="content" rows="1"
        placeholder="写下他应该记住的事…"></textarea>
      <button type="submit" aria-label="加上">+</button>
    </form>
    ${items || '<p class="empty">还没有条目。</p>'}
    <p class="hint" style="margin:14px 2px 0">这 ${rows.length} 条每一轮都会进对话，
      所以每条保持简短。不计入每轮上限。改完才会出现「存」。</p>`,
    ENTRY_SCRIPT);
}

// ── 长期资料 ──

function docsPage() {
  const rows = listDocs();
  const items = rows.map((d) => `<div class="card row">
    <div class="row-in">
      <span class="nm">${esc(d.title)}</span>
      <span class="wt">${esc(d.summary || '')}${d.summary ? ' · ' : ''}${d.char_count || 0} 字 · ${esc(when(d.updated_at))}</span>
    </div>
    <a class="go" href="${P}/docs/${esc(d.id)}">›</a>
  </div>`).join('');
  return layout('/docs', '长期资料',
    `<div class="card">
      <form method="post" action="${P}/docs">
        <div class="f"><label for="t">新资料标题</label>
          <input id="t" name="title" placeholder="人物设定、项目背景、说明书…" /></div>
        <div class="acts"><button type="submit">新建</button></div>
      </form>
      <p class="hint">${rows.length} 份。模型平时只看到标题，需要的时候再读正文。</p>
    </div>
    ${items || '<p class="empty">还没有长期资料。</p>'}`);
}

function docPage(d) {
  return layout('/docs', d.title,
    `<div class="card">
      <form method="post" action="${P}/docs/${esc(d.id)}">
        <div class="f"><label for="t">标题</label>
          <input id="t" name="title" value="${esc(d.title)}" /></div>
        <div class="f"><label for="s">摘要（可空）</label>
          <input id="s" name="summary" value="${esc(d.summary || '')}" /></div>
        <div class="f"><label for="c">正文</label>
          <textarea id="c" name="content" style="min-height:340px">${esc(d.content)}</textarea></div>
        <div class="acts">
          <button type="submit">保存</button>
          <button type="submit" class="danger" name="drop" value="1"
            onclick="return confirm('删掉这份资料？')">删掉</button>
        </div>
      </form>
    </div>
    <a class="back" href="${P}/docs">‹ 回资料</a>`);
}

// ── 信息卡 ──

function cardsPage() {
  const rows = listCards();
  const items = rows.map((c) => `<div class="card row">
    <div class="row-in">
      <span class="nm">${esc(c.subject)}</span>
      <span class="wt">${esc(String(c.synopsis || '').slice(0, 70))}…</span>
      <span class="wt">${esc(when(c.updated_at))} · ${c.source_count || 0} 个来源</span>
    </div>
    <a class="go" href="${P}/cards/${esc(c.id)}">›</a>
  </div>`).join('');
  return layout('/cards', '信息卡',
    `<div class="card">
      <form method="post" action="${P}/cards">
        <div class="f"><label for="s">新信息卡的主题</label>
          <input id="s" name="subject" placeholder="比如：家庭背景、某个项目的进展" /></div>
        <div class="acts"><button type="submit">新建</button></div>
      </form>
      <p class="hint">${rows.length} 张。标题摆在他手边，聊到相关的人和事就把正文翻开看。</p>
    </div>
    ${items || '<p class="empty">还没有信息卡。</p>'}`);
}

function cardPage(c) {
  return layout('/cards', c.subject,
    `<div class="card">
      <form method="post" action="${P}/cards/${esc(c.id)}">
        <div class="f"><label for="s">标题</label>
          <input id="s" name="subject" value="${esc(c.subject)}" /></div>
        <div class="f"><label for="y">正文</label>
          <textarea id="y" name="synopsis" style="min-height:340px">${esc(c.synopsis)}</textarea></div>
        <div class="acts">
          <button type="submit">保存</button>
          <button type="submit" class="danger" name="drop" value="1"
            onclick="return confirm('删掉这张卡？')">删掉</button>
        </div>
      </form>
      <p class="hint">第 ${c.revision || 1} 版 · ${c.source_count || 0} 个来源。</p>
    </div>
    <a class="back" href="${P}/cards">‹ 回信息卡</a>`);
}

// ── 世界书 ──

function booksPage() {
  const books = listBooks();
  const items = books.map((b) => `<div class="card row">
    <div class="row-in">
      <span class="nm">${esc(b.title)}</span>
      <span class="wt">${b.entryCount} 条 · 扫最近 ${b.scan_depth} 条 · 预算 ${b.token_budget}</span>
    </div>
    <span class="tag${b.enabled ? ' on' : ''}">${b.enabled ? '开' : '关'}</span>
    <a class="go" href="${P}/books/${esc(b.id)}">›</a>
  </div>`).join('');
  return layout('/books', '世界书',
    `<div class="card">
      <form method="post" action="${P}/books">
        <div class="f"><label for="t">新世界书</label>
          <input id="t" name="title" placeholder="书名" /></div>
        <div class="acts"><button type="submit">新建</button></div>
      </form>
      <p class="hint">常驻条目每轮都进；其余按关键词扫最近几条消息。世界书不计入每轮上限。</p>
    </div>
    ${items || '<p class="empty">还没有世界书。</p>'}`);
}

function entryForm(bookId, e) {
  const id = e?.id || '';
  const pos = e?.position || 'after_collaborator_prompt';
  const role = e?.role || 'system';
  const opts = (map, cur) => Object.entries(map)
    .map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(v)}</option>`).join('');
  return `<div class="card">
    <form method="post" action="${P}/books/${esc(bookId)}/entries${id ? `/${esc(id)}` : ''}">
      <div class="f"><label>条目名</label>
        <input name="title" value="${esc(e?.title || '')}" placeholder="给这条起个名" /></div>
      <div class="f"><label>正文</label>
        <textarea name="content" style="min-height:150px">${esc(e?.content || '')}</textarea></div>
      <div class="sw"><span class="nm">常驻（每轮都带）</span>
        <input type="checkbox" name="constantActive" value="1" style="width:auto"
          ${e?.constantActive ? 'checked' : ''} /></div>
      <div class="f"><label>关键词（逗号或换行分隔；常驻时用不到）</label>
        <input name="keywords" value="${esc((e?.keywords || []).join('、'))}" /></div>
      <div class="f"><label>这几个要全有（可空）</label>
        <input name="requiredKeywords" value="${esc((e?.requiredKeywords || []).join('、'))}" /></div>
      <div class="f"><label>出现这几个就不进（可空）</label>
        <input name="excludedKeywords" value="${esc((e?.excludedKeywords || []).join('、'))}" /></div>
      <div class="two">
        <div class="f"><label>注入位置</label>
          <select name="position">${opts(POSITIONS, pos)}</select></div>
        <div class="f"><label>说话的人</label>
          <select name="role">${opts(ROLES, role)}</select></div>
      </div>
      <div class="two">
        <div class="f"><label>优先级</label>
          <input name="priority" type="number" value="${Number(e?.priority) || 0}" /></div>
        <div class="f"><label>扫多少条（空=跟书）</label>
          <input name="scanDepth" type="number" value="${e?.scan_depth ?? ''}" /></div>
      </div>
      <div class="f"><label>按深度插入时，插在倒数第几条前（只对「按深度插入」有效）</label>
        <input name="injectDepth" type="number" value="${e?.inject_depth ?? ''}" /></div>
      <div class="sw"><span class="nm">区分大小写</span>
        <input type="checkbox" name="caseSensitive" value="1" style="width:auto"
          ${e?.caseSensitive ? 'checked' : ''} /></div>
      <div class="sw"><span class="nm">关键词当正则用</span>
        <input type="checkbox" name="useRegex" value="1" style="width:auto"
          ${e?.useRegex ? 'checked' : ''} /></div>
      <div class="sw"><span class="nm">启用</span>
        <input type="checkbox" name="enabled" value="1" style="width:auto"
          ${e == null || e.enabled ? 'checked' : ''} /></div>
      <div class="acts">
        <button type="submit">${id ? '保存' : '加上'}</button>
        ${id ? `<button type="submit" class="danger" name="drop" value="1"
          onclick="return confirm('删掉这条？')">删掉</button>` : ''}
      </div>
    </form>
  </div>`;
}

function bookPage(b) {
  const entries = listWbEntries(b.id);
  const list = entries.map((e) => `<div class="card row">
    <div class="row-in">
      <span class="nm">${esc(e.title || '（没标题）')}</span>
      <span class="wt">${esc(String(e.content).slice(0, 60))}…</span>
      <span class="wt">${e.constantActive ? '常驻' : esc((e.keywords || []).join('、') || '没关键词')}
        · ${esc(POSITIONS[e.position] || e.position)} · 优先 ${e.priority}</span>
    </div>
    <span class="tag${e.enabled ? ' on' : ''}">${e.enabled ? '开' : '关'}</span>
    <a class="go" href="${P}/books/${esc(b.id)}/entries/${esc(e.id)}">›</a>
  </div>`).join('');
  return layout('/books', b.title,
    `<div class="card">
      <form method="post" action="${P}/books/${esc(b.id)}">
        <div class="f"><label>书名</label><input name="title" value="${esc(b.title)}" /></div>
        <div class="f"><label>说明</label><input name="description" value="${esc(b.description || '')}" /></div>
        <div class="two">
          <div class="f"><label>扫最近几条</label>
            <input name="scanDepth" type="number" value="${b.scan_depth}" /></div>
          <div class="f"><label>token 预算</label>
            <input name="tokenBudget" type="number" value="${b.token_budget}" /></div>
        </div>
        <div class="sw"><span class="nm">启用这本书</span>
          <input type="checkbox" name="enabled" value="1" style="width:auto"
            ${b.enabled ? 'checked' : ''} /></div>
        <div class="acts">
          <button type="submit">保存</button>
          <button type="submit" class="danger" name="drop" value="1"
            onclick="return confirm('删掉整本书？里面 ${entries.length} 条一起删。')">删掉整本</button>
        </div>
      </form>
    </div>
    <p class="sect">条目 ${entries.length}</p>
    ${list || '<p class="empty">这本书还没有条目。</p>'}
    <p class="sect">加一条</p>
    ${entryForm(b.id, null)}
    <a class="back" href="${P}/books">‹ 回世界书</a>`);
}

// ── 日记 ──

function journalPage() {
  const rows = listJournal();
  const items = rows.map((j) => `<div class="card row">
    <div class="row-in">
      <span class="nm">${esc(j.day)}${j.title ? ` · ${esc(j.title)}` : ''}</span>
      <span class="wt">${esc(String(j.excerpt || '').slice(0, 70))}… · ${j.len} 字</span>
    </div>
    <a class="go" href="${P}/journal/${esc(j.id)}">›</a>
  </div>`).join('');
  const today = new Date();
  const d = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return layout('/journal', '日记',
    `<div class="card">
      <form method="post" action="${P}/journal">
        <div class="two">
          <div class="f"><label>日期</label><input name="day" value="${d}" /></div>
          <div class="f"><label>标题（可空）</label><input name="title" /></div>
        </div>
        <div class="f"><label>正文</label><textarea name="content"></textarea></div>
        <div class="acts"><button type="submit">存一篇</button></div>
      </form>
      <p class="hint">${rows.length} 篇。最近几篇会进每轮对话（设置里改数量），老的靠召回。</p>
    </div>
    ${items || '<p class="empty">还没有日记。</p>'}`);
}

function journalDetail(j) {
  return layout('/journal', j.day,
    `<div class="card">
      <form method="post" action="${P}/journal/${esc(j.id)}">
        <div class="two">
          <div class="f"><label>日期</label><input name="day" value="${esc(j.day)}" /></div>
          <div class="f"><label>标题</label><input name="title" value="${esc(j.title || '')}" /></div>
        </div>
        <div class="f"><label>正文</label>
          <textarea name="content" style="min-height:340px">${esc(j.content)}</textarea></div>
        <div class="acts">
          <button type="submit">保存</button>
          <button type="submit" class="danger" name="drop" value="1"
            onclick="return confirm('删掉这篇？')">删掉</button>
        </div>
      </form>
      <p class="hint">${j.auto_rewrite ? '还允许自动重写。' : '改过之后不再自动重写。'}</p>
    </div>
    <a class="back" href="${P}/journal">‹ 回日记</a>`);
}

// ── 设置（入口在个人页）──

function settingsPage() {
  const s = getSettings();
  const sw = (key, name, note) => `<div class="sw">
    <div class="row-in"><span class="nm">${esc(name)}</span>
      ${note ? `<span class="wt">${esc(note)}</span>` : ''}</div>
    <input type="checkbox" name="${key}" value="1" style="width:auto"
      ${s[key] === '1' ? 'checked' : ''} />
  </div>`;
  const budgets = RECALL_BUDGETS.map((b) =>
    `<option value="${b}"${s.recall_budget === b ? ' selected' : ''}>${Number(b) / 1000}K</option>`).join('');
  return layout('', '记忆设置',
    `<div class="card">
      <form method="post" action="${P}/settings">
        ${sw('cross_conversation_recall', '跳对话记忆', '按当前话题把过去的内容找回来')}
        <div class="f" style="margin-top:11px"><label>每轮记忆上限</label>
          <select name="recall_budget">${budgets}</select></div>
        ${sw('maps_information_cards', '记忆目录里列信息卡', '只占标题的位置')}
        ${sw('maps_long_term_references', '记忆目录里列长期资料', '同上')}
        <div class="two" style="margin-top:11px">
          <div class="f"><label>带最近几篇日记</label>
            <input name="recent_journal_count" type="number" value="${esc(s.recent_journal_count)}" /></div>
          <div class="f"><label>每轮召回几条</label>
            <input name="recall_top_k" type="number" value="${esc(s.recall_top_k)}" /></div>
        </div>
        <div class="acts"><button type="submit">保存</button></div>
      </form>
      <p class="hint">每轮上限管的是记忆目录 + 自动召回 + 最近日记这三块，超了先减召回。
        条目记忆和世界书由你控制，不计入。</p>
    </div>
    <div class="card">
      <a class="row" href="${P}/vectors" style="text-decoration:none;color:inherit">
        <div class="row-in"><span class="nm">语义索引</span>
          <span class="wt">embedding 模型、建索引、开关</span></div>
        <span class="go">›</span>
      </a>
    </div>
    <a class="back" href="/me">‹ 回个人</a>`);
}

// ── 路由 ──

export function registerMemoryUI(app, { requireBasicAuth }) {
  const guard = (req, res) => {
    if (sameOrigin(req)) return false;
    res.status(403).send('请求来源不对');
    return true;
  };
  const page = (fn) => (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const html = fn(req);
      if (html == null) return res.redirect(303, '/memories');
      res.send(html);
    } catch (err) {
      console.error('memory ui:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  };
  const back = (res, to) => res.redirect(303, `${P}${to}`);

  // 总览就是记忆页本身（大框版），不再另做一个
  app.get(P, requireBasicAuth, (req, res) => res.redirect(302, '/memories'));

  app.get(`${P}/prompt`, requireBasicAuth, page(() => promptPage()));
  app.get(`${P}/entries`, requireBasicAuth, page(() => entriesPage()));
  app.get(`${P}/docs`, requireBasicAuth, page(() => docsPage()));
  app.get(`${P}/docs/:id`, requireBasicAuth, page((r) => {
    const d = getDoc(r.params.id);
    return d ? docPage(d) : null;
  }));
  app.get(`${P}/cards`, requireBasicAuth, page(() => cardsPage()));
  app.get(`${P}/cards/:id`, requireBasicAuth, page((r) => {
    const c = getCard(r.params.id);
    return c ? cardPage(c) : null;
  }));
  app.get(`${P}/books`, requireBasicAuth, page(() => booksPage()));
  app.get(`${P}/books/:id`, requireBasicAuth, page((r) => {
    const b = getBook(r.params.id);
    return b ? bookPage(b) : null;
  }));
  app.get(`${P}/books/:bid/entries/:id`, requireBasicAuth, page((r) => {
    const b = getBook(r.params.bid);
    const e = getWbEntry(r.params.id);
    if (!b || !e) return null;
    return layout('/books', e.title || '条目',
      entryForm(b.id, e) + `<a class="back" href="${P}/books/${esc(b.id)}">‹ 回「${esc(b.title)}」</a>`);
  }));
  app.get(`${P}/journal`, requireBasicAuth, page(() => journalPage()));
  app.get(`${P}/journal/:id`, requireBasicAuth, page((r) => {
    const j = getJournal(r.params.id);
    return j ? journalDetail(j) : null;
  }));
  app.get(`${P}/settings`, requireBasicAuth, page(() => settingsPage()));

  // ── 写 ──

  app.post(`${P}/prompt`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    savePrompt(req.body?.content);
    back(res, '/prompt');
  });

  app.post(`${P}/entries`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    addEntry(req.body?.content);
    back(res, '/entries');
  });

  app.post(`${P}/entries/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) dropEntry(req.params.id);
    else updateEntry(req.params.id, req.body?.content);
    back(res, '/entries');
  });

  app.post(`${P}/docs`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    const r = saveDoc({ title: req.body?.title, content: '' });
    back(res, r.ok ? `/docs/${r.id}` : '/docs');
  });

  app.post(`${P}/docs/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) {
      dropDoc(req.params.id);
      return back(res, '/docs');
    }
    saveDoc({ id: req.params.id, title: req.body?.title, summary: req.body?.summary, content: req.body?.content });
    back(res, `/docs/${req.params.id}`);
  });

  app.post(`${P}/cards`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    const r = saveCard({ subject: req.body?.subject, synopsis: '（还没写）' });
    back(res, r.ok ? `/cards/${r.id}` : '/cards');
  });

  app.post(`${P}/cards/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) {
      dropCard(req.params.id);
      return back(res, '/cards');
    }
    saveCard({ id: req.params.id, subject: req.body?.subject, synopsis: req.body?.synopsis });
    back(res, `/cards/${req.params.id}`);
  });

  app.post(`${P}/books`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    const r = saveBook({ title: req.body?.title, enabled: true });
    back(res, r.ok ? `/books/${r.id}` : '/books');
  });

  app.post(`${P}/books/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) {
      dropBook(req.params.id);
      return back(res, '/books');
    }
    saveBook({
      id: req.params.id,
      title: req.body?.title,
      description: req.body?.description,
      enabled: !!req.body?.enabled,
      scanDepth: req.body?.scanDepth,
      tokenBudget: req.body?.tokenBudget,
    });
    back(res, `/books/${req.params.id}`);
  });

  app.post(`${P}/books/:bid/entries`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    saveWbEntry({ ...req.body, bookId: req.params.bid, constantActive: !!req.body?.constantActive,
      caseSensitive: !!req.body?.caseSensitive, useRegex: !!req.body?.useRegex,
      enabled: !!req.body?.enabled });
    back(res, `/books/${req.params.bid}`);
  });

  app.post(`${P}/books/:bid/entries/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) {
      dropWbEntry(req.params.id);
      return back(res, `/books/${req.params.bid}`);
    }
    saveWbEntry({ ...req.body, id: req.params.id, bookId: req.params.bid,
      constantActive: !!req.body?.constantActive, caseSensitive: !!req.body?.caseSensitive,
      useRegex: !!req.body?.useRegex, enabled: !!req.body?.enabled });
    back(res, `/books/${req.params.bid}`);
  });

  app.post(`${P}/journal`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    saveJournal({ day: req.body?.day, title: req.body?.title, content: req.body?.content });
    back(res, '/journal');
  });

  app.post(`${P}/journal/:id`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    if (req.body?.drop) {
      dropJournal(req.params.id);
      return back(res, '/journal');
    }
    saveJournal({ id: req.params.id, day: req.body?.day, title: req.body?.title, content: req.body?.content });
    back(res, `/journal/${req.params.id}`);
  });

  app.post(`${P}/settings`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    // 复选框没勾时浏览器不发这个字段，所以开关要显式置 0
    for (const k of ['cross_conversation_recall', 'maps_information_cards', 'maps_long_term_references']) {
      setSetting(k, req.body?.[k] ? '1' : '0');
    }
    for (const k of ['recall_budget', 'recent_journal_count', 'recall_top_k']) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, k)) setSetting(k, req.body[k]);
    }
    back(res, '/settings');
  });

  console.log(`memory: 编辑入口 ${P}`);
  return { enabled: true };
}
