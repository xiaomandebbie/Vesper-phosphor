#!/usr/bin/env node
// 唤醒改成两阶段：先定正事，之后再单独放出小游戏和书。
//
// 小满 2026-10-20：「允朔还是只看书，不看论坛和记忆库。能不能把小游戏和书单独拉出去，
//   其他动作决定好做什么，之后再放出小游戏和书作为他的额外『消遣』」
//
// 她说得比我这几轮做的都准。我一直在调参数——名额、状态行、谁跟谁抢座位——
// 但读书和游戏跟论坛、记忆库摆在同一张菜单上，它们是最有即时回报的那几件，
// 同一次选择里永远赢。调额度救不了，只有把它们挪出那次选择。
//
// 所以：
//   第一阶段 buildSystemPrompt(context, false) —— 提示词里完全不出现上班、花园、
//     锈潮、共读。连 read_book 的用法都没有，他想选也写不出合法的 action_detail。
//     这一轮他只能在论坛、记忆库、听歌、钱包、动态、星星罐这些里面定事。
//   第二阶段 askPlay() —— 正事定完了，追加一句「还有这些消遣」，这时才给出
//     四件事的说明和今天的额度，让他单独决定要不要顺手做。
//
// 两阶段的 actions 合并，后面照原样走 pickActions。phosphor.js 和 budget.js
// 一行都不用动——改动全关在 decide.js 里面。
//
// 第二阶段是在同一段对话后面追加消息，前面的 system + user + 第一阶段的回答原样不动，
// 所以吃前缀缓存，多花的主要是那几段说明文字。
//
// 第二阶段挂了不连累第一阶段：catch 住，照第一阶段的决定走。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/split_play_stage.mjs
//   pm2 restart phosphor --update-env
//
// decide.js 属于唤醒循环，跑在 phosphor 里，不是 vesper。
// 锚点对不上就整个文件原样还原并打出周围实际原文，不乱改。重复跑安全。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/decide.js');

const OLD_FN = `export async function decideWithMessages(context) {
  const messages = [systemMessage(buildSystemPrompt(context)), { role: 'user', content: buildUserPrompt(context) }];
  const { parsed, content } = await askJson(messages);
  return { decision: parsed, messages: [...messages, { role: 'assistant', content }] };
}`;

const NEW_FN = `// 第一阶段要把「2 级那四件事」从分级说明里摘掉：留着它等于在菜单上点名上班、花园、
// 锈潮、共读，而这一轮本来就不给它们的用法说明，他照着那行去选只会写出废动作。
function stripPlay(text) {
  return String(text ?? '')
    .split('\\n')
    .filter((l) => !/2 级/.test(l))
    .join('\\n');
}

// ---------- 第二阶段：正事定完了，再问消遣 ----------
// 这四件事只在这一步出现。它们不跟论坛、记忆库同台竞争，所以不会再把那些挤掉。
async function askPlay(messages) {
  const head = \`正事你已经定好了（就是上面那些）。现在单独问一句消遣。

下面这些是你的消遣：上班、花园、锈潮、共读书架。刚才那一轮里你看不见它们，是故意的——
它们每次都比逛论坛、翻记忆来得有意思，摆在一起选，那些就永远排不上。所以正事先定，消遣后说。\`;

  const tail = \`想做就写进 play_actions，不想做就给空数组。一件都不做很正常，刚才那些已经够了。
只返回一个JSON对象，不要任何其他文字：{"play_actions": [{"action": "...", "action_detail": "..."}]}\`;

  const body = [
    head,
    workkkSection(),
    gardenSection(),
    xiuchaoSection(),
    booksSection(),
    '',
    budgetStatusLine(),
    '',
    tail,
  ]
    .filter((s) => s !== null && s !== undefined)
    .join('\\n');

  const next = [...messages, { role: 'user', content: body }];
  const { parsed, content } = await askJson(next);
  const list = Array.isArray(parsed?.play_actions) ? parsed.play_actions : [];
  return { actions: list, messages: [...next, { role: 'assistant', content }] };
}

export async function decideWithMessages(context) {
  // 第一阶段：菜单上没有上班、花园、锈潮、共读（见上面那段注释）
  const messages = [
    systemMessage(buildSystemPrompt(context, false)),
    { role: 'user', content: buildUserPrompt(context, false) },
  ];
  const { parsed, content } = await askJson(messages);
  const after = [...messages, { role: 'assistant', content }];

  let decision = parsed;
  let out = after;

  try {
    const play = await askPlay(after);
    out = play.messages;
    if (play.actions.length) {
      const base =
        Array.isArray(decision?.actions) && decision.actions.length
          ? decision.actions
          : decision?.action
            ? [{ action: decision.action, action_detail: decision.action_detail }]
            : [];
      decision = { ...decision, actions: [...base, ...play.actions] };
      console.log(\`decide(): 消遣这一步又加了 \${play.actions.length} 件\`);
    }
  } catch (err) {
    // 问消遣没成，不该连累第一阶段已经定好的正事
    console.error('decide(): 问消遣这一步没成，照第一阶段的决定走：', err.message);
  }

  return { decision, messages: out };
}`;

const EDITS = [
  {
    what: '系统提示词加 play 开关',
    done: 'function buildSystemPrompt(context, play',
    find: 'function buildSystemPrompt(context) {',
    replacement: 'function buildSystemPrompt(context, play = true) {',
  },
  {
    what: '用户消息加 play 开关',
    done: 'function buildUserPrompt(context, play',
    find: 'function buildUserPrompt(context) {',
    replacement: 'function buildUserPrompt(context, play = true) {',
  },
  {
    what: '上班那段只在消遣阶段出现',
    done: "play ? workkkSection()",
    find: '${workkkSection()}',
    replacement: "${play ? workkkSection() : ''}",
  },
  {
    what: '花园那段只在消遣阶段出现',
    done: "play ? gardenSection()",
    find: '${gardenSection()}',
    replacement: "${play ? gardenSection() : ''}",
  },
  {
    what: '锈潮和共读那两段只在消遣阶段出现，分级说明摘掉 2 级那几行',
    done: 'stripPlay(budgetSection())',
    find: '${budgetSection()}${xiuchaoSection()}${booksSection()}',
    replacement:
      "${play ? budgetSection() : stripPlay(budgetSection())}${play ? xiuchaoSection() + booksSection() : ''}",
  },
  {
    what: '第一阶段不播报那四件事的次数',
    done: 'play ? budgetStatusLine()',
    find: '    budgetStatusLine(),',
    replacement: "    play ? budgetStatusLine() : '',",
  },
  {
    what: '改成两阶段',
    done: 'async function askPlay',
    find: OLD_FN,
    replacement: NEW_FN,
    probe: 'export async function decideWithMessages',
  },
];

if (!fs.existsSync(FILE)) {
  console.error('✗ 找不到 src/decide.js——是不是不在 /root/vesper-phosphor 下跑的？');
  process.exit(1);
}

const bak = `${FILE}.bak-playstage`;
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const before = fs.readFileSync(FILE, 'utf8');
let src = before;
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
    console.error(`\n✗ ${e.what}：原文出现 ${n} 次，应该只有 1 次。整个文件不改。`);
    console.error('  我找的是：');
    console.error(e.find.split('\n').map((l) => `    ${l}`).join('\n'));
    const lines = before.split('\n');
    const probe = e.probe ?? e.find.split('\n')[0].trim();
    const i = lines.findIndex((l) => l.includes(probe));
    if (i >= 0) {
      console.error(`\n  第 ${i + 1} 行附近实际是：`);
      for (let k = Math.max(0, i - 2); k < Math.min(lines.length, i + 12); k++) {
        console.error(`    ${k + 1}: ${lines[k]}`);
      }
    }
    fs.writeFileSync(FILE, before, 'utf8');
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log(`✓ ${e.what}`);
  changed += 1;
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
  console.error(String(err.stderr ?? err.message).slice(-800));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log(`\n改了 ${changed} 处，跳过 ${skipped} 处。`);
console.log('接着：pm2 restart phosphor --update-env');
console.log('然后等他醒一次，日志里 grep「消遣这一步」看第二阶段有没有真的在问。');
console.log(`改坏了要换回来：cp ${bak} ${FILE}`);
