#!/usr/bin/env node
// 把 Leto 加进发现页 /discover。
//
// 和论坛那条同一个形状：外链、走 NAV_LETO_URL、没配就置灰写明变量名。
// 判断口径不自己再读一遍 .env 之外的东西——那是 Proof 两个 TTL 那类坑的源头。
//
// 用法（在仓库根目录）：
//   node scripts/wire_leto_discover.mjs --check
//   node scripts/wire_leto_discover.mjs
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/discover-page.js');
const check = process.argv.includes('--check');

// 1) 取外链地址。挂在 forum 那行后面
const URL_OLD = `  const forum = externalUrl('NAV_FORUM_URL');`;
const URL_NEW = `  const forum = externalUrl('NAV_FORUM_URL');
  const leto = externalUrl('NAV_LETO_URL');`;

// 2) 卡片本身。摆在论坛后面：两个都是"外面那些人在的地方"
const CARD_OLD = `    {
      name: '\\u8bba\\u575b',`;

const CARD_NEW = `    {
      name: 'Leto',
      what: '\\u90a3\\u8fb9\\u6709\\u522b\\u4eba\\u548c\\u522b\\u7684 Agent\\u3002\\u4f60 @ \\u4ed6\\u3001\\u79c1\\u804a\\u4ed6\\uff0c\\u4ed6\\u4f1a\\u88ab\\u53eb\\u9192',
      meta: '\\u5524\\u9192\\u6865 \\u00b7 \\u6700\\u591a\\u7b49\\u4e00\\u5206\\u949f\\u4ed6\\u9192',
      href: leto,
      note: '\\u6ca1\\u914d NAV_LETO_URL',
      external: true,
    },
    {
      name: '\\u8bba\\u575b',`;

const OPS = [
  { label: '取 NAV_LETO_URL', old: URL_OLD, new: URL_NEW },
  { label: 'Leto 卡片', old: CARD_OLD, new: CARD_NEW },
];

const countOf = (s, needle) => s.split(needle).length - 1;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}`);
  console.error('要在仓库根目录里跑这个脚本。');
  process.exit(1);
}

let out = src;
let edits = 0;

for (const op of OPS) {
  if (out.includes(op.new)) {
    console.log(`不动：${op.label}（已经改过了）`);
    continue;
  }
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`停了：${op.label} —— 找到 ${n} 处（指望 1 处）。没写任何文件。`);
    process.exit(2);
  }
  out = out.replace(op.old, op.new);
  edits++;
  console.log(`要改：${op.label}`);
}

if (!edits) {
  console.log('全都改过了，没事干。');
  process.exit(0);
}

if (check) {
  console.log('\n--check，没写。');
  process.exit(0);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, out);
console.log('\n写完了。备份在 discover-page.js.bak');
console.log('接下来：.env 加 NAV_LETO_URL=https://leto.sarl，再 pm2 restart vesper --update-env');
