#!/usr/bin/env node
// 小满 2026-10-30 20:24：「之前消息时间都错了，那几条是下午和 19 点发的」
//
// ── 根因：normTs 认不得 ISO 字符串 ──
//
// relay 是 FastAPI + Python。它的 ts 很可能是 "2026-10-30T19:00:00" 这样的
// ISO 字符串，而不是数字。我的 normTs 用 Number() 转它 → NaN → 当成 0。
//
// 于是三件事一起发生：
//   所有 relay 消息 ts=0 → 排序时被摆到卡片后面
//   hhmm(0) 回退成 new Date() → 下午发的话显示成刚才那一刻
//   翻不到的那几条——因为排序位置被打乱了
//
// 「显示成当前时间」比「不显示」更坏：后者只是缺一块信息，
// 前者是编了一个假的。所以这次读不到就不打时间。
//
// 重跑安全。备份在 src/.chat-ts-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-ts-backup');
const stamp = String(Date.now());
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });
const p = join(srcDir, 'chat-page.js');
if (!existsSync(p)) {
  console.error('✗ chat-page.js 不在');
  process.exit(1);
}
let t = readFileSync(p, 'utf8');
writeFileSync(join(bakDir, 'chat-page.js.' + stamp), t, 'utf8');

function apply(label, find, repl) {
  if (t.includes(repl)) { console.log('  · ' + label + '：已经是这样了'); return; }
  if (!t.includes(find)) { console.error('  ✗ ' + label + '：找不到原文'); failed++; return; }
  t = t.replace(find, repl);
  console.log('  ✓ ' + label);
}

console.log('1/2  normTs 认 ISO 字符串');
apply('normTs',
  L(
    '  function normTs(ts) {',
    '    var n = Number(ts);',
    '    if (!isFinite(n) || n <= 0) return 0;',
    '    return n < 1e12 ? n * 1000 : n;',
    '  }'
  ),
  L(
    '  // 时间戳三种形状都要认：',
    '  //   毫秒数字（1793363025127）—— 我们自己的 Date.now()',
    '  //   秒数字（1793363025）   —— Python 的 time.time()',
    '  //   ISO 字符串（"2026-10-30T19:00:00"）—— FastAPI 序列化 datetime 的样子',
    '  //',
    '  // 之前只认前两种，Number("2026-10-30T…") 是 NaN，所以所有 relay 消息',
    '  // 都被当成「没时间」——排错位置，还显示成了当前时间。',
    '  function normTs(ts) {',
    '    if (ts == null) return 0;',
    "    if (typeof ts === 'number') {",
    '      if (!isFinite(ts) || ts <= 0) return 0;',
    '      return ts < 1e12 ? ts * 1000 : ts;',
    '    }',
    '    var s = String(ts).trim();',
    "    if (!s) return 0;",
    '    // 纯数字的字符串（"1793363025"）',
    '    if (/^\\d+(\\.\\d+)?$/.test(s)) {',
    '      var n = Number(s);',
    '      if (!isFinite(n) || n <= 0) return 0;',
    '      return n < 1e12 ? n * 1000 : n;',
    '    }',
    '    // ISO。不带时区的字串 Safari 按本地时间读，正是我们要的——',
    '    // 服务器和手机都在 CST。',
    '    var d = Date.parse(s);',
    '    if (!isNaN(d)) return d;',
    '    // "2026-10-30 19:00:00" 这种空格分隔的，换成 T 再试一次',
    "    d = Date.parse(s.replace(' ', 'T'));",
    '    return isNaN(d) ? 0 : d;',
    '  }'
  ));

console.log('');
console.log('2/2  hhmm 不再回退成当前时间');
apply('hhmm',
  L(
    '  function hhmm(ts) {',
    '    var n = normTs(ts);',
    '    var d = n ? new Date(n) : new Date();',
    "    var h = d.getHours(), m = d.getMinutes();",
    "    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;",
    '  }'
  ),
  L(
    '  // 读不到就不打。回退成 new Date() 是比「没有时间」更坏的错：',
    '  // 后者只是缺一块信息，前者是编了一个假的——',
    '  // 小满 20:24：「之前消息时间都错了，那几条是下午和 19 点发的」。',
    '  function hhmm(ts) {',
    '    var n = normTs(ts);',
    "    if (!n) return '';",
    '    var d = new Date(n);',
    '    var h = d.getHours(), m = d.getMinutes();',
    "    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;",
    '  }'
  ));

writeFileSync(p, t, 'utf8');

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + join(bakDir, 'chat-page.js.' + stamp) + ' ' + p);
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('跑完还不对的话，这条能看见 relay 到底给的形状（只读，不改东西）：');
  console.log('');
  console.log("  curl -s 'http://127.0.0.1:3011/app/history?limit=2' \\");
  console.log('    -H "Authorization: Bearer $(grep -m1 \'^RELAY_SECRET=\' /root/companion-relay/relay.env | cut -d= -f2-)"');
}
