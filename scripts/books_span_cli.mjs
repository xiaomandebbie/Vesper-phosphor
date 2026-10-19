#!/usr/bin/env node
// 给已有的批注补上真实字符位置。不碰 better-sqlite3。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/books_span_cli.mjs          ← 先看会改什么，不写库
//   node scripts/books_span_cli.mjs --write  ← 真的写进去
//
// 幂等：只管 range_start / range_end 缺位置的那几条。不用停服务。
//
// ── 为什么不再用 Node 连数据库 ──
//
// 前两个脚本都挂在同一处：
//
//   Assertion failed: (env) != nullptr
//   at Statement::~Statement()  [better_sqlite3.node]
//
// 这是 better-sqlite3 在 Node v24 下的退出期问题：prepared statement 在
// 环境已经拆掉之后才析构，RemoveEnvironmentCleanupHook 拿到空 env。
// phosphor 自己 2026-09-28 就崩过一模一样的一次。
//
// 只要 import src/state.js，就会建一整套 statement，退出时就有这个风险——
// 和脚本写什么逻辑、有没有 db.close() 都无关。我前两次改的都是错的地方。
//
// 而且 abort 会把 stdout 缓冲吃掉，所以那两次其实可能已经写成了，
// 只是什么都没打出来。这边会先把库里现在的状态读给你看。
//
// 所以这次：读写都交给 sqlite3 命令行，Node 只负责算字符位置。
// 整个脚本只用 fs / path / child_process，一个原生模块都不加载。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const DB = path.join(process.cwd(), 'data', 'state.db');
const WRITE = process.argv.includes('--write');

if (!fs.existsSync(DB)) {
  console.error(`没找到 ${DB}。先 cd /root/vesper-phosphor。`);
  process.exit(1);
}

// 带 .timeout：vesper 还跑着，偶尔会撞上写锁，等一下就好
function query(sql) {
  const out = execFileSync('sqlite3', ['-json', '-cmd', '.timeout 8000', DB, sql], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).trim();
  return out ? JSON.parse(out) : [];
}

function exec(sqlText) {
  execFileSync('sqlite3', ['-cmd', '.timeout 8000', DB], {
    input: sqlText,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  });
}

// ── 找位置的规矩（和 books.js 的 quoteSpanIn 一致） ──
//
// 书里是弯引号和长破折号，他照拄时常写成直引号，所以比对前归一化。
// 键全用带引号的 \u 转义：裸写弯引号做对象键是语法错，我上一次就栈在这儿。
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
  const whole = String(full ?? '');
  const q = String(quote ?? '').trim();
  if (!q) return null;
  const P = normWithMap(whole);
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
  const end = exact
    ? P.map[Math.min(at + Q.text.length - 1, P.map.length - 1)] + 1
    : Math.min(whole.length, start + q.length);
  return end > start ? [start, end] : null;
}

// ════ 1. 库里现在什么样 ════
//
// 前两次崩溃把输出吃掉了，所以先把实情摆出来——说不定已经写成了。

const before = query(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN range_start IS NOT NULL AND range_end > range_start THEN 1 ELSE 0 END) AS withSpan
     FROM book_annotations`
)[0] ?? { total: 0, withSpan: 0 };

console.log('');
console.log(`库里共 ${before.total} 条批注，已经有真实位置的 ${before.withSpan ?? 0} 条。`);

// ════ 2. 算位置 ════

const rows = query(
  `SELECT a.id, a.para_idx, a.quote, p.text AS para
     FROM book_annotations a
     LEFT JOIN book_paragraphs p
            ON p.book_id = a.book_id AND p.idx = a.para_idx
    WHERE a.quote IS NOT NULL AND TRIM(a.quote) <> ''
      AND (a.range_start IS NULL OR a.range_end IS NULL OR a.range_end <= a.range_start)
    ORDER BY a.id ASC`
);

if (!rows.length) {
  console.log('没有需要补的。要是页面上还错位，把 /books 关掉重开一次（要重新 GET）。');
  console.log('');
  process.exit(0);
}

const fixes = [];
const missed = [];
const noPara = [];

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
  fixes.push({ id: r.id, start: span[0], end: span[1], quote: r.quote });
}

console.log('');
console.log(`缺位置的 ${rows.length} 条里，算出来 ${fixes.length} 条：`);
for (const f of fixes) {
  const q = String(f.quote).replace(/\s+/g, ' ').trim();
  const shown = q.length > 42 ? `${q.slice(0, 42)}\u2026` : q;
  console.log(`  #${f.id}  字符 ${f.start}\u2013${f.end}  「${shown}」`);
}
if (missed.length) {
  console.log('');
  console.log(`这 ${missed.length} 条的引文在那一段里没找到，留空不画高亮：#${missed.join(' #')}`);
  console.log('（批注本文和引文还在，只是不画那条黄底——比画错地方强。）');
}
if (noPara.length) {
  console.log('');
  console.log(`这 ${noPara.length} 条指向的段落已经不在了：#${noPara.join(' #')}`);
}

// ════ 3. 写进去 ════

if (!fixes.length) {
  console.log('');
  console.log('没有能写的。');
  console.log('');
  process.exit(0);
}

if (!WRITE) {
  console.log('');
  console.log('这是试算，库没动。觉得对就真写：');
  console.log('  node scripts/books_span_cli.mjs --write');
  console.log('');
  process.exit(0);
}

// 只拼数字和 id，没有字符串进 SQL——没有转义问题
const sqlText = [
  'BEGIN;',
  ...fixes.map(
    (f) =>
      `UPDATE book_annotations SET range_start = ${Number(f.start)}, range_end = ${Number(f.end)} WHERE id = ${Number(f.id)};`
  ),
  'COMMIT;',
  '',
].join('\n');

try {
  exec(sqlText);
} catch (err) {
  console.error('');
  console.error('写库没成：' + (err.stderr || err.message));
  console.error('要是报 database is locked：pm2 stop vesper → 重跑这条 → pm2 start vesper。');
  process.exit(1);
}

const after = query(
  `SELECT COUNT(*) AS total,
          SUM(CASE WHEN range_start IS NOT NULL AND range_end > range_start THEN 1 ELSE 0 END) AS withSpan
     FROM book_annotations`
)[0] ?? { total: 0, withSpan: 0 };

console.log('');
console.log(`写完了。现在 ${after.total} 条批注里，${after.withSpan ?? 0} 条有真实位置。`);
console.log('');
console.log('把 /books 关掉重开（要重新 GET 一次才能拿到新位置）。不用重启服务。');
console.log('');
