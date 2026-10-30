#!/usr/bin/env node
// 小满 2026-10-30 18:49 那五件。
//
//   1. 气泡间距和头像调大一点
//   2. 最下面的内容还是看不见会截断
//   3. 让他读和发送是一个按键：输入了新内容就是发送，空着就是让他读
//   4. 按时间顺序排消息和动作卡片
//   5. 我发的消息显示已读/未读
//
// ── 第 4 件是其他四件的前提 ──
//
// 行动卡片原来是服务端直接写进 HTML、排在消息流前面的，所以永远在最上面。
// 要按时间排，卡片必须改成数据发下来，和消息、攒着的话一起按 ts 排好再画。
// 所以 ROOM_STYLE 和 ROOM_SCRIPT 两大块整段重写，不再做精确匹配——
// 这两段被前面四个脚本改过，原文已经不可靠（.nudge 那段就叠成了两遍）。
//
// ── 已读/未读的口径 ──
//
// chat_pending 表的 sent 字段就是这个意思：
//   sent=0  还攒着，没递出去      → 未读
//   sent=1  递出去了（点按钮或唤醒读到）→ 已读
// relay 历史里的消息都是递过的，所以都算已读。
// 这不是「他真的读懂了」，是「进不进了他的输入」——后者是我能确定的。
//
// ── 底部截断 ──
//
// 固定的 padding-bottom 总有算不准的时候（安全区、按钮冒出来、转屏）。
// 改成量输入框的实际位置：它的顶边到视口底部有多远，就留多少（再加 24px）。
// 标签栏在输入框下面，已经被这个距离包含。
//
// 重跑安全。备份在 src/.chat-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const cpPath = join(srcDir, 'chat-page.js');
const bakDir = join(srcDir, '.chat-backup');
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(cpPath)) {
  console.error('✗ chat-page.js 不在');
  process.exit(1);
}
if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

let t = readFileSync(cpPath, 'utf8');
const stamp = String(Date.now());
writeFileSync(join(bakDir, 'chat-page.' + stamp + '.js'), t, 'utf8');
console.log('备份：src/.chat-backup/chat-page.' + stamp + '.js');
console.log('');

// ════ 1. activityCards 要带 ts ════
console.log('1/5  卡片带上时间戳');
{
  const find = 'return { id: m.id, when, body, detail: tidyActivityDetail(m.detail) };';
  const repl = 'return { id: m.id, ts: m.ts, when, body, detail: tidyActivityDetail(m.detail) };';
  if (t.includes(repl)) console.log('  · 已经有了');
  else if (t.includes(find)) { t = t.replace(find, repl); console.log('  ✓'); }
  else { console.error('  ✗ 找不到 activityCards 的 return'); failed++; }
}

// ════ 2. ROOM_STYLE 整段重写 ════
console.log('');
console.log('2/5  ROOM_STYLE');

const STYLE = L(
  'const ROOM_STYLE = `',
  '  :root { --ink: #1a1a1a; --muted: #7a7a7a; --card: #ffffff; --line: #e4e4e4; }',
  '  * { box-sizing: border-box; }',
  '  body { margin: 0; min-height: 100vh; color: var(--ink);',
  '    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }',
  '  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto;',
  '    padding: 60px 16px 220px; }',
  '',
  '  /* 顶条：窗的名字。返回键在左上角（tabs.js 负责插），所以这儿居中 */',
  '  .room-top { position: fixed; top: calc(12px + env(safe-area-inset-top, 0px)); left: 0; right: 0;',
  '    z-index: 60; text-align: center; pointer-events: none; }',
  '  .room-name { display: inline-block; max-width: 56%; padding: 8px 14px; border-radius: 999px;',
  '    background: rgba(255, 255, 255, 0.94); backdrop-filter: blur(10px); border: 1px solid var(--line);',
  '    font-size: 13px; font-weight: 600; color: var(--ink);',
  '    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;',
  '    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.06); }',
  '',
  '  /* 行动卡片：居中、没底色。和消息按时间混在一起排（小满 10-30） */',
  '  .card { display: block; width: 100%; margin: 14px 0; padding: 2px 10px; border: none;',
  '    background: none; text-align: center; font: inherit; color: var(--muted);',
  '    -webkit-appearance: none; appearance: none; }',
  '  .card-when { display: block; font-size: 11px; color: #9a9a9a;',
  '    font-variant-numeric: tabular-nums; }',
  '  .card-body { display: block; margin-top: 3px; font-size: 13px; line-height: 1.6; color: var(--muted); }',
  '  .card-more { display: inline-block; margin-top: 3px; font-size: 10px; color: #b8b8b8; }',
  '  .card.tap { cursor: pointer; border-radius: 14px; }',
  '  .card.tap:active { background: rgba(0, 0, 0, 0.04); }',
  '',
  '  /* 说过的话。一组 = 一次张口，里面按句子拆成几个气泡：',
  '     每句左边都有头像（第二句起隐形占位，所以缩进对齐），',
  '     名字只在第一句上面出一次，时间只跟在最后一个气泡旁边。',
  '     尺寸比上一版大一圈（小满 10-30：气泡间距和头像调大一点） */',
  '  .grp { margin: 0 0 18px; }',
  '  .ln { display: flex; align-items: flex-end; gap: 9px; margin-bottom: 6px; }',
  '  .grp.me .ln { flex-direction: row-reverse; }',
  '  .av { flex: none; width: 38px; height: 38px; border-radius: 50%; overflow: hidden;',
  '    background: #f0f0f0; border: 1px solid var(--line); display: flex;',
  '    align-items: center; justify-content: center; font-size: 14px; color: var(--ink); }',
  '  .av img { width: 100%; height: 100%; object-fit: cover; display: block; }',
  '  .av.ghost { visibility: hidden; }',
  '  .who { margin: 0 0 5px 47px; font-size: 11px; color: var(--muted); }',
  '  .grp.me .who { margin: 0 47px 5px 0; text-align: right; }',
  '  .bub { max-width: 72%; padding: 11px 15px; border-radius: 18px; font-size: 15px;',
  '    line-height: 1.7; white-space: pre-wrap; word-break: break-word; }',
  '  .grp.me .bub { background: #1a1a1a; color: #fdfdfd; border-bottom-right-radius: 6px; }',
  '  .grp.ta .bub { background: #f0f0f0; color: var(--ink); border-bottom-left-radius: 6px; }',
  '  .bub.draft { opacity: 0.72; }',
  '',
  '  /* 时间和已读/未读：只跟在最后一个气泡旁边。',
  '     flex-direction 已经把我这边翻过来了，所以同样 append 就是他的在右、我的在左 */',
  '  .meta { flex: none; display: flex; flex-direction: column; align-items: flex-end;',
  '    gap: 2px; padding-bottom: 3px; }',
  '  .grp.me .meta { align-items: flex-start; }',
  '  .at { font-size: 10px; color: #a0a0a0; font-variant-numeric: tabular-nums; }',
  '  .seen { font-size: 10px; color: #b0b0b0; }',
  '  .seen.unread { color: #6a6a6a; }',
  '',
  '  /* 攒着还没递出去的：气泡半透，旁边一个小叉可以收回 */',
  '  .grp.wait .bub { opacity: 0.55; }',
  '  .undo { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line);',
  '    background: var(--card); color: var(--muted); font-size: 13px; line-height: 1; padding: 0; }',
  '',
  '  /* 思考链：默认只一条，点了才展开（和 Aru 那边一样） */',
  '  .think { margin: 0 0 12px 47px; }',
  '  .think-top { display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;',
  '    background: none; border: 1px solid var(--line); border-radius: 999px;',
  '    font: inherit; font-size: 11px; color: var(--muted); }',
  '  .think-caret { font-size: 9px; transition: transform 0.15s; }',
  '  .think.on .think-caret { transform: rotate(90deg); }',
  '  .think-body { display: none; margin: 7px 0 0; padding: 10px 13px; border-radius: 12px;',
  '    background: #f7f7f7; border: 1px dashed var(--line);',
  '    font-size: 12px; line-height: 1.75; color: var(--muted);',
  '    white-space: pre-wrap; word-break: break-word; }',
  '  .think.on .think-body { display: block; }',
  '',
  '  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }',
  '  .typing { margin: 0 0 12px 47px; font-size: 12px; color: var(--muted); }',
  '',
  '  /* 详情：居中，底下留出输入框和标签栏的高度 */',
  '  .sheet { position: fixed; inset: 0; z-index: 95; display: none; align-items: center;',
  '    justify-content: center; padding: 16px 16px calc(96px + env(safe-area-inset-bottom, 0px));',
  '    background: rgba(0, 0, 0, 0.32); }',
  '  .sheet.on { display: flex; }',
  '  .sheet-box { width: 100%; max-width: 560px; max-height: 68vh; overflow-y: auto;',
  '    background: var(--card); border: 1px solid var(--line); border-radius: 18px;',
  '    padding: 16px 18px 18px; box-shadow: 0 12px 34px rgba(0, 0, 0, 0.18); }',
  '  .sheet-head { display: flex; align-items: center; justify-content: space-between; gap: 12px;',
  '    margin-bottom: 10px; }',
  '  .sheet-when { font-size: 12px; color: var(--muted); }',
  '  .sheet-x { border: none; background: none; font-size: 20px; line-height: 1; color: var(--muted);',
  '    padding: 6px 4px; }',
  '  .sheet-title { margin: 0 0 8px; font-size: 14px; font-weight: 600; color: var(--ink); }',
  '  .sheet-body { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap;',
  '    word-break: break-word; color: var(--ink); font-family: inherit; }',
  '',
  '  /* 输入框。发送和「让他读」是同一个按钮（小满 10-30）：',
  '     输入框有字 = 发送，空着 = 把攒着的递给他。',
  '     两个按钮挤在一起是之前那个点错问题的根，合成一个就不存在了 */',
  '  .composer { position: fixed; left: 50%; transform: translateX(-50%);',
  '    bottom: calc(76px + env(safe-area-inset-bottom, 0px)); z-index: 80;',
  '    display: flex; gap: 8px; width: calc(100% - 24px); max-width: 440px; padding: 7px;',
  '    background: rgba(255, 255, 255, 0.96); backdrop-filter: blur(10px);',
  '    border: 1px solid var(--line); border-radius: 22px; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); }',
  '  .composer input { flex: 1; min-width: 0; height: 40px; padding: 0 13px; border-radius: 15px;',
  '    border: 1px solid var(--line); background: #fff; font-size: 15px; color: var(--ink); }',
  '  .go { flex: none; min-width: 40px; height: 40px; padding: 0 13px; border-radius: 15px;',
  '    border: none; background: #1a1a1a; color: #fdfdfd; font-size: 14px; white-space: nowrap; }',
  '  .go:disabled { background: #d4d4d4; color: #fafafa; }',
  '',
  '  .tip { position: fixed; left: 50%; transform: translateX(-50%);',
  '    bottom: calc(130px + env(safe-area-inset-bottom, 0px)); z-index: 96;',
  '    max-width: calc(100% - 40px); padding: 9px 16px; border-radius: 999px;',
  '    background: rgba(26, 26, 26, 0.9); color: #fdfdfd; font-size: 12px; line-height: 1.5;',
  '    opacity: 0; pointer-events: none; transition: opacity 0.22s ease; }',
  '  .tip.on { opacity: 1; }',
  '',
  '  .empty { text-align: center; font-size: 13px; line-height: 1.7; color: var(--muted); margin: 32px 10px; }',
  '`;'
);

{
  const a = t.indexOf('const ROOM_STYLE = `');
  const b = t.indexOf('const ROOM_SCRIPT');
  if (a < 0 || b < 0 || b < a) {
    console.error('  ✗ 定不到 ROOM_STYLE 的起止');
    failed++;
  } else {
    // 把 ROOM_SCRIPT 前面那段注释也带上（从注释开头切）
    let cut = b;
    const cm = t.lastIndexOf('// 进来就停在最新那条', b);
    if (cm > a) cut = cm;
    t = t.slice(0, a) + STYLE + '\n\n' + t.slice(cut);
    console.log('  ✓ 整段重写（气泡 15px/行高 1.7、头像 38px、间距 18px）');
  }
}

// ════ 3. ROOM_SCRIPT 整段重写 ════
console.log('');
console.log('3/5  ROOM_SCRIPT');

const SCRIPT = L(
  '// 进来就停在最新那条。滚三次：立刻、load 后、120ms 后——',
  '// 字体加载完和 fixed 元素入场都会推一把布局。',
  '//',
  '// 注：这整段是模板字符串，里面不能出现 ${ —— 会被当成插值。',
  '// 字符串拼接一律用 +。',
  'const ROOM_SCRIPT = `(function () {',
  '  var main = document.querySelector(\'main\');',
  '  var stream = document.querySelector(\'[data-stream]\');',
  '  var tipEl = document.querySelector(\'[data-tip]\');',
  '  var form = document.querySelector(\'[data-send]\');',
  '  var input = form && form.querySelector(\'input\');',
  '  var btn = document.querySelector(\'[data-go]\');',
  '  if (!stream) return;',
  '',
  '  function toBottom() {',
  '    try { window.scrollTo(0, document.documentElement.scrollHeight); } catch (e) {}',
  '  }',
  '',
  '  // 底部留白：量输入框的实际位置，不写固定值。',
  '  // 固定值总有算不准的时候（安全区、按钮文字变长、转屏），',
  '  // 而标签栏在输入框下面，已经被这个距离包含。',
  '  function fitBottom() {',
  '    if (!main || !form) return;',
  '    var top = form.getBoundingClientRect().top;',
  '    var need = Math.max(160, Math.round(window.innerHeight - top + 24));',
  '    main.style.paddingBottom = need + \'px\';',
  '  }',
  '',
  '  function attr(k, d) {',
  '    var v = stream.getAttribute(k);',
  '    return v ? v : d;',
  '  }',
  '  var who = {',
  '    ai: { name: attr(\'data-ta-name\', \'TA\'), av: attr(\'data-ta-av\', \'\') },',
  '    human: { name: attr(\'data-me-name\', \'我\'), av: attr(\'data-me-av\', \'\') }',
  '  };',
  '',
  '  function toast(text) {',
  '    if (!tipEl) return;',
  '    tipEl.textContent = text;',
  '    tipEl.classList.add(\'on\');',
  '    setTimeout(function () { tipEl.classList.remove(\'on\'); }, 2800);',
  '  }',
  '',
  '  function hhmm(ts) {',
  '    var d = ts ? new Date(ts) : new Date();',
  '    var h = d.getHours(), m = d.getMinutes();',
  '    return (h < 10 ? \'0\' : \'\') + h + \':\' + (m < 10 ? \'0\' : \'\') + m;',
  '  }',
  '',
  '  // 逐句：句读点和换行都算一句。标点留在句尾，后面跟的引号、来号也跟着走。',
  '  function sentences(text) {',
  '    var s = String(text == null ? \'\' : text).trim();',
  '    if (!s) return [];',
  '    var out = [];',
  '    var buf = \'\';',
  '    var stop = \'。！？!?…\';',
  '    var tail = \'”’）)」』。！？!?…\';',
  '    for (var i = 0; i < s.length; i++) {',
  '      var c = s.charAt(i);',
  '      if (c === \'\\n\') {',
  '        if (buf.trim()) out.push(buf.trim());',
  '        buf = \'\';',
  '        continue;',
  '      }',
  '      buf += c;',
  '      if (stop.indexOf(c) >= 0) {',
  '        while (i + 1 < s.length && tail.indexOf(s.charAt(i + 1)) >= 0) { buf += s.charAt(++i); }',
  '        if (buf.trim()) out.push(buf.trim());',
  '        buf = \'\';',
  '      }',
  '    }',
  '    if (buf.trim()) out.push(buf.trim());',
  '    return out.length ? out : [s];',
  '  }',
  '',
  '  var typingEl = null;',
  '  function setTyping(on) {',
  '    if (on && !typingEl) {',
  '      typingEl = document.createElement(\'div\');',
  '      typingEl.className = \'typing\';',
  '      typingEl.textContent = who.ai.name + \' 正在说…\';',
  '      stream.appendChild(typingEl);',
  '      toBottom();',
  '    } else if (!on && typingEl) {',
  '      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);',
  '      typingEl = null;',
  '    }',
  '  }',
  '',
  '  function put(el) {',
  '    if (typingEl) stream.insertBefore(el, typingEl);',
  '    else stream.appendChild(el);',
  '  }',
  '',
  '  function avatar(side, ghost) {',
  '    var el = document.createElement(\'div\');',
  '    el.className = \'av\' + (ghost ? \' ghost\' : \'\');',
  '    var info = who[side] || who.ai;',
  '    if (info.av) {',
  '      var img = document.createElement(\'img\');',
  '      img.src = info.av;',
  '      img.alt = \'\';',
  '      el.appendChild(img);',
  '    } else {',
  '      el.textContent = (info.name || \'?\').slice(0, 1);',
  '    }',
  '    return el;',
  '  }',
  '',
  '  function undoBtn(pid) {',
  '    var x = document.createElement(\'button\');',
  '    x.type = \'button\';',
  '    x.className = \'undo\';',
  '    x.setAttribute(\'data-drop\', pid);',
  '    x.setAttribute(\'aria-label\', \'收回这条\');',
  '    x.textContent = \'\\u00d7\';',
  '    return x;',
  '  }',
  '',
  '  // 一组话。side 是 human 或 ai。read：\'read\' 已读、\'unread\' 未读、null 不显示。',
  '  // 返回最后一个气泡元素（流式草稿要接着往里写）。',
  '  function group(side, text, ts, opts) {',
  '    opts = opts || {};',
  '    var lines = opts.draft ? [text] : sentences(text);',
  '    if (!lines.length) return null;',
  '    var g = document.createElement(\'div\');',
  '    g.className = \'grp \' + (side === \'human\' ? \'me\' : \'ta\') + (opts.wait ? \' wait\' : \'\');',
  '',
  '    var nm = document.createElement(\'div\');',
  '    nm.className = \'who\';',
  '    nm.textContent = (who[side] || who.ai).name;',
  '    g.appendChild(nm);',
  '',
  '    var last = null;',
  '    for (var i = 0; i < lines.length; i++) {',
  '      var ln = document.createElement(\'div\');',
  '      ln.className = \'ln\';',
  '      ln.appendChild(avatar(side, i > 0));',
  '      var b = document.createElement(\'div\');',
  '      b.className = \'bub\' + (opts.draft ? \' draft\' : \'\');',
  '      b.textContent = lines[i];',
  '      ln.appendChild(b);',
  '      if (i === lines.length - 1) {',
  '        var meta = document.createElement(\'div\');',
  '        meta.className = \'meta\';',
  '        var at = document.createElement(\'span\');',
  '        at.className = \'at\';',
  '        at.textContent = hhmm(ts);',
  '        meta.appendChild(at);',
  '        // 已读/未读：只给自己发的。口径是「进不进了他的输入」，',
  '        // 不是「他真的读懂了」——后者我确定不了。',
  '        if (opts.read) {',
  '          var sn = document.createElement(\'span\');',
  '          sn.className = \'seen\' + (opts.read === \'unread\' ? \' unread\' : \'\');',
  '          sn.textContent = opts.read === \'unread\' ? \'未读\' : \'已读\';',
  '          meta.appendChild(sn);',
  '        }',
  '        ln.appendChild(meta);',
  '        if (opts.wait && opts.pid) ln.appendChild(undoBtn(opts.pid));',
  '      }',
  '      g.appendChild(ln);',
  '      last = b;',
  '    }',
  '    put(g);',
  '    return last;',
  '  }',
  '',
  '  function thinking(text) {',
  '    var box = document.createElement(\'div\');',
  '    box.className = \'think\';',
  '    var top = document.createElement(\'button\');',
  '    top.type = \'button\';',
  '    top.className = \'think-top\';',
  '    top.setAttribute(\'data-think\', \'1\');',
  '    var caret = document.createElement(\'span\');',
  '    caret.className = \'think-caret\';',
  '    caret.setAttribute(\'aria-hidden\', \'true\');',
  '    caret.textContent = \'\\u25b6\';',
  '    var label = document.createElement(\'span\');',
  '    label.textContent = \'想了想\';',
  '    top.appendChild(caret);',
  '    top.appendChild(label);',
  '    var body = document.createElement(\'div\');',
  '    body.className = \'think-body\';',
  '    body.textContent = text;',
  '    box.appendChild(top);',
  '    box.appendChild(body);',
  '    put(box);',
  '  }',
  '',
  '  // 行动卡片。和消息按时间混排，所以这儿也是前端画。',
  '  var details = {};',
  '  function cardEl(c) {',
  '    var has = !!c.detail;',
  '    if (has) details[c.id] = c.detail;',
  '    var el = document.createElement(has ? \'button\' : \'div\');',
  '    el.className = \'card\' + (has ? \' tap\' : \'\');',
  '    if (has) {',
  '      el.type = \'button\';',
  '      el.setAttribute(\'data-detail\', c.id);',
  '    }',
  '    var w = document.createElement(\'span\');',
  '    w.className = \'card-when\';',
  '    w.textContent = c.when || \'\';',
  '    var b = document.createElement(\'span\');',
  '    b.className = \'card-body\';',
  '    b.textContent = c.body || \'\';',
  '    el.appendChild(w);',
  '    el.appendChild(b);',
  '    if (has) {',
  '      var m = document.createElement(\'span\');',
  '      m.className = \'card-more\';',
  '      m.setAttribute(\'aria-hidden\', \'true\');',
  '      m.textContent = \'\\u2726\';',
  '      el.appendChild(m);',
  '    }',
  '    put(el);',
  '  }',
  '',
  '  var seen = {};',
  '  var drafts = {};',
  '  var mine = [];',
  '  var pendingN = 0;',
  '',
  '  function paint(it) {',
  '    if (it.t === \'card\') { cardEl(it.c); return; }',
  '    if (it.t === \'pending\') {',
  '      group(\'human\', it.text, it.ts, { wait: true, pid: it.id, read: \'unread\' });',
  '      return;',
  '    }',
  '    var m = it.m;',
  '    var kind = m.kind || \'reply\';',
  '    if (kind === \'act\') {',
  '      var a = document.createElement(\'div\');',
  '      a.className = \'msg-act\';',
  '      a.textContent = m.text || \'\';',
  '      put(a);',
  '      return;',
  '    }',
  '    if (kind === \'thinking\') { thinking(m.text || \'\'); return; }',
  '    var human = m.from === \'human\';',
  '    // relay 历史里我的消息都已经递过了，所以都算已读',
  '    group(human ? \'human\' : \'ai\', m.text || \'\', m.ts, human ? { read: \'read\' } : {});',
  '  }',
  '',
  '  // SSE 推来的新消息：直接接在最后（它就是最新的）',
  '  function add(m) {',
  '    if (!m) return;',
  '    if (m.id != null) {',
  '      if (seen[m.id]) return;',
  '      seen[m.id] = 1;',
  '    }',
  '    // 自己刚递出去的那条：SSE 会把它原样推回来。',
  '    // 认领本地已经画好的，别让同一句话出现两遍。',
  '    if (m.from === \'human\') {',
  '      for (var i = 0; i < mine.length; i++) {',
  '        if (mine[i] === (m.text || \'\')) {',
  '          mine.splice(i, 1);',
  '          return;',
  '        }',
  '      }',
  '    }',
  '    paint({ t: \'msg\', m: m });',
  '    toBottom();',
  '  }',
  '',
  '  function onFrame(d) {',
  '    if (!d || typeof d !== \'object\') return;',
  '    if (d.type === \'ping\' || d.type === \'reaction\') return;',
  '    if (d.type === \'typing\') { setTyping(!!d.active); return; }',
  '    if (d.type === \'reply_delta\') {',
  '      var sid = d.stream_id || \'one\';',
  '      var b = drafts[sid];',
  '      if (!b) {',
  '        b = group(\'ai\', \'\', Date.now(), { draft: true });',
  '        if (!b) return;',
  '        drafts[sid] = b;',
  '      }',
  '      if (d.done) {',
  '        var text = d.final_text || b.textContent || \'\';',
  '        var g = b.closest ? b.closest(\'.grp\') : null;',
  '        if (g && g.parentNode) g.parentNode.removeChild(g);',
  '        delete drafts[sid];',
  '        setTyping(false);',
  '        if (text.trim()) group(\'ai\', text, Date.now());',
  '        toBottom();',
  '      } else if (typeof d.text === \'string\') {',
  '        var cur = b.textContent || \'\';',
  '        b.textContent = d.text.indexOf(cur) === 0 ? d.text : cur + d.text;',
  '        toBottom();',
  '      }',
  '      return;',
  '    }',
  '    if (d.type) return;',
  '    add(d);',
  '  }',
  '',
  '  // 按钮：输入框有字 = 发送，空着 = 把攒着的递给他。两个按钮合成一个。',
  '  function syncBtn() {',
  '    if (!btn) return;',
  '    var has = input && input.value.trim().length > 0;',
  '    if (has) {',
  '      btn.textContent = \'\\u2191\';',
  '      btn.disabled = false;',
  '      btn.setAttribute(\'data-act\', \'send\');',
  '      btn.setAttribute(\'aria-label\', \'发送\');',
  '    } else if (pendingN > 0) {',
  '      btn.textContent = \'让\' + who.ai.name + \'读 \' + pendingN;',
  '      btn.disabled = false;',
  '      btn.setAttribute(\'data-act\', \'flush\');',
  '      btn.setAttribute(\'aria-label\', \'把攒着的话递给他\');',
  '    } else {',
  '      btn.textContent = \'\\u2191\';',
  '      btn.disabled = true;',
  '      btn.removeAttribute(\'data-act\');',
  '    }',
  '    fitBottom();',
  '  }',
  '',
  '  // ── 开场：卡片 + 历史 + 攒着的，按时间排好再画（小满 10-30）──',
  '  var cards = [];',
  '  try {',
  '    var tag = document.querySelector(\'[data-cards]\');',
  '    if (tag) cards = JSON.parse(tag.textContent || \'[]\');',
  '  } catch (e) { cards = []; }',
  '',
  '  fetch(\'/chat/api/history?limit=60\', { credentials: \'same-origin\' })',
  '    .then(function (r) { return r.ok ? r.json() : null; })',
  '    .then(function (d) {',
  '      var msgs = (d && d.messages) || [];',
  '      for (var i = 0; i < msgs.length; i++) {',
  '        if (msgs[i].id != null) seen[msgs[i].id] = 1;',
  '      }',
  '      return fetch(\'/chat/api/pending\', { credentials: \'same-origin\' })',
  '        .then(function (r) { return r.ok ? r.json() : null; })',
  '        .then(function (p) { return { msgs: msgs, pend: (p && p.pending) || [] }; });',
  '    })',
  '    .then(function (all) {',
  '      if (!all) return;',
  '      var items = [];',
  '      for (var i = 0; i < cards.length; i++) {',
  '        items.push({ t: \'card\', ts: cards[i].ts || 0, c: cards[i] });',
  '      }',
  '      for (var j = 0; j < all.msgs.length; j++) {',
  '        items.push({ t: \'msg\', ts: all.msgs[j].ts || 0, m: all.msgs[j] });',
  '      }',
  '      for (var k = 0; k < all.pend.length; k++) {',
  '        items.push({',
  '          t: \'pending\', ts: all.pend[k].created_at || 0,',
  '          id: all.pend[k].id, text: all.pend[k].text',
  '        });',
  '      }',
  '      items.sort(function (a, b) { return a.ts - b.ts; });',
  '      for (var n = 0; n < items.length; n++) paint(items[n]);',
  '      pendingN = all.pend.length;',
  '      syncBtn();',
  '      fitBottom();',
  '      toBottom();',
  '    })',
  '    .catch(function () {});',
  '',
  '  try {',
  '    var es = new EventSource(\'/chat/api/stream\');',
  '    es.onmessage = function (e) {',
  '      if (!e.data) return;',
  '      try { onFrame(JSON.parse(e.data)); } catch (err) {}',
  '    };',
  '    es.onerror = function () { setTyping(false); };',
  '  } catch (err) {}',
  '',
  '  // 点思考链展开 / 卡片详情 / 收回攒着的那条',
  '  var sheet = document.querySelector(\'[data-sheet]\');',
  '  var sbox = sheet && sheet.querySelector(\'[data-sheet-body]\');',
  '  var swhen = sheet && sheet.querySelector(\'[data-sheet-when]\');',
  '  function closeSheet() {',
  '    if (!sheet) return;',
  '    sheet.classList.remove(\'on\');',
  '    document.body.style.overflow = \'\';',
  '  }',
  '  document.addEventListener(\'click\', function (e) {',
  '    if (!e.target.closest) return;',
  '    var th = e.target.closest(\'[data-think]\');',
  '    if (th) { th.parentNode.classList.toggle(\'on\'); return; }',
  '    var card = e.target.closest(\'.card.tap\');',
  '    if (card && sheet && sbox) {',
  '      var id = card.getAttribute(\'data-detail\');',
  '      sbox.textContent = details[id] || \'\';',
  '      var w = card.querySelector(\'.card-when\');',
  '      if (swhen) swhen.textContent = w ? w.textContent : \'\';',
  '      sheet.classList.add(\'on\');',
  '      document.body.style.overflow = \'hidden\';',
  '      return;',
  '    }',
  '    if (e.target.closest(\'[data-sheet-x]\') || e.target === sheet) { closeSheet(); return; }',
  '    var dp = e.target.closest(\'[data-drop]\');',
  '    if (!dp) return;',
  '    fetch(\'/chat/api/pending/\' + dp.getAttribute(\'data-drop\') + \'/drop\',',
  '      { method: \'POST\', credentials: \'same-origin\' })',
  '      .then(function (r) { return r.ok ? r.json() : null; })',
  '      .then(function (d) {',
  '        if (!d || !d.dropped) return;',
  '        var g = dp.closest(\'.grp\');',
  '        if (g && g.parentNode) g.parentNode.removeChild(g);',
  '        pendingN = d.pending;',
  '        syncBtn();',
  '      })',
  '      .catch(function () {});',
  '  });',
  '  document.addEventListener(\'keydown\', function (e) { if (e.key === \'Escape\') closeSheet(); });',
  '',
  '  function doSend() {',
  '    var text = input ? String(input.value || \'\').trim() : \'\';',
  '    if (!text) return;',
  '    if (input) input.value = \'\';',
  '    syncBtn();',
  '    // 先在本地画出来，不等往返——打字发出去该立刻看见。',
  '    var ph = group(\'human\', text, Date.now(), { wait: true, read: \'unread\' });',
  '    toBottom();',
  '    fetch(\'/chat/api/send\', {',
  '      method: \'POST\',',
  '      credentials: \'same-origin\',',
  '      headers: { \'content-type\': \'application/json\' },',
  '      body: JSON.stringify({ text: text })',
  '    })',
  '      .then(function (r) { return r.ok ? r.json() : Promise.reject(new Error(\'HTTP \' + r.status)); })',
  '      .then(function (d) {',
  '        pendingN = d.pending;',
  '        syncBtn();',
  '        var g = ph && ph.closest ? ph.closest(\'.grp\') : null;',
  '        if (!g || !d.id) return;',
  '        var lns = g.querySelectorAll(\'.ln\');',
  '        if (lns.length) lns[lns.length - 1].appendChild(undoBtn(d.id));',
  '      })',
  '      .catch(function (err) { toast(\'没存下：\' + err.message); });',
  '  }',
  '',
  '  function doFlush() {',
  '    if (!btn) return;',
  '    btn.disabled = true;',
  '    fetch(\'/chat/api/flush\', { method: \'POST\', credentials: \'same-origin\' })',
  '      .then(function (r) { return r.ok ? r.json() : null; })',
  '      .then(function (d) {',
  '        if (!d) { syncBtn(); return; }',
  '        pendingN = d.remaining;',
  '        syncBtn();',
  '        if (d.error) { toast(\'没递出去：\' + d.error); return; }',
  '        // 递出去了：不再半透，未读改已读，小叉收走',
  '        var waiting = stream.querySelectorAll(\'.grp.wait\');',
  '        for (var i = 0; i < waiting.length; i++) {',
  '          waiting[i].classList.remove(\'wait\');',
  '          var x = waiting[i].querySelector(\'[data-drop]\');',
  '          if (x && x.parentNode) x.parentNode.removeChild(x);',
  '          var sn = waiting[i].querySelector(\'.seen\');',
  '          if (sn) { sn.textContent = \'已读\'; sn.classList.remove(\'unread\'); }',
  '          var txt = waiting[i].querySelector(\'.bub\');',
  '          if (txt) mine.push(txt.textContent);',
  '        }',
  '        if (d.sent) setTyping(true);',
  '        toBottom();',
  '      })',
  '      .catch(function (err) { syncBtn(); toast(\'没递出去：\' + err.message); });',
  '  }',
  '',
  '  if (form) {',
  '    form.addEventListener(\'submit\', function (e) {',
  '      e.preventDefault();',
  '      if (input && input.value.trim()) doSend();',
  '      else if (pendingN > 0) doFlush();',
  '    });',
  '  }',
  '  if (btn) {',
  '    btn.addEventListener(\'click\', function (e) {',
  '      e.preventDefault();',
  '      if (btn.getAttribute(\'data-act\') === \'send\') doSend();',
  '      else if (btn.getAttribute(\'data-act\') === \'flush\') doFlush();',
  '    });',
  '  }',
  '  if (input) {',
  '    input.addEventListener(\'input\', syncBtn);',
  '    input.addEventListener(\'focus\', function () { setTimeout(fitBottom, 300); });',
  '    input.addEventListener(\'blur\', function () { setTimeout(fitBottom, 300); });',
  '  }',
  '',
  '  syncBtn();',
  '  fitBottom();',
  '  toBottom();',
  '  window.addEventListener(\'load\', function () { fitBottom(); toBottom(); });',
  '  window.addEventListener(\'resize\', fitBottom);',
  '  setTimeout(function () { fitBottom(); toBottom(); }, 120);',
  '})()`;'
);

{
  const a = t.indexOf('// 进来就停在最新那条');
  const a2 = a >= 0 ? a : t.indexOf('const ROOM_SCRIPT');
  const b = t.indexOf('function layout(');
  if (a2 < 0 || b < 0 || b < a2) {
    console.error('  ✗ 定不到 ROOM_SCRIPT 的起止');
    failed++;
  } else {
    t = t.slice(0, a2) + SCRIPT + '\n\n' + t.slice(b);
    console.log('  ✓ 整段重写（排序、合并按钮、已读未读、底部自动量）');
  }
}

// ════ 4. renderCards 改成发 JSON ════
console.log('');
console.log('4/5  卡片改成数据发下来');

const RC = L(
  '// 卡片不再服务端直接写成 HTML：要和消息按时间混排，必须交给前端。',
  '// 小满 10-30：「按时间顺序排消息和动作卡片」。',
  '// < 转成 \\u003c：正文里如果出现 </script> 会把这个标签提前打断。',
  'function renderCards(cards) {',
  '  const json = JSON.stringify(cards).replace(/</g, \'\\\\u003c\');',
  '  return `<script type="application/json" data-cards>${json}</script>`;',
  '}'
);

{
  const a = t.indexOf('function renderCards(cards) {');
  if (a < 0) {
    console.error('  ✗ 找不到 renderCards');
    failed++;
  } else if (t.includes('data-cards')) {
    console.log('  · 已经是这样了');
  } else {
    // 往前吞注释
    let from = a;
    const cm = t.lastIndexOf('// 旧的在上', a);
    const cm2 = t.lastIndexOf('function renderCards', a);
    if (cm > 0 && a - cm < 600) from = t.lastIndexOf('\n', cm) + 1;
    const b = t.indexOf('export function registerChatRoutes', a);
    if (b < 0) {
      console.error('  ✗ 找不到 registerChatRoutes');
      failed++;
    } else {
      t = t.slice(0, from) + RC + '\n\n' + t.slice(b);
      console.log('  ✓');
    }
  }
}

// ════ 5. 路由里的 HTML：合并按钮、卡片位置 ════
console.log('');
console.log('5/5  输入框那一行');

{
  // 旧的：两个按钮（nudge + submit）。新的：一个。
  const a = t.indexOf('<form class="composer" data-send');
  const b = t.indexOf('</form>', a);
  if (a < 0 || b < 0) {
    console.error('  ✗ 找不到 composer');
    failed++;
  } else if (t.includes('data-go')) {
    console.log('  · 已经是单按钮了');
  } else {
    const NEW = L(
      '<form class="composer" data-send onsubmit="return false">',
      '        <input type="text" placeholder="说点什么…" aria-label="输入" />',
      '        <button type="submit" class="go" data-go aria-label="发送">\u2191</button>',
      '      </form>'
    );
    t = t.slice(0, a) + NEW + t.slice(b + '</form>'.length);
    console.log('  ✓ 合成一个按钮');
  }

  // 旧窗不再说「这是个旧窗」那句——现在消息和卡片混排，老窗里也有消息
  const old = '<p class="empty">这是个旧窗。行动卡片只往最新那个窗里摆。</p>';
  if (t.includes(old)) {
    t = t.replace(old, '');
    console.log('  ✓ 去掉老窗那句提示');
  }
}

writeFileSync(cpPath, t, 'utf8');

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp src/.chat-backup/chat-page.' + stamp + '.js src/chat-page.js && pm2 restart vesper');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('回滚：cp src/.chat-backup/chat-page.' + stamp + '.js src/chat-page.js && pm2 restart vesper');
}
