#!/usr/bin/env node
// 小满 2026-10-30 19:49 那三件。
//
//   1. 动作和对话按同一个时间顺序，最新的在底部。进窗自动锁最新一条——
//      现在会跳到最上面。
//   2. 预存好的消息点发送后，时间不要改成发送时间。
//   3. 预存的几条作为一次请求递出去，所以他只需要思考一次。
//
// ── 第 2 件是我埋的 bug ──
//
// group() 把一段话按句拆成几个气泡，但 doFlush 里认领用的是
// waiting[i].querySelector('.bub').textContent——那只是**第一句**。
// 拿第一句去跟 SSE 推回来的整段比，对不上，于是 add() 以为是新消息，
// 又画了一条——带着 relay 那边的发送时间。表现出来就是「时间被改写了」。
//
// 改法：建组时把**整段原文**存在 data-full 上，认领用它。
//
// ── 第 3 件 ──
//
// flushPending 原来逐条 POST /app/send，relay 每收一条就触发一次 api_loop。
// 现在合成一条发：一次请求、一次思考。多条之间用换行分开，
// 前端本来就把换行当句分，所以刷页之后还是几个气泡。
//
// 顺带把最早那条的 created_at 当 ts 一起发给 relay——它认就用，
// 不认就忽略，不会报错。
//
// ── 第 1 件 ──
//
// 排序本身上一版已经做了（卡片当数据发下来、和消息一起按 ts 排）。
// 跳到最上面是滚动的事：浏览器有滚动位置恢复，而消息是 fetch 回来才画的，
// 画完之前页面很短、滚不动，等画完了浏览器又把位置记录用上了。
// 所以：关掉 scrollRestoration、底部放一个哨兵元素、连着试几次（头像图片加载
// 会再推一把布局）。
//
// 重跑安全。备份在 src/.chat-v3-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-v3-backup');
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
  return { p, text };
}

function apply(label, st, find, repl) {
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

// ════ 1. chat-queue.js：合成一条发 ════
console.log('1/2  chat-queue.js —— 一次请求');
const q = load('chat-queue.js');
if (q) {
  const OLD = L(
    'export async function flushPending(limit = 50) {',
    '  const rows = listPending(limit);',
    '  if (!rows.length) return { sent: 0, failed: 0, remaining: 0 };',
    "  const mark = stmt(\"UPDATE chat_pending SET sent = 1, sent_at = ?, via = 'relay' WHERE id = ?\");",
    '  let sent = 0;',
    '  let failed = 0;',
    '  let error = null;',
    '  for (const row of rows) {',
    '    try {',
    "      const r = await relayFetch('/app/send', {",
    "        method: 'POST',",
    "        headers: { 'content-type': 'application/json' },",
    '        body: JSON.stringify({ text: row.text }),',
    '      });',
    "      if (!r.ok) throw new Error('HTTP ' + r.status);",
    '      mark.run(Date.now(), row.id);',
    '      sent++;',
    '    } catch (err) {',
    '      failed++;',
    '      error = err.message;',
    '      break;',
    '    }',
    '  }',
    "  if (sent) console.log('chat: 递了 ' + sent + ' 条攒着的话给 relay');",
    "  if (error) console.error('chat: 递攒着的话失败', error);",
    '  return { sent, failed, remaining: pendingCount(), error };',
    '}'
  );

  const NEW = L(
    '// 合成一条递给 relay。',
    '//',
    '// 小满 10-30：「我预存的消息作为一次请求递出去，所以虽然他逐句回复',
    '// 但是只需要一次思考」。',
    '//',
    '// 原来是逐条 POST，relay 每收一条就触发一次 api_loop——三条预存就是',
    '// 三次思考、三段回复，而且后两次还看不到前面那几句的上文。',
    '//',
    '// 换行分开：前端本来就把换行当句分，所以刷页之后还是几个气泡。',
    '// ts 给最早那条的 created_at：relay 认就用，不认就忽略，不会报错。',
    '// 这样刷页后看到的是她当时说这话的时间，不是按按钮的时间。',
    'export async function flushPending(limit = 50) {',
    '  const rows = listPending(limit);',
    '  if (!rows.length) return { sent: 0, failed: 0, remaining: 0 };',
    '',
    "  const text = rows.map((r) => r.text).join('\\n');",
    '  const ts = Math.min(...rows.map((r) => Number(r.created_at) || Date.now()));',
    '',
    '  try {',
    "    const r = await relayFetch('/app/send', {",
    "      method: 'POST',",
    "      headers: { 'content-type': 'application/json' },",
    '      body: JSON.stringify({ text, ts }),',
    '    });',
    "    if (!r.ok) throw new Error('HTTP ' + r.status);",
    '  } catch (err) {',
    "    console.error('chat: 递攒着的话失败', err.message);",
    '    return { sent: 0, failed: rows.length, remaining: pendingCount(), error: err.message };',
    '  }',
    '',
    "  const mark = stmt(\"UPDATE chat_pending SET sent = 1, sent_at = ?, via = 'relay' WHERE id = ?\");",
    '  const now = Date.now();',
    '  for (const row of rows) mark.run(now, row.id);',
    "  console.log('chat: 把 ' + rows.length + ' 条攒着的话合成一条递给 relay（他只思考一次）');",
    '  return { sent: rows.length, failed: 0, remaining: pendingCount() };',
    '}'
  );

  apply('flushPending 合成一条', q, OLD, NEW);
  writeFileSync(q.p, q.text, 'utf8');
}

// ════ 2. chat-page.js ════
console.log('');
console.log('2/2  chat-page.js —— 锁最新一条、时间不被改写');
const c = load('chat-page.js');
if (c) {
  // 2a. toBottom 重写
  apply('toBottom 锁底', c,
    L(
      '  function toBottom() {',
      '    try {',
      '      var last = stream.lastElementChild;',
      "      if (last && last.scrollIntoView) last.scrollIntoView({ block: 'end' });",
      '      window.scrollTo(0, document.documentElement.scrollHeight);',
      '    } catch (e) {}',
      '  }'
    ),
    L(
      '  // 浏览器自带滚动位置恢复，而消息是 fetch 回来才画的——画完之前页面很短、',
      '  // 滚不动，等画完了它又把记录的那个位置（0）用上。这就是「跳到最上面」。',
      "  try { if ('scrollRestoration' in history) history.scrollRestoration = 'manual'; } catch (e) {}",
      '',
      '  // 底部的哨兵：滚到它就是滚到最新一条。比算 scrollHeight 可靠——',
      '  // fixed 元素、安全区、动态 padding 都不影响它。',
      "  var endMark = document.createElement('div');",
      "  endMark.setAttribute('data-end', '');",
      "  endMark.style.height = '1px';",
      '  stream.appendChild(endMark);',
      '',
      '  function toBottom() {',
      '    try {',
      '      if (endMark.parentNode !== stream) stream.appendChild(endMark);',
      '      else stream.appendChild(endMark); // 永远摆在最后',
      "      endMark.scrollIntoView({ block: 'end' });",
      '    } catch (e) {',
      '      try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e2) {}',
      '    }',
      '  }',
      '',
      '  // 连着试几次：头像图片加载完、字体换成 PingFang、fixed 元素入场，',
      '  // 每一步都会再推一把布局。一次不够。',
      '  function lockBottom() {',
      '    toBottom();',
      '    if (window.requestAnimationFrame) requestAnimationFrame(toBottom);',
      '    [60, 200, 500, 1000].forEach(function (ms) { setTimeout(toBottom, ms); });',
      '  }'
    ));

  // 2b. put() 要把哨兵保持在最后
  apply('put 绕开哨兵', c,
    L(
      '  function put(el) {',
      '    if (typingEl) stream.insertBefore(el, typingEl);',
      '    else stream.appendChild(el);',
      '  }'
    ),
    L(
      '  function put(el) {',
      '    if (typingEl) stream.insertBefore(el, typingEl);',
      '    else stream.insertBefore(el, endMark);',
      '  }'
    ));

  // 2c. setTyping 也要在哨兵前面
  apply('typing 绕开哨兵', c,
    "      typingEl.textContent = who.ai.name + ' 正在说…';\n      stream.appendChild(typingEl);",
    "      typingEl.textContent = who.ai.name + ' 正在说…';\n      stream.insertBefore(typingEl, endMark);");

  // 2d. 建组时把整段原文存下来——认领要用它，不能用第一句
  apply('组上存整段原文', c,
    L(
      "    g.className = 'grp ' + (side === 'human' ? 'me' : 'ta') + (opts.wait ? ' wait' : '');"
    ),
    L(
      "    g.className = 'grp ' + (side === 'human' ? 'me' : 'ta') + (opts.wait ? ' wait' : '');",
      '    // 整段原文存在这儿。认领 SSE 推回来的那条要用它——',
      '    // 用 .bub 的文字会只拿到第一句，对不上，于是同一句话被画两遍，',
      '    // 第二遍带着 relay 那边的发送时间——这就是「时间被改写」的根。',
      "    g.setAttribute('data-full', String(text == null ? '' : text));"
    ));

  // 2e. doFlush 认领改用 data-full
  apply('认领用整段原文', c,
    L(
      "          var txt = waiting[i].querySelector('.bub');",
      '          if (txt) mine.push(txt.textContent);'
    ),
    L(
      "          var full = waiting[i].getAttribute('data-full');",
      '          if (full) mine.push(full);'
    ));

  // 2f. 合成一条发了，SSE 推回来的是换行拼起来的整段。
  //     所以认领还要比一次「所有攒着的拼起来」。
  apply('认领拼起来的整段', c,
    L(
      '        if (d.sent) setTyping(true);',
      '        toBottom();'
    ),
    L(
      '        // 合成一条发的，SSE 推回来的是换行拼起来的整段。',
      '        // 单条那几个已经进 mine 了，这儿再把拼起来的也放进去。',
      "        if (joined.length > 1) mine.push(joined.join('\\n'));",
      '        if (d.sent) setTyping(true);',
      '        toBottom();'
    ));

  apply('joined 收集', c,
    L(
      "        var waiting = stream.querySelectorAll('.grp.wait');",
      '        for (var i = 0; i < waiting.length; i++) {'
    ),
    L(
      "        var waiting = stream.querySelectorAll('.grp.wait');",
      '        var joined = [];',
      '        for (var i = 0; i < waiting.length; i++) {'
    ));

  apply('joined 填值', c,
    L(
      "          var full = waiting[i].getAttribute('data-full');",
      '          if (full) mine.push(full);'
    ),
    L(
      "          var full = waiting[i].getAttribute('data-full');",
      '          if (full) { mine.push(full); joined.push(full); }'
    ));

  // 2g. 开场和收尾都用 lockBottom
  apply('开场锁底', c,
    L(
      '      fitBottom();',
      '      toBottom();',
      '      // 图片（头像）加载完会推一把布局，再停一次',
      '      setTimeout(toBottom, 150);',
      '      setTimeout(toBottom, 600);'
    ),
    L(
      '      fitBottom();',
      '      lockBottom();'
    ));

  apply('收尾锁底', c,
    L(
      '  syncBtn();',
      '  fitBottom();',
      '  toBottom();',
      "  window.addEventListener('load', function () { fitBottom(); toBottom(); });",
      "  window.addEventListener('resize', fitBottom);",
      '  setTimeout(function () { fitBottom(); toBottom(); }, 120);'
    ),
    L(
      '  syncBtn();',
      '  fitBottom();',
      '  lockBottom();',
      "  window.addEventListener('load', function () { fitBottom(); lockBottom(); });",
      "  window.addEventListener('resize', fitBottom);"
    ));

  writeFileSync(c.p, c.text, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + bakDir + '/chat-page.js.' + stamp + ' ' + srcDir + '/chat-page.js');
  console.error('  cp ' + bakDir + '/chat-queue.js.' + stamp + ' ' + srcDir + '/chat-queue.js');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('备份：' + bakDir + '（时间戳 ' + stamp + '）');
}
