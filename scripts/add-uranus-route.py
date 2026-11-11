#!/usr/bin/env python3
# 给 Uranus 单开一条网关线路 uranus。
#
# 2026-11-11 查到：conversation_log 里 18:34 / 18:46 / 20:16 那几条带 $ 分段的，
# 是 Uranus 在 iMessage 里主动发给她的话——这是真发生的，要留在共享记忆里。
# 但 Uranus 那一轮请求里的 user 消息是它自己拼的「[时间 : … 天气 …]」，
# 不是她说的，不该记。
#
# 所以 uranus 线路：上游同 aru-chat；只记他的回复，不记 user，
# 不注入小酒馆 / 「她正在做的事」。问小时数那一句（_isUranusJudge）连回复也不记。
#
# 幂等。在 /root/vesper-phosphor 下跑。

import os, shutil, sys

p = 'src/gateway.js'
if not os.path.isfile(p):
    print('请在 /root/vesper-phosphor 下跑'); sys.exit(1)
s = open(p, encoding='utf-8').read()
orig = s
ok = True

# 1. 线路
if "routingTable['uranus']" in s:
    print('  线路          已有，跳过')
else:
    OLD = "routingTable['aru-chat'] = clientUpstream;"
    if s.count(OLD) != 1:
        print('  线路          锚点命中 %d 次——没改' % s.count(OLD)); ok = False
    else:
        s = s.replace(OLD, OLD + "\n"
            "// Uranus 专用（2026-11-11）：上游同 aru-chat，只记他的回复。\n"
            "routingTable['uranus'] = { ...clientUpstream, source: 'uranus' };", 1)
        print('  线路          改了')

# 2. 他的回复照记
if 'recordAssistant' in s:
    print('  只记回复      已有，跳过')
else:
    OLD2 = '    if (!recordConversation || !upstreamRes.ok) {'
    NEW2 = ("    // uranus 线路：他发给她的话要进共享记忆，但 user 那条是 Uranus 拼的，上面没记\n"
            "    const recordAssistant = recordConversation ||\n"
            "      (route.source === 'uranus' && !(typeof _isUranusJudge !== 'undefined' && _isUranusJudge));\n"
            "    if (!recordAssistant || !upstreamRes.ok) {")
    if s.count(OLD2) != 1:
        print('  只记回复      锚点命中 %d 次——没改' % s.count(OLD2)); ok = False
    else:
        s = s.replace(OLD2, NEW2, 1)
        print('  只记回复      改了')

if not ok:
    print('\n有锚点没对上，没写盘。发小克：grep -n "recordConversation\\|routingTable" src/gateway.js'); sys.exit(1)
if s != orig:
    shutil.copy(p, '/root/gateway.js.before-uranusroute2')
    open(p, 'w', encoding='utf-8').write(s)
print('\n接下来：node --check src/gateway.js && pm2 restart vesper-gateway --update-env')
