#!/usr/bin/env node
// 把共读书架的 MCP 端点挂进 vesper.js。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/wire_books_mcp.mjs
//   node --check src/vesper.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 两处顺序要紧 ──
//
// 一、MCP 端点要挂在 registerBookRoutes 之前。那边有一个
//    app.use(PREFIX, requireBasicAuth, ...) 接着静态文件，
//    按前缀匹配，会把 /books/mcp 也接走。和 bar-mcp 挂在 /bar 页面之前
//    是同一个理由（见 vesper.js 里那段注释）。
//
// 二、MCP 端点自己校 BOOKS_MCP_TOKEN，不走 Basic Auth——聊天客户端不带那个。

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'src', 'vesper.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/vesper.js，当前目录对吗？');
  process.exit(1);
}

let text = fs.readFileSync(FILE, 'utf8');
const report = [];
let changed = false;

function patch(label, { done, find, replace }) {
  if (done(text)) {
    report.push(['skip', label]);
    return;
  }
  const n = text.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  text = text.replace(find, replace);
  changed = true;
  report.push(['ok', label]);
}

patch('import registerBooksMcp', {
  done: (t) => t.includes("from './books-mcp.js'"),
  find: "import { registerBookRoutes } from './books-page.js';",
  replace:
    "import { registerBookRoutes } from './books-page.js';\n" +
    "import { registerBooksMcp } from './books-mcp.js';",
});

// 挂在 registerBookRoutes 之前：那边的 app.use(PREFIX, ...) 按前缀匹配，
// 会把 /books/mcp 也接走。
patch('挂 /books/mcp', {
  done: (t) => t.includes('registerBooksMcp(app)'),
  find: 'const books = registerBookRoutes(app, { requireBasicAuth });',
  replace:
    '// 共读书架的 MCP 端点 /books/mcp（见 books-mcp.js）：聊天里他也能读书、写批注。\n' +
    '// 要挂在下面 registerBookRoutes 之前：那边有个 app.use(\'/books\', ...) 接静态文件，\n' +
    '// 按前缀匹配，会把 /books/mcp 也接走。和 bar-mcp 挂在 /bar 页面之前同理。\n' +
    '// 它自己校 BOOKS_MCP_TOKEN，不走 Basic Auth——聊天客户端不带那个\n' +
    'const booksMcp = registerBooksMcp(app);\n' +
    'const books = registerBookRoutes(app, { requireBasicAuth });',
});

patch('启动日志加书架 MCP', {
  done: (t) => t.includes('共读 MCP'),
  find: "；共读书架：${books.enabled ? '/books' : '未配置（缺 BOOKS_UI_DIR）'}",
  replace:
    "；共读书架：${books.enabled ? '/books' : '未配置（缺 BOOKS_UI_DIR）'}" +
    "；共读 MCP：${booksMcp.enabled ? '/books/mcp' : '未开（没配 BOOKS_MCP_TOKEN）'}",
});

if (changed) {
  const bak = `${FILE}.bak-booksmcp`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '接好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/vesper.js，备份在 .bak-booksmcp' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  1. 生一个 token 写进 .env：');
console.log('       echo "BOOKS_MCP_TOKEN=$(head -c 24 /dev/urandom | base64 | tr -d \'/+=\')" >> .env');
console.log('  2. node --check src/vesper.js && echo 语法 OK');
console.log('  3. pm2 restart vesper --update-env');
console.log('  4. 把 token 读出来，填进 Aru 的 MCP 配置：');
console.log('       grep BOOKS_MCP_TOKEN .env');
console.log('');
console.log('Aru 里新建一个 MCP 服务：');
console.log('  URL：https://vesperphosphor.online/books/mcp');
console.log('  鉴权：Header  Authorization: Bearer <那个 token>');
console.log('');
