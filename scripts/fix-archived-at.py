#!/usr/bin/env python3
# 补 conversation_archive.archived_at。
#
# 这张表是四列：ts / speaker / content / archived_at，最后一列 NOT NULL（state.js:65）。
# 我写 INSERT 时只给了前三列，所以每条都被约束打回来。
# state.js 自己那句（第 429 行）就是对的四列形式，照它补。
#
# ts   = 当时说这句话的时间（来自备份）
# archived_at = 现在（什么时候搬进来的）
# 两个不是一回事，不能拿 ts 填。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

p = 'src/memory-chat-import.js'
with open(p, encoding='utf-8') as f:
    s = f.read()

if 'archived_at' in s:
    print('已经改过了，跳过。')
    sys.exit(0)

ok = True


def one(name, old, new):
    global s, ok
    n = s.count(old)
    if n != 1:
        print('  %-12s 锚点命中 %d 次（要 1）——没改' % (name, n))
        ok = False
        return
    s = s.replace(old, new, 1)
    print('  %-12s 改了' % name)


one('INSERT',
    "  const put = stmt('INSERT INTO conversation_archive (ts, speaker, content) VALUES (?, ?, ?)');",
    "  // 四列：archived_at 是 NOT NULL（state.js:65）。\n"
    "  // ts 是当时说这句话的时间，archived_at 是搬进来的时间，两回事。\n"
    "  const put = stmt(\n"
    "    'INSERT INTO conversation_archive (ts, speaker, content, archived_at) VALUES (?, ?, ?, ?)'\n"
    "  );")

one('run',
    "    put.run(when, role === 'user' ? USER_NAME : AI_NAME, content);",
    "    put.run(when, role === 'user' ? USER_NAME : AI_NAME, content, now);")

if not ok:
    print('\n锚点没对上，没写盘。')
    sys.exit(1)

shutil.copy(p, '/root/memory-chat-import.js.before-archivedat')
with open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n接下来：')
print('  node --check src/memory-chat-import.js && pm2 restart vesper --update-env')
print('然后刷新页面，从「第一步」重新点。')
