#!/usr/bin/env node
// 详情卡居中。
//
// 小满 2026-10-30：「卡片内容居中不然看不见」
//
// 那张卡原本贴在屏幕底部（align-items: flex-end），而底栅是 fixed
// 浮在它上面的，所以最后两三行被压死了——图里那条批注正好尾巴被遮住。
//
// 改两处：
//   align-items: flex-end → center（垂直居中）
//   下边距给底栅留出高度（底栅大约 60＋安全区）
//
// 顺带把最大高度从 76vh 收到 70vh：居中之后上下各留一点，
// 卡太高的话两头贴边，反而看不出是个浮层。
//
// 跑法：
//   node scripts/sheet_center.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/chat-page.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/chat-page.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-center';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const EDITS = [
  {
    what: '详情卡垂直居中，并给底栅留出高度',
    done: 'align-items: center; justify-content: center;',
    find:
      '  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: flex-end;\n' +
      '    justify-content: center; padding: 16px; background: rgba(43, 34, 51, 0.32); }',
    replacement:
      '  /* 垂直居中（2026-10-30）。原本贴底，而底栅是 fixed 浮在上面的，\n' +
      '     所以卡的最后几行被压死了。下边距留出底栅的高度。 */\n' +
      '  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: center;\n' +
      '    justify-content: center; padding: 16px 16px calc(84px + env(safe-area-inset-bottom, 0px));\n' +
      '    background: rgba(43, 34, 51, 0.32); }',
  },
  {
    what: '最大高度 76vh → 70vh',
    done: 'max-height: 70vh',
    find: '  .sheet-box { width: 100%; max-width: 560px; max-height: 76vh; overflow-y: auto;',
    replacement: '  .sheet-box { width: 100%; max-width: 560px; max-height: 70vh; overflow-y: auto;',
  },
];

let src = before;
let changed = 0;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log('. 已经改过，跳过：' + e.what);
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error('');
    console.error(NO + e.what + '：原文命中 ' + n + ' 处，应该只有 1 处。文件不改。');
    console.error('  我找的是：');
    console.error(e.find.split('\n').map((l) => '    ' + l).join('\n'));
    const lines = before.split('\n');
    const i = lines.findIndex((l) => l.includes('.sheet {') || l.includes('.sheet-box {'));
    if (i >= 0) {
      console.error('');
      console.error('  第 ' + (i + 1) + ' 行附近实际是：');
      for (let k = Math.max(0, i - 1); k < Math.min(lines.length, i + 6); k++) {
        console.error('    ' + (k + 1) + ': ' + lines[k]);
      }
    }
    fs.writeFileSync(FILE, before, 'utf8');
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log(OK + e.what);
  changed += 1;
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
console.log('pm2 restart vesper --update-env');
