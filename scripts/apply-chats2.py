#!/usr/bin/env python3
# 「以前的聊天」从记忆页挑到聊天页。
#
# 小满 2026-11-05：「不要放在记忆界面，就放在聊天界面」
#
# 路径也改了：/memories/manage/chats → /chat/archive。
# 这样底栈高亮 Chat 而不是 Memory，返回也回聊天列表。
#
# /chat/:id 那条路由带了 (\\d+)，只接数字，所以 /chat/archive 不会被它抦住。
#
# 这个脚本把 apply-chats.py 的活也包了（每条幂等），
# 所以那个跑过没跑过都行，只跑这一个。
#
# 在 /root/vesper-phosphor 下跑。

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


def edit(path, name, old, new, mark, times=1):
    global ok
    s = load(path)
    if mark in s:
        print('  %-20s 已改过，跳过' % name)
        return
    n = s.count(old)
    if n != times:
        print('  %-20s 锚点命中 %d 次（要 %d）——没改' % (name, n, times))
        ok = False
        return
    bodies[path] = s.replace(old, new)
    print('  %-20s 改了' % name)


# ── 1. 导入时多写一份带对话编号的 ──
#
# 归档表没有对话编号列，没它就没法按窗分组——这是我第一版的设计漏。

ic = 'src/memory-chat-import.js'
print(ic)
edit(ic, '建表',
     'CREATE TABLE IF NOT EXISTS imported_messages (',
     'CREATE TABLE IF NOT EXISTS imported_chat (\n'
     '  id TEXT PRIMARY KEY,\n'
     '  conversation_id TEXT NOT NULL,\n'
     '  ts INTEGER NOT NULL,\n'
     '  speaker TEXT NOT NULL,\n'
     '  content TEXT NOT NULL\n'
     ');\n'
     'CREATE INDEX IF NOT EXISTS idx_ic_conv ON imported_chat (conversation_id, ts);\n\n'
     'CREATE TABLE IF NOT EXISTS imported_messages (',
     'CREATE TABLE IF NOT EXISTS imported_chat')

edit(ic, '准备语句',
     '  const put = stmt(\n',
     '  // 多写一份带对话编号的：归档表没那一列，没它就没法按窗分组。\n'
     '  const putIC = stmt(\n'
     "    'INSERT OR REPLACE INTO imported_chat (id, conversation_id, ts, speaker, content)'\n"
     "      + ' VALUES (?, ?, ?, ?, ?)'\n"
     '  );\n'
     '  const put = stmt(\n',
     'const putIC = stmt(')

edit(ic, '写入',
     '    if (seen.get(id)) {\n      dup++;\n      continue;\n    }',
     '    // 在 seen 检查之前：第一版已经进了归档的那两万条，\n'
     '    // 重跑时归档要跳过，但这张表得补上。\n'
     "    putIC.run(id, cid, when, role === 'user' ? USER_NAME : AI_NAME, content);\n\n"
     '    if (seen.get(id)) {\n      dup++;\n      continue;\n    }',
     'putIC.run(')

# ── 2. memory-chats.js：换路径、换底栈、换返回 ──

mc = 'src/memory-chats.js'
print(mc)
edit(mc, '路径',
     "const P = '/memories/manage/chats';",
     "// 挂在聊天那一栈（小满：「就放在聊天界面」）。\n"
     "// /chat/:id 带了 (\\\\d+) 只接数字，所以这条不会被它抦住。\n"
     "const P = '/chat/archive';",
     "const P = '/chat/archive';")
edit(mc, '底栈 menu',
     "renderMenu('/memories')", "renderMenu('/chat')", "renderMenu('/chat')")
edit(mc, '底栈 tabs',
     "renderTabs('/memories')", "renderTabs('/chat')", "renderTabs('/chat')")
edit(mc, '返回链接',
     '<a class="back" href="/memories">\u2039 \u56de\u8bb0\u5fc6</a>',
     '<a class="back" href="/chat">\u2039 \u56de\u804a\u5929</a>',
     'href="/chat">\u2039 \u56de\u804a\u5929', times=2)
edit(mc, '空状态文案',
     '到「个人 → 导入聊天记录」跑一次就行。',
     '到「个人 → 导入聊天记录」跑一次就行。',
     'NEVER_MATCH_KEEP_AS_IS')

# ── 3. 记忆页：如果 apply-chats.py 加过那一框，去掉 ──

mp = 'src/memories-page.js'
print(mp)
s_mp = load(mp)
OLD_BOX = (
    "    ['以前的聊天', '从 Aru 备份里搬过来的原话。按对话分，点进去翻',\n"
    "      (() => { try { const q = chatCounts();\n"
    "        return q.chats ? `${q.chats} 个 · ${q.messages} 条` : '还没导'; }\n"
    "        catch { return '还没导'; } })(), '/memories/manage/chats'],\n"
)
if OLD_BOX in s_mp:
    bodies[mp] = s_mp.replace(OLD_BOX, '', 1)
    print('  %-20s 去掉了' % '记忆页那一框')
else:
    print('  %-20s 没加过，不用去' % '记忆页那一框')

# ── 4. 聊天列表页：加入口 ──

ARCH = '''  <a class="arch" href="/chat/archive">
    <span class="arch-n">以前的聊天</span>
    <span class="arch-w">从 Aru 备份里搬过来的原话，按对话分</span>
    <span class="arch-g" aria-hidden="true">\u203a</span>
  </a>
'''

ARCH_CSS = '''  .arch { display: flex; align-items: center; gap: 10px; margin: 16px 0 0; padding: 13px 14px;
    background: rgba(255, 255, 255, 0.72); border: 1px dashed var(--line); border-radius: 16px;
    color: inherit; text-decoration: none; }
  .arch:active { background: #f2f2f2; }
  .arch-n { flex: none; font-size: 14px; font-weight: 600; color: var(--ink); }
  .arch-w { flex: 1; min-width: 0; font-size: 11.5px; line-height: 1.5; color: var(--muted); }
  .arch-g { flex: none; color: #b0b0b0; font-size: 17px; }
'''

cp = 'src/chat-page.js'
print(cp)
edit(cp, '加入口', '  ${items}\n', '  ${items}\n' + ARCH, 'class="arch" href="/chat/archive"')
edit(cp, '入口样式', '  .foot { margin: 20px 6px 0;', ARCH_CSS + '  .foot { margin: 20px 6px 0;',
     '.arch { display: flex;')

# ── 5. vesper.js：挂路由 ──

IMP = "import { registerChatsRoutes } from './memory-chats.js';"
CALL = 'registerChatsRoutes(app, { requireBasicAuth });'
A_IMP = "import { registerChatImportRoutes } from './memory-chat-import.js';"
A_CALL = 'registerChatImportRoutes(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
lines = load(vp).split('\n')
if not any(l.strip() == A_IMP for l in lines) or not any(l.strip() == A_CALL for l in lines):
    print('  找不到 registerChatImportRoutes——apply-memory5.py 还没跑。')
    sys.exit(1)

out = []
wi = wc = False
for l in lines:
    k = l.strip()
    if k in (IMP, CALL):
        continue
    out.append(l)
    if not wi and k == A_IMP:
        out.append(IMP)
        wi = True
    if not wc and k == A_CALL:
        out.append('// 导进来的聊天按窗看，挂在聊天那一栈（见 memory-chats.js）')
        out.append(CALL)
        wc = True
bodies[vp] = '\n'.join(out)
print('  import %d 处 · 调用 %d 处'
      % (bodies[vp].count(IMP), bodies[vp].count(CALL)))

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-chats2')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in memory-chats memory-chat-import memories-page chat-page vesper; do \\')
print('    node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
print('然后重跑一次导入（个人 → 导入聊天记录），归档不会双份。')
