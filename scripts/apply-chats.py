#!/usr/bin/env python3
# 接三件事：
#   1. 导入时顺手往 imported_chat 写一份（带对话编号）
#   2. vesper.js 挂 memory-chats
#   3. 记忆页加一个「以前的聊天」大框
#
# 为什么要重导：第一版我只把消息塞进了 conversation_archive，
# 而那张表没有对话编号列——所以两万条话进去了，却分不回窗。
# 这是我的设计漏。重跑只补 imported_chat，归档表一条不增
# （靠 imported_messages 里已记的 id 跳过）。
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


# ── 1. 导入时多写一份 ──
#
# 这张表用消息原 id 做主键，INSERT OR REPLACE 天然幂等，
# 所以放在 seen 检查**之前**：已经导过归档的那两万条，重跑时
# 归档跳过但这张表要补上。

ic = 'src/memory-chat-import.js'
print(ic)
edit(ic, '建表',
     "CREATE TABLE IF NOT EXISTS imported_messages (",
     "CREATE TABLE IF NOT EXISTS imported_chat (\n"
     "  id TEXT PRIMARY KEY,\n"
     "  conversation_id TEXT NOT NULL,\n"
     "  ts INTEGER NOT NULL,\n"
     "  speaker TEXT NOT NULL,\n"
     "  content TEXT NOT NULL\n"
     ");\n"
     "CREATE INDEX IF NOT EXISTS idx_ic_conv ON imported_chat (conversation_id, ts);\n\n"
     "CREATE TABLE IF NOT EXISTS imported_messages (",
     'CREATE TABLE IF NOT EXISTS imported_chat')

edit(ic, '准备语句',
     "  const put = stmt(\n",
     "  // 多写一份带对话编号的：归档表没有那一列，没它就没法按窗分组。\n"
     "  const putIC = stmt(\n"
     "    'INSERT OR REPLACE INTO imported_chat (id, conversation_id, ts, speaker, content)'\n"
     "      + ' VALUES (?, ?, ?, ?, ?)'\n"
     "  );\n"
     "  const put = stmt(\n",
     'const putIC = stmt(')

# seen 检查之前先写这张表
edit(ic, '写入',
     "    if (seen.get(id)) {\n"
     "      dup++;\n"
     "      continue;\n"
     "    }",
     "    // 这一句在 seen 检查之前：第一版已经进了归档的那两万条，\n"
     "    // 重跑时归档要跳过，但这张表得补上。\n"
     "    putIC.run(id, cid, when, role === 'user' ? USER_NAME : AI_NAME, content);\n\n"
     "    if (seen.get(id)) {\n"
     "      dup++;\n"
     "      continue;\n"
     "    }",
     'putIC.run(')

# ── 2. 记忆页加一框 ──
#
# 摆在日记后面、两个库前面。memoryCards() 是 apply-memory5 加的，
# 所以这儿改它里面那个 rows 数组的最后一项。

mp = 'src/memories-page.js'
print(mp)
edit(mp, '引入计数',
     "import { counts as wbCounts } from './world-books.js';",
     "import { counts as wbCounts } from './world-books.js';\n"
     "import { chatCounts } from './memory-chats.js';",
     "import { chatCounts }")

edit(mp, '加一框',
     "      `${c.journal} \u7bc7`, `${M}/journal`],\n  ];",
     "      `${c.journal} \u7bc7`, `${M}/journal`],\n"
     "    ['以前的聊天', '从 Aru 备份里搬过来的原话。按对话分，点进去翻',\n"
     "      (() => { try { const q = chatCounts();\n"
     "        return q.chats ? `${q.chats} 个 · ${q.messages} 条` : '还没导'; }\n"
     "        catch { return '还没导'; } })(), '/memories/manage/chats'],\n"
     "  ];",
     "['以前的聊天'")

# ── 3. vesper.js ──

IMP = "import { registerChatsRoutes } from './memory-chats.js';"
CALL = 'registerChatsRoutes(app, { requireBasicAuth });'
A_IMP = "import { registerChatImportRoutes } from './memory-chat-import.js';"
A_CALL = 'registerChatImportRoutes(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
lines = load(vp).split('\n')
has_imp = any(l.strip() == A_IMP for l in lines)
has_call = any(l.strip() == A_CALL for l in lines)
print('  锚点 import 在不在 ->', has_imp)
print('  锚点 调用   在不在 ->', has_call)
if not (has_imp and has_call):
    print('\napply-memory5.py 还没跑。先跑那个。')
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
        out.append('// 导进来的聊天按窗看（见 memory-chats.js）')
        out.append(CALL)
        wc = True
bodies[vp] = '\n'.join(out)
print('  写入后 import %d 处 · 调用 %d 处'
      % (bodies[vp].count(IMP), bodies[vp].count(CALL)))

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-chats')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in memory-chats memory-chat-import memories-page vesper; do \\')
print('    node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
print('然后重跑一次导入（个人 → 导入聊天记录），归档不会双份。')
