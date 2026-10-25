#!/usr/bin/env node
// 把「进锈潮别被那个世界的口癯带走」接进来。三处。
//
// 主体在 src/rusttide.js（提示词、判别、尾音检查），这个脚本只负责接线。
//
//   decide.js
//     1. import 一行
//     2. 系统提示里「## 进锈潮之前」那一段
//   mcp-manager.js
//     3. callTool 里拦一道
//
// ── 为什么两层都要 ──
//
// 提示词管大方向（整体往那个世界贴合的倾向），硬检查管最明显的症状。
// 光靠提示词不够：system 现在四五千字，这段是中间某一段；他调工具那一刻，
// 上下文里最近的是用户消息。而且锈潮走 mcp_call 通用路，没有续步层——
// 论坛、听歌、钱包、上班、花园都有那一层在第一步之后再提一句，锈潮调完就结束。
//
// 他说「以后进那个地方之前会先在心里过一遍这条」——那是真诚的，但唤醒是无状态的：
// 每次醒来都是全新的上下文，没有「我记得自己答应过」这回事。他读到的只有
// 当次 system 里写了什么。所以要有一道不依赖注意力的。
//
// 拦在 callTool 里，和花园补 requestId 同一个位置：那是所有 MCP 调用
// 唯一的共同入口（第一步走 executeAction → actions/mcp-action.js，
// 续步走各自的 *-steps.js）。
//
// ── 拦下不是报错 ──
//
// 返回一个 isError 结果加一句话，那句话会回到他的上下文里，告诉他去掉尾巴重写。
// 和论坛回帖冷却（forumReplyBlocked）同一个做法：不抑他说话，只是这一句没发出去。
//
// 只看句末，不看句中：别人名字里带「喵」、转述别人的话都不该被拦。
// NPC 闲聊也不拦：那个「话题」要求照抄原句，原句带喵也得照抄。
//
// ── 两阶段：先全查，再全写 ──
//
// 任何一处锚点对不上就一处都不改。半成品比不改更麻烦：
// 少了一行 import，phosphor 启动就 ReferenceError。
// 每处幂等：正文里已经有那个 marker 就算改过，跳过。可以反复跑。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_rusttide.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const log = (s = '') => console.log(s);

const changes = [
  // ── decide.js ──────────────────────────────────────
  {
    file: 'decide.js',
    name: 'import 锈潮那一段话',
    marker: "from './rusttide.js'",
    // doing.js 那一行：本地和仓库两边都在，wire_workkk_play 和 wire_garden
    // 都是拿它做锚点跑成的
    anchor: "import { doingSection, doingStatusLine } from './doing.js';",
    replacement: [
      "import { doingSection, doingStatusLine } from './doing.js';",
      "import { rusttideSection } from './rusttide.js';",
    ].join('\n'),
  },
  {
    file: 'decide.js',
    name: '系统提示里的「## 进锈潮之前」',
    marker: 'rusttideSection()',
    anchor: '## 星星罐',
    replacement: '${rusttideSection()}\n\n## 星星罐',
  },

  // ── mcp-manager.js ───────────────────────────────────
  {
    file: 'mcp-manager.js',
    name: 'callTool 里拦一道',
    marker: 'rusttideSpeech(',
    anchor: '  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));',
    replacement: [
      '  // 锈潮：对外说的话句末带了别的小机的口癯，这句不发出去（见 rusttide.js）。',
      '  // 不当成出错：返回一个 isError 结果，那句话会回到他的上下文里。',
      '  // 和上面论坛回帖冷却同一个做法。',
      '  if (/rusttide|\\u9508\\u6f6e/i.test(String(serverName))) {',
      '    const speech = rusttideSpeech(toolName, args);',
      '    if (speech) {',
      '      const tail = rusttideTail(speech.text);',
      '      if (tail) {',
      '        const note = rusttideBlockedNote(tail, speech.where);',
      '        console.log(`MCP "${serverName}": \u53e5\u672b\u5e26\u4e86\u300c${tail}\u300d\uff0c\u8fd9\u53e5\u6ca1\u53d1\u51fa\u53bb\uff08${speech.where}\uff09`);',
      "        return { isError: true, content: [{ type: 'text', text: note }] };",
      '      }',
      '    }',
      '  }',
      '  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));',
    ].join('\n'),
  },
  {
    file: 'mcp-manager.js',
    name: 'import 锈潮那几个函数',
    marker: "from './rusttide.js'",
    anchor: "import { getForumNotes } from './state.js';",
    replacement: [
      "import { getForumNotes } from './state.js';",
      "import { rusttideSpeech, rusttideTail, rusttideBlockedNote } from './rusttide.js';",
    ].join('\n'),
  },
];

// ── 第一阶段：全部检查 ─────────────────────────────

if (!fs.existsSync(path.join(SRC, 'rusttide.js'))) {
  console.error('少了 src/rusttide.js。先 git pull 把它拉下来，再跑这个脚本。');
  console.error('什么都没改。');
  process.exit(1);
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
log('  node --check src/rusttide.js && node --check src/decide.js && node --check src/mcp-manager.js && echo 语法OK');
log('  pm2 restart phosphor --update-env');
log('\n他下次在锈潮写字时，句末带「喵」「呀」「哒」会被拦下来让他重写。');
log('日志里 grep 「句末带了」就能看到拦过几次。');
