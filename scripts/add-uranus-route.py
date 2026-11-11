#!/usr/bin/env python3
# 给 Uranus 单开一条网关线路。
#
# 小满 2026-11-11：「20:16 我没说话，是不是 Uranus 注入的」——是。
# Uranus 主动发消息那一轮走的是 aru-chat，它把「[时间 : … | 周三 · 双十一, 工作日 |
# 天气: 长沙 …]」拼进最后一条 user 消息（Uranus prompt.js 的 injectWeather）。
# aru-chat 的 source 是 client，网关就把这条当成小满说的话记进 conversation_log，
# 于是 heartbeat 和晨暮星都以为她 20:16 说过话。
#
# 改法：加一条 uranus 线路，上游和 aru-chat 完全一样（同一组 CLIENT_UPSTREAM_*），
# 但 source 不是 client——网关对它不记对话、不注入小酒馆和「她正在做的事」。
# 然后在 Uranus 设置里把模型名从 aru-chat 改成 uranus。
#
# 只加一行，不动 aru-chat 本身。幂等。在 /root/vesper-phosphor 下跑。

import os, shutil, sys

p = 'src/gateway.js'
if not os.path.isfile(p):
    print('请在 /root/vesper-phosphor 下跑'); sys.exit(1)
s = open(p, encoding='utf-8').read()
if "routingTable['uranus']" in s:
    print('已经加过了，跳过。'); sys.exit(0)

OLD = "routingTable['aru-chat'] = clientUpstream;"
NEW = (OLD + "\n"
       "// Uranus 专用（2026-11-11）：上游同 aru-chat，但不记对话。\n"
       "// 它会把时间天气拼进 user 消息，走 aru-chat 就被记成小满说了话。\n"
       "routingTable['uranus'] = { ...clientUpstream, source: 'uranus' };")
n = s.count(OLD)
if n != 1:
    print('锚点命中 %d 次（要 1）——没改。发小克：grep -n routingTable src/gateway.js' % n); sys.exit(1)
shutil.copy(p, '/root/gateway.js.before-uranusroute')
open(p, 'w', encoding='utf-8').write(s.replace(OLD, NEW, 1))
print('加了 uranus 线路。接下来：node --check src/gateway.js && pm2 restart vesper-gateway --update-env')
