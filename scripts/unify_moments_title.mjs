#!/usr/bin/env node
// 把动态页顶上那块换成和日记、梦境、心绪一样的标题：跳星星 + 晨暮星 + 「Moments ✦ 动态」。
//
// 为什么是脚本而不是直接改文件：moments-page.js 有 46KB、一千多行，整个读进改再写回容易在路上断，
// 所以改成只按锟点换两处。跟 wire_dreams.mjs 那几个是一个路子。
//
// 改两处：
//   1. <header class="hero">…</header> → renderPageTitle('Moments', '动态')
//      原来里面的 Vesper✨Phosphor、「TA此刻」、唤醒时间已经搬到主页（home-page.js）了，这边不再留一份。
//   2. 把 PAGE_TITLE_CSS 插进 <style>（星星那一行和副标的排版）。
//      注意：动态页是 ${STYLE}${MY_MOMENTS_CSS}${CHROME_CSS}，中间多一段，和日记、梦境那两页不同。
//      所以锟点只认 ${CHROME_CSS}</style>，插在它前面 —— 这样不管中间多几段都能对上，
//      而且 PAGE_TITLE_CSS 排在 CHROME_CSS 前面，让早晚四张脸那层仍然盖在最后。
//      不动 STYLE 里的原文，它里面写死的 .title 留着当没 JavaScript 时的底。
//
// 用法（在仓库根目录里）：
//   node scripts/unify_moments_title.mjs --check   只看要改哪几处，不写
//   node scripts/unify_moments_title.mjs           真改，先存一份 .bak
//
// 跑过一遍之后再跑不会重复改（已经是改好的样子就直接说「已经改过了」）。

import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/moments-page.js');
const check = process.argv.includes('--check');

const IMPORT_LINE = "import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';";
// 挂在 page-chrome 那行 import 后面
const CHROME_IMPORT_RE = /^import \{[^}]*\} from '\.\/page-chrome\.js';$/m;
const HERO_RE = /<header class="hero">[\s\S]*?<\/header>/;
// 只认最后这一段，不管前面拼了几段 CSS
const STYLE_ANCHOR = '${CHROME_CSS}</style>';
const STYLE_ANCHOR_NEW = '${PAGE_TITLE_CSS}${CHROME_CSS}</style>';
const HERO_NEW = "${renderPageTitle('Moments', '\u52a8\u6001')}";

const countOf = (s, needle) => s.split(needle).length - 1;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`\u8bfb\u4e0d\u5230 ${FILE}\uff1a${err.message}`);
  console.error('\u8981\u5728\u4ed3\u5e93\u6839\u76ee\u5f55\u91cc\u8dd1\u8fd9\u4e2a\u811a\u672c\u3002');
  process.exit(1);
}

if (!fs.existsSync(path.resolve('src/page-title.js'))) {
  console.error('\u5c11\u4e86 src/page-title.js\u3002\u5148 git pull \u628a\u5171\u7528\u6807\u9898\u90a3\u4e2a\u6587\u4ef6\u62c9\u4e0b\u6765\u3002');
  process.exit(1);
}

const steps = [];
let out = src;

// 1. import
if (out.includes(IMPORT_LINE)) {
  steps.push(['skip', 'import \u5df2\u7ecf\u6709\u4e86']);
} else {
  const m = CHROME_IMPORT_RE.exec(out);
  if (!m) {
    console.error('\u627e\u4e0d\u5230 page-chrome.js \u7684 import \u90a3\u4e00\u884c\uff0c\u4e0d\u6562\u6539\u3002');
    process.exit(2);
  }
  out = out.slice(0, m.index + m[0].length) + '\n' + IMPORT_LINE + out.slice(m.index + m[0].length);
  steps.push(['edit', 'import \u52a0\u5728 page-chrome \u90a3\u884c\u540e\u9762']);
}

// 2. hero
if (out.includes(HERO_NEW)) {
  steps.push(['skip', '\u6807\u9898\u5df2\u7ecf\u662f\u5171\u7528\u7684\u90a3\u5957']);
} else {
  const n = countOf(out, '<header class="hero">');
  if (n !== 1) {
    console.error(`<header class="hero"> \u627e\u5230 ${n} \u5904\uff08\u6307\u671b 1 \u5904\uff09\uff0c\u505c\u4e86\u3002`);
    process.exit(2);
  }
  const m = HERO_RE.exec(out);
  out = out.slice(0, m.index) + HERO_NEW + out.slice(m.index + m[0].length);
  steps.push(['edit', `\u6807\u9898\u5757\u6362\u6210 renderPageTitle\uff08\u539f\u6765 ${m[0].length} \u5b57\uff09`]);
}

// 3. style
if (out.includes('PAGE_TITLE_CSS}')) {
  steps.push(['skip', 'PAGE_TITLE_CSS \u5df2\u7ecf\u63d2\u8fc7\u4e86']);
} else {
  const n = countOf(out, STYLE_ANCHOR);
  if (n !== 1) {
    console.error(`\u951f\u70b9 ${STYLE_ANCHOR} \u627e\u5230 ${n} \u5904\uff08\u6307\u671b 1 \u5904\uff09\uff0c\u4e0d\u6562\u6539\u3002`);
    process.exit(2);
  }
  out = out.replace(STYLE_ANCHOR, STYLE_ANCHOR_NEW);
  steps.push(['edit', 'PAGE_TITLE_CSS \u63d2\u5728 CHROME_CSS \u524d\u9762']);
}

for (const [kind, text] of steps) {
  console.log(`${kind === 'edit' ? '\u8981\u6539' : '\u4e0d\u52a8'}\uff1a${text}`);
}

if (!steps.some(([k]) => k === 'edit')) {
  console.log('\u5df2\u7ecf\u6539\u8fc7\u4e86\uff0c\u6ca1\u4e8b\u5e72\u3002');
  process.exit(0);
}

if (check) {
  console.log('\n--check\uff0c\u6ca1\u5199\u3002\u53bb\u6389 --check \u518d\u8dd1\u4e00\u6b21\u5c31\u771f\u6539\u3002');
  process.exit(0);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, out);
console.log(`\n\u5199\u5b8c\u4e86\u3002\u539f\u6587\u5907\u4efd\u5728 ${path.basename(FILE)}.bak`);
console.log('\u63a5\u4e0b\u6765\uff1anode --check src/moments-page.js \u770b\u8bed\u6cd5\uff0c\u518d pm2 restart vesper\u3002');
