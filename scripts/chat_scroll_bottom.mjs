#!/usr/bin/env node
// 聊天页进来就停在最新那条。
//
// 小满 2026-10-30：「聊天界面自动定位到最近一条消息，不然翻好久才翻到」
//
// 卡片是旧的在上、新的在下排的（和聊天一样的读法），但进页面停在顶部，
// 所以每次都得从几天前往下翻。
//
// 为什么滚三次：
//   第一次立刻，先把位置定下来；
//   第二次等 load——字体加载完高度会变，只滚一次会停在半空；
//   第三次 120ms 后补一下：iOS 上 fixed 的输入框和底栅入场时还会推一把布局。
//
// behavior 故意不用 smooth：那样进页面先看见几天前的再晃到底，比不滚还难受。
//
// 插在 var sheet 那行前面：那下面紧跟着 if (!sheet) return，
// 插在后面的话一张详情卡都没有时就不滚了。
//
// 跑法：
//   node scripts/chat_scroll_bottom.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/chat-page.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/chat-page.js 找不到（先 git pull）');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-scroll';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

if (before.includes('function toBottom(')) {
  console.log('. 已经改过了，不用重启');
  process.exit(0);
}

const NEEDLE = "var sheet = document.querySelector('[data-sheet]');";

const lines = before.split('\n');
const hits = [];
lines.forEach((l, i) => {
  if (l.includes(NEEDLE)) hits.push(i);
});

if (hits.length !== 1) {
  console.error(NO + '含「' + NEEDLE + '」的行有 ' + hits.length + ' 条，应该只有 1 条。文件不改。');
  for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
  process.exit(1);
}

const i = hits[0];
const ind = (lines[i].match(/^\s*/) || [''])[0];

const INSERT = [
  ind + '// 进来就停在最新那条（2026-10-30）。卡片旧的在上、新的在下，',
  ind + '// 不自动滚的话每次都得从几天前往下翻。',
  ind + '// 滚三次：立刻一次定位；load 后一次（字体加载完高度会变）；',
  ind + '// 120ms 后再补一次（iOS 上 fixed 的输入框和底栅入场还会推一把布局）。',
  ind + 'function toBottom() {',
  ind + '  try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}',
  ind + '}',
  ind + 'toBottom();',
  ind + "window.addEventListener('load', toBottom);",
  ind + 'setTimeout(toBottom, 120);',
  '',
];

lines.splice(i, 0, ...INSERT);
fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(OK + '进聊天页直接停在最新那条');
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart vesper --update-env');
