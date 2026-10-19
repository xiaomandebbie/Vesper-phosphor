#!/usr/bin/env node
// 把 scripts/recap-parts/patches.txt 里的补丁打到 src/ 下的三个文件上。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/apply_recap.mjs          ← 先看会改什么，不写文件
//   node scripts/apply_recap.mjs --write  ← 真的写进去
//
// 幂等：每条补丁先看替换后的文字在不在，在就跳过。
//
// ── 为什么要分成两个文件 ──
//
// 前面四个补丁脚本连着栽在同一处，每次都是语法错：
//   · console.error 的字符串里夹了真换行
//   · 弯引号裸写成对象键
//   · 含反引号模板的字符串塞进单引号里拼接
//
// 每一次都不是逻辑难，是我用字符串拼接生成代码——单引号套双引号套反引号
// 再加转义，层数一多就出错，而且我推上去之前没法运行它。
//
// 所以分开：要注入的代码是 patches.txt 里的字面文本，这个脚本只做读取和
// 替换，本身一行被注入的代码都没有，没有引号层级可以弄错。

import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const PATCHES = path.join(ROOT, 'scripts', 'recap-parts', 'patches.txt');
const WRITE = process.argv.includes('--write');

const TARGETS = {
  books: path.join(ROOT, 'src', 'books.js'),
  steps: path.join(ROOT, 'src', 'books-steps.js'),
  page: path.join(ROOT, 'src', 'books-page.js'),
};

if (!fs.existsSync(PATCHES)) {
  console.error('没找到 ' + PATCHES);
  console.error('先 git pull 把 scripts/recap-parts/patches.txt 拉下来。');
  process.exit(1);
}

// ── 解析 patches.txt ──
//
// <<<PATCH <目标> <说明>
// <<<FIND
// …
// <<<REPLACE
// …
// <<<END
//
// 块外面的 # 开头行和空行忽略；块里面的一律当代码（代码里也有 # 开头的 SQL 注释）。

function parsePatches(raw) {
  const lines = raw.split('\n');
  const out = [];
  let cur = null;
  let mode = null; // 'find' | 'replace'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();

    if (t.startsWith('<<<PATCH ')) {
      if (cur) throw new Error('第 ' + (i + 1) + ' 行：上一个块没有 <<<END');
      const rest = t.slice('<<<PATCH '.length).trim();
      const sp = rest.indexOf(' ');
      if (sp < 0) throw new Error('第 ' + (i + 1) + ' 行：<<<PATCH 后面要有目标和说明');
      cur = { target: rest.slice(0, sp), label: rest.slice(sp + 1).trim(), find: [], replace: [] };
      mode = null;
      continue;
    }

    if (t === '<<<FIND') {
      if (!cur) throw new Error('第 ' + (i + 1) + ' 行：<<<FIND 不在块里');
      mode = 'find';
      continue;
    }

    if (t === '<<<REPLACE') {
      if (!cur) throw new Error('第 ' + (i + 1) + ' 行：<<<REPLACE 不在块里');
      mode = 'replace';
      continue;
    }

    if (t === '<<<END') {
      if (!cur) throw new Error('第 ' + (i + 1) + ' 行：<<<END 不在块里');
      out.push({
        target: cur.target,
        label: cur.label,
        find: cur.find.join('\n'),
        replace: cur.replace.join('\n'),
      });
      cur = null;
      mode = null;
      continue;
    }

    if (!cur || !mode) {
      // 块外面：只允许注释和空行
      if (t && !t.startsWith('#')) {
        throw new Error('第 ' + (i + 1) + ' 行在块外面，不认识：' + t.slice(0, 40));
      }
      continue;
    }

    cur[mode].push(line);
  }

  if (cur) throw new Error('文件末尾还有块没闭合');
  return out;
}

let patches;
try {
  patches = parsePatches(fs.readFileSync(PATCHES, 'utf8'));
} catch (err) {
  console.error('patches.txt 读不动：' + err.message);
  process.exit(1);
}

// ── 按目标分组打上去 ──

const text = {};
for (const [k, p] of Object.entries(TARGETS)) {
  text[k] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const report = [];
const touched = new Set();
let failed = 0;

for (const p of patches) {
  if (!Object.prototype.hasOwnProperty.call(TARGETS, p.target)) {
    report.push(['miss', p.label + ' — 不认识的目标 ' + p.target]);
    failed++;
    continue;
  }
  const cur = text[p.target];
  if (cur == null) {
    report.push(['miss', p.label + ' — ' + p.target + ' 文件不在']);
    failed++;
    continue;
  }
  if (!p.find) {
    report.push(['miss', p.label + ' — FIND 是空的']);
    failed++;
    continue;
  }
  if (cur.includes(p.replace)) {
    report.push(['skip', p.label]);
    continue;
  }
  const n = cur.split(p.find).length - 1;
  if (n === 0) {
    report.push(['miss', p.label + ' — 找不到锚点']);
    failed++;
    continue;
  }
  if (n > 1) {
    report.push(['miss', p.label + ' — 锚点有 ' + n + ' 处，不敢改']);
    failed++;
    continue;
  }
  text[p.target] = cur.replace(p.find, p.replace);
  touched.add(p.target);
  report.push(['ok', p.label]);
}

console.log('');
console.log('共 ' + patches.length + ' 条补丁：');
for (const [kind, msg] of report) {
  const tag = kind === 'ok' ? '可以改' : kind === 'skip' ? '已经有' : '没命中';
  console.log('  ' + tag + '  ' + msg);
}
console.log('');

if (failed) {
  console.error('有 ' + failed + ' 条没命中，一个字都不写。');
  console.error('把上面那几行贴回来，我按服务器上的实际文本改锚点。');
  process.exit(1);
}

if (!touched.size) {
  console.log('所有补丁都已经在位上了，文件没动。');
  console.log('');
  process.exit(0);
}

if (!WRITE) {
  console.log('这是试算，文件没动。全部命中了，真写：');
  console.log('  node scripts/apply_recap.mjs --write');
  console.log('');
  process.exit(0);
}

for (const key of touched) {
  const p = TARGETS[key];
  const bak = p + '.bak-recap';
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text[key], 'utf8');
}

console.log('已写回：' + [...touched].join('、') + '，改前那份备在 .bak-recap');
console.log('');
console.log('接下来：');
console.log("  sed -i 's/^BOOKS_CHUNK=.*/BOOKS_CHUNK=15/' .env");
console.log('  node --check src/books.js && node --check src/books-steps.js && node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
console.log('前情是读完一次才写的，所以他下次读书时还没有；再下一次就接得上了。');
console.log('');
