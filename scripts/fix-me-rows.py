#!/usr/bin/env python3
# 个人页那个 rows 整段重写。
#
# 为什么不再插：apply-memory4.py 和 apply-memory5.py 都往这儿加过
# 「记忆设置」，所以本地现在有两行一样的——我那个锚点命中 2 次，
# 分辨不了该插哪一侧。
#
# 所以这次把整个数组换成一份确定的清单：跑几遍结果一样，
# 重复的自然消失。hasLogs 那个条件原样保留。
#
# 在 /root/vesper-phosphor 下跑。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

p = 'src/me-page.js'
with open(p, encoding='utf-8') as f:
    s = f.read()

HEAD = '  const rows = [\n'
TAIL = '\n  ];\n'

i = s.find(HEAD)
if i < 0:
    print('找不到 const rows = [，没写盘。')
    sys.exit(1)
j = s.find(TAIL, i)
if j < 0:
    print('找不到数组结尾，没写盘。')
    sys.exit(1)

old = s[i:j + len(TAIL)]
print('原数组 %d 行，里面有 %d 个条目'
      % (old.count('\n'), old.count("name: '")))
if old.count("name: '记忆设置'") > 1:
    print('确认：「记忆设置」重复了 %d 次，这次一并去掉'
          % old.count("name: '记忆设置'"))

NEW = """  const rows = [
    {
      name: '自定义',
      what: '改他和你的头像、名字、聊天气泡',
      href: '/moments/profile',
    },
    {
      name: 'MCP',
      what: '他手上连着哪几个服务、每个有哪些工具',
      href: '/me/mcp',
    },
    {
      name: '记忆设置',
      what: '每轮上限、跳对话记忆、语义索引',
      href: '/memories/manage/settings',
    },
    {
      name: '导入记忆',
      what: '把 Aru 导出的条目、资料、信息卡、日记、世界书搬过来',
      href: '/memories/manage/import',
    },
    {
      name: '导入聊天记录',
      what: '只导一位协作者的，其他人的不进来',
      href: '/memories/manage/import/chat-page',
    },
    {
      name: '后台日志',
      what: hasLogs
        ? 'VPS 上所有 pm2 进程最近的日志，按进程分开看'
        : '找不到 pm2 日志目录',
      href: hasLogs ? '/logs' : '',
      note: '可用 PM2_LOGS_DIR 指定',
    },
    {
      name: '收藏',
      what: '你收起来的那几条动态',
      href: '/moments/favorites',
    },
  ];
"""

s = s[:i] + NEW + s[j + len(TAIL):]
print('新数组 7 个条目：自定义、MCP、记忆设置、导入记忆、导入聊天记录、后台日志、收藏')

shutil.copy(p, '/root/me-page.js.before-merows')
with open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n写好了。接下来：')
print('  node --check src/me-page.js && pm2 restart vesper --update-env')
