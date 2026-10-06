#!/usr/bin/env node
// fix_heartbeat_thinking.mjs — 让 heartbeat 转发给上游的每个 assistant 回合都带 reasoning_content。
//
// 用法：
//     node scripts/fix_heartbeat_thinking.mjs --check            # 只看能不能打，不动文件
//     node scripts/fix_heartbeat_thinking.mjs                    # 真打，先自动备份
//     node scripts/fix_heartbeat_thinking.mjs /路径/dylan-heartbeat   # 手动指定 heartbeat 目录
//
// 为什么要改：
//   上游开 thinking 后会校验「每个 assistant 回合都要把 reasoning_content 原样传回」，
//   缺一个就整条请求 400：
//     The reasoning_content in the thinking mode must be passed back to the API
//
//   这条链路上有两种 assistant 消息天生没这个字段：
//     1. server.js 自己注入的特殊事件（「自动唤醒」「刚刚发了推送」）——
//        那是拼出来的 { role: "assistant", content }，压根没有思考过程；
//     2. 旧时间线里存的回合（早期只存 role/content/position）。
//
//   单轮唤醒不带历史 assistant 回合，所以一直是通的；多转聊天必炸。
//   表现出来就是「聊天断、唤醒还能发 bark」，以及那段空白。
//
//   补丁在转发前给缺字段的 assistant 回合补一个占位，满足接口的结构要求；
//   真有思考的回合原样不动。想关掉：.env 里设 THINKING_REASONING_FIX=off。
//
// 只改 heartbeat 的 server.js 两处。原文对不上就整个不改，不猜。
// 要退回去：cp server.js.bak-thinking server.js && pm2 restart gateway

import { copyFile, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  process.argv.find((a) => a.startsWith('/')),
  '/root/dylan-heartbeat',
  '/root/heartbeat',
  path.join(os.homedir(), 'dylan-heartbeat'),
  path.join(os.homedir(), 'heartbeat'),
].filter(Boolean);

async function findServerJs() {
  for (const dir of CANDIDATES) {
    const f = path.join(dir, 'server.js');
    try {
      await access(f);
      return f;
    } catch {}
  }
  return null;
}

const TARGET = await findServerJs();
if (!TARGET) {
  console.error('✗ 找不到 heartbeat 的 server.js。试过这几个位置：');
  CANDIDATES.forEach((d) => console.error(`    ${d}`));
  console.error('\n把真实路径当参数传进来：');
  console.error('    node scripts/fix_heartbeat_thinking.mjs /你的/heartbeat目录');
  process.exit(1);
}
const BACKUP = `${TARGET}.bak-thinking`;

// ── 第一处：加开关和占位文案，插在 prepareMessageForLLM 后面 ──
const ANCHOR_1 = `function sanitizeForLog(value) {`;

const INSERT_1 = `// ========================
// thinking 模式：assistant 回合必须带 reasoning_content
// ========================
// 批注 2026-10-06：上游开 thinking 后会校验「每个 assistant 回合都要把 reasoning_content 原样传回」，
// 缺一个就整条请求 400。这条链路上有两种 assistant 消息天生没这个字段：
//   1. 本文件注入的特殊事件（自动唤醒 / 推送记录），是我们自己拼的，从来没有思考过程；
//   2. 早期时间线里只存 role/content/position 的旧回合。
// 单轮唤醒不带历史 assistant 回合，所以一直通；多转聊天必炸。
// 这里在转发前补一个占位，满足接口的结构要求；真有思考的回合原样不动。
function thinkingReasoningFixEnabled() {
  const raw = String(process.env.THINKING_REASONING_FIX ?? "").trim().toLowerCase();
  if (!raw) return true; // 默认开：不开就会 400
  return !["0", "false", "off", "no"].includes(raw);
}

const REASONING_PLACEHOLDER = "（这一轮的思考过程没有保存下来。）";

function sanitizeForLog(value) {`;

// ── 第二处：转发前补齐，插在 tool 修复之前 ──
const ANCHOR_2 = `    // ---- 自动修复不完整的 tool 调用（双向清理） ----`;

const INSERT_2 = `    // ---- thinking 模式：补齐缺失的 reasoning_content ----
    // 上面刚把特殊事件（自动唤醒 / 推送记录）splice 进来，那些是我们自己拼的
    // { role: "assistant", content }，没有思考过程。上游开 thinking 时这会让整条请求 400。
    let reasoningPatched = 0;
    if (thinkingReasoningFixEnabled()) {
      for (let i = 0; i < llmMessages.length; i++) {
        const msg = llmMessages[i];
        if (!msg || msg.role !== "assistant") continue;
        if (typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) continue;
        llmMessages[i] = { ...msg, reasoning_content: REASONING_PLACEHOLDER };
        reasoningPatched++;
      }
    }
    if (reasoningPatched > 0) {
      console.log(JSON.stringify({
        event: "thinking_reasoning_backfilled",
        assistant_messages_patched: reasoningPatched
      }));
    }

    // ---- 自动修复不完整的 tool 调用（双向清理） ----`;

const PATCHES = [
  ['加开关和占位文案', ANCHOR_1, INSERT_1],
  ['转发前补齐 reasoning_content', ANCHOR_2, INSERT_2],
];

let src = await readFile(TARGET, 'utf8');
const done = [];

for (const [name, anchor, insert] of PATCHES) {
  if (src.includes(insert)) {
    done.push(`· ${name}（已经打过了）`);
    continue;
  }
  const hits = src.split(anchor).length - 1;
  if (hits === 0) {
    console.error(`✗ 「${name}」对不上原文，可能上游换了写法。整个文件没改。`);
    process.exit(2);
  }
  if (hits > 1) {
    console.error(`✗ 「${name}」在文件里出现 ${hits} 次，不敢猜。整个文件没改。`);
    process.exit(2);
  }
  src = src.replace(anchor, insert);
  done.push(`· ${name}`);
}

console.log(`heartbeat: ${TARGET}\n`);

if (process.argv.includes('--check')) {
  console.log('✓ 两处都能打上，文件没动：');
  done.forEach((d) => console.log(`  ${d}`));
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(TARGET, BACKUP);
await writeFile(TARGET, src, 'utf8');
console.log('✓ 改完了，备份在 server.js.bak-thinking：');
done.forEach((d) => console.log(`  ${d}`));
console.log('\n重启：pm2 restart gateway   （名字以 pm2 list 里显示的为准）');
console.log('验证：聊两三转不再报 400；日志里会出现 thinking_reasoning_backfilled');
console.log('关掉：.env 里设 THINKING_REASONING_FIX=off 再重启');
console.log('退回：cp server.js.bak-thinking server.js && pm2 restart gateway');
