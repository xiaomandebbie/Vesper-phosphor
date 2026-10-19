#!/usr/bin/env node
// 修上一个脚本写坏的那一块，并把批注位置补完。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_span_repair.mjs
//   node --check src/books.js && node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper phosphor --update-env
//
// 幂等，重复跑不会出错。
//
// ── 怎么回事 ──
//
// fix_books_quote_span.mjs 把 QUOTE_PUNCT 写成了：
//
//   const QUOTE_PUNCT = {
//     ‘: "'", ’: "'", ...
//   };
//
// 弯引号被裸写成了对象键名。JS 里标点做键必须加引号（标识符不能是
// 标点），所以 books.js 直接语法错。那个脚本最后「补位置」也失败，
// 是同一个原因：它要 import books.js，而文件已经编译不过。
//
// 这次把键写成带引号的 \u 转义，全 ASCII，不再给编辑器和补丁脚本留坑。
//
// 它不依赖上一个脚本跑到哪一步：
//   • 坏块还在 → 整块换成合法的
//   • 已经是合法的 → 跳过
//   • 整个块不在（回滚过） → 说清楚，让你先跑 fix_books_quote_span.mjs

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const SRC = path.join(process.cwd(), 'src');
const BOOKS = path.join(SRC, 'books.js');

if (!fs.existsSync(BOOKS)) {
  console.error('没找到 src/books.js。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

let text = fs.readFileSync(BOOKS, 'utf8');
const report = [];
let changed = false;

// ════ 1. 整块换掉 QUOTE_PUNCT ════
//
// 不去匹配那些坏字符本身（重现它们又是一次转义赌博），而是按前后锚点
// 圈出范围：从 `const QUOTE_PUNCT = {` 到紧跟的第一个 `};`。

const HEAD = 'const QUOTE_PUNCT = {';
const GOOD = [
  'const QUOTE_PUNCT = {',
  '  // 键写成带引号的 \\u 转义：裸写弯引号做对象键是语法错（标点不能当标识符）。',
  "  '\\u2018': \"'\",",
  "  '\\u2019': \"'\",",
  "  '\\u201a': \"'\",",
  "  '\\u201b': \"'\",",
  "  '\\u201c': '\"',",
  "  '\\u201d': '\"',",
  "  '\\u201e': '\"',",
  "  '\\u201f': '\"',",
  "  '\\u2013': '-',",
  "  '\\u2014': '-',",
  "  '\\u2015': '-',",
  "  '\\u2212': '-',",
  "  '\\u00a0': ' ',",
  "  '\\u3000': ' ',",
  '};',
].join('\n');

const at = text.indexOf(HEAD);
if (at < 0) {
  report.push(['miss', 'QUOTE_PUNCT — 整个块不在，先跑 fix_books_quote_span.mjs']);
} else {
  const close = text.indexOf('};', at);
  if (close < 0) {
    report.push(['miss', 'QUOTE_PUNCT — 找不到结尾的 };，不敢改']);
  } else {
    const block = text.slice(at, close + 2);
    if (block === GOOD) {
      report.push(['skip', 'QUOTE_PUNCT 已经是合法的']);
    } else {
      text = text.slice(0, at) + GOOD + text.slice(close + 2);
      changed = true;
      report.push(['ok', 'QUOTE_PUNCT 重写成带引号的 \\u 转义']);
    }
  }
}

if (changed) {
  const bak = `${BOOKS}.bak-repair`;
  if (!fs.existsSync(bak)) fs.copyFileSync(BOOKS, bak);
  fs.writeFileSync(BOOKS, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? `已写回 src/books.js（改前那份备在 .bak-repair）` : '代码没改动。');

// ════ 2. 先自己验一遍语法 ════
//
// 上一次就是写出了编译不过的文件、自己没发现，直到 node --check 才报。
// 这次在脚本里就 import 一下，不过关就不往下走。

console.log('');
console.log('验一遍 books.js 能不能加载…');

let books = null;
try {
  books = await import(`${pathToFileURL(BOOKS).href}?t=${Date.now()}`);
  console.log('  能加载。');
} catch (err) {
  console.error('  还是不行：' + err.message);
  console.error('');
  console.error('  别重启。把上面这句贴回来，或者先回滚：');
  console.error('    cp src/books.js.bak-span src/books.js');
  process.exit(1);
}

// ════ 3. 给已有的批注补真位置 ════

console.log('');
console.log('给已有的批注补真位置…');

if (typeof books.quoteSpanIn !== 'function') {
  console.error('  books.js 里没有 quoteSpanIn——先跑 node scripts/fix_books_quote_span.mjs。');
} else {
  try {
    const state = await import(pathToFileURL(path.join(SRC, 'state.js')).href);
    const db = state.default;

    const rows = db
      .prepare(
        `SELECT id, book_id, para_idx, quote
           FROM book_annotations
          WHERE quote IS NOT NULL AND TRIM(quote) <> ''
            AND (range_start IS NULL OR range_end IS NULL OR range_end <= range_start)
          ORDER BY id ASC`
      )
      .all();

    if (!rows.length) {
      console.log('  没有需要补的。');
    } else {
      const up = db.prepare('UPDATE book_annotations SET range_start = ?, range_end = ? WHERE id = ?');
      let ok = 0;
      const missed = [];
      db.transaction(() => {
        for (const r of rows) {
          const span = books.quoteSpanIn(r.book_id, r.para_idx, r.quote);
          if (!span) {
            missed.push(r.id);
            continue;
          }
          up.run(span[0], span[1], r.id);
          ok++;
        }
      })();
      console.log(`  补好了 ${ok} 条（共 ${rows.length} 条缺位置）。`);
      if (missed.length) {
        console.log(`  这 ${missed.length} 条的引文在那一段里没找到，留空不画高亮：#${missed.join(' #')}`);
        console.log('  （批注本文和引文还在，只是不画那条黄底——比画错地方强。）');
      }
    }
  } catch (err) {
    console.error('  补位置没做成：' + err.message);
    console.error('  要是报数据库锁住：pm2 stop vesper → 跑这个脚本 → pm2 start vesper。');
  }
}

console.log('');
console.log('接下来：');
console.log('  node --check src/books.js && node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
console.log('然后把 /books 关掉重开（要重新 GET 一次才能拿到新的位置）。');
console.log('');
