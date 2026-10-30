#!/usr/bin/env node
// 两件事。
//
// 小满 2026-10-30：
//   「音乐小圆圈不常驻，只有打开音乐时候退回其他页面才出现」
//   「动态不再包含动作卡片」
//
// 第一版这个脚本自己有语法错：我在一个字符串字面量中间塞了真的换行
// （第 114 行）。这版改成一行写完，不插换行。
//
// ── 一、小圆圈 ──
//
// 先说清一件：那个圆圈不在各个页面上，而在**外壳页 /app** 里（shell.js）。
// 你在动态页截图里看到它，是因为当时在 /app#/moments——动态页跑在 iframe 里，
// 圆圈悬在外壳那一层。
//
// 现在的行为：#mini 带着 class="empty" 写在 HTML 里，所以进外壳就挂着一个 ♪。
// 改成：默认 closed（不显示），打开过播放器之后才出来。
// 这样「打开音乐 → 退回其他页面」才有它，没碰过音乐就干净。
//
// 点 × 关掉仍然是 closed；又开始放歌时它回来那条逻辑留着
// （点歌台递过来一首歌，圆圈该出现）。
//
// ── 二、动态去掉行动卡片 ──
//
// 行动卡片现在在聊天页（/chat/<id>）。动态页只留人写的那些。
// 改一处就够：groupForDisplay 里把 kind='activity' 的滤掉。
// 渲染函数（renderActivityCard、activityTag、那堆 CSS）都留着不动：
// 改得越少越安全，而且收藏页、按日期查那几条路可能还调它们。
//
// 跑法：
//   node scripts/mini_not_always.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function patch(rel, steps) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' 找不到');
    return false;
  }
  const bak = file + '.bak-mini';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let lines = before.split('\n');
  let changed = 0;
  let failed = false;

  const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

  for (const s of steps) {
    if (lines.some((l) => l.includes(s.done))) {
      console.log('. 已经改过，跳过：' + s.what);
      continue;
    }
    const hits = [];
    lines.forEach((l, i) => {
      if (l.includes(s.needle)) hits.push(i);
    });
    if (hits.length !== 1) {
      console.error('');
      console.error(NO + rel + ' — ' + s.what + '：含「' + s.needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条');
      for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
      failed = true;
      break;
    }
    const i = hits[0];
    const out = s.make(lines[i], indentOf(lines[i]));
    lines.splice(i, 1, ...(Array.isArray(out) ? out : [out]));
    console.log(OK + rel + ' — ' + s.what);
    changed += 1;
  }

  if (failed) {
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  if (!changed) return true;

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(OK + '语法通过：' + rel);
  } catch (err) {
    console.error(NO + rel + ' 语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-700));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  return true;
}

// ── shell.js：圆圈默认不显示 ──
// 两处都是单行替换，不插换行——第一版就是在这儿塞了个真换行才挂的。
const SHELL = [
  {
    what: '圆圈默认 closed（没碰过音乐就不出现）',
    done: 'class="empty closed"',
    needle: '<div id="mini" class="empty" role="region"',
    make: (line) => line.replace('class="empty"', 'class="empty closed"'),
  },
  {
    what: '打开过播放器之后圆圈才出来',
    done: "add('player-open'); mini.classList.remove('closed');",
    needle: "document.body.classList.add('player-open'); }",
    make: (line) =>
      line.replace(
        "document.body.classList.add('player-open'); }",
        "document.body.classList.add('player-open'); mini.classList.remove('closed'); }"
      ),
  },
];

// ── moments-page.js：动态不再摆行动卡片 ──
const MOMENTS = [
  {
    what: '动态列表过滤掉 activity',
    done: "m.kind !== 'activity'",
    needle: 'function groupForDisplay(moments) {',
    make: (line, ind) => [
      line,
      ind + '  // 行动卡片摆在聊天页了（2026-10-30），动态只留人写的那些。',
      ind + '  // 渲染函数和样式都留着不动：收藏页和按日期查那几条路可能还调它们。',
      ind + "  moments = (moments || []).filter((m) => m.kind !== 'activity');",
    ],
  },
];

const a = patch('src/shell.js', SHELL);
const b = patch('src/moments-page.js', MOMENTS);

console.log('');
if (a && b) {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('然后：');
  console.log('  · 进 /app 没碰音乐时不应该有那个 ♪ 圆圈');
  console.log('  · 打开音乐再退回来，圆圈出现');
  console.log('  · /moments 里不再有行动卡片，它们在 /chat');
} else {
  console.log('有没成的（上面打了那处的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
