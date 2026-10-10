#!/usr/bin/env node
// keep_sent_at_in_timeline.mjs — 写时间线时把 <sent_at> 转成正则认得的时间前缀。
//
// 用法（在 vesper-phosphor 根目录）：
//     node scripts/keep_sent_at_in_timeline.mjs --check   # 只看能不能打，不动文件
//     node scripts/keep_sent_at_in_timeline.mjs           # 真打，先自动备份
//
// 病根（2026-10-10 实测）：
//   heartbeat 的 getLastUserTime 靠正则从消息**正文里**抠 YYYY-MM-DD HH:mm。
//   而 gateway 的 stripInjectedBlocks 写时间线前会把 <sent_at ...> 整个删掉——
//   删完正文里就没时间戳了，正则找不到，只能一路往前扒到更老的、
//   正文里恰好带时间的那条。后果：
//     diff 83 → last_user 10-10 10:12   （她其实 11:58 刚说过话）
//     diff 93 → last_user 10-10 10:12   （还是 10:12）
//     diff 20050 → last_user 09-26 13:56（扒到半个月前）
//   每次算出来都远过 60 分钟门槛，于是每十分钟放行一次。
//   门槛逻辑本身没错，是喂给它的数字错了。
//
// 改法：
//   不再把 <sent_at> 删干净，换成把里面的时间提到正文开头：
//     <sent_at 2026-10-10 12:26>你好  →  （2026-10-10 12:26）你好
//   这个格式和 heartbeat 自己记的事件一模一样，正则现成就认。
//   本来就带时间前缀的消息不重复加；认不出时间的照旧删掉。
//
//   只改一处，只影响写进 conversation_log 和时间线的文本。
//   不动转发给上游的 messages，模型看到的对话一字不变。
//
// 原文对不上就整个不改，不猜。
// 退回：cp src/gateway.js.bak-sentat src/gateway.js && pm2 restart vesper-gateway

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const REL = 'src/gateway.js';
const FILE = path.join(ROOT, REL);

const OLD = `function stripInjectedBlocks(content) {
  return contentToText(content)
    .replace(/<environment>[\\s\\S]*?<\\/environment>/g, '')
    .replace(/<sent_at[^>]*>/g, '')
    .trim();
}`;

const NEW = `// <sent_at> 里的时间要留下来，别删干净。
// 批注 2026-10-10：heartbeat 的 getLastUserTime 靠正则从正文里抠
// YYYY-MM-DD HH:mm 来算「她多久没说话」。以前这里把 <sent_at ...> 整个删掉，
// 正文里就没时间戳了——正则找不到，就一路往前扒到更老的那条，
// diff 算成两小时甚至半个月，60 分钟门槛形同虚设，每十分钟放行一次。
// 现在改成把时间提到正文开头，和 heartbeat 自己记事件是同一个格式。
const SENT_AT_RE = /<sent_at\\s+(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})[ T]?(\\d{1,2})[:：](\\d{2})[^>]*>/;

function stripInjectedBlocks(content) {
  const text = contentToText(content).replace(/<environment>[\\s\\S]*?<\\/environment>/g, '');
  const m = text.match(SENT_AT_RE);
  const body = text.replace(/<sent_at[^>]*>/g, '').trim();
  if (!m || !body) return body;
  const pad = (v) => String(v).padStart(2, '0');
  const stamp = \`\${m[1]}-\${pad(m[2])}-\${pad(m[3])} \${pad(m[4])}:\${m[5]}\`;
  // 本来就带时间前缀的就不重复加了
  if (/^[（(]?\\s*\\d{4}[-/]\\d{1,2}[-/]\\d{1,2}/.test(body)) return body;
  return \`（\${stamp}）\${body}\`;
}`;

let src;
try {
  src = await readFile(FILE, 'utf8');
} catch (err) {
  console.error(`\u2717 读不动 ${REL}：${err.message}`);
  process.exit(1);
}

if (src.includes('SENT_AT_RE')) {
  console.log('\u2713 已经打过了，文件没动。');
  process.exit(0);
}

const hits = src.split(OLD).length - 1;
if (hits === 0) {
  console.error('\u2717 stripInjectedBlocks 对不上原文，整个文件没改。');
  console.error('  先看一眼现在长什么样：');
  console.error('      grep -n "stripInjectedBlocks" -A 7 src/gateway.js');
  process.exit(2);
}
if (hits > 1) {
  console.error(`\u2717 原文出现 ${hits} 次，不敢猜。整个文件没改。`);
  process.exit(2);
}

if (process.argv.includes('--check')) {
  console.log('\u2713 能打上，文件没动：');
  console.log('  \u00b7 stripInjectedBlocks 保留 sent_at 时间戳');
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(FILE, `${FILE}.bak-sentat`);
await writeFile(FILE, src.replace(OLD, NEW), 'utf8');

console.log('\u2713 改完了，备份在 gateway.js.bak-sentat。');
console.log();
console.log('重启：pm2 restart vesper-gateway');
console.log();
console.log('然后在 Aru 里跟他说一句话，再看下一次 heartbeat 检查：');
console.log('    pm2 logs wake-up --lines 0 --timestamp');
console.log();
console.log('last_user 应该就是你刚才说话的时间，diff_minutes 个位数，will_wake:false。');
console.log('旧消息没有时间戳补不回来，所以要等一条新的进时间线才生效。');
console.log();
console.log('退回：cp src/gateway.js.bak-sentat src/gateway.js && pm2 restart vesper-gateway');
