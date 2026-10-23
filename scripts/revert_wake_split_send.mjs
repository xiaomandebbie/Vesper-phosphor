#!/usr/bin/env node
// 撕掉「一段一条投」，换回整段一次投。
//
// 小满 2026-10-23：「不要变成好几次发，不然时间戳很丑，让他记得分段就好了…」
//
// 图里说清楚了：
//   21:46 那组——三个气泡，下面只一个时间戳。那是**一条**带换行的消息，
//           Aru 自己把它拆成了气泡。
//   21:56 那三条——每条各带一个时间戳。那是我让 bark 分三次投的结果。
//
// 所以拆投是多余的，而且比不拆更难看。分段这事 Aru 那边本来就做了，
// 我只要让他写的时候记得换行就行。
//
// 所以：
//   bark.js   换回 split_wake_message.mjs 打之前的样子（整段一次 submitWakeEvent）
//   decide.js 里的分段要求**留着**（add_bark_segment_rule.mjs 那一步）
//
// 跑法：
//   node scripts/revert_wake_split_send.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const BARK = path.join(ROOT, 'src/actions/bark.js');
const BAK = BARK + '.bak-wakeseg';
const DECIDE = path.join(ROOT, 'src/decide.js');

const cur = fs.existsSync(BARK) ? fs.readFileSync(BARK, 'utf8') : '';
if (!cur) {
  console.error('\u2717 src/actions/bark.js \u627e\u4e0d\u5230');
  process.exit(1);
}

if (!cur.includes('splitSegments')) {
  console.log('. bark.js \u672c\u6765\u5c31\u662f\u6574\u6bb5\u4e00\u6b21\u6295\uff0c\u4e0d\u7528\u6539');
} else {
  if (!fs.existsSync(BAK)) {
    console.error('\u2717 \u627e\u4e0d\u5230\u5907\u4efd ' + BAK);
    console.error('  \u90a3\u5c31\u4e0d\u81ea\u52a8\u6539\u4e86\uff0c\u7ed9\u6211\u770b\u4e00\u773c\uff1a');
    console.error('  grep -n "submitWakeEvent\\|splitSegments" src/actions/bark.js');
    process.exit(1);
  }
  const old = fs.readFileSync(BAK, 'utf8');
  // 备份里不该有 splitSegments——有就说明备错了时机，不敢用
  if (old.includes('splitSegments')) {
    console.error('\u2717 \u5907\u4efd\u91cc\u4e5f\u6709 splitSegments\uff0c\u4e0d\u6562\u7528\u3002\u6587\u4ef6\u4e0d\u6539\u3002');
    process.exit(1);
  }
  if (!old.includes('submitWakeEvent(message)')) {
    console.error('\u2717 \u5907\u4efd\u91cc\u6ca1\u6709 submitWakeEvent(message)\uff0c\u5f62\u72b6\u4e0d\u5bf9\u3002\u6587\u4ef6\u4e0d\u6539\u3002');
    process.exit(1);
  }
  // 改之前再存一份当前的，万一还想看
  const keep = BARK + '.bak-splitsend';
  if (!fs.existsSync(keep)) fs.copyFileSync(BARK, keep);
  fs.writeFileSync(BARK, old, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', BARK], { stdio: 'pipe' });
    console.log('\u2713 bark.js \u6362\u56de\u6574\u6bb5\u4e00\u6b21\u6295');
  } catch (err) {
    console.error('\u2717 \u6362\u56de\u4e4b\u540e\u8bed\u6cd5\u4e0d\u8fc7\uff0c\u5df2\u628a\u521a\u624d\u90a3\u4efd\u653e\u56de\u53bb\uff1a');
    console.error(String(err.stderr || err.message).slice(-500));
    fs.copyFileSync(keep, BARK);
    process.exit(1);
  }
}

// 分段要求要留着，顺手确认一下
const d = fs.existsSync(DECIDE) ? fs.readFileSync(DECIDE, 'utf8') : '';
if (d.includes('\u6309\u8bf4\u8bdd\u7684\u8282\u594f\u6362\u884c')) {
  console.log('\u2713 decide.js \u91cc\u7684\u5206\u6bb5\u8981\u6c42\u8fd8\u5728');
} else {
  console.log('! decide.js \u91cc\u6ca1\u627e\u5230\u5206\u6bb5\u8981\u6c42\uff0c\u5148\u8dd1\u8fd9\u4e2a\uff1a');
  console.log('  node scripts/add_bark_segment_rule.mjs');
}

console.log('');
console.log('pm2 restart phosphor --update-env');
console.log('');
console.log('\u4e0b\u6b21\u4ed6\u8bf4\u8bdd\u5c31\u662f\u4e00\u6761\u5e26\u6362\u884c\u7684\u6d88\u606f\uff0cAru \u62c6\u6210\u6c14\u6ce1\uff0c\u53ea\u4e00\u4e2a\u65f6\u95f4\u6233\u3002');
