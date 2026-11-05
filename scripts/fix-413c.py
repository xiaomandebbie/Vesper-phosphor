#!/usr/bin/env python3
# 修「第一步：读对话」的 HTTP 413。
#
# 病因是我写的：memory-ui2.js 里 BATCH = 400000，四十万字节一批。
# 中文一个字 UTF-8 占 3 字节，所以一批真实体积能到 1.2 MB——
# 服务端那条路由只给了 2mb，而 nginx 默认 client_max_body_size 是 1 MB，
# 所以卡在 nginx 就回 413 了。
#
# 记忆导入（memory-import.js）那边用的是 48000，全部跑通了。
# 所以这边改成同一个数：已经被验过的值，不再自己猜一个。
#
# 多发几批而已，它本来就是串行链的。
#
# 在 /root/vesper-phosphor 下跑。幂等。已经进去的 3991 条不会双份（按消息 id 记过）。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

path = 'src/memory-ui2.js'
with open(path, encoding='utf-8') as f:
    s = f.read()

old = '  var BATCH = 400000;'
new = ('  // 48 KB 一批。这个数是记忆导入那边跑通了的，不再自己猜：\n'
       '  // 40 万字节的话中文 ×3 能到 1.2 MB，nginx 默认只收 1 MB，直接 413。\n'
       '  var BATCH = 48000;')

if 'var BATCH = 48000;' in s:
    print('已经改过了，跳过。')
    sys.exit(0)

n = s.count(old)
if n != 1:
    print('锚点命中 %d 次（要 1）——没改。' % n)
    sys.exit(1)

s = s.replace(old, new, 1)
shutil.copy(path, '/root/memory-ui2.js.before-413c')
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)
print('分批降到 48 KB，改了。')

print('\n接下来：')
print('  node --check src/memory-ui2.js && pm2 restart vesper --update-env')
print('然后刷新那个页面（脚本嵌在 HTML 里），重新点「第一步」。')
