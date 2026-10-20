#!/usr/bin/env node
// 记忆库还是不怎么用。
//
// 小满 2026-10-20：「他咋还是不怎么用 OB 记忆库」
//
// 又是同一个坑：**代码改了，提示词没改**。
//
// free_memory_tier.mjs 那次把 ombre_brain 从 3 级降到 0 级、放进 ONCE，
// 但 budgetSection() 里那张分级表没动，他读到的仍然是：
//   - **3 级，会惊动她**：推送、发动态、长期记忆（存或翻）
// 所以在他眼里，存一条记忆和「发条动态她会回我」还是并列的、一次只能挑一件。
// 他每次选动态，这是理性的。
//
// 动作列表那边还有两句也在劝退：
//   hold：「只有明确认为值得长期记住时才用」  → 立了一个很高的门槛
//   breath：「token 开销最低」                  → 暗示别的模式贵，要省着用
//
// 三处一起改。注意新加的说明里不能出现「2 级」字样——decide.js 的 stripPlay
// 会把含「2 级」的行从第一阶段滤掉（那是为了藏起游戏和共读），
// 写进去的话第一阶段就看不见了。
//
// 跑法：
//   node scripts/fix_memory_wording.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';
const DOT = '. ';

// 记忆库和共读各自单算一本账的说明。故意不写「级」字，也不写「2 级」。
const OWN_LEDGER = [
  '- **记忆库和共读书架各自单算一本账**：不占上面任何一级的名额，一次醒来各最多一件。',
  '  存一条记忆一声不响，谁也不惊动，所以它不在上面那一排里——想存就存，',
  '  不用拿它跟「发条动态她会回我」比。翻记忆（breath / search / feel）同理。',
].join('\n');

const EDITS = [
  {
    file: 'src/budget.js',
    what: '分级表：把长期记忆从「会惊动她」那一排拿出来',
    done: '各自单算一本账',
    // 不知道服务器上那行的确切写法，所以按「含长期记忆的那一行」整行换
    regex: /^.*\*\*3 \u7ea7[^\n]*\u957f\u671f\u8bb0\u5fc6[^\n]*$/m,
    replacement: () =>
      '- **3 \u7ea7\uff0c\u4f1a\u60ca\u52a8\u5979**\uff1a\u63a8\u9001\u3001\u53d1\u52a8\u6001\u3002\u90fd\u53ef\u4ee5\u9009\u62e9\u4e0d\u505a\u3002\n' +
      OWN_LEDGER,
  },
  {
    file: 'src/decide.js',
    what: 'hold 的说明：去掉「只有…才用」这个门槛',
    done: '\u503c\u5f97\u8bb0\u4f4f\u7684\u4e8b\u5c31\u5b58\u4e00\u7b14',
    find: '\u53ea\u6709\u660e\u786e\u8ba4\u4e3a\u503c\u5f97\u957f\u671f\u8bb0\u4f4f\u65f6\u624d\u7528',
    replacement:
      '\u503c\u5f97\u8bb0\u4f4f\u7684\u4e8b\u5c31\u5b58\u4e00\u7b14\uff0c\u4e0d\u7528\u7b49\u5230\u300c\u975e\u5f97\u8bb0\u4e0d\u53ef\u300d\u624d\u52a8\u624b',
  },
  {
    file: 'src/decide.js',
    what: 'breath 的说明：去掉「token 开销最低」',
    done: '\u5feb\u901f\u770b\u770b\u81ea\u5df1\u8bb0\u5f97\u4ec0\u4e48\uff1b',
    find: '\u5feb\u901f\u770b\u770b\u81ea\u5df1\u8bb0\u5f97\u4ec0\u4e48\uff0ctoken\u5f00\u9500\u6700\u4f4e\uff1b',
    replacement: '\u5feb\u901f\u770b\u770b\u81ea\u5df1\u8bb0\u5f97\u4ec0\u4e48\uff1b',
  },
];

const byFile = {};
for (const e of EDITS) {
  byFile[e.file] = byFile[e.file] || [];
  byFile[e.file].push(e);
}

let allOk = true;

for (const rel of Object.keys(byFile)) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' not found');
    allOk = false;
    continue;
  }
  const bak = file + '.bak-memwording';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  let changed = 0;
  let failed = false;

  for (const e of byFile[rel]) {
    if (src.includes(e.done)) {
      console.log(DOT + 'already done: ' + e.what);
      continue;
    }

    if (e.regex) {
      const m = src.match(e.regex);
      if (!m) {
        console.error(NO + e.what + ': regex found nothing. file untouched');
        console.error('  looking for a line with: **3 \u7ea7 ... \u957f\u671f\u8bb0\u5fc6');
        failed = true;
        break;
      }
      const all = src.match(new RegExp(e.regex.source, 'gm')) || [];
      if (all.length !== 1) {
        console.error(NO + e.what + ': matched ' + all.length + ' lines, expected 1. file untouched');
        for (const line of all) console.error('    ' + line);
        failed = true;
        break;
      }
      console.error('  原文：' + m[0]);
      src = src.replace(e.regex, e.replacement());
      console.log(OK + e.what);
      changed += 1;
      continue;
    }

    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(NO + e.what + ': found ' + n + ' times, expected 1. file untouched');
      console.error('  looking for: ' + e.find);
      failed = true;
      break;
    }
    src = src.replace(e.find, e.replacement);
    console.log(OK + e.what);
    changed += 1;
  }

  if (failed) {
    fs.writeFileSync(file, before, 'utf8');
    allOk = false;
    continue;
  }
  if (!changed) continue;

  fs.writeFileSync(file, src, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(OK + 'syntax ok: ' + rel);
  } catch (err) {
    console.error(NO + rel + ' syntax error, reverted:');
    console.error(String(err.stderr || err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    allOk = false;
  }
}

// 把改完的分级说明打出来核对
const bj = path.join(ROOT, 'src/budget.js');
if (fs.existsSync(bj)) {
  const lines = fs.readFileSync(bj, 'utf8').split('\n');
  const i = lines.findIndex((l) => l.includes('function budgetSection'));
  if (i >= 0) {
    console.log('');
    console.log('── budgetSection 现在的样子 ──');
    for (let k = i; k < Math.min(lines.length, i + 22); k++) console.log(k + 1 + ': ' + lines[k]);
  }
}

console.log('');
if (allOk) {
  console.log('pm2 restart phosphor --update-env');
  console.log('');
  console.log('等他醒几次，然后查一下有没有 memory 记录：');
  console.log('  sqlite3 data/state.db "select kind, count(*) n from tier1_log group by kind;"');
} else {
  console.log('有没成的，那个文件已经原样还原（上面打了找到的实际原文）。');
  process.exitCode = 1;
}
