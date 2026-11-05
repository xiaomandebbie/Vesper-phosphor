#!/usr/bin/env python3
# 思考链和召回落盘。三处：
#   1. chat-bus：一轮完了把思考链、召回文本、工具记下来
#   2. echo-relay：历史接口把痕迹配回消息上
#   3. chat-page：历史里的思考链画成折叠框，召回和工具画成可点卡片
#
# 小满 2026-11-05：「一开始有思考链，退出重进就没了」
# 「我也想看到他召回的内容，点详情可以看到召回」
#
# 召回文本从哪里拿：不改 memory-inject，直接从它拼好的 messages 里
# 找那条带 <memory_directory> / <recalled> / <recent_days> 的 system 消息。
# 少改一个文件，也不用猜它的内部结构。
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
        print('  %-18s 已改过，跳过' % name)
        return
    n = s.count(old)
    if n != 1:
        print('  %-18s 锚点命中 %d 次（要 1）——没改' % (name, n))
        ok = False
        return
    bodies[path] = s.replace(old, new, 1)
    print('  %-18s 改了' % name)


# ── 1. chat-bus：存 ──

cb = 'src/chat-bus.js'
print(cb)

edit(cb, '引入 saveTrace',
     "import { toolPrompt, parseCall, stripCall, runTool, callLabel } from './memory-tools.js';",
     "import { toolPrompt, parseCall, stripCall, runTool, callLabel } from './memory-tools.js';\n"
     "import { saveTrace } from './chat-trace.js';",
     "from './chat-trace.js'")

# 把召回那条 system 消息捡出来。memory-inject 把它摆在最后一句话前面。
edit(cb, '捡召回文本',
     '  emit({ type: \'typing\', active: true });\n\n  let finalText = \'\';',
     '  // 这一轮真正带进去的召回。memory-inject 把它拼成一条 system 消息，\n'
     '  // 摆在最后一句话前面——按标记认它，不用改 memory-inject 的内部结构。\n'
     '  const recalledText = (() => {\n'
     '    for (let i = messages.length - 1; i >= 0; i--) {\n'
     '      const c = String(messages[i]?.content ?? \'\');\n'
     '      if (/<memory_directory>|<recalled>|<recent_days>/.test(c)) return c;\n'
     '    }\n'
     '    return \'\';\n'
     '  })();\n'
     '  const usedTools = [];\n\n'
     '  emit({ type: \'typing\', active: true });\n\n  let finalText = \'\';',
     'const recalledText =')

edit(cb, '记工具',
     "      console.log(`chat: \u4ed6\u7528\u4e86 ${call.name}`);",
     "      console.log(`chat: \u4ed6\u7528\u4e86 ${call.name}`);\n"
     "      usedTools.push({ label: callLabel(call), detail: out });",
     'usedTools.push(')

edit(cb, '存痕迹',
     "  const done = finalText.trim();\n"
     "  emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: done });",
     "  const done = finalText.trim();\n\n"
     "  // 落盘：不存的话退出重进就没了（conversation_log 只有三列）。\n"
     "  try {\n"
     "    saveTrace({ reasoning: lastReasoning, recalled: recalledText, tools: usedTools });\n"
     "  } catch (err) {\n"
     "    console.error('chat: 痕迹没存下', err.message);\n"
     "  }\n\n"
     "  emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: done });",
     'saveTrace({ reasoning: lastReasoning')

# ── 2. echo-relay：读 ──

er = 'src/echo-relay.js'
print(er)
edit(er, '引入 attachTraces',
     "import { listWindows, listWindowMessages } from './chat-windows.js';",
     "import { listWindows, listWindowMessages } from './chat-windows.js';\n"
     "import { attachTraces } from './chat-trace.js';",
     "from './chat-trace.js'")

edit(er, '配回消息上',
     '        if (scoped) return res.json({ messages: scoped });',
     '        if (scoped) return res.json({ messages: attachTraces(scoped) });',
     'attachTraces(scoped)')

edit(er, '全部那条也配',
     "      res.json({ messages: rows.map(toMessage).filter((m) => m.text) });",
     "      res.json({ messages: attachTraces(rows.map(toMessage).filter((m) => m.text)) });",
     'attachTraces(rows.map(')

# ── 3. chat-page：画 ──

TRACE_FN = """  // 历史里的思考链、召回、工具。
  //
  // 顺序和当时一样：先想，再查，再说。所以这三样都在气泡前面。
  // 召回和工具走 .card.tool tap，点一下进详情弹窗（details + sheet 这套现成的）。
  function traceOf(m) {
    if (m.reasoning) thinking(m.reasoning);
    if (Array.isArray(m.tools)) {
      for (var i = 0; i < m.tools.length; i++) {
        toolCard({
          id: 'tl-' + m.ts + '-' + i,
          label: m.tools[i].label,
          detail: m.tools[i].detail
        });
      }
    }
    if (m.recalled) {
      toolCard({
        id: 'rc-' + m.ts,
        label: '\\u5e26\\u7740\\u8fd9\\u4e9b\\u8bb0\\u5fc6\\u56de\\u7684',
        detail: m.recalled
      });
    }
  }

"""

cp = 'src/chat-page.js'
print(cp)
edit(cp, '加 traceOf',
     '  function paint(it) {',
     TRACE_FN + '  function paint(it) {',
     'function traceOf(m)')

edit(cp, 'paint 里调',
     "    var human = m.from === 'human';\n"
     "    // relay \u5386\u53f2\u91cc\u6211\u7684\u6d88\u606f\u90fd\u5df2\u7ecf\u9012\u8fc7\u4e86\uff0c\u6240\u4ee5\u90fd\u7b97\u5df2\u8bfb",
     "    var human = m.from === 'human';\n"
     "    // \u4ed6\u8bf4\u7684\u8bdd\uff1a\u5148\u628a\u90a3\u4e00\u8f6e\u7684\u601d\u8003\u94fe\u3001\u5de5\u5177\u3001\u53ec\u56de\u8865\u5728\u524d\u9762\n"
     "    if (!human) traceOf(m);\n"
     "    // relay \u5386\u53f2\u91cc\u6211\u7684\u6d88\u606f\u90fd\u5df2\u7ecf\u9012\u8fc7\u4e86\uff0c\u6240\u4ee5\u90fd\u7b97\u5df2\u8bfb",
     'if (!human) traceOf(m);')

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-trace')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in chat-trace chat-bus echo-relay chat-page; do \\')
print('    node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
