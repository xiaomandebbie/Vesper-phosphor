#!/usr/bin/env node
// 修精确链：到点了却什么都没发生。
//
// 病根在宽限期。preciseTick() 原来是这个顺序：
//   1. 超过 MISSED_GRACE_MS 还没触发的 → 标 missed，不执行
//   2. 剩下到点的 → 执行
// 顺序本身是对的（服务器停机几小时之后，不该把积压的约一口气全触发一遍），
// 但 MISSED_GRACE_MS 只有 3 分钟 —— 而一次完整唤醒要拉 breath、拉 feel、调模型、
// 逛论坛最多再走 3 步、听歌再走 3 步，跑五六分钟是常态。
// 那几分钟里 ticking 锁着，所有 tick 被跳过；等它跑完，这个约已经过期 3 分钟以上，
// 下一轮 tick 第一件事就是把它判死。
//
// 表现出来就是：到点了，没动作，而且她那边完全无声 ——
// missed 只会在下次唤醒时作为一行摘要给他看，不会推送给她。
//
// 改三处：
//   1. 宽限期 3 分钟 → 30 分钟，并且可以用 .env 的 WAKE_MISSED_GRACE_MINUTES 调。
//      30 分钟足够盖住一次最长的唤醒；真正该判 missed 的是停机几小时那种。
//   2. tick 里 preciseTick 提到 nonPreciseTick 前面。
//      约好的时间比「隔一阵子自己醒一下」重要，不该排在它后面等。
//   3. 到点执行时算一下晚了多久，晚过 2 分钟就写进 selfNote 告诉他。
//      约好九点，他九点零六才醒过来，这件事他自己得知道 —— 不然他会以为现在正好是九点。
//
// 用法（在仓库根目录）：
//   node scripts/fix_precise_wake.mjs --check   只看要改哪几处，不写
//   node scripts/fix_precise_wake.mjs           真改，先存一份 .bak
//
// 三处全部对得上才写文件；任一处锚点不唯一就整体停下，不留半成品。跑过一遍再跑不会重复改。

import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/phosphor.js');
const check = process.argv.includes('--check');

// ── 1. 宽限期 ──

const GRACE_OLD = `const TICK_MS = 60 * 1000;
const MISSED_GRACE_MS = 3 * 60 * 1000;`;

const GRACE_NEW = `const TICK_MS = 60 * 1000;
// 约好的时间晚了多久就不算了。
//
// 原来是 3 分钟，太短 —— 一次完整唤醒（breath、feel、模型、论坛续步、听歌续步）
// 跑五六分钟是常态，那几分钟里 tick 全被 ticking 锁跳过，等跑完这个约已经过期，
// 下一轮第一件事就把它标成 missed，于是「到点了什么都没发生」。
//
// 30 分钟足够盖住一次最长的唤醒。真正该判 missed 的是停机几小时那种 ——
// 那时候一口气补触发五个约没有意义，告诉他错过了就够。
// .env 的 WAKE_MISSED_GRACE_MINUTES 可改。
const MISSED_GRACE_MS = (() => {
  const n = Number(process.env.WAKE_MISSED_GRACE_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60 * 1000;
})();`;

// ── 2. tick 顺序 ──

const ORDER_OLD = `    try {
      await nonPreciseTick();
    } catch (err) {
      console.error('nonPreciseTick error:', err);
    }
    try {
      await preciseTick();
    } catch (err) {
      console.error('preciseTick error:', err);
    }`;

const ORDER_NEW = `    // 精确链排在前面：约好的时间比「隔一阵子自己醒一下」重要。
    // 反过来的话，自然唤醒先占住 ticking 锁跑五六分钟，约就在后面干等。
    try {
      await preciseTick();
    } catch (err) {
      console.error('preciseTick error:', err);
    }
    try {
      await nonPreciseTick();
    } catch (err) {
      console.error('nonPreciseTick error:', err);
    }`;

// ── 3. 晚了多久要告诉他 ──

const TICK_OLD = `async function preciseTick() {
  const overdue = getOverduePendingWakes(Date.now(), MISSED_GRACE_MS);
  for (const w of overdue) {
    setPendingWakeStatus(w.id, 'missed');
  }

  const due = getDuePendingWakes();
  for (const w of due) {
    setPendingWakeStatus(w.id, 'triggered');
    await runDecisionCycle({ kind: 'precise', scheduledAt: w.wake_at, selfNote: w.note });
  }
}`;

const TICK_NEW = `async function preciseTick() {
  // 先把过期太久的摘掉（停机几小时之后不该一口气补触发一堆），
  // 再执行还在宽限期内的。
  const overdue = getOverduePendingWakes(Date.now(), MISSED_GRACE_MS);
  for (const w of overdue) {
    setPendingWakeStatus(w.id, 'missed');
    console.warn(
      \`phosphor: 约好的 \${new Date(w.wake_at).toLocaleString()} 已经过去太久（note: \${w.note ?? '(无)'}），这次不补，下次醒来会告诉他\`
    );
  }

  const due = getDuePendingWakes();
  for (const w of due) {
    setPendingWakeStatus(w.id, 'triggered');
    // 晚了多久他自己得知道。约好九点、九点零六才醒过来，
    // 不说的话他会当成现在正好是九点，然后说一句对不上的话。
    const lateMin = Math.round((Date.now() - w.wake_at) / 60000);
    const note = lateMin >= 2
      ? \`\${w.note ?? ''}（这个约定的时间是 \${new Date(w.wake_at).toLocaleString()}，你晚了 \${lateMin} 分钟才醒过来，说话时把这件事算进去）\`.trim()
      : w.note;
    console.log(
      \`phosphor: 到点了，按约醒一次（原定 \${new Date(w.wake_at).toLocaleString()}\${lateMin >= 2 ? \`，晚了 \${lateMin} 分钟\` : ''}）\`
    );
    await runDecisionCycle({ kind: 'precise', scheduledAt: w.wake_at, selfNote: note });
  }
}`;

const OPS = [
  { label: '宽限期 3 分钟 → 30 分钟（可配）', old: GRACE_OLD, new: GRACE_NEW },
  { label: '精确链提到自然唤醒前面', old: ORDER_OLD, new: ORDER_NEW },
  { label: '到点执行时带上「晚了多久」', old: TICK_OLD, new: TICK_NEW },
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
    console.error(`停了：${op.label} —— 找到 ${n} 处（指望 1 处）。`);
    console.error('没写任何文件。这段原文可能被改过，贴给小克看一下。');
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
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, out);
console.log(`\n写完了。原文备份在 ${path.basename(FILE)}.bak`);
console.log('接下来：node --check src/phosphor.js，再 pm2 restart phosphor --update-env');
