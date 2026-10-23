#!/usr/bin/env node
// 日志页 error 那几张卡看不清。
//
// 小满 2026-10-23：「error 部分看不清」
//
// 是我写坏的：.line.err 的背景写死成了 #fffafb（白），而正文颜色跟着
// --ink 走。page-chrome 的 FACE_SCRIPT 入夜后把 --ink 改成浅色（配深底用的），
// 于是浅字落在白底上，整条读不出来。
//
// 非 error 的卡用的是 var(--card)，夜里跟着变暗，所以没事——music-mcp 那一屏
// 恰好全是 error，就全糊了。
//
// 四处改动：
//   1. error 卡不再写死白底，跟着 var(--card) 走，只留左边红线
//   2. .msg 明写 color: var(--ink)，不靠继承
//   3. error 的小标签颜色改成两种底色下都站得住的
//   4. 补两条夜间覆盖：红线和标签在深底上提亚，卡底透一点红
//
// 跑法：
//   node scripts/fix_logs_error_contrast.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/logs-page.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/logs-page.js 找不到（先 git pull）');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-errcontrast';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

// 夜里（dusk / night）的覆盖。插在最后那条 @media 前面
const NIGHT = [
  '  /* 夜里底色是深紫，红线和标签要提亚才看得见；卡底透一点红，和普通条区分开 */',
  '  html[data-face="night"] .line.err, html[data-face="dusk"] .line.err {',
  '    border-left-color: #e08ba8; background: rgba(226, 138, 168, 0.1); }',
  '  html[data-face="night"] .line.err .meta .tag, html[data-face="dusk"] .line.err .meta .tag {',
  '    color: #f0a9c0; border-color: #c2738f; }',
  '',
].join('\n');

const EDITS = [
  {
    what: 'error 卡不再写死白底',
    done: '.line.err { border-left-color: #c2607f; background: rgba(194, 96, 127, 0.05); }',
    find: '  .line.err { border-left-color: #c2607f; background: #fffafb; }',
    replacement: '  .line.err { border-left-color: #c2607f; background: rgba(194, 96, 127, 0.05); }',
  },
  {
    what: '正文颜色明写，不靠继承',
    done: 'word-break: break-word; color: var(--ink); }',
    find: '    font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; }',
    replacement:
      '    font-size: 13px; line-height: 1.7; white-space: pre-wrap; word-break: break-word; color: var(--ink); }',
  },
  {
    what: 'error 标签改成两种底色都行的',
    done: '.line.err .meta .tag { color: #c2607f; border-color: #c2607f; }',
    find: '  .line.err .meta .tag { color: #a8415f; border-color: #eec3d0; }',
    replacement: '  .line.err .meta .tag { color: #c2607f; border-color: #c2607f; }',
  },
  {
    what: '补夜间覆盖',
    done: 'html[data-face="night"] .line.err',
    find: '  @media (max-width: 420px) { .title { font-size: 34px; } .msg { font-size: 12px; } }',
    replacement: NIGHT + '  @media (max-width: 420px) { .title { font-size: 34px; } .msg { font-size: 12px; } }',
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
    console.error(NO + e.what + '：原文命中 ' + n + ' 处，应该只有 1 处。整个文件不改。');
    console.error('  我找的是：' + e.find);
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
console.log('然后强刷 /logs（这一页每分钟自己取，但 CSS 在 HTML 里，要重新加载整页才换）');
