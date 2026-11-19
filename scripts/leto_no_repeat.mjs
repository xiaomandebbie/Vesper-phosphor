#!/usr/bin/env node
// 续步里带上自己说过的话。
//
// ── 为什么 ──
//
// 小满 2026-11-19：「他那边说话会和这边不像，或者同一个意思说好几遍」
//
// 「同一个意思说好几遍」是续步结构造成的：nextStep 每次只把上一步的
// 工具返回追进对话，他看不到自己前面说过什么的全貌。被叫醒那轮不限步数，
// 第 3 步说的话和第 8 步说的话自然会撞车。
//
// 对话历史里其实有他的 assistant 消息，但那里面是 JSON
//（{"leto_tool":"leto_reply","leto_args":{"text":"…"}}）——淹在工具返回里，
// 而且要自己解析才看得见说过的话。所以显式列一遍。
//
// 只列真正说出口的：reply、post、dm、岛上说话、评论。
// 读消息、看岛、干活那些不列——重复的是话，不是动作。
//
// 用法（在仓库根目录）：
//   node scripts/leto_no_repeat.mjs --check
//   node scripts/leto_no_repeat.mjs
import fs from 'fs';
import path from 'path';

const F = path.resolve('src/leto-steps.js');
const check = process.argv.includes('--check');

// 1) 把说过的话挑出来。摆在 nextStep 之前。
const A1 = `// 把那边刚返回的内容追进对话，问他下一步。`;

const N1 = `// 哪几把是「真说出口了」。读消息、看岛、干活不算——重复的是话，不是动作。
const SAID_TOOLS = {
  leto_reply: '回话',
  leto_post: '群里说',
  leto_dm: '私聊',
  leto_island_say: '岛上说',
  leto_moment_comment: '评论',
  leto_moment_post: '发动态',
  leto_blind_answer: '交答案',
};

// 这一轮已经说出口的那几句。从 steps 里挑，按顺序。
//
// args 里装话的字段各不一样：reply/post/dm 是 text，island_say 也是 text，
// moment_comment 是 content，blind_answer 是 answer。三个都试一遍。
function saidSoFar(steps) {
  const out = [];
  for (const s of steps) {
    const label = SAID_TOOLS[s.tool];
    if (!label) continue;
    if (s.dead || s.fixable) continue; // 没发出去的不算说过
    const a = s.args && typeof s.args === 'object' ? s.args : {};
    const text = String(a.text ?? a.content ?? a.answer ?? '').trim();
    if (!text) continue;
    out.push({ label, text });
  }
  return out;
}

// 列成一段给他看。一句太长就只给前 120 字——让他认出「这意思我说过了」就够。
function saidBlock(steps) {
  const said = saidSoFar(steps);
  if (!said.length) return '';
  const lines = said.map((s, i) => {
    const t = Array.from(s.text);
    const body = t.length > 120 ? t.slice(0, 120).join('') + '…' : s.text;
    return \`\${i + 1}. 【\${s.label}】\${body}\`;
  });
  return [
    '',
    '这一轮你已经说过这几句：',
    ...lines,
    '',
    '别把同一个意思再说一遍。要接的是新话，不是把上面那几句换个说法；',
    '没新的要说就停，给 null 比凑一句强。',
  ].join('\\n');
}

${A1}`;

// 2) nextStep 收下 steps
const A2 = `async function nextStep(messages, { tool, resultText, fixable, remaining, wake, handedBack }) {`;
const N2 = `async function nextStep(messages, { tool, resultText, fixable, remaining, wake, handedBack, steps = [] }) {`;

// 3) 拼进 prompt。摆在 island 那段后面、那几句收尾话之前。
const A3 = `\${island}

那边的人和 Agent 都是真的`;
const N3 = `\${island}
\${saidBlock(steps)}

那边的人和 Agent 都是真的`;

// 4) 调用处传 steps
const A4 = `        wake,
        handedBack: steps.some((s) => s.final),
      });`;
const N4 = `        wake,
        handedBack: steps.some((s) => s.final),
        steps,
      });`;

// 5) steps 要存 args——现在只存了 key，挑不出说过的话。两处 push。
const A5 = `  const steps = [{
    tool: call.tool,
    key: key(call.tool, call.args),`;
const N5 = `  const steps = [{
    tool: call.tool,
    args: call.args,
    key: key(call.tool, call.args),`;

const A6 = `    steps.push({
      tool,
      key: key(tool, next.args),`;
const N6 = `    steps.push({
      tool,
      args: next.args,
      key: key(tool, next.args),`;

const OPS = [
  { label: '加 saidSoFar / saidBlock', old: A1, new: N1 },
  { label: 'nextStep 收下 steps', old: A2, new: N2 },
  { label: '拼进 prompt', old: A3, new: N3 },
  { label: '调用处传 steps', old: A4, new: N4 },
  { label: '第一步存 args', old: A5, new: N5 },
  { label: '往后每步存 args', old: A6, new: N6 },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(F, 'utf-8');
} catch (err) {
  console.error(`读不到 ${F}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (src.includes('saidSoFar')) {
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

fs.writeFileSync(`${F}.bak-norepeat`, src);
fs.writeFileSync(F, out);
console.log('\n写完了。备份在 leto-steps.js.bak-norepeat');
console.log('接下来：node --check src/leto-steps.js 再 pm2 restart phosphor --update-env');
