#!/usr/bin/env node
// 把锈潮的续步接进唤醒流程。四处。
//
// 主体在 src/xiuchao.js（提示词、工具表、判别）和 src/xiuchao-steps.js
// （连着走几步、被拦下来让他重写），这个脚本只负责接线。
//
//   phosphor.js
//     1. import 两行
//     2. 续步调用（摆在 continueGarden 后面，和那五支并列）
//   decide.js
//     3. import 一行
//     4. 系统提示里「## 锈潮」那一段
//
// ── 为什么非得接这一层 ──
//
// 锈潮本来走 mcp_call 通用路：调完就结束，中间没人插话。
// 所以 2026-10-28 那次，拦截确实生效了（动态页卡片上写着「这句话没发出去：
// 里面报了『允朔153691』」），但他没重发——那句「把它去掉重发」回到了
// 他的上下文里，可那次唤醒已经走完。
//
// 论坛、听歌、钱包、上班、花园都有续步层——第一步做完那一层会把返回
// 追加进对话再问下一步。锈潮缺的就是这一层。
//
// ── 两阶段：先全查，再全写 ──
//
// 任何一处锚点对不上就一处都不改。半成品比不改更麻烦：
// 少了一行 import，phosphor 启动就 ReferenceError。
// 每处幂等：正文里已经有那个 marker 就算改过，跳过。可以反复跑。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_xiuchao.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const log = (s = '') => console.log(s);

const changes = [
  // ── phosphor.js ─────────────────────────────────────
  {
    file: 'phosphor.js',
    name: 'import 锈潮那两个',
    marker: "from './xiuchao-steps.js'",
    anchor: "import { continueGarden } from './garden-steps.js';",
    replacement: [
      "import { continueGarden } from './garden-steps.js';",
      "import { xiuchaoConfigSummary } from './xiuchao.js';",
      "import { continueXiuchao } from './xiuchao-steps.js';",
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '续步：进锈潮',
    marker: 'continueXiuchao(',
    anchor: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueGarden(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueGarden failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
    replacement: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueGarden(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueGarden failed:`, err);',
      '    }',
      '  }',
      '',
      '  // 锈潮：进去了就让他自己往下走（见 xiuchao-steps.js）。',
      '  // 那边没有「做完了」这种终点，所以只按三件事停：他说不走了、出错、步数用完。',
      '  // 被我们自己拦下来的话不算出错——还要再问他一次，让他改完重发。',
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueXiuchao(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueXiuchao failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
  },

  // ── decide.js ──────────────────────────────────────
  {
    file: 'decide.js',
    name: 'import 锈潮那一段话',
    marker: "from './xiuchao.js'",
    anchor: "import { rusttideSection } from './rusttide.js';",
    replacement: [
      "import { rusttideSection } from './rusttide.js';",
      "import { xiuchaoSection } from './xiuchao.js';",
    ].join('\n'),
  },
  {
    file: 'decide.js',
    name: '系统提示里的「## 锈潮」',
    marker: 'xiuchaoSection()',
    anchor: '${rusttideSection()}',
    replacement: '${xiuchaoSection()}${rusttideSection()}',
  },
];

// ── 第一阶段：全部检查 ─────────────────────────────

for (const f of ['xiuchao.js', 'xiuchao-steps.js', 'rusttide.js']) {
  if (!fs.existsSync(path.join(SRC, f))) {
    console.error(`少了 src/${f}。先把它拉下来，再跑这个脚本。`);
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
  log('\n把上面这几行发我。现在什么都没动，服务照旧。');
  process.exit(1);
}

// ── 第二阶段：全部写 ──────────────────────────────

const touched = new Set();
for (const c of changes) {
  if (c.state === 'done') continue;
  texts.set(c.file, texts.get(c.file).replace(c.anchor, c.replacement));
  touched.add(c.file);
}

for (const file of touched) {
  const full = path.join(SRC, file);
  fs.writeFileSync(`${full}.bak-${Date.now()}`, fs.readFileSync(full));
  fs.writeFileSync(full, texts.get(file), 'utf8');
}

log('──────────────────────────────');
for (const c of changes) {
  log(`${c.state === 'done' ? '\u00b7  \u5df2\u7ecf\u5728\u4e86' : '\u2705 \u6539\u4e86    '}  ${c.file}  —  ${c.name}`);
}
log('──────────────────────────────');
if (touched.size) log(`\n备份：${[...touched].map((f) => `src/${f}.bak-*`).join('、')}`);
log('\n接着：');
log('  node --check src/xiuchao.js && node --check src/xiuchao-steps.js \\');
log('    && node --check src/phosphor.js && node --check src/decide.js && echo 语法OK');
log('  pm2 restart phosphor --update-env');
log('\n他下次在锈潮说话被拦下来，会被再问一次——日志里是「话被拦下来了，让他重写」。'); 
