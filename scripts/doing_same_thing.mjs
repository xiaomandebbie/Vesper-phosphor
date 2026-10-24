#!/usr/bin/env node
// 「复习啦」和「复习咯」是同一件事。
//
// 小满 2026-10-24：「而且我没说复习完成他就登记上了」
//
// 库里的证据：
//   39 | 复习咯 | done   | 0
//   38 | 复习啦 | active | 0
//
// startDoing（307 行）找「有没有同名的还在做」是按 what = ? 精确比的，
// 差一个语气词就当成两件事：她先说「复习啦」开了 38，后来说「复习咯」
// 又开了 39、然后立即判完工——而 38 就永远挂在 active 里，谁也销不掉。
//
// 挂着的后果：每次醒来都看见「她在做复习啦」，而那事还没到点，
// dueDoings() 不返回它、他拿不到 doing_id 也就问不了，
// 于是改用 self_wake 约个时间——所以 pending_wake 里出现两条一模一样的
// 「看看她『复习啦』怎么样了」（243、244）。asked_count 全程 0，
// 因为 markAsked 只在真走 doing_follow_up 那条路时才加。
//
// 所以根上就是这一条：比对时把句末的语气词和标点去掉。
// 这样她说「复习咯」时会认出 38，要么算同一件，要么被 detectDone 正常收工。
//
// 跑法：
//   node scripts/doing_same_thing.mjs
//   pm2 restart phosphor --update-env
//
// 跑完它还会把 startDoing 和 detectStart 的实际原文打出来——
// 「发了一张图片」被当成一件事（37 号）那件要按那段原文改。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'src/doing.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/doing.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-samething';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

if (before.includes('function normalizeWhat(')) {
  console.log('. 已经改过了，不用重启');
} else {
  let lines = before.split('\n');
  const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

  // 找 307 行那句精确比对
  const needle = "SELECT * FROM doing WHERE status = 'active' AND what = ?";
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i);
  });

  if (hits.length !== 1) {
    console.error(NO + '含「' + needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条。文件不改。');
    for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
    process.exit(1);
  }

  const i = hits[0];
  const ind = indentOf(lines[i]);
  // 原行形如：  const same = stmt("SELECT ...").get(name);
  // 变量名从原行里读，不猜
  const mSame = lines[i].match(/const\s+(\w+)\s*=/);
  const mArg = lines[i].match(/\.get\(([^)]*)\)/);
  if (!mSame || !mArg) {
    console.error(NO + '307 行形状和预期不一样，文件不改。实际是：');
    console.error('    ' + (i + 1) + ': ' + lines[i]);
    process.exit(1);
  }
  const sameVar = mSame[1];
  const argVar = mArg[1].trim();

  lines.splice(i, 1,
    ind + '// 比对时去掉句末语气词（2026-10-24）。原来按 what = ? 精确比，',
    ind + '// 「复习啦」和「复习咯」差一个字就当成两件事，前一件永远挂在 active 里。',
    ind + 'const ' + sameVar + ' = activeDoings().find(',
    ind + '  (r) => normalizeWhat(r.what) === normalizeWhat(' + argVar + ')',
    ind + ');'
  );

  // normalizeWhat 放在 activeDoings 后面（它在 272 行，这儿要用到）
  const anchor = lines.findIndex((l) => l.includes("SELECT * FROM doing WHERE status = 'active' ORDER BY started_at DESC\").all()"));
  const fnLines = [
    '',
    '// 两个名字是不是同一件事。句末的语气词和标点不算差异：',
    '// 「复习啦」「复习咯」「复习了」「复习」全是同一件。',
    'function normalizeWhat(s) {',
    '  return String(s ?? \'\')',
    '    .replace(/[\\s\u3002\uff0c\u3001\uff01\uff1f~\uff5e\u2026\u00b7.,!?]+/g, \'\')',
    '    .replace(/[\u5566\u54af\u4e86\u5462\u5427\u554a\u54e6\u5440\u561b\u54c8\u563f\u5457\u5662\u5594]+$/, \'\');',
    '}',
  ];
  if (anchor >= 0) {
    // 找到 activeDoings 那个函数的结尾（下一个 } 开头的行）
    let end = anchor;
    while (end < lines.length && lines[end].trim() !== '}') end += 1;
    lines.splice(end + 1, 0, ...fnLines);
  } else {
    // 找不到就放在文件头那批 import 后面
    let last = 0;
    lines.forEach((l, k) => {
      if (l.startsWith('import ')) last = k;
    });
    lines.splice(last + 1, 0, ...fnLines);
  }

  fs.writeFileSync(FILE, lines.join('\n'), 'utf8');
  try {
    execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
    console.log(OK + '比对时去掉语气词');
    console.log(OK + '语法通过');
  } catch (err) {
    console.error(NO + '语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-700));
    fs.writeFileSync(FILE, before, 'utf8');
    process.exit(1);
  }
}

// ── 把 38 号那条挂着的收掉 ──
// 代码修了，但库里已经挂着的那条还得手动销。打印命令，不自动执行。
console.log('');
console.log('── 库里 38 号「复习啦」还挂着，这条把它收掉 ──');
console.log(
  '  sqlite3 data/state.db "update doing set status=\'done\', closed_at=' +
    Date.now() +
    " where id=38 and status='active';\""
);
console.log('');

// ── 下一件要的原文 ──
console.log('── startDoing 实际原文（「发了一张图片」那件要按这段改）──');
const cur = fs.readFileSync(FILE, 'utf8').split('\n');
const si = cur.findIndex((l) => l.includes('function startDoing') || l.includes('export function startDoing'));
if (si >= 0) {
  for (let k = si; k < Math.min(cur.length, si + 26); k++) console.log(k + 1 + ': ' + cur[k]);
} else {
  console.log('（找不到 startDoing）');
}

console.log('');
console.log('── detectStart 实际原文 ──');
const DET = path.join(ROOT, 'src/doing-detect.js');
if (fs.existsSync(DET)) {
  const d = fs.readFileSync(DET, 'utf8').split('\n');
  const di = d.findIndex((l) => l.includes('export function detectStart'));
  if (di >= 0) {
    for (let k = di; k < Math.min(d.length, di + 30); k++) console.log(k + 1 + ': ' + d[k]);
  } else {
    console.log('（找不到 detectStart）');
  }
} else {
  console.log('（没有 src/doing-detect.js）');
}

console.log('');
console.log('pm2 restart phosphor --update-env');
