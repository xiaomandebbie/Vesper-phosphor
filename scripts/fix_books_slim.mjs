#!/usr/bin/env node
// 补上「回写时省正文」。fix_books_413.mjs 报的那两处没命中就是这两处。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_slim.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 上一版为什么没命中 ──
//
// fix_books_token.mjs 把 BRIDGE_SCRIPT 整段重写成了**模板字符串**（反引号、
// 真换行）——因为那个脚本是用字符串拼接**生成**文件内容的，落到文件里
// 是求值后的结果。而我在 fix_books_413.mjs 里的锚点却按拼接源码的样子写成
//   "  var cached = serverText;\\n' +"
// 文件里根本没这串东西。
//
// 这一版改用两种形状里都原样存在的纯文本做锚点，所以跑过 token 脚本或没跑过
// 都能命中。
//
// ── 为什么这条必须有 ──
//
// 放大 body 上限只是让导书那一次不再 413。但它的 persistShelf() 是整份写，
// 每翻一页、每写一条批注都调一次——每次都把几百 KB 正文来回搬一遍，
// 手机流量和服务器都承受不起。正文在服务器上已经有了。

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
  const n = text.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  text = text.replace(find, replace);
  changed = true;
  report.push(['ok', label]);
}

// ──── 1. 在 bridge 里加 slim() ────
//
// 注意：这段代码是往一个**模板字符串**里塞，所以里面不能出现反引号，
// 也不能出现 ${...}——否则会被 Node 当成插值跳进去求值。全用单引号和拼接。

const SLIM = `  // 服务器已经有哪几本书的正文。回写时把这几本的 text 摸掉，只传元数据和批注——
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

`;

patch('bridge 里加 slim()', {
  done: (t) => t.includes('function slim(json)'),
  find: '  var cached = serverText;',
  replace: SLIM + '  var cached = serverText;',
});

// ──── 2. 回写走 slim ────
//
// 只改 PUT /shelf 那一处。进度那条用的是 body: JSON.stringify({...})，不会误中。
// 迁移那一步用的是 xhr(... localText ...)，也不走这里——服务器此时是空的，
// 正文必须带全文，不能 slim。

patch('回写走 slim', {
  done: (t) => t.includes('body: slim(v),'),
  find: 'body: v,',
  replace: 'body: slim(v),',
});

// ──── 落盘 ────

if (changed) {
  const bak = `${FILE}.bak-slim`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-slim' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('');
