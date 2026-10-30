#!/usr/bin/env node
// Ombre Brain 那页的右上角导览换成左上角返回键。
//
// 小满 2026-10-30：「ombre brain 里还有导览按键」
//
// 上一轮我理解反了：以为是让我留着，其实是在报问题。
// tabs.js 里那条 .vp-menu:not(.vp-menu-fixed) 特意放过了 fixed 的菜单，
// 而 memory-proxy.js 第 98 行正是 renderMenu(..., { fixed: true })。
//
// 那页是转发过来的别人的前端，所以当时给了个可拖的浮动菜单
// （免得挡住 Ombre 自己的按钮）。现在改成和其他页一致的左上角返回键：
// 点一下回记忆页，不再摆整套导航。
//
// 带 data-back：TABS_SCRIPT 看到已经有返回键就不再重复插一个。
// .vp-back 的样式已经在 TABS_CSS 里（固定在左上角），这儿不用再写。
//
// 跑法：
//   node scripts/memory_back_button.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/memory-proxy.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/memory-proxy.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-back';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

if (before.includes('vp-back-memory')) {
  console.log('. 已经改过了，不用重启');
  process.exit(0);
}

const lines = before.split('\n');
const hits = [];
lines.forEach((l, i) => {
  if (l.includes('renderMenu(') && l.includes('fixed: true')) hits.push(i);
});

if (hits.length !== 1) {
  console.error(NO + '含 fixed: true 的 renderMenu 有 ' + hits.length + ' 处，应该只有 1 处。文件不改。');
  for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
  process.exit(1);
}

const i = hits[0];
const ind = (lines[i].match(/^\s*/) || [''])[0];

// 原行形如：  const menu = renderMenu(`${PREFIX}/`, { fixed: true });
// 变量名从原行读，不猜
const m = lines[i].match(/(?:const|let|var)\s+(\w+)\s*=/);
if (!m) {
  console.error(NO + '那一行形状和预期不一样，文件不改。实际是：');
  console.error('    ' + (i + 1) + ': ' + lines[i]);
  process.exit(1);
}
const varName = m[1];

const SVG =
  '<svg viewBox=\\"0 0 24 24\\" aria-hidden=\\"true\\">' +
  '<path d=\\"M14.6 5.4l-6.6 6.6 6.6 6.6 1.5-1.5-5.1-5.1 5.1-5.1z\\"/></svg>';

lines.splice(
  i,
  1,
  ind + '// 这页是转发过来的 Ombre Brain，不再摆整套导航（2026-10-30）。',
  ind + '// 左上角一个返回键就够：点一下回记忆页。',
  ind + '// data-back 让 TABS_SCRIPT 知道已经有返回键，不要再插一个。',
  ind +
    'const ' +
    varName +
    ' = `<a class="vp-back vp-back-memory" href="/memories"' +
    ' data-back data-no-stars aria-label="\\u8fd4\\u56de">' +
    SVG +
    '<span>\\u8fd4\\u56de</span></a>`;'
);

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(OK + 'Ombre Brain 那页换成左上角返回键');
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart vesper --update-env');
