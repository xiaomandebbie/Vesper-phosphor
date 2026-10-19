#!/usr/bin/env node
// 批注顺序乱、后面那些没时间。
//
// 小满 2026-10-19：「批注顺序好乱，后面都没标时间了，不知道哪个是哪个时候的」
//
// 根因不在前端。bookshelf.jsx 第 1089 行本来就是按 date 倒序排的：
//   [...book.annotations].sort((a, b) => (b.date || '').localeCompare(a.date || ''))
// 但我们给的 date 是 formatDate()，只有年月日。同一天写的几条 localeCompare 全返回 0，
// 于是顺序退回数组原序——而 annotationsIn 是 `ORDER BY para_idx ASC, id ASC`，
// 按书里的位置排。所以今天写在第 5 段的会排在上个月第 200 段那条前面。
//
// 两处改动：
//   一、给前端的数组按 created_at 倒序。这样即使 date 相等，稳定排序保留的
//       原序也已经是按时间倒序的。前端一行不动。
//   二、批注补上 time 字段（评论本来就有 date + time，批注只有 date，
//       这就是「后面都没标时间」）。
//
// 注意：time 存进去了，但前端第 1227 行只渲染 relDate(a.date)，第 1810 行
// 推批注行时也没带 time——要让时分真的显示出来还得改 bookshelf.jsx 重新 build。
// 这一步没做：先把顺序正过来，那是「哪个是哪个时候的」里更要紧的一半。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/fix_annotation_order.mjs
//   pm2 restart vesper --update-env     ← 这次是 vesper，不是 phosphor
//
// books-page.js 是网页路由（/books/api/shelf），跑在 vesper 里。
// budget.js 那边的改动才要重启 phosphor。两个进程别搔错。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/books-page.js');

if (!fs.existsSync(FILE)) {
  console.error('✗ 找不到 src/books-page.js——是不是不在 /root/vesper-phosphor 下跑的？');
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
const bak = `${FILE}.bak-annorder`;
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const EDITS = [
  {
    what: '批注数组按写的时间倒序',
    done: '按写的时间倒序（2026-10-19）',
    find: 'const anns = annotationsIn(b.id, 0, Math.max(0, total - 1)).map((a) => ({',
    replacement:
      '// 按写的时间倒序（2026-10-19）：前端 bookshelf.jsx:1089 是按 date 倒序排的，\n' +
      '    // 但 date 只到天——同一天的几条 localeCompare 全是 0，顺序就退回数组原序，\n' +
      '    // 而 annotationsIn 是按 para_idx 排的（书里的位置）。所以在这边先排好，\n' +
      '    // 让即使 date 相等时保留的原序也是时间倒序。前端不用改。\n' +
      '    const anns = annotationsIn(b.id, 0, Math.max(0, total - 1))\n' +
      '      .slice()\n' +
      '      .sort((x, y) => (y.created_at ?? 0) - (x.created_at ?? 0))\n' +
      '      .map((a) => ({',
  },
  {
    what: '批注补上 time（评论本来就有，批注没有）',
    done: 'time: hhmm(a.created_at),',
    find: '      date: formatDate(a.created_at),',
    replacement: '      date: formatDate(a.created_at),\n      time: hhmm(a.created_at),',
  },
];

let changed = 0;
let skipped = 0;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log(`· 已经改过，跳过：${e.what}`);
    skipped += 1;
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error(`✗ ${e.what}：原文出现 ${n} 次，应该只有 1 次，没改`);
    console.error(`  原文：${e.find}`);
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log(`✓ ${e.what}`);
  changed += 1;
}

if (!changed) {
  console.log('\n没有需要改的，不用重启。');
  process.exit(0);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('✓ 语法通过');
} catch (err) {
  console.error('✗ 语法不过，已还原：');
  console.error(String(err.stderr ?? err.message));
  fs.copyFileSync(bak, FILE);
  process.exit(1);
}

console.log(`\n改了 ${changed} 处，跳过 ${skipped} 处。`);
console.log('接着：pm2 restart vesper --update-env，然后刷一下 /books');
