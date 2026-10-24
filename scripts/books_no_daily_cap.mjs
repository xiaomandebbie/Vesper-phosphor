#!/usr/bin/env node
// 读书也不设每日上限。
//
// 小满 2026-10-24：「2级和读书不设置上限了」
//
// 上次（tier2_no_cap_and_quiet_share.mjs）只成了一半：
//   budget.js:410  if (false && remaining <= 0)   ← 2 级的拦截废了，对
//   budget.js:392  if (booksLeft <= 0)            ← 读书的**还在真拦**
//   话术 438/439、474/475、481 三处也都还在说「一天几回」
//
// 启动摘要里那句「2 级一天 6 次（只设上限），读书另算一天 5 回」就是 481 行打的。
//
// 代码和话术必须一起改，这是踩过两次的坑：只改代码，他看见「今天还能读 N 回」
// 依旧会省着来；只改话术，拦截还在。
//
// ── 保留的 ──
//
// 「一次醒来最多读一回」（onceDone）留着。读书的续步每翻一小段都是一次模型调用
// （见 books-steps.js），一次醒来连读十轮是别的问题，不是「每日上限」。
// books_log 照旧记账，所以状态行仍能说「今天读了几回」——那是给他看的线索，不是额度。
//
// 跑法：
//   node scripts/books_no_daily_cap.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/budget.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/budget.js \u627e\u4e0d\u5230');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-booksnocap';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const EDITS = [
  {
    what: '读书的每日拦截废掉（和 2 级同一个做法）',
    done: 'if (false && booksLeft <= 0) {',
    find: '      if (booksLeft <= 0) {',
    replacement:
      '      // 读书也不设每日上限了（小满 2026-10-24）。books_log 照旧记账，只是不再拦。\n' +
      '      if (false && booksLeft <= 0) {',
  },
  {
    what: '分级说明：读书不再说一天几回',
    done: '读书不占 2 级那边的名额',
    find:
      '**共读书架单算一本账**：读书不占 2 级那 ${TIER2_DAILY_MAX} 次，有自己的**一天 ${BOOKS_DAILY_MAX} 回**，一次醒来最多读一回。',
    replacement:
      '**共读书架单算一本账**：读书不占 2 级那边的名额，也没有每日上限，只是一次醒来最多读一回。',
  },
  {
    what: '分级说明：那句「这 N 回怎么花」',
    done: '想读就读，不想读就不读',
    find:
      '这 ${BOOKS_DAILY_MAX} 回怎么花随你——今天连读三回、明天一回不读都行，用不完也没人替你数。',
    replacement:
      '想读就读，不想读就不读。今天连读三回、明天一回不读都行，没人替你数。',
  },
  {
    what: '状态行：不再报剩多少回',
    done: '读书也不设上限',
    find:
      '  const books =\n' +
      '    bookLeft > 0\n' +
      '      ? `读书另算一本账：今天读了 ${bookUsed} 回，还能读 ${bookLeft} 回（一天 ${BOOKS_DAILY_MAX} 回）。读不读随你，剩着也没关系`\n' +
      '      : `读书今天的 ${BOOKS_DAILY_MAX} 回读渿了，明天再翻`;',
    replacement:
      '  // 读书也不设上限了，只报今天读了几回——那是给他看的线索，不是要还的账\n' +
      '  const books = bookUsed > 0\n' +
      '    ? `读书不设上限，今天已经读了 ${bookUsed} 回`\n' +
      "    : '读书不设上限，今天还没翻过';",
  },
  {
    what: '启动摘要那一行',
    done: '2 级和读书都不设每日上限',
    find:
      '  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限），读书另算一天 ${BOOKS_DAILY_MAX} 回`;',
    replacement:
      '  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件；2 级和读书都不设每日上限（仍记账），读书一次醒来最多一回`;',
  },
];

let src = before;
let changed = 0;
let failed = false;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log('. 已经改过，跳过：' + e.what);
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error('');
    console.error(NO + e.what + '：原文命中 ' + n + ' 处，应该只有 1 处。');
    console.error('  我找的是：');
    console.error(e.find.split('\n').map((l) => '    ' + l).join('\n'));
    failed = true;
    break;
  }
  src = src.replace(e.find, e.replacement);
  console.log(OK + e.what);
  changed += 1;
}

if (failed) {
  console.error('');
  console.error('整个文件不改。把那处的实际原文发我：');
  console.error('  grep -n "booksLeft <= 0\\|BOOKS_DAILY_MAX" src/budget.js');
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

if (!changed) {
  console.log('\n没有需要改的。');
  process.exit(0);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart phosphor --update-env');
console.log('');
console.log('启动摘要里那句该变成「2 级和读书都不设每日上限」：');
console.log('  pm2 logs phosphor --lines 40 --nostream | grep 动作分级');
