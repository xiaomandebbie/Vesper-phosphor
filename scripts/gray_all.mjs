#!/usr/bin/env node
// 两件。
//
// 小满 2026-10-30 18:04：「美化色彩全部去掉，用最朴素的黑白灰」
// 小满 18:03：「第二次触发还是发送键」「下面消息我都翻不到了」
//
// ── 1. 黑白灰 ──
//
// 不手写调色盘。做法是把所有颜色按「感知亮度」换成同亮度的灰：
// 亮度用 Rec.709 权重（0.2126R + 0.7152G + 0.0722B）。这样对比关系
// 一模一样，深的还是深、浅的还是浅，只是没了色相。自己编一套灰
// 很容易把对比弄坏（文字和底色撞在一起）。
//
// 覆盖 #rgb / #rrggbb / #rrggbbaa / rgb() / rgba()。
// 改之前全部备份到 src/.color-backup/，回滚指令在末尾打印。
// 这很重要：这些文件大多是本地改过没进仓库的，git 捡不回来。
//
// ── 2. 聊天页底部重叠 ──
//
// 截图里「让允朔读」压在气泡和输入框之间：它底边在 118px，
// 输入框顶边大约 122px，几乎贴着——点它下半部就打到发送键了。
// 而 main 的 padding-bottom 也不够，最后几条消息被那三层盖住。
// 把按钮抬高、底部留足。
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.color-backup');

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
// Rec.709：绿贡献最大，蓝最小——和眼睛的感受一致
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function grayHex(r, g, b) {
  const v = hex2(lum(r, g, b));
  return '#' + v + v + v;
}

function convert(text) {
  let n = 0;
  let out = text;

  // #rrggbbaa / #rrggbb
  out = out.replace(/#([0-9a-fA-F]{8}|[0-9a-fA-F]{6})\b/g, (m, body) => {
    const r = parseInt(body.slice(0, 2), 16);
    const g = parseInt(body.slice(2, 4), 16);
    const b = parseInt(body.slice(4, 6), 16);
    const a = body.length === 8 ? body.slice(6, 8) : '';
    n++;
    return grayHex(r, g, b) + a;
  });

  // #rgb（别误伤已经换好的长形式，所以要求后面不跟十六进制位）
  out = out.replace(/#([0-9a-fA-F]{3})(?![0-9a-fA-F])/g, (m, body) => {
    const r = parseInt(body[0] + body[0], 16);
    const g = parseInt(body[1] + body[1], 16);
    const b = parseInt(body[2] + body[2], 16);
    n++;
    return grayHex(r, g, b);
  });

  // rgb() / rgba()：百分比形式不动，这儿只管数字
  out = out.replace(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/g,
    (m, r, g, b, a) => {
      const v = Math.round(lum(+r, +g, +b));
      n++;
      return a === undefined ? 'rgb(' + v + ', ' + v + ', ' + v + ')'
                             : 'rgba(' + v + ', ' + v + ', ' + v + ', ' + a + ')';
    }
  );

  return { out, n };
}

// ════ 1. 灶成灰 ════
console.log('1/2  配色换成黑白灰');
if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

let files = 0;
let colors = 0;
for (const name of readdirSync(srcDir)) {
  if (!name.endsWith('.js')) continue;
  const p = join(srcDir, name);
  const text = readFileSync(p, 'utf8');
  const { out, n } = convert(text);
  if (!n || out === text) continue;
  // 备份只写一次：重跑时不要把已经灶灰的版本当成「原色」覆盖掉
  const bak = join(bakDir, name);
  if (!existsSync(bak)) writeFileSync(bak, text, 'utf8');
  writeFileSync(p, out, 'utf8');
  files++;
  colors += n;
  console.log('  ✓ ' + name + '（' + n + ' 处）');
}
console.log('  共 ' + files + ' 个文件、' + colors + ' 处颜色');

// ════ 2. 聊天页底部 ════
console.log('');
console.log('2/2  聊天页底部重叠');
const cpPath = join(srcDir, 'chat-page.js');
let failed = 0;
if (!existsSync(cpPath)) {
  console.error('  ✗ chat-page.js 不在');
  failed++;
} else {
  let t = readFileSync(cpPath, 'utf8');
  const before = t;

  const edits = [
    [
      '按钮抬高到 170px',
      "    bottom: calc(118px + env(safe-area-inset-bottom, 0px)); display: none;",
      "    bottom: calc(170px + env(safe-area-inset-bottom, 0px)); display: none;"
    ],
    [
      '底部留足（190 → 260）',
      'body.vp-has-tabs main { padding-bottom: calc(190px + env(safe-area-inset-bottom, 0px)) !important; }',
      'body.vp-has-tabs main { padding-bottom: calc(260px + env(safe-area-inset-bottom, 0px)) !important; }'
    ],
    [
      '提示条也跟着抬',
      '    bottom: calc(160px + env(safe-area-inset-bottom, 0px)); z-index: 96;',
      '    bottom: calc(212px + env(safe-area-inset-bottom, 0px)); z-index: 96;'
    ]
  ];

  for (const [label, find, repl] of edits) {
    if (t.includes(find)) {
      t = t.replace(find, repl);
      console.log('  ✓ ' + label);
    } else if (t.includes(repl)) {
      console.log('  · ' + label + '：已经是这样了');
    } else {
      console.error('  ✗ ' + label + '：找不到原文');
      failed++;
    }
  }

  if (t !== before) writeFileSync(cpPath, t, 'utf8');
}

console.log('');
if (failed) {
  console.error('底部那几处失败 ' + failed + ' 个（颜色已经换完）。');
  process.exitCode = 1;
}
console.log('pm2 restart vesper --update-env');
console.log('');
console.log('颜色想换回来：');
console.log('  cp ' + bakDir + '/*.js ' + srcDir + '/ && pm2 restart vesper');
console.log('');
console.log('注：灰度是按感知亮度换的，所以深浅关系和原来一样。');
console.log('头像、配图这些真实图片不受影响，还是彩色的。');
