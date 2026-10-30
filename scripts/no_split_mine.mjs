#!/usr/bin/env node
// 小满 2026-10-30 20:35：「他的分段我的不分」
//
// 现在不分你我，按句读点和换行一律拆。但这两侧本来不是一回事：
//
//   他的回复是模型一口气生成的一大段，拆成几个气泡才像说话——
//   她 10-23 就是为这个提的：「要他唤醒的时候也像普通聊天一样，aru 的那种分段」。
//
//   她自己打的字已经是她分好的——要分就多发一条，不该替她拆。
//   一句话里带个句号就被切成两个气泡，那不是她说话的节奏。
//
// ── 预存那路的例外 ──
//
// 攒着的几条是合成一条递出去的（见 chat-queue.js 的 flushPending，用换行拼），
// 回来那一条本来就是几条话——这种要按换行拆回来，否则三条预存挤成一个长气泡。
// 所以我这边的规则是：只按换行拆，不按句读点拆。
//
// 重跑安全。备份在 src/.chat-split-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-split-backup');
const stamp = String(Date.now());
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });
const p = join(srcDir, 'chat-page.js');
if (!existsSync(p)) {
  console.error('✗ chat-page.js 不在');
  process.exit(1);
}
let t = readFileSync(p, 'utf8');
writeFileSync(join(bakDir, 'chat-page.js.' + stamp), t, 'utf8');

function apply(label, find, repl) {
  if (t.includes(repl)) { console.log('  · ' + label + '：已经是这样了'); return; }
  if (!t.includes(find)) { console.error('  ✗ ' + label + '：找不到原文'); failed++; return; }
  t = t.replace(find, repl);
  console.log('  ✓ ' + label);
}

console.log('1/2  多一个「只按换行拆」的函数');
apply('lines 函数',
  '  var typingEl = null;',
  L(
    '  // 我自己打的字：只按换行拆，不按句读点拆。',
    '  // 她打出来的已经是她分好的，不该替她再切一次（小满 20:35）。',
    '  // 但攒着的那几条是用换行拼成一条递出去的，回来还要按换行分开。',
    '  function lines(text) {',
    "    var s = String(text == null ? '' : text).trim();",
    '    if (!s) return [];',
    "    var out = s.split('\\\\n').map(function (x) { return x.trim(); }).filter(Boolean);",
    '    return out.length ? out : [s];',
    '  }',
    '',
    '  var typingEl = null;'
  ));

console.log('');
console.log('2/2  谁的话用哪种拆法');
apply('group 按侧选拆法',
  '    var lines = opts.draft ? [text] : sentences(text);\n    if (!lines.length) return null;',
  L(
    '    // 他的话按句拆（模型一口气生成的一大段，拆了才像说话），',
    '    // 我的只按换行拆（已经是我分好的）。小满 20:35：「他的分段我的不分」。',
    "    var cut = side === 'human' ? lines : sentences;",
    '    var parts = opts.draft ? [text] : cut(text);',
    '    if (!parts.length) return null;'
  ));

// 下面把用到 lines 这个局部变量的地方换成 parts——
// 名字和新函数重了，不换会把函数遮住。
apply('循环用 parts',
  '    for (var i = 0; i < lines.length; i++) {\n      var ln = document.createElement(\'div\');',
  '    for (var i = 0; i < parts.length; i++) {\n      var ln = document.createElement(\'div\');');

apply('气泡文字用 parts',
  '      b.textContent = lines[i];',
  '      b.textContent = parts[i];');

apply('最后一句判断用 parts',
  '      if (i === lines.length - 1) {',
  '      if (i === parts.length - 1) {');

writeFileSync(p, t, 'utf8');

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + join(bakDir, 'chat-page.js.' + stamp) + ' ' + p);
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
}
