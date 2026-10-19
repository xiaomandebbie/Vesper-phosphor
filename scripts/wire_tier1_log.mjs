#!/usr/bin/env node
// 1 级也记一本账。
//
// 小满 2026-10-19：「他咋唤醒只玩游戏不用论坛和记忆库、音乐…一堆其他功能了」
//
// 根因不在他，在提示词的不对称：
//   budgetStatusLine() 每次醒来都往 user 消息里写一句活的、带数字的话——
//   「2 级今天还剩 5 次：上班今天 1 次、花园今天还没去、锈潮上次是 3 天前」。
//   而论坛、听歌、钱包、批注本、小酒馆一个字的状态都没有，它们只存在于
//   system 里那段永不变化的说明。
//
//   对模型来说这两者不是一个量级：一边是会变的、有计数的、还带「3 天没去了」
//   的东西，另一边是背景噪音。每次醒来他看见的唯一「有进度的世界」就是那四个游戏。
//   证据：tier2_log 近三天 garden 4、books 2、workkk 1，1 级一条记录都没有——
//   因为 1 级压根不记账。
//
//   更糟的是论坛那边唯一的动态信息是劝退的：「只是备忘，不是待办；看过、回过的
//   别再反复点开」。游戏那边是「锈潮上次是 3 天前」。一边在招手，一边在摆手。
//
// 这个脚本做三件事：
//   一、给 1 级开一本账（新表 tier1_log），**不设上限**——1 级本来不限次数，
//       记账不是为了限制他，只是为了让他看见「论坛上次是 3 天前」。
//   二、把这行状态和 2 级那行并排放进 user 消息，语气完全一样，不加催促。
//   三、把论坛那两句劝退话改成中性的。
//
// 为什么不复用 tier2_log：它已经为读书开了 kind != 'books' 的例外。再塞五种
// 1 级进去，那个排除条件会变成一长串，哪天漏一个就把 2 级额度算爆。
//
// set_mode 不记——「上次调节律是 3 天前」没有意义。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/wire_tier1_log.mjs
//   pm2 restart vesper --update-env
// 每一处改动都先查「是不是已经改过了」，重复跑安全。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const p = (rel) => path.join(ROOT, rel);

// ── 要插进 budget.js 的那一段 ──

const TIER1_BLOCK = `// ── 1 级也记一本账 ──
//
// 小满 2026-10-19：他只玩游戏，不逛论坛、不听歌、不碰记忆库。
//
// 不是他挑的，是他只看得见游戏：budgetStatusLine 每次醒来都播报 2 级那四件事
// 带数字的活状态（「花园今天 2 次」「锈潮上次是 3 天前」），1 级那几件一个字都没有，
// 只存在于 system 里那段永不变化的说明里。一边是有进度的世界，另一边是背景噪音。
//
// 所以 1 级也记一笔，只为了让他看见「论坛上次是 3 天前」。
// 这本账**没有上限**：1 级本来不限次数，记账不是为了限制他。
//
// 为什么单建一张表：tier2_log 已经为读书开了 kind != 'books' 的例外，再把五种
// 1 级塞进去，那个排除条件会变成一长串，漏一个就把 2 级的额度算爆。

db.exec(\`
CREATE TABLE IF NOT EXISTS tier1_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tier1_log_ts ON tier1_log (ts);
\`);

// 记账的五件。set_mode 不在里面：「上次调节律是 3 天前」没有意义。
export const TIER1_KINDS = {
  lutopia: '论坛',
  music: '听歌',
  wallet: '钱包',
  memo: '批注本',
  proof: '小酒馆',
};

// 这个动作算 1 级里的哪一件；不是就返回 null
export function tier1KindOf(action, detail) {
  const a = String(action ?? '').trim();
  if (a === 'read_memo') return 'memo';
  if (a === 'proof_drink') return 'proof';
  if (a !== 'mcp_call') return null;
  const s = serverOf(detail);
  return TIER1_KINDS[s] ? s : null;
}

// 和 recordTier2 同一个位置调用：真正开跑的那一刻记一笔，续步不再记
export function recordTier1(kind) {
  if (!TIER1_KINDS[kind]) return;
  stmt('INSERT INTO tier1_log (ts, kind) VALUES (?, ?)').run(Date.now(), kind);
  stmt('DELETE FROM tier1_log WHERE id NOT IN (SELECT id FROM tier1_log ORDER BY ts DESC, id DESC LIMIT 400)').run();
}

export function tier1Today(ms = Date.now()) {
  const rows = stmt('SELECT kind, COUNT(*) AS c FROM tier1_log WHERE ts >= ? GROUP BY kind').all(dayStart(ms));
  const out = {};
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

export function tier1LastSeen() {
  const out = {};
  for (const kind of Object.keys(TIER1_KINDS)) {
    const row = stmt('SELECT ts FROM tier1_log WHERE kind = ? ORDER BY ts DESC LIMIT 1').get(kind);
    out[kind] = row?.ts ?? null;
  }
  return out;
}

// 用户消息里那一行，和 2 级那行同一个语气。
// 1 级没有次数可剩，所以只说「上次是什么时候」，并且明说不限次数——
// 免得他把这行读成又一本要还的账。
export function tier1StatusLine() {
  const used = tier1Today();
  const last = tier1LastSeen();
  const now = Date.now();

  const parts = Object.entries(TIER1_KINDS).map(([kind, label]) => {
    const n = used[kind] ?? 0;
    if (n) return \`\${label}今天 \${n} 次\`;
    const ts = last[kind];
    if (!ts) return \`\${label}还没去过\`;
    const days = Math.floor((now - ts) / 86400000);
    return days >= 1 ? \`\${label}上次是 \${days} 天前\` : \`\${label}今天还没去\`;
  });

  return \`1 级的事不占次数，想做几件做几件：\${parts.join('、')}。不想碰就不碰，这些一直在那儿。\`;
}

`;

// ── 要插进 run-actions.js 的那一段 ──

const RECORD1_BLOCK = `    // 1 级也记一笔（见 budget.js）。和下面 2 级同一个位置：真正开跑了才记，
    // continueXxx 里接着走的那些步不再记。这本账没有上限，只是为了让他下次
    // 醒来看见「论坛上次是 3 天前」——和那四个游戏一样的活状态。
    const kind1 = tier1KindOf(item.action, item.action_detail);
    if (kind1 && !result?.isError) {
      try {
        recordTier1(kind1);
        console.log(\`[\${kind}] 记上一次 1 级：\${TIER1_KINDS[kind1]}\`);
      } catch (err) {
        console.error('run-actions: 1 级记账失败（不影响这次）', err.message);
      }
    }

`;

// ── 改哪些地方 ──
// kind: 'insertBefore' 在 anchor 前插入 text；'replace' 把 find 换成 replacement。
// done 是「已经改过了」的判断依据，命中就跳过，重复跑安全。

const EDITS = [
  {
    file: 'src/budget.js',
    what: '加 tier1_log 表和五个函数',
    done: 'tier1StatusLine',
    kind: 'insertBefore',
    anchor: 'export function pickActions(list) {',
    text: TIER1_BLOCK,
  },
  {
    file: 'src/run-actions.js',
    what: '引入 1 级记账函数',
    done: 'tier1KindOf',
    kind: 'replace',
    find: 'import { pickActions, tier2KindOf, recordTier2,',
    replacement: 'import { pickActions, tier1KindOf, recordTier1, TIER1_KINDS, tier2KindOf, recordTier2,',
  },
  {
    file: 'src/run-actions.js',
    what: '在 2 级记账旁边加 1 级记账',
    done: 'recordTier1(kind1)',
    kind: 'insertBefore',
    anchor: '    const kind2 = tier2KindOf(item.action, item.action_detail);',
    text: RECORD1_BLOCK,
  },
  {
    file: 'src/decide.js',
    what: '引入 tier1StatusLine',
    done: 'tier1StatusLine',
    kind: 'replace',
    find: "import { budgetSection, budgetStatusLine } from './budget.js';",
    replacement: "import { budgetSection, budgetStatusLine, tier1StatusLine } from './budget.js';",
  },
  {
    file: 'src/decide.js',
    what: '把 1 级状态和 2 级并排放进 user 消息',
    done: 'tier1StatusLine(),',
    kind: 'replace',
    find: '    budgetStatusLine(),',
    replacement: '    budgetStatusLine(),\n    tier1StatusLine(),',
  },
  {
    file: 'src/decide.js',
    what: '论坛备忘那句：去掉劝退',
    done: '（备忘，不是待办）',
    kind: 'replace',
    find: '（只是备忘，不是待办；这次去论坛默认看新帖，看过、回过的别再反复点开）',
    replacement: '（备忘，不是待办）',
  },
  {
    file: 'src/decide.js',
    what: '论坛规则那句：去掉劝退',
    done: '想接着回的帖子就回去看',
    kind: 'replace',
    find: '只是备忘：已经看过的帖子不用再点开，除非你回过它、想看看有没有人接着回你。',
    replacement: '是你最近在论坛做过的事，供你参考：想接着回的帖子就回去看，想换个新题目就 discover / wander。',
  },
];

// ── 执行 ──

let changed = 0;
let skipped = 0;
const touched = new Set();

for (const e of EDITS) {
  const file = p(e.file);
  if (!fs.existsSync(file)) {
    console.error(`✗ 找不到 ${e.file}——是不是不在 /root/vesper-phosphor 下跑的？`);
    process.exit(1);
  }
  let src = fs.readFileSync(file, 'utf8');

  if (src.includes(e.done)) {
    console.log(`· 已经改过，跳过：${e.file} — ${e.what}`);
    skipped += 1;
    continue;
  }

  if (e.kind === 'insertBefore') {
    const n = src.split(e.anchor).length - 1;
    if (n !== 1) {
      console.error(`✗ ${e.file} — ${e.what}：锚点出现 ${n} 次，应该只有 1 次`);
      console.error(`  锚点：${e.anchor}`);
      process.exit(1);
    }
    src = src.replace(e.anchor, `${e.text}${e.anchor}`);
  } else {
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(`✗ ${e.file} — ${e.what}：原文出现 ${n} 次，应该只有 1 次`);
      console.error(`  原文：${e.find}`);
      process.exit(1);
    }
    src = src.replace(e.find, e.replacement);
  }

  // 第一次动这个文件时留一份备份，改坏了能换回来
  if (!touched.has(e.file)) {
    const bak = `${file}.bak-tier1`;
    if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
    touched.add(e.file);
  }

  fs.writeFileSync(file, src, 'utf8');
  console.log(`✓ ${e.file} — ${e.what}`);
  changed += 1;
}

// 语法过一遍，省得重启才发现括号没闭合
for (const rel of touched) {
  try {
    execFileSync(process.execPath, ['--check', p(rel)], { stdio: 'pipe' });
    console.log(`✓ 语法通过：${rel}`);
  } catch (err) {
    console.error(`✗ ${rel} 语法不过，已还原：`);
    console.error(String(err.stderr ?? err.message));
    fs.copyFileSync(`${p(rel)}.bak-tier1`, p(rel));
    process.exit(1);
  }
}

console.log(`\n改了 ${changed} 处，跳过 ${skipped} 处。`);
if (changed) {
  console.log('接着：pm2 restart vesper --update-env');
  console.log('然后等他醒一次，看日志里有没有「记上一次 1 级」。');
} else {
  console.log('没有需要改的，服务不用重启。');
}
