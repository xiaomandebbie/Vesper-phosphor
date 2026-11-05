#!/usr/bin/env python3
# 召回这两件：
#   1. 只存 <recalled> 那一段——之前存的是整条 system 消息，
#      里面带着 memory_directory 全部标题和一整篇 recent_days，长得没法看。
#   2. 不再直接摆卡片：点他的气泡 → 下面冒一个「…」→ 点它看召回。
#
# 小满 2026-11-05：「要点击消息才出现…这个标志，点开可以看到带的记忆
# （只要看召回记忆）」
#
# 没召回到东西的那轮，气泡上什么都不会出现。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

ok = True
bodies = {}


def load(p):
    if p not in bodies:
        with open(p, encoding='utf-8') as f:
            bodies[p] = f.read()
    return bodies[p]


def edit(path, name, old, new, mark):
    global ok
    s = load(path)
    if mark in s:
        print('  %-20s 已改过，跳过' % name)
        return
    n = s.count(old)
    if n != 1:
        print('  %-20s 锚点命中 %d 次（要 1）——没改' % (name, n))
        ok = False
        return
    bodies[path] = s.replace(old, new, 1)
    print('  %-20s 改了' % name)


# ── 1. chat-bus：只抽 <recalled> ──

cb = 'src/chat-bus.js'
print(cb)
edit(cb, '只存召回那段',
     '      if (/<memory_directory>|<recalled>|<recent_days>/.test(c)) return c;',
     '      // 只要 <recalled> 里面的——目录和最近日记她在记忆页里都看得到，\n'
     '      // 塞进详情里只是把真正「想起来的那点」挤没了。\n'
     '      const hit = /<recalled>([\\s\\S]*?)<\\/recalled>/.exec(c);\n'
     '      if (hit) return hit[1].trim();',
     'const hit = /<recalled>')

# done 帧带上召回：不带的话刚聊完要刷新才看得到
edit(cb, 'done 帧带召回',
     "  emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: done });\n"
     "  emit({ type: 'typing', active: false });",
     "  // 带上召回：不带的话刚聊完要刷新一次才看得到那个「…」\n"
     "  emit({ type: 'reply_delta', stream_id: streamId, done: true,\n"
     "    final_text: done, recalled: recalledText });\n"
     "  emit({ type: 'typing', active: false });",
     'recalled: recalledText })')

# ── 2. chat-page：traceOf 里那个召回卡片抽掉 ──
#
# 那段带 unicode 转义，按字面匹配容易错，所以按行定位删。

cp = 'src/chat-page.js'
print(cp)
s = load(cp)

if "data-recall" in s:
    print('  %-20s 已改过，跳过' % '抽掉召回卡片')
else:
    lines = s.split('\n')
    start = -1
    for i, l in enumerate(lines):
        if l.strip() == 'if (m.recalled) {' and i > 0:
            start = i
            break
    if start < 0:
        print('  %-20s 找不到 if (m.recalled) {——没改' % '抽掉召回卡片')
        ok = False
    else:
        # 数到配对的收尾
        depth = 0
        end = -1
        for i in range(start, min(start + 14, len(lines))):
            depth += lines[i].count('{') - lines[i].count('}')
            if depth == 0:
                end = i
                break
        if end < 0:
            print('  %-20s 数不到收尾——没改' % '抽掉召回卡片')
            ok = False
        else:
            print('  删掉第 %d–%d 行（%d 行）：' % (start + 1, end + 1, end - start + 1))
            for l in lines[start:end + 1]:
                print('    | ' + l.strip()[:70])
            lines[start:end + 1] = []
            bodies[cp] = '\n'.join(lines)
            print('  %-20s 改了' % '抽掉召回卡片')

# 历史里：把召回挂在气泡上，不直接画
edit(cp, '历史挂召回',
     "    group(human ? 'human' : 'ai', m.text || '', msgTs(m), human ? { read: 'read' } : {});",
     "    var _b = group(human ? 'human' : 'ai', m.text || '', msgTs(m),\n"
     "      human ? { read: 'read' } : {});\n"
     "    // 召回不直接摆出来：挂在气泡上，点一下才冒「…」（小满 11-05）\n"
     "    if (!human && m.recalled && _b) {\n"
     "      var _g = _b.closest ? _b.closest('.grp') : null;\n"
     "      if (_g) {\n"
     "        var _rid = 'rc-' + m.ts;\n"
     "        details[_rid] = m.recalled;\n"
     "        _g.setAttribute('data-recall', _rid);\n"
     "      }\n"
     "    }",
     "var _b = group(human ? 'human' : 'ai'")

# 当场：SSE done 帧里也挂上
edit(cp, '当场挂召回',
     "        if (text.trim()) group('ai', text, Date.now());",
     "        if (text.trim()) {\n"
     "          var _nb = group('ai', text, Date.now());\n"
     "          if (d.recalled && _nb) {\n"
     "            var _g2 = _nb.closest ? _nb.closest('.grp') : null;\n"
     "            if (_g2) {\n"
     "              var _rid2 = 'rc-' + Date.now();\n"
     "              details[_rid2] = d.recalled;\n"
     "              _g2.setAttribute('data-recall', _rid2);\n"
     "            }\n"
     "          }\n"
     "        }",
     "var _nb = group('ai', text, Date.now())")

# 详情弹窗：选择器改成 [data-detail]，标题改成可变
edit(cp, '详情选择器',
     "    var card = e.target.closest('.card.tap');",
     "    var card = e.target.closest('[data-detail]');",
     "closest('[data-detail]')")

edit(cp, '弹窗标题',
     "      sbox.textContent = details[id] || '';",
     "      sbox.textContent = details[id] || '';\n"
     "      // 标题跟着来源走：行动卡片是「做这件事的时候」，召回是别的\n"
     "      var _t = card.getAttribute('data-title');\n"
     "      var _te = sheet.querySelector('.sheet-title');\n"
     "      if (_te) _te.textContent = _t || '\\u505a\\u8fd9\\u4ef6\\u4e8b\\u7684\\u65f6\\u5019';",
     "card.getAttribute('data-title')")

# 点气泡 → toggle 那个「…」
edit(cp, '点气泡冒点',
     "    if (e.target.closest('[data-sheet-x]') || e.target === sheet) { closeSheet(); return; }",
     "    // 点他的气泡 → 下面冒一个「…」；再点一下收起去。\n"
     "    // 只有那一轮真召回到了东西的气泡有 data-recall。\n"
     "    var _grp = e.target.closest('.grp.ta[data-recall]');\n"
     "    if (_grp) {\n"
     "      var _old = _grp.querySelector('.dots');\n"
     "      if (_old) { _old.parentNode.removeChild(_old); return; }\n"
     "      var _dot = document.createElement('button');\n"
     "      _dot.type = 'button';\n"
     "      _dot.className = 'dots';\n"
     "      _dot.setAttribute('data-detail', _grp.getAttribute('data-recall'));\n"
     "      _dot.setAttribute('data-title', '\\u4ed6\\u60f3\\u8d77\\u4e86\\u8fd9\\u4e9b');\n"
     "      _dot.textContent = '\\u2026';\n"
     "      _grp.appendChild(_dot);\n"
     "      return;\n"
     "    }\n"
     "    if (e.target.closest('[data-sheet-x]') || e.target === sheet) { closeSheet(); return; }",
     "closest('.grp.ta[data-recall]')")

# 样式
edit(cp, '「…」的样式',
     '  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }',
     '  /* 点他的气泡才出现的那个「…」。缩进 47px 和气泡对齐 */\n'
     '  .dots { display: block; margin: 3px 0 0 47px; padding: 2px 12px;\n'
     '    border: 1px solid var(--line); border-radius: 999px;\n'
     '    background: rgba(255, 255, 255, 0.72); color: #9aa6b8;\n'
     '    font: inherit; font-size: 14px; line-height: 1.5; letter-spacing: 0.1em; }\n'
     '  .dots:active { background: #f0f0f0; }\n'
     '  .grp.ta[data-recall] .bub { cursor: pointer; }\n'
     '  .msg-act { margin: 0 0 12px; text-align: center; font-size: 11px; color: #9a9a9a; }',
     '.dots { display: block;')

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-dots')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  node --check src/chat-bus.js && node --check src/chat-page.js \\')
print('    && pm2 restart vesper --update-env')
