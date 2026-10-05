#!/usr/bin/env node
// add-read-memo-prompt.mjs — 把 read_memo 加进 decide.js 的行动清单。
//
// 用法（在仓库根目录）：
//     node scripts/add-read-memo-prompt.mjs --check   # 只看能不能打上，不动文件
//     node scripts/add-read-memo-prompt.mjs           # 真打，先自动备份
//
// 为什么要这么改：
//   actions/index.js 里注册了 read_memo，但模型是从 system 提示词的「可用的动作」里
//   知道自己能做什么的。清单里没写，就永远不会被选中 —— 注册表里挂着也是白挂。
//
// 为什么要按条件出现：
//   read_memo 读批注本走的是 MUSIC_PLAYER_URL（musicPlayerBase()，转发到 server/music.py），
//   而提示词里「听歌」那一段看的是 MUSIC_MCP_URL——两个变量不是一回事。
//   没配播放器时这个动作只会返回 null，白白占掉这次醒来的行动，
//   所以清单里那一条也跟着 MUSIC_PLAYER_URL 走。
//
// 只改 src/decide.js 一个文件，两处：
//   1. buildSystemPrompt 里加一个 memoActionNote（按环境变量决定空不空）
//   2. 把它插进「可用的动作」清单，shake_jar 和 mcp_call 之间
//
// 原文对不上就整个不改，不猜。出问题：把 src/decide.js.bak-readmemo 覆回去。

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET = path.join(HERE, '..', 'src', 'decide.js');
const BACKUP = `${TARGET}.bak-readmemo`;

const patches = [];
const patch = (name, find, replace) => patches.push({ name, find, replace });

// ── 1. 按环境变量决定这一条要不要给模型看 ──
patch(
  '加 memoActionNote 定义',
  `  return \`你会时不时自己醒来。`,
  `  // 翻批注本走 MUSIC_PLAYER_URL（转发到播放器），和上面听歌那段的 MUSIC_MCP_URL 不是同一个。
  // 没配播放器时不把这条给模型看：它只会返回 null，白白占掉这次醒来的行动。
  const memoActionNote = process.env.MUSIC_PLAYER_URL
    ? \`
- read_memo（翻批注本，随机翻出一首写过批注的歌，看看当时在那首歌旁边写了什么。
  不需要 action_detail。批注本空的时候翻不出东西，那就别选它。
  注意：\${USER_NAME}在播放器里写批注是不会通知你的，所以只能你自己想起来去翻。
  翻到的那一页会记在你的动态里，点开能看到批注正文——不写进推送和共享时间线。
  想指定看哪一首、或者想顺手写一笔，用 mcp_call 的 memo_read / song_memo）\`
    : '';

  return \`你会时不时自己醒来。`,
);

// ── 2. 插进「可用的动作」清单，紧跟在摇星星罐后面（两个都是回头翻旧东西）──
patch(
  '清单里加 read_memo',
  `  摇出来的那一句会记在你的动态里，点开能看到——不写进推送和共享时间线）
- mcp_call（调用MCP工具`,
  `  摇出来的那一句会记在你的动态里，点开能看到——不写进推送和共享时间线）\${memoActionNote}
- mcp_call（调用MCP工具`,
);

const src = await readFile(TARGET, 'utf8');
let out = src;
const applied = [];

for (const { name, find, replace } of patches) {
  const hits = out.split(find).length - 1;
  if (hits === 0) {
    console.error(`✗ 「${name}」对不上原文，可能已经改过或上游换了写法。`);
    console.error('  整个文件没动，什么都没改。');
    process.exit(2);
  }
  if (hits > 1) {
    console.error(`✗ 「${name}」在文件里出现 ${hits} 次，不敢猜是哪一处。没改。`);
    process.exit(2);
  }
  out = out.replace(find, replace);
  applied.push(name);
}

if (process.argv.includes('--check')) {
  console.log('✓ 两处都能打上，文件没动：');
  for (const n of applied) console.log(`  · ${n}`);
  process.exit(0);
}

await copyFile(TARGET, BACKUP);
await writeFile(TARGET, out, 'utf8');
console.log(`✓ 打上了 ${applied.length} 处，原文件备份在 ${path.basename(BACKUP)}：`);
for (const n of applied) console.log(`  · ${n}`);
console.log();
console.log('重启晨暮星：pm2 restart vesper   （名字以你 pm2 list 里显示的为准）');
console.log(`要退回去：cp ${path.basename(BACKUP)} decide.js && pm2 restart vesper`);
