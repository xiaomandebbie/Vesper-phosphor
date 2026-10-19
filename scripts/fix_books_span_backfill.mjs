#!/usr/bin/env node
// 给已有的批注补上真实字符位置。只做这一件事，不改任何源文件。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_span_backfill.mjs
//
// 幂等：只管 range_start / range_end 缺位置的那几条，补过的不再动。
//
// ── 为什么单开一个脚本 ──
//
// fix_books_span_repair.mjs 里的补位置那步把 Node 打挂了：
//
//   Assertion failed: (env) != nullptr
//   at Statement::~Statement()  [better_sqlite3.node]
//
// 原因是我在那边用了 import(books.js + '?t=' + Date.now()) 做缓存击穿。
// 那个查询串让 Node 把 books.js 当成**另一个模块**重新执行了一遍，
// 于是 db.prepare() 又建了一整套 prepared statement。进程退出时，这批多
// 出来的 Statement 在环境已经拆掉之后才析构，拿到空的 env，就断言挂了。
// （不是数据库锁，也不是 vesper 占着文件。）
//
// 所以这边：
//   • 不 import books.js——找位置的逻辑在本文件里自己写一份，直接读表
//   • 跑完显式 db.close()，在环境还在的时候把 statement 收干净
//
// 找位置的规矩和 books.js 里的 quoteSpanIn 一致：书里是弯引号和长破折号，
// 他照拄时常写成直引号，所以比对前归一化，但位置换算回原文；
// 找不到就留空，前端跳过不画——宁可不画高亮，也不要画一条指错地方的。

import path from 'path';
import { pathToFileURL } from 'url';

const SRC = path.join(process.cwd(), 'src');

const QUOTE_PUNCT = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201a': "'",
  '\u201b': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u201e': '"',
  '\u201f': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2015': '-',
  '\u2212': '-',
  '\u00a0': ' ',
  '\u3000': ' ',
};

// 归一化，同时记下每个字符在原文里的下标。
// 这份 map 是关键：匹配在归一化后的串上做，位置要换算回原文，
// 不然前端 slice 出来的还是错的。
function normWithMap(s) {
  const out = [];
  const map = [];
  let prevSpace = false;
  for (let i = 0; i < s.length; i++) {
    const raw = s[i];
    if (/\s/.test(raw)) {
      if (prevSpace) continue;
      prevSpace = true;
      out.push(' ');
      map.push(i);
      continue;
    }
    prevSpace = false;
    out.push((QUOTE_PUNCT[raw] ?? raw).toLowerCase());
    map.push(i);
  }
  return { text: out.join(''), map };
}

function spanOf(full, quote) {
  const q = String(quote ?? '').trim();
  if (!q) return null;
  const P = normWithMap(String(full ?? ''));
  const Q = normWithMap(q);
  if (!Q.text) return null;

  let at = P.text.indexOf(Q.text);
  const exact = at >= 0;
  if (!exact && Q.text.length > 24) {
    // 省略号、破折号这些他可能写得不一样；用开头一截再找一次
    at = P.text.indexOf(Q.text.slice(0, 24));
  }
  if (at < 0) return null;

  const start = P.map[at];
  let end;
  if (exact) {
    const lastNorm = Math.min(at + Q.text.length - 1, P.map.length - 1);
    end = P.map[lastNorm] + 1;
  } else {
    end = Math.min(String(full ?? '').length, start + q.length);
  }
  return end > start ? [start, end] : null;
}

let db = null;
let code = 0;

try {
  const state = await import(pathToFileURL(path.join(SRC, 'state.js')).href);
  db = state.default;

  const rows = db
    .prepare(
      `SELECT a.id, a.quote, p.text AS para
         FROM book_annotations a
         LEFT JOIN book_paragraphs p
                ON p.book_id = a.book_id AND p.idx = a.para_idx
        WHERE a.quote IS NOT NULL AND TRIM(a.quote) <> ''
          AND (a.range_start IS NULL OR a.range_end IS NULL OR a.range_end <= a.range_start)
        ORDER BY a.id ASC`
    )
    .all();

  if (!rows.length) {
    console.log('');
    console.log('  没有需要补的。');
  } else {
    const up = db.prepare('UPDATE book_annotations SET range_start = ?, range_end = ? WHERE id = ?');
    let ok = 0;
    const missed = [];
    const noPara = [];

    db.transaction(() => {
      for (const r of rows) {
        if (r.para == null) {
          noPara.push(r.id);
          continue;
        }
        const span = spanOf(r.para, r.quote);
        if (!span) {
          missed.push(r.id);
          continue;
        }
        up.run(span[0], span[1], r.id);
        ok++;
      }
    })();

    console.log('');
    console.log(`  补好了 ${ok} 条（共 ${rows.length} 条缺位置）。`);
    if (missed.length) {
      console.log(`  这 ${missed.length} 条的引文在那一段里没找到，留空不画高亮：#${missed.join(' #')}`);
      console.log('  （批注本文和引文还在，只是不画那条黄底——比画错地方强。）');
    }
    if (noPara.length) {
      console.log(`  这 ${noPara.length} 条指向的段落已经不在了：#${noPara.join(' #')}`);
    }
  }

  const stat = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN range_start IS NOT NULL AND range_end > range_start THEN 1 ELSE 0 END) AS withSpan
         FROM book_annotations`
    )
    .get();
  console.log(`  现在库里 ${stat.total} 条批注，其中 ${stat.withSpan ?? 0} 条有真实位置。`);
} catch (err) {
  console.error('');
  console.error('  补位置没做成：' + err.message);
  console.error('  要是报数据库锁住：pm2 stop vesper → 跑这个脚本 → pm2 start vesper。');
  code = 1;
} finally {
  // 必须显式关：在环境还在的时候把 prepared statement 收干净。
  // 不关就是上一次那个原生断言崩溃的条件。
  try {
    db?.close?.();
  } catch {}
}

console.log('');
console.log('接下来：');
console.log('  node --check src/books.js && node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
console.log('然后把 /books 关掉重开（要重新 GET 一次才能拿到新的位置）。');
console.log('');

process.exitCode = code;
