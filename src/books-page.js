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
//
// ── 这页不放底栅（2026-10-31）──
//
// 试过把底栅导览注进来，被打回来了：NEST 书架自己底部就有一条栅，
// 我那条盖在它上面，把它的按钮挡住了点不到。tabs.js 开头就写过这事：
// 那些不是我们自己排版的页面，强塞东西进去反而挡他们自己的按钮。
//
// 现在只给两样东西：左上角返回键，和右上角那个可拖的三条杠。
// 两个都在角上、都不压它的内容，要去别的页从三杠菜单进。
// TABS_CSS 还是要引：.vp-back 的样式在里头。

import express from 'express';
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
import { TABS_CSS } from './tabs.js';
import { faceAt } from './sun-time.js';
import { formatDate } from './wall-time.js';

const PREFIX = '/books';

const AI_DISPLAY = process.env.AI_DISPLAY_NAME || 'TA';

// 书架界面上你们两个的名字。bookshelf.jsx 里 SHELF_PROFILES 是空的（原作不预置
// 个人资料），留空就显示「我 / AI」。这边从 .env 读，和其他页一致。
const BOOKS_ME_NAME = String(process.env.USER_DISPLAY_NAME ?? '').trim();
const BOOKS_AI_NAME = String(process.env.AI_DISPLAY_NAME ?? '').trim();

// 书架 API 的 token。页面里那层转接必须用同步 XHR（理由见文件头），
// 而 iOS Safari 对同步请求不带 Basic 凭据，所以走 token。
// .env 里没配就自己生一个（进程内有效，重启换一个，不影响使用）。
let _booksToken = '';
export function booksApiToken() {
  if (_booksToken) return _booksToken;
  const fromEnv = String(process.env.BOOKS_API_TOKEN ?? '').trim();
  _booksToken = fromEnv || `auto-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  if (!fromEnv) console.log('books: 没配 BOOKS_API_TOKEN，本次运行自动生了一个');
  return _booksToken;
}

// Basic Auth 或 token 任一通过。页面仍由 Basic Auth 护着；
// token 只在已登录的页面 HTML 里出现，没额外放开东西。
// 书架 API 的请求体上限。全局是 1mb（见 vesper.js），对一本小说的正文不够。
// 只把这个前缀放大，别的路由不跟着动。.env 的 BOOKS_BODY_LIMIT 可改。
const BOOKS_BODY_LIMIT = String(process.env.BOOKS_BODY_LIMIT ?? '').trim() || '32mb';

function booksApiAuth(requireBasicAuth) {
  return (req, res, next) => {
    const given =
      req.get('x-books-token') ||
      (/^Bearer\s+(.+)$/i.exec(String(req.get('authorization') ?? ''))?.[1] ?? '').trim();
    if (given && given === booksApiToken()) return next();
    return requireBasicAuth(req, res, next);
  };
}

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

// 左上角返回键。TABS_SCRIPT 不在这一页跑（它跟着各页自己的 layout 走，
// 这边是注进别人的 index.html），所以这个键是写死的 HTML，不是脚本插的。
// 带 data-back：万一哪天这页也跑上了 TABS_SCRIPT，它看到就不会再插一个。
// 有来处就退回去，直接打开这一页的（比如从主屏幕）就回发现页。
const BACK_LINK =
  `<a class="vp-back" data-back data-no-stars href="/discover" aria-label="返回"` +
  ` onclick="if(window.history.length&gt;1){event.preventDefault();window.history.back();}">` +
  `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.6 5.4l-6.6 6.6 6.6 6.6 1.5-1.5-5.1-5.1 5.1-5.1z"/></svg>` +
  `<span>返回</span></a>`;

// ── 转接层 ──
//
// 为什么挂 localStorage 而不是改 bookshelf.jsx：改源码要重新 npm run build，
// 而且原作每次更新都要再改一遍。挂住让它的代码一行不动，能跟着原作升级。
// 代价就是必须跟它的键名约定——也正是上面那个坑。
const BRIDGE_SCRIPT = `(function () {
  var API = '${PREFIX}/api';
  var TOKEN = '${booksApiToken()}';
  var SHELF_KEY = '${SHELF_KEY}';
  var ANCHOR = /^nest_bookshelf_demo_reader_anchor_(.+)$/;
  var LS = window.localStorage;
  // 挂 Storage.prototype，不是实例。localStorage 是 WebIDL 的 legacy platform object，
  // 带「命名属性」特性（这就是为什么 localStorage.foo = 1 能存东西），
  // 给它赋任何属性都会变成存键值对——LS.setItem = fn 的真实效果是
  // localStorage.setItem('setItem', fn.toString())，方法根本没被覆盖。
  // （2026-10-19：回写从来没发出过，就是这个原因。）
  var PROTO = Object.getPrototypeOf(LS);
  var protoGet = PROTO.getItem;
  var protoSet = PROTO.setItem;
  var origGet = function (k) { return protoGet.call(LS, k); };
  var origSet = function (k, v) { return protoSet.call(LS, k, v); };

  // 失败要能看见。上一版把所有错误咽掉了，排查了好几轮都因为它不出声
  function warn(msg) {
    console.error('books: ' + msg);
    try {
      var bar = document.createElement('div');
      bar.textContent = '共读同步没成：' + msg;
      bar.style.cssText =
        'position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 14px;' +
        'background:#f6e6bf;color:#5a4320;font:13px/1.5 -apple-system,sans-serif;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.18)';
      bar.onclick = function () { bar.remove(); };
      (document.body || document.documentElement).appendChild(bar);
    } catch (e) {}
  }

  function xhr(method, url, body, token) {
    try {
      var x = new XMLHttpRequest();
      x.open(method, url, false);
      if (token) x.setRequestHeader('x-books-token', token);
      if (body != null) x.setRequestHeader('content-type', 'application/json');
      x.send(body == null ? null : body);
      if (x.status >= 200 && x.status < 300) return x.responseText;
      warn(method + ' ' + url + ' 返回 ' + x.status);
      return null;
    } catch (e) {
      warn(method + ' ' + url + ' 没发出去：' + e.message);
      return null;
    }
  }

  // 它的 loadDemoBooks() 是同步读的，所以开页这一下只能同步。之后都异步
  var serverText = xhr('GET', API + '/shelf', null, TOKEN);
  var server = null;
  try { server = JSON.parse(serverText); } catch (e) {}

  // 迁移：服务器还空着、而这台设备本地已经有书，先把本地那份推上去。
  // 不做这一步，她手机上已有的书会被服务器的空书架盖掉
  if (Array.isArray(server) && !server.length) {
    var localText = origGet(SHELF_KEY);
    var local = null;
    try { local = JSON.parse(localText); } catch (e) {}
    if (Array.isArray(local) && local.length) {
      console.log('books: 服务器书架是空的，把本地这', local.length, '本推上去');
      if (xhr('PUT', API + '/shelf', localText, TOKEN) != null) {
        serverText = xhr('GET', API + '/shelf', null, TOKEN);
      }
    }
  }

  // 服务器已经有哪几本书的正文。回写时把这几本的 text 摸掉，只传元数据和批注——
  // 它 persistShelf() 是整份写，每翻一页都触发一次，每次搬几百 KB 正文承受不起。
  // 新导的书不在 known 里，仍然带全文上去（服务器还没有）。
  var known = {};
  if (Array.isArray(server)) {
    server.forEach(function (b) {
      if (b && b.id && b.text && b.text[0] && (b.text[0].paragraphs || []).length) known[b.id] = 1;
    });
  }
  function slim(json) {
    var list;
    try { list = JSON.parse(json); } catch (e) { return json; }
    if (!Array.isArray(list)) return json;
    return JSON.stringify(list.map(function (b) {
      if (!b || !known[b.id]) return b;
      var copy = {};
      for (var k in b) if (k !== 'text') copy[k] = b[k];
      copy.text = [{ omitted: true }];
      return copy;
    }));
  }

  // 服务器为准。平板上那个标签页被 Safari 隔离了 localStorage（私密浏览或
  // 防跟踪切存储区），自己那份是空的；之前只在「服务器为空」时才迁移，
  // 所以它卡在「自己没有、也不去拿」。两边读同一份，就该以这边为准。
  if (Array.isArray(server) && server.length) {
    try { origSet(SHELF_KEY, serverText); } catch (e) {}
  }

  var cached = serverText;

  PROTO.getItem = function (k) {
    // sessionStorage 共用同一个 prototype，别误伤
    if (this !== LS) return protoGet.call(this, k);
    if (k === SHELF_KEY && cached) return cached;
    return origGet(k);
  };

  PROTO.setItem = function (k, v) {
    if (this !== LS) return protoSet.call(this, k, v);
    origSet(k, v);
    if (k === SHELF_KEY) {
      cached = v;
      // 整份回写。不阻塞页面；失败弹黄条，本地那份还在，不会丢东西
      try {
        fetch(API + '/shelf', {
          method: 'PUT',
          headers: { 'content-type': 'application/json', 'x-books-token': TOKEN },
          body: slim(v),
        })
          .then(function (r) { if (!r.ok) warn('回写书架返回 ' + r.status); })
          .catch(function (e) { warn('回写书架失败：' + e.message); });
      } catch (e) { warn('回写书架失败：' + e.message); }
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
        headers: { 'content-type': 'application/json', 'x-books-token': TOKEN },
        body: JSON.stringify({ book: m[1], paraIdx: a.paraIdx, offset: a.offset || 0 }),
      })
        .then(function (r) { if (!r.ok) warn('存读到哪里返回 ' + r.status); })
        .catch(function (e) { warn('存读到哪里失败：' + e.message); });
    } catch (e) {}
  };
  // 界面上的名字。原作 SHELF_PROFILES 留空时显示「我 / AI」；这边等它挂完
  // SHELF_AUTHORS 再改那两个字段，不动源码、不用重新 build。
  var ME = '${BOOKS_ME_NAME}';
  var AI = '${BOOKS_AI_NAME}';
  if (ME || AI) {
    var tries = 0;
    var tick = setInterval(function () {
      var A = window.SHELF_AUTHORS;
      if (A && A.me && A.ai) {
        if (ME) A.me.name = ME;
        if (AI) A.ai.name = AI;
        clearInterval(tick);
        return;
      }
      if (++tries > 30) clearInterval(tick);
    }, 100);
  }
  console.log(
    'books: 转接层装好了（挂在 Storage.prototype 上）。服务器书架 ' +
      (Array.isArray(server) ? server.length + ' 本' : '读不到')
  );
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
    `document.documentElement.dataset.theme=p==='light'||p==='dark'?p:'${dark ? 'dark' : 'light'}';}catch(e){}<\/script>`;

  let out = html;
  // TABS_CSS 要跟着：.vp-back 的样式在里头
const style = `<style id="vesper-skin">${CHROME_CSS}${TABS_CSS}${SKIN_CSS}</style>`;
  const headEnd = out.search(/<\/head>/i);
  out = headEnd >= 0 ? out.slice(0, headEnd) + themeInit + style + out.slice(headEnd) : themeInit + style + out;

  // 转接层要在它自己的脚本跑之前装好（loadDemoBooks() 是初始化时同步读的），
  // 所以挤在 body 开头，不是 </body> 前
  const menu = renderMenu(`${PREFIX}`, { fixed: true });
  const bridge = `<script id="vesper-books-bridge">${BRIDGE_SCRIPT}<\/script>`;
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + bridge + menu) : bridge + menu + out;

  // 只放返回键，不放底栅：NEST 自己底部就有一条栅，盖上去会把它挡住
  const bodyEnd = out.toLowerCase().lastIndexOf('</body>');
  const tail = `${BACK_LINK}<script>${CHROME_SCRIPT}<\/script>`;
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
    // 按写的时间倒序（2026-10-19）：前端 bookshelf.jsx:1089 是按 date 倒序排的，
    // 但 date 只到天——同一天的几条 localeCompare 全是 0，顺序就退回数组原序，
    // 而 annotationsIn 是按 para_idx 排的（书里的位置）。所以在这边先排好，
    // 让即使 date 相等时保留的原序也是时间倒序。前端不用改。
    const anns = annotationsIn(b.id, 0, Math.max(0, total - 1))
      .slice()
      .sort((x, y) => (y.created_at ?? 0) - (x.created_at ?? 0))
      .map((a) => ({
      id: String(a.id),
      author: a.author === 'assistant' ? 'ai' : 'me',
      chapter: 1,
      page: Math.floor(a.para_idx / 30) + 1,
      paraIdx: a.para_idx,
      // 没有真实字符位置时给 null，前端会跳过不画高亮。
      // 以前这里兜底成 0 和 quote.length，于是高亮永远从段首开始、
      // 长度等于引文——画出来的位置和引文根本不是一处（2026-10-19）。
      rangeStart: a.range_start ?? null,
      rangeEnd: a.range_end ?? null,
      color: safeColor(a.color),
      text: a.quote ?? '',
      note: a.note ?? '',
      date: formatDate(a.created_at),
      time: hhmm(a.created_at),
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
      // 她看不到他读到哪了（2026-10-19）：这边给前端的 progress 只有她自己那条，
      // 他那条压根没传过去。前端书架卡会显示 description（bookshelf.jsx 第 508/514 行），
      // 原来是空字符串，所以把他的进度写在这儿——不用改前端。
      description: (() => {
        if (!total) return '';
        const his = progressOf(b.id, 'assistant');
        const at = Math.min(his.para_idx, total);
        if (!at) return `${AI_DISPLAY} 还没开始读`;
        return `${AI_DISPLAY} 读到 ${Math.round((at / total) * 100)}%（第 ${at} 段）`;
      })(),
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
    // 正文在 text[0].paragraphs；它的段落是字符串数组。
    // bridge 对服务器已知的书会把 text 换成 [{omitted:true}]，因为正文这边已经有了——
    // 每翻一页都把整库书传一遍会 413（或者翻完流量）
    const omitted = b?.text?.[0]?.omitted === true;
    const paras = omitted
      ? []
      : (Array.isArray(b?.text?.[0]?.paragraphs) ? b.text[0].paragraphs : []).map((p) =>
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
    const existingAnns = annotationsIn(id, 0, Math.max(0, total - 1));
    const mine = new Map(existingAnns.map((a) => [a.id, a]));
    // 按内容的索引，用来查重（理由见下面那段注释）
    const annSig = (x) => [x.para_idx, x.author, String(x.note ?? '').trim()].join('\u0000');
    const byContent = new Map(existingAnns.map((x) => [annSig(x), x.id]));

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
      // 查重。前端新建的批注 id 是 "an_1760..."，服务器存的是数字——两边永远对不上，
      // 所以上面那个按 id 的判断对它永远不生效，每次都走到新建。
      // 而 persistShelf() 每翻一页都触发，于是同一条被反复新建。
      // （2026-10-19：她加一条，列表里出现好几条一样的，就是这个。）
      // 所以按内容认人：同一本书 + 同一段 + 同一个作者 + 同样的话 = 同一条。
      const sig = [
        Number(a?.paraIdx) || 0,
        a?.author === 'ai' ? 'assistant' : 'user',
        String(a?.note ?? '').trim(),
      ].join('\u0000');
      const dup = byContent.get(sig);
      if (dup) {
        // 已经有一条一样的。不新建，但要把回复补上——
        // 不然本次会话里刚写的回复会丢（那条批注在前端还是 an_xxx）
        const have = repliesOf(dup).length;
        const incoming = Array.isArray(a.comments) ? a.comments : [];
        for (const c of incoming.slice(have)) {
          const t = String(c?.text ?? '').trim();
          if (!t) continue;
          addReply({
            annotationId: dup,
            author: c?.author === 'ai' ? 'assistant' : 'user',
            content: t,
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
      byContent.set(sig, newId);
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
  const apiAuth = booksApiAuth(requireBasicAuth);

  // 诊断用：每次 /books/api/* 请求记一行。挂在 apiAuth 之前，连被 401 拦掉的也记得下——
  // 「请求没到」和「到了但被拒」是两回事，之前就是分不清这两个所以猜了好几轮。
  app.use(`${PREFIX}/api`, (req, res, next) => {
    const hasToken = Boolean(req.get('x-books-token') || req.get('authorization'));
    const len = req.get('content-length') || '0';
    console.log(
      `books: 进来一条 ${req.method} ${req.path}，${hasToken ? '带了 token' : '没带 token'}，body ${len} 字节`
    );
    next();
  });

  // 整份书架会很大（新导的书带全文）。这一句要在各条 API 之前，
  // 否则全局那个 1mb 的解析器先接走了，直接 413
  app.use(`${PREFIX}/api`, express.json({ limit: BOOKS_BODY_LIMIT }));

  // API 先挂：别让下面的静态文件接走 /books/api/*
  app.get(`${PREFIX}/api/shelf`, apiAuth, (req, res) => {
    try {
      res.set('cache-control', 'no-store').json(toShelfJson());
    } catch (err) {
      console.error('books: 读书架失败', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.put(`${PREFIX}/api/shelf`, apiAuth, (req, res) => {
    try {
      const got = Array.isArray(req.body) ? req.body.length : -1;
      console.log(`books: 收到书架 ${got} 本${got < 0 ? '（body 不是数组！）' : ''}`);
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
  app.post(`${PREFIX}/api/progress`, apiAuth, (req, res) => {
    const book = String(req.body?.book ?? '').trim();
    const paraIdx = Number(req.body?.paraIdx);
    if (!book || !Number.isInteger(paraIdx)) return res.status(400).json({ error: 'book 和 paraIdx 必填' });
    if (!getBook(book)) return res.status(404).json({ error: '没有这本书' });
    setProgress(book, 'user', paraIdx, Number(req.body?.offset) || 0);
    console.log(`books: 她读到《${getBook(book).title}》第 ${paraIdx} 段`);
    res.json({ ok: true });
  });

  // 单条批注删除（它的 removeUserAnnotation 走整份回写，这条是给以后用的）
  app.delete(`${PREFIX}/api/annotations/:id`, apiAuth, (req, res) => {
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
