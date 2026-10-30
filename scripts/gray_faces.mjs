#!/usr/bin/env node
// 底色不再按日出日落变，全部黑白灰。
//
// 小满 2026-10-30 18:17：「底色对话也要改掉，不用早晨那套了」
//
// ── 为什么上一个灰度脚本没改到它 ──
//
// sun-time.js 里的颜色写成 [34, 27, 60] 这种数组，不是 #hex 也不是 rgb()，
// gray_all.mjs 的正则压根没命中。所以页面元素灶灰了，底色还是紫的——
// 因为底色是这套四张脸每分钟算一次再内联到 <html> 上的，优先级最高。
//
// ── 改法：不拆系统，只换颜色 ──
//
// 四张脸的结构全留着（天文计算、过渡、插值那套都不动），只是四张脸
// 现在是同一套中性灰。于是：
//   · 日出日落照旧算，但算出来的颜色一样，所以看不出变化
//   · dark 全是 false，所以 html[data-dark] 那一大堆深色覆盖永远不生效
//   · star 全是 0，夜空那层星点透明，不必删代码
// 以后想把早晨调回来，换回备份就行，代码还在。
//
// 配色按小满发的那张参考图：白底、自己的话黑气泡白字、对方的话浅灰气泡黑字。
//
// 重跑安全。备份在 src/.face-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.face-backup');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

function backup(name, text) {
  const p = join(bakDir, name);
  if (!existsSync(p)) writeFileSync(p, text, 'utf8');
}

// ════ 1. sun-time.js：四张脸换成同一套灰 ════
console.log('1/2  sun-time.js 的四张脸');

// 一套中性灰。四张脸共用，所以插值出来还是它。
// accent 是黑：它同时是标题色、按钮底色和自己气泡的底色。
const GRAY = `const NEUTRAL = {
  dark: false,
  // 底色：几乎纯白，留一点极浅的层次，完全平的白在手机上反而刺眼
  bg1: [252, 252, 252], bg2: [250, 250, 250], bg3: [247, 247, 247],
  ink: [26, 26, 26], muted: [122, 122, 122], accent: [26, 26, 26],
  gold: [122, 122, 122], card: [255, 255, 255], line: [228, 228, 228],
  // 标题原来是紫→瑰→金的文字渐变，三个停点设成同一个黑，渐变就平了
  t1: [26, 26, 26], t2: [26, 26, 26], t3: [26, 26, 26],
  activity: [184, 184, 184], 'activity-ink': [92, 92, 92], place: [122, 122, 122],
  'card-soft': [244, 244, 244], 'detail-bg': [248, 248, 248], hl: [0, 0, 0, 0.06],
  // 0 = 夜空那层星点永远透明
  star: 0,
};

// 四张脸现在是同一套。天文计算和过渡逻辑全留着，只是算出来的颜色不再分早晚。
// 小满 10-30：「底色对话也要改掉，不用早晨那套了」。
// 想调回来就把 src/.face-backup/sun-time.js 换回去，代码一行没删。
const PALETTE = {
  night: NEUTRAL,
  dawn: NEUTRAL,
  day: NEUTRAL,
  dusk: NEUTRAL,
};
`;

const stPath = join(srcDir, 'sun-time.js');
if (!existsSync(stPath)) {
  console.error('  ✗ sun-time.js 不在');
  failed++;
} else {
  const text = readFileSync(stPath, 'utf8');
  if (text.includes('const NEUTRAL = {')) {
    console.log('  · 已经是中性灰了');
  } else {
    const a = text.indexOf('const PALETTE = {');
    const b = text.indexOf('const FADE_KEYS', a);
    if (a < 0 || b < 0) {
      console.error('  ✗ 找不到 PALETTE 那一段');
      failed++;
    } else {
      backup('sun-time.js', text);
      writeFileSync(stPath, text.slice(0, a) + GRAY + '\n' + text.slice(b), 'utf8');
      console.log('  ✓ 四张脸换成同一套中性灰（dark 全 false、star 全 0）');
    }
  }
}

// ════ 2. chat-page.js：气泡按参考图 ════
console.log('');
console.log('2/2  聊天气泡');
const cpPath = join(srcDir, 'chat-page.js');
if (!existsSync(cpPath)) {
  console.error('  ✗ chat-page.js 不在');
  failed++;
} else {
  let t = readFileSync(cpPath, 'utf8');
  const before = t;
  backup('chat-page.js', t);

  // 对方的话：浅灰底、不要边框（参考图里就是这样，白底上白卡片加边框显得碎）
  const edits = [
    [
      '对方气泡改浅灰、去边框',
      '  .grp.ta .bub { background: var(--card); color: var(--ink); border: 1px solid var(--line);\n' +
      '    border-bottom-left-radius: 5px; }',
      '  .grp.ta .bub { background: #f0f0f0; color: var(--ink); border: none;\n' +
      '    border-bottom-left-radius: 5px; }'
    ],
    [
      '自己的气泡去掉投影',
      '  .bub { max-width: 70%; padding: 8px 12px; border-radius: 15px; font-size: 14px;\n' +
      '    line-height: 1.65; white-space: pre-wrap; word-break: break-word;\n' +
      '    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }',
      '  .bub { max-width: 70%; padding: 8px 12px; border-radius: 15px; font-size: 14px;\n' +
      '    line-height: 1.65; white-space: pre-wrap; word-break: break-word; }'
    ]
  ];

  for (const [label, find, repl] of edits) {
    if (t.includes(find)) {
      t = t.replace(find, repl);
      console.log('  ✓ ' + label);
    } else if (t.includes(repl)) {
      console.log('  · ' + label + '：已经是这样了');
    } else {
      console.error('  ✗ ' + label + '：找不到原文（不影响底色，已经换好了）');
    }
  }

  if (t !== before) writeFileSync(cpPath, t, 'utf8');
}

console.log('');
console.log('pm2 restart vesper --update-env');
console.log('');
console.log('早晨那套想要回来：');
console.log('  cp ' + bakDir + '/*.js ' + srcDir + '/ && pm2 restart vesper');
if (failed) process.exitCode = 1;
