#!/usr/bin/env node
// 一次最多读 50 段。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_chunk50.mjs
//   pm2 restart vesper phosphor --update-env
//
// 她说他读得超慢，一次多读点好。原本两处各自卡着上限：
//   books.js      BOOKS_CHUNK 上限 20，默认 6
//   books-mcp.js  CHUNK 上限 30
// 都提到 50。readOn 里用 BOOKS_CHUNK 做上限，所以唤醒和 MCP 两条路一起生效。

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

// books.js：上限 20 → 50，默认 6 → 50
patch('books.js', '上限提到 50', {
  done: (t) => t.includes('Math.min(n, 50) : 50'),
  find: 'return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 6;',
  replace: 'return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 50) : 50;',
});

// books-mcp.js：CHUNK 上限 30 → 50
patch('books-mcp.js', 'CHUNK 上限提到 50', {
  done: (t) => t.includes('Math.min(n, 50) : Math.max(BOOKS_CHUNK, 8)'),
  find: 'return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 30) : Math.max(BOOKS_CHUNK, 8);',
  replace: 'return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 50) : Math.max(BOOKS_CHUNK, 8);',
});

// books-mcp.js：book_read 的 count 上限
patch('books-mcp.js', 'book_read count 上限', {
  done: (t) => t.includes('Math.min(Number(a.count), 50)'),
  find: 'Math.min(Number(a.count), 30)',
  replace: 'Math.min(Number(a.count), 50)',
});

for (const [file, text] of touched) {
  const p = path.join(SRC, file);
  const bak = `${p}.bak-chunk50`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(`改了 ${touched.size} 个文件，备份在 .bak-chunk50。`);
console.log('');
console.log('  node --check src/books.js && node --check src/books-mcp.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
