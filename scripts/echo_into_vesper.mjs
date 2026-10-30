#!/usr/bin/env node
// 把聊天接进晨暮星自己的 /chat，不再开第二个页。
//
// 小满 2026-10-30：「这里的功能不能和晨暮星整合吗 好麻烦好重复…」
//
// /chat 这一页本来就有行动卡片、详情卡、滚到底，只是输入框发不出去。
// 现在 relay 装好了（见 src/echo-relay.js），把那个输入框接通就行，
// Tidal_Echo 自带的 PWA 壳子不要了。
//
// 改两处：
//   src/chat-page.js —— 气泡样式、气泡容器、输入框改真、前端逻辑
//   src/vesper.js    —— 挂 echo-relay（顺带查 registerChatRoutes 在不在，缺了补）
//
// 重跑安全：改过的地方会说「已经是这样了」。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrote = new Set();
let failed = 0;

function load(rel) {
  const p = resolve(root, rel);
  if (!existsSync(p)) {
    console.error('✗ ' + rel + '：文件不在');
    failed++;
    return null;
  }
  return { p, text: readFileSync(p, 'utf8') };
}

function apply(rel, text, label, find, replacement) {
  if (!text.includes(find)) {
    if (text.includes(replacement)) {
      console.log('· ' + rel + ' · ' + label + '：已经是这样了');
    } else {
      console.error('✗ ' + rel + ' · ' + label + '：找不到原文');
      failed++;
    }
    return text;
  }
  console.log('✓ ' + rel + ' · ' + label);
  return text.replace(find, replacement);
}

function save(rel, p, text, before) {
  if (text !== before) {
    writeFileSync(p, text, 'utf8');
    wrote.add(rel);
  }
}

// ════ src/chat-page.js ════
const chat = load('src/chat-page.js');
if (chat) {
  const before = chat.text;
  let t = chat.text;

  // ── 1. 气泡样式。行动卡片是居中无底色的，说过的话分左右，两者分开 ──
  const CSS_ANCHOR = '  .empty { text-align: center; font-size: 13px;';
  const BUBBLE_CSS = [
    '  /* 真的聊天气泡。和行动卡片区分开：卡片居中无底色，说过的话分左右。',
    '     颜色沿用已有的变量，不新调一套 */',
    '  .msg { display: flex; margin: 0 0 10px; }',
    '  .msg.me { justify-content: flex-end; }',
    '  .msg.ta { justify-content: flex-start; }',
    '  .bub { max-width: 78%; padding: 9px 13px; border-radius: 16px; font-size: 14px;',
    '    line-height: 1.65; white-space: pre-wrap; word-break: break-word;',
    '    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }',
    '  .msg.me .bub { background: var(--accent); color: #fffdfb; border-bottom-right-radius: 6px; }',
    '  .msg.ta .bub { background: var(--card); color: var(--ink); border: 1px solid var(--line);',
    '    border-bottom-left-radius: 6px; }',
    '  .bub.think { background: none; border: none; box-shadow: none; color: var(--muted);',
    '    font-size: 12px; font-style: italic; }',
    '  .bub.draft { opacity: 0.72; }',
    '  .msg-act { margin: 0 0 10px; text-align: center; font-size: 11px; color: var(--activity); }',
    '  .typing { margin: 0 0 10px; font-size: 12px; color: var(--muted); }',
    ''
  ].join('\n');
  t = apply('src/chat-page.js', t, '气泡样式', CSS_ANCHOR, BUBBLE_CSS + CSS_ANCHOR);

  // ── 2. 气泡容器 + 输入框改真（一步做完）──
  t = apply('src/chat-page.js', t, '气泡容器、输入框改真',
    '      <form class="composer" data-fake onsubmit="return false">',
    '      <div class="stream" data-stream data-ai="${escapeHtml(AI_NAME)}"></div>\n' +
    '      <form class="composer" data-send onsubmit="return false">');

  // ── 3. 前端逻辑：历史 + SSE + 发送 ──
  const OLD_JS = [
    '  // 假输入框：别装成能发',
    "  var form = document.querySelector('[data-fake]');",
    '  if (form) {',
    "    form.addEventListener('submit', function (e) {",
    '      e.preventDefault();',
    "      var input = form.querySelector('input');",
    "      if (input) { input.value = ''; input.blur(); }",
    "      var tip = document.querySelector('[data-tip]');",
    '      if (!tip) return;',
    "      tip.classList.add('on');",
    "      setTimeout(function () { tip.classList.remove('on'); }, 2600);",
    '    });',
    '  }'
  ].join('\n');

  const NEW_JS = [
    '  // 真的聊天：历史 + SSE + 发送（后端见 echo-relay.js）。',
    '  //',
    '  // 密钥不进浏览器：这几个请求打的是晨暮星自己的 /chat/api/*，走原有的登录；',
    '  // 服务端再带着 RELAY_SECRET 转给 relay。Tidal_Echo 自带的壳子是把密钥存在',
    '  // localStorage 里的，这边不需要那样。',
    "  var stream = document.querySelector('[data-stream]');",
    "  var tipEl = document.querySelector('[data-tip]');",
    "  var aiName = (stream && stream.getAttribute('data-ai')) || 'TA';",
    '',
    '  function toast(text) {',
    '    if (!tipEl) return;',
    '    tipEl.textContent = text;',
    "    tipEl.classList.add('on');",
    "    setTimeout(function () { tipEl.classList.remove('on'); }, 2600);",
    '  }',
    '',
    '  var seen = {};',
    '  var drafts = {};',
    '  var pendingMine = [];',
    '  var typingEl = null;',
    '',
    '  function setTyping(on) {',
    '    if (!stream) return;',
    '    if (on && !typingEl) {',
    "      typingEl = document.createElement('div');",
    "      typingEl.className = 'typing';",
    "      typingEl.textContent = aiName + ' 正在说…';",
    '      stream.appendChild(typingEl);',
    '      toBottom();',
    '    } else if (!on && typingEl) {',
    '      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);',
    '      typingEl = null;',
    '    }',
    '  }',
    '',
    '  // 工具调用那一步（kind=act）只给一行小字，不占一个气泡。',
    '  // 注意它和行动卡片不是一回事：行动卡片是 moments 表里 kind=activity 的行。',
    '  function render(m) {',
    '    if (!stream) return null;',
    "    var kind = m.kind || 'reply';",
    "    if (kind === 'act') {",
    "      var a = document.createElement('div');",
    "      a.className = 'msg-act';",
    "      a.textContent = m.text || '';",
    '      stream.appendChild(a);',
    '      toBottom();',
    '      return null;',
    '    }',
    "    var row = document.createElement('div');",
    "    row.className = 'msg ' + (m.from === 'human' ? 'me' : 'ta');",
    "    var b = document.createElement('div');",
    "    b.className = 'bub' + (kind === 'thinking' ? ' think' : '');",
    "    b.textContent = m.text || '';",
    '    row.appendChild(b);',
    '    if (typingEl) stream.insertBefore(row, typingEl);',
    '    else stream.appendChild(row);',
    '    toBottom();',
    '    return b;',
    '  }',
    '',
    '  function add(m) {',
    '    if (!m) return;',
    '    if (m.id != null) {',
    '      if (seen[m.id]) return;',
    '      seen[m.id] = 1;',
    '    }',
    '    // 自己刚发的那条：SSE 会把它原样推回来。认领本地已经画好的气泡，',
    '    // 别让同一句话出现两遍。',
    "    if (m.from === 'human') {",
    '      for (var i = 0; i < pendingMine.length; i++) {',
    "        if (pendingMine[i] === (m.text || '')) {",
    '          pendingMine.splice(i, 1);',
    '          return;',
    '        }',
    '      }',
    '    }',
    '    render(m);',
    '  }',
    '',
    '  function onFrame(d) {',
    "    if (!d || typeof d !== 'object') return;",
    "    if (d.type === 'ping' || d.type === 'reaction') return;",
    "    if (d.type === 'typing') { setTyping(!!d.active); return; }",
    "    if (d.type === 'reply_delta') {",
    "      var sid = d.stream_id || 'one';",
    '      var b = drafts[sid];',
    '      if (!b) {',
    "        b = render({ from: 'ai', kind: 'reply', text: '' });",
    '        if (!b) return;',
    "        b.classList.add('draft');",
    '        drafts[sid] = b;',
    '      }',
    '      if (d.done) {',
    '        if (d.final_text) b.textContent = d.final_text;',
    "        b.classList.remove('draft');",
    '        delete drafts[sid];',
    '        setTyping(false);',
    "      } else if (typeof d.text === 'string') {",
    '        // text 可能是累计的也可能是增量的，两种都兜着',
    "        var cur = b.textContent || '';",
    '        b.textContent = d.text.indexOf(cur) === 0 ? d.text : cur + d.text;',
    '      }',
    '      toBottom();',
    '      return;',
    '    }',
    '    if (d.type) return;',
    '    add(d);',
    '  }',
    '',
    '  if (stream) {',
    "    fetch('/chat/api/history?limit=60', { credentials: 'same-origin' })",
    '      .then(function (r) { return r.ok ? r.json() : null; })',
    '      .then(function (d) {',
    '        if (!d) return;',
    '        var list = d.messages || [];',
    '        for (var i = 0; i < list.length; i++) add(list[i]);',
    '        toBottom();',
    '      })',
    '      .catch(function () {});',
    '',
    '    try {',
    "      var es = new EventSource('/chat/api/stream');",
    '      es.onmessage = function (e) {',
    '        if (!e.data) return;',
    '        try { onFrame(JSON.parse(e.data)); } catch (err) {}',
    '      };',
    '      es.onerror = function () { setTyping(false); };',
    '    } catch (err) {}',
    '  }',
    '',
    "  var sendForm = document.querySelector('[data-send]');",
    '  if (sendForm) {',
    "    sendForm.addEventListener('submit', function (e) {",
    '      e.preventDefault();',
    "      var input = sendForm.querySelector('input');",
    "      var text = input ? String(input.value || '').trim() : '';",
    '      if (!text) return;',
    "      if (input) input.value = '';",
    '      // 先在本地画出来，不等往返——打字发出去该立刻看见',
    "      render({ from: 'human', kind: 'user', text: text });",
    '      pendingMine.push(text);',
    '      setTimeout(function () {',
    '        var i = pendingMine.indexOf(text);',
    '        if (i >= 0) pendingMine.splice(i, 1);',
    '      }, 15000);',
    "      fetch('/chat/api/send', {",
    "        method: 'POST',",
    "        credentials: 'same-origin',",
    "        headers: { 'content-type': 'application/json' },",
    '        body: JSON.stringify({ text: text })',
    '      })',
    "        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); })",
    "        .catch(function (err) { toast('没发出去：' + err.message); });",
    '    });',
    '  }'
  ].join('\n');

  t = apply('src/chat-page.js', t, '前端逻辑', OLD_JS, NEW_JS);
  save('src/chat-page.js', chat.p, t, before);
}

// ════ src/vesper.js ════
const ves = load('src/vesper.js');
if (ves) {
  const before = ves.text;
  let t = ves.text;
  const GAME_IMPORT = "import { registerGameRoutes } from './game-page.js';";
  const hadChat = t.includes('registerChatRoutes');

  if (!t.includes("from './echo-relay.js'")) {
    t = apply('src/vesper.js', t, 'import echo-relay',
      GAME_IMPORT,
      GAME_IMPORT + "\nimport { registerEchoRelay } from './echo-relay.js';");
  } else {
    console.log('· src/vesper.js · import echo-relay：已经有了');
  }

  // /chat 这一页原来没挂上去——chat-page.js 写好了，但 vesper.js 里没有
  // registerChatRoutes。没挂的话 /chat 根本进不去，一并补上。
  if (!hadChat) {
    t = apply('src/vesper.js', t, 'import chat-page（原来没挂）',
      "import { registerEchoRelay } from './echo-relay.js';",
      "import { registerEchoRelay } from './echo-relay.js';\n" +
      "import { registerChatRoutes } from './chat-page.js';");
  }

  const ANCHOR = 'const games = registerGameRoutes(app, { requireBasicAuth });';
  if (!t.includes('registerEchoRelay(app')) {
    let add = [
      ANCHOR,
      '// 聊天接 relay（见 echo-relay.js）：/chat/api/history | stream | send。',
      '// 要挂在 /chat 页面路由之前：那边有 /chat/:id 和 /chat，得先把 api 那三条接走。',
      'const echo = registerEchoRelay(app, { requireBasicAuth });'
    ];
    if (!hadChat) {
      add.push('// 聊天两层 /chat（见 chat-page.js）。以前这行没挂上，所以那一页进不去。');
      add.push('registerChatRoutes(app, { requireBasicAuth });');
    }
    t = apply('src/vesper.js', t, '挂上去', ANCHOR, add.join('\n'));
  } else {
    console.log('· src/vesper.js · 挂上去：已经有了');
  }

  save('src/vesper.js', ves.p, t, before);
  if (!hadChat) {
    console.log('');
    console.log('注意：/chat 这一页原来没挂在 vesper.js 里（没有 registerChatRoutes），');
    console.log('这次一并补上了。如果它其实是在别处挂的，重启后会报路由重复，告我一声。');
  }
}

console.log('');
console.log('写了 ' + wrote.size + ' 个文件：' + (Array.from(wrote).join('、') || '无'));
if (failed) {
  console.error('失败 ' + failed + ' 处，上面有说是哪一条。');
  process.exitCode = 1;
} else {
  console.log('');
  console.log('接下来：pm2 restart vesper --update-env');
  console.log('启动日志里应该有一行：echo: 聊天接上 relay（…）');
  console.log('然后开 /chat 里任意一个窗，输入框现在是真的了。');
  console.log('');
  console.log('允朔还不会回：身体（api_loop）还没装，那是下一步。');
}
