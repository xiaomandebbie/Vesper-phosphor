#!/usr/bin/env python3
# Uranus 的主动唤醒每次会问模型「隔多久开口」，请求里最后一句 user 是
#   现在只回一个数字（小时数），别的什么都不要写。
# （Uranus server/src/proactive.js:259）。它走的是网关 aru-chat 线路，
# 于是模型回的 1 / 0.5 被记成「允朔说的话」，挡住了晨暮星的分享。
#
# 改法：认出这句话就不记（两头都不记）。转发照旧，Uranus 照常拿到数字。
# 只动 recordConversation 那一行。幂等。在 /root/vesper-phosphor 下跑。

import os, shutil, sys

p = 'src/gateway.js'
if not os.path.isfile(p):
    print('请在 /root/vesper-phosphor 下跑'); sys.exit(1)
s = open(p, encoding='utf-8').read()
if '_isUranusJudge' in s:
    print('已经改过了，跳过。'); sys.exit(0)

OLD = "  const recordConversation = route.source === 'client';"
NEW = (
    "  // Uranus 问「隔几小时开口」的那一句不是聊天，不记（小满 2026-11-11）。\n"
    "  // 否则模型回的 1 / 0.5 会记成允朔说的话，挡住晨暮星的分享。\n"
    "  const _isUranusJudge = (() => {\n"
    "    const ms = Array.isArray(req.body?.messages) ? req.body.messages : [];\n"
    "    const last = [...ms].reverse().find((m) => m && m.role === 'user');\n"
    "    const c = typeof last?.content === 'string' ? last.content : JSON.stringify(last?.content ?? '');\n"
    "    return /只回一个数字（小时数）/.test(c);\n"
    "  })();\n"
    "  if (_isUranusJudge) console.log('gateway: Uranus 问小时数，这轮不记进 conversation_log');\n"
    "  const recordConversation = route.source === 'client' && !_isUranusJudge;"
)
n = s.count(OLD)
if n != 1:
    print('锚点命中 %d 次（要 1）——没改。发小克：grep -n recordConversation src/gateway.js' % n); sys.exit(1)
shutil.copy(p, '/root/gateway.js.before-urjudge')
open(p, 'w', encoding='utf-8').write(s.replace(OLD, NEW, 1))
print('改了。接下来：node --check src/gateway.js && pm2 restart vesper-gateway --update-env')
