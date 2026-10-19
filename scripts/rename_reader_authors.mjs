#!/usr/bin/env node
// 共读界面里的「我」和「AI」改成「小满」和「允朔」。
//
// 小满 2026-10-19：「共读界面我和 AI 改为小满和允朔」
//
// 这是别人的代码（NEST 书架 UI），154KB，没法先通读一遍再写锚点。
// 所以这个脚本自己找：只改**字符串字面里单独的**「我」和「AI」
// （就是 "我" 和 "AI" 这两个整个字符串）——这种只能是给人看的栈牌。
//
// 为什么这样安全：它分辨作者用的是小写的 'me' 和 'ai'（见 books-page.js 里
//   author: a.author === 'assistant' ? 'ai' : 'me'）。大写的 "AI" 和中文的 "我"
//   不参与任何判断，只用来显示。所以换它们不会动到逻辑。
//
// 带字的长句（「我的批注」这类）**不自动改**，只打出来给你看。
// 那些要不要换是你的意思，不是我替你定。
//
// 改完自动 build：页面加载的是 index.html，bookshelf.jsx 只是源码。
// 不用重启 vesper（books-page.js 每次请求现读 index.html），build 完强刷 /books。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/rename_reader_authors.mjs

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const UI = '/root/vesper-phosphor/nest-bookshelf-ui';
const SRC = path.join(UI, 'bookshelf.jsx');
const OUT = path.join(UI, 'index.html');

// 换成谁。以后改叫法只改这两行重跑就行。
const ME = '\u5c0f\u6ee1';
const AI = '\u5141\u6714';

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到 ${SRC}`);
  process.exit(1);
}

let src = fs.readFileSync(SRC, 'utf8');
const bak = `${SRC}.bak-names`;
if (!fs.existsSync(bak)) fs.copyFileSync(SRC, bak);

// 单独成一个字符串的："我" 或 '我'，"AI" 或 'AI'
const SOLO = /(["'])(\u6211|AI)\1/g;
// 带字的长句：字符串里含有 我 或 AI 但不是它自己
const MIXED = /(["'])([^"'\n]*(?:\u6211|AI)[^"'\n]*)\1/g;

const solo = [...src.matchAll(SOLO)];
console.log(`找到 ${solo.length} 处单独的栈牌（这些会改）：`);
const soloCount = {};
for (const m of solo) soloCount[m[2]] = (soloCount[m[2]] || 0) + 1;
for (const [k, v] of Object.entries(soloCount)) {
  console.log(`  "${k}" × ${v}  →  "${k === 'AI' ? AI : ME}"`);
}

const mixed = [...src.matchAll(MIXED)]
  .map((m) => m[2])
  .filter((s) => s !== '\u6211' && s !== 'AI');
const uniqMixed = [...new Set(mixed)];
if (uniqMixed.length) {
  console.log(`\n还有 ${uniqMixed.length} 种带字的长句，**没改**，要不要改你说：`);
  for (const s of uniqMixed.slice(0, 30)) console.log(`  "${s}"`);
  if (uniqMixed.length > 30) console.log(`  …还有 ${uniqMixed.length - 30} 种`);
}

if (!solo.length) {
  console.log('\n没有单独的「我」或「AI」字符串。可能已经改过了，或者栈牌是拼出来的。');
  console.log('上面那些长句里有没有你要改的？有就告诉我哪几句。');
}

let changed = 0;
if (solo.length) {
  src = src.replace(SOLO, (whole, q, word) => {
    changed += 1;
    return `${q}${word === 'AI' ? AI : ME}${q}`;
  });
  fs.writeFileSync(SRC, src, 'utf8');
  console.log(`\n✓ 改了 ${changed} 处`);
}

if (changed) {
  if (!fs.existsSync(path.join(UI, 'node_modules'))) {
    console.error('\n✗ 没有 node_modules，build 跑不起来。先 cd ' + UI + ' && npm install');
    process.exit(1);
  }
  const outBak = `${OUT}.bak-names`;
  if (fs.existsSync(OUT) && !fs.existsSync(outBak)) fs.copyFileSync(OUT, outBak);
  try {
    console.log('\n正在 build…');
    const log = execFileSync('npm', ['run', 'build'], { cwd: UI, stdio: 'pipe' });
    console.log(String(log).trim().split('\n').slice(-3).join('\n'));
  } catch (err) {
    console.error('✗ build 没成，全还原了：');
    console.error(String(err.stdout ?? '').slice(-600));
    console.error(String(err.stderr ?? err.message).slice(-600));
    fs.copyFileSync(bak, SRC);
    if (fs.existsSync(outBak)) fs.copyFileSync(outBak, OUT);
    process.exit(1);
  }
  if (!fs.readFileSync(OUT, 'utf8').includes(AI)) {
    console.error(`\n✗ build 产物里找不到「${AI}」，不对。已还原。`);
    fs.copyFileSync(bak, SRC);
    if (fs.existsSync(outBak)) fs.copyFileSync(outBak, OUT);
    process.exit(1);
  }
  console.log('✓ build 完了，强刷 /books 就能看见。');
  console.log(`改坏了换回来：cp ${bak} ${SRC} && cd ${UI} && npm run build`);
}

// ── 顺手把剩下两件事要的原文打出来，省一个来回 ──

function show(file, needle, before, after, label) {
  const p = path.join('/root/vesper-phosphor', file);
  if (!fs.existsSync(p)) return console.log(`\n── ${label}：找不到 ${file}`);
  const lines = fs.readFileSync(p, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes(needle));
  if (i < 0) return console.log(`\n── ${label}：没找到「${needle}」`);
  console.log(`\n── ${label}（${file} 第 ${i + 1} 行附近）──`);
  for (let n = Math.max(0, i - before); n < Math.min(lines.length, i + after); n++) {
    console.log(`${n + 1}: ${lines[n]}`);
  }
}

show('src/books-page.js', 'description: (() =>', 2, 18, '书架卡的进度（要把小满那条线也加上）');
show('src/budget.js', 'export function pickActions', 0, 34, '每级最多一件（要把 1 级放开到两件）');
