#!/usr/bin/env node
// 把花园接进唤醒流程。六处。
//
// 主体在 src/garden.js（判定、提示词、requestId 生成）和
// src/garden-steps.js（连着走几步），这个脚本只负责接线。
//
//   mcp-manager.js
//     1. connectAll 里连上 garden
//     2. callTool 统一补 requestId
//   phosphor.js
//     3. import 两行
//     4. 续步（摆在 continueWorkkk 后面，和那四支并列）
//     5. 启动日志带上花园配置
//   decide.js
//     6. import 一行 + 系统提示里「## 花园」那一段
//   activity.js
//     7. 行为卡片上的花园说法
//
// ── requestId 为什么必须在 callTool 里补 ──
//
// 花园的 garden_action 要求 requestId（16–80 个 [A-Za-z0-9_-]），它用这个做幂等：
// 同一个意图重试沿用同一个编号，不同意图必须不同（留最近 200 条回执）。
// 交给模型有两个坏结局：编重了→该执行的被当成重试吠掉；格式不对→被 schema 拦。
//
// 而第一步和续步走的是两条路：
//   第一步：executeAction → actions/mcp-action.js → callTool
//   续步：garden-steps.js → callTool
// 两边各自补就会漏一边（而且漏的那边永远是第一步，最难发现）。
// callTool 是它们唯一的共同入口，所以补在那里，模型根本不用知道有这个字段。
// 模型自己给了合法的就尊重它的（它可能真在重试）。
//
// ── 两阶段：先全查，再全写 ──
//
// 任何一处锚点对不上就一处都不改。半成品比不改更麻烦：
// 少了一行 import，phosphor 启动就 ReferenceError。
// 每处幂等：正文里已经有那个 marker 就算改过，跳过。可以反复跑。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_garden.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, '..', 'src');

const log = (s = '') => console.log(s);

const changes = [
  // ── mcp-manager.js ───────────────────────────────────
  {
    file: 'mcp-manager.js',
    name: '连接 garden',
    marker: "connectMcpHttp('garden'",
    anchor: "  if (process.env.MUSIC_MCP_URL) {",
    replacement: [
      '  // 花园 Rainholm Garden（suwanblue & Kelin & Guchen）：白猫是她、黑猫是他，',
      '  // 同一片地同一份存档。本机只听 127.0.0.1:5173，用它自带的 AI 钥匙鉴权',
      '  // （静态、不过期，比 workkk 那个 OAuth 省事）。',
      '  // 名字固定叫 garden：garden.js 的 gardenCallOf、下面 callTool 补 requestId、',
      '  // 动态页的行为卡片都按这个名字认。',
      '  if (process.env.GARDEN_MCP_URL) {',
      '    try {',
      '      const headers = process.env.GARDEN_MCP_TOKEN',
      '        ? { Authorization: `Bearer ${process.env.GARDEN_MCP_TOKEN}` }',
      '        : undefined;',
      "      await connectMcpHttp('garden', process.env.GARDEN_MCP_URL, headers);",
      "      console.log('connected MCP: garden');",
      '    } catch (err) {',
      '      console.error(\'could not connect MCP "garden":\', err.message);',
      '    }',
      '  }',
      '',
      '  if (process.env.MUSIC_MCP_URL) {',
    ].join('\n'),
  },
  {
    file: 'mcp-manager.js',
    name: 'callTool 补 requestId',
    marker: 'withGardenRequestId',
    anchor:
      '  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));',
    replacement: [
      '  // 花园的幂等钥匙。摆在这里而不是各自补：第一步走 executeAction →',
      '  // actions/mcp-action.js，续步走 garden-steps.js，两条路只在这里汇合。',
      '  // 模型自己给了合法的就不动——它可能真在重试。',
      '  args = withGardenRequestId(serverName, args);',
      '  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));',
    ].join('\n'),
  },
  {
    file: 'mcp-manager.js',
    name: 'import newRequestId',
    marker: "from './garden.js'",
    anchor: "import { getForumNotes } from './state.js';",
    replacement: [
      "import { getForumNotes } from './state.js';",
      "import { newRequestId } from './garden.js';",
      '',
      '// 花园要求 requestId：16–80 个 [A-Za-z0-9_-]。模型没给、或者给的不合法就换一个新的。',
      '// 合法的不动：那可能是它在沿用同一个编号重试同一个意图，换掉反而会重复执行。',
      'function withGardenRequestId(serverName, args) {',
      "  if (serverName !== 'garden') return args;",
      '  const given = args?.requestId;',
      '  const ok = typeof given === \'string\' && /^[A-Za-z0-9_-]{16,80}$/.test(given);',
      '  return ok ? args : { ...(args ?? {}), requestId: newRequestId() };',
      '}',
    ].join('\n'),
  },

  // ── phosphor.js ─────────────────────────────────────
  {
    file: 'phosphor.js',
    name: 'import 花园那两个',
    marker: "from './garden-steps.js'",
    anchor: "import { isSharedTimelineEnabled, describeAction, postSharedEvent } from './timeline.js';",
    replacement: [
      "import { isSharedTimelineEnabled, describeAction, postSharedEvent } from './timeline.js';",
      "import { gardenConfigSummary } from './garden.js';",
      "import { continueGarden } from './garden-steps.js';",
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '续步：逛花园',
    marker: 'continueGarden(',
    anchor: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueWorkkk(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueWorkkk failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
    replacement: [
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueWorkkk(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueWorkkk failed:`, err);',
      '    }',
      '  }',
      '',
      '  // 逛花园：读完状态和地图可以接着走过去、种一块（见 garden-steps.js）。',
      '  // 动了土就停，和上班那支正好相反——种地每一步都当场生效，没有「做到一半白干」这回事。',
      '  if (decision && !errorMessage) {',
      '    try {',
      '      await continueGarden(decision, result, messages);',
      '    } catch (err) {',
      '      console.error(`[${kind}] continueGarden failed:`, err);',
      '    }',
      '  }',
    ].join('\n'),
  },
  {
    file: 'phosphor.js',
    name: '启动日志带上花园',
    marker: 'gardenConfigSummary()',
    anchor: '；星星罐：一天一颗',
    replacement: '；${gardenConfigSummary()}；星星罐：一天一颗',
  },

  // ── decide.js ──────────────────────────────────────
  {
    file: 'decide.js',
    name: 'import 花园那一段话',
    marker: "from './garden.js'",
    anchor: "import { dreamDigest } from './dreams.js';",
    replacement: [
      "import { dreamDigest } from './dreams.js';",
      "import { gardenSection } from './garden.js';",
    ].join('\n'),
  },
  {
    file: 'decide.js',
    name: '系统提示里的「## 花园」',
    marker: 'gardenSection()',
    anchor: '## 星星罐',
    replacement: '${gardenSection()}\n\n## 星星罐',
  },

  // ── actions/activity.js ───────────────────────────────
  {
    file: 'actions/activity.js',
    name: '行为卡片上的花园说法',
    marker: "j.server === 'garden'",
    anchor: '      return `${AI_NAME}刚刚用了 ${j.server} 的 ${j.tool}`;',
    replacement: [
      '      // 花园：第一步走这里，续步在 garden-steps.js 自己记，两边口径一致。',
      "      if (j.server === 'garden') {",
      "        const scene = { garden: '花园', greenhouse: '花房', cathome: '小窝' }[j.args?.scene] || '花园';",
      "        if (j.tool === 'garden_state') return `${AI_NAME}看了一眼${scene}现在的样子`;",
      "        if (j.tool === 'garden_map') return `${AI_NAME}读了一遍${scene}的地图`;",
      "        const label = { move: '走了几步', say: '说了句话', plant: '种下了一株', water: '浇了水', harvest: '收了一块' }[j.args?.action];",
      '        if (label) {',
      "          const plot = Number.isInteger(j.args?.plot) ? ` ${j.args.plot} 号` : '';",
      '          return `黑猫在${scene}里${label}${plot}`;',
      '        }',
      '        return `黑猫在${scene}里动了动`;',
      '      }',
      '      return `${AI_NAME}刚刚用了 ${j.server} 的 ${j.tool}`;',
    ].join('\n'),
  },
];

// ── 第一阶段：全部检查 ─────────────────────────────

// 两个新文件得先在，不然接上了也找不到模块
for (const f of ['garden.js', 'garden-steps.js']) {
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

// 先备份再写。这几个文件改坏了整个进程起不来
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
log('  把这两行加进 .env（AI 钥匙用 cd /opt/garden && node start.mjs --show-access 拿）：');
log('    GARDEN_MCP_URL=http://127.0.0.1:5173/mcp');
log('    GARDEN_MCP_TOKEN=<AI 钥匙>');
log('  node --check src/garden.js && node --check src/garden-steps.js \\');
log('    && node --check src/mcp-manager.js && node --check src/phosphor.js \\');
log('    && node --check src/decide.js && node --check src/actions/activity.js && echo 语法OK');
log('  pm2 restart phosphor --update-env');
log('\n启动日志里该出现「connected MCP: garden」和「花园：一次最多再走 6 步」。');
