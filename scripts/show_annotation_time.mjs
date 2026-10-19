#!/usr/bin/env node
// 批注的时间显示不出来。
//
// 小满 2026-10-19：「前面批注的时间还是没有啊…」
//
// 后端那半已经做完了（fix_annotation_order.mjs）：toShelfJson 给每条批注都带了
// time: hhmm(a.created_at)。但前端没人读它——bookshelf.jsx 里显示批注时间的三处
// （1227、2988、3023）全是 relDate(date)，只到天；评论那边（3127）倒是 date + time
// 两个都拼。所以现象就是「回复有时间、批注没有」。
//
// 顺带按对 1089 行那个排序：它比 date 字符串，同一天的几条比出来全是 0，
// 顺序就退回数组原序。后端已经按 created_at 倒序给了，所以现在不会乱；
// 但把 time 加进比较，这一层自己也站得住，不再依赖上游顺序。
//
// 改完要重新 build：页面实际加载的是 index.html（build 产物），bookshelf.jsx 是源码。
// 不用重启 vesper——books-page.js 每次请求都重新 readFileSync 读 index.html，
// build 完刷页就生效。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/show_annotation_time.mjs
//   然后刷一下 /books（强刷，或者关掉标签页重开）

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const UI = '/root/vesper-phosphor/nest-bookshelf-ui';
const SRC = path.join(UI, 'bookshelf.jsx');
const OUT = path.join(UI, 'index.html');

if (!fs.existsSync(SRC)) {
  console.error(`✗ 找不到 ${SRC}`);
  process.exit(1);
}

let src = fs.readFileSync(SRC, 'utf8');
const bak = `${SRC}.bak-anntime`;
if (!fs.existsSync(bak)) fs.copyFileSync(SRC, bak);

// 每处都用 grep 里看到的原文片段做锚点，并要求全文只出现一次。
// 这是别人的代码，改错了整页白屏，宁可不改也不要模糊匹配。
const EDITS = [
  {
    what: '批注列表：日期后面跟上时分',
    done: 'a.time ? " " + a.time',
    find: '· p.{a.page} · {relDate(a.date)}</span>',
    replacement: '· p.{a.page} · {relDate(a.date)}{a.time ? " " + a.time : ""}</span>',
  },
  {
    what: '段旁已有批注：日期后面跟上时分',
    done: 'existing.time ? " " + existing.time',
    find: '· p.{existing.page} · {relDate(existing.date)}</span>',
    replacement:
      '· p.{existing.page} · {relDate(existing.date)}{existing.time ? " " + existing.time : ""}</span>',
  },
  {
    what: '批注详情：日期后面跟上时分',
    done: 'existing.time ? " " + existing.time : ""}{isMine',
    find: '· {relDate(existing.date)}{isMine && !editingNote ? " · 双击修改" : ""}',
    replacement:
      '· {relDate(existing.date)}{existing.time ? " " + existing.time : ""}{isMine && !editingNote ? " · 双击修改" : ""}',
  },
  {
    what: '「我的批注」列表：把 time 带过去（1940 行本来就会拼）',
    done: 'kind: "批注", date: annotation.date || "", time: annotation.time',
    find: 'kind: "批注", date: annotation.date || "" });',
    replacement:
      'kind: "批注", date: annotation.date || "", time: annotation.time || "" });',
  },
  {
    what: '排序把时分算进去（同一天不再比出 0）',
    done: '(b.time || "")).localeCompare',
    find: 'const dCmp = (b.date || "").localeCompare(a.date || "");',
    replacement:
      'const dCmp = ((b.date || "") + (b.time || "")).localeCompare((a.date || "") + (a.time || ""));',
  },
];

let changed = 0;
let skipped = 0;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log(`· 已经改过，跳过：${e.what}`);
    skipped += 1;
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error(`✗ ${e.what}：原文出现 ${n} 次，应该只有 1 次，已还原`);
    console.error(`  原文：${e.find}`);
    fs.copyFileSync(bak, SRC);
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log(`✓ ${e.what}`);
  changed += 1;
}

if (!changed) {
  console.log('\n没有需要改的。要是页面还是没时间，那就是 index.html 没重新 build，往下看。');
}

if (changed) fs.writeFileSync(SRC, src, 'utf8');

// ── 重新 build ──
// 页面加载的是 index.html，不是 .jsx。不 build 上面改的一个字都不会生效。
if (!fs.existsSync(path.join(UI, 'node_modules'))) {
  console.error('\n✗ 这个目录下没有 node_modules，build 跑不起来。先：');
  console.error(`    cd ${UI} && npm install`);
  console.error('  然后重新跑这个脚本（源码已经改好了，不会重复改）。');
  process.exit(1);
}

const outBak = `${OUT}.bak-anntime`;
if (fs.existsSync(OUT) && !fs.existsSync(outBak)) fs.copyFileSync(OUT, outBak);

try {
  console.log('\n正在 build…');
  const log = execFileSync('npm', ['run', 'build'], { cwd: UI, stdio: 'pipe' });
  console.log(String(log).trim().split('\n').slice(-5).join('\n'));
} catch (err) {
  console.error('✗ build 没成，源码和 index.html 都还原了：');
  console.error(String(err.stdout ?? '').slice(-800));
  console.error(String(err.stderr ?? err.message).slice(-800));
  fs.copyFileSync(bak, SRC);
  if (fs.existsSync(outBak)) fs.copyFileSync(outBak, OUT);
  process.exit(1);
}

// build 出来的东西里应该能找到我们插的表达式，找不到就是 build 没真的用新源码
const built = fs.readFileSync(OUT, 'utf8');
if (!built.includes('.time')) {
  console.error('\n✗ build 出来的 index.html 里找不到 time 字段，这不对。已还原。');
  fs.copyFileSync(bak, SRC);
  if (fs.existsSync(outBak)) fs.copyFileSync(outBak, OUT);
  process.exit(1);
}

console.log(`\n✓ build 完了，改了 ${changed} 处，跳过 ${skipped} 处。`);
console.log('不用重启 vesper（index.html 是每次请求现读的），直接强刷 /books。');
console.log(`改坏了要换回来：cp ${bak} ${SRC} 和 cp ${outBak} ${OUT}`);
