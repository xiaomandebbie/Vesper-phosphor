#!/usr/bin/env node
// 退掉我今天多写的那个台灯页。
//
// 小满 2026-10-30：「台灯页还是打不开」
//
// 日志把话说清了：
//   12:42:41  台灯页: /lamp（转发 http://127.0.0.1:3003）   ← 你原有的
//   12:49:08  lamp: 台灯页 /lamp（MCP 服务名 lamp）        ← 我今天加的
//   12:49:08  台灯页: /lamp（转发 http://127.0.0.1:3003）
//
// 台灯服务跑在本机 3003，**自带网页**，之前已经转发过去了
// （.env:182 LIGHT_MCP_URL=http://127.0.0.1:3003/lamp/mcp，那个服务既是 MCP 又是网页）。
// 我没查就又写了一个 /lamp 挂在后面——两条路由抢同一个路径，
// Express 只认先注册的，所以打不开是我这个多余页面造成的。
//
// 这个脚本把我加的那两行抿掉，你原有的转发不动。
// 发现页里台灯那一格改成直接指 /lamp（有转发就开着）。
//
// src/lamp-page.js 留在磁盘上不删：没人 import 就不跑，留着不碍事。
//
// 跑法：
//   node scripts/unwire_lamp.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function dropLines(rel, match, what) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' 找不到');
    return false;
  }
  const before = fs.readFileSync(file, 'utf8');
  const bak = file + '.bak-unlamp';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const lines = before.split('\n');
  const keep = lines.filter((l) => !match(l));
  const dropped = lines.length - keep.length;

  if (!dropped) {
    console.log('. 没找到要抿的行，跳过：' + what);
    return true;
  }

  fs.writeFileSync(file, keep.join('\n'), 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(OK + rel + ' — ' + what + '（抿了 ' + dropped + ' 行）');
    return true;
  } catch (err) {
    console.error(NO + rel + ' 语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
}

// vesper.js：抿掉 import 和挂载这两行
const a = dropLines(
  'src/vesper.js',
  (l) => l.includes("from './lamp-page.js'") || l.includes('registerLampRoutes(app'),
  '抿掉我加的 /lamp 路由'
);

// discover-page.js：抿掉 lampEnabled 的 import
const b = a
  ? dropLines(
      'src/discover-page.js',
      (l) => l.includes("lampEnabled } from './lamp-page.js'"),
      '抿掉 lampEnabled 的 import'
    )
  : false;

// 发现页里台灯那一格：改成直接指 /lamp
let c = true;
if (b) {
  const file = path.join(ROOT, 'src/discover-page.js');
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes("href: '/lamp',")) {
    console.log('. 已经指 /lamp 了，跳过');
  } else {
    const lines = src.split('\n');
    const hits = [];
    lines.forEach((l, i) => {
      if (l.includes("lampEnabled() ? '/lamp'")) hits.push(i);
    });
    if (hits.length !== 1) {
      console.error(NO + "含 lampEnabled() ? '/lamp' 的行有 " + hits.length + ' 条，应该只有 1 条');
      for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
      c = false;
    } else {
      const i = hits[0];
      const ind = (lines[i].match(/^\s*/) || [''])[0];
      lines.splice(
        i,
        1,
        ind + '// 台灯服务自带网页，/lamp 已经转发到 127.0.0.1:3003（2026-10-30）',
        ind + "href: '/lamp',"
      );
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(OK + 'src/discover-page.js — 台灯那一格直接指 /lamp');
      } catch (err) {
        console.error(NO + '语法不过，已还原：');
        console.error(String(err.stderr || err.message).slice(-500));
        fs.writeFileSync(file, src, 'utf8');
        c = false;
      }
    }
  }
}

console.log('');
if (a && b && c) {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('然后 /lamp 应该就是你原有的那个台灯网页了。');
  console.log('日志里应该只剩一行台灯：');
  console.log('  pm2 logs vesper --lines 20 --nostream | grep -i 台灯');
} else {
  console.log('有没成的（上面打了实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
