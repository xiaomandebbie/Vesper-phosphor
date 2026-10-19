#!/usr/bin/env node
// 两件事一次做完：
//   一、转接层改成「服务器为准」——平板看不到书的根因。
//   二、把你和他的名字填上，不用改前端源码。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_final.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 平板为什么一直没书 ──
//
// 不是服务器的事。平板上那个页面被 Safari 做了 localStorage 隔离
// （私密浏览标签，或者「防止跳踪跟踪」切了存储区），所以它自己那份
// 是空的。而我上一版的迁移只在「服务器书架为空」时触发；现在服务器有书了，
// 那条路径永远不会再跑——于是平板卡在「自己没有、也不会去拿」。
//
// 这是我设计反了：「两边读同一份」就应该以服务器为准，本地那份只是缓存。
// 现在改过来：只要 GET /shelf 回了非空数组，就用它，不管本地有没有。
// 本地那份只在服务器真的空着时当种子推上去（第一次迁移）。
//
// ── 名字为什么不改 bookshelf.jsx ──
//
// 那样要 npm install + npm run build，而且原作每次更新都要再改一遍。
// 名字最终是通过 SHELF_AUTHORS.me.name / .ai.name 读到的，而它把
// SHELF_AUTHORS 挂到了 window 上。所以等 React 挂载完改那两个字段就行。
// 名字从 .env 的 USER_DISPLAY_NAME / AI_DISPLAY_NAME 读，和其他页一致。

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'src', 'books-page.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/books-page.js，当前目录对吗？');
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

// ──── 1. 显示名字从 .env 读 ────

patch('读两人的显示名', {
  done: (t) => t.includes('const BOOKS_ME_NAME'),
  find: "const PREFIX = '/books';",
  replace: `const PREFIX = '/books';

// 书架界面上你们两个的名字。bookshelf.jsx 里 SHELF_PROFILES 是空的（原作不预置
// 个人资料），留空就显示「我 / AI」。这边从 .env 读，和其他页一致。
const BOOKS_ME_NAME = String(process.env.USER_DISPLAY_NAME ?? '').trim();
const BOOKS_AI_NAME = String(process.env.AI_DISPLAY_NAME ?? '').trim();`,
});

// ──── 2. 服务器为准 ────
//
// 原来：var cached = serverText;  —— serverText 为 null 时 getItem 走本地，
// 而平板本地是空的，于是退回 DEFAULT_BOOKS。
// 现在：只要服务器回了非空数组就用它，并顺手写进本地当缓存。

const AUTHORITY = `  // 服务器为准。平板上那个标签页被 Safari 隔离了 localStorage（私密浏览或
  // 防跟踪切存储区），自己那份是空的；之前只在「服务器为空」时才迁移，
  // 所以它卡在「自己没有、也不去拿」。两边读同一份，就该以这边为准。
  if (Array.isArray(server) && server.length) {
    try { origSet(SHELF_KEY, serverText); } catch (e) {}
  }

`;

patch('服务器为准', {
  done: (t) => t.includes('// 服务器为准。平板上那个标签页'),
  find: '  var cached = serverText;',
  replace: AUTHORITY + '  var cached = serverText;',
});

// ──── 3. 改名字 ────
//
// 它把 SHELF_AUTHORS 挂在 window 上（Object.assign(window, {...})），但那是
// bookshelf-app 跑到那一行才有。bridge 在 body 开头，那时还没有，
// 所以轮询一小会儿；最多试 3 秒，试不到就算了（大不了显示「我 / AI」）。
//
// 注意：这段是往模板字符串里塞，不能出现反引号；
// 名字要插值进去，所以用 ${...}（落到文件里就是真的插值语法，运行时求值）。

const NAMES = `
  // 界面上的名字。原作 SHELF_PROFILES 留空时显示「我 / AI」；这边等它挂完
  // SHELF_AUTHORS 再改那两个字段，不动源码、不用重新 build。
  var ME = '\${BOOKS_ME_NAME}';
  var AI = '\${BOOKS_AI_NAME}';
  if (ME || AI) {
    var tries = 0;
    var tick = setInterval(function () {
      var A = window.SHELF_AUTHORS;
      if (A && A.me && A.ai) {
        if (ME) A.me.name = ME;
        if (AI) A.ai.name = AI;
        clearInterval(tick);
        return;
      }
      if (++tries > 30) clearInterval(tick);
    }, 100);
  }
`;

patch('填两人的名字', {
  done: (t) => t.includes('window.SHELF_AUTHORS'),
  find: '\n})();`;',
  replace: NAMES + '})();`;',
});

// ──── 落盘 ────

if (changed) {
  const bak = `${FILE}.bak-final`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-final' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('');
console.log('然后平板上把 /books 标签页**关掉重开**（不是刷新）。');
console.log('名字没显示的话看一眼： grep -c DISPLAY_NAME .env');
console.log('');
