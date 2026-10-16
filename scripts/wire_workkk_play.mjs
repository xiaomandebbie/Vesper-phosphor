#!/usr/bin/env node
// 把「醒来去上班」接进 phosphor 和 decide。八处。
//
// 小满 2026-10-16：「允朔醒来可以玩游戏吗，一次规定就玩一天吧」
//
// 主体在 src/workkk.js（一天一次的账）和 src/workkk-steps.js（连着走到下班），
// 这个脚本只负责把它们接到现有的唤醒流程上。
//
//   phosphor.js
//     1. import 两行
//     2. workkkToday 这个标记（作用域要在 if (decision) 外面，续步那段用得到）
//     3. 一天一次的门禁：摆在 executeAction 之前
//     4. 连着走到下班，走完记这一场的账
//     5. 启动日志带上上班配置
//   decide.js
//     6. import 一行
//     7. 用户消息里「今天还能不能去」
//     8. 系统提示里「## 上班」那一段
//
// ── 门禁为什么在 executeAction 之前 ──
//
// startToday() 既是「查」也是「占」（一个事务，见 workkk.js）。占得住就是
// 这一场的开头，占不住就是今天已经去过了——那就把这次的动作改成 noop。
// 如果摆在后面，第一步已经打到游戏里了，再发现「今天去过了」就晚了。
//
// ── 两阶段：先全查，再全写 ──
//
// 任何一处锚点对不上就一处都不改。半成品比不改更麻烦：
// 少了一行 import，phosphor 启动就 ReferenceError；改了 decide 而 phosphor 没改，
// 他会看到一个谁都不执行的工具。
//
// 每处幂等：正文里已经有那个 marker 就算改过，跳过。可以反复跑。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_workkk_play.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const log = (s = '') => console.log(s);

const changes = [
  // ── 一、phosphor.js ─────────────────────────────────
  {
    file: 'phosphor.js',
    name: 'import 上班那几个函数',
    marker: "from './workkk.js'",
    anchor: "import { describeActivity, describeActivityDetail } from './actions/activity.js';",
    replacement: [
      "import { describeActivity, describeActivityDetail } from './actions/activity.js';",
      "import { isWorkkkCall, startToday, finishToday, workkkConfigSummary } from './workkk.js';",
      "import { continueWorkkk } from './workkk-steps.js';",
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: 'workkkToday 标记',
    marker: 'let workkkToday',
    anchor: '  let repliedCount = 0;',
    replacement: [
      '  let repliedCount = 0;',
      '  // 上班一天一次（见 workkk.js）。这一场是不是你开的——续步那段要看它，',
      '  // 所以声明得在 if (decision) 外面',
      '  let workkkToday = false;',
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '一天一次的门禁',
    marker: 'isWorkkkCall(decision)',
    anchor: '      result = await executeAction(decision);',
    replacement: [
      '    // 上班一天只去一次。startToday() 既是查也是占（一个事务）：',
      '    // 占得住就是这一场的开头，占不住就是今天已经去过了。',
      '    // 摆在执行之前：别让第一步先打到游戏里，再发现今天不该去。',
      '    if (isWorkkkCall(decision)) {',
      '      workkkToday = startToday();',
      '      if (!workkkToday) {',
      "        console.log(`[${kind}] \u4eca天已经\u4e0a\u8fc7\u73ed\u4e86\uff0c\u8fd9\u6b21\u4e0d\u518d\u53bb\uff08\u4e00\u5929\u4e00\u6b21\uff09`);",
      "        decision.action = 'noop';",
      "        decision.action_detail = '';",
      '      }',
      '    }',
      '      result = await executeAction(decision);',
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '连着走到下班',
    marker: 'continueWorkkk(',
    anchor: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueMusic(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueMusic failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
    replacement: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueMusic(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueMusic failed:`, err);',
      '    }',
      '  }',
      '',
      '  // 上班：开了就把那天的班上完（见 workkk-steps.js）。',
      '  // 做到一半停下这天不结算工资，所以这一支走到「今日进度」满为止。',
      '  // 只有这一场是你开的才走（workkkToday）；出什么错都不影响剩下的收尾。',
      '  if (workkkToday && decision && !errorMessage) {',
      '    try {',
      '      finishToday(await continueWorkkk(decision, result, messages));',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueWorkkk failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '启动日志带上上班',
    marker: 'workkkConfigSummary()',
    anchor: '；星星罐：一天一颗',
    replacement: '；${workkkConfigSummary()}；星星罐：一天一颗',
  },

  // ── 二、decide.js ──────────────────────────────────
  {
    file: 'decide.js',
    name: 'import 上班的那两段话',
    marker: "from './workkk.js'",
    anchor: "import { doingSection, doingStatusLine } from './doing.js';",
    replacement: [
      "import { doingSection, doingStatusLine } from './doing.js';",
      "import { workkkSection, workkkStatusLine } from './workkk.js';",
    ].join('\n'),
  },
  {
    file: 'decide.js',
    name: '今天还能不能去上班',
    marker: 'workkkStatusLine()',
    anchor: '    forumNotesBlock(context.forumNotes),',
    replacement: [
      '    forumNotesBlock(context.forumNotes),',
      '    workkkStatusLine(),',
    ].join('\n'),
  },
  {
    file: 'decide.js',
    name: '系统提示里的「## 上班」',
    marker: 'workkkSection()',
    anchor: '## 星星罐',
    replacement: '${workkkSection()}\n\n## 星星罐',
  },
];

// ── 第一阶段：全部检查 ─────────────────────────────

// 两个新文件得先在，不然接上了也找不到模块
for (const f of ['workkk.js', 'workkk-steps.js']) {
  if (!fs.existsSync(path.join(SRC, f))) {
    console.error(`少了 src/${f}。先 git pull 把它拉下来，再跑这个脚本。`);
    console.error('什么都没改。');
    process.exit(1);
  }
}

const texts = new Map();
const problems = [];

for (const c of changes) {
  const full = path.join(SRC, c.file);
  if (!texts.has(c.file)) {
    if (!fs.existsSync(full)) {
      problems.push(`找不到 src/${c.file}`);
      c.state = 'missing';
      continue;
    }
    texts.set(c.file, fs.readFileSync(full, 'utf8'));
  }
  const src = texts.get(c.file);
  if (src.includes(c.marker)) {
    c.state = 'done';
    continue;
  }
  const n = src.split(c.anchor).length - 1;
  if (n === 1) {
    c.state = 'todo';
  } else {
    c.state = 'anchor';
    problems.push(
      `${c.file} — ${c.name}：锚点找到 ${n} 处（指望 1 处）\n      ${c.anchor.split('\n')[0].slice(0, 56)}…`
    );
  }
}

if (problems.length) {
  log('──────────────────────────────');
  log('有地方对不上，**一处都没改**：');
  for (const p of problems) log(`  \u26a0\ufe0f ${p}`);
  log('──────────────────────────────');
  log('\n把上面这几行发我，我照着调。现在什么都没动，服务照旧。');
  process.exit(1);
}

// ── 第二阶段：全部写 ──────────────────────────────

const touched = new Set();
for (const c of changes) {
  if (c.state === 'done') continue;
  texts.set(c.file, texts.get(c.file).replace(c.anchor, c.replacement));
  touched.add(c.file);
}

// 先备份再写。decide.js 和 phosphor.js 都是改坏了整个进程起不来的文件
for (const file of touched) {
  const full = path.join(SRC, file);
  fs.writeFileSync(`${full}.bak`, fs.readFileSync(full));
  fs.writeFileSync(full, texts.get(file), 'utf8');
}

log('──────────────────────────────');
for (const c of changes) {
  log(`${c.state === 'done' ? '\u00b7  \u5df2\u7ecf\u5728\u4e86' : '\u2705 \u6539\u4e86    '}  ${c.file}  —  ${c.name}`);
}
log('──────────────────────────────');
if (touched.size) log(`\n备份：${[...touched].map((f) => `src/${f}.bak`).join('、')}`);
log('\n接着：');
log('  node --check src/phosphor.js && node --check src/decide.js && node --check src/workkk.js && node --check src/workkk-steps.js && echo 语法OK');
log('  pm2 restart phosphor --update-env');
log('\n启动日志里该出现「上班：一天一次、一次最多再走 8 步；今天还没去」那一段。');
