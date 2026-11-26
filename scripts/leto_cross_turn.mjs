#!/usr/bin/env node
// 跳轮的重复也要拦。
//
// ── 现场 ──
//
// 2026-11-26 18:33，两轮各发了一条几乎一样的评论：
//   18:33:48 那轮：第 2 步没成、第 3 步成了 → 9577
//   18:33:59 那轮：第 2 步直接成    → 9578
// 两条开头都是「做完了先别急着回头调，老婆」。
//
// 17:12 那次加的 tooSimilar 只比本轮 steps——而每轮续步开始时 steps 是
// 新的空数组，上一轮说过什么一概不知，所以拦不到。
//
// ── 怎么比 ──
//
// 11-26 那次落库把他说过的话写进了 conversation_log，带着场合标：
//   允朔（Leto） | [岛上说] ……
//   允朔（Leto） | [评论] ……
// 正好拿来当跳轮的记忆。getRecentConversation(20) 是现成的（state.js 331）。
//
// 只比同一种场合：岛上说过的话和评论撞不算重复，那是两个地方的人。
// 读库失败就当没有历史，不让它带崩整轮。
//
// 用法（在仓库根目录）：
//   node scripts/leto_cross_turn.mjs --check
//   node scripts/leto_cross_turn.mjs
import fs from 'fs';
import path from 'path';

const F = path.resolve('src/leto-steps.js');
const check = process.argv.includes('--check');

// 1) import 读库的函数。跟在 addConversationMessage 那行后面。
const A1 = "import { addConversationMessage } from './state.js';";
const N1 = "import { addConversationMessage, getRecentConversation } from './state.js';";

// 2) tooSimilar 里多比一道库里的。
const A2 = `  for (const s of saidSoFar(steps)) {
    if (s.tool !== tool) continue;
    if (similarity(s.text, text) >= SAY_SIMILAR) return s.text;
  }
  return null;
}`;

const N2 = `  for (const s of saidSoFar(steps)) {
    if (s.tool !== tool) continue;
    if (similarity(s.text, text) >= SAY_SIMILAR) return s.text;
  }

  // 跳轮的也要比。
  //
  // 2026-11-26 18:33 两轮各发了一条几乎一样的评论：每轮续步开始时
  // steps 是新的空数组，上面那一道只看得见本轮。
  //
  // 11-26 落库那次把他说过的话写进了 conversation_log，带着场合标
  //（[岛上说]、[评论]、[回·某某]）——正好拿来当跳轮的记忆。
  //
  // 只比同一种场合：岛上说过的和评论撞不算重复。
  const want = SAID_TOOLS[tool];
  try {
    for (const row of getRecentConversation(CROSS_TURN_LOOKBACK)) {
      if (!String(row?.speaker ?? '').includes('Leto')) continue;
      const body = String(row?.content ?? '');
      const m = body.match(/^\\[([^\\]]+)\\]\\s*([\\s\\S]*)$/);
      if (!m) continue;
      // 场合标可能带对方名字（回·颜姐、私聊·某某），只取前半比
      const where = m[1].split('·')[0];
      if (where !== want) continue;
      if (similarity(m[2], text) >= SAY_SIMILAR) return m[2];
    }
  } catch (err) {
    // 读库失败就当没有历史，不让它带崩整轮
    console.error('leto: 比跳轮重复时读库失败', err.message);
  }
  return null;
}`;

// 3) 回溯多少条。摆在 SAY_SIMILAR 旁边。
const A3 = `// 这句跟前面说过的哪一句太像？`;
const N3 = `// 跳轮比要回溯多少条。不必太多：同一件事说两遍都是几分钟内的事，
// 隔了半天再提一次本来也不算重复。.env 的 LETO_SAY_LOOKBACK 可改。
const CROSS_TURN_LOOKBACK = (() => {
  const n = Number(String(process.env.LETO_SAY_LOOKBACK ?? '').trim());
  return Number.isInteger(n) && n >= 0 ? Math.min(n, 100) : 20;
})();

${A3}`;

const OPS = [
  { label: 'import getRecentConversation', old: A1, new: N1 },
  { label: '加回溯条数配置', old: A3, new: N3 },
  { label: 'tooSimilar 多比库里的', old: A2, new: N2 },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(F, 'utf-8');
} catch (err) {
  console.error(`读不到 ${F}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (!src.includes('function tooSimilar')) {
  console.error('这份 leto-steps.js 里没有 tooSimilar——leto_similar_say.mjs 先跑过才行。');
  process.exit(2);
}
if (src.includes('CROSS_TURN_LOOKBACK')) {
  console.log('已经改过了，没事干。');
  process.exit(0);
}

let out = src;
let bad = 0;
for (const op of OPS) {
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`✗ ${op.label} —— 找到 ${n} 处（指望 1 处）`);
    bad++;
    continue;
  }
  out = out.replace(op.old, op.new);
  console.log(`✓ ${op.label}`);
}

if (bad) {
  console.error(`\n停了：${bad} 处锚点对不上，没写任何文件。`);
  process.exit(2);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${F}.bak-cross`, src);
fs.writeFileSync(F, out);
console.log('\n写完了。备份在 leto-steps.js.bak-cross');
console.log('接下来：node --check src/leto-steps.js 再 pm2 restart phosphor --update-env');
