// 共读书架 /books：把 NEST 书架 UI 托在晨暮星里，并给它接上真的后端。
//
// 前端原作：NEST 书架 UI · nonchaiovo
// https://github.com/nonchaiovo/nest-bookshelf-ui
// 个人非商业使用许可：不得商用、不得打包再发布；公开展示必须署名并链接原仓库。
// 上面那一行署名是许可要求的，不能删。
//
// ── 为什么两台设备会各看各的（2026-10-19 真撞上了）──
//
// 她在手机上导了两本书，iPad 打开却是六本示例文集。不是延迟：
// 我接转接层时**猜**了它存书架的 localStorage 键名，猜错了。
//   我写的： nest_bookshelf_demo_books_v1
//   真实的： nest_bookshelf_demo_library_v1   ← bookshelf.jsx 的 DEMO_STORAGE
// library 不是 books。于是 getItem 从没把服务器的书返回给它、setItem 也从没
// 往服务器写，两边各读自己浏览器的那份，iPad 自然退回出厂的 DEFAULT_BOOKS。
//
// 教训：这种靠「约定键名」对接的地方，不能猜，要把源码读到那一行。
// 下面每个键名和字段都从 bookshelf.jsx 里抄的，改它的版本时要重新核一遍。
//
// ── 这页和 /music、/games/workkk 不同 ──
//
// 那两个是转发别的进程。书架是静态文件：一份 index.html 加一份 bookshelf.jsx，
// 没有服务端。所以这边是「发文件 + 注入一层转接层」：把它写进 localStorage
// 的那几个动作接到 /books/api/*，于是书、批注、进度落在服务器上。
//
// 为什么非得这样：小满说「晨暮星和 aru 他都要记得读了什么」。localStorage 在
// 她手机的浏览器里，哪边都读不到；只有落到同一张表上，两边才真的记得。
//
// ── 导书仍由前端解析 ──
//
// EPUB / PDF / TXT 的解析代码在 index.html 里，在浏览器里跑，文件不上传。
// 解析完得到段落数组，跟着整份书架 PUT 上来。所以服务器上存的是正文段落，
// 不是原始书文件——这是她知道并同意的代价。
//
// ── 早晚两套怎么套 ──
//
// 书架自己有浅色/深色两套，用 ?theme=light|dark 选（它文档里写的）。
// 所以主路是：早晚四张脸（sun-time.js 按长沙真实的日出日落算）映到这两套——
// dawn/day 走 light，dusk/night 走 dark。这条是它自己支持的，一定生效。
// 再叠一层 SKIN_CSS 做贴色：只追加覆盖，不改它的布局和交互。

import fs from 'fs';
import path from 'path';
import {
  listBooks,
  getBook,
  paragraphCount,
  paragraphs,
  tocOf,
  progressOf,
  setProgress,
  annotationsIn,
  repliesOf,
  addBook,
  renameBook,
  setBookStatus,
  removeBook,
  addAnnotation,
  removeAnnotation,
  addReply,
} from './books.js';
import { renderMenu, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { faceAt } from './sun-time.js';
import { formatDate } from './wall-time.js';

const PREFIX = '/books';

// ── 下面这些全部照抄 bookshelf.jsx，不要凭印象改 ──

// 它存整份书架的键（DEMO_STORAGE）
const SHELF_KEY = 'nest_bookshelf_demo_library_v1';
// 高亮颜色只有这四个。给了别的，它取 HIGHLIGHTS[color].dot 会抛错，整页白屏
const COLORS = new Set(['yellow', 'pink', 'green', 'blue']);
// 书封只有这八个（COVERS）
const COVERS = ['ink', 'sage', 'rose', 'cream', 'night', 'rust', 'bone', 'slate'];

const safeColor = (c) => (COLORS.has(String(c)) ? String(c) : 'yellow');
// 没指定书封时按 id 稳定地挑一个，别每次刷新都换颜色
const safeCover = (c, id) => {
  if (COVERS.includes(String(c))) return String(c);
  let h = 0;
  for (const ch of String(id ?? '')) h = (h * 31 + ch.codePointAt(0)) % 997;
  return COVERS[h % COVERS.length];
};
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

// 书架前端所在的目录（里面要有 index.html）。
// 没配就不挂这一页，菜单里显示灰色「没配置」。
export function booksUiDir() {
  const raw = String(process.env.BOOKS_UI_DIR ?? '').trim();
  if (!raw || /^(off|0|false|no)$/i.test(raw)) return '';
  try {
    return fs.existsSync(path.join(raw, 'index.html')) ? raw : '';
  } catch {
    return '';
  }
}

// 晨暮星的配色盖到书架上。只改颜色，不动布局、字体、圆角和动效——
// 那些是原作调好的，按它 README 的说法该原样用。
const SKIN_CSS = `
  html:root {
    --text: #2b2233; --text2: #665a70; --text3: #9b8fa6;
    --accent: #7a3e5d; --on-accent: #fffdfb;
    --bg: #f9f0ee; --bg2: #f1e7ee; --card: #fffdfb;
    --line: #eadfe6; --line-strong: #d9c9d4; --card-line: #eadfe6;
  }
  html[data-theme="dark"]:root {
    --text: #f3eefa; --text2: #c4b8d4; --text3: #9a8ead;
    --accent: #ecb0ce; --on-accent: #231c3c;
    --bg: #231c3c; --bg2: #2e2548; --card: #3c2f52;
    --line: #4b3d63; --line-strong: #604e76; --card-line: #4b3d63;
  }
`;

// ── 转接层 ──
//
// 为什么挂 localStorage 而不是改 bookshelf.jsx：改源码要重新 npm run build，
// 而且原作每次更新都要再改一遍。挂住让它的代码一行不动，能跟着原作升级。
// 代价就是必须跟它的键名约定——也正是上面那个坑。
const BRIDGE_SCRIPT = `(function () {
  var API = '${PREFIX}/api';
  var SHELF_KEY = '${SHELF_KEY}';
  var ANCHOR = /^nest_bookshelf_demo_reader_anchor_(.+)$/;
  var LS = window.localStorage;
  var origGet = LS.getItem.bind(LS);
  var origSet = LS.setItem.bind(LS);

  function xhr(method, url, body) {
    try {
      var x = new XMLHttpRequest();
      x.open(method, url, false);
      if (body != null) x.setRequestHeader('content-type', 'application/json');
      x.send(body == null ? null : body);
      return x.status >= 200 && x.status < 300 ? x.responseText : null;
    } catch (e) { return null; }
  }

  // 它的 loadDemoBooks() 是同步读的，所以开页这一下只能同步。之后都异步。
  var serverText = xhr('GET', API + '/shelf');
  var server = null;
  try { server = JSON.parse(serverText); } catch (e) {}

  // 迁移：服务器还空着、而这台设备本地已经有书，先把本地那份推上去。
  // 不做这一步，她手机上已有的书会被服务器的空书架盖掉。
  if (Array.isArray(server) && !server.length) {
    var localText = origGet(SHELF_KEY);
    var local = null;
    try { local = JSON.parse(localText); } catch (e) {}
    if (Array.isArray(local) && local.length) {
      console.log('books: 服务器书架是空的，把本地这', local.length, '本推上去');
      if (xhr('PUT', API + '/shelf', localText) != null) {
        serverText = xhr('GET', API + '/shelf');
      }
    }
  }

  var cached = serverText;

  LS.getItem = function (k) {
    if (k === SHELF_KEY && cached) return cached;
    return origGet(k);
  };

  LS.setItem = function (k, v) {
    origSet(k, v);
    if (k === SHELF_KEY) {
      cached = v;
      // 整份回写。不阻塞页面；失败只在控制台报一声，本地那份还在，不会丢东西
      try {
        fetch(API + '/shelf', {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: v,
        }).catch(function (e) { console.error('books: 同步到服务器失败', e); });
      } catch (e) { console.error('books: 同步到服务器失败', e); }
      return;
    }
    // 阅读位置：它每本书单独存一条 reader_anchor_<id>，形状 {paraIdx, offset}。
    // 单独同步，因为他和她各自一条线（这边是她那条）
    var m = ANCHOR.exec(k);
    if (!m) return;
    try {
      var a = JSON.parse(v);
      if (!a || typeof a.paraIdx !== 'number') return;
      fetch(API + '/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ book: m[1], paraIdx: a.paraIdx, offset: a.offset || 0 }),
      }).catch(function () {});
    } catch (e) {}
  };
})();`;

// 把晨暮星的外框、配色和转接层注进它的 index.html。它的代码一行不改。
function renderShell(html) {
  const f = faceAt();
  const dark = f.face === 'night' || f.face === 'dusk';
  // 主路：用它自己文档化的 theme 参数。早晚四张脸 → 浅色/深色两套。
  // 它读的是 document.documentElement.dataset.theme，所以直接设 data-theme，
  // 不改地址栏、也不触发跳转（原来用 location.replace 会把 #hash 路由搞乱）
  const themeInit =
    `<script>try{var p=new URLSearchParams(location.search).get('theme');` +
    `document.documentElement.dataset.theme=p==='light'||p==='dark'?p:'${dark ? 'dark' : 'light'}';}catch(e){}</script>`;

  let out = html;
  const style = `<style id="vesper-skin">${CHROME_CSS}${SKIN_CSS}</style>`;
  const headEnd = out.search(/<\/head>/i);
  out = headEnd >= 0 ? out.slice(0, headEnd) + themeInit + style + out.slice(headEnd) : themeInit + style + out;

  // 转接层要在它自己的脚本跑之前装好（loadDemoBooks() 是初始化时同步读的），
  // 所以挤在 body 开头，不是 </body> 前
  const menu = renderMenu(`${PREFIX}`, { fixed: true });
  const bridge = `<script id="vesper-books-bridge">${BRIDGE_SCRIPT}</script>`;
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + bridge + menu) : bridge + menu + out;

  const bodyEnd = out.toLowerCase().lastIndexOf('</body>');
  const tail = `<script>${CHROME_SCRIPT}</script>`;
  return bodyEnd >= 0 ? out.slice(0, bodyEnd) + tail + out.slice(bodyEnd) : out + tail;
}

// ── 把库里的书排成它认的形状 ──
//
// 字段照抄 bookshelf.jsx 的 demoBook()。少给字段会出事：loadDemoBooks() 校验
// 每本书都要有 id/title/annotations/text，有一本不合格就整份判为无效、
// 退回 DEFAULT_BOOKS——也就是又看见那六本示例。
function toShelfJson() {
  return listBooks().map((b) => {
    const total = paragraphCount(b.id);
    const paras = total ? paragraphs(b.id, 0, total).map((p) => p.text) : [];
    const hers = progressOf(b.id, 'user');
    const read = Math.min(hers.para_idx, Math.max(0, total));
    const anns = annotationsIn(b.id, 0, Math.max(0, total - 1)).map((a) => ({
      id: String(a.id),
      author: a.author === 'assistant' ? 'ai' : 'me',
      chapter: 1,
      page: Math.floor(a.para_idx / 30) + 1,
      paraIdx: a.para_idx,
      rangeStart: a.range_start ?? 0,
      rangeEnd: a.range_end ?? (a.quote ? Array.from(a.quote).length : 0),
      color: safeColor(a.color),
      text: a.quote ?? '',
      note: a.note ?? '',
      date: formatDate(a.created_at),
      createdAt: a.created_at,
      comments: repliesOf(a.id).map((r) => ({
        author: r.author === 'assistant' ? 'ai' : 'me',
        date: formatDate(r.created_at),
        time: hhmm(r.created_at),
        text: r.content,
      })),
    }));
    return {
      id: b.id,
      title: b.title,
      author: b.author ?? '',
      description: '',
      cover: safeCover(b.cover, b.id),
      status: b.status === 'finished' ? 'finished' : 'reading',
      progress: b.status === 'finished' ? 1 : total ? Math.min(1, read / total) : 0,
      currentPage: Math.max(1, Math.floor(read / 30) + 1),
      totalPages: Math.max(1, Math.ceil(total / 30)),
      addedAt: formatDate(b.added_at),
      lastReadAt: formatDate(hers.updated_at ?? b.added_at),
      _lastReadMs: hers.updated_at ?? b.added_at,
      finishedAt: b.finished_at ? formatDate(b.finished_at) : null,
      toc: tocOf(b.id).map((t) => ({
        title: t.title,
        page: Math.floor(t.para_idx / 30) + 1,
        paraIdx: t.para_idx,
      })),
      annotations: anns,
      text: [{ chapter: 1, page: 1, paragraphs: paras }],
    };
  });
}

// 整份书架回写。它每次 persistShelf() 都是整份写，所以这边做差分：
// 新书加进来、改过名的改名、没了的删掉、新批注和新回复写进去。
//
// 为什么不简单全删重建：那样批注 id 每次都变，而他的阅读进度按 book_id 存——
// 她在网页上随便动一下就把他读到哪里洗掉了。
function applyShelfJson(list) {
  if (!Array.isArray(list)) throw new Error('书架要是一个数组');
  const seen = new Set();
  let added = 0;
  let notes = 0;
  let replies = 0;

  for (const b of list) {
    const id = String(b?.id ?? '').trim();
    if (!id) continue;
    seen.add(id);
    const existing = getBook(id);
    // 正文在 text[0].paragraphs；它的段落是字符串数组
    const paras = (Array.isArray(b?.text?.[0]?.paragraphs) ? b.text[0].paragraphs : []).map((p) =>
      typeof p === 'string' ? p : String(p?.text ?? '')
    );

    if (!existing) {
      if (!paras.length) continue; // 没正文的不收
      addBook({
        id,
        title: String(b.title ?? '无题'),
        author: b.author ?? null,
        cover: b.cover ?? null,
        status: b.status === 'finished' ? 'finished' : 'reading',
        source: 'web',
        paragraphs: paras,
        toc: Array.isArray(b.toc) ? b.toc : [],
      });
      added++;
    } else {
      if (b.title && b.title !== existing.title) renameBook(id, b.title);
      const want = b.status === 'finished' ? 'finished' : 'reading';
      if (want !== existing.status) setBookStatus(id, want);
    }

    const total = paragraphCount(id);
    const mine = new Map(annotationsIn(id, 0, Math.max(0, total - 1)).map((a) => [a.id, a]));

    for (const a of Array.isArray(b.annotations) ? b.annotations : []) {
      const numeric = Number(a?.id);
      // 数字 id 是我们发下去的；它新建的是 "an_1760..." 这种
      if (Number.isInteger(numeric) && mine.has(numeric)) {
        // 已有的：只补新回复。comments 是它的字段名，不是 replies
        const have = repliesOf(numeric).length;
        const incoming = Array.isArray(a.comments) ? a.comments : [];
        for (const c of incoming.slice(have)) {
          const text = String(c?.text ?? '').trim();
          if (!text) continue;
          addReply({
            annotationId: numeric,
            author: c?.author === 'ai' ? 'assistant' : 'user',
            content: text,
          });
          replies++;
        }
        continue;
      }
      const newId = addAnnotation({
        bookId: id,
        paraIdx: Number(a?.paraIdx) || 0,
        rangeStart: Number.isInteger(Number(a?.rangeStart)) ? Number(a.rangeStart) : null,
        rangeEnd: Number.isInteger(Number(a?.rangeEnd)) ? Number(a.rangeEnd) : null,
        quote: a?.text ?? null, // 它的引文字段叫 text
        note: a?.note ?? null,
        color: safeColor(a?.color),
        author: a?.author === 'ai' ? 'assistant' : 'user',
      });
      notes++;
      for (const c of Array.isArray(a?.comments) ? a.comments : []) {
        const text = String(c?.text ?? '').trim();
        if (!text) continue;
        addReply({
          annotationId: newId,
          author: c?.author === 'ai' ? 'assistant' : 'user',
          content: text,
        });
        replies++;
      }
    }

    // 她在网页上读到哪了：阅读器会把 progress 写进书对象再整份回写
    const progress = Number(b?.progress);
    if (total && Number.isFinite(progress) && progress > 0) {
      const para = Math.max(0, Math.min(total, Math.round(progress * total)));
      const now = progressOf(id, 'user');
      if (para > now.para_idx) setProgress(id, 'user', para, 0);
    }
  }

  // 她在网页上删了的书
  let removed = 0;
  for (const b of listBooks()) {
    if (!seen.has(b.id)) {
      removeBook(b.id);
      removed++;
    }
  }
  return { added, notes, replies, removed };
}

export function registerBookRoutes(app, { requireBasicAuth }) {
  const dir = booksUiDir();

  // API 先挂：别让下面的静态文件接走 /books/api/*
  app.get(`${PREFIX}/api/shelf`, requireBasicAuth, (req, res) => {
    try {
      res.set('cache-control', 'no-store').json(toShelfJson());
    } catch (err) {
      console.error('books: 读书架失败', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.put(`${PREFIX}/api/shelf`, requireBasicAuth, (req, res) => {
    try {
      const out = applyShelfJson(req.body);
      if (out.added || out.notes || out.replies || out.removed) {
        console.log(
          `books: 书架同步——新书 ${out.added}、新批注 ${out.notes}、新回复 ${out.replies}、删了 ${out.removed}`
        );
      }
      res.json({ ok: true, ...out });
    } catch (err) {
      console.error('books: 写书架失败', err.message);
      res.status(400).json({ error: err.message });
    }
  });

  // 她读到哪里。和他的那条线分开存
  app.post(`${PREFIX}/api/progress`, requireBasicAuth, (req, res) => {
    const book = String(req.body?.book ?? '').trim();
    const paraIdx = Number(req.body?.paraIdx);
    if (!book || !Number.isInteger(paraIdx)) return res.status(400).json({ error: 'book 和 paraIdx 必填' });
    if (!getBook(book)) return res.status(404).json({ error: '没有这本书' });
    setProgress(book, 'user', paraIdx, Number(req.body?.offset) || 0);
    res.json({ ok: true });
  });

  // 单条批注删除（它的 removeUserAnnotation 走整份回写，这条是给以后用的）
  app.delete(`${PREFIX}/api/annotations/:id`, requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: 'id 要是数字' });
    res.json({ ok: true, removed: removeAnnotation(id) });
  });

  if (!dir) {
    console.log('books: 没配 BOOKS_UI_DIR，/books 页面没挂（API 已挂）');
    return { enabled: false, api: true };
  }

  // 页面本体：读它的 index.html，注入外框和转接层
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    try {
      const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
      res.set('cache-control', 'no-store').type('html').send(renderShell(html));
    } catch (err) {
      console.error('books: 读不到书架页面', err.message);
      res.status(500).send('读不到书架页面，检查 BOOKS_UI_DIR 指的目录里有没有 index.html。');
    }
  });

  // 它的其他静态文件（preview.png 这些）。index.html 不走这条，上面已经接走了
  app.use(
    PREFIX,
    requireBasicAuth,
    (req, res, next) => {
      if (/^\/api(\/|$)/.test(req.path)) return next();
      if (/^\/?index\.html$/i.test(req.path)) return res.redirect(302, PREFIX);
      return next();
    },
    (req, res, next) => {
      // express.static 在这个模块里没直接 import express，从 app 上取
      const serve = app.get('books:static');
      if (typeof serve === 'function') return serve(req, res, next);
      return res.status(404).send('没有这个文件');
    }
  );

  console.log(`books: 书架页面 ${PREFIX}，前端目录 ${dir}`);
  return { enabled: true, api: true, dir };
}
