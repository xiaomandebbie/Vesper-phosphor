#!/usr/bin/env node
// 给共读书架的 API 加一条 token 旁路，并让转接层的失败可见。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_token.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 为什么要这条旁路 ──
//
// 2026-10-19：两台设备各看各的。排到最后是这么回事：
//   curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/books/api/shelf
//   → 401
//
// 那层 bridge 必须用**同步** XHR 读书架，因为 bookshelf.jsx 里
//   const BOOKS = loadDemoBooks();
// 是模块顶层常量，页面加载那一瞬就定死了，没有异步的机会。
// 而 iOS Safari 对同步 XHR 基本不自动带 Basic 凭据，于是每次 401。
//
// 更坏的是我把失败全咽掉了（catch 里 return null，然后默默走本地），
// 所以表现就是「什么都没发生」，排了好几轮。这次让它出声。
//
// 安全边界：页面 /books 本身仍由 Basic Auth 护着，token 只在已登录的
// 页面 HTML 里出现。没登录拿不到页面，也就拿不到 token。

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'src', 'books-page.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/books-page.js，当前目录对吗？');
  process.exit(1);
}

let text = fs.readFileSync(FILE, 'utf8');
const report = [];
let changed = false;

function patch(label, { done, find, replace }) {
  if (done(text)) {
    report.push(['skip', label]);
    return;
  }
  const count = text.split(find).length - 1;
  if (count === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (count > 1) {
    report.push(['miss', `${label} — 锚点有 ${count} 处，不敢改`]);
    return;
  }
  text = text.replace(find, replace);
  changed = true;
  report.push(['ok', label]);
}

// ──── 1. 生成/读取 token ────

patch('加 booksApiToken()', {
  done: (t) => t.includes('function booksApiToken'),
  find: "const PREFIX = '/books';",
  replace: `const PREFIX = '/books';

// 书架 API 的 token。页面里那层转接必须用同步 XHR（理由见文件头），
// 而 iOS Safari 对同步请求不带 Basic 凭据，所以走 token。
// .env 里没配就自己生一个（进程内有效，重启换一个，不影响使用）。
let _booksToken = '';
export function booksApiToken() {
  if (_booksToken) return _booksToken;
  const fromEnv = String(process.env.BOOKS_API_TOKEN ?? '').trim();
  _booksToken = fromEnv || \`auto-\${Math.random().toString(36).slice(2)}\${Date.now().toString(36)}\`;
  if (!fromEnv) console.log('books: 没配 BOOKS_API_TOKEN，本次运行自动生了一个');
  return _booksToken;
}

// Basic Auth 或 token 任一通过。页面仍由 Basic Auth 护着；
// token 只在已登录的页面 HTML 里出现，没额外放开东西。
function booksApiAuth(requireBasicAuth) {
  return (req, res, next) => {
    const given =
      req.get('x-books-token') ||
      (/^Bearer\\s+(.+)$/i.exec(String(req.get('authorization') ?? ''))?.[1] ?? '').trim();
    if (given && given === booksApiToken()) return next();
    return requireBasicAuth(req, res, next);
  };
}`,
});

// ──── 2. 四条 API 改成双认证 ────

for (const [label, find, replace] of [
  [
    'GET /api/shelf',
    "app.get(`${PREFIX}/api/shelf`, requireBasicAuth,",
    'app.get(`${PREFIX}/api/shelf`, apiAuth,',
  ],
  [
    'PUT /api/shelf',
    "app.put(`${PREFIX}/api/shelf`, requireBasicAuth,",
    'app.put(`${PREFIX}/api/shelf`, apiAuth,',
  ],
  [
    'POST /api/progress',
    "app.post(`${PREFIX}/api/progress`, requireBasicAuth,",
    'app.post(`${PREFIX}/api/progress`, apiAuth,',
  ],
  [
    'DELETE /api/annotations',
    "app.delete(`${PREFIX}/api/annotations/:id`, requireBasicAuth,",
    'app.delete(`${PREFIX}/api/annotations/:id`, apiAuth,',
  ],
]) {
  patch(label, { done: (t) => t.includes(replace), find, replace });
}

patch('registerBookRoutes 里建 apiAuth', {
  done: (t) => t.includes('const apiAuth = booksApiAuth'),
  find: 'export function registerBookRoutes(app, { requireBasicAuth }) {\n  const dir = booksUiDir();',
  replace:
    'export function registerBookRoutes(app, { requireBasicAuth }) {\n' +
    '  const dir = booksUiDir();\n' +
    '  const apiAuth = booksApiAuth(requireBasicAuth);',
});

// ──── 3. bridge：带 token，并让失败出声 ────
//
// BRIDGE_SCRIPT 是个模板字符串，整段重写比逐处打补丁安全。

const BRIDGE_START = 'const BRIDGE_SCRIPT = `(function () {';
const BRIDGE_END = "\n})();`;";

if (text.includes("xhr('GET', API + '/shelf', null, TOKEN)")) {
  report.push(['skip', 'bridge 带 token']);
} else {
  const a = text.indexOf(BRIDGE_START);
  const b = text.indexOf(BRIDGE_END, a);
  if (a < 0 || b < 0) {
    report.push(['miss', 'bridge — 找不到 BRIDGE_SCRIPT 边界']);
  } else {
    const fresh =
      'const BRIDGE_SCRIPT = `(function () {\n' +
      "  var API = '${PREFIX}/api';\n" +
      "  var TOKEN = '${booksApiToken()}';\n" +
      "  var SHELF_KEY = '${SHELF_KEY}';\n" +
      '  var ANCHOR = /^nest_bookshelf_demo_reader_anchor_(.+)$/;\n' +
      '  var LS = window.localStorage;\n' +
      '  var origGet = LS.getItem.bind(LS);\n' +
      '  var origSet = LS.setItem.bind(LS);\n' +
      '\n' +
      '  // 失败要能看见。上一版把所有错误咽掉了，排查了好几轮都因为它不出声\n' +
      '  function warn(msg) {\n' +
      "    console.error('books: ' + msg);\n" +
      '    try {\n' +
      "      var bar = document.createElement('div');\n" +
      "      bar.textContent = '共读同步没成：' + msg;\n" +
      '      bar.style.cssText =\n' +
      "        'position:fixed;left:0;right:0;top:0;z-index:99999;padding:10px 14px;' +\n" +
      "        'background:#f6e6bf;color:#5a4320;font:13px/1.5 -apple-system,sans-serif;' +\n" +
      "        'box-shadow:0 2px 8px rgba(0,0,0,.18)';\n" +
      "      bar.onclick = function () { bar.remove(); };\n" +
      '      (document.body || document.documentElement).appendChild(bar);\n' +
      '    } catch (e) {}\n' +
      '  }\n' +
      '\n' +
      '  function xhr(method, url, body, token) {\n' +
      '    try {\n' +
      '      var x = new XMLHttpRequest();\n' +
      '      x.open(method, url, false);\n' +
      "      if (token) x.setRequestHeader('x-books-token', token);\n" +
      "      if (body != null) x.setRequestHeader('content-type', 'application/json');\n" +
      '      x.send(body == null ? null : body);\n' +
      '      if (x.status >= 200 && x.status < 300) return x.responseText;\n' +
      "      warn(method + ' ' + url + ' 返回 ' + x.status);\n" +
      '      return null;\n' +
      '    } catch (e) {\n' +
      "      warn(method + ' ' + url + ' 没发出去：' + e.message);\n" +
      '      return null;\n' +
      '    }\n' +
      '  }\n' +
      '\n' +
      '  // 它的 loadDemoBooks() 是同步读的，所以开页这一下只能同步。之后都异步\n' +
      "  var serverText = xhr('GET', API + '/shelf', null, TOKEN);\n" +
      '  var server = null;\n' +
      '  try { server = JSON.parse(serverText); } catch (e) {}\n' +
      '\n' +
      '  // 迁移：服务器还空着、而这台设备本地已经有书，先把本地那份推上去。\n' +
      '  // 不做这一步，她手机上已有的书会被服务器的空书架盖掉\n' +
      '  if (Array.isArray(server) && !server.length) {\n' +
      '    var localText = origGet(SHELF_KEY);\n' +
      '    var local = null;\n' +
      '    try { local = JSON.parse(localText); } catch (e) {}\n' +
      '    if (Array.isArray(local) && local.length) {\n' +
      "      console.log('books: 服务器书架是空的，把本地这', local.length, '本推上去');\n" +
      "      if (xhr('PUT', API + '/shelf', localText, TOKEN) != null) {\n" +
      "        serverText = xhr('GET', API + '/shelf', null, TOKEN);\n" +
      '      }\n' +
      '    }\n' +
      '  }\n' +
      '\n' +
      '  var cached = serverText;\n' +
      '\n' +
      '  LS.getItem = function (k) {\n' +
      '    if (k === SHELF_KEY && cached) return cached;\n' +
      '    return origGet(k);\n' +
      '  };\n' +
      '\n' +
      '  LS.setItem = function (k, v) {\n' +
      '    origSet(k, v);\n' +
      '    if (k === SHELF_KEY) {\n' +
      '      cached = v;\n' +
      '      // 整份回写。不阻塞页面；失败弹黄条，本地那份还在，不会丢东西\n' +
      '      try {\n' +
      "        fetch(API + '/shelf', {\n" +
      "          method: 'PUT',\n" +
      "          headers: { 'content-type': 'application/json', 'x-books-token': TOKEN },\n" +
      '          body: v,\n' +
      '        })\n' +
      "          .then(function (r) { if (!r.ok) warn('回写书架返回 ' + r.status); })\n" +
      "          .catch(function (e) { warn('回写书架失败：' + e.message); });\n" +
      "      } catch (e) { warn('回写书架失败：' + e.message); }\n" +
      '      return;\n' +
      '    }\n' +
      '    // 阅读位置：它每本书单独存一条 reader_anchor_<id>，形状 {paraIdx, offset}。\n' +
      '    // 单独同步，因为他和她各自一条线（这边是她那条）\n' +
      '    var m = ANCHOR.exec(k);\n' +
      '    if (!m) return;\n' +
      '    try {\n' +
      '      var a = JSON.parse(v);\n' +
      "      if (!a || typeof a.paraIdx !== 'number') return;\n" +
      "      fetch(API + '/progress', {\n" +
      "        method: 'POST',\n" +
      "        headers: { 'content-type': 'application/json', 'x-books-token': TOKEN },\n" +
      '        body: JSON.stringify({ book: m[1], paraIdx: a.paraIdx, offset: a.offset || 0 }),\n' +
      '      }).catch(function () {});\n' +
      '    } catch (e) {}\n' +
      '  };\n' +
      '})();`;';

    text = text.slice(0, a) + fresh + text.slice(b + BRIDGE_END.length);
    changed = true;
    report.push(['ok', 'bridge 重写：带 token + 失败弹黄条']);
  }
}

// ──── 落盘 ────

if (changed) {
  const bak = `${FILE}.bak-token`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-token' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('  然后用**手机**打开 /books 并强制刷新一次');
console.log('');
console.log('想固定 token（可选，不固定也能用）：');
console.log("  echo \"BOOKS_API_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d '/+=')\" >> .env");
console.log('');
