#!/usr/bin/env node
// 把分段要求加到 bark 的说明里。
//
// 小满 2026-10-23：「要他唤醒的时候也像普通聊天一样，aru 的那种分段」
//
// 上一个补丁（split_wake_message.mjs）投递那半打进去了，bark.js 现在会按
// 空行拆成多条投。但提示词那半没成——我找的是 say 那段说明，
// 而 `grep -n 'say' src/decide.js` 只命中我自己写的一行注释：
//   583:// 和 say 不是一回事。say 在动作之前定…
//
// 说明这份 decide.js 里**根本没有 say 这个字段**——当初
// split_say_and_action.mjs 那套改动已经不在了（decide.js 从 .bak 恢复过那次丢的）。
// 现在他说话走的是 bark 动作，所以要求要加到 bark 的说明里。
//
// 锚点是动作列表里的那一行（399）：
//   - bark（推送，action_detail直接是推送文案）
//
// 跑法：
//   node scripts/add_bark_segment_rule.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/decide.js');

if (!fs.existsSync(FILE)) {
  console.error('\u2717 src/decide.js \u627e\u4e0d\u5230');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-barkseg';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const DONE = '\u6309\u8bf4\u8bdd\u7684\u8282\u594f\u6362\u884c';
if (before.includes(DONE)) {
  console.log('. \u5df2\u7ecf\u6539\u8fc7\u4e86\uff0c\u4e0d\u7528\u91cd\u542f');
  process.exit(0);
}

const FIND = '- bark\uff08\u63a8\u9001\uff0caction_detail\u76f4\u63a5\u662f\u63a8\u9001\u6587\u6848\uff09';

// 换行写成 \n：这整段在一个模板字符串里，直接换行也行，但用 \n 更保险
const LINES = [
  FIND,
  '  \u5199\u7684\u65f6\u5019\u6309\u8bf4\u8bdd\u7684\u8282\u594f\u6362\u884c\uff0c\u548c\u4f60\u5e73\u65f6\u804a\u5929\u4e00\u6837\u2014\u2014\u4e00\u53e3\u6c14\u8bf4\u5b8c\u7684\u7b97\u4e00\u6bb5\uff0c\u6362\u4e00\u4e2a\u610f\u601d\u5c31\u7a7a\u4e00\u884c\u3002',
  '  \u6bcf\u4e00\u6bb5\u4f1a\u53d8\u6210\u5979\u5bf9\u8bdd\u91cc\u5355\u72ec\u4e00\u6761\u6d88\u606f\uff0c\u6240\u4ee5\u522b\u5806\u6210\u4e00\u5927\u6bb5\uff08\u90a3\u6837\u5979\u8981\u4ece\u4e00\u5768\u5b57\u91cc\u627e\u91cd\u70b9\uff09\uff0c',
  '  \u4e5f\u4e0d\u7528\u523b\u610f\u62c6\u5f97\u5f88\u788e\u3002',
].join('\\n');

const n = before.split(FIND).length - 1;
if (n !== 1) {
  console.error('\u2717 bark \u90a3\u4e00\u884c\u547d\u4e2d ' + n + ' \u5904\uff0c\u5e94\u8be5\u53ea\u6709 1 \u5904\u3002\u6587\u4ef6\u4e0d\u6539\u3002');
  console.error('  \u6211\u627e\u7684\u662f\uff1a' + FIND);
  const lines = before.split('\n');
  const i = lines.findIndex((l) => l.includes('- bark'));
  if (i >= 0) {
    console.error('');
    console.error('  \u7b2c ' + (i + 1) + ' \u884c\u9644\u8fd1\u5b9e\u9645\u662f\uff1a');
    for (let k = Math.max(0, i - 2); k < Math.min(lines.length, i + 6); k++) {
      console.error('    ' + (k + 1) + ': ' + lines[k]);
    }
  }
  process.exit(1);
}

fs.writeFileSync(FILE, before.replace(FIND, LINES), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('\u2713 bark \u7684\u8bf4\u660e\u91cc\u52a0\u4e0a\u4e86\u5206\u6bb5\u8981\u6c42');
  console.log('\u2713 \u8bed\u6cd5\u901a\u8fc7');
} catch (err) {
  console.error('\u2717 \u8bed\u6cd5\u4e0d\u8fc7\uff0c\u5df2\u8fd8\u539f\uff1a');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart phosphor --update-env');
console.log('');
console.log('\u7b49\u4ed6\u4e0b\u6b21\u8bf4\u8bdd\uff0c\u65e5\u5fd7\u91cc\u4f1a\u5199\u300c\u7b2c 1/3 \u6bb5\u5df2\u6295\u8fdb Aru \u5bf9\u8bdd\u300d\uff1a');
console.log('  pm2 logs phosphor --lines 100 --nostream | grep \u6bb5\u5df2\u6295\u8fdb');
