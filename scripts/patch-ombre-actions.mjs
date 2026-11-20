// 一次性补丁：把「letter / dream / plan」接进动作卡和共享时间线。
//
// decide.js 的动作表已经改过了（上一版跑成了），这里只剩两处显示层。
//
// 为什么是插入而不是替换：本地 activity.js 和 timeline.js 都改过，
// 整段匹配对不上。所以只认两个唯一的锞点，在它旁边插行，
// 旁边原来写了什么一律不碰：
//   activity.js 的  case 'hold':          → 在它**前面**插三个 case
//   timeline.js 的  case 'ombre_brain': { → 在它**后面**插两行提前返回
//
// 插入的代码用字符串拼接写，不用模板字符串——省了一层转义，也不会被
// 本地的引号风格影响。缩进跟随锞点那一行，所以本地缩几格都行。
//
// 已经改过的跳过，可重复跑。按文件各自独立，一处对不上不连坐另一处。
//
//   node scripts/patch-ombre-actions.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');

// 每项：找到 anchor 那一行（正则，必须唯一），在它前/后插 lines。
// lines 里的缩进用 pad 补，pad 是锞点行的行首空白。
const edits = [
  {
    file: 'src/actions/activity.js',
    why: '动作卡：留了一封信 / 整理了思绪 / 做了个计划',
    done: '留了一封信',
    grep: "case '",
    anchor: /^([ \t]*)case 'hold':[ \t]*$/m,
    where: 'before',
    lines: [
      "case 'letter':",
      "  return AI_NAME + '在 Ombre Brain 留了一封信' + (j.title ? '：「' + short(j.title, 30) + '」' : '');",
      "case 'dream':",
      "  return AI_NAME + '在 Ombre Brain 整理了思绪';",
      "case 'plan':",
      "  return AI_NAME + '在 Ombre Brain 做了个计划' + (j.content ? '：' + short(j.content) : '');",
    ],
  },
  {
    file: 'src/timeline.js',
    why: '共享时间线：写信、登记计划也写回去',
    done: '留下了一封信',
    grep: 'ombre_brain',
    anchor: /^([ \t]*)case 'ombre_brain': \{[ \t]*$/m,
    where: 'after',
    lines: [
      '  // 写信、登记计划也写回共享时间线；dream 和翻记忆不写，免得刷满。',
      '  const jx = tryJson(detail);',
      "  if (jx?.mode === 'letter') return '自动唤醒：本次未发送推送｜留下了一封信：' + short(jx.title || jx.content);",
      "  if (jx?.mode === 'plan') return '自动唤醒：本次未发送推送｜登记了一件还没做完的事：' + short(jx.content);",
    ],
  },
];

let changed = 0;
let skipped = 0;
const failed = [];

for (const e of edits) {
  const abs = path.join(ROOT, e.file);
  if (!fs.existsSync(abs)) {
    failed.push({ ...e, reason: '文件不在' });
    continue;
  }
  const src = fs.readFileSync(abs, 'utf8');
  if (src.includes(e.done)) {
    console.log('跳过  ' + e.file + '：' + e.why + '（已经改过了）');
    skipped += 1;
    continue;
  }

  // 锞点必须唯一：多一处就不敢改
  const all = [...src.matchAll(new RegExp(e.anchor.source, 'gm'))];
  if (!all.length) {
    failed.push({ ...e, reason: '找不到锞点那一行' });
    continue;
  }
  if (all.length > 1) {
    failed.push({ ...e, reason: '锞点出现了 ' + all.length + ' 次，不敢改' });
    continue;
  }

  const m = all[0];
  const pad = m[1] ?? '';
  const block = e.lines.map((l) => (l ? pad + l : '')).join('\n');
  const anchorLine = m[0];
  const out =
    e.where === 'before'
      ? src.replace(anchorLine, block + '\n' + anchorLine)
      : src.replace(anchorLine, anchorLine + '\n' + block);

  fs.writeFileSync(abs, out, 'utf8');
  console.log('改好  ' + e.file + '：' + e.why);
  changed += 1;
}

console.log('');
console.log('改了 ' + changed + ' 处，跳过 ' + skipped + ' 处，对不上 ' + failed.length + ' 处。');

if (failed.length) {
  console.log('');
  console.log('这几处没改（一个字都没动），把对应的 grep 结果发我：');
  for (const f of failed) {
    console.log('  ✗ ' + f.file + '：' + f.why + ' —— ' + f.reason);
    console.log('    grep -n "' + f.grep + '" ' + f.file);
  }
}

if (changed) {
  console.log('');
  console.log('接下来：');
  console.log('  node --check src/actions/activity.js && node --check src/timeline.js && echo ok');
  console.log('  pm2 restart phosphor --update-env');
}
