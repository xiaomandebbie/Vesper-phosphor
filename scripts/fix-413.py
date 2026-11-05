#!/usr/bin/env python3
# 修日记那一步的 HTTP 413。
#
# 病因：上一版是「先 push 再看超没超」，所以一条几千字的日记进批之后
# 才发现超了，这一批已经太大。而且比较用的是 t.length（字符数），
# 中文一个字 UTF-8 是 3 字节，所以真实体积是算出来的三倍。
#
# 两处改：
#   1. 先算再发：加这一条会超就先把手里的发出去，它进下一批
#   2. 单条本身就超阈值的，自己单独一批
#   3. 阈值按字节算（中文 ×3），降到 48 KB
#
# 服务端还把 express.json 的 limit 提到 2mb：单篇日记再长也能过。
# 这一条只改导入这条路由，不动全局。
#
# 在 /root/vesper-phosphor 下跑。幂等。已经导进去的三份不会双份（按原 id 写库）。

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

# ── 1. 前端分批：先算再发 ──

OLD = """  // \u6309\u5b57\u8282\u5206\u6279\uff1a\u5168\u5c40 express.json() \u9ed8\u8ba4\u53ea\u6536 100 KB\uff0c\u6240\u4ee5 60 KB \u4e00\u6279\u3002
  function sendText(kind, text) {
    var lines = text.split('\\n');
    var batch = [];
    var bytes = 0;
    var done = 0;
    var chain = Promise.resolve();

    function flush() {
      if (!batch.length) return;
      var mine = batch;
      batch = [];
      bytes = 0;
      chain = chain.then(function () {
        return post(kind, mine).then(function (d) {
          if (d && d.error) throw new Error(d.error);
          done += (d && d.n) || 0;
        });
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var o = null;
      try { o = JSON.parse(t); } catch (e) { continue; }
      if (!o || !o.payload) continue;
      batch.push(o);
      bytes += t.length;
      if (bytes > 60000) flush();
    }
    flush();
    return chain.then(function () { return done; });
  }
"""

NEW = """  // \u6309\u5b57\u8282\u5206\u6279\u3002\u4e09\u4ef6\u4e8b\u8981\u7d27\uff1a
  //
  //   \u00b7 \u5148\u7b97\u518d\u53d1\uff1a\u52a0\u8fd9\u4e00\u6761\u4f1a\u8d85\u5c31\u5148\u628a\u624b\u91cc\u7684\u53d1\u51fa\u53bb\u3002\u4e0a\u4e00\u7248\u662f\u5148 push \u518d\u68c0\u67e5\uff0c
  //     \u6240\u4ee5\u4e00\u7bc7\u51e0\u5343\u5b57\u7684\u65e5\u8bb0\u8fdb\u6279\u4e4b\u540e\u8fd9\u4e00\u6279\u5df2\u7ecf\u592a\u5927 \u2014\u2014 \u90a3\u5c31\u662f 413\u3002
  //   \u00b7 \u5355\u6761\u672c\u8eab\u5c31\u8d85\u9608\u503c\u7684\uff0c\u81ea\u5df1\u5355\u72ec\u4e00\u6279\u3002
  //   \u00b7 \u4e2d\u6587\u4e00\u4e2a\u5b57 UTF-8 \u662f 3 \u5b57\u8282\uff0c\u6240\u4ee5\u4e0d\u80fd\u7528 t.length \u5f53\u5b57\u8282\u6570\u3002
  function sendText(kind, text) {
    var lines = text.split('\\n');
    var batch = [];
    var bytes = 0;
    var done = 0;
    var chain = Promise.resolve();

    function flush() {
      if (!batch.length) return;
      var mine = batch;
      batch = [];
      bytes = 0;
      chain = chain.then(function () {
        return post(kind, mine).then(function (d) {
          if (d && d.error) throw new Error(d.error);
          done += (d && d.n) || 0;
        });
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var o = null;
      try { o = JSON.parse(t); } catch (e) { continue; }
      if (!o || !o.payload) continue;
      // \u7c97\u4f30 UTF-8 \u5b57\u8282\uff1a\u4e2d\u6587 3 \u500d\u3002\u4f30\u591a\u4e86\u6700\u591a\u591a\u53d1\u51e0\u6279\uff0c\u4f30\u5c11\u4e86\u5c31\u662f 413\u3002
      var n = t.length;
      for (var k = 0; k < t.length; k++) if (t.charCodeAt(k) > 127) n += 2;
      if (bytes && bytes + n > BATCH_BYTES) flush();
      batch.push(o);
      bytes += n;
      if (bytes >= BATCH_BYTES) flush();
    }
    flush();
    return chain.then(function () { return done; });
  }
"""

if s.count(OLD) == 1:
    s = s.replace(OLD, NEW, 1)
    print('分批逻辑    改了（先算再发）')
else:
    print('分批逻辑    锚点命中 %d 次（要 1）——没改' % s.count(OLD))
    ok = False

# 阈值常量摆在前端脚本开头
OLD_VAR = "  var PARTS = "
NEW_VAR = "  var BATCH_BYTES = 48000;\n  var PARTS = "
if s.count(OLD_VAR) == 1:
    s = s.replace(OLD_VAR, NEW_VAR, 1)
    print('阈值常量    改了（48 KB）')
else:
    print('阈值常量    锚点命中 %d 次（要 1）——没改' % s.count(OLD_VAR))
    ok = False

# ── 2. 服务端：这条路由单独给 2mb ──

OLD_ROUTE = "  app.post('/memories/manage/import/batch', requireBasicAuth, (req, res) => {"
NEW_ROUTE = (
    "  // \u8fd9\u6761\u8def\u7531\u5355\u72ec\u7ed9 2mb\uff1a\u5168\u5c40 express.json() \u9ed8\u8ba4 100 KB\uff0c\n"
    "  // \u5355\u7bc7\u65e5\u8bb0\u518d\u957f\u4e5f\u80fd\u8fc7\u3002\u53ea\u6539\u8fd9\u91cc\uff0c\u4e0d\u52a8\u5168\u5c40\u3002\n"
    "  const bigJson = express.json({ limit: '2mb' });\n"
    "  app.post('/memories/manage/import/batch', requireBasicAuth, bigJson, (req, res) => {"
)
if s.count(OLD_ROUTE) == 1:
    s = s.replace(OLD_ROUTE, NEW_ROUTE, 1)
    print('路由限额    改了（2mb）')
else:
    print('路由限额    锚点命中 %d 次（要 1）——没改' % s.count(OLD_ROUTE))
    ok = False

# 要用 express.json 就得引 express
OLD_IMP = "import db from './state.js';"
NEW_IMP = "import express from 'express';\nimport db from './state.js';"
if 'import express from' in s:
    print('express 引入  已有')
elif s.count(OLD_IMP) == 1:
    s = s.replace(OLD_IMP, NEW_IMP, 1)
    print('express 引入  改了')
else:
    print('express 引入  锚点命中 %d 次（要 1）——没改' % s.count(OLD_IMP))
    ok = False

if not ok:
    print('\n有锚点没对上，没写盘。')
    sys.exit(1)

shutil.copy(path, '/root/memory-import.js.before-413')
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n写好了。接下来：')
print('  node --check src/memory-import.js && pm2 restart vesper --update-env')
print('然后刷新导入页，重新点一次。前三份不会双份。')
