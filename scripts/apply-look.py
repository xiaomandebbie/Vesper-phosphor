#!/usr/bin/env python3
# 「自定义 → 聊天气泡」这两处接线。
#
# 为什么是个文件而不是粘贴的命令：小满的手机终端粘长文本会被截断。
# 10-31 那次 leto-steps.js 就是这么卡死的（heredoc 截一半，bash 在等 `>`）。
# 所以长脚本一律推这里，她 curl 下来跑。
#
# 幂等：每处改动先找标记，改过的跳过；锚点不是唯一命中就整个不写盘。
# 在 /root/vesper-phosphor 下跑。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑这个脚本')
    sys.exit(1)

ok = True


def patch(path, edits):
    global ok
    with open(path, encoding='utf-8') as f:
        s = f.read()
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-look')
    for name, old, new, mark in edits:
        if mark in s:
            print('  %-14s 已改过，跳过' % name)
            continue
        n = s.count(old)
        if n != 1:
            print('  %-14s 锚点命中 %d 次（要 1）——没改' % (name, n))
            ok = False
            continue
        s = s.replace(old, new, 1)
        print('  %-14s 改了' % name)
    return s


LOOK_CARD = '''function renderLookCard(saved) {
  const v = getLook();
  const field = (key) => `<label for="lk-${key}">${LOOK_LABELS[key]}</label>
          <input id="lk-${key}" name="${key}" type="color" value="${escapeHtml(v[key])}"
            style="width:100%;height:40px;padding:2px;border-radius:10px" />`;
  return `<section class="card" aria-labelledby="lk-title">
    <h2 id="lk-title" class="section-title">聊天气泡</h2>
    <form method="post" action="/moments/look">
      <div class="profile-fields">
        ${['me_bg', 'me_fg', 'ta_bg', 'ta_fg'].map(field).join('')}
        <label for="lk-size">字体大小（${LOOK_RANGE.min}–${LOOK_RANGE.max}）</label>
        <input id="lk-size" name="size" type="number" min="${LOOK_RANGE.min}"
          max="${LOOK_RANGE.max}" step="1" value="${escapeHtml(v.size)}" />
      </div>
      <p class="hint">现在是这样：
        <span style="display:inline-block;margin:4px 6px 0 0;padding:6px 12px;border-radius:14px;background:${v.ta_bg};color:${v.ta_fg};font-size:${v.size}px">TA 说的话</span>
        <span style="display:inline-block;margin:4px 0 0;padding:6px 12px;border-radius:14px;background:${v.me_bg};color:${v.me_fg};font-size:${v.size}px">我说的话</span>
      </p>
      <p class="profile-status" role="status">${saved ? '已保存' : ''}</p>
      <div class="profile-actions">
        <button type="submit">保存</button>
        <button type="submit" name="reset" value="1" class="ghost">恢复默认</button>
      </div>
    </form>
  </section>`;
}

function renderProfilePage(saved) {'''

LOOK_ROUTE = """  app.post('/moments/look', requireBasicAuth, (req, res) => {
    const back = '/moments/profile';
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    try {
      if (req.body?.reset) {
        const r = resetLook();
        if (r.error) return res.status(500).send(errorPage(r.error, back));
      } else {
        const patch = {};
        for (const k of Object.keys(LOOK_DEFAULTS)) {
          if (Object.prototype.hasOwnProperty.call(req.body ?? {}, k)) patch[k] = req.body[k];
        }
        const r = saveLook(patch);
        if (r.error) return res.status(400).send(errorPage(r.error, back));
      }
    } catch (err) {
      console.error('moments look: 保存失败', err);
      return res.status(500).send(errorPage('保存失败了，看一下 vesper 的日志。', back));
    }
    res.redirect(303, `${back}?saved=look`);
  });

  app.post('/moments/profile/:who', requireBasicAuth, (req, res) => {"""

mp = 'src/moments-page.js'
print(mp)
s1 = patch(mp, [
    ('引入',
     "} from './moments-store.js';",
     "} from './moments-store.js';\n"
     "import { getLook, saveLook, resetLook, LOOK_DEFAULTS, LOOK_LABELS, LOOK_RANGE } from './chat-look.js';",
     "from './chat-look.js'"),
    ('气泡这张卡',
     'function renderProfilePage(saved) {',
     LOOK_CARD,
     'function renderLookCard'),
    ('摆进自定义页',
     "    ${PROFILE_WHO.map((w) => renderProfileCard(w, saved === w)).join('')}`,",
     "    ${PROFILE_WHO.map((w) => renderProfileCard(w, saved === w)).join('')}\n"
     "    ${renderLookCard(saved === 'look')}`,",
     "renderLookCard(saved === 'look')"),
    ('saved 认 look',
     '    const saved = PROFILE_WHO.includes(req.query.saved) ? req.query.saved : null;',
     "    const allow = [...PROFILE_WHO, 'look'];\n"
     '    const saved = allow.includes(req.query.saved) ? req.query.saved : null;',
     "[...PROFILE_WHO, 'look']"),
    ('保存路由',
     "  app.post('/moments/profile/:who', requireBasicAuth, (req, res) => {",
     LOOK_ROUTE,
     "'/moments/look'"),
])

cp = 'src/chat-page.js'
print(cp)
s2 = patch(cp, [
    ('引入',
     "import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';",
     "import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';\n"
     "import { lookCSS } from './chat-look.js';",
     "from './chat-look.js'"),
    ('样式追在后面',
     '`${titleOf(w)} · 晨暮星`,\n          ROOM_STYLE,',
     '`${titleOf(w)} · 晨暮星`,\n          ROOM_STYLE + lookCSS(),',
     'ROOM_STYLE + lookCSS()'),
])

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

with open(mp, 'w', encoding='utf-8') as f:
    f.write(s1)
with open(cp, 'w', encoding='utf-8') as f:
    f.write(s2)

print('\n写好了。接下来：')
print('  for f in chat-look moments-page chat-page; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
