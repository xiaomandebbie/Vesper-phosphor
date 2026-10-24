#!/usr/bin/env node
// 读书也不设每日上限。第二版：按行换，不拿多行文本去撞。
//
// 小满 2026-10-24：「2级和读书不设置上限了」
//
// 第一版（books_no_daily_cap.mjs）前三处成了，第四处「状态行」命中 0 处，
// 于是整个文件按设计回滚了——前三处也跟着没了。
// 那一处我拼的是四行原文，缩进或换行位置跟文件里差了一点点就对不上。
//
// 这版全部按「找到含某个关键片段的那一行，整行替换」来做：缩进、空格都不参与匹配。
// 多行那一处（const books = ...）按「从 const books = 那行到第一个以 ; 结尾的行」整段换。
//
// 保留的：
//   「一次醒来最多读一回」（onceDone）留着——读书的续步每翻一小段都是一次模型调用
//   （见 books-steps.js），一次醒来连读十轮是另一个问题。
//   books_log 照旧记账，所以状态行仍能说「今天读了几回」——那是线索，不是额度。
//
// 跑法：
//   node scripts/books_no_cap_v2.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/budget.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/budget.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-booksnocap2';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

let lines = before.split('\n');
let changed = 0;
let failed = false;

const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

// 整行替换：找含 needle 的行，必须只有一行命中
function replaceLine(needle, make, what, done) {
  if (lines.some((l) => l.includes(done))) {
    console.log('. 已经改过，跳过：' + what);
    return true;
  }
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i);
  });
  if (hits.length !== 1) {
    console.error('');
    console.error(NO + what + '：含「' + needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条');
    for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
    failed = true;
    return false;
  }
  const i = hits[0];
  const neo = make(lines[i], indentOf(lines[i]));
  lines.splice(i, 1, ...(Array.isArray(neo) ? neo : [neo]));
  console.log(OK + what);
  changed += 1;
  return true;
}

// 1. 读书的每日拦截废掉（和 2 级同一个做法：留着代码，条件恒假）
replaceLine(
  'if (booksLeft <= 0) {',
  (line, ind) => [
    ind + '// 读书也不设每日上限了（小满 2026-10-24）。books_log 照旧记账，只是不再拦。',
    line.replace('if (booksLeft <= 0) {', 'if (false && booksLeft <= 0) {'),
  ],
  '读书的每日拦截废掉',
  'false && booksLeft <= 0'
);

// 2. 分级说明那两行
if (!failed) {
  replaceLine(
    '**共读书架单算一本账**',
    () => '**共读书架单算一本账**：读书不占 2 级那边的名额，也没有每日上限，只是一次醒来最多读一回。',
    '分级说明：读书不再说一天几回',
    '也没有每日上限'
  );
}
if (!failed) {
  replaceLine(
    '回怎么花随你',
    () => '想读就读，不想读就不读。今天连读三回、明天一回不读都行，没人替你数。',
    '分级说明：那句「这 N 回怎么花」',
    '想读就读，不想读就不读'
  );
}

// 3. 状态行那一段（多行，整段换）
if (!failed && !lines.some((l) => l.includes('读书不设上限'))) {
  const start = lines.findIndex((l) => l.trim() === 'const books =');
  if (start < 0) {
    console.error('');
    console.error(NO + '状态行：找不到单独一行的 const books =');
    const i = lines.findIndex((l) => l.includes('const books'));
    if (i >= 0) {
      console.error('  含 const books 的那几行实际是：');
      for (let k = i; k < Math.min(lines.length, i + 5); k++) console.error('    ' + (k + 1) + ': ' + lines[k]);
    }
    failed = true;
  } else {
    let end = start;
    while (end < lines.length && !lines[end].trimEnd().endsWith(';')) end += 1;
    if (end >= lines.length) {
      console.error(NO + '状态行：从 const books = 往下找不到以分号结尾的行');
      failed = true;
    } else {
      const ind = indentOf(lines[start]);
      lines.splice(start, end - start + 1,
        ind + '// 读书也不设上限了，只报今天读了几回——那是给他看的线索，不是要还的账',
        ind + 'const books = bookUsed > 0',
        ind + '  ? `读书不设上限，今天已经读了 ${bookUsed} 回`',
        ind + "  : '读书不设上限，今天还没翻过';"
      );
      console.log(OK + '状态行：不再报剩多少回');
      changed += 1;
    }
  }
} else if (!failed) {
  console.log('. 已经改过，跳过：状态行');
}

// 4. 启动摘要那一行
if (!failed) {
  replaceLine(
    '读书另算一天 ${BOOKS_DAILY_MAX} 回',
    (line, ind) =>
      ind +
      'return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件；2 级和读书都不设每日上限（仍记账），读书一次醒来最多一回`;',
    '启动摘要那一行',
    '2 级和读书都不设每日上限'
  );
}

if (failed) {
  console.error('');
  console.error('整个文件不改。把那处的实际原文发我：');
  console.error('  grep -n "booksLeft\\|const books\\|BOOKS_DAILY_MAX" src/budget.js');
  process.exit(1);
}

if (!changed) {
  console.log('\n没有需要改的。');
  process.exit(0);
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

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
