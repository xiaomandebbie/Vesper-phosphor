#!/usr/bin/env python3
# 接最后两件：
#   1. vesper.js 挂 mcp-page
#   2. 个人页加一行 MCP 入口
#
# 工具层（memory-tools.js）和 chat-bus 那边上一轮已经推了，
# 不需要接线——chat-bus 自己 import。
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


# ── 1. 个人页加 MCP 入口 ──
#
# 摆在后台日志后面——都是「看一眼底层在干什么」这一类。

mep = 'src/me-page.js'
print(mep)
edit(mep, 'MCP 入口',
     "    {\n      name: '记忆设置',",
     "    {\n"
     "      name: 'MCP',\n"
     "      what: '他手上连着哪几个服务、每个有哪些工具',\n"
     "      href: '/me/mcp',\n"
     "    },\n"
     "    {\n      name: '记忆设置',",
     "href: '/me/mcp',")

# ── 2. vesper.js 挂 mcp-page ──

IMP = "import { registerMcpPage } from './mcp-page.js';"
CALL = 'registerMcpPage(app, { requireBasicAuth });'
A_IMP = "import { registerMeRoutes } from './me-page.js';"
A_CALL = 'registerMeRoutes(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
lines = load(vp).split('\n')
has_imp = any(l.strip() == A_IMP for l in lines)
has_call = any(l.strip() == A_CALL for l in lines)
print('  锚点 import 在不在 ->', has_imp)
print('  锚点 调用   在不在 ->', has_call)
if not (has_imp and has_call):
    print('\n找不到 registerMeRoutes，没写盘。')
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
        out.append('// 他手上连着哪几个 MCP（见 mcp-page.js），只看不改')
        out.append(CALL)
        wc = True
bodies[vp] = '\n'.join(out)
print('  import %d 处 · 调用 %d 处'
      % (bodies[vp].count(IMP), bodies[vp].count(CALL)))

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-tools2')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in mcp-page me-page vesper memory-tools chat-bus chat-page; do \\')
print('    node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
