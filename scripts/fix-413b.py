#!/usr/bin/env python3
# 修日记那一步的 HTTP 413。
#
# fix-413.py 里我把整段 sendText 当锚点，里面带了 \u 转义的中文注释和
# 模板字符串里的 \\n，和文件里的真实字节对不上 —— 0 次命中。
#
# 这一版只抓三行纯代码（不带中文、不带反斜杠）：
#   batch.push(o);
#   bytes += t.length;
#   if (bytes > 60000) flush();
#
# 病因两个，叠在一起：
#   1. 先 push 再检查 —— 一篇几千字的日记进批之后这一批已经太大了
#   2. t.length 是字符数，中文一个字 UTF-8 占 3 字节，真实体积是三倍
#
# 在 /root/vesper-phosphor 下跑。幂等。已导进去的三份不会双份（按原 id 写库）。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

path = 'src/memory-import.js'
with open(path, encoding='utf-8') as f:
    s = f.read()

if 'BATCH_BYTES' in s:
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


# 1. 分批：先算再发。只动这三行，不碰周围带转义的代码。
one(
    '分批逻辑',
    "      batch.push(o);\n"
    "      bytes += t.length;\n"
    "      if (bytes > 60000) flush();",

    "      // 粗估 UTF-8 字节：非 ASCII 算 3。估多了最多多发几批，估少了就是 413。\n"
    "      var n = t.length;\n"
    "      for (var k = 0; k < t.length; k++) if (t.charCodeAt(k) > 127) n += 2;\n"
    "      // 加这一条会超就先把手里的发走，它进下一批。\n"
    "      // 上一版是先 push 再检查，所以一篇长日记进批之后已经收不住了。\n"
    "      if (bytes && bytes + n > BATCH_BYTES) flush();\n"
    "      batch.push(o);\n"
    "      bytes += n;\n"
    "      // 单条本身就超阈值的，到这儿自己单独一批发出去。\n"
    "      if (bytes >= BATCH_BYTES) flush();",
)

# 2. 阈值常量
one('阈值常量', '  var PARTS = ', '  var BATCH_BYTES = 48000;\n  var PARTS = ')

# 3. 这条路由单独给 2mb（全局 express.json() 默认 100 KB，单篇日记能过）
one(
    '路由限额',
    "  app.post('/memories/manage/import/batch', requireBasicAuth, (req, res) => {",
    "  // 这条路由单独给 2mb：全局 express.json() 默认 100 KB，\n"
    "  // 单篇日记再长也能过。只改这里，不动全局。\n"
    "  const bigJson = express.json({ limit: '2mb' });\n"
    "  app.post('/memories/manage/import/batch', requireBasicAuth, bigJson, (req, res) => {",
)

# 4. 要用 express.json 就得引 express
if 'import express from' in s:
    print('  %-12s 已有' % 'express')
else:
    one('express', "import db from './state.js';",
        "import express from 'express';\nimport db from './state.js';")

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

shutil.copy(path, '/root/memory-import.js.before-413')
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n写好了。接下来：')
print('  node --check src/memory-import.js && pm2 restart vesper --update-env')
print('然后刷新导入页（脚本嵌在 HTML 里），重新点一次。')
