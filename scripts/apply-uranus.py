#!/usr/bin/env python3
# 私域页：接两处。
#   1. vesper.js 挂 uranus-proxy——必须在全局 express.json() 之前
#   2. 发现页加一个「私域」图标，和其他入口一个样式
#
# 小满 2026-11-08：「我想包成私域放晨暮星的发现页面，也要做成
# 其他入口一样的小应用样式」
#
# ── 位置是硬要求 ──
#
# Uranus 带图片上传和 SSE。要是挂在 express.json() 后面，请求体已经
# 被解成对象了，重新编一遍会弄坏上传。所以跟记忆库、音乐、台灯
# 摆在同一处（vesper.js 第 56–64 行那一组）。
#
# 锚点用 registerLightProxy 那一行：它就在这组的最后。
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


# ── 1. vesper.js ──

vp = 'src/vesper.js'
print(vp)
edit(vp, '引入',
     "import { registerLightProxy } from './light-proxy.js';",
     "import { registerLightProxy } from './light-proxy.js';\n"
     "import { registerUranusProxy } from './uranus-proxy.js';",
     "from './uranus-proxy.js'")

edit(vp, '挂在 json 之前',
     'const lightProxy = registerLightProxy(app, { requireBasicAuth });',
     'const lightProxy = registerLightProxy(app, { requireBasicAuth });\n'
     '// 私域页 /uranus（见 uranus-proxy.js）：本机 8787 那个 Uranus。\n'
     '// 和上面几个同理要拿原始请求体（它带图片上传和 SSE），\n'
     '// 所以必须在下面的 express.json() 之前。\n'
     'const uranusProxy = registerUranusProxy(app, { requireBasicAuth });',
     'registerUranusProxy(app,')

# ── 2. 发现页加一个图标 ──
#
# key 写死（'uranus'）：她改过的名字和图标按 key 存，换了 key 就对不上了。

dp = 'src/discover-page.js'
print(dp)
edit(dp, '引入',
     "import { renderAppGrid, APPS_CSS, APPS_SCRIPT, registerDiscoverAppRoutes } from './discover-apps.js';",
     "import { renderAppGrid, APPS_CSS, APPS_SCRIPT, registerDiscoverAppRoutes } from './discover-apps.js';\n"
     "import { uranusEnabled } from './uranus-proxy.js';",
     "from './uranus-proxy.js'")

# 摆在论坛后面（最后一个）。用数组收尾做锚点。
edit(dp, '加入口',
     "      note: '\\u6ca1\\u914d NAV_FORUM_URL',\n      external: true,\n    },\n  ];",
     "      note: '\\u6ca1\\u914d NAV_FORUM_URL',\n      external: true,\n    },\n"
     "    {\n"
     "      key: 'uranus',\n"
     "      name: '\\u79c1\\u57df',\n"
     "      what: '\\u4ed6\\u5728 iMessage \\u90a3\\u8fb9\\u7684\\u6837\\u5b50\\u3002\\u8dd1\\u5728\\u672c\\u673a\\uff0c\\u4ece\\u8fd9\\u513f\\u8f6c\\u4e00\\u9053\\u8fdb\\u53bb',\n"
     "      meta: '',\n"
     "      href: uranusEnabled() ? '/uranus' : '',\n"
     "      note: '\\u6ca1\\u914d URANUS_PAGE_URL \\u6216\\u8005\\u586b\\u4e86 off',\n"
     "    },\n"
     "  ];",
     "key: 'uranus',")

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

# 位置体检：确认真的在 express.json() 前面
s = bodies[vp]
at_proxy = s.find('registerUranusProxy(app,')
at_json = s.find('const _globalJson = express.json()')
if at_proxy < 0 or at_json < 0:
    print('\n找不到位置标记，没写盘。')
    sys.exit(1)
if at_proxy > at_json:
    print('\n代理挂在了 express.json() 后面——图片上传会坏。没写盘。')
    sys.exit(1)
print('\n位置对：代理在 express.json() 之前')

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-uranus')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  node --check src/uranus-proxy.js && node --check src/vesper.js \\')
print('    && node --check src/discover-page.js')
print('')
print('然后往 .env 加两行（密码换成你自己的）：')
print('  URANUS_USER=Uranus')
print('  URANUS_PASSWORD=你那个密码')
print('')
print('  pm2 restart vesper --update-env')
