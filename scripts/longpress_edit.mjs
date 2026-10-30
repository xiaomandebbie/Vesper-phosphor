#!/usr/bin/env node
// 小满 2026-10-30 20:40：「我的消息不要左边有叉叉」「消息长按编辑/删除」
//
// 那个叉是我给攒着的消息做的「收回」，位置算错了：
// .grp.me .ln 是 row-reverse，所以 append 进去的元素会跑到最左。
// 长按菜单正好替掉它：收回这事不必常驻一个按钮。
//
// ── 哪些能改、哪些不能 ──
//
// 攒着还没递出去的（组上有 data-pid）：能编辑、能删——还在我们自己库里。
// 已经递出去的：只能复制。它进了 relay 的库和他的上文，在网页上抹掉
// 只是自己看不见——那是假的删除，比不给更坏。
//
// ── 上一版为什么炸了 ──
//
// 170 行那个单引号字符串里写了真实换行（还有两处同样的毛病）。
// JavaScript 的普通字符串不能跳行——这是今天第三次犯同一个错。
// 这一版所有多行文本一律过 L(...)，单行字符串里绝不出现换行。
//
// 重跑安全。备份在 src/.chat-lp-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.chat-lp-backup');
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

// ════ 1. chat-queue.js ════
console.log('1/3  chat-queue.js —— 改攒着那条的正文');
const q = load('chat-queue.js');
if (q) {
  apply(q, 'editPending',
    'export function dropPending(id) {',
    L(
      '// 改攒着还没递出去的那条。已经递出去的改不了（sent = 0 这个条件）——',
      '// 它已经进了 relay 的库和他的上文，在这边改只是自己看见不同的字。',
      'export function editPending(id, text) {',
      '  if (!Number.isInteger(id)) return false;',
      "  const t = String(text ?? '').trim();",
      '  if (!t) return false;',
      "  return stmt('UPDATE chat_pending SET text = ? WHERE id = ? AND sent = 0')",
      '    .run(t.slice(0, 4000), id).changes > 0;',
      '}',
      '',
      'export function dropPending(id) {'
    ));
  writeFileSync(q.p, q.text, 'utf8');
}

// ════ 2. echo-relay.js ════
console.log('');
console.log('2/3  echo-relay.js —— 加一条改正文的路由');
const e = load('echo-relay.js');
if (e) {
  apply(e, 'import editPending',
    L(
      '  dropPending,',
      "} from './chat-queue.js';"
    ),
    L(
      '  dropPending,',
      '  editPending,',
      "} from './chat-queue.js';"
    ));

  apply(e, '改正文的路由',
    "  app.post('/chat/api/pending/:id/drop', requireBasicAuth, (req, res) => {",
    L(
      '  // 攒着的还能改正文。已经递出去的改不了——chat-queue 那边带了 sent = 0。',
      "  app.post('/chat/api/pending/:id/edit', requireBasicAuth, (req, res) => {",
      "    const text = String(req.body?.text ?? '').trim();",
      "    if (!text) return res.status(400).json({ error: 'text required' });",
      '    const ok = editPending(Number(req.params.id), text);',
      '    res.json({ edited: ok });',
      '  });',
      '',
      "  app.post('/chat/api/pending/:id/drop', requireBasicAuth, (req, res) => {"
    ));
  writeFileSync(e.p, e.text, 'utf8');
}

// ════ 3. chat-page.js ════
console.log('');
console.log('3/3  chat-page.js —— 去叉、加长按菜单');
const c = load('chat-page.js');
if (c) {
  // ── 3a. CSS ──
  apply(c, '菜单样式',
    L(
      '  /* 攒着还没递出去的：气泡半透，旁边一个小叉可以收回 */',
      '  .grp.wait .bub { opacity: 0.55; }',
      '  .undo { flex: none; width: 24px; height: 24px; border-radius: 50%; border: 1px solid var(--line);',
      '    background: var(--card); color: var(--muted); font-size: 13px; line-height: 1; padding: 0; }'
    ),
    L(
      '  /* 攒着还没递出去的：气泡半透。收回走长按菜单，不再常驻一个小叉——',
      '     那个叉位置还算错了：.grp.me .ln 是 row-reverse，append 会跑到最左。*/',
      '  .grp.wait .bub { opacity: 0.55; }',
      '  .bub { -webkit-touch-callout: none; }',
      '',
      '  /* 长按菜单（小满 10-30：「消息长按编辑/删除」）*/',
      '  .lp-mask { position: fixed; inset: 0; z-index: 97; display: none;',
      '    align-items: center; justify-content: center; padding: 24px;',
      '    background: rgba(0, 0, 0, 0.28); }',
      '  .lp-mask.on { display: flex; }',
      '  .lp-box { width: 100%; max-width: 300px; background: var(--card);',
      '    border: 1px solid var(--line); border-radius: 16px; overflow: hidden;',
      '    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2); }',
      '  .lp-item { display: block; width: 100%; min-height: 50px; padding: 0 18px;',
      '    border: none; border-bottom: 1px solid var(--line); background: none;',
      '    font: inherit; font-size: 15px; color: var(--ink); text-align: left; }',
      '  .lp-item:last-child { border-bottom: none; }',
      '  .lp-item:active { background: #f4f4f4; }',
      '  .lp-item.danger { color: #8a2a2a; }',
      '  .lp-item.off { color: #b4b4b4; }',
      '',
      '  .lp-edit { width: 100%; max-width: 360px; background: var(--card);',
      '    border: 1px solid var(--line); border-radius: 16px; padding: 14px;',
      '    box-shadow: 0 12px 34px rgba(0, 0, 0, 0.2); }',
      '  .lp-edit textarea { width: 100%; min-height: 96px; padding: 10px 12px;',
      '    border: 1px solid var(--line); border-radius: 12px; background: #fff;',
      '    font: inherit; font-size: 15px; line-height: 1.6; color: var(--ink);',
      '    resize: vertical; -webkit-appearance: none; appearance: none; }',
      '  .lp-row { display: flex; gap: 8px; margin-top: 10px; }',
      '  .lp-row button { flex: 1; min-height: 42px; border-radius: 12px;',
      '    border: 1px solid var(--line); background: none; font: inherit;',
      '    font-size: 14px; color: var(--muted); }',
      '  .lp-row button.main { border: none; background: #1a1a1a; color: #fdfdfd; }'
    ));

  // ── 3b. undoBtn → markPid ──
  apply(c, 'undoBtn 换成记 pid',
    L(
      '  function undoBtn(pid) {',
      "    var x = document.createElement('button');",
      "    x.type = 'button';",
      "    x.className = 'undo';",
      "    x.setAttribute('data-drop', pid);",
      "    x.setAttribute('aria-label', '收回这条');",
      "    x.textContent = '×';",
      '    return x;',
      '  }'
    ),
    L(
      '  // 哪条还攒着，记在组上——长按的时候要知道能不能改。',
      '  // 不再放常驻的小叉：那个在 row-reverse 里会跑到最左，而且平时用不到。',
      '  function markPid(g, pid) {',
      "    if (g && pid) g.setAttribute('data-pid', pid);",
      '  }'
    ));

  // ── 3c. group 里不再插叉 ──
  apply(c, 'group 里改成记 pid',
    '        if (opts.wait && opts.pid) ln.appendChild(undoBtn(opts.pid));',
    L(
      '        // 攒着的那条把 id 记在组上，长按菜单用它判能不能改',
      '        if (opts.wait && opts.pid) markPid(g, opts.pid);'
    ));

  // ── 3d. 组上记 ts（编辑后要重画，时间不能丢）──
  apply(c, '组上记 ts',
    "    g.setAttribute('data-full', String(text == null ? '' : text));",
    L(
      "    g.setAttribute('data-full', String(text == null ? '' : text));",
      '    // 编辑后要重画这一组，时间不能丢',
      "    if (ts) g.setAttribute('data-ts', String(normTs(ts) || ''));"
    ));

  // ── 3e. doSend 里不再插叉 ──
  apply(c, 'doSend 改成记 pid',
    L(
      "        var g = ph && ph.closest ? ph.closest('.grp') : null;",
      '        if (!g || !d.id) return;',
      "        var lns = g.querySelectorAll('.ln');",
      '        if (lns.length) lns[lns.length - 1].appendChild(undoBtn(d.id));'
    ),
    L(
      "        var g = ph && ph.closest ? ph.closest('.grp') : null;",
      '        if (g && d.id) markPid(g, d.id);'
    ));

  // ── 3f. doFlush 里不再找叉 ──
  apply(c, 'doFlush 里清 pid',
    L(
      "          var x = waiting[i].querySelector('[data-drop]');",
      '          if (x && x.parentNode) x.parentNode.removeChild(x);'
    ),
    L(
      '          // 递出去了就不再是攒着的，长按菜单里的改/删跟着关掉',
      "          waiting[i].removeAttribute('data-pid');"
    ));

  // ── 3g. 点击处理里抿掉 data-drop 那段 ──
  apply(c, '点击里抿掉 data-drop',
    L(
      "    var dp = e.target.closest('[data-drop]');",
      '    if (!dp) return;',
      "    fetch('/chat/api/pending/' + dp.getAttribute('data-drop') + '/drop',",
      "      { method: 'POST', credentials: 'same-origin' })",
      '      .then(function (r) { return r.ok ? r.json() : null; })',
      '      .then(function (d) {',
      '        if (!d || !d.dropped) return;',
      "        var g = dp.closest('.grp');",
      '        if (g && g.parentNode) g.parentNode.removeChild(g);',
      '        pendingN = d.pending;',
      '        syncBtn();',
      '      })',
      '      .catch(function () {});',
      '  });'
    ),
    '  });');

  // ── 3h. 长按菜单整套 ──
  apply(c, '长按菜单',
    '  function doSend() {',
    L(
      '  // ── 长按菜单：编辑 / 删除 / 复制 ──',
      '  //',
      '  // 小满 10-30：「消息长按编辑/删除」。',
      '  //',
      '  // 能改能删的只有攒着还没递出去的（组上有 data-pid）。',
      '  // 已经递出去的只给复制：它进了 relay 的库和他的上文，',
      '  // 在网页上抹掉只是自己看不见——那是假的删除，比不给更坏。',
      "  var lpMask = document.createElement('div');",
      "  lpMask.className = 'lp-mask';",
      '  document.body.appendChild(lpMask);',
      '',
      '  function lpClose() {',
      "    lpMask.classList.remove('on');",
      "    lpMask.innerHTML = '';",
      '  }',
      '',
      '  function lpItem(box, label, cls, fn) {',
      "    var b = document.createElement('button');",
      "    b.type = 'button';",
      "    b.className = 'lp-item' + (cls ? ' ' + cls : '');",
      '    b.textContent = label;',
      '    if (fn) {',
      "      b.addEventListener('click', function (ev) {",
      '        ev.stopPropagation();',
      '        fn();',
      '      });',
      '    }',
      '    box.appendChild(b);',
      '  }',
      '',
      '  function lpCopy(full) {',
      '    try {',
      '      if (navigator.clipboard) navigator.clipboard.writeText(full);',
      '      else {',
      "        var ta = document.createElement('textarea');",
      '        ta.value = full;',
      '        document.body.appendChild(ta);',
      '        ta.select();',
      "        document.execCommand('copy');",
      '        document.body.removeChild(ta);',
      '      }',
      "      toast('复制好了');",
      '    } catch (err) {',
      "      toast('复制没成');",
      '    }',
      '    lpClose();',
      '  }',
      '',
      '  function lpDrop(g, pid) {',
      "    fetch('/chat/api/pending/' + pid + '/drop',",
      "      { method: 'POST', credentials: 'same-origin' })",
      '      .then(function (r) { return r.ok ? r.json() : null; })',
      '      .then(function (d) {',
      '        lpClose();',
      '        if (!d || !d.dropped) return;',
      '        if (g && g.parentNode) g.parentNode.removeChild(g);',
      '        pendingN = d.pending;',
      '        syncBtn();',
      '      })',
      '      .catch(function () {',
      '        lpClose();',
      "        toast('没删掉');",
      '      });',
      '  }',
      '',
      '  function lpEdit(g, pid, full) {',
      "    lpMask.innerHTML = '';",
      "    var box = document.createElement('div');",
      "    box.className = 'lp-edit';",
      "    var ta = document.createElement('textarea');",
      '    ta.value = full;',
      '    box.appendChild(ta);',
      '',
      "    var row = document.createElement('div');",
      "    row.className = 'lp-row';",
      "    var cancel = document.createElement('button');",
      "    cancel.type = 'button';",
      "    cancel.textContent = '不改了';",
      "    cancel.addEventListener('click', function (ev) {",
      '      ev.stopPropagation();',
      '      lpClose();',
      '    });',
      "    var save = document.createElement('button');",
      "    save.type = 'button';",
      "    save.className = 'main';",
      "    save.textContent = '存';",
      "    save.addEventListener('click', function (ev) {",
      '      ev.stopPropagation();',
      '      var text = ta.value.trim();',
      '      if (!text) return;',
      '      save.disabled = true;',
      "      var where = g.nextSibling;",
      '      var parent = g.parentNode;',
      "      var ts = g.getAttribute('data-ts');",
      "      fetch('/chat/api/pending/' + pid + '/edit', {",
      "        method: 'POST',",
      "        credentials: 'same-origin',",
      "        headers: { 'content-type': 'application/json' },",
      '        body: JSON.stringify({ text: text })',
      '      })',
      '        .then(function (r) { return r.ok ? r.json() : null; })',
      '        .then(function (d) {',
      '          lpClose();',
      '          if (!d || !d.edited) return;',
      '          // 重画这一组：换行改了的话气泡数量也跟着变',
      '          if (parent) parent.removeChild(g);',
      "          var nb = group('human', text, ts ? Number(ts) : Date.now(),",
      "            { wait: true, pid: pid, read: 'unread' });",
      "          var moved = nb && nb.closest ? nb.closest('.grp') : null;",
      '          // group 总把新组接在最后，这儿把它搬回原位',
      '          if (moved && parent && where && where.parentNode === parent) {',
      '            parent.insertBefore(moved, where);',
      '          }',
      '        })',
      '        .catch(function () {',
      '          lpClose();',
      "          toast('没存上');",
      '        });',
      '    });',
      '    row.appendChild(cancel);',
      '    row.appendChild(save);',
      '    box.appendChild(row);',
      '',
      '    lpMask.appendChild(box);',
      "    lpMask.classList.add('on');",
      '    setTimeout(function () { ta.focus(); }, 60);',
      '  }',
      '',
      '  function lpOpen(g) {',
      "    var pid = g.getAttribute('data-pid');",
      "    var full = g.getAttribute('data-full') || '';",
      "    lpMask.innerHTML = '';",
      "    var box = document.createElement('div');",
      "    box.className = 'lp-box';",
      '    if (pid) {',
      "      lpItem(box, '编辑', '', function () { lpEdit(g, pid, full); });",
      "      lpItem(box, '删除', 'danger', function () { lpDrop(g, pid); });",
      '    } else {',
      "      lpItem(box, '已经递给他了，改不了', 'off', null);",
      '    }',
      "    lpItem(box, '复制', '', function () { lpCopy(full); });",
      '    lpMask.appendChild(box);',
      "    lpMask.classList.add('on');",
      '  }',
      '',
      "  lpMask.addEventListener('click', function (e) {",
      '    if (e.target === lpMask) lpClose();',
      '  });',
      "  document.addEventListener('keydown', function (e) {",
      "    if (e.key === 'Escape') lpClose();",
      '  });',
      '',
      '  // 长按：按住 460ms、且指头没挪开超过 10px。',
      '  // 没这两个条件，滚动列表时会误触。',
      '  var lpTimer = null, lpX = 0, lpY = 0, lpFired = false;',
      "  stream.addEventListener('pointerdown', function (e) {",
      "    var g = e.target.closest ? e.target.closest('.grp.me') : null;",
      '    if (!g) return;',
      '    lpX = e.clientX;',
      '    lpY = e.clientY;',
      '    lpFired = false;',
      '    clearTimeout(lpTimer);',
      '    lpTimer = setTimeout(function () {',
      '      lpFired = true;',
      '      lpOpen(g);',
      '    }, 460);',
      '  });',
      "  stream.addEventListener('pointermove', function (e) {",
      '    if (!lpTimer) return;',
      '    if (Math.abs(e.clientX - lpX) + Math.abs(e.clientY - lpY) > 10) {',
      '      clearTimeout(lpTimer);',
      '      lpTimer = null;',
      '    }',
      '  });',
      "  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {",
      '    stream.addEventListener(ev, function () {',
      '      clearTimeout(lpTimer);',
      '      lpTimer = null;',
      '    });',
      '  });',
      '  // 长按弹出菜单之后浏览器还会补一次 click，别让它把菜单立刻关掉',
      "  stream.addEventListener('click', function (e) {",
      '    if (lpFired) {',
      '      e.preventDefault();',
      '      e.stopPropagation();',
      '      lpFired = false;',
      '    }',
      '  }, true);',
      '',
      '  function doSend() {'
    ));

  writeFileSync(c.p, c.text, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cd ' + srcDir);
  console.error('  for f in chat-page chat-queue echo-relay; do cp .chat-lp-backup/$f.js.' + stamp + ' $f.js; done');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('长按自己的气泡：攒着的能改能删，已递出去的只能复制。');
}
