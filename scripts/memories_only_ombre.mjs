#!/usr/bin/env node
// 记忆页只留 Ombre Brain。
//
// 小满 2026-10-30：「记忆只留第一个」
//
// 我前面推过一版只留一条的 memories-page.js，但那次 git pull 冲突失败过，
// 服务器上可能还是四条的版本（截图里确实是四条）。
// 所以这次不重推整个文件，就在现有文件里把后三条删掉——
// 不管服务器上是哪一版都能收收。
//
// 夜梦、星星罐、共读批注那三样在「发现」里都有，摆两遍只是占地方。
//
// 做法：找到 libraries() 里那个数组，从 key: 'dreams' 那一条开始到数组末尾全删。
// 认 key 不认名字：名字是转义过的中文，匹配起来不稳。
//
// 跑法：
//   node scripts/memories_only_ombre.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/memories-page.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/memories-page.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-onlyombre';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const lines = before.split('\n');

// 夜梦那条的开头
const start = lines.findIndex((l) => l.includes("key: 'dreams'"));
if (start < 0) {
  console.log('. 找不到 dreams 那一条，应该已经是只留一条的版本了');
  const n = (before.match(/key: '/g) || []).length;
  console.log('  现在有 ' + n + ' 条。要是还显示四条，就是进程没重启：');
  console.log('  pm2 restart vesper --update-env');
  process.exit(0);
}

// 往上找到那一条的 { （通常就是上一行）
let open = start;
while (open > 0 && !lines[open].trim().startsWith('{')) open -= 1;

// 往下找数组的结尾  ];
let end = start;
while (end < lines.length && lines[end].trim() !== '];') end += 1;

if (lines[end] === undefined) {
  console.error(NO + '从 dreams 往下找不到数组结尾的 ];。文件不改。');
  process.exit(1);
}

const ind = (lines[open].match(/^\s*/) || [''])[0];

// open..end-1 全删，换成一行注释；保留 end 那行的 ];
lines.splice(
  open,
  end - open,
  ind + '// 夜梦、星星罐、共读批注都挪到「发现」去了（2026-10-30）。',
  ind + '// 这一页就是记忆库的列表，以后多一个库往这儿添一条。'
);

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  const after = fs.readFileSync(FILE, 'utf8');
  const n = (after.match(/key: '/g) || []).length;
  console.log(OK + '记忆页现在 ' + n + ' 条');
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart vesper --update-env');
