// 共读书架 /books：把 NEST 书架 UI 托在晨暮星里，并给它接上真的后端。
//
// 前端原作：NEST 书架 UI · nonchaiovo
// https://github.com/nonchaiovo/nest-bookshelf-ui
// 个人非商业使用许可：不得商用、不得打包再发布；公开展示必须署名并链接原仓库。
// 下面那一行署名是许可要求的，不能删。
//
// ── 这页和 /music、/games/workkk 不同 ──
//
// 那两个是转发别的进程。书架是静态文件：一份 index.html 加一份 bookshelf.jsx，
// 没有服务端。所以这边是「发文件 + 注入一层转接层」：把它原本写进
// localStorage 的那几个函数指到 /books/api/*，于是书、批注、进度落在服务器上。
//
// 为什么非得这样：小满说「晨暮星和 aru 他都要记得读了什么」。localStorage 在
// 她手机的浏览器里，哪边都读不到；只有落到同一张表上，两边才真的记得。
//
// ── 导书仍由前端解析 ──
//
// EPUB / PDF / TXT 的解析代码在 index.html 里，在浏览器里跑，文件不上传。
// 解析完得到段落数组，那个数组 POST 到 /books/api/books。
// 所以服务器上存的是正文段落，不是原始书文件——这是她知道并同意的代价。
//
// ── 早晚两套怎么套 ──
//
// 书架自己有浅色 / 深色两套，文档里写着用 ?theme=light|dark 选。
// 所以主路是：早晚四张脸（sun-time.js 按长沙真实的日出日落算）映到这两套——
// dawn/day 走 light，dusk/night 走 dark。这条是它自己支持的，一定生效。
//
// 再叠一层 SKIN_CSS 做贴色（按晨暮星的 --ink / --accent 这几个跟着脸走的变量）。
// 诚实说一句：我没能远程读完它那份 445KB 的 index.html（沙箱抓取被截断），
// 所以里面具体叫什么变量名我不确定。这层写成「命中就更贴，没命中也不坏」：
// 只追加覆盖，不改它的布局和交互。哪天在手机上看着颜色不对，改这一段就行。
//
// 菜单：和 /music/ 同理挂 data-no-stars——这页不跑 HEAD_SCRIPT（它是别人的
// 排版），进场动画的记号留着没人清，会在之后打开的页面上乱闪一次。

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

const PREFIX = '/books';

// 书架前端所在的目录（里面要有 index.html）。
// 在服务器上 git clone nest-bookshelf-ui 之后把路径填进 BOOKS_UI_DIR。
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
// 变量名按常见写法都写一遍，哪个存在哪个生效。
const SKIN_CSS = `
  html:root {
    --ink: #2b2233; --ink-soft: #4a3d52; --text: #2b2233; --fg: #2b2233;
    --muted: #665a70; --sub: #665a70; --faint: #b9adbf;
    --accent: #7a3e5d; --accent-soft: #9b4a7a; --primary: #7a3e5d; --brand: #7a3e5d;
    --gold: #b7792f; --rose: #9b4a7a;
    --bg: #f9f0ee; --page: #f9f0ee; --surface: #fffdfb; --card: #fffdfb; --paper: #fffdfb;
    --line: #eadfe6; --border: #eadfe6; --hairline: rgba(122, 62, 93, 0.14);
  }
  html[data-dark]:root {
    --ink: #f3eefa; --ink-soft: #ded4ea; --text: #f3eefa; --fg: #f3eefa;
    --muted: #c4b8d4; --sub: #c4b8d4; --faint: #9a8ead;
    --accent: #ecb0ce; --accent-soft: #d7799f; --primary: #ecb0ce; --brand: #ecb0ce;
    --gold: #f0c880; --rose: #ecb0ce;
    --bg: #231c3c; --page: #231c3c; --surface: #3c2f52; --card: #3c2f52; --paper: #3c2f52;
    --line: #604e76; --border: #604e76; --hairline: rgba(236, 176, 206, 0.18);
  }
  /* 书架自己的底色跟晨暮星的渐变走 */
  html, html body { background: linear-gradient(180deg, var(--bg1, #efe7f4) 0%, var(--bg2, #f9f0ee) 55%, var(--bg3, #fdf8f2) 100%) fixed; }
`;

// 把它写进 localStorage 的那几个函数指到我们的 API。
//
// 为什么用 fetch 拦而不是改 bookshelf.jsx：改源码要重新 npm run build，
// 而且原作每次更新都要再改一遍。拦 fetch 让它的代码一行不动，
// 能跟着原作升级。代价是要跟它的 localStorage key 约定（nest_bookshelf_demo_*）。
//
// 具体做法：把 localStorage 的读写挂钩。它读 DEMO_STORAGE 时给服务器上的书，
// 它写时同步回服务器。这样导书、写批注、改进度都自动落库。
const BRIDGE_SCRIPT = `(function () {
  var API = '${PREFIX}/api';
  var SHELF_KEY = 'nest_bookshelf_demo_books_v1';
  var LS = window.localStorage;
  var origGet = LS.getItem.bind(LS);
  var origSet = LS.setItem.bind(LS);

  // 同步读一次服务器上的书架。它的 loadDemoBooks() 是同步的，所以这里只能同步——
  // 页面初始化就这么一下，之后都是异步。
  function shelfSync() {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', API + '/shelf', false);
      x.send(null);
      return x.status === 200 ? x.responseText : null;
    } catch (e) { return null; }
  }

  var cached = shelfSync();

  LS.getItem = function (k) {
    if (k === SHELF_KEY && cached) return cached;
    return origGet(k);
  };

  LS.setItem = function (k, v) {
    origSet(k, v);
    if (k !== SHELF_KEY) return;
    cached = v;
    // 整份书架回写服务器。不阻塞页面；失败只在控制台报一声，
    // localStorage 里那份还在，不会因为网络丢东西
    try {
      fetch(API + '/shelf', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: v
      }).catch(function (e) { console.error('books: 同步到服务器失败', e); });
    } catch (e) { console.error('books: 同步到服务器失败', e); }
  };

  // 进度：它把每本书的阅读位置单独存成 nest_bookshelf_demo_reader_anchor_<id>。
  // 这个要单独同步，因为他和她各自一条线（这边是她那条）。
  var ANCHOR = /^nest_bookshelf_demo_reader_anchor_(.+)$/;
  var origSet2 = LS.setItem;
  LS.setItem = function (k, v) {
    origSet2(k, v);
    var m = ANCHOR.exec(k);
    if (!m) return;
    try {
      var a = JSON.parse(v);
      if (!a || typeof a.paraIdx !== 'number') return;
      fetch(API + '/progress', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ book: m[1], paraIdx: a.paraIdx, offset: a.offset || 0 })
      }).catch(function () {});
    } catch (e) {}
  };
})();`;

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 把晨暮星的外框、配色和转接层注进它的 index.html。
// 它的代码一行不改，只往 head 和 body 里添东西。
function renderShell(html) {
  const f = faceAt();
  const dark = f.face === 'night' || f.face === 'dusk';
  // 主路：用它自己文档化的 theme 参数。早晚四张脸 → 浅色/深色两套
  const themeInit = `<script>try{var u=new URL(location.href);if(!u.searchParams.get('theme')){u.searchParams.set('theme','${dark ? 'dark' : 'light'}');location.replace(u.href);}}catch(e){}</script>`;

  let out = html;
  const style = `<style id="vesper-skin">${CHROME_CSS}${SKIN_CSS}</style>`;
  const headEnd = out.search(/<\/head>/i);
  const headInject = `${themeInit}${style}`;
  out = headEnd >= 0 ? out.slice(0, headEnd) + headInject + out.slice(headEnd) : headInject + out;

  // 转接层要在它自己的脚本跑之前装好（它 loadDemoBooks() 是初始化时同步读的），
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
// 它的约定（README）：正文在 text[0].paragraphs，目录项的 paraIdx 指段落索引，
// 批注带段落索引、段内字符范围、颜色、作者、日期和回复列表。
function toShelfJson() {
  return listBooks().map((b) => {
    const total = paragraphCount(b.id);
    const paras = paragraphs(b.id, 0, Math.max(1, total)).map((p) => p.text);
    const hers = progressOf(b.id, 'user');
    const anns = annotationsIn(b.id, 0, Math.max(0, total - 1)).map((a) => ({
      id: String(a.id),
      paraIdx: a.para_idx,
      rangeStart: a.range_start ?? 0,
      rangeEnd: a.range_end ?? 0,
      quote: a.quote ?? '',
      note: a.note ?? '',
      color: a.color ?? 'amber',
      author: a.author === 'assistant' ? 'ai' : 'me',
      date: new Date(a.created_at).toISOString().slice(0, 10),
      replies: repliesOf(a.id).map((r) => ({
        id: String(r.id),
        author: r.author === 'assistant' ? 'ai' : 'me',
        content: r.content,
        date: new Date(r.created_at).toISOString().slice(0, 10),
      })),
    }));
    return {
      id: b.id,
      title: b.title,
      author: b.author ?? '',
      cover: b.cover ?? 'slate',
      status: b.status,
      annotations: anns,
      text: [{ paragraphs: paras }],
      toc: tocOf(b.id).map((t) => ({ title: t.title, paraIdx: t.para_idx })),
      lastRead: hers.updated_at ?? null,
      readerAnchor: { paraIdx: hers.para_idx, offset: hers.offset },
    };
  });
}

// 整份书架回写。它每次 persistShelf() 都是整份写，所以这边做差分：
// 新的书加进来、改过名的改名、没了的删掉、新批注写进去。
//
// 为什么不简单全删重建：那样他的阅读进度和批注 id 每次都会变，
// 而他的进度是按 book_id 存的——她在网页上随便动一下就把他读到哪里洗掉了。
function applyShelfJson(list) {
  if (!Array.isArray(list)) throw new Error('书架要是一个数组');
  const seen = new Set();
  let added = 0;
  let notes = 0;

  for (const b of list) {
    const id = String(b?.id ?? '').trim();
    if (!id) continue;
    seen.add(id);
    const existing = getBook(id);
    const paras = Array.isArray(b?.text?.[0]?.paragraphs) ? b.text[0].paragraphs : [];

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

    // 批注：没有数字 id 的是她刚在网页上新建的
    const total = paragraphCount(id);
    const known = new Set(annotationsIn(id, 0, Math.max(0, total - 1)).map((a) => a.id));
    for (const a of Array.isArray(b.annotations) ? b.annotations : []) {
      const numeric = Number(a?.id);
      if (Number.isInteger(numeric) && known.has(numeric)) {
        // 已有的：只看回复里有没有新的
        const have = repliesOf(numeric).length;
        const incoming = Array.isArray(a.replies) ? a.replies : [];
        for (const r of incoming.slice(have)) {
          addReply({
            annotationId: numeric,
            author: r?.author === 'ai' ? 'assistant' : 'user',
            content: String(r?.content ?? ''),
          });
        }
        continue;
      }
      addAnnotation({
        bookId: id,
        paraIdx: Number(a?.paraIdx) || 0,
        rangeStart: Number.isInteger(Number(a?.rangeStart)) ? Number(a.rangeStart) : null,
        rangeEnd: Number.isInteger(Number(a?.rangeEnd)) ? Number(a.rangeEnd) : null,
        quote: a?.quote ?? null,
        note: a?.note ?? null,
        color: a?.color ?? null,
        author: a?.author === 'ai' ? 'assistant' : 'user',
      });
      notes++;
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
  return { added, notes, removed };
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
      if (out.added || out.notes || out.removed) {
        console.log(`books: 书架同步——新书 ${out.added}、新批注 ${out.notes}、删了 ${out.removed}`);
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

  // 单条批注删除（它的 removeUserAnnotation 会走整份回写，这条是给以后用的）
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

  // 它的其他静态文件（头像、preview.png 这些）。index.html 不走这条，
  // 上面那条已经接走了；这边排在后面，只服务剩下的
  app.use(PREFIX, requireBasicAuth, (req, res, next) => {
    if (/^\/api(\/|$)/.test(req.path)) return next();
    if (/^\/?index\.html$/i.test(req.path)) return res.redirect(302, PREFIX);
    return next();
  }, (() => {
    // express.static 在这个模块里没直接 import express，从 app 上取
    const expressStatic = app.get('books:static');
    return expressStatic || ((req, res) => res.status(404).send('没有这个文件'));
  })());

  console.log(`books: 书架页面 ${PREFIX}，前端目录 ${dir}`);
  return { enabled: true, api: true, dir };
}
