#!/usr/bin/env python3
# 把记忆这一层接进去，并修掉我自己留的两处璵瘸。
#
# 在 /root/vesper-phosphor 下跑。幂等：改过的跳过，锚点不唯一就整个不写盘。
#
# 两处璵瘸都是我写 memory-ui.js 时留的：
#   1. 条目表单里一个标签被打成了「距Picture最后几条」
#   2. entryFields 这个函数根本没用上

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

ok = True


def patch(path, edits):
    global ok
    with open(path, encoding='utf-8') as f:
        s = f.read()
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-memory')
    for name, old, new, mark in edits:
        if mark in s:
            print('  %-16s 已改过，跳过' % name)
            continue
        n = s.count(old)
        if n != 1:
            print('  %-16s 锚点命中 %d 次（要 1）——没改' % (name, n))
            ok = False
            continue
        s = s.replace(old, new, 1)
        print('  %-16s 改了' % name)
    return s


# ── memory-ui.js：修错字、删死函数 ──

DEAD = """  const entryFields = (b, id) => ({
    id,
    bookId: b,
    title: undefined,
  });

"""

mu = 'src/memory-ui.js'
print(mu)
s_mu = patch(mu, [
    ('标签错字',
     '按深度插入时，距Picture最后几条',
     '按深度插入时，插在倒数第几条前',
     '插在倒数第几条前'),
    ('删死函数', DEAD, '', 'const entryFields = (b, id)'),
])

# 死函数那条的 mark 是「还在就该删」，跟其他相反，单独处理
if 'const entryFields = (b, id)' in s_mu:
    if s_mu.count(DEAD) == 1:
        s_mu = s_mu.replace(DEAD, '', 1)
        print('  %-16s 改了' % '删死函数')
    else:
        print('  %-16s 没找到完整形状，留着不动（不影响运行）' % '删死函数')
else:
    print('  %-16s 已经没了' % '删死函数')

# ── vesper.js：接进去 ──
#
# 跟着 registerMemoriesRoutes 那一行走——记忆库列表页和这个编辑入口是同一栏。
# 必须挂在它后面：/memories/manage 要是比 /memories 晚注册，就被前面那条接走了。

IMP = "import { registerMemoryUI } from './memory-ui.js';"
CALL = 'registerMemoryUI(app, { requireBasicAuth });'
A_IMP = "import { registerMemoriesRoutes } from './memories-page.js';"
A_CALL = 'registerMemoriesRoutes(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
with open(vp, encoding='utf-8') as f:
    lines = f.read().split('\n')
shutil.copy(vp, '/root/vesper.js.before-memory')

has_imp = any(l.strip() == A_IMP for l in lines)
has_call = any(l.strip() == A_CALL for l in lines)
print('  锚点 import  在不在 ->', has_imp)
print('  锚点 调用    在不在 ->', has_call)
if not (has_imp and has_call):
    print('\n锚点没对上，没写盘。把这两行发给小克。')
    sys.exit(1)

out = []
wrote_imp = wrote_call = False
for l in lines:
    k = l.strip()
    if k in (IMP, CALL):
        continue  # 先丢掉已有的，下面统一加回，跑几遍都一样
    out.append(l)
    if not wrote_imp and k == A_IMP:
        out.append(IMP)
        wrote_imp = True
    if not wrote_call and k == A_CALL:
        out.append('// 记忆的编辑入口（见 memory-ui.js）：指令、条目、资料、信息卡、世界书、日记')
        out.append(CALL)
        wrote_call = True

s_vp = '\n'.join(out)
print('  写入后 import %d 处 · 调用 %d 处' % (s_vp.count(IMP), s_vp.count(CALL)))

if not ok:
    print('\n有锚点没对上，没写盘。')
    sys.exit(1)

with open(mu, 'w', encoding='utf-8') as f:
    f.write(s_mu)
with open(vp, 'w', encoding='utf-8') as f:
    f.write(s_vp)

print('\n写好了。接下来：')
print('  for f in memory-store world-books memory-inject memory-ui chat-bus vesper; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
