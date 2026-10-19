#!/usr/bin/env node
// 让读书不占行动次数，但一次醒来只读一次。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_free.mjs
//   node --check src/budget.js && echo 语法 OK
//   pm2 restart phosphor --update-env
//
// ── 为什么改 ──
//
// 小满 2026-10-19：「读书能不能不占他次数，弄的他现在每次只调用读书了…
// 但是他读的超慢，经常看会好一些」
//
// 读书原本在 2 级，和上班、花园、锈潮抢那一天 6 次。他每次都选读书，
// 别的三件就全被挤掉了。而读书本来该能经常读：一次只翻几小段，
// 跟「上完游戏里的一天」「走完一轮锈潮」不是一个量级。
//
// 但不能简单丢进 0 级。那一级不限件数（因为都是看一眼动态、摆一颗星这类
// 极轻的事），读书进去后他一次醒来可能连读好几轮，而每翻一小段都是
// 一次模型调用（books-steps.js 里的续步）。
//
// 所以引一个新概念：ONCE——「不计费，但一次醒来只一件」。
// 轻得不该占额度、重得不应该连玩的动作都归这里。

import fs from 'fs';
import path from 'path';

const FILE = path.join(process.cwd(), 'src', 'budget.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/budget.js。先 cd /root/vesper-phosphor。');
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

// ──── 1. 2 级去掉共读 ────

patch('2 级去掉共读', {
  done: (t) => !/books: '\u5171读'/.test(t),
  find: "  xiuchao: '\u9508\u6f6e',\n  books: '\u5171\u8bfb',\n",
  replace: "  xiuchao: '\u9508\u6f6e',\n",
});

// ──── 2. read_book 改成不计费 ────

patch('read_book 不计费', {
  done: (t) => t.includes('read_book: 0'),
  find: '  read_book: 2,',
  replace:
    '  // 读书不占次数（2026-10-19）。原本在 2 级，和上班、花园、锈潮抢一天 6 次，\n' +
    '  // 他每次都选读书，别的三件全被挤掉。读书该能经常读——一次只翻几小段。\n' +
    '  // 但它在 ONCE 里：不计费，一次醒来仍然只读一次。\n' +
    '  read_book: 0,',
});

// ──── 3. tier2KindOf 不再把读书当 2 级 ────

patch('tier2KindOf 去掉读书', {
  done: (t) => !t.includes("if (a === 'read_book') return 'books';"),
  find: "  if (a === 'read_book') return 'books';\n",
  replace: '',
});

// ──── 4. 引入 ONCE ────

patch('引入 ONCE', {
  done: (t) => t.includes('const ONCE'),
  find: 'function serverOf(detail) {',
  replace:
    '// 不计费、但一次醒来只能一件的动作。\n' +
    '//\n' +
    '// 0 级本来不限件数——因为那些都是看一眼动态、摆一颗星这类极轻的事。\n' +
    '// 读书不同：它轻得不该占额度（一次只翻几小段），却重得不应该连玩\n' +
    '//（每翻一小段都是一次模型调用，见 books-steps.js）。所以单独管一道。\n' +
    "const ONCE = new Set(['read_book']);\n\n" +
    'function serverOf(detail) {',
});

// ──── 5. pickActions 里执行 ONCE ────

patch('pickActions 执行 ONCE', {
  done: (t) => t.includes('onceDone.has(action)'),
  find:
    '  const allowed = [];\n' +
    '  const dropped = [];\n' +
    '  const taken = new Set();\n' +
    '  let remaining = tier2Remaining();',
  replace:
    '  const allowed = [];\n' +
    '  const dropped = [];\n' +
    '  const taken = new Set();\n' +
    '  const onceDone = new Set();\n' +
    '  let remaining = tier2Remaining();',
});

patch('ONCE 判重', {
  done: (t) => t.includes('这次已经读过一回了'),
  find: '    if (tier > 0 && taken.has(tier)) {',
  replace:
    '    // 不计费但一次只一件的（读书）\n' +
    '    if (ONCE.has(action)) {\n' +
    '      if (onceDone.has(action)) {\n' +
    "        dropped.push({ action, why: '\u8fd9\u6b21\u5df2\u7ecf\u8bfb\u8fc7\u4e00\u56de\u4e86\uff0c\u8bfb\u4e66\u4e0d\u5360\u6b21\u6570\u4f46\u4e00\u6b21\u9192\u6765\u53ea\u8bfb\u4e00\u6b21' });\n" +
    '        continue;\n' +
    '      }\n' +
    '      onceDone.add(action);\n' +
    '      allowed.push({ ...item, action, action_detail: detail, tier });\n' +
    '      continue;\n' +
    '    }\n' +
    '    if (tier > 0 && taken.has(tier)) {',
});

// ──── 6. 提示词：把读书从 2 级挑出来 ────

patch('提示词：0 级加读书', {
  done: (t) => t.includes('翻开共读的书读几段'),
  find: '约一个时间。想做就做。',
  replace:
    '约一个时间。想做就做。\n' +
    '- **翻开共读的书读几段也不占次数**，但一次醒来只读一回。' +
    '读书本来就是经常翻几页的事，不必挤别的。',
});

patch('提示词：2 级去掉共读', {
  done: (t) => !t.includes('锈潮、共读书架'),
  find: '上班、花园、锈潮、共读书架。这四件每件坐下来都要走好几步',
  replace: '上班、花园、锈潮。这三件每件坐下来都要走好几步',
});

patch('提示词：下面那句改成三件', {
  done: (t) => !t.includes('2 级那四件事没有'),
  find: '2 级那四件事没有「今天必须各去一次」这种规矩',
  replace: '2 级那三件事没有「今天必须各去一次」这种规矩',
});

patch('提示词：四件改三件', {
  done: (t) => !t.includes('四件都一直在那儿'),
  find: '四件都一直在那儿',
  replace: '三件都一直在那儿',
});

if (changed) {
  const bak = `${FILE}.bak-free`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/budget.js，备份在 .bak-free' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/budget.js && echo 语法 OK');
console.log('  pm2 restart phosphor --update-env');
console.log('');
console.log('想让他一次读多点（现在一次给 6 段），.env 里加一行：');
console.log('  echo "BOOKS_CHUNK=12" >> .env');
console.log('');
