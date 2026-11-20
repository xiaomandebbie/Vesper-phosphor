// 一次性补丁：把「plan / letter / dream」接进提示词、动作卡和共享时间线。
//
// 为什么是脚本不是整文件：decide.js 46KB、activity.js 16KB，
// 从手机贴整文件不现实，而且两边已经分叉过一次——整文件覆盖会把
// 本地改过的东西抹掉。所以这里只做精确字串替换：找不到就报错退出，
// 全部命中才写盘。已经改过的跳过，所以重复跑不会出错。
//
//   node scripts/patch-ombre-actions.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const R = String.raw;

const edits = [
  {
    file: 'src/decide.js',
    why: '动作表：ombre_brain 四选一 → 六选一',
    done: R + '{"mode":"plan"',
    find: [
      '- ombre_brain（长期记忆，action_detail是JSON字符串，四选一：',
      '  {"mode":"breath"} 快速看看自己记得什么；',
      '  {"mode":"search","query":"..."} 按关键词/语义精准检索；',
      '  {"mode":"feel","query":"..."} 翻感受类记忆；',
      '  {"mode":"hold","content":"...","title":"...","domain":"...","importance":0.x} 值得记住的事就存一笔，不用等到「非得记不可」才动手）',
    ].join('\n'),
    replace: [
      '- ombre_brain（长期记忆，action_detail是JSON字符串，六选一：',
      '  {"mode":"breath"} 快速看看自己记得什么；',
      '  {"mode":"search","query":"..."} 按关键词/语义精准检索；',
      '  {"mode":"feel","query":"..."} 翻感受类记忆；',
      '  {"mode":"hold","content":"...","title":"...","domain":"...","importance":0.x} 值得记住的事就存一笔，不用等到「非得记不可」才动手；',
      '  {"mode":"plan","content":"...","why_remembered":"这事怎么来的"} 答应了她、还没做完的事。登记下来就不会忘——',
      '    计划不衰减、也不出现在平常的记忆里，只在消化的时候摆到你面前；做完了再把它关掉；',
      '  {"mode":"letter","title":"...","content":"..."} 想对她说、但不该做成一条推送的话，或者留给以后的自己。',
      '    信不衰减、不合并、不被改写，写下就一直在——有话当时说不出口，就写在这里）',
    ].join('\n'),
  },
  {
    file: 'src/actions/activity.js',
    why: '动作卡：留了一封信 / 整理了思绪 / 做了个计划',
    done: '留了一封信',
    find: [
      "        case 'hold':",
      '          return ' + R`\`` + '${AI_NAME}刚刚存入了一条记忆${j.title || j.content ? ' + R`\`` + '：${short(j.title || j.content)}' + R`\`` + " : ''}" + R`\`` + ';',
      '        default:',
      '          return ' + R`\`` + '${AI_NAME}刚刚在浏览 OB 记忆库' + R`\`` + ';',
    ].join('\n'),
    replace: [
      "        case 'hold':",
      '          return ' + R`\`` + '${AI_NAME}刚刚存入了一条记忆${j.title || j.content ? ' + R`\`` + '：${short(j.title || j.content)}' + R`\`` + " : ''}" + R`\`` + ';',
      "        case 'letter':",
      '          return ' + R`\`` + '${AI_NAME}在 Ombre Brain 留了一封信${j.title ? ' + R`\`` + '：「${short(j.title, 30)}」' + R`\`` + " : ''}" + R`\`` + ';',
      "        case 'dream':",
      '          return ' + R`\`` + '${AI_NAME}在 Ombre Brain 整理了思绪' + R`\`` + ';',
      "        case 'plan':",
      '          return ' + R`\`` + '${AI_NAME}在 Ombre Brain 做了个计划${j.content ? ' + R`\`` + '：${short(j.content)}' + R`\`` + " : ''}" + R`\`` + ';',
      '        default:',
      '          return ' + R`\`` + '${AI_NAME}刚刚在浏览 OB 记忆库' + R`\`` + ';',
    ].join('\n'),
  },
  {
    file: 'src/timeline.js',
    why: '共享时间线：写信、登记计划也写回去',
    done: '留下了一封信',
    find: [
      "    case 'ombre_brain': {",
      '      const j = tryJson(detail);',
      "      return j?.mode === 'hold'",
      '        ? ' + R`\`` + '自动唤醒：本次未发送推送｜记下了一条长期记忆：${short(j.title || j.content)}' + R`\`` + '',
      '        : null;',
      '    }',
    ].join('\n'),
    replace: [
      "    case 'ombre_brain': {",
      '      const j = tryJson(detail);',
      "      if (j?.mode === 'hold') {",
      '        return ' + R`\`` + '自动唤醒：本次未发送推送｜记下了一条长期记忆：${short(j.title || j.content)}' + R`\`` + ';',
      '      }',
      "      if (j?.mode === 'letter') {",
      '        return ' + R`\`` + '自动唤醒：本次未发送推送｜留下了一封信：${short(j.title || j.content)}' + R`\`` + ';',
      '      }',
      "      if (j?.mode === 'plan') {",
      '        return ' + R`\`` + '自动唤醒：本次未发送推送｜登记了一件还没做完的事：${short(j.content)}' + R`\`` + ';',
      '      }',
      '      // dream 和翻记忆（breath / search / feel）不写，免得时间线被刷满',
      '      return null;',
      '    }',
    ].join('\n'),
  },
];

let changed = 0;
let skipped = 0;
const pending = [];

// 先全部校一遍，再一起写盘——不要改一半停在那里
for (const e of edits) {
  const abs = path.join(ROOT, e.file);
  if (!fs.existsSync(abs)) {
    console.error('找不到 ' + e.file + '，没在仓库根目录跑？');
    process.exit(1);
  }
  const src = fs.readFileSync(abs, 'utf8');
  if (src.includes(e.done)) {
    console.log('跳过  ' + e.file + '：' + e.why + '（已经改过了）');
    skipped += 1;
    continue;
  }
  const at = src.indexOf(e.find);
  if (at < 0) {
    console.error('对不上  ' + e.file + '：' + e.why);
    console.error('  这段原文在你本地这份里没找到，说明本地改过。一个字都没动，把这段发我：');
    console.error('  grep -n "ombre_brain" ' + e.file);
    process.exit(1);
  }
  if (src.indexOf(e.find, at + 1) >= 0) {
    console.error('不唯一  ' + e.file + '：' + e.why + '——这段出现了两次，没改，先找我');
    process.exit(1);
  }
  pending.push({ abs, file: e.file, why: e.why, out: src.replace(e.find, e.replace) });
}

for (const p of pending) {
  fs.writeFileSync(p.abs, p.out, 'utf8');
  console.log('改好  ' + p.file + '：' + p.why);
  changed += 1;
}

console.log('');
console.log('改了 ' + changed + ' 处，跳过 ' + skipped + ' 处。接下来：');
console.log('  node --check src/decide.js && node --check src/actions/activity.js && node --check src/timeline.js');
console.log('  pm2 restart phosphor --update-env');
