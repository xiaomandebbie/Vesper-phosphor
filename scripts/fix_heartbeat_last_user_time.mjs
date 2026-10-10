#!/usr/bin/env node
// fix_heartbeat_last_user_time.mjs — 让门槛算得准。
//
// 用法（在 vesper-phosphor 根目录）：
//     node scripts/fix_heartbeat_last_user_time.mjs --check          # 只看能不能打
//     node scripts/fix_heartbeat_last_user_time.mjs                  # 真打，先备份
//     node scripts/fix_heartbeat_last_user_time.mjs /路径/heartbeat  # 手动指定目录
//
// 病根（2026-10-10 实测确认）：
//   时间戳一直在时间线里，没丢：
//     "content": "喜欢这个版本～\n\n<sent_at 2026-10-10 11:58>"
//   问题在 parseTimelineTimestamp 用 match 取**第一个**命中。
//   而 Aru 发来的消息，<environment> 块在开头、<sent_at> 在末尾，
//   环境块里塞着跨对话记忆片段，那些片段带 ISO 日期：
//     Driveso · 2026-09-30T04:03:44Z
//   正则里的 (?:[ T]?) 恰好认那个 T——于是抠到的是记忆里的旧日期。
//
//   日志对得上：last_user 被认成 2026-09-26 13:56，diff 20050 分钟。
//   20050 分钟 ≈ 13.9 天，09-26 13:56 加上正好是 10-10 12:06，
//   就是那次检查的时刻。门槛逻辑没错，是喂给它的数字错了。
//
//   也解释了为什么是「偶尔」：环境块里有没有带日期的记忆片段、
//   位置在哪，每次都不一样。有时抠到 sent_at（对），有时抠到旧日期（错）。
//
// 改法：分两步。
//   1) 先认 <sent_at> 标签——那是 Aru 给的权威时间，不会被正文干扰。
//   2) 没标签的老消息（Kelivo 前缀格式），先剥掉环境块和跨对话片段再找。
//
// 只改 wake_up.js 一处。server.js 里的 parseTimestampLabel 有同类缺陷，
// 但那个只影响时间线排序，不影响门槛，这次不动。
//
// 原文对不上就整个不改，不猜。
// 退回：cp wake_up.js.bak-lastuser wake_up.js && pm2 restart wake-up

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
  console.error('\u2717 找不到 heartbeat 的 wake_up.js。试过：');
  CANDIDATES.forEach((d) => console.error(`    ${d}`));
  process.exit(1);
}

const WAKE_FILE = path.join(DIR, 'wake_up.js');

// 注意：这里的字符串要和文件里的字节一模一样。
// 上一版我在数组里写成 ([-\\/]) —— join 出来是 ([-\/])，
// 而原文是 ([-/])，没那个反斜杠，差一个字符就对不上了。
const OLD = `function parseTimelineTimestamp(value) {
  const text = String(value || "");
  const match = text.match(/（?\\s*(\\d{4})([-/])(\\d{1,2})\\2(\\d{1,2})(?:[ T]?)(\\d{1,2})[:：](\\d{2})/);
  if (!match) return null;
  const [, yyyy, , month, day, hour, minute] = match;
  return zonedWallTimeToDate({ year: yyyy, month, day, hour, minute }, TIME_ZONE);
}`;

const NEW = `// 批注 2026-10-10：原来这里用 match 取第一个命中，而 Aru 发来的消息
// <environment> 块在开头、<sent_at> 在末尾。环境块里塞着跨对话记忆片段，
// 那些片段带 ISO 日期（2026-09-30T04:03:44Z），正则里的 (?:[ T]?) 恰好认那个 T——
// 于是抠到的是记忆里的旧日期，不是她真正发消息的时间。
// 实测：last_user 被认成 09-26 13:56，diff 两万分钟，60 分钟门槛形同虚设。
// 现在分两步：先认 <sent_at>（Aru 给的权威时间），
// 没标签的老消息先剥掉环境块和跨对话片段再找。
const SENT_AT_TIME_RE = /<sent_at\\s+(\\d{4})[-/](\\d{1,2})[-/](\\d{1,2})[ T]?(\\d{1,2})[:：](\\d{2})/;
const WALL_TIME_RE = /（?\\s*(\\d{4})([-/])(\\d{1,2})\\2(\\d{1,2})(?:[ T]?)(\\d{1,2})[:：](\\d{2})/;

function parseTimelineTimestamp(value) {
  const text = String(value || "");

  // 有 <sent_at> 就用它，不管正文里还写了多少日期
  const tagged = text.match(SENT_AT_TIME_RE);
  if (tagged) {
    const [, year, month, day, hour, minute] = tagged;
    return zonedWallTimeToDate({ year, month, day, hour, minute }, TIME_ZONE);
  }

  // 没标签：环境块和跨对话片段里的日期不算她说话的时间，剥掉再找
  const cleaned = text
    .replace(/<environment>[\\s\\S]*?<\\/environment>/g, "")
    .replace(/\\[跨对话前文片段\\][\\s\\S]*$/g, "");

  const match = cleaned.match(WALL_TIME_RE);
  if (!match) return null;
  const [, yyyy, , month, day, hour, minute] = match;
  return zonedWallTimeToDate({ year: yyyy, month, day, hour, minute }, TIME_ZONE);
}`;

let src;
try {
  src = await readFile(WAKE_FILE, 'utf8');
} catch (err) {
  console.error(`\u2717 读不动 ${WAKE_FILE}：${err.message}`);
  process.exit(1);
}

console.log(`heartbeat: ${DIR}\n`);

if (src.includes('SENT_AT_TIME_RE')) {
  console.log('\u2713 已经打过了，文件没动。');
  process.exit(0);
}

const hits = src.split(OLD).length - 1;
if (hits === 0) {
  console.error('\u2717 parseTimelineTimestamp 对不上原文，整个文件没改。');
  console.error('  先看一眼现在长什么样：');
  console.error(`      grep -n "parseTimelineTimestamp" -A 8 ${WAKE_FILE}`);
  process.exit(2);
}
if (hits > 1) {
  console.error(`\u2717 原文出现 ${hits} 次，不敢猜。整个文件没改。`);
  process.exit(2);
}

if (process.argv.includes('--check')) {
  console.log('\u2713 能打上，文件没动：');
  console.log('  \u00b7 parseTimelineTimestamp 优先认 <sent_at>，回退时剥掉环境块');
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(WAKE_FILE, `${WAKE_FILE}.bak-lastuser`);
await writeFile(WAKE_FILE, src.replace(OLD, NEW), 'utf8');

console.log('\u2713 改完了，备份在 wake_up.js.bak-lastuser。');
console.log();
console.log('重启：pm2 restart wake-up');
console.log();
console.log('然后看下一次检查（最多等十分钟）：');
console.log('    pm2 logs wake-up --lines 0 --timestamp');
console.log();
console.log('last_user 应该就是你最后一次说话的时间，不再跳回半个月前；');
console.log('没满一小时时 will_wake:false，日志里出现「暂不需要唤醒」。');
console.log();
console.log('退回：cp wake_up.js.bak-lastuser wake_up.js && pm2 restart wake-up');
