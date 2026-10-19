#!/usr/bin/env node
// 修真正的根因：localStorage 的方法不能在实例上覆盖。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_storage_hook.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 诊断结论 ──
//
// 2026-10-19 日志：13:18 两次 GET /shelf，一次 PUT 也没有。
// 也就是说页面每次开都来读，但导书、写批注之后从来没往回写过。
//
// 原因是 bridge 这两行：
//   LS.getItem = function (k) {...}
//   LS.setItem = function (k, v) {...}
//
// localStorage 不是普通对象。它是 WebIDL 里的 legacy platform object，
// 带「命名属性」（named properties）特性——这就是为什么你能写
//   localStorage.foo = 'bar'
// 来存东西。同样的规则下，给它赋**任何**属性都会变成存键值对，
// 所以上面那行的真实效果是：
//   localStorage.setItem('setItem', '那个函数的字符串形式')
// 方法根本没被覆盖。
//
// 所以：
//   GET 能工作      —— 那是 bridge 自己发的同步 XHR，不经过挂钩
//   平板能看见书   —— 「服务器为准」那句用的是 bind 过的原始方法，正常
//   回写从来不走   —— persistShelf() 调的是真正的原生 setItem
//
// 正确做法：挂 Storage.prototype。但 sessionStorage 共用同一个 prototype，
// 所以方法里要先判 this 是不是 localStorage，不是就原样透传。

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'src', 'books-page.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/books-page.js。先 cd /root/vesper-phosphor。');
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

// ──── 1. 拿到 Storage.prototype，并存好原始方法 ────

patch('拿 Storage.prototype', {
  done: (t) => t.includes('var PROTO ='),
  find:
    '  var LS = window.localStorage;\n' +
    '  var origGet = LS.getItem.bind(LS);\n' +
    '  var origSet = LS.setItem.bind(LS);',
  replace:
    '  var LS = window.localStorage;\n' +
    '  // 挂 Storage.prototype，不是实例。localStorage 是 WebIDL 的 legacy platform object，\n' +
    '  // 带「命名属性」特性（这就是为什么 localStorage.foo = 1 能存东西），\n' +
    '  // 给它赋任何属性都会变成存键值对——LS.setItem = fn 的真实效果是\n' +
    "  // localStorage.setItem('setItem', fn.toString())，方法根本没被覆盖。\n" +
    '  // （2026-10-19：回写从来没发出过，就是这个原因。）\n' +
    '  var PROTO = Object.getPrototypeOf(LS);\n' +
    '  var protoGet = PROTO.getItem;\n' +
    '  var protoSet = PROTO.setItem;\n' +
    '  var origGet = function (k) { return protoGet.call(LS, k); };\n' +
    '  var origSet = function (k, v) { return protoSet.call(LS, k, v); };',
});

// ──── 2. getItem 挂到 prototype 上 ────
//
// sessionStorage 共用这个 prototype，所以先判 this。

patch('getItem 挂 prototype', {
  done: (t) => t.includes('PROTO.getItem = function'),
  find: '  LS.getItem = function (k) {\n',
  replace:
    '  PROTO.getItem = function (k) {\n' +
    '    // sessionStorage 共用同一个 prototype，别误伤\n' +
    '    if (this !== LS) return protoGet.call(this, k);\n',
});

// ──── 3. setItem 挂到 prototype 上 ────

patch('setItem 挂 prototype', {
  done: (t) => t.includes('PROTO.setItem = function'),
  find: '  LS.setItem = function (k, v) {\n',
  replace:
    '  PROTO.setItem = function (k, v) {\n' +
    '    if (this !== LS) return protoSet.call(this, k, v);\n',
});

// ──── 4. 挂好之后报一声，以后一眼能看出挂没挂上 ────

patch('挂好了报一声', {
  done: (t) => t.includes('books: 转接层装好了'),
  find: '\n})();`;',
  replace:
    '\n  console.log(\n' +
    "    'books: 转接层装好了（挂在 Storage.prototype 上）。服务器书架 ' +\n" +
    "      (Array.isArray(server) ? server.length + ' 本' : '读不到')\n" +
    '  );\n' +
    '})();`;',
});

if (changed) {
  const bak = `${FILE}.bak-hook`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-hook' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('');
console.log('然后手机上把 /books 关掉重开，导一本书或写一条批注，再看：');
console.log("  pm2 logs vesper --lines 30 --nostream | grep 'books:'");
console.log('该出现「进来一条 PUT /shelf」和「收到书架 N 本」。');
console.log('');
