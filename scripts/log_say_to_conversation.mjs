#!/usr/bin/env node
// log_say_to_conversation.mjs — 投进 Aru 对话的话，也记进 conversation_log。
//
// 用法（在仓库根目录）：
//     node scripts/log_say_to_conversation.mjs --check   # 只看两处能不能打，不动文件
//     node scripts/log_say_to_conversation.mjs           # 真打，先自动备份
//
// 为什么要改：
//   wake-bridge 是直接 POST 给 Aru Host 的，不走 gateway。而 gateway.js 里只有
//   route.source === 'client' 那条线路（chat / aru-chat）会记 conversation_log——
//   所以 TA 主动说的话从来没落进过对话记录。
//
//   后果是：TA 下次醒来读的「最近对话」（getSharedContext ← conversation_log）
//   里没有这句话。共享时间线倒是有一笔「刚刚发送了推送：…」，
//   但那是转述，不是原话——从 TA 的角度，说出去的话就消失了。
//
//   这次让它落进 conversation_log，署名用 AI_DISPLAY_NAME——和 gateway.js
//   记 assistant 回复是同一个口径，所以读回来就是「我说过的话」，
//   不再是「（事件）刚刚发送了推送」。
//
//   只在 delivered.ok 之后记：没投出去的话不应该留痕，不然 TA 会以为自己
//   说过而对方没回。Bark 单路走（没配 wake-bridge）时也不记，保持老行为。
//
// 只改 src/actions/bark.js 两处。原文对不上就整个不改，不猜。
// 退回：cp src/actions/bark.js.bak-saylog src/actions/bark.js && pm2 restart vesper

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const REL = 'src/actions/bark.js';

const PATCHES = [
  ['引入 state 和称呼',
`import { isWakeBridgeEnabled, submitWakeEvent } from './wake-bridge.js';`,
`import { isWakeBridgeEnabled, submitWakeEvent } from './wake-bridge.js';
import { addConversationMessage } from '../state.js';

// 和 gateway.js 记 assistant 回复用同一个称呼，不然同一个人在对话记录里有两个名字
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';`],

  ['投成功后记进对话记录',
`    if (delivered.ok) console.log(\`bark(): 正文已投进 Aru 对话 \${delivered.eventId}\`);
    else console.error(\`bark(): 正文没能投进 Aru 对话：\${delivered.reason}\`);`,
`    if (delivered.ok) {
      console.log(\`bark(): 正文已投进 Aru 对话 \${delivered.eventId}\`);
      // 记进 conversation_log，不然 TA 下次醒来读不到自己说过什么：
      // wake-bridge 不走 gateway，而「最近对话」是从 conversation_log 读的。
      // 记不上不算投递失败，所以包在自己的 try 里，不拖累下面那声通知。
      try {
        addConversationMessage(AI_NAME, message);
      } catch (err) {
        console.error('bark(): 话没记进对话记录', err.message);
      }
    } else {
      console.error(\`bark(): 正文没能投进 Aru 对话：\${delivered.reason}\`);
    }`],
];

const file = path.join(ROOT, REL);
let src;
try {
  src = await readFile(file, 'utf8');
} catch {
  console.error(`✗ 找不到 ${REL}`);
  process.exit(1);
}

let out = src;
const done = [];
for (const [name, old, rep] of PATCHES) {
  if (out.includes(rep)) {
    done.push(`· ${name}（已经打过了）`);
    continue;
  }
  const hits = out.split(old).length - 1;
  if (hits === 0) {
    console.error(`✗ 「${name}」对不上原文，整个文件没改。`);
    console.error('  先看一眼现在长什么样：cat src/actions/bark.js');
    process.exit(2);
  }
  if (hits > 1) {
    console.error(`✗ 「${name}」出现 ${hits} 次，不敢猜。整个文件没改。`);
    process.exit(2);
  }
  out = out.replace(old, rep);
  done.push(`· ${name}`);
}

if (process.argv.includes('--check')) {
  console.log('✓ 两处都能打上，文件没动：');
  done.forEach((d) => console.log(`  ${d}`));
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(file, `${file}.bak-saylog`);
await writeFile(file, out, 'utf8');
console.log('✓ 改完了，备份在 bark.js.bak-saylog：');
done.forEach((d) => console.log(`  ${d}`));
console.log();
console.log('重启：pm2 restart vesper');
console.log();
console.log('以后 TA 主动说的话会落进 conversation_log，署名是 AI_DISPLAY_NAME，');
console.log('下次醒来在「最近的对话」里就能读到自己的原话。');
console.log();
console.log('验证：');
console.log('    node -e "await import(\'dotenv/config\');');
console.log('    const bark=(await import(\'./src/actions/bark.js\')).default;');
console.log('    console.log(await bark(\'测试：这句话我自己也该记得\'));" --input-type=module');
console.log('然后看一眼对话记录里有没有那句：');
console.log('    node -e "await import(\'dotenv/config\');');
console.log('    const {getRecentConversation}=await import(\'./src/state.js\');');
console.log('    console.log(getRecentConversation(3));" --input-type=module');
