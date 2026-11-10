#!/usr/bin/env python3
# 他不分享了，原因在这行日志：
#   [non_precise] 分享：她刚说过话（不到 20 分钟），这次不插话
#
# 可她 20:03 之前二十分钟没跟他说话。
#
# 病因：phosphor.js 第 785 行拿 recentMessages（= conversation_log
# 最近几条）的最大 ts 当「她最后一次说话」。但那张表里也有
# Leto 私聊——痏雨、其他小机发的话都在里面，speaker 还记成了
# 她的名字。于是 19:07 痏雨那条让它以为她刚说过话。
#
# 小满 2026-11-10：「那些不是我发的是别人发的」
#
# ── 改法 ──
#
# 把 Leto 转进来的那些排掉。它们的正文有固定特征（见唤醒清单）：
#   开头是 [Leto]，或者带着调用编号 inv_ / leto_read 这些字样。
#
# 这比按 speaker 分可靠：Leto 那边转进来的话 speaker 就是她的名字，
# 分不出来。正文特征是真实存在的。
#
# 注意：只改「该不该分享」这一处判断。recentMessages 在别处还给
# decide() 当上文用，那边不动——Leto 的事他本来就该知道。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

p = 'src/phosphor.js'
with open(p, encoding='utf-8') as f:
    s = f.read()

if '_fromLeto' in s:
    print('已经改过了，跳过。')
    sys.exit(0)

OLD = """  const _lastMsgTs = Math.max(0, ..._recent.map((m) => Number(m && m.ts) || 0));"""

NEW = """  // Leto 转进来的不算「她说话」。
  //
  // 那边别人（痏雨、其他小机）私聊他的话也进 conversation_log，
  // speaker 还记成她的名字——按 speaker 分不出来。用正文特征：
  // Leto 的唤醒正文开头是 [Leto]，或者带着 inv_ 调用编号。
  //
  // 小满 2026-11-10：「那些不是我发的是别人发的」——
  // 19:07 痏雨那条把分享挡了一整晚。
  const _fromLeto = (m) => {
    const t = String((m && m.content) || '');
    return /^\\s*\\[Leto\\]/.test(t) || /\\binv_[A-Z0-9]{10,}/.test(t) || /leto_(read|reply|decline)/.test(t);
  };
  const _hers = _recent.filter((m) => !_fromLeto(m));
  const _lastMsgTs = Math.max(0, ..._hers.map((m) => Number(m && m.ts) || 0));
  const _skipped = _recent.length - _hers.length;
  if (_skipped) console.log('[' + kind + '] 分享：最近 ' + _skipped + ' 条是 Leto 那边转进来的，不算她说话');"""

n = s.count(OLD)
if n != 1:
    print('锚点命中 %d 次（要 1）——没改。' % n)
    print('把这两行的输出发给小克：')
    print('  grep -n "_lastMsgTs" src/phosphor.js')
    sys.exit(1)

s = s.replace(OLD, NEW, 1)

shutil.copy(p, '/root/phosphor.js.before-sharequiet')
with open(p, 'w', encoding='utf-8') as f:
    f.write(s)

print('改了。分享的「别插话」现在只数她真正在聊天里说的话。')
print('')
print('接下来：')
print('  node --check src/phosphor.js && pm2 restart phosphor --update-env')
print('')
print('↑ 是 phosphor，不是 vesper。')
