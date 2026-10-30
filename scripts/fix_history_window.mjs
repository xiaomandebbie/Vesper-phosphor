#!/usr/bin/env node
// 小满 2026-10-30 21:19：「我的消息被吞掉了」
//
// ── 根因：history 的 limit 是从早往晚取 ──
//
// 图1 里 limit=8 返回的是 call_start / call_end / hello… / 👀 / 测试——
// 这是最早的八条，不是最近的八条。
//
// relay 的接口是 GET /app/history?since=&limit=，语义是「从 since 往后取
// limit 条」。since 不传就从最开头取。所以前端一直在取最早的 60 条，
// 消息总数一超过 60，新的全在窗口外。
//
// 他的回复能看见是因为 SSE 当场推了一次；我的消息刷页之后彻底找不回来。
//
// 改法：不传 limit（让它给全部），前端自己截最后 80 条。
// 这样不用改 relay 的代码——和记忆库转发同一个规矩，上游不动。
//
// ── 顺带摸掉那个 ts 字段 ──
//
// flushPending 里我给 /app/send 多发了一个 ts，想让「时间不要改成发送时间」。
// 但 relay 的 /app/send 只收 {text, attachments?}，多的字段被忽略——
// 没效果，还多一份不确定。摸掉。那件事在前端解决：
// 攒着的气泡已经画在页上了，认领机制会让 SSE 不重画，所以时间就是原来那个。
//
// 重跑安全。备份在 src/.chat-hist-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-hist-backup');
const stamp = String(Date.now());
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

function load(name) {
  const p = join(srcDir, name);
  if (!existsSync(p)) {
    console.error('  ✗ ' + name + ' 不在');
    failed++;
    return null;
  }
  const text = readFileSync(p, 'utf8');
  writeFileSync(join(bakDir, name + '.' + stamp), text, 'utf8');
  return { p, text, name };
}

function apply(st, label, find, repl) {
  if (st.text.includes(repl)) {
    console.log('  · ' + label + '：已经是这样了');
    return;
  }
  if (!st.text.includes(find)) {
    console.error('  ✗ ' + label + '：找不到原文');
    failed++;
    return;
  }
  st.text = st.text.replace(find, repl);
  console.log('  ✓ ' + label);
}

// ════ 1. echo-relay.js：history 不再带 limit ════
console.log('1/3  echo-relay.js —— history 取全部');
const e = load('echo-relay.js');
if (e) {
  apply(e, 'history 不带 limit',
    L(
      "  app.get('/chat/api/history', requireBasicAuth, async (req, res) => {",
      '    const limit = Math.min(Number(req.query.limit) || 60, 200);',
      '    try {',
      "      const r = await relayFetch('/app/history?limit=' + limit);"
    ),
    L(
      '  // relay 的 /app/history?since=&limit= 是「从 since 往后取 limit 条」——',
      '  // 从早往晚。传 limit=60 就是取最早的 60 条，消息一超过 60，',
      '  // 新的全在窗口外——表现出来就是「我的消息被吞掉了」。',
      '  // 所以这儿不带 limit，让它给全部，前端自己截最后几条。',
      "  app.get('/chat/api/history', requireBasicAuth, async (req, res) => {",
      '    try {',
      "      const r = await relayFetch('/app/history');"
    ));
  writeFileSync(e.p, e.text, 'utf8');
}

// ════ 2. chat-page.js：前端截最后几条 ════
console.log('');
console.log('2/3  chat-page.js —— 截最后 80 条');
const c = load('chat-page.js');
if (c) {
  apply(c, 'fetch 不带 limit',
    "  fetch('/chat/api/history?limit=60', { credentials: 'same-origin' })",
    "  fetch('/chat/api/history', { credentials: 'same-origin' })");

  apply(c, '截最后 80 条',
    L(
      '      var msgs = (d && d.messages) || [];',
      '      for (var i = 0; i < msgs.length; i++) {',
      '        if (msgs[i].id != null) seen[msgs[i].id] = 1;',
      '      }'
    ),
    L(
      '      var all = (d && d.messages) || [];',
      '      // relay 给的是从早到晚的全部，这儿只要最后这些。',
      '      // 别用接口的 limit——那个是从头取，取到的全是旧的。',
      '      var msgs = all.length > 80 ? all.slice(all.length - 80) : all;',
      '      // seen 要标全部，不只是画出来的那八十条——',
      '      // 否则 SSE 把一条旧消息再推一遍时会被当成新的。',
      '      for (var i = 0; i < all.length; i++) {',
      '        if (all[i].id != null) seen[all[i].id] = 1;',
      '      }'
    ));
  writeFileSync(c.p, c.text, 'utf8');
}

// ════ 3. chat-queue.js：摸掉那个 ts ════
console.log('');
console.log('3/3  chat-queue.js —— 摸掉没用的 ts 字段');
const q = load('chat-queue.js');
if (q) {
  apply(q, '不再发 ts',
    L(
      "  const text = rows.map((r) => r.text).join('\\n');",
      '  const ts = Math.min(...rows.map((r) => Number(r.created_at) || Date.now()));'
    ),
    L(
      "  const text = rows.map((r) => r.text).join('\\n');",
      '  // 之前还多发了一个 ts，想让「时间不要改成发送时间」。',
      '  // 但 relay 的 /app/send 只收 {text, attachments?}，多的字段被忽略——',
      '  // 没效果，还多一份不确定。那件事在前端解决：攒着的气泡已经',
      '  // 画在页上，认领机制让 SSE 不重画，所以时间就是原来那个。'
    ));

  apply(q, 'body 不带 ts',
    '      body: JSON.stringify({ text, ts }),',
    '      body: JSON.stringify({ text }),');
  writeFileSync(q.p, q.text, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cd ' + srcDir);
  console.error('  for f in chat-page chat-queue echo-relay; do cp .chat-hist-backup/$f.js.' + stamp + ' $f.js; done');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('顺带：那条 SQL 报 no such column: from 是因为 from 是 SQLite 关键字。');
  console.log('要查库用这条（[from] 方括号）：');
  console.log('');
  console.log('  cd /root/companion-relay && sqlite3 -header relay.db \\');
  console.log('    "select id, substr(ts,1,19) t, [from] who, substr(text,1,40) x from messages order by id desc limit 8;"');
}
