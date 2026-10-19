#!/usr/bin/env node
// 补两处 wire_books_xiuchao_budget.mjs 没命中的锚点。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_two_anchors.mjs
//
// 那两处是：
//   actions/activity.js：读书的卡片不在这里写 — 锚点有 2 处，不敢改
//   vesper.js：启动日志加书架 — 找不到锚点
//
// 第一处值得补：不补的话他读书时动态里会多出一张「用了 read_book」
// 这种说不清干了什么的卡片，而 books-steps.js 已经记过一张了。
// 第二处纯日志，不影响功能，顺手补。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const report = [];
const touched = new Map();

function read(file) {
  if (touched.has(file)) return touched.get(file);
  const p = path.join(SRC, file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

// ───── 1. activity.js：读书的卡片不在这里写 ─────
//
// 原来用 "    case 'ombre_brain': {" 做锚点，但它在 describeActivity 和
// describeActivityDetail 里各出现一次。现在找 describeActivity 里独有的
// 前文：set_mode 那段的 return——它只在 describeActivity 里有。
{
  const file = 'actions/activity.js';
  const text = read(file);
  if (text == null) {
    report.push(['miss', `${file} — 文件不存在`]);
  } else if (text.includes("case 'read_book'")) {
    report.push(['skip', `${file}：读书的卡片不在这里写（已经接过）`]);
  } else {
    // describeActivity 里 set_mode 分支的结尾，紧跟着就是 default
    const anchor = /(\n\s*case 'set_mode':[\s\S]*?\n)(\s*default:\s*\n\s*return null;)/;
    const hit = anchor.exec(text);
    if (!hit) {
      report.push(['miss', `${file}：读书的卡片 — set_mode 那段也没找到，要手改`]);
    } else {
      const insert =
        `    // 读书：卡片在 books-steps.js 里写（读完几小段才记一张，不是每翻一页记一张）\n` +
        `    case 'read_book':\n      return null;\n`;
      touched.set(file, text.replace(anchor, (_, head, tail) => `${head}${insert}${tail}`));
      report.push(['ok', `${file}：读书的卡片不在这里写`]);
    }
  }
}

// ───── 2. vesper.js：启动日志加书架 ─────
//
// 服务器上那句的结尾和仓库不一样（历次 wire 脚本各自添过尾巴）。
// 改成找 app.listen 里那个模板字符串的结尾反引号，往前插。
{
  const file = 'vesper.js';
  const text = read(file);
  if (text == null) {
    report.push(['miss', `${file} — 文件不存在`]);
  } else if (text.includes('共读书架：$')) {
    report.push(['skip', `${file}：启动日志加书架（已经接过）`]);
  } else {
    // app.listen(PORT, () => console.log(`...`)) 里那个模板字符串
    const anchor = /(app\.listen\([\s\S]*?)(`\s*\n?\s*\)\s*;?)/;
    const hit = anchor.exec(text);
    if (!hit) {
      report.push(['miss', `${file}：启动日志 — app.listen 那段也没找到，跳过（纯日志，不影响功能）`]);
    } else {
      const add = "；共读书架：${books.enabled ? '/books' : '未配置（缺 BOOKS_UI_DIR）'}";
      touched.set(file, text.replace(anchor, (_, head, tail) => `${head}${add}${tail}`));
      report.push(['ok', `${file}：启动日志加书架`]);
    }
  }
}

// ───── 落盘 ─────

for (const [file, text] of touched) {
  const p = path.join(SRC, file);
  const bak = `${p}.bak-anchors`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '接好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(`改了 ${touched.size} 个文件，备份在各自的 .bak-anchors。`);
console.log('');
console.log('跑完语法自检：');
console.log('  node --check src/actions/activity.js && node --check src/vesper.js && echo 语法 OK');
console.log('然后： pm2 restart vesper phosphor --update-env');
console.log('');
