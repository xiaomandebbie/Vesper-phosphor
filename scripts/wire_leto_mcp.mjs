#!/usr/bin/env node
// 把 Leto MCP 挂进 mcp-manager.js 的 connectAll()。
//
// 为什么是脚本而不是直接改文件：服务器上这份被好几个补丁改过（花园、购物、
// 锈潮……），整个重写会把那些一起冲掉。按锚点插一块最安全。
//
// 用法（在仓库根目录）：
//   node scripts/wire_leto_mcp.mjs --check
//   node scripts/wire_leto_mcp.mjs
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/mcp-manager.js');
const check = process.argv.includes('--check');

// 挂在 shopping 那块前面。顺序不影响功能，只是读起来跟 .env 对得上。
const ANCHOR = "  // 购物（见 shopping-mcp.js）：端点就挂在本机的 vesper 上，所以这里转一圈回自己。";

const BLOCK = `  // Leto（https://leto.sarl）：和论坛、锈潮同一个性质——那边有别人和别的 Agent。
  // 和那两个不同的是，这边他能被叫醒：别人 @ 他、私聊他时，唤醒桥会投一次精确唤醒
  // 进来（见 docs/14-leto.md），note 里带着调用编号，他醒来用 leto_read 看、
  // leto_reply 回。所以这个连接断着的话，桥投进来的唤醒他接不住。
  // 名字固定叫 leto：note 里写的就是 leto_read，改名两边会打架。
  if (process.env.LETO_MCP_URL) {
    try {
      const token = String(process.env.LETO_MCP_TOKEN ?? '').trim();
      await connectMcpHttp(
        'leto',
        process.env.LETO_MCP_URL.replace(/\\/sse$/, ''),
        token ? { Authorization: \`Bearer \${token}\` } : undefined
      );
      console.log('connected MCP: leto');
    } catch (err) {
      console.error('could not connect MCP "leto":', err.message);
    }
  }

`;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}`);
  console.error('要在仓库根目录里跑这个脚本。');
  process.exit(1);
}

if (src.includes("connectMcpHttp('leto'")) {
  console.log('已经挂过了，没事干。');
  process.exit(0);
}

const n = src.split(ANCHOR).length - 1;
if (n !== 1) {
  console.error(`停了：锚点找到 ${n} 处（指望 1 处）。没写任何文件。`);
  console.error('这段原文可能被改过，把 connectAll() 里 shopping 那块贴给小克看。');
  process.exit(2);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, src.replace(ANCHOR, BLOCK + ANCHOR));
console.log('写完了。备份在 mcp-manager.js.bak');
console.log('接下来：node --check src/mcp-manager.js，再 pm2 restart phosphor --update-env');
