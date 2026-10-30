#!/usr/bin/env node
// 两件。
//
// 小满 2026-10-30 18:31：「这个第二次发送键还是发送键也要改」
//                      「他醒来要看到我预存的消息」
//                      「翻不到下面内容」
//
// ── 1. 那个按钮不应该是悬浮层 ──
//
// 之前把它抬到 170px，但它和输入框、标签栏是三层叠着的，
// 抬多高都会压到别的东西，而且它本身还盖住消息。
// 现在塞进输入框那一行（composer 是 flex）：攒着话时冒出来占一格，
// 没攒着就收起。物理上就不可能再和发送键重叠。
//
// ── 2. 他醒来读预存的消息 ──
//
// 这段上次没写进 gateway.js（chat_bubbles.mjs 在 chat-page.js 那边就全数失配）。
// 现在补上：heartbeat-wake 那条线路把攒着的话包成 <pending_chat> 跟在输入末尾。
//
// ── 上一版为什么炸了 ──
//
// 133 行那个双引号字符串里跑进了真实换行。JavaScript 的普通字符串
// 不能跳行，所以脚本自己就 SyntaxError 了。这一版所有多行文本一律用
// 数组 + join('\n')，不再把换行写进引号里。
//
// 重跑安全。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
let failed = 0;

const L = (...lines) => lines.join('\n');

function edit(file, label, find, repl) {
  const p = join(srcDir, file);
  if (!existsSync(p)) {
    console.error('  ✗ ' + file + ' 不在');
    failed++;
    return;
  }
  const text = readFileSync(p, 'utf8');
  if (text.includes(find)) {
    writeFileSync(p, text.replace(find, repl), 'utf8');
    console.log('  ✓ ' + label);
  } else if (text.includes(repl)) {
    console.log('  · ' + label + '：已经是这样了');
  } else {
    console.error('  ✗ ' + label + '：找不到原文');
    failed++;
  }
}

// ════ 1. 按钮塞进输入框 ════
console.log('1/2  「让他读」改成输入框里的一格');

edit('chat-page.js', '按钮样式改成行内',
  L(
    '  /* 「让他读」：攒着话的时候才冒出来，浮在输入框上方 */',
    '  .nudge { position: fixed; left: 50%; transform: translateX(-50%); z-index: 81;',
    '    bottom: calc(170px + env(safe-area-inset-bottom, 0px)); display: none;',
    '    align-items: center; gap: 6px; min-height: 34px; padding: 0 15px;',
    '    background: var(--accent); color: #fffdfb; border: none; border-radius: 999px;',
    '    font-size: 12px; box-shadow: 0 3px 12px rgba(60, 30, 60, 0.22); }',
    '  .nudge.on { display: inline-flex; }',
    '  .nudge:disabled { opacity: 0.6; }'
  ),
  L(
    '  /* 「让他读」：塞在输入框那一行里，不是悬浮层。',
    '     之前它是 fixed，和输入框、标签栏三层叠着，点下半部就打到发送键了，',
    '     而且它自己还盖住消息。现在占一格，物理上不可能再重叠。 */',
    '  .nudge { display: none; flex: none; align-items: center; gap: 4px; height: 38px;',
    '    padding: 0 12px; border: none; border-radius: 14px;',
    '    background: var(--accent); color: #fffdfb; font-size: 12px; white-space: nowrap; }',
    '  .nudge.on { display: inline-flex; }',
    '  .nudge:disabled { opacity: 0.6; }'
  ));

edit('chat-page.js', '底部留白回到 200px',
  'body.vp-has-tabs main { padding-bottom: calc(260px + env(safe-area-inset-bottom, 0px)) !important; }',
  'body.vp-has-tabs main { padding-bottom: calc(200px + env(safe-area-inset-bottom, 0px)) !important; }');

edit('chat-page.js', '提示条跟着降下来',
  '    bottom: calc(212px + env(safe-area-inset-bottom, 0px)); z-index: 96;',
  '    bottom: calc(126px + env(safe-area-inset-bottom, 0px)); z-index: 96;');

// HTML：把按钮从 composer 外面挂到里面。
// 注：这段在 chat-page.js 里是模板字符串，里面的 ${...} 是它自己的插值，
// 在这个脚本里要当成普通文本，所以用单引号数组，不用模板字符串。
edit('chat-page.js', '按钮挂进 composer',
  L(
    '      <button type="button" class="nudge" data-nudge>↑ 让${escapeHtml(ta.name)}读 <span data-nudge-n></span></button>',
    '      <form class="composer" data-send onsubmit="return false">',
    '        <input type="text" placeholder="说点什么…" aria-label="输入" />',
    '        <button type="submit" aria-label="发送">↑</button>',
    '      </form>'
  ),
  L(
    '      <form class="composer" data-send onsubmit="return false">',
    '        <input type="text" placeholder="说点什么…" aria-label="输入" />',
    '        <button type="button" class="nudge" data-nudge>让${escapeHtml(ta.name)}读<span data-nudge-n></span></button>',
    '        <button type="submit" aria-label="发送">↑</button>',
    '      </form>'
  ));

// ════ 2. 唤醒时读预存消息 ════
console.log('');
console.log('2/2  他醒来读预存的消息');

const gwPath = join(srcDir, 'gateway.js');
if (!existsSync(gwPath)) {
  console.error('  ✗ gateway.js 不在');
  failed++;
} else {
  let t = readFileSync(gwPath, 'utf8');
  const before = t;

  const REPAIR = "import { repairMessages } from './message-repair.js';";
  const QUEUE = "import { listPending, markPendingRead } from './chat-queue.js';";

  // import chat-queue
  if (t.includes("from './chat-queue.js'")) {
    console.log('  · import chat-queue：已经有了');
  } else if (t.includes(REPAIR)) {
    t = t.replace(REPAIR, L(REPAIR, QUEUE));
    console.log('  ✓ import chat-queue');
  } else {
    console.error('  ✗ 找不到 message-repair 那行 import');
    failed++;
  }

  // import formatDateTime（攒着的话前面要标一个 MM-DD HH:mm）
  if (t.includes("from './wall-time.js'")) {
    console.log('  · import formatDateTime：已经有了');
  } else if (t.includes(QUEUE)) {
    t = t.replace(QUEUE, L(
      QUEUE,
      '// 攒着的话前面要标一个「MM-DD HH:mm」（见 injectPendingChat）',
      "import { formatDateTime } from './wall-time.js';"
    ));
    console.log('  ✓ import formatDateTime');
  } else {
    console.error('  ✗ chat-queue 那行 import 没插进去，跳过');
    failed++;
  }

  // injectPendingChat
  const MARK = '// 非流式响应最多缓存这么大，防止异常大的 body 撑爆内存';
  if (t.includes('function injectPendingChat')) {
    console.log('  · injectPendingChat：已经有了');
  } else if (t.includes(MARK)) {
    t = t.replace(MARK, L(
      '// 她在网页上攒着、没点「让你读」的话。',
      '//',
      '// 小满 10-30：「他醒来要看到我预存的消息」。那「醒来」就是这条',
      '// heartbeat-wake 线路。和 injectDoing 一样跟在末尾：后面没有需要复用的前缀，',
      '// 所以哪怕这段每轮都变，也不影响前面所有东西的缓存命中。',
      '//',
      '// 读到就算读过（和动态里 markUserMomentsSeen 一个道理）：没回也不重复递。',
      '// 这意味着这一轮若上游报错，那几句话不会再出现在下一轮——',
      '// 但数据还在 chat_pending 表里，查得到。',
      'function injectPendingChat(messages) {',
      '  let rows;',
      '  try {',
      '    rows = listPending(20);',
      '  } catch (err) {',
      "    console.error('gateway: 读不到攒着的话，这轮不注入:', err.message);",
      '    return messages;',
      '  }',
      '  if (!rows.length) return messages;',
      '',
      '  const lines = rows',
      '    .map((r) => `【${formatDateTime(r.created_at).slice(5, 16)}】${r.text}`)',
      "    .join('\\n');",
      "  const block = '<pending_chat>\\n' +",
      "    '她在网页的聊天里留了这几句，你还没读过（她没点「让你读」，所以留到你醒来）：\\n' +",
      "    lines + '\\n</pending_chat>';",
      '',
      '  for (let i = messages.length - 1; i >= 0; i--) {',
      '    const m = messages[i];',
      "    if (m?.role !== 'user') continue;",
      '    const out = [...messages];',
      "    if (typeof m.content === 'string') {",
      '      out[i] = { ...m, content: `${m.content}\\n\\n${block}` };',
      '    } else if (Array.isArray(m.content)) {',
      "      out[i] = { ...m, content: [...m.content, { type: 'text', text: block }] };",
      '    } else {',
      '      return messages;',
      '    }',
      '    try {',
      '      markPendingRead(rows.map((r) => r.id));',
      '      console.log(`gateway: 递了 ${rows.length} 条攒着的话给唤醒这轮`);',
      '    } catch (err) {',
      "      console.error('gateway: 攒着的话标记已读失败:', err.message);",
      '    }',
      '    return out;',
      '  }',
      '  return messages;',
      '}',
      '',
      MARK
    ));
    console.log('  ✓ injectPendingChat');
  } else {
    console.error('  ✗ 找不到插函数的位置');
    failed++;
  }

  // 唤醒那条线路调它
  const THREE = L(
    '  let messages = route.injectSharedContext',
    '    ? injectSharedContext(req.body.messages)',
    '    : req.body.messages;'
  );
  if (t.includes('injectPendingChat(messages)')) {
    console.log('  · 唤醒线路调用：已经有了');
  } else if (t.includes(THREE)) {
    t = t.replace(THREE, L(
      THREE,
      '',
      '  // 唤醒这轮：把她在网页上攒着、没点「让你读」的话一并递进来。',
      '  // 聊天那条线路不走这儿——她点了按钮的话已经直接进 relay 了。',
      '  if (route.injectSharedContext) messages = injectPendingChat(messages);'
    ));
    console.log('  ✓ 唤醒线路调用');
  } else {
    console.error('  ✗ 找不到 injectSharedContext 那三行');
    failed++;
  }

  if (t !== before) writeFileSync(gwPath, t, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。把输出发我。');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper vesper-gateway --update-env');
}
