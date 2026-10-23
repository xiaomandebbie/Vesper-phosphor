#!/usr/bin/env node
// 日志页的时间多了整整八小时。
//
// 小满 2026-10-23：「这个日志时间正常吗，不应该是18:19那次动作吗」
// 现在 18:24，页面上写 10-24 02:19:39。
//
// 是我判断错了。写 logs-page.js 时我把这台服务器当成了 UTC（因为 decide.js
// 里有一段注释说服务器是 UTC、自己算会差八小时），于是把日志里的时间戳
// 按 UTC 解析、再转成东八区显示——加了八小时。
//
// 实际上：date 输出 Fri Oct 23 06:26:45 PM **CST** 2026，服务器就是东八区。
// pm2 写日志用的是本地时间，所以日志里的 18:19 本来就是墙上时间，不需要转。
//
// 那段注释其实没说错，wall-time.js 那套是为了不依赖系统时区——哪天换机器也不用改。
// 是我把「代码不依赖本地时区」读成了「本地时区就是 UTC」。
//
// 改法：默认改成「日志里的时间戳就是本地时间，原样显示」，不用在 .env 里加开关。
// 哪天真换到 UTC 的机器上，写 PM2_LOG_TIME=utc 把转换打开。
//
// 跑法：
//   node scripts/fix_logs_timezone.mjs
//   pm2 restart vesper --update-env
// 然后强刷 /logs。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/logs-page.js');

if (!fs.existsSync(FILE)) {
  console.error('\u2717 src/logs-page.js \u627e\u4e0d\u5230\uff08\u5148 git pull\uff09');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-logstz';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const DONE = 'TIME_IS_UTC';
if (before.includes(DONE)) {
  console.log('. \u5df2\u7ecf\u6539\u8fc7\u4e86\uff0c\u4e0d\u7528\u91cd\u542f');
  process.exit(0);
}

const FIND = "const TIME_IS_LOCAL = /^local$/i.test(String(process.env.PM2_LOG_TIME ?? '').trim());";

const REPLACE = [
  '// 日志里的时间戳是哪个时区的。',
  '// 默认当本地时间：pm2 写日志用的就是服务器本地时间，而这台是 CST（date 输出带 CST）。',
  '// 第一版我当成 UTC 又转了一次，结果 18:19 显示成次日 02:19。',
  '// 真换到 UTC 的机器上时，在 .env 里写 PM2_LOG_TIME=utc。',
  "const TIME_IS_UTC = /^utc$/i.test(String(process.env.PM2_LOG_TIME ?? '').trim());",
].join('\n');

const n = before.split(FIND).length - 1;
if (n !== 1) {
  console.error('\u2717 \u90a3\u4e00\u884c\u547d\u4e2d ' + n + ' \u5904\uff0c\u5e94\u8be5\u53ea\u6709 1 \u5904\u3002\u6587\u4ef6\u4e0d\u6539\u3002');
  console.error('  \u6211\u627e\u7684\u662f\uff1a' + FIND);
  const lines = before.split('\n');
  const i = lines.findIndex((l) => l.includes('PM2_LOG_TIME'));
  if (i >= 0) {
    console.error('');
    console.error('  \u7b2c ' + (i + 1) + ' \u884c\u9644\u8fd1\u5b9e\u9645\u662f\uff1a');
    for (let k = Math.max(0, i - 3); k < Math.min(lines.length, i + 5); k++) {
      console.error('    ' + (k + 1) + ': ' + lines[k]);
    }
  }
  process.exit(1);
}

// 两处用到它：displayTime 和 parseEntries。逻辑正好反过来：
// 原来是「不是 local 就补 Z」，现在是「是 utc 才补 Z」
let src = before
  .replace(FIND, REPLACE)
  .split('${TIME_IS_LOCAL ? \'\' : \'Z\'}')
  .join('${TIME_IS_UTC ? \'Z\' : \'\'}');

if (src.includes('TIME_IS_LOCAL')) {
  console.error('\u2717 \u8fd8\u6709\u6ca1\u6362\u5230\u7684 TIME_IS_LOCAL\uff0c\u6587\u4ef6\u4e0d\u6539\u3002');
  const lines = src.split('\n');
  lines.forEach((l, i) => {
    if (l.includes('TIME_IS_LOCAL')) console.error('    ' + (i + 1) + ': ' + l);
  });
  process.exit(1);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('\u2713 \u65e5\u5fd7\u65f6\u95f4\u4e0d\u518d\u591a\u52a0\u516b\u5c0f\u65f6');
  console.log('\u2713 \u8bed\u6cd5\u901a\u8fc7');
} catch (err) {
  console.error('\u2717 \u8bed\u6cd5\u4e0d\u8fc7\uff0c\u5df2\u8fd8\u539f\uff1a');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart vesper --update-env');
console.log('\u7136\u540e\u5f3a\u5237 /logs\uff0c\u65f6\u95f4\u5e94\u8be5\u548c pm2 logs \u91cc\u770b\u5230\u7684\u4e00\u6837\u3002');
