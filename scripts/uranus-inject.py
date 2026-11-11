#!/usr/bin/env python3
# uranus 线路也带上小酒馆状态和「她正在做的事」。
#
# 小满 2026-11-11：「那两样也要加」
#
# 原来这两样只在 recordConversation（= aru-chat）时注入。
# 现在 uranus 线路也注入；但 Uranus 问「隔几小时开口」那一句（_isUranusJudge）不注入——
# 那只要一个数字，塞进去只是白费 token。
#
# 只改注入条件，不改记录逻辑：uranus 线路照旧不把 Uranus 拼的 user 消息记成她说的话。
# 在 /root/vesper-phosphor 下跑。幂等。

import os, shutil, sys

p = 'src/gateway.js'
if not os.path.isfile(p):
    print('请在 /root/vesper-phosphor 下跑'); sys.exit(1)
s = open(p, encoding='utf-8').read()

if '_injectForUranus' in s:
    print('已经改过了，跳过。'); sys.exit(0)

if "routingTable['uranus']" not in s:
    print('还没有 uranus 线路，先跑 add-uranus-route.py。'); sys.exit(1)

at = s.find('applyProof(messages)')
if at < 0:
    print('找不到 applyProof(messages)——没改。发小克：grep -n "applyProof\\|recordConversation" src/gateway.js'); sys.exit(1)

COND = 'if (recordConversation) {'
head = s.rfind(COND, max(0, at - 600), at)
if head < 0:
    print('applyProof 前面找不到 if (recordConversation) {——没改。发小克：grep -n "applyProof\\|recordConversation" src/gateway.js'); sys.exit(1)

NEW = ("// uranus 线路也要小酒馆和「她正在做的事」（小满 2026-11-11）；问小时数那句不要\n"
       "  const _injectForUranus = route.source === 'uranus' &&\n"
       "    !(typeof _isUranusJudge !== 'undefined' && _isUranusJudge);\n"
       "  if (recordConversation || _injectForUranus) {")

s = s[:head] + NEW + s[head + len(COND):]
shutil.copy(p, '/root/gateway.js.before-uranusinject')
open(p, 'w', encoding='utf-8').write(s)
print('改了。接下来：node --check src/gateway.js && pm2 restart vesper-gateway --update-env')
