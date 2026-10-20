#!/usr/bin/env node
// 行动卡片改成「同一件事才叠」。
//
// 小满 2026-10-20：「能不能把行动卡片改成相同工具的才叠在一起，不只是时间近的叠在一起」
//
// 原来的条件（moments-page.js 的 groupForDisplay）只看两件：是不是行动卡、
// 跟同一摞最新那张差不超过 STACK_WINDOW_MS。所以一次醒来里逛论坛、听歌、
// 存记忆这三张会被扑成一摞——得用左右箭头翻才知道里面有什么。
//
// 现在多一条：还要是**同一件事**。论坛跟论坛叠，听歌跟听歌叠，论坛和听歌
// 不再叠。时间窗口留着，不然早上那趟论坛和晚上那趟会并成一摞。
//
// ── 为什么从正文认，不新增一列 ──
//
// moments 表里没有工具名。要存得改建表、改 addActivityMoment、改调用它的地方，
// 而老卡片还是没有，结果仍要从正文认一遍。而 activity.js 里那套说法是写死的
// （LUTOPIA_OPS、MUSIC_OPS 两张表），认得准。所以只在显示层认：
// 数据库和写入路径一行不动，认错了最多是叠得不好看，坏不了东西。
//
// 行动卡片不花 token：addActivityMoment 就是一条 INSERT，不碰模型。
// 所以叠法怎么改都是白送的。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/stack_by_tool.mjs
//   pm2 restart vesper --update-env
//
// moments-page.js 是网页，跑在 vesper 里，不是 phosphor。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/moments-page.js');

// 从卡片正文认这是哪一件事。说法都来自 actions/activity.js，按先后顺序试。
const TAG_FN = [
  '// 这张行动卡是哪一件事（2026-10-20）。',
  '// moments 表里没存工具名，所以从正文认：activity.js 里那套说法是写死的',
  '// （LUTOPIA_OPS、MUSIC_OPS 两张表），认得准；老卡片也一样能认。',
  '// 认不出来就归 other，那些之间照旧可以叠。',
  'function activityTag(content) {',
  "  const s = String(content ?? '');",
  "  if (/Lutopia|论坛/.test(s)) return 'forum';",
  "  if (/记忆库|存入了一条记忆|OB /.test(s)) return 'memory';",
  '  if (/在听什么|搜了搜歌|点了一首歌|歌词|批注本|评论区|认真听了|歌单|网易云|点歌台/.test(s)) {',
  "    return 'music';",
  '  }',
  "  if (/共读|书架|读到第|《/.test(s)) return 'books';",
  "  if (/花园/.test(s)) return 'garden';",
  "  if (/上班|workkk/i.test(s)) return 'workkk';",
  "  if (/锈潮/.test(s)) return 'xiuchao';",
  "  if (/小酒馆|自斟|调了一杯/.test(s)) return 'proof';",
  "  if (/钱包/.test(s)) return 'wallet';",
  "  if (/星星罐|摇了摇/.test(s)) return 'jar';",
  "  if (/节律/.test(s)) return 'mode';",
  '  // 「TA 刚刚用了 X 的 Y」这种兜底写法，把 X 当成分组依据',
  '  const m = /用了 (\\S+) 的/.exec(s);',
  '  if (m) return `srv:${m[1]}`;',
  "  return 'other';",
  '}',
  '',
  '',
].join('\n');

const OLD_COND =
  "if (m.kind === 'activity' && last?.type === 'stack' && Math.abs(last.items[0].ts - m.ts) <= STACK_WINDOW_MS) {";

const NEW_COND = [
  'if (',
  "      m.kind === 'activity' &&",
  "      last?.type === 'stack' &&",
  '      // 光是时间近不够了：论坛跟论坛叠，听歌跟听歌叠，两件不同的事不再扑成一摞',
  '      activityTag(last.items[0].content) === activityTag(m.content) &&',
  '      Math.abs(last.items[0].ts - m.ts) <= STACK_WINDOW_MS',
  '    ) {',
].join('\n');

const EDITS = [
  {
    what: '加 activityTag（从正文认这是哪一件事）',
    done: 'function activityTag(',
    find: 'function groupForDisplay(moments) {',
    replacement: TAG_FN + 'function groupForDisplay(moments) {',
  },
  {
    what: '叠的条件加上「同一件事」',
    done: 'activityTag(last.items[0].content)',
    find: OLD_COND,
    replacement: NEW_COND,
    probe: "m.kind === 'activity' && last?.type",
  },
  {
    what: '摞子的说明改成「同一件事」',
    done: '同一件事的 ${n} 个行动',
    find: '同一时间的 ${n} 个行动',
    replacement: '同一件事的 ${n} 个行动',
  },
];

if (!fs.existsSync(FILE)) {
  console.error('✗ 找不到 src/moments-page.js——是不是不在 /root/vesper-phosphor 下跑的？');
  process.exit(1);
}

const bak = FILE + '.bak-stacktool';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const before = fs.readFileSync(FILE, 'utf8');
let src = before;
let changed = 0;
let skipped = 0;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log('· 已经改过，跳过：' + e.what);
    skipped += 1;
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error('\n✗ ' + e.what + '：原文出现 ' + n + ' 次，应该只有 1 次。整个文件不改。');
    console.error('  我找的是：' + e.find);
    const lines = before.split('\n');
    const probe = e.probe ?? e.find.slice(0, 30);
    const i = lines.findIndex((l) => l.includes(probe));
    if (i >= 0) {
      console.error('\n  第 ' + (i + 1) + ' 行附近实际是：');
      for (let k = Math.max(0, i - 2); k < Math.min(lines.length, i + 8); k++) {
        console.error('    ' + (k + 1) + ': ' + lines[k]);
      }
    }
    fs.writeFileSync(FILE, before, 'utf8');
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log('✓ ' + e.what);
  changed += 1;
}

if (!changed) {
  console.log('\n没有需要改的，不用重启。');
  process.exit(0);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('✓ 语法通过');
} catch (err) {
  console.error('✗ 语法不过，已还原：');
  console.error(String(err.stderr ?? err.message).slice(-800));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('\n改了 ' + changed + ' 处，跳过 ' + skipped + ' 处。');
console.log('接着：pm2 restart vesper --update-env，然后刷动态页。');
console.log('改坏了要换回来：cp ' + bak + ' ' + FILE);
