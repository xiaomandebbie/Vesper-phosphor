#!/usr/bin/env python3
# 413 的真正原因。
#
# vesper.js 里有个全局 express.json()，没设 limit，默认就是 100 KB。
# 它在所有路由之前跑，所以我在导入那条路由上写的 limit: '2mb'
# 根本没机会生效——请求在全局这一层就被打回 413 了。
#
# 记忆导入能跑通是因为那边 48 KB 一批，刚好在 100 KB 以下。
# 聊天导入 40 万字节一批，中文 ×3 就是 1.2 MB，必死。
#
# 两处一起改：全局提到 2mb，聊天导入降到 48 KB（和记忆导入同一个口径）。
# 双保险：即使哪天改大了批次，全局这边也接得住。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

ok = True

# ── 1. 全局 express.json ──

vp = 'src/vesper.js'
with open(vp, encoding='utf-8') as f:
    v = f.read()

if "express.json({ limit: '2mb' })" in v:
    print('%-16s 已改过，跳过' % '全局 json')
else:
    old = 'const _globalJson = express.json();'
    new = ("// 上限 2mb：默认只有 100 KB，而它在所有路由之前跑——\n"
           "// 路由自己写 limit 没用，请求在这儿就被打回 413 了（导入备份踩过）。\n"
           "const _globalJson = express.json({ limit: '2mb' });")
    n = v.count(old)
    if n != 1:
        print('%-16s 锚点命中 %d 次（要 1）——没改' % ('全局 json', n))
        ok = False
    else:
        v = v.replace(old, new, 1)
        print('%-16s 改了（2mb）' % '全局 json')

# ── 2. 聊天导入的批次 ──

ui = 'src/memory-ui2.js'
with open(ui, encoding='utf-8') as f:
    u = f.read()

if 'var BATCH = 48000;' in u:
    print('%-16s 已改过，跳过' % '聊天批次')
else:
    old = '  var BATCH = 400000;'
    new = ('  // 48 KB 一批。这个数是记忆导入那边跑通了的，不自己猜。\n'
           '  var BATCH = 48000;')
    n = u.count(old)
    if n != 1:
        print('%-16s 锚点命中 %d 次（要 1）——没改' % ('聊天批次', n))
        ok = False
    else:
        u = u.replace(old, new, 1)
        print('%-16s 改了（48 KB）' % '聊天批次')

if not ok:
    print('\n有锚点没对上，没写盘。')
    sys.exit(1)

shutil.copy(vp, '/root/vesper.js.before-413d')
shutil.copy(ui, '/root/memory-ui2.js.before-413d')
with open(vp, 'w', encoding='utf-8') as f:
    f.write(v)
with open(ui, 'w', encoding='utf-8') as f:
    f.write(u)

print('\n接下来：')
print('  node --check src/vesper.js && node --check src/memory-ui2.js \\')
print('    && pm2 restart vesper --update-env')
print('然后刷新那个页面，从「第一步」重新点。')
