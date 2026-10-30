#!/usr/bin/env node
// 小满 2026-10-30 16:39 那两条。
//
// 1. 思考链像 Aru 那样，点击才看到详情
// 2. 逐句输出。允朔显示头像，头像上面是名字，旁边是气泡。每一句话左边都有
//    头像但只有第一句有名字。最后一个气泡右边显示发送时间。
//    我的也要这样，时间在气泡左边。
// 3. 逐条发送，可以发完再点一次让他读；不点就等下次唤醒读。
//
// ── 改哪几处 ──
//   src/echo-relay.js —— send 改成落队列；加 flush / pending 两条
//   src/chat-page.js  —— 头像行、逐句气泡、时间、思考折叠、「让他读」按钮
//   src/gateway.js    —— heartbeat-wake 那条线路把攒着的话注入进去
//
// 头像和名字用的是动态页那同一份（moments-store.js 的 getProfile），
// 不另开一套——你 09-30 和 10-04 就是为这个提过两次。
//
// 重跑安全。
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
function save(rel, p, text, before) {
  if (text !== before) {
    writeFileSync(p, text, 'utf8');
    wrote.add(rel);
  }
}
function apply(rel, text, label, find, repl) {
  if (!text.includes(find)) {
    if (text.includes(repl)) console.log('· ' + rel + ' · ' + label + '：已经是这样了');
    else { console.error('✗ ' + rel + ' · ' + label + '：找不到原文'); failed++; }
    return text;
  }
  console.log('✓ ' + rel + ' · ' + label);
  return text.replace(find, repl);
}
// 按起止标记换整段。起止都是我自己上一版插的，唯一。
function splice(rel, text, label, startMark, endMark, repl) {
  const a = text.indexOf(startMark);
  if (a < 0) {
    if (text.includes(repl.slice(0, 60))) console.log('· ' + rel + ' · ' + label + '：已经是这样了');
    else { console.error('✗ ' + rel + ' · ' + label + '：找不到起始标记'); failed++; }
    return text;
  }
  const b = text.indexOf(endMark, a);
  if (b < 0) { console.error('✗ ' + rel + ' · ' + label + '：找不到结束标记'); failed++; return text; }
  console.log('✓ ' + rel + ' · ' + label);
  return text.slice(0, a) + repl + text.slice(b + endMark.length);
}

// ════ 1. echo-relay.js：send 落队列 ════
const er = load('src/echo-relay.js');
if (er) {
  const before = er.text;
  let t = er.text;

  t = apply('src/echo-relay.js', t, '改用 chat-queue',
    "import fs from 'fs';\nimport { Readable } from 'stream';",
    "import { Readable } from 'stream';\n" +
    "import {\n" +
    "  relaySecret, relayFetch, addPending, listPending, pendingCount, flushPending, dropPending,\n" +
    "} from './chat-queue.js';");

  // 原来的 readSecret / RELAY_URL 整段抿掉，谁读密钥归 chat-queue 统一管
  t = splice('src/echo-relay.js', t, '抿掉重复的读密钥',
    "const RELAY_URL = String(process.env.ECHO_RELAY_URL",
    "export function registerEchoRelay(app, { requireBasicAuth }) {\n  const secret = readSecret();",
    'export function registerEchoRelay(app, { requireBasicAuth }) {\n  const secret = relaySecret();');

  t = apply('src/echo-relay.js', t, '开头提示语',
    "    console.log('echo: \u8bfb\u4e0d\u5230 RELAY_SECRET\uff08' + ENV_FILE + '\uff09\uff0c\u804a\u5929\u6ca1\u63a5\u4e0a');",
    "    console.log('echo: \u8bfb\u4e0d\u5230 RELAY_SECRET\uff0c\u804a\u5929\u6ca1\u63a5\u4e0a');");

  t = t.replace(/const auth = \{ Authorization: 'Bearer ' \+ secret \};\n/, '');
  t = t.replace(/, \{ headers: auth \}/g, '');
  t = t.replace(/\{ \.\.\.auth, 'content-type': 'application\/json' \}/g, "{ 'content-type': 'application/json' }");
  t = t.replace(/await fetch\(RELAY_URL \+ ('[^']+')/g, 'await relayFetch($1');

  // send 不再直接投 relay，改成落队列；再加 flush / pending / drop
  t = splice('src/echo-relay.js', t, 'send 改攒着发',
    "  app.post('/chat/api/send', requireBasicAuth, async (req, res) => {",
    "  // SSE：原样转发、不缓冲。",
    [
      '  // 发出去的话先落本地队列，不立刻惊动他（见 chat-queue.js）。',
      '  // 小满要的是「可以逐条发，发完再点一次让允朔读；也可以不点，等他下次醒来读」。',
      "  app.post('/chat/api/send', requireBasicAuth, (req, res) => {",
      "    const text = String(req.body?.text ?? '').trim();",
      "    if (!text) return res.status(400).json({ error: 'text required' });",
      '    const wid = Number(req.body?.window_id);',
      '    try {',
      '      const id = addPending(text, Number.isInteger(wid) ? wid : null);',
      '      return res.json({ id, pending: pendingCount() });',
      '    } catch (err) {',
      "      console.error('echo: \u5b58\u4e0d\u4e0b\u8fd9\u6761\u8bdd', err.message);",
      "      return res.status(500).json({ error: 'queue failed' });",
      '    }',
      '  });',
      '',
      '  // 点「让他读」：按顺序递给 relay，他当场回。',
      "  app.post('/chat/api/flush', requireBasicAuth, async (req, res) => {",
      '    try {',
      '      res.json(await flushPending());',
      '    } catch (err) {',
      "      console.error('echo: \u9012\u6512\u7740\u7684\u8bdd\u5931\u8d25', err.message);",
      "      res.status(502).json({ error: err.message });",
      '    }',
      '  });',
      '',
      '  // 还攒着几条、分别是什么。刷页之后还要显示出来，所以要这条。',
      "  app.get('/chat/api/pending', requireBasicAuth, (req, res) => {",
      '    res.json({ pending: listPending() });',
      '  });',
      '',
      '  // 攒着的还没递出去，所以还能收回。',
      "  app.post('/chat/api/pending/:id/drop', requireBasicAuth, (req, res) => {",
      '    res.json({ dropped: dropPending(Number(req.params.id)), pending: pendingCount() });',
      '  });',
      '',
      '  // SSE：原样转发、不缓冲。'
    ].join('\n'));

  save('src/echo-relay.js', er.p, t, before);
}

// ════ 2. chat-page.js ════
const cp = load('src/chat-page.js');
if (cp) {
  const before = cp.text;
  let t = cp.text;

  t = apply('src/chat-page.js', t, '读头像和名字',
    "import { listMomentsBetween } from './moments-store.js';",
    "import { listMomentsBetween, getProfile } from './moments-store.js';");

  // ── CSS：换掉上一版那套素气泡 ──
  const CSS = [
    '  /* 头像 + 名字 + 逐句气泡。头像和名字走动态页那同一份（getProfile）。',
    '     一组 = 他（或我）一次说的话，里面按句子拆成几个气泡：',
    '     每句左边都有头像，只有第一句上面有名字，最后一句旁边显示时间 */',
    '  .grp { margin: 0 0 12px; }',
    '  .ln { display: flex; align-items: flex-end; gap: 7px; margin-bottom: 3px; }',
    '  .grp.me .ln { flex-direction: row-reverse; }',
    '  .av { flex: none; width: 30px; height: 30px; border-radius: 50%; overflow: hidden;',
    '    background: var(--card); border: 1px solid var(--line); display: flex;',
    '    align-items: center; justify-content: center; font-size: 12px; color: var(--accent); }',
    '  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }',
    '  .av.ghost { visibility: hidden; }',
    '  .who { margin: 0 0 3px 37px; font-size: 11px; color: var(--muted); }',
    '  .grp.me .who { margin: 0 37px 3px 0; text-align: right; }',
    '  .bub { max-width: 70%; padding: 8px 12px; border-radius: 15px; font-size: 14px;',
    '    line-height: 1.65; white-space: pre-wrap; word-break: break-word;',
    '    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }',
    '  .grp.me .bub { background: var(--accent); color: #fffdfb; border-bottom-right-radius: 5px; }',
    '  .grp.ta .bub { background: var(--card); color: var(--ink); border: 1px solid var(--line);',
    '    border-bottom-left-radius: 5px; }',
    '  .bub.draft { opacity: 0.72; }',
    '  /* 时间：只跟在最后一个气泡旁边。他的在右，我的在左 */',
    '  .at { flex: none; font-size: 10px; color: #a597ab; font-variant-numeric: tabular-nums;',
    '    padding-bottom: 2px; }',
    '  /* 思考链：默认只一条，点了才展开（和 Aru 那边一样）*/',
    '  .think { margin: 0 0 8px 37px; }',
    '  .think-top { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px;',
    '    background: none; border: 1px solid var(--line); border-radius: 999px;',
    '    font: inherit; font-size: 11px; color: var(--muted); }',
    '  .think-top:active { background: rgba(122, 62, 93, 0.05); }',
    '  .think-caret { font-size: 9px; transition: transform 0.15s; }',
    '  .think.on .think-caret { transform: rotate(90deg); }',
    '  .think-body { display: none; margin: 6px 0 0; padding: 9px 12px; border-radius: 12px;',
    '    background: rgba(122, 62, 93, 0.04); border: 1px dashed var(--line);',
    '    font-size: 12px; line-height: 1.7; color: var(--muted);',
    '    white-space: pre-wrap; word-break: break-word; }',
    '  .think.on .think-body { display: block; }',
    '  .msg-act { margin: 0 0 10px; text-align: center; font-size: 11px; color: var(--activity); }',
    '  .typing { margin: 0 0 10px 37px; font-size: 12px; color: var(--muted); }',
    '  /* 攒着还没递出去的：气泡半透，旁边一个小叉可以收回 */',
    '  .grp.wait .bub { opacity: 0.6; }',
    '  .undo { flex: none; width: 22px; height: 22px; border-radius: 50%; border: 1px solid var(--line);',
    '    background: var(--card); color: var(--muted); font-size: 12px; line-height: 1; padding: 0; }',
    '  /* 「让他读」：攒着话的时候才冒出来，浮在输入框上方 */',
    '  .nudge { position: fixed; left: 50%; transform: translateX(-50%); z-index: 81;',
    '    bottom: calc(118px + env(safe-area-inset-bottom, 0px)); display: none;',
    '    align-items: center; gap: 6px; min-height: 34px; padding: 0 15px;',
    '    background: var(--accent); color: #fffdfb; border: none; border-radius: 999px;',
    '    font-size: 12px; box-shadow: 0 3px 12px rgba(60, 30, 60, 0.22); }',
    '  .nudge.on { display: inline-flex; }',
    ''
  ].join('\n');
  t = splice('src/chat-page.js', t, '气泡样式',
    '  /* 真的聊天气泡。',
    '  .typing { margin: 0 0 10px; font-size: 12px; color: var(--muted); }\n',
    CSS);

  // ── 「让他读」按钮 ──
  t = apply('src/chat-page.js', t, '「让他读」按钮',
    '      <form class="composer" data-send',
    '      <button type="button" class="nudge" data-nudge>\u2191 \u8ba9${escapeHtml(AI_NAME)}\u8bfb <span data-nudge-n></span></button>\n' +
    '      <form class="composer" data-send');

  // ── 头像和名字当成 data-* 交给前端 ──
  t = apply('src/chat-page.js', t, '头像数据',
    '      <div class="stream" data-stream data-ai="${escapeHtml(AI_NAME)}"></div>',
    '      <div class="stream" data-stream\n' +
    '        data-ta-name="${escapeHtml(taProfile.name)}" data-ta-av="${escapeHtml(taProfile.avatarUrl || \'\')}"\n' +
    '        data-me-name="${escapeHtml(meProfile.name)}" data-me-av="${escapeHtml(meProfile.avatarUrl || \'\')}"></div>');

  t = apply('src/chat-page.js', t, '取 profile',
      '      const w = getWindow(Number(req.params.id));',
      '      const taProfile = getProfile(\'assistant\');\n' +
      '      const meProfile = getProfile(\'user\');\n' +
      '      const w = getWindow(Number(req.params.id));');

  // ── 前端逻辑整段重写 ──
  const JS = [
    '  // 聊天：头像 + 名字 + 逐句气泡 + 时间 + 思考折叠 + 攒着发。',
    '  //',
    '  // 密钥不进浏览器：这几个请求打的是晨暮星自己的 /chat/api/*，走原有的登录；',
    '  // 服务端再带着 RELAY_SECRET 转给 relay（见 echo-relay.js、chat-queue.js）。',
    "  var stream = document.querySelector('[data-stream]');",
    "  var tipEl = document.querySelector('[data-tip]');",
    "  var nudge = document.querySelector('[data-nudge]');",
    "  var nudgeN = document.querySelector('[data-nudge-n]');",
    '  function attr(k, d) {',
    '    var v = stream && stream.getAttribute(k);',
    '    return v ? v : d;',
    '  }',
    "  var who = {",
    "    ai: { name: attr('data-ta-name', 'TA'), av: attr('data-ta-av', '') },",
    "    human: { name: attr('data-me-name', '\u6211'), av: attr('data-me-av', '') }",
    '  };',
    '',
    '  function toast(text) {',
    '    if (!tipEl) return;',
    '    tipEl.textContent = text;',
    "    tipEl.classList.add('on');",
    "    setTimeout(function () { tipEl.classList.remove('on'); }, 2600);",
    '  }',
    '',
    '  function hhmm(ts) {',
    '    var d = ts ? new Date(ts) : new Date();',
    "    var h = d.getHours(), m = d.getMinutes();",
    "    return (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;",
    '  }',
    '',
    '  // 逐句：中文句读点和换行都算一句。标点留在句尾，',
    '  // 后面跟的引号、来号也跟着走，不单独开一个气泡。',
    '  function sentences(text) {',
    "    var s = String(text == null ? '' : text).trim();",
    '    if (!s) return [];',
    '    var out = [];',
    "    var buf = '';",
    "    var stop = '\u3002\uff01\uff1f!?\u2026';",
    "    var tail = '\u201d\u2019\uff09)\u300d\u300f\u3002\uff01\uff1f!?\u2026';",
    '    for (var i = 0; i < s.length; i++) {',
    '      var c = s[i];',
    "      if (c === '\\n') {",
    '        if (buf.trim()) out.push(buf.trim());',
    "        buf = '';",
    '        continue;',
    '      }',
    '      buf += c;',
    '      if (stop.indexOf(c) >= 0) {',
    '        while (i + 1 < s.length && tail.indexOf(s[i + 1]) >= 0) { buf += s[++i]; }',
    '        if (buf.trim()) out.push(buf.trim());',
    "        buf = '';",
    '      }',
    '    }',
    '    if (buf.trim()) out.push(buf.trim());',
    '    return out.length ? out : [s];',
    '  }',
    '',
    '  function avatar(side, ghost) {',
    "    var el = document.createElement('div');",
    "    el.className = 'av' + (ghost ? ' ghost' : '');",
    '    var info = who[side] || who.ai;',
    '    if (info.av) {',
    "      var img = document.createElement('img');",
    '      img.src = info.av;',
    "      img.alt = '';",
    '      el.appendChild(img);',
    '    } else {',
    "      el.textContent = (info.name || '?').slice(0, 1);",
    '    }',
    '    return el;',
    '  }',
    '',
    '  // 一组话。side 是 human 或 ai。',
    '  // 返回最后一个气泡元素（流式草稿要接着往里写）。',
    '  function group(side, text, ts, opts) {',
    '    if (!stream) return null;',
    '    opts = opts || {};',
    '    var lines = opts.draft ? [text] : sentences(text);',
    '    if (!lines.length) return null;',
    "    var g = document.createElement('div');",
    "    g.className = 'grp ' + (side === 'human' ? 'me' : 'ta') + (opts.wait ? ' wait' : '');",
    '',
    '    // 名字只在第一句上面出一次',
    "    var nm = document.createElement('div');",
    "    nm.className = 'who';",
    "    nm.textContent = (who[side] || who.ai).name;",
    '    g.appendChild(nm);',
    '',
    '    var last = null;',
    '    for (var i = 0; i < lines.length; i++) {',
    "      var ln = document.createElement('div');",
    "      ln.className = 'ln';",
    '      ln.appendChild(avatar(side, i > 0));',
    "      var b = document.createElement('div');",
    "      b.className = 'bub' + (opts.draft ? ' draft' : '');",
    '      b.textContent = lines[i];',
    '      ln.appendChild(b);',
    '      // 时间只跟在最后一个气泡旁边。flex-direction 已经把我这边翻过来了，',
    '      // 所以同样 append 就是他的在右、我的在左。',
    '      if (i === lines.length - 1) {',
    "        var at = document.createElement('span');",
    "        at.className = 'at';",
    '        at.textContent = hhmm(ts);',
    '        ln.appendChild(at);',
    '        if (opts.wait && opts.pid) {',
    "          var x = document.createElement('button');",
    "          x.type = 'button';",
    "          x.className = 'undo';",
    "          x.setAttribute('data-drop', opts.pid);",
    "          x.setAttribute('aria-label', '\u6536\u56de\u8fd9\u6761');",
    "          x.textContent = '\u00d7';",
    '          ln.appendChild(x);',
    '        }',
    '      }',
    '      g.appendChild(ln);',
    '      last = b;',
    '    }',
    '    if (typingEl) stream.insertBefore(g, typingEl);',
    '    else stream.appendChild(g);',
    '    toBottom();',
    '    return last;',
    '  }',
    '',
    '  // 思考链：默认收着，点了才展开',
    '  function thinking(text) {',
    '    if (!stream) return;',
    "    var box = document.createElement('div');",
    "    box.className = 'think';",
    "    var top = document.createElement('button');",
    "    top.type = 'button';",
    "    top.className = 'think-top';",
    "    top.setAttribute('data-think', '1');",
    "    top.innerHTML = '<span class=\"think-caret\" aria-hidden=\"true\">\u25b6</span><span>\u60f3\u4e86\u60f3</span>';",
    "    var body = document.createElement('div');",
    "    body.className = 'think-body';",
    '    body.textContent = text;',
    '    box.appendChild(top);',
    '    box.appendChild(body);',
    '    if (typingEl) stream.insertBefore(box, typingEl);',
    '    else stream.appendChild(box);',
    '    toBottom();',
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
    "      typingEl.textContent = who.ai.name + ' \u6b63\u5728\u8bf4\u2026';",
    '      stream.appendChild(typingEl);',
    '      toBottom();',
    '    } else if (!on && typingEl) {',
    '      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);',
    '      typingEl = null;',
    '    }',
    '  }',
    '',
    '  function add(m) {',
    '    if (!m) return;',
    '    if (m.id != null) {',
    '      if (seen[m.id]) return;',
    '      seen[m.id] = 1;',
    '    }',
    "    var kind = m.kind || 'reply';",
    "    if (kind === 'act') {",
    "      var a = document.createElement('div');",
    "      a.className = 'msg-act';",
    "      a.textContent = m.text || '';",
    '      if (typingEl) stream.insertBefore(a, typingEl);',
    '      else stream.appendChild(a);',
    '      toBottom();',
    '      return;',
    '    }',
    "    if (kind === 'thinking') { thinking(m.text || ''); return; }",
    '    // 自己刚发的那条：递出去之后 SSE 会把它原样推回来。',
    '    // 认领本地已经画好的，别让同一句话出现两遍。',
    "    if (m.from === 'human') {",
    '      for (var i = 0; i < pendingMine.length; i++) {',
    "        if (pendingMine[i] === (m.text || '')) {",
    '          pendingMine.splice(i, 1);',
    '          return;',
    '        }',
    '      }',
    '    }',
    "    group(m.from === 'human' ? 'human' : 'ai', m.text || '', m.ts);",
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
    "        b = group('ai', '', Date.now(), { draft: true });",
    '        if (!b) return;',
    '        drafts[sid] = b;',
    '      }',
    '      if (d.done) {',
    '        // 收尾时把草稿整组换成逐句的正式气泡',
    "        var text = d.final_text || b.textContent || '';",
    "        var g = b.closest ? b.closest('.grp') : null;",
    '        if (g && g.parentNode) g.parentNode.removeChild(g);',
    '        delete drafts[sid];',
    '        setTyping(false);',
    "        if (text.trim()) group('ai', text, Date.now());",
    "      } else if (typeof d.text === 'string') {",
    '        // text 可能是累计的也可能是增量的，两种都兜着',
    "        var cur = b.textContent || '';",
    '        b.textContent = d.text.indexOf(cur) === 0 ? d.text : cur + d.text;',
    '        toBottom();',
    '      }',
    '      return;',
    '    }',
    '    if (d.type) return;',
    '    add(d);',
    '  }',
    '',
    '  function showNudge(n) {',
    '    if (!nudge) return;',
    "    if (n > 0) nudge.classList.add('on');",
    "    else nudge.classList.remove('on');",
    "    if (nudgeN) nudgeN.textContent = n > 0 ? '(' + n + ')' : '';",
    '  }',
    '',
    '  if (stream) {',
    "    fetch('/chat/api/history?limit=60', { credentials: 'same-origin' })",
    '      .then(function (r) { return r.ok ? r.json() : null; })',
    '      .then(function (d) {',
    '        if (d) {',
    '          var list = d.messages || [];',
    '          for (var i = 0; i < list.length; i++) add(list[i]);',
    '        }',
    '        // 攒着还没递出去的接在最后，刷页之后也还在',
    "        return fetch('/chat/api/pending', { credentials: 'same-origin' });",
    '      })',
    '      .then(function (r) { return r && r.ok ? r.json() : null; })',
    '      .then(function (d) {',
    '        if (!d) return;',
    '        var list = d.pending || [];',
    '        for (var i = 0; i < list.length; i++) {',
    "          group('human', list[i].text, list[i].created_at, { wait: true, pid: list[i].id });",
    '        }',
    '        showNudge(list.length);',
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
    '  // 点思考链展开 / 收回攒着的那条',
    "  document.addEventListener('click', function (e) {",
    '    if (!e.target.closest) return;',
    "    var th = e.target.closest('[data-think]');",
    "    if (th) { th.parentNode.classList.toggle('on'); return; }",
    "    var dp = e.target.closest('[data-drop]');",
    '    if (dp) {',
    "      var id = dp.getAttribute('data-drop');",
    "      fetch('/chat/api/pending/' + id + '/drop', { method: 'POST', credentials: 'same-origin' })",
    '        .then(function (r) { return r.ok ? r.json() : null; })',
    '        .then(function (d) {',
    '          if (!d || !d.dropped) return;',
    "          var g = dp.closest('.grp');",
    '          if (g && g.parentNode) g.parentNode.removeChild(g);',
    '          showNudge(d.pending);',
    '        })',
    '        .catch(function () {});',
    '    }',
    '  });',
    '',
    "  var sendForm = document.querySelector('[data-send]');",
    '  if (sendForm) {',
    "    sendForm.addEventListener('submit', function (e) {",
    '      e.preventDefault();',
    "      var input = sendForm.querySelector('input');",
    "      var text = input ? String(input.value || '').trim() : '';",
    '      if (!text) return;',
    "      if (input) input.value = '';",
    '      // 先在本地画出来，不等往返——打字发出去该立刻看见。',
    '      // 攒着的状态是半透的，递出去之后才变实。',
    "      var ph = group('human', text, Date.now(), { wait: true });",
    "      fetch('/chat/api/send', {",
    "        method: 'POST',",
    "        credentials: 'same-origin',",
    "        headers: { 'content-type': 'application/json' },",
    '        body: JSON.stringify({ text: text })',
    '      })',
    "        .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })",
    '        .then(function (d) {',
    '          showNudge(d.pending);',
    "          var g = ph && ph.closest ? ph.closest('.grp') : null;",
    '          if (g && d.id) {',
    "            var ln = g.querySelector('.ln:last-child');",
    '            if (ln) {',
    "              var x = document.createElement('button');",
    "              x.type = 'button';",
    "              x.className = 'undo';",
    "              x.setAttribute('data-drop', d.id);",
    "              x.setAttribute('aria-label', '\u6536\u56de\u8fd9\u6761');",
    "              x.textContent = '\u00d7';",
    '              ln.appendChild(x);',
    '            }',
    '          }',
    '        })',
    "        .catch(function (err) { toast('\u6ca1\u5b58\u4e0b\uff1a' + err.message); });",
    '    });',
    '  }',
    '',
    '  // 点「让他读」：把攒着的按顺序递出去。不点就等他下次醒来自己读。',
    '  if (nudge) {',
    "    nudge.addEventListener('click', function () {",
    '      nudge.disabled = true;',
    "      fetch('/chat/api/flush', { method: 'POST', credentials: 'same-origin' })",
    '        .then(function (r) { return r.ok ? r.json() : null; })',
    '        .then(function (d) {',
    '          nudge.disabled = false;',
    '          if (!d) return;',
    '          showNudge(d.remaining);',
    "          if (d.error) { toast('\u6ca1\u9012\u51fa\u53bb\uff1a' + d.error); return; }",
    '          // 递出去了，那几条不再是半透的',
    "          var waiting = stream.querySelectorAll('.grp.wait');",
    '          for (var i = 0; i < waiting.length; i++) {',
    "            waiting[i].classList.remove('wait');",
    "            var x = waiting[i].querySelector('[data-drop]');",
    '            if (x && x.parentNode) x.parentNode.removeChild(x);',
    "            var txt = waiting[i].querySelector('.bub');",
    '            if (txt) pendingMine.push(txt.textContent);',
    '          }',
    '          setTyping(true);',
    '        })',
    "        .catch(function (err) { nudge.disabled = false; toast('\u6ca1\u9012\u51fa\u53bb\uff1a' + err.message); });",
    '    });',
    '  }'
  ].join('\n');

  t = splice('src/chat-page.js', t, '前端逻辑',
    '  // 真的聊天：历史 + SSE + 发送',
    '\n})();',
    JS + '\n})();');

  save('src/chat-page.js', cp.p, t, before);
}

// ════ 3. gateway.js：唤醒时读攒着的话 ════
const gw = load('src/gateway.js');
if (gw) {
  const before = gw.text;
  let t = gw.text;

  t = apply('src/gateway.js', t, 'import chat-queue',
    "import { repairMessages } from './message-repair.js';",
    "import { repairMessages } from './message-repair.js';\n" +
    "import { listPending, markPendingRead } from './chat-queue.js';");

  const FN = [
    '// 网页上攒着、还没递给他的话。',
    '//',
    '// 小满 10-30：「可以发完不点，在允朔下次唤醒的时候读取并回复。」',
    '// 那「下次唤醒」就是这条 heartbeat-wake 线路。和 injectDoing 一样跟在末尾：',
    '// 后面没有需要复用的前缀，每轮变也不影响前面的缓存命中。',
    '//',
    '// 读到就算读过（和动态里 markUserMomentsSeen 一个道理）：没回也不重复递。',
    '// 这意味着这一轮如果上游报错，那几句话不会再出现在下一轮——',
    '// 但数据还在 chat_pending 表里，查得到。',
    'function injectPendingChat(messages) {',
    '  let rows;',
    '  try {',
    '    rows = listPending(20);',
    '  } catch (err) {',
    "    console.error('gateway: \u8bfb\u4e0d\u5230\u6512\u7740\u7684\u8bdd\uff0c\u8fd9\u8f6e\u4e0d\u6ce8\u5165:', err.message);",
    '    return messages;',
    '  }',
    '  if (!rows.length) return messages;',
    '',
    '  const lines = rows',
    "    .map((r) => `\u3010${formatDateTime(r.created_at).slice(5, 16)}\u3011${r.text}`)",
    "    .join('\\n');",
    '  const block =',
    "    '<pending_chat>\\n' +",
    "    '\u5979\u5728\u7f51\u9875\u7684\u804a\u5929\u91cc\u7559\u4e86\u8fd9\u51e0\u53e5\uff0c\u4f60\u8fd8\u6ca1\u8bfb\u8fc7\uff08\u5979\u6ca1\u70b9\u300c\u8ba9\u4f60\u8bfb\u300d\uff0c\u6240\u4ee5\u7559\u5230\u4f60\u9192\u6765\uff09\uff1a\\n' +",
    "    lines +",
    "    '\\n</pending_chat>';",
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
    "      console.log(`gateway: \u9012\u4e86 ${rows.length} \u6761\u6512\u7740\u7684\u8bdd\u7ed9\u5524\u9192\u8fd9\u8f6e`);",
    '    } catch (err) {',
    "      console.error('gateway: \u6512\u7740\u7684\u8bdd\u6807\u8bb0\u5df2\u8bfb\u5931\u8d25:', err.message);",
    '    }',
    '    return out;',
    '  }',
    '  return messages;',
    '}',
    '',
    '// 非流式响应最多缓存这么大，防止异常大的 body 撑爆内存'
  ].join('\n');
  t = apply('src/gateway.js', t, 'injectPendingChat',
    '// 非流式响应最多缓存这么大，防止异常大的 body 撑爆内存',
    FN);

  t = apply('src/gateway.js', t, '唤醒那条线路调它',
    '  let messages = route.injectSharedContext\n' +
    '    ? injectSharedContext(req.body.messages)\n' +
    '    : req.body.messages;',
    '  let messages = route.injectSharedContext\n' +
    '    ? injectSharedContext(req.body.messages)\n' +
    '    : req.body.messages;\n' +
    '\n' +
    '  // 唤醒这轮：把她在网页上攒着、没点「让你读」的话一并递进来。\n' +
    '  // 聊天那条线路不走这儿——她点了按钮的话话已经直接进 relay 了。\n' +
    '  if (route.injectSharedContext) messages = injectPendingChat(messages);');

  save('src/gateway.js', gw.p, t, before);
}

console.log('');
console.log('写了 ' + wrote.size + ' 个文件：' + (Array.from(wrote).join('、') || '无'));
if (failed) {
  console.error('失败 ' + failed + ' 处。');
  process.exitCode = 1;
} else {
  console.log('');
  console.log('pm2 restart vesper vesper-gateway --update-env');
}
