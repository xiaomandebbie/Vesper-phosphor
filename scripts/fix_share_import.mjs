#!/usr/bin/env node
// 分享那一步报 askShare is not defined。
//
// 是我自己写坏的：wire_share_after_actions.mjs 里的 addImport 先判
//   if (/askShare/.test(src)) return { already: true }
// 但那时候 SHARE_STEP 刚插进文件，里面正好有 askShare 这个词——
// 于是它以为 import 已经有了，直接跳过。顺序错了。
// grep -c askShare src/phosphor.js 返回 1（只有调用处）就是这个原因。
//
// 这版只看 import 那一段里有没有，不看全文。支持跨行的 import。
//
// 顺带改掉消遣那一步末尾那句劝退话：
//   「一件都不做很正常，刚才那些已经够了。」
// 他本来就倾向于省着来，我又在最后推了一把。改成中性的。
//
// 跑法：
//   node scripts/fix_share_import.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function check(file, before) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error(NO + file + ' syntax error, reverted:');
    console.error(String(err.stderr || err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
}

// ── 1. phosphor.js 的 import ──
function fixImport() {
  const file = path.join(ROOT, 'src/phosphor.js');
  if (!fs.existsSync(file)) {
    console.error(NO + 'src/phosphor.js not found');
    return false;
  }
  const before = fs.readFileSync(file, 'utf8');
  const bak = file + '.bak-shareimport';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  // 跨行也能匹配
  const re = /import\s*\{([\s\S]*?)\}\s*from\s*'\.\/decide\.js';/;
  const m = re.exec(before);
  if (!m) {
    console.error(NO + "import ... from './decide.js' not found in phosphor.js");
    return false;
  }
  if (/\baskShare\b/.test(m[1])) {
    console.log('. import already has askShare, skip');
    return true;
  }
  const names = m[1].trim().replace(/,$/, '');
  const src = before.replace(re, 'import { ' + names + ", askShare } from './decide.js';");
  fs.writeFileSync(file, src, 'utf8');
  if (!check(file, before)) return false;
  console.log(OK + 'phosphor.js: import \u5e26\u4e0a askShare');
  return true;
}

// ── 2. decide.js 里那句劝退话 ──
function fixTail() {
  const file = path.join(ROOT, 'src/decide.js');
  if (!fs.existsSync(file)) {
    console.error(NO + 'src/decide.js not found');
    return false;
  }
  const before = fs.readFileSync(file, 'utf8');
  const bak = file + '.bak-shareimport';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  // 「一件都不做很正常，刚才那些已经够了。」
  const old =
    '\u4e00\u4ef6\u90fd\u4e0d\u505a\u5f88\u6b63\u5e38\uff0c\u521a\u624d\u90a3\u4e9b\u5df2\u7ecf\u591f\u4e86\u3002';
  // 「想做哪件就做哪件，做与不做都行，按你此刻真想做的来。」
  const neo =
    '\u60f3\u505a\u54ea\u4ef6\u5c31\u505a\u54ea\u4ef6\uff0c\u505a\u4e0e\u4e0d\u505a\u90fd\u884c\uff0c\u6309\u4f60\u6b64\u523b\u771f\u60f3\u505a\u7684\u6765\u3002';

  if (before.includes(neo)) {
    console.log('. play tail already neutral, skip');
    return true;
  }
  const n = before.split(old).length - 1;
  if (n !== 1) {
    console.error(NO + 'play tail: found ' + n + ' times, expected 1. not changed');
    return false;
  }
  const src = before.replace(old, neo);
  fs.writeFileSync(file, src, 'utf8');
  if (!check(file, before)) return false;
  console.log(OK + 'decide.js: \u6d88\u9063\u672b\u5c3e\u6539\u6210\u4e2d\u6027');
  return true;
}

const a = fixImport();
const b = fixTail();

console.log('');
if (a && b) {
  console.log('pm2 restart phosphor --update-env');
  console.log('');
  console.log('\u7b49\u4ed6\u9192\u4e00\u6b21\uff0c\u7136\u540e\u8fd9\u4e24\u6761\uff1a');
  console.log('  pm2 logs phosphor --lines 200 --nostream | grep -E "\u5206\u4eab|\u6d88\u9063"');
  console.log('  pm2 logs phosphor --lines 200 --nostream | grep -E "\u6ca1\u53d1\u51fa\u53bb|\u7ea7\u7684\u4e8b|\u7528\u5b8c\u4e86|dropped"');
  console.log('\u7b2c\u4e8c\u6761\u770b\u6d88\u9063\u90a3\u4ef6\u4e3a\u4ec0\u4e48\u88ab\u6324\u6389\u4e86\u3002');
} else {
  process.exitCode = 1;
}
