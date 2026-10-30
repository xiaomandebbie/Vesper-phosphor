#!/usr/bin/env node
// 小满 2026-10-30，两件：
//
// 1) 台灯页去掉导览。那三条杠是 light-proxy.js 转发时注进去的，
//    台灯页自己（3003）有它自己的页面结构，不需要晨暮星这层菜单。
//    改法是把注入的内容清空，不动插入逻辑——以后想恢复只要把这行还原。
//
// 2) 聊天详情卡居中。原来是 align-items: flex-end 贴在屏幕底部，
//    底下还有假输入框（bottom 72px）和标签栏，最后两行被压住看不见。
//    改成垂直居中，并在底部留出 96px + 安全区，顺带把 max-height
//    从 76vh 收到 68vh——居中之后太高的卡片两头都会顶到边。
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let wrote = 0;
let failed = 0;

function edit(rel, edits) {
  const path = resolve(root, rel);
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    console.error(`\u2717 ${rel}\uff1a\u8bfb\u4e0d\u5230\uff08${err.message}\uff09`);
    failed++;
    return;
  }
  const before = text;
  for (const [label, find, replacement] of edits) {
    if (!text.includes(find)) {
      if (text.includes(replacement)) {
        console.log(`\u00b7 ${rel} \u00b7 ${label}\uff1a\u5df2\u7ecf\u662f\u8fd9\u6837\u4e86`);
      } else {
        console.error(`\u2717 ${rel} \u00b7 ${label}\uff1a\u627e\u4e0d\u5230\u539f\u6587`);
        failed++;
      }
      continue;
    }
    text = text.replace(find, replacement);
    console.log(`\u2713 ${rel} \u00b7 ${label}`);
  }
  if (text !== before) {
    writeFileSync(path, text, 'utf8');
    wrote++;
  }
}

// ── 1. 台灯页：不注入导览 ──
edit('src/light-proxy.js', [
  [
    '\u53bb\u6389\u5bfc\u89c8',
    'const menu = renderMenu(PREFIX, { fixed: true });',
    "const menu = ''; // \u5c0f\u6ee1 10-30\uff1a\u53f0\u706f\u9875\u4e0d\u8981\u5bfc\u89c8"
  ]
]);

// ── 2. 聊天详情卡：居中 ──
edit('src/chat-page.js', [
  [
    '\u8be6\u60c5\u5361\u5c45\u4e2d',
    `  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: flex-end;
    justify-content: center; padding: 16px; background: rgba(43, 34, 51, 0.32); }`,
    `  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: center;
    justify-content: center; padding: 16px 16px calc(96px + env(safe-area-inset-bottom, 0px));
    background: rgba(43, 34, 51, 0.32); }`
  ],
  [
    '\u9ad8\u5ea6\u6536\u5230 68vh',
    '  .sheet-box { width: 100%; max-width: 560px; max-height: 76vh; overflow-y: auto;',
    '  .sheet-box { width: 100%; max-width: 560px; max-height: 68vh; overflow-y: auto;'
  ]
]);

console.log(`\n\u5199\u4e86 ${wrote} \u4e2a\u6587\u4ef6\uff0c\u5931\u8d25 ${failed} \u5904\u3002`);
if (failed) process.exitCode = 1;
