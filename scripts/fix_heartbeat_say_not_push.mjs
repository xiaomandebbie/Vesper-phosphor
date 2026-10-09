#!/usr/bin/env node
// fix_heartbeat_say_not_push.mjs — heartbeat 不再发 Bark，改成主动说话。
//
// 用法（在 vesper-phosphor 根目录）：
//     node scripts/fix_heartbeat_say_not_push.mjs --check          # 只看能不能打，不动文件
//     node scripts/fix_heartbeat_say_not_push.mjs                  # 真打，先自动备份
//     node scripts/fix_heartbeat_say_not_push.mjs /路径/heartbeat  # 手动指定目录
//
// 四件事：
//   1) 取消 Bark。Aru 收到外部触发时自带弹窗，再叮一声是重复的。
//   2) 不再把回复拆成「标题｜正文」——整段就是他想说的话，原样投过去。
//   3) 记录按普通聊天内容记，不带「刚刚给用户发了Bark推送」那种字样。
//      投成功时 eventContent 就是正文本身，没有时间前缀——所以
//      special_events.js 那个正则不认它，它在时间线里就是一条普通 assistant 消息。
//      下次 Aru 把这句话带回来时内容一字不差，buildTimeline 的去重会自动并成一条。
//   4) 门槛诊断。shouldWake 把三个数都打出来：她最后一条是什么时候、
//      隔了多少分钟、门槛是多少。以前只能靠猜为什么没拦住。
//
// 前置：需要先打过 wire_heartbeat_wake_bridge.mjs（那个给 heartbeat 装上
// wake-bridge.mjs 投递函数）。没装的话这里会投不出去，日志里会说清楚。
//
// 原文对不上就整个不改，不猜。
// 退回：cp wake_up.js.bak-saynotpush wake_up.js && pm2 restart wake-up

import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  process.argv.find((a) => a.startsWith('/') && !a.endsWith('.mjs')),
  '/root/dylan-heartbeat',
  '/root/heartbeat',
  path.join(os.homedir(), 'dylan-heartbeat'),
].filter(Boolean);

let DIR = null;
for (const d of CANDIDATES) {
  try {
    await access(path.join(d, 'wake_up.js'));
    DIR = d;
    break;
  } catch {}
}
if (!DIR) {
  console.error('\u2717 \u627e\u4e0d\u5230 heartbeat \u7684 wake_up.js\u3002\u8bd5\u8fc7\uff1a');
  CANDIDATES.forEach((d) => console.error(`    ${d}`));
  console.error('\n\u628a\u771f\u5b9e\u8def\u5f84\u5f53\u53c2\u6570\u4f20\u8fdb\u6765\uff1a');
  console.error('    node scripts/fix_heartbeat_say_not_push.mjs /\u4f60\u7684/heartbeat\u76ee\u5f55');
  process.exit(1);
}

const WAKE_FILE = path.join(DIR, 'wake_up.js');
const check = process.argv.includes('--check');

// ══ 新的「主动说话」分支（整段替掉原来的发推送那块）══
// 用数组拼，里面的反引号和 ${} 是要写进 wake_up.js 的字面量，不是这里的模板

const NEW_BLOCK = [
'  } else {',
'    // 允朔主动说话：正文投进 Aru 对话，不再发 Bark 推送。',
'    // 批注 2026-10-09：',
'    //   1) Aru 收到外部触发时自带弹窗，Bark 那一声是重复的，取消；',
'    //   2) 不再拆「标题｜正文」——整段就是他想说的话；',
'    //   3) 记录按普通聊天内容记。投成功时 eventContent 就是正文本身，',
'    //      没有时间前缀，所以 special_events.js 那个正则不认它，',
'    //      在时间线里它就和平时聊天一样，只是这句是他主动说的。',
'    //      下次 Aru 带回这句时内容一字不差，buildTimeline 的去重会并成一条。',
'    console.log("\\nAI 选择主动说话\\n");',
'    let sayText = aiText;',
'',
'    // 模型偶尔还写 [BARK] 标签，剥掉',
'    const barkMatch = sayText.match(/\\[BARK\\]([\\s\\S]*?)\\[\\/BARK\\]/);',
'    if (barkMatch) {',
'      sayText = barkMatch[1].trim();',
'    } else {',
'      sayText = sayText.replace(/^\\[BARK\\]\\s*/, "").trim();',
'      sayText = sayText.replace(/\\s*\\[\\/BARK\\]$/, "").trim();',
'    }',
'',
'    // 「标题：」「正文：」这种前缀也清掉，剩下的整段原样发',
'    sayText = sayText',
'      .replace(/^标题[：:]\\s*/gm, "")',
'      .replace(/^正文[：:]\\s*/gm, "")',
'      .trim();',
'',
'    if (!sayText) {',
'      console.log("\\n内容清洗后为空，本次不说话\\n");',
'      eventContent = `（${getLocalTimeString()} 自动唤醒：本次没说话｜原因：内容为空）`;',
'    } else {',
'      let bridged = { ok: false, reason: "WAKE_BUNDLE_FILE not set" };',
'      try {',
'        const wb = await import("./wake-bridge.mjs");',
'        if (wb.isWakeBridgeEnabled()) {',
'          bridged = await wb.submitWakeEvent(sayText);',
'        } else {',
'          console.log("\\n没配 WAKE_BUNDLE_FILE，这句话投不出去\\n");',
'        }',
'      } catch (err) {',
'        bridged = { ok: false, reason: err.message };',
'      }',
'',
'      if (bridged.ok) {',
'        console.log(`\\n已投进 Aru 对话 ${bridged.eventId}\\n`);',
'        eventContent = sayText;',
'      } else {',
'        console.error(`\\n没能投进 Aru 对话：${bridged.reason}\\n`);',
'        eventContent = `（${getLocalTimeString()} 自动唤醒：本次没说出去｜原因：${bridged.reason}）`;',
'      }',
'    }',
'  }',
].join('\n');

// ══ 门槛诊断 ══

const SHOULD_WAKE_OLD = [
'function shouldWake(lastUserTime) {',
'  const now = getNow();',
'  const diffMinutes = Math.floor((now - new Date(lastUserTime)) / 1000 / 60);',
'  return diffMinutes >= getWakeAfterMinutes(now);',
'}',
].join('\n');

const SHOULD_WAKE_NEW = [
'function shouldWake(lastUserTime) {',
'  const now = getNow();',
'  const diffMinutes = Math.floor((now - new Date(lastUserTime)) / 1000 / 60);',
'  const threshold = getWakeAfterMinutes(now);',
'  // 批注 2026-10-09：门槛到底有没有拦住，以前只能靠猜。',
'  // 这行把三个数都打出来：她最后一条是什么时候、隔了多少分钟、门槛多少。',
'  // 门槛不对就改 .env 的 DAY_WAKE_AFTER_MINUTES（白天）。',
'  console.log(JSON.stringify({',
'    event: "wake_threshold",',
'    last_user: formatDateTimeInTimeZone(new Date(lastUserTime), TIME_ZONE),',
'    diff_minutes: diffMinutes,',
'    threshold_minutes: threshold,',
'    daytime: isDayTime(now),',
'    will_wake: diffMinutes >= threshold',
'  }));',
'  return diffMinutes >= threshold;',
'}',
].join('\n');

// ══ 默认 prompt 里那句话（可选：用了 wake_prompt.txt 就不存在）══

const PROMPT_OLD = '- 如果想联系用户，直接写你想说的话。系统会自动打包成手机推送发送。可以是一句话，也可以第一行作为标题、第二行作为正文。';
const PROMPT_NEW = '- 如果想联系用户，直接写你想说的话，整段会作为一条消息发给她。不用写标题，也不用分行当标题正文。';

// ══ 干活 ══

let src;
try {
  src = await readFile(WAKE_FILE, 'utf8');
} catch (err) {
  console.error(`\u2717 \u8bfb\u4e0d\u52a8 ${WAKE_FILE}\uff1a${err.message}`);
  process.exit(1);
}

console.log(`heartbeat: ${DIR}\n`);

let out = src;
const done = [];

// ── 1. 整段替掉发推送分支 ──
const START = '  } else {\n    // 没有 [NO_ACTION] 就视为想发推送';
const END = '  try {\n    const eventResponse = await fetch(GATEWAY_URL, {';

if (out.includes('AI 选择主动说话')) {
  done.push('\u00b7 主动说话分支（已经打过了）');
} else {
  const i = out.indexOf(START);
  const j = i >= 0 ? out.indexOf(END, i) : -1;
  if (i < 0) {
    console.error('\u2717 「发推送分支」找不到起点，整个文件没改。');
    console.error('  先看一眼现在长什么样：');
    console.error(`      grep -n "NO_ACTION" ${WAKE_FILE}`);
    process.exit(2);
  }
  if (j < 0) {
    console.error('\u2717 「发推送分支」找不到终点（Gateway 记录那段），整个文件没改。');
    process.exit(2);
  }
  out = out.slice(0, i) + NEW_BLOCK + '\n\n' + out.slice(j);
  done.push('\u00b7 主动说话分支：不发 Bark、不拆标题、记成普通聊天');
}

// ── 2. 门槛诊断 ──
if (out.includes('wake_threshold')) {
  done.push('\u00b7 门槛诊断（已经打过了）');
} else {
  const hits = out.split(SHOULD_WAKE_OLD).length - 1;
  if (hits !== 1) {
    console.error(`\u2717 「门槛诊断」shouldWake 原文匹配到 ${hits} 处，整个文件没改。`);
    process.exit(2);
  }
  out = out.replace(SHOULD_WAKE_OLD, SHOULD_WAKE_NEW);
  done.push('\u00b7 门槛诊断：打出最后一条时间、隔了多久、门槛多少');
}

// ── 3. 默认 prompt（可选）──
if (out.includes(PROMPT_NEW)) {
  done.push('\u00b7 默认 prompt 那句（已经打过了）');
} else if (out.includes(PROMPT_OLD)) {
  out = out.replace(PROMPT_OLD, PROMPT_NEW);
  done.push('\u00b7 默认 prompt：别写标题，整段当一条消息');
} else {
  done.push('\u00b7 默认 prompt（跳过：没找到那句，应该是用了 wake_prompt.txt）');
}

if (check) {
  console.log('\u2713 能打上，文件没动：');
  done.forEach((d) => console.log(`  ${d}`));
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(WAKE_FILE, `${WAKE_FILE}.bak-saynotpush`);
await writeFile(WAKE_FILE, out, 'utf8');

console.log('\u2713 改完了，备份在 wake_up.js.bak-saynotpush：');
done.forEach((d) => console.log(`  ${d}`));
console.log();
console.log('重启：pm2 restart wake-up');
console.log();
console.log('然后挂着日志看下一次检查：');
console.log('    pm2 logs wake-up --lines 0 --timestamp');
console.log();
console.log('会先出现一行 wake_threshold，里面四个数一眼能看出门槛对不对：');
console.log('    last_user / diff_minutes / threshold_minutes / will_wake');
console.log('threshold_minutes 不是 60 的话，改 heartbeat 的 .env：');
console.log('    DAY_WAKE_AFTER_MINUTES=60');
console.log('    DAY_CHECK_INTERVAL_MINUTES=10');
console.log();
console.log('还要看一眼 wake_prompt.txt（存在的话它覆盖默认 prompt）：');
console.log(`    grep -n "推送\\|标题" ${path.join(DIR, 'wake_prompt.txt')}`);
console.log('里面还说「打包成手机推送」「第一行当标题」的话，改成「整段作为一条消息发给她」。');
console.log();
console.log('退回：cp wake_up.js.bak-saynotpush wake_up.js && pm2 restart wake-up');
