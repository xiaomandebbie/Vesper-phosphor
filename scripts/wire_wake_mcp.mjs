#!/usr/bin/env node
// 把精确唤醒的 MCP 端点（src/wake-mcp.js）挂进 vesper.js。
//
// 为什么是脚本而不是直接改文件：vesper.js 被好几个补丁改过（钱包、钱包 MCP、梦境……），
// 整个重写会把那些一起冲掉 —— 2026-10-11 就这么把钱包弄没的，/wallet 直接 404。按锚点插两行最安全。
//
// 挂在 express.json() 之后（和钱包 MCP 一样）：MCP 走 JSON-RPC，
// transport.handleRequest 要现成的 req.body。记忆库那两个转发才必须挂在解析之前。
//
// 用法（在仓库根目录）：
//   node scripts/wire_wake_mcp.mjs --check
//   node scripts/wire_wake_mcp.mjs

import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/vesper.js');
const check = process.argv.includes('--check');

const IMPORT_OLD = "import { registerWalletMcp } from './wallet-mcp.js';";
const IMPORT_NEW = `${IMPORT_OLD}\nimport { registerWakeMcp } from './wake-mcp.js';`;

const MOUNT_OLD = 'registerWalletMcp(app);';
const MOUNT_NEW = `${MOUNT_OLD}
// 精确唤醒的 MCP 端点 /wake/mcp：让他自己约时间、看还有什么约、撒约、改时间（见 wake-mcp.js）。
// 到点触发一次正常唤醒，不强制开口 —— 醒过来做什么是他那一刻自己决定的
const wakeMcp = registerWakeMcp(app);`;

const LOG_OLD = '；钱包 MCP：/wallet/mcp';
const LOG_NEW = '；钱包 MCP：/wallet/mcp${wakeMcp.enabled ? `；约时间 MCP：/wake/mcp（最多挂 ${wakeMcp.maxPending} 个）` : \'；约时间 MCP：未配 WAKE_MCP_TOKEN\'}';

const OPS = [
  { label: '引入 wake-mcp', old: IMPORT_OLD, new: IMPORT_NEW },
  { label: '挂上 /wake/mcp', old: MOUNT_OLD, new: MOUNT_NEW },
  { label: '启动日志带上约时间 MCP', old: LOG_OLD, new: LOG_NEW },
];

const countOf = (s, needle) => s.split(needle).length - 1;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}`);
  process.exit(1);
}

if (!fs.existsSync(path.resolve('src/wake-mcp.js'))) {
  console.error('少了 src/wake-mcp.js。先 git pull。');
  process.exit(1);
}

let out = src;
let edits = 0;

for (const op of OPS) {
  if (out.includes(op.new)) {
    console.log(`不动：${op.label}（已经改过了）`);
    continue;
  }
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`停了：${op.label} —— 找到 ${n} 处（指望 1 处）。`);
    if (op.old === MOUNT_OLD && n === 0) {
      console.error('vesper.js 里没有 registerWalletMcp(app)。先跑 scripts/add_wallet_mcp.py 把钱包 MCP 挂上。');
    }
    console.error('没写任何文件。');
    process.exit(2);
  }
  out = out.replace(op.old, op.new);
  edits++;
  console.log(`要改：${op.label}`);
}

if (!edits) {
  console.log('全都改过了，没事干。');
  process.exit(0);
}

if (check) {
  console.log('\n--check，没写。');
  process.exit(0);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, out);
console.log(`\n写完了。备份在 ${path.basename(FILE)}.bak`);
console.log('接下来：.env 里加一行 WAKE_MCP_TOKEN=自己编一串，再 node --check src/vesper.js 和 pm2 restart vesper --update-env');
