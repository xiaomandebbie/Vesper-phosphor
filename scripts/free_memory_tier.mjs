#!/usr/bin/env node
// 存记忆不该是一件要去竞争的事。
//
// 小满 2026-10-19：「定时存记忆还是很重要的！！！」
//
// ombre_brain 原来是 3 级，和 bark、moment 并列。而 3 级的定义是「会惊动她」，
// 一次醒来只能做一件。可存记忆一声不响，谁也不惊动，却要和「发条动态她会回我」
// 抢同一个名额——这种比较他每次都会选动态。于是记忆永远排不上。
//
// 改法用现成的模式：ONCE 集合（read_book 已经在用）——不占任何级别的名额，
// 但一次醒来最多一件。所以他可以「逆序论坛 + 存一条记忆 + 发条动态」同时做，
// 也不会一次醒来连存十条。pickActions 的逻辑一行不动。
//
// 顺带让它进 tier1_log：状态行里会出现「记忆库上次是 N 天前」。
// 他看不见的事就不会去做，这是这几天反复验证过的。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/free_memory_tier.mjs
//   pm2 restart phosphor --update-env     ← 是 phosphor，不是 vesper
//
// budget.js 被唤醒链（decide.js / run-actions.js）import，那跑在 phosphor 里。
// vesper 是网页进程，重启它对这份改动没有任何效果（2026-10-19 摆过这个乌龙）。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'src/budget.js');

const EDITS = [
  {
    what: '存/翻记忆从 3 级挑出来',
    done: '// 存记忆一声不响',
    find: '  ombre_brain: 3,',
    replacement:
      '  // 存记忆一声不响，谁也不惊动，所以不属于 3 级。原来和 bark、moment 抢同一个名额，\n' +
      '  // 那种比较他每次都会选动态（小满 2026-10-19：「定时存记忆还是很重要的」）。\n' +
      '  // 现在跟 read_book 一样走 ONCE：不占名额，但一次醒来最多一件。\n' +
      '  ombre_brain: 0,',
  },
  {
    what: 'mcp_call 调 ombre-brain 走同一条规矩',
    done: "  'ombre-brain': 0,",
    find: "  'ombre-brain': 3,",
    replacement: "  'ombre-brain': 0,",
  },
  {
    what: '进 ONCE：不占名额，一次醒来最多一件',
    done: "'read_book', 'ombre_brain'",
    find: "const ONCE = new Set(['read_book']);",
    replacement: "const ONCE = new Set(['read_book', 'ombre_brain']);",
  },
  {
    what: '记忆库也有活状态',
    done: "  memory: '\u8bb0\u5fc6\u5e93',",
    find: "  proof: '\u5c0f\u9152\u9986',\n};",
    replacement: "  proof: '\u5c0f\u9152\u9986',\n  memory: '\u8bb0\u5fc6\u5e93',\n};",
  },
  {
    what: 'ombre_brain 记进 tier1_log',
    done: "return 'memory'",
    find: "  if (a === 'read_memo') return 'memo';",
    replacement: "  if (a === 'read_memo') return 'memo';\n  if (a === 'ombre_brain') return 'memory';",
  },
  {
    what: 'mcp 走的那条也认 ombre-brain',
    done: "s === 'ombre-brain'",
    find: '  return TIER1_KINDS[s] ? s : null;',
    replacement: "  if (s === 'ombre-brain') return 'memory';\n  return TIER1_KINDS[s] ? s : null;",
  },
  {
    what: '状态行文案：别说成「1 级」（记忆库和读书都不是）',
    done: '不占 2 级那几次',
    find: '返回 `1 级的事不占次数',
    replacement: null, // 下面单独处理
    skip: true,
  },
];

if (!fs.existsSync(FILE)) {
  console.error('✗ 找不到 src/budget.js——是不是不在 /root/vesper-phosphor 下跑的？');
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');
const bak = `${FILE}.bak-memtier`;
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

let changed = 0;
let skipped = 0;

for (const e of EDITS) {
  if (e.skip) continue;
  if (src.includes(e.done)) {
    console.log(`· 已经改过，跳过：${e.what}`);
    skipped += 1;
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error(`✗ ${e.what}：原文出现 ${n} 次，应该只有 1 次`);
    console.error(`  原文：${e.find}`);
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log(`✓ ${e.what}`);
  changed += 1;
}

// 状态行文案：记忆库和读书都不是 1 级了，别再自称「1 级的事」。
// 这句是模板字符串，单独换。
const OLD_LINE = '1 \u7ea7\u7684\u4e8b\u4e0d\u5360\u6b21\u6570\uff0c\u60f3\u505a\u51e0\u4ef6\u505a\u51e0\u4ef6\uff1a';
const NEW_LINE = '\u8fd9\u51e0\u4ef6\u4e8b\u4e0d\u5360 2 \u7ea7\u90a3\u51e0\u6b21\uff0c\u60f3\u505a\u51e0\u4ef6\u505a\u51e0\u4ef6\uff1a';
if (src.includes(NEW_LINE)) {
  console.log('· 已经改过，跳过：状态行文案');
  skipped += 1;
} else if (src.includes(OLD_LINE)) {
  src = src.replace(OLD_LINE, NEW_LINE);
  console.log('✓ 状态行文案：别再自称「1 级」');
  changed += 1;
} else {
  console.log('· 没找到状态行那句话，跳过（不影响其他改动）');
  skipped += 1;
}

if (!changed) {
  console.log('\n没有需要改的，不用重启。');
  process.exit(0);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('✓ 语法通过');
} catch (err) {
  console.error('✗ 语法不过，已还原：');
  console.error(String(err.stderr ?? err.message));
  fs.copyFileSync(bak, FILE);
  process.exit(1);
}

console.log(`\n改了 ${changed} 处，跳过 ${skipped} 处。`);
console.log('接着：pm2 restart phosphor --update-env');
