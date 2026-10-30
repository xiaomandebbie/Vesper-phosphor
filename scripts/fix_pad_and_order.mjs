#!/usr/bin/env node
// 两件。
//
// 小满 2026-10-30 20:12：「会遮住」「之前的时间顺序不对」
//
// ── 1. 为什么还遮 ──
//
// tabs.js 里有这条：
//   body.vp-has-tabs main { padding-bottom: calc(96px + …) !important; }
//
// 带 !important 的样式表规则盖过内联 style。所以 fitBottom 算得再准，
// 实际生效的永远是 96px——而输入框自己就在 76px，加上高度 54px
// 已经过了 96。所以最后一条永远被压着。
//
// 改法：setProperty 带 'important'——同样优先级时内联赢。
//
// ── 2. 为什么卡片 09:08 排在 20:10 后面 ──
//
// 因为消息的 ts 被算成了 0——全排最前，卡片带着真实时间排后面。
// relay 返回的时间字段大概不叫 ts。那边的形状文档里写的是
// { id, ts, from, kind, text, meta }，但实现可能是 created_at 或 time。
//
// 所以不猜：按顺序试 ts / created_at / time / created，哪个有值用哪个。
// 都没有就保持数组原有顺序（relay 给的本来就是按时间排的）。
//
// 重跑安全。备份在 src/.chat-fix-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-fix-backup');
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
  if (t.includes(repl)) {
    console.log('  · ' + label + '：已经是这样了');
    return;
  }
  if (!t.includes(find)) {
    console.error('  ✗ ' + label + '：找不到原文');
    failed++;
    return;
  }
  t = t.replace(find, repl);
  console.log('  ✓ ' + label);
}

// ════ 1. 底部留白要带 important ════
console.log('1/3  底部留白（跟 tabs 的 !important 抢优先级）');
apply('fitBottom 带 important',
  "    main.style.paddingBottom = need + 'px';",
  L(
    '    // tabs.js 里那条 body.vp-has-tabs main { padding-bottom: … !important }',
    '    // 会盖过普通内联样式。同样带 important 时内联赢。',
    "    main.style.setProperty('padding-bottom', need + 'px', 'important');"
  ));

// ════ 2. 消息时间字段名 ════
console.log('');
console.log('2/3  消息的时间字段名');
apply('msgTs 函数',
  L(
    '  function hhmm(ts) {'
  ),
  L(
    '  // relay 返回的时间字段叫什么不确定——文档写 ts，实现可能是 created_at。',
    '  // 猜错的后果是所有消息 ts=0 全排最前，卡片带着真实时间排到后面——',
    '  // 表现出来就是「09:08 的卡片排在 20:10 的消息后面」。所以按顺序试。',
    '  function msgTs(m) {',
    '    if (!m) return 0;',
    "    var keys = ['ts', 'created_at', 'time', 'created', 'timestamp'];",
    '    for (var i = 0; i < keys.length; i++) {',
    '      var v = normTs(m[keys[i]]);',
    '      if (v) return v;',
    '    }',
    '    return 0;',
    '  }',
    '',
    '  function hhmm(ts) {'
  ));

apply('气泡时间用 msgTs',
  "    group(human ? 'human' : 'ai', m.text || '', m.ts, human ? { read: 'read' } : {});",
  "    group(human ? 'human' : 'ai', m.text || '', msgTs(m), human ? { read: 'read' } : {});");

apply('排序用 msgTs',
  "        items.push({ t: 'msg', ts: normTs(all.msgs[i].ts), m: all.msgs[i] });",
  "        items.push({ t: 'msg', ts: msgTs(all.msgs[i]), m: all.msgs[i] });");

// 都没有时间的话，按 relay 给的原顺序——它本来就是按时间排的。
// 做法：没时间的消息给一个比所有卡片都大的值（它们是最近的）。
apply('没时间时的兜底',
  L(
    "      items.sort(function (a, b) { return a.ts - b.ts; });"
  ),
  L(
    '      // 消息一条时间也没有的话（字段名全没猜对），按 relay 给的原顺序摆在最后——',
    '      // 它本来就是按时间排的，而卡片都是过去的事。比全排最前强。',
    '      var maxCard = 0;',
    '      for (i = 0; i < items.length; i++) {',
    "        if (items[i].t === 'card' && items[i].ts > maxCard) maxCard = items[i].ts;",
    '      }',
    '      var noTs = 0;',
    '      for (i = 0; i < items.length; i++) {',
    "        if (items[i].t === 'msg' && !items[i].ts) {",
    '          items[i].ts = maxCard + 1 + noTs;',
    '          noTs++;',
    '        }',
    '      }',
    '      if (noTs) {',
    "        console.warn('chat: ' + noTs + ' 条消息没读到时间，按 relay 原顺序摆在卡片后面');",
    '      }',
    '      items.sort(function (a, b) { return a.ts - b.ts; });'
  ));

writeFileSync(p, t, 'utf8');

// ════ 3. 把字段名打出来，下次不用猜 ════
console.log('');
console.log('3/3  看一眼 relay 到底给的是什么字段');
console.log('');
console.log('跑这条（不改任何东西，只是看）：');
console.log('');
console.log("  curl -s http://127.0.0.1:3011/app/history?limit=2 \\");
console.log('    -H "Authorization: Bearer $(grep -m1 \'^RELAY_SECRET=\' /root/companion-relay/relay.env | cut -d= -f2-)" \\');
console.log('    | head -c 500');
console.log('');

if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + join(bakDir, 'chat-page.js.' + stamp) + ' ' + p);
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
}
