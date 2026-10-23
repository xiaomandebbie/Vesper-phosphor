#!/usr/bin/env node
// read_book 每次都 isError 的真原因：书名号。
//
// 小满 2026-10-23：「精确唤醒连行动都没有」「行动要有」
//
// 18:04 那次他写的是  action_detail: ' 《Keep Me》 '
// 17:34 那次是            ' 《窄门》 '
// 两次 read_book 都 isError。
//
// resolveBook 找书的顺序是：当 id 试 → 标题精确等 → LIKE %输入%。
// 库里存的标题是 `Keep Me`，不带书名号，所以 LIKE '%《Keep Me》%' 一个都对不上。
//
// 他为什么会带书名号：booksStatusLine() 给他看的就是「《Keep Me》你 32%、她 18%」，
// 他照抄了。这是提示词跟查询对不上，不是他写错。
//
// 所以在 resolveBook 里把包起来的符号脱掉再匹配：《》〈〉“”""''【】[]。
// 脱完还找不到才算真没这本书。
//
// 跑法：
//   node scripts/fix_book_title_brackets.mjs
//   pm2 restart vesper phosphor --update-env
//
// books.js 两边都用（网页读书 + 唤醒读书），所以两个进程都重启。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/books.js');

if (!fs.existsSync(FILE)) {
  console.error('✗ src/books.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-booktitle';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

if (before.includes('function stripWrap(')) {
  console.log('. 已经改过了，不用重启');
  process.exit(0);
}

const FIND = "export function resolveBook(ref) {\n  const s = String(ref ?? '').trim();";

const LINES = [
  '// 把包起来的符号脱掉（2026-10-23）。',
  '// 他写的是《Keep Me》《窄门》——因为 booksStatusLine 给他看的就是这么带着书名号的，',
  '// 他照抄。而库里存的标题没有号，LIKE 「%《…》%」永远对不上，于是每次读书都报「没这本书」。',
  'function stripWrap(raw) {',
  "  let s = String(raw ?? '').trim();",
  '  // 可能包了好几层（《“…”》），剥到不再变为止',
  '  for (let i = 0; i < 4; i++) {',
  '    const next = s.replace(OPENERS, \'\').replace(CLOSERS, \'\').trim();',
  '    if (next === s) break;',
  '    s = next;',
  '  }',
  '  return s;',
  '}',
  '',
  'export function resolveBook(ref) {',
  '  const s = stripWrap(ref);',
].join('\n');

const n = before.split(FIND).length - 1;
if (n !== 1) {
  console.error('✗ resolveBook 开头命中 ' + n + ' 处，应该只有 1 处。文件不改。');
  console.error('  我找的是：');
  console.error(FIND.split('\n').map((l) => '    ' + l).join('\n'));
  const lines = before.split('\n');
  const i = lines.findIndex((l) => l.includes('export function resolveBook'));
  if (i >= 0) {
    console.error('');
    console.error('  第 ' + (i + 1) + ' 行附近实际是：');
    for (let k = Math.max(0, i - 2); k < Math.min(lines.length, i + 10); k++) {
      console.error('    ' + (k + 1) + ': ' + lines[k]);
    }
  }
  process.exit(1);
}

// 两个字符类单独定义，免得正则字面量里塞一堆中文符号看不清
const DEFS = [
  '// 书名号、引号、方括号这些包装符号。写成变量是为了上面那个 replace 看得清',
  "const OPENERS = /^[\\s\u300a\u3008\u201c\u2018\"'\u3010\\[]+/;",
  "const CLOSERS = /[\\s\u300b\u3009\u201d\u2019\"'\u3011\\]]+$/;",
  '',
].join('\n');

let src = before.replace(FIND, DEFS + LINES);

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('✓ 找书时脱掉书名号');
  console.log('✓ 语法通过');
} catch (err) {
  console.error('✗ 语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart vesper phosphor --update-env');
console.log('');
console.log('等他醒一次，读书那件应该不再 isError：');
console.log('  pm2 logs phosphor --lines 200 --nostream | grep -E "read_book|没做："');
