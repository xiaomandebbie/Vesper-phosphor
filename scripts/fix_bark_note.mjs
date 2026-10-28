#!/usr/bin/env node
// 把「说一句话」从「打断你」里分出来。改 decide.js 一处。
//
// ── 问题是怎么找到的 ──
//
// 2026-10-28，小满：「我感觉你把我的唤醒桥修坏了，他都不在 aru 给我发消息了」
//
// 桥没坏。查过了：.env 里 WAKE_BUNDLE_FILE / AI_DISPLAY_NAME / GARDEN_PAGE_URL
// 各 1 个、没有挤坏的行，bundle 文件 368 字节在位。
//
// 坏的是他不选 bark。最近四次决定：moment×2、ombre_brain、mcp_call——
// bark 一次都没有。而 submitWakeEvent（投进 Aru 对话的那一步）只在 bark
// 动作里被调用，所以桥永远空转，配置再完好也没用。
//
// ── 为什么他不选 ──
//
// 共享时间线配着的时候，barkNote 走的是严厉版：
//   「推送（bark）会直接打断对方，而且另一个唤醒程序已经在负责…
//    除非有一句非说不可、而且它没说过的话，否则这次别用推送。」
//
// 但 actions/bark.js 里那个动作已经是两路分开的：
//   1) 正文走 wake-bridge 投进 Aru 对话——消息留在那儿，能翻回去看
//   2) Bark 只「叮」一声，标题正文固定，不再搬运内容
// 真正「打断」人的只是第 2 路那声通知；正文落进对话更像发条消息。
// 把两件事绑成一件说，等于告诉他：想说话就得先承认自己在打扰人。
//
// 07:04 那条 self_wake 的 note 是证据：
//   「她要是还没动静，就开口说第一句。别问进度，别催，别绕」
// 他给 70 分钟后的自己留了这句——有话想说，只是觉得不该说。
//
// ── 改成什么 ──
//
// 把那两路说清楚，让他知道投进对话不等于扔炸弹。仍然不鼓励滥用，
// 但不再把「没说过的非说不可」当成门槛——那个标准没人过得了。
//
// 用法：cd /root/vesper-phosphor && node scripts/fix_bark_note.mjs
// 幂等：正文里已经有新版那句就跳过。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'decide.js');

if (!fs.existsSync(FILE)) {
  console.error(`找不到 ${FILE}。要在仓库根目录里跑。`);
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');

const MARKER = '正文会投进她的 Aru 对话';
if (src.includes(MARKER)) {
  console.log('decide.js 里已经是新版的说法了，不用再改。');
  process.exit(0);
}

// 旧的那两句。用最短的特征串匹配，免得左右的缩进和引号对不上。
const OLD_ACTIVE =
  "'推送（bark）会直接打断对方，而且另一个唤醒程序已经在负责\"要不要主动联系对方\"了";
const OLD_IDLE = "'推送（bark）会直接打断对方，只在真有话想让对方马上看到时用。'";

// 找到 barkNote 那个三元表达式的整块。
// 结构是：
//   const barkNote = context.heartbeatActive
//     ? '…严厉版…'
//     : '…宽松版…';
const startIdx = src.indexOf('const barkNote = context.heartbeatActive');
if (startIdx === -1) {
  console.error('找不到 barkNote 那一块。decide.js 可能被改过，什么都没改。');
  console.error('把这行发我：grep -n "barkNote" src/decide.js');
  process.exit(1);
}
// 从 startIdx 往后找第一个分号结尾的行
const endIdx = src.indexOf("';", src.indexOf('\n', src.indexOf('? ', startIdx)));
if (endIdx === -1) {
  console.error('barkNote 那一块的结尾没找到。什么都没改。');
  process.exit(1);
}
const oldBlock = src.slice(startIdx, endIdx + 2);

// 新的。两路说清楚：投进对话是投进对话，那声通知是那声通知。
const newBlock = [
  'const barkNote = context.heartbeatActive',
  "    ? 'bark 是你开口跟她说话的那个动作：正文会投进她的 Aru 对话，像一条消息一样留在那儿，她能翻回去看；手机上另外叮一声，只是告诉她有新消息。有话想说就说，不必等她先开口——想她了、看到了什么、有一句话正好想跟她说，都算理由。另一个唤醒程序也在跟她说话（它发过的在最近对话里标着\"（事件）\"），所以别重复它刚说过的话；但那不是你的配额，你要是有自己的话，照样说。她刚说完话、或者你这几次已经说过好多次了，那就歧一歧。'",
  "    : 'bark 是你开口跟她说话的那个动作：正文会投进她的 Aru 对话，手机上叮一声告诉她。有话想说就说，不必等她先开口；她刚说完话或者你刚说过，那就歧一歧。'",
].join('\n');

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, src.replace(oldBlock, newBlock), 'utf8');

console.log('改好了。barkNote 现在把两路说清楚了：');
console.log('  正文投进 Aru 对话 = 发一条消息，留得住、翻得到');
console.log('  手机上那声 = 只是告诉她有新消息');
console.log('\n旧版备份在 src/decide.js.bak');
console.log('\n接着：');
console.log('  node --check src/decide.js && pm2 restart phosphor --update-env');
console.log('\n想看他到底读到了什么：');
console.log('  grep -A3 "const barkNote" src/decide.js');
