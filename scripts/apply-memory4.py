#!/usr/bin/env python3
# 版式调整。apply-memory3.py 里有两处锚点是我猜的，都错了：
#   · memories-page.js 渲染列表用的是 ${renderList()}，不是 ${libraries
#   · me-page.js 里写的是真中文 name: '收藏'，不是 \u6536\u85cf 转义
# 这一版按读到的真实原文写。
#
# 在 /root/vesper-phosphor 下跑。幂等，跑几遍一样。

import os
import re
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

ok = True
bodies = {}


def load(path):
    with open(path, encoding='utf-8') as f:
        return f.read()


def edit(path, name, old, new, mark):
    """改一处。mark 在文件里就算已经改过。"""
    global ok
    s = bodies.setdefault(path, load(path))
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


# ── 1. tabs.js：Memory 指回 /memories ──
#
# apply-memory2 把它改成了 /memories/manage，那样两个库就被藏了。
# 她要的是：记忆六项和两个库摆在同一页，库在最后。
print('src/tabs.js')
edit('src/tabs.js', 'Memory 指回 /memories',
     "    href: '/memories/manage',",
     "    href: '/memories',",
     "href: '/memories',")

# ── 2. memories-page.js ──

FUNC = '''// 记忆本体那六项。
//
// 小满 2026-11-05：「还是要和 ombre brain 这些一样做成这种框框，点击进入编辑。
// 现在这两个库放在最后面」
//
// 所以和下面 libraries() 那两个库用同一种大框，摆在它们前面。
// 类名沿用这个文件自己的 .lib，不再另弄一套。
function memoryCards() {
  let c = { entries: 0, docs: 0, cards: 0, journal: 0 };
  let w = { books: 0, entries: 0 };
  let hasPrompt = false;
  try {
    c = memCounts();
    w = wbCounts();
    hasPrompt = Boolean(getPrompt());
  } catch (err) {
    console.error('memories: 数不清记忆', err.message);
  }
  const M = '/memories/manage';
  const rows = [
    ['指令', '他是谁、怎么说话。摆在每次请求最前面',
      hasPrompt ? '已经写了' : '还没写', `${M}/prompt`],
    ['条目记忆', '每一轮都注入，所以要短。生日、固定约定、东西放哪儿',
      `${c.entries} 条`, `${M}/entries`],
    ['长期资料', '只注入标题，正文要读的时候再翻。人物设定、说明书',
      `${c.docs} 份`, `${M}/docs`],
    ['信息卡', '按主题持续追写。聊到哪一项就把那张翻开看',
      `${c.cards} 张`, `${M}/cards`],
    ['世界书', '常驻或关键词激活。六个注入位置、优先级、预算',
      `${w.books} 本 · ${w.entries} 条`, `${M}/books`],
    ['日记', '一天一篇。最近几篇进每轮，老的靠召回',
      `${c.journal} 篇`, `${M}/journal`],
  ];
  return rows.map(([name, what, val, href]) =>
    `<a class="lib" href="${href}">
      <div class="lib-in">
        <span class="lib-name">${escapeHtml(name)}</span>
        <span class="lib-what">${escapeHtml(what)}</span>
        <span class="lib-sub">${escapeHtml(val)}</span>
      </div>
      <span class="lib-go" aria-hidden="true">\u203a</span>
    </a>`).join('');
}

'''

LIB_CSS = '''
  .lib{display:flex;align-items:center;gap:12px;margin-bottom:11px;padding:16px 17px;
    background:#fdfdfd;border:1px solid #e4e4e4;border-radius:18px;color:inherit;
    text-decoration:none;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .lib:active{background:#f4f4f4}
  .lib-in{flex:1;min-width:0}
  .lib-name{display:block;font-size:17px;font-weight:600;color:#1a1a1a}
  .lib-what{display:block;margin-top:5px;font-size:13px;line-height:1.65;color:#5e5e5e}
  .lib-sub{display:block;margin-top:6px;font-size:12px;color:#9a9a9a}
  .lib-go{flex:none;color:#b0b0b0;font-size:20px}
'''

mp = 'src/memories-page.js'
print(mp)
edit(mp, '引入计数',
     "import { renderTabs, TABS_CSS } from './tabs.js';",
     "import { renderTabs, TABS_CSS } from './tabs.js';\n"
     "import { counts as memCounts, getPrompt } from './memory-store.js';\n"
     "import { counts as wbCounts } from './world-books.js';",
     'import { counts as memCounts')
edit(mp, '加 memoryCards()',
     'function libraries() {',
     FUNC + 'function libraries() {',
     'function memoryCards()')
# 真实的调用点是 ${renderList()}（第 251 行）
edit(mp, '六项摆在库前面',
     '${renderList()}',
     '${memoryCards()}\n      ${renderList()}',
     '${memoryCards()}')
edit(mp, '大框样式',
     '${TABS_CSS}',
     '${TABS_CSS}' + LIB_CSS,
     '.lib{display:flex')

# ── 3. memory-ui.js：总览指回记忆页 ──
#
# 胶囊导航留着：在子页之间跳转用得上。只把「总览」那一栈改成回大框页。
mu = 'src/memory-ui.js'
print(mu)
edit(mu, '总览指回大框页',
     'app.get(P, requireBasicAuth, page(() => overview()));',
     "app.get(P, requireBasicAuth, (req, res) => res.redirect(302, '/memories'));",
     "res.redirect(302, '/memories')")

# ── 4. me-page.js：导入和设置摆进个人页 ──
#
# 这个文件里写的是真中文，不是 \u 转义。
ME = """    {
      name: '记忆设置',
      what: '每轮上限、跳对话记忆、带几篇日记',
      href: '/memories/manage/settings',
    },
    {
      name: '导入备份',
      what: '把 Aru 导出的记忆搬过来',
      href: '/memories/manage/import',
    },
    {
      name: '收藏',
"""

mep = 'src/me-page.js'
print(mep)
edit(mep, '加两行',
     "    {\n      name: '收藏',\n",
     ME,
     "href: '/memories/manage/import',")

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-m4')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in tabs memories-page memory-ui me-page memory-import; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
