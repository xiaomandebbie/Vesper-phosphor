#!/usr/bin/env python3
# 让聊天页认两种新帧：
#   { type: 'thinking', stream_id, text }        → 「想了想」，点开展开
#   { type: 'tool', id, label, detail }          → 头像旁边小字卡片，点开看详情
#
# 小满 2026-11-05：「他怎么没思考链了」
# 「他调用工具要像 aru 一样是头像旁边小字的工具卡片，点开看到详情」
#
# ── 为什么前端改得这么少 ──
#
# 这个文件里本来就有两样现成的：
#   · .think 那套折叠框（含点击展开的 handler）
#   · details{} + sheet 那套详情弹窗（行动卡片在用）
# 所以工具卡片直接用 class="card tap"，现有的点击 handler 就接得住；
# 只多一个 .card.tool 把它从居中改成靠头像那边缩进。
#
# 47px 缩进和 .think 一样（头像 38 + 间距 9），所以两者对齐。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

p = 'src/chat-page.js'
with open(p, encoding='utf-8') as f:
    s = f.read()

ok = True


def one(name, old, new, mark):
    global s, ok
    if mark in s:
        print('  %-16s 已改过，跳过' % name)
        return
    n = s.count(old)
    if n != 1:
        print('  %-16s 锚点命中 %d 次（要 1）——没改' % (name, n))
        ok = False
        return
    s = s.replace(old, new, 1)
    print('  %-16s 改了' % name)


# ── 1. 两个函数。摆在 onFrame 前面——thinks 要跳轮活着，所以不能在 onFrame 里面 ──
#
# details{} 在更前面声明过（行动卡片在用），这儿直接蹭。

FUNCS = """  // 边想边推的思考链。同一轮只建一个框，后续只更新正文。
  // 折叠/展开走的是现有的 [data-think] handler，这边不再绑事件。
  var thinks = {};
  function liveThink(sid, text) {
    var box = thinks[sid];
    if (!box) {
      box = document.createElement('div');
      box.className = 'think';
      var top = document.createElement('button');
      top.type = 'button';
      top.className = 'think-top';
      top.setAttribute('data-think', '1');
      var caret = document.createElement('span');
      caret.className = 'think-caret';
      caret.setAttribute('aria-hidden', 'true');
      caret.textContent = '\\u25b6';
      var label = document.createElement('span');
      label.textContent = '\\u60f3\\u4e86\\u60f3';
      top.appendChild(caret);
      top.appendChild(label);
      var body = document.createElement('div');
      body.className = 'think-body';
      box.appendChild(top);
      box.appendChild(body);
      thinks[sid] = box;
      put(box);
    }
    var b = box.querySelector('.think-body');
    if (b) b.textContent = text;
    toBottom();
  }

  // 工具卡片。用 class="card tap" 是为了蹭现有的详情弹窗：
  // 那个 handler 认 .card.tap 和 data-detail，不用再写一遗。
  function toolCard(d) {
    var id = d.id || ('t' + Date.now());
    var has = !!d.detail;
    if (has) details[id] = d.detail;
    var el = document.createElement(has ? 'button' : 'div');
    el.className = 'card tool' + (has ? ' tap' : '');
    if (has) {
      el.type = 'button';
      el.setAttribute('data-detail', id);
    }
    var b = document.createElement('span');
    b.className = 'card-body';
    b.textContent = d.label || '\\u7528\\u4e86\\u4e2a\\u5de5\\u5177';
    el.appendChild(b);
    if (has) {
      var m = document.createElement('span');
      m.className = 'card-more';
      m.setAttribute('aria-hidden', 'true');
      m.textContent = '\\u203a';
      el.appendChild(m);
    }
    put(el);
    toBottom();
  }

"""

one('两个函数',
    '  function onFrame(d) {',
    FUNCS + '  function onFrame(d) {',
    'function liveThink(')

# ── 2. onFrame 里接这两种帧 ──
#
# 原来走到 if (d.type) return; 就把它们丢了——所以插在那一行前面。

one('onFrame',
    '    if (d.type) return;\n    add(d);',
    "    if (d.type === 'thinking') {\n"
    "      liveThink(d.stream_id || 'one', d.text || '');\n"
    '      return;\n'
    '    }\n'
    "    if (d.type === 'tool') {\n"
    '      toolCard(d);\n'
    '      return;\n'
    '    }\n'
    '    if (d.type) return;\n'
    '    add(d);',
    "d.type === 'thinking'")

# ── 3. 工具卡片的样式 ──
#
# .card 本来是居中、没边框、整行宽（行动卡片用的）。
# .card.tool 改成：靠左、缩进 47px、胶囊形、小字——和 .think 对齐。

CSS = """  /* 工具卡片：头像旁边一行小字，点开看详情。
     47px = 头像 38 + 间距 9，和 .think 一个缩进 */
  .card.tool { width: auto; max-width: 80%; margin: 0 0 11px 47px; padding: 6px 13px;
    text-align: left; border: 1px solid var(--line); border-radius: 999px;
    background: rgba(255, 255, 255, 0.72); }
  .card.tool .card-body { display: inline; margin: 0; font-size: 11.5px; color: var(--muted); }
  .card.tool .card-more { display: inline; margin: 0 0 0 5px; font-size: 11px; }
  .card.tool:active { background: #f0f0f0; }

"""

one('样式',
    '  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }',
    CSS + '  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }',
    '.card.tool { width: auto;')

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

shutil.copy(p, '/root/chat-page.js.before-toolsui')
with open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n写好了。接下来：')
print('  for f in chat-page chat-bus memory-tools; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
