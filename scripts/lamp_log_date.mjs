#!/usr/bin/env node
// 小满 2026-10-30：「记录要写日期」
//
// 「最近谁动过灯」那张表在台灯服务自己的项目里（/root/Vesper-light），
// 不在晨暮星这边。这个脚本跑在晨暮星目录里，改旁边那个项目的文件。
//
// ── 为什么原来没日期 ──
//
// 数据本来就是跳天的：page.js 用的是 recentLogs(12)，按 ts 倒序取12 条，
// 跟「今天」没关系（store.js 里那个 todayLogs 这一页根本没用）。
// 是渲染时 formatTime(r.ts) 只给时分，把日期丢了。
// 所以这是个显示问题，不用改查询。
//
// ── 改法 ──
//
// 1) 时间那一格变两行：上面暗色小字的日期，下面原来的时分。
//    日期从 formatDateTime 里切——不自己算，因为服务器时区和 clock.js
//    里的时区处理可能不一致，自己算会算出差一天的日期。
// 2) 12 条改 30 条。既然现在看得见日期，12 条常常连两天都盖不满。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 第一个参数可以自己指路径，不给就找旁边的 Vesper-light
const target = process.argv[2]
  ? resolve(process.cwd(), process.argv[2])
  : resolve(root, '../Vesper-light/src/page.js');

if (!existsSync(target)) {
  console.error(`\u2717 \u627e\u4e0d\u5230\uff1a${target}`);
  console.error('  \u53f0\u706f\u9875\u7684\u6587\u4ef6\u5728\u522b\u5904\u7684\u8bdd\uff0c\u628a\u8def\u5f84\u5f53\u53c2\u6570\u4f20\u7ed9\u6211\uff1a');
  console.error('  node scripts/lamp_log_date.mjs /\u4f60/\u7684/page.js');
  process.exit(1);
}

let text = readFileSync(target, 'utf8');
const before = text;
let failed = 0;

function apply(label, find, replacement) {
  if (!text.includes(find)) {
    if (text.includes(replacement)) {
      console.log(`\u00b7 ${label}\uff1a\u5df2\u7ecf\u662f\u8fd9\u6837\u4e86`);
    } else {
      console.error(`\u2717 ${label}\uff1a\u627e\u4e0d\u5230\u539f\u6587`);
      failed++;
    }
    return;
  }
  text = text.replace(find, replacement);
  console.log(`\u2713 ${label}`);
}

// ── 1. 插个取日期的小函数 ──
//
// formatDateTime 给的是「日期 + 空格 + 时分」，所以按最后一个空格切开就是日期。
// 这样无论 clock.js 用的是哪种格式、哪个时区，这儿都跟它一致。
apply(
  '\u52a0 dayOf \u5c0f\u51fd\u6570',
  '  const logRows = logs',
  `  // \u4ece formatDateTime \u91cc\u5207\u51fa\u65e5\u671f\u90a3\u4e00\u6bb5\uff08\u4e0d\u81ea\u5df1\u7b97\uff0c\u514d\u5f97\u65f6\u533a\u5bf9\u4e0d\u4e0a\uff09
  const dayOf = (ts) => {
    const s = String(formatDateTime(ts));
    const i = s.lastIndexOf(' ');
    return i > 0 ? s.slice(0, i) : s;
  };

  const logRows = logs`
);

// ── 2. 时间那格补上日期 ──
apply(
  '\u8bb0\u5f55\u884c\u5199\u65e5\u671f',
  '<td class="t">${formatTime(r.ts)}</td>',
  '<td class="t"><div class="dim" style="font-size:11px;font-weight:400">${esc(dayOf(r.ts))}</div>${formatTime(r.ts)}</td>'
);

// ── 3. 12 条 → 30 条 ──
apply('\u591a\u7559\u51e0\u6761\uff0812 \u2192 30\uff09', 'logs: recentLogs(12),', 'logs: recentLogs(30),');

if (text !== before) {
  writeFileSync(target, text, 'utf8');
  console.log(`\n\u5199\u4e86 ${target}`);
} else {
  console.log('\n\u6ca1\u6539\u52a8\u4efb\u4f55\u4e1c\u897f\u3002');
}
if (failed) {
  console.error(`\u5931\u8d25 ${failed} \u5904\uff0c\u4e0a\u9762\u6709\u8bf4\u662f\u54ea\u4e00\u6761\u3002`);
  process.exitCode = 1;
}
