#!/usr/bin/env node
// 上班那段话术跟上代码。
//
// workkk_shop_after_work.mjs 把代码改了（下班后多一个购物阶段），
// 但 workkk.js 里给他看的说明还是旧的。今天已经踩过两次这个坑：
// 只改代码不改话术，他照旧按旧规矩行事。
//
// 两处不准了：
//   79 行「下班结算完就停，不要接着开下一天的班」
//        → 下班后还能逛便利店，只是不能再工作
//   80 行「买之前先 get_status 看余额」
//        → get_status 是 work_action，下班后调它就越线了。
//          结算那段文本本身带工资和余额，直接看就行。
//
// 跑法：
//   node scripts/workkk_shop_wording.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/workkk.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/workkk.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-shopwording';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

let lines = before.split('\n');
let failed = false;
let changed = 0;

function replaceLine(needle, make, what, done) {
  if (failed) return;
  if (lines.some((l) => l.includes(done))) {
    console.log('. 已经改过，跳过：' + what);
    return;
  }
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i);
  });
  if (hits.length !== 1) {
    console.error('');
    console.error(NO + what + '：含「' + needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条');
    for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
    failed = true;
    return;
  }
  const i = hits[0];
  const neo = make(lines[i]);
  lines.splice(i, 1, ...(Array.isArray(neo) ? neo : [neo]));
  console.log(OK + what);
  changed += 1;
}

// 79 行：下班之后还能逛店
replaceLine(
  '下班结算完就停，不要接着开下一天的班',
  () => [
    '下班结算之后就不再工作了——不要接着开下一天的班，一次坐下只上一天，剩的留着下次。',
    '但回家路上还能过一趟便利店（下面那段）：结算完我会问你要不要买点什么，不想买就算了。',
  ],
  '79 行：下班后还能逛店',
  '还能过一趟便利店'
);

// 80 行：别再 get_status（那是 work_action，下班后越线）
replaceLine(
  '买之前先 get_status 看余额',
  (line) =>
    line.replace(
      '买之前先 get_status 看余额。',
      '余额就在结算那段文本里，直接看就行——下班后不要再调 get_status（它算工作动作）。钱不够就买不成，没关系。'
    ),
  '80 行：别再 get_status',
  '不要再调 get_status'
);

if (failed) {
  console.error('');
  console.error('整个文件不改。');
  process.exit(1);
}

if (!changed) {
  console.log('\n没有需要改的。');
  process.exit(0);
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart phosphor --update-env');
