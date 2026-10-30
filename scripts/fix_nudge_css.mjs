#!/usr/bin/env node
// 修 .nudge 这一段 CSS。小满 18:43 的输出里就差这一处。
//
// grep 出来的原文（264–273 行）有两个毛病：
//
//   1. 「.nudge { position: fixed…」这行出现了两遍（264、265），
//      后面的属性块也重了两遍（266–269、270–273）。
//      应该是前几次脚本的 replace 叠在了同一段上。
//
//   2. background 变成了 `* 0 0`。这是 gray_all.mjs 干的：
//      它的 rgba() 正则误伤了 `var(--accent)`——那个正则没要求
//      前面是 rgb/rgba 字样，所以把「(…)」那一团当成颜色吃掉了。
//      这条很可能不只伤了这一处，所以脚本会全文体检一遍。
//
// 做法：把 264 行开头到重复块结尾那一整段整个干掉，换成行内按钮的样式。
// 不再做精确匹配——那段已经被改过四次，原文不可靠。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const cpPath = join(srcDir, 'chat-page.js');
let failed = 0;

const L = (...lines) => lines.join('\n');

// ════ 1. .nudge 整段重写 ════
console.log('1/2  .nudge 样式');

if (!existsSync(cpPath)) {
  console.error('  ✗ chat-page.js 不在');
  process.exit(1);
}

let t = readFileSync(cpPath, 'utf8');
const before = t;

const GOOD = L(
  '  /* 「让他读」：塞在输入框那一行里，不是悬浮层。',
  '     之前它是 fixed，和输入框、标签栏三层叠着，点下半部就打到发送键了，',
  '     而且它自己还盖住消息。现在占一格，物理上不可能再重叠。 */',
  '  .nudge { display: none; flex: none; align-items: center; gap: 4px; height: 38px;',
  '    padding: 0 12px; border: none; border-radius: 14px;',
  '    background: #1a1a1a; color: #fdfdfd; font-size: 12px; white-space: nowrap; }',
  '  .nudge.on { display: inline-flex; }',
  '  .nudge:disabled { opacity: 0.6; }'
);

if (t.includes('.nudge { display: none; flex: none;')) {
  console.log('  · 已经是行内样式了');
} else {
  // 从第一个 .nudge 规则开头，到最后一个 .nudge:disabled 结尾——
  // 中间不管重了几遍、被改成什么样，整段换掉。
  // 开头往前吞掉注释（如果有）。
  let a = t.indexOf('  .nudge {');
  if (a < 0) a = t.indexOf('.nudge {');
  const commentMark = '  /* 「让他读」';
  const c = t.lastIndexOf(commentMark, a);
  if (c >= 0 && a - c < 400) a = c;

  const DIS = '.nudge:disabled { opacity: 0.6; }';
  const d = t.lastIndexOf(DIS);
  if (a < 0 || d < 0 || d < a) {
    console.error('  ✗ 定不到 .nudge 那一段的起止');
    failed++;
  } else {
    t = t.slice(0, a) + GOOD + t.slice(d + DIS.length);
    console.log('  ✓ 整段重写（清掉了重复的那几行）');
  }
}

if (t !== before) writeFileSync(cpPath, t, 'utf8');

// ════ 2. 全文体检 `* 0 0` ════
// gray_all.mjs 的 rgba() 正则没要求前面是 rgb/rgba 字样，
// 所以任何 `xxx(a, b, c)` 形式都可能被吃成 `* n n`。找找还有没有别的。
console.log('');
console.log('2/2  全文体检被误伤的颜色');

import { readdirSync } from 'node:fs';
let hits = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith('.js')) continue;
  const p = join(srcDir, name);
  const text = readFileSync(p, 'utf8');
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (/:\s*\*\s+[\d.]+\s+[\d.]+/.test(line)) {
      console.log('  ! ' + name + ':' + (i + 1) + '  ' + line.trim().slice(0, 90));
      hits++;
    }
  });
}
if (!hits) console.log('  ✓ 没找到别的');
else console.log('  上面这几处要人工看一眼，把输出发我。');

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
}
