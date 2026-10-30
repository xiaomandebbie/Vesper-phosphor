#!/usr/bin/env node
// /discover 一直没接上。
//
// 小满 2026-10-30：「怎么就是改不好？？？？？」
//
// 日志里 chat:、memories:、me: 三行都有，discover: 一行没有。
// 因为 wire_tabs.mjs 里我写的是个占位：
//   app.get('/discover', requireBasicAuth, (req, res) => res.redirect(302, '/moments'));
// 那是建 discover-page.js **之前**写的，页面建好之后我没回去换掉它。
//
// 所以她点「发现」看到的一直是动态页（日历、星星罐、写点什么、动作卡片），
// 而我改了四遍 discover-page.js——那个文件压根没被加载过。
//
// 顺带报出另两处的真实状态（音乐圆圈、动态过滤），不再猜。
//
// 跑法：
//   node scripts/fix_discover_route.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

const FILE = path.join(ROOT, 'src/vesper.js');
if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/vesper.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-discover';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

let lines = before.split('\n');
let changed = 0;
let failed = false;
const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

function one(needle, make, what, done) {
  if (failed) return;
  if (lines.some((l) => l.includes(done))) {
    console.log('. 已经改过，跳过：' + what);
    return;
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
    return;
  }
  const i = hits[0];
  const out = make(lines[i], indentOf(lines[i]));
  lines.splice(i, 1, ...(Array.isArray(out) ? out : [out]));
  console.log(OK + what);
  changed += 1;
}

// 1. import
one(
  "import { registerMeRoutes } from './me-page.js';",
  (line) => [line, "import { registerDiscoverRoutes } from './discover-page.js';"],
  'import registerDiscoverRoutes',
  "from './discover-page.js'"
);

// 2. 把那行占位重定向换成真的挂载
one(
  "app.get('/discover'",
  (line, ind) => [
    ind + '// 这儿原来是个占位：302 跳 /moments。那是建 discover-page.js 之前写的，',
    ind + '// 页面建好之后忘了换，所以「发现」点进去一直是动态页（2026-10-30）。',
    ind + 'registerDiscoverRoutes(app, { requireBasicAuth });',
  ],
  '/discover 换成真的发现页',
  'registerDiscoverRoutes(app'
);

if (failed) {
  fs.writeFileSync(FILE, before, 'utf8');
  console.error('');
  console.error('文件原样还原了。');
  process.exit(1);
}

if (changed) {
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
}

// ── 顺带报出另两处的真实状态 ──
console.log('');
console.log('── 另两处现在是什么样 ──');

const shell = path.join(ROOT, 'src/shell.js');
if (fs.existsSync(shell)) {
  const s = fs.readFileSync(shell, 'utf8');
  console.log(
    (s.includes('empty closed') ? OK : NO) +
      '音乐圆圈不常驻：' +
      (s.includes('empty closed') ? '已改' : '没改（要跑 mini_not_always.mjs）')
  );
} else {
  console.log(NO + 'src/shell.js 找不到');
}

const mom = path.join(ROOT, 'src/moments-page.js');
if (fs.existsSync(mom)) {
  const s = fs.readFileSync(mom, 'utf8');
  const has = s.includes("m.kind !== 'activity'");
  console.log(
    (has ? OK : NO) + '动态去掉行动卡片：' + (has ? '已改' : '没改（要跑 mini_not_always.mjs）')
  );
} else {
  console.log(NO + 'src/moments-page.js 找不到');
}

const mem = path.join(ROOT, 'src/memory-proxy.js');
if (fs.existsSync(mem)) {
  const s = fs.readFileSync(mem, 'utf8');
  const has = s.includes('vp-back-memory');
  console.log(
    (has ? OK : NO) +
      'Ombre Brain 返回键：' +
      (has ? '已改' : '没改（要跑 memory_back_button.mjs）')
  );
}

console.log('');
console.log('pm2 restart vesper --update-env');
console.log('然后日志里应该出现 discover: 那一行：');
console.log('  pm2 logs vesper --lines 30 --nostream | grep discover');
