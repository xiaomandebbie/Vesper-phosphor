#!/usr/bin/env node
// 把笔记本接进去。四处：
//   src/vesper.js       → 挂 /notes 页面和 /notes/mcp
//   src/run-actions.js  → 开工前读那一本、收工整篇写回
//   src/discover-page.js→ 发现页加一张卡
//
// 四处锚点全对得上才写文件，任一处不唯一就整体停下、不留半成品。
// 跑过一遍再跑不会重复改。
//
// 用法（在仓库根目录）：
//   node scripts/wire_notes.mjs --check
//   node scripts/wire_notes.mjs
import fs from 'fs';
import path from 'path';

const check = process.argv.includes('--check');
const V = path.resolve('src/vesper.js');
const R = path.resolve('src/run-actions.js');
const D = path.resolve('src/discover-page.js');

// ══ src/vesper.js ══

const V_IMP_OLD = "import { registerWakeMcp } from './wake-mcp.js';";
const V_IMP_NEW = `${V_IMP_OLD}
import { registerNoteRoutes } from './notes-page.js';
import { registerNotesMcp } from './notes-mcp.js';`;

// 挂在钱包 MCP 那一排里。MCP 要在页面路由之前：/notes/:slug 会把 /notes/mcp 接走，
// 和 bar-mcp 挂在 /bar 之前、books-mcp 挂在 /books 之前同理。
const V_MOUNT_OLD = 'const wakeMcp = registerWakeMcp(app);';
const V_MOUNT_NEW = `${V_MOUNT_OLD}
// 笔记本的 MCP 端点 /notes/mcp（见 notes-mcp.js）：小满在 Aru 里读写那四本。
// 要挂在下面 /notes 页面之前：那边有 /notes/:slug，按坐标匹配会把 /notes/mcp 接走。
// 它自己校 NOTES_MCP_TOKEN，不走 Basic Auth——MCP 客户端不带那个
const notesMcp = registerNotesMcp(app);
// 笔记本 /notes（见 notes-page.js）：四本固定，读得到也改得了
const notes = registerNoteRoutes(app, { requireBasicAuth });`;

const V_LOG_OLD = '；钱包 MCP：/wallet/mcp';
const V_LOG_NEW = '；钱包 MCP：/wallet/mcp；笔记本：${notes.enabled ? `/notes（${notes.slugs.length} 本）` : \'未开\'}${notesMcp.enabled ? \'；笔记 MCP：/notes/mcp\' : \'；笔记 MCP：未配 NOTES_MCP_TOKEN\'}';

// ══ src/run-actions.js ══

const R_IMP_OLD = "import { pickActions, tier1KindOf";
const R_IMP_NEW = `import { bookForActions, openNote, closeNote } from './notes-steps.js';
import { pickActions, tier1KindOf`;

// 开工前：摆在 pickActions 之后、动作循环之前。
// 这是唯一同时知道「要做哪个游戏」和「还没开始做」的位置。
const R_OPEN_OLD = '  const results = [];';
const R_OPEN_NEW = `  // 开工前先读那一本笔记（见 notes-steps.js）。一次只读一本：
  // 哪个游戏就哪一本，四个全推进模型就是四倍 token。
  // messages 是参数，重赋之后下面 runContinuers 跟着拿到带笔记的那份。
  const noteBook = bookForActions(allowed);
  if (noteBook) messages = openNote(noteBook, messages);

  const results = [];`;

// 收工：所有动作和续步都走完之后。
// 真做成了才写（允朱：「写之前得真做完，不能先编」）。
const R_CLOSE_OLD = '  return { results, dropped };';
const R_CLOSE_NEW = `  // 收工：把那一本整篇写回去。这一轮一件都没做成就不写——写了就是编。
  if (noteBook) {
    const did = results.some(
      (r) => r.action !== 'noop' && !r.error && !(r.result && r.result.isError)
    );
    try {
      await closeNote(noteBook, messages, { did });
    } catch (err) {
      console.error('run-actions: 写笔记出错（不影响这一轮）', err.message);
    }
  }

  return { results, dropped };`;

// ══ src/discover-page.js ══

const D_CARD_OLD = `    {
      name: '\\u5171\\u8bfb\\u4e66\\u67b6',`;
const D_CARD_NEW = `    {
      name: '\\u7b14\\u8bb0\\u672c',
      what: \`\${escapeHtml(AI_NAME)}\\u7ed9\\u81ea\\u5df1\\u7559\\u7684\\u8bf4\\u660e\\u4e66\\uff1a\\u89c4\\u5219\\u3001\\u8fdb\\u5ea6\\u3001\\u4e0b\\u6b21\\u4ece\\u54ea\\u63a5\`,
      meta: '\\u56db\\u672c\\u56fa\\u5b9a \\u00b7 \\u4f60\\u4e5f\\u80fd\\u6539',
      href: '/notes',
    },
    {
      name: '\\u5171\\u8bfb\\u4e66\\u67b6',`;

const JOBS = [
  { file: V, label: 'vesper.js', ops: [
    { label: 'import 笔记本', old: V_IMP_OLD, new: V_IMP_NEW },
    { label: '挂 /notes 和 /notes/mcp', old: V_MOUNT_OLD, new: V_MOUNT_NEW },
    { label: '启动日志带上笔记本', old: V_LOG_OLD, new: V_LOG_NEW },
  ]},
  { file: R, label: 'run-actions.js', ops: [
    { label: 'import notes-steps', old: R_IMP_OLD, new: R_IMP_NEW },
    { label: '开工前读', old: R_OPEN_OLD, new: R_OPEN_NEW },
    { label: '收工写', old: R_CLOSE_OLD, new: R_CLOSE_NEW },
  ]},
  { file: D, label: 'discover-page.js', ops: [
    { label: '发现页加一张卡', old: D_CARD_OLD, new: D_CARD_NEW },
  ]},
];

const countOf = (s, n) => s.split(n).length - 1;
const staged = [];
let todo = 0;

for (const job of JOBS) {
  let src;
  try {
    src = fs.readFileSync(job.file, 'utf-8');
  } catch (err) {
    console.error(`读不到 ${job.file}：${err.message}（要在仓库根目录跑）`);
    process.exit(1);
  }
  let out = src;
  for (const op of job.ops) {
    if (out.includes(op.new)) {
      console.log(`不动：${job.label} · ${op.label}（已经改过了）`);
      continue;
    }
    const n = countOf(out, op.old);
    if (n !== 1) {
      console.error(`停了：${job.label} · ${op.label} —— 找到 ${n} 处（指望 1 处）。`);
      console.error('没写任何文件。这段原文可能被改过，贴给小克看一下。');
      process.exit(2);
    }
    out = out.replace(op.old, op.new);
    todo++;
    console.log(`要改：${job.label} · ${op.label}`);
  }
  if (out !== src) staged.push({ file: job.file, src, out });
}

if (!todo) {
  console.log('\n全都改过了，没事干。');
  process.exit(0);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

// 要么都写、要么都不写：只接一半就是页面在而他不读，或者反过来
for (const s of staged) {
  fs.writeFileSync(`${s.file}.bak-notes`, s.src);
  fs.writeFileSync(s.file, s.out);
}
console.log(`\n写完 ${staged.length} 个文件，备份是 *.bak-notes`);
console.log('接下来：.env 加 NOTES_MCP_TOKEN，再 node --check 那三个文件、pm2 restart vesper phosphor --update-env');
