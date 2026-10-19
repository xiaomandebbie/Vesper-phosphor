#!/usr/bin/env node
// 修 413：共读书架回写时请求体太大。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_413.mjs
//   node --check src/books-page.js && node --check src/vesper.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 怎么回事 ──
//
// 黄条报：PUT /books/api/shelf 返回 413。
// vesper.js 里是 app.use(express.json())，没给 limit，用默认 100kb；
// 而一本小说的正文轻松几百 KB。
//
// 两处一起改，少一条都不行：
//
//   一、给 /books/api/* 单独挂一个大一点的 json 解析器。只挂这个前缀，
//       不动全局的 1mb——别的路由没必要跟着放开。
//
//   二、别每次都传正文。它的 persistShelf() 是整份写，每翻一页、每写
//       一条批注都会调一次。而正文在服务器上已经有了，没必要来回搬。
//       bridge 回写前把「服务器已经知道的书」的 text 换成 {omitted:true}，
//       只留元数据和批注。新导的书第一次仍要带全文。
//
// 只做第一条的话，以后每翻一页都要把整库书传一遍，手机流量和服务器
// 都承受不起。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const report = [];
const touched = new Map();

const read = (f) => {
  if (touched.has(f)) return touched.get(f);
  const p = path.join(SRC, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

function patch(file, label, { done, find, replace }) {
  const text = read(file);
  if (text == null) {
    report.push(['miss', `${file} — 文件不存在`]);
    return;
  }
  if (done(text)) {
    report.push(['skip', `${file}：${label}`]);
    return;
  }
  const n = text.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${file}：${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${file}：${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  touched.set(file, text.replace(find, replace));
  report.push(['ok', `${file}：${label}`]);
}

// ──── 1. books-page.js：给 API 挂大一点的 json 解析器 ────

patch('books-page.js', 'import express', {
  done: (t) => /^import express from 'express';/m.test(t),
  find: "import fs from 'fs';",
  replace: "import express from 'express';\nimport fs from 'fs';",
});

patch('books-page.js', '书架 API 的 body 上限', {
  done: (t) => t.includes('BOOKS_BODY_LIMIT'),
  find: 'function booksApiAuth(requireBasicAuth) {',
  replace: `// 书架 API 的请求体上限。全局是 1mb（见 vesper.js），对一本小说的正文不够。
// 只把这个前缀放大，别的路由不跟着动。.env 的 BOOKS_BODY_LIMIT 可改。
const BOOKS_BODY_LIMIT = String(process.env.BOOKS_BODY_LIMIT ?? '').trim() || '32mb';

function booksApiAuth(requireBasicAuth) {`,
});

patch('books-page.js', 'API 前挂 json 解析器', {
  done: (t) => t.includes("app.use(`${PREFIX}/api`"),
  find: '  const apiAuth = booksApiAuth(requireBasicAuth);',
  replace: `  const apiAuth = booksApiAuth(requireBasicAuth);

  // 整份书架会很大（新导的书带全文）。这一句要在各条 API 之前，
  // 否则全局那个 1mb 的解析器先接走了，直接 413
  app.use(\`\${PREFIX}/api\`, express.json({ limit: BOOKS_BODY_LIMIT }));`,
});

// ──── 2. books-page.js：收下「正文省了」的书 ────
//
// applyShelfJson 里原本：没正文的书直接 continue 不收。
// 现在已知的书带 {omitted:true} 过来是正常情况，要继续走批注那段。

patch('books-page.js', '认 omitted 标记', {
  done: (t) => t.includes('omitted'),
  find: `    const existing = getBook(id);
    // 正文在 text[0].paragraphs；它的段落是字符串数组
    const paras = (Array.isArray(b?.text?.[0]?.paragraphs) ? b.text[0].paragraphs : []).map((p) =>
      typeof p === 'string' ? p : String(p?.text ?? '')
    );`,
  replace: `    const existing = getBook(id);
    // 正文在 text[0].paragraphs；它的段落是字符串数组。
    // bridge 对服务器已知的书会把 text 换成 [{omitted:true}]，因为正文这边已经有了——
    // 每翻一页都把整库书传一遍会 413（或者翻完流量）
    const omitted = b?.text?.[0]?.omitted === true;
    const paras = omitted
      ? []
      : (Array.isArray(b?.text?.[0]?.paragraphs) ? b.text[0].paragraphs : []).map((p) =>
          typeof p === 'string' ? p : String(p?.text ?? '')
        );`,
});

// ──── 3. bridge：回写前把已知书的正文摸掉 ────

patch('books-page.js', 'bridge 省正文', {
  done: (t) => t.includes('function slim('),
  find: "  var cached = serverText;\\n' +",
  replace: `  var cached = serverText;\\n' +
      '\\n' +
      '  // 服务器已经有哪几本书的正文。回写时把这几本的 text 摸掉，\\n' +
      '  // 只传元数据和批注——否则每翻一页都把整库书传一遍，直接 413\\n' +
      '  var known = {};\\n' +
      '  if (Array.isArray(server)) {\\n' +
      '    server.forEach(function (b) {\\n' +
      '      if (b && b.id && b.text && b.text[0] && (b.text[0].paragraphs || []).length) known[b.id] = 1;\\n' +
      '    });\\n' +
      '  }\\n' +
      '  function slim(json) {\\n' +
      '    var list;\\n' +
      '    try { list = JSON.parse(json); } catch (e) { return json; }\\n' +
      '    if (!Array.isArray(list)) return json;\\n' +
      '    return JSON.stringify(list.map(function (b) {\\n' +
      '      if (!b || !known[b.id]) return b;\\n' +
      '      var copy = {};\\n' +
      '      for (var k in b) if (k !== \\'text\\') copy[k] = b[k];\\n' +
      '      copy.text = [{ omitted: true }];\\n' +
      '      return copy;\\n' +
      '    }));\\n' +
      '  }\\n' +`,
});

patch('books-page.js', '回写走 slim', {
  done: (t) => t.includes('body: slim(v),'),
  find: "          body: v,\\n' +",
  replace: "          body: slim(v),\\n' +",
});

// 迁移那一步不能 slim：服务器此时是空的，正文必须带全文。
// 那边用的是 xhr(...localText...)，没走 slim，不用改。

// ──── 4. vesper.js：全局解析器别报走书架 API ────
//
// registerBookRoutes 现在在 express.json() 之后才调用，所以全局那个
// 1mb 的解析器会先把请求体吃掉。把书架 API 的路径从全局解析器里排除。

patch('vesper.js', '全局 json 跳过书架 API', {
  done: (t) => t.includes('books:skip-global-json'),
  find: 'app.use(express.json());',
  replace: `// 书架 API 要收整份正文，比这儿的上限大得多，由 books-page.js 自己挂解析器。
// 这里先跳过，否则请求体被这个 100kb/1mb 的解析器先吃掉 → 413。
// 标记：books:skip-global-json
const _globalJson = express.json();
app.use((req, res, next) => {
  if (req.path.startsWith('/books/api')) return next();
  return _globalJson(req, res, next);
});`,
});

// ──── 落盘 ────

for (const [file, text] of touched) {
  const p = path.join(SRC, file);
  const bak = `${p}.bak-413`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(`改了 ${touched.size} 个文件，备份在各自的 .bak-413。`);
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && node --check src/vesper.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('  用手机强制刷新 /books');
console.log('');
