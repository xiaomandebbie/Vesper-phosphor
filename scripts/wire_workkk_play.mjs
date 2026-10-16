#!/usr/bin/env node
// 把「醒来去上班」接进 phosphor 和 decide。五处。
//
// 小满 2026-10-16：「不要一天一次，而是一次只能玩游戏的一天的内容」
//
// 想玩随时可以玩，边界在「下班结算」那一刻：上完游戏里的那一天就收手，
// 不往下一天续。主体在 src/workkk.js 和 src/workkk-steps.js，
// 这个脚本只负责接到现有的唤醒流程上。
//
//   phosphor.js
//     1. import 两行
//     2. 连着走到下班（摆在 continueMusic 后面，和那三支并列）
//     3. 启动日志带上上班配置
//   decide.js
//     4. import 一行
//     5. 系统提示里「## 上班」那一段
//
// 第一版有八处：那时把这件事读成了「现实里一天只给一次机会」，
// 建了张 workkk_days 表做日期门禁，还要在 executeAction 前摆一道检查。
// 那三处（workkkToday 标记、执行前的门禁、今天还能不能去）都没了。
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
    name: 'import 上班那两个',
    marker: "from './workkk-steps.js'",
    anchor: "import { describeActivity, describeActivityDetail } from './actions/activity.js';",
    replacement: [
      "import { describeActivity, describeActivityDetail } from './actions/activity.js';",
      "import { workkkConfigSummary } from './workkk.js';",
      "import { continueWorkkk } from './workkk-steps.js';",
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
      '  // 上班：开了就把游戏里的那一天上完（见 workkk-steps.js）。',
      '  // 做到一半停下这天不结算工资，所以走到「今日进度」满；',
      '  // 下班那一刻立即收手，不往下一天续。出什么错都不影响剩下的收尾。',
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueWorkkk(decision, result, messages);',
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
    name: 'import 上班那一段话',
    marker: "from './workkk.js'",
    anchor: "import { doingSection, doingStatusLine } from './doing.js';",
    replacement: [
      "import { doingSection, doingStatusLine } from './doing.js';",
      "import { workkkSection } from './workkk.js';",
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
for (const c of changes) {
  if (texts.has(c.file)) continue;
  const full = path.join(SRC, c.file);
  if (!fs.existsSync(full)) {
    console.error(`找不到 src/${c.file}。要在仓库根目录里跑。什么都没改。`);
    process.exit(1);
  }
  texts.set(c.file, fs.readFileSync(full, 'utf8'));
}

// 跑过第一版（日期门禁那个）的话，正文里会有 startToday。
// 那几个函数已经从 workkk.js 删掉了，留着会让 phosphor 启动就 ReferenceError。
// 不在半成品上再打一层，直接停下来让人用 .bak 恢复。
for (const [file, src] of texts) {
  if (src.includes('startToday') || src.includes('workkkStatusLine')) {
    console.error(`src/${file} 里还有第一版的日期门禁接线（startToday / workkkStatusLine）。`);
    console.error('那几个函数已经没了，留着 phosphor 启动就报错。先恢复再重跑：');
    console.error(`  cp src/${file}.bak src/${file}`);
    console.error('什么都没改。');
    process.exit(1);
  }
}

const problems = [];
for (const c of changes) {
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
log('\n启动日志里该出现「上班：一次上完游戏里的一天（下班结算就停）」那一段。');
