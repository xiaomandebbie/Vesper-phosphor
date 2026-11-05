#!/usr/bin/env python3
# 按她说的改版式：
#   1. 记忆页不再是胶囊导航 + 小行，改成 Ombre Brain 那种大框
#   2. Latent / Ombre Brain 两个库摆在最后
#   3. 导入备份和记忆设置移到个人页
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

ok = True


def patch(path, edits):
    global ok
    with open(path, encoding='utf-8') as f:
        s = f.read()
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-m3')
    for name, old, new, mark in edits:
        if mark in s:
            print('  %-18s 已改过，跳过' % name)
            continue
        n = s.count(old)
        if n != 1:
            print('  %-18s 锚点命中 %d 次（要 1）——没改' % (name, n))
            ok = False
            continue
        s = s.replace(old, new, 1)
        print('  %-18s 改了' % name)
    return s


# ── 1. tabs.js：Memory 回到 /memories ──
#
# 上一版我把它指到了 /memories/manage，那样两个库就被藏起来了。
# 她要的是：这些和两个库摆在同一页，库在最后。

tj = 'src/tabs.js'
print(tj)
s_tj = patch(tj, [
    ('Memory 回 /memories',
     "    href: '/memories/manage',",
     "    href: '/memories',",
     "href: '/memories',"),
])

# ── 2. memories-page.js：记忆六项在前，两个库在后 ──

BLOCK = '''// 记忆本体那六项（指令、条目、资料、信息卡、世界书、日记）。
// 小满 2026-11-05：「还是要和 ombre brain 这些一样做成这种框框，点击进入编辑。
// 现在这两个库放在最后面」——所以和下面的库用同一种大框，摆在它们前面。
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
  const rows = [
    ['指令', '他是谁、怎么说话。摆在每次请求最前面',
      hasPrompt ? '已经写了' : '还没写', '/memories/manage/prompt'],
    ['条目记忆', '每一轮都注入，所以要短。生日、固定约定、东西放哪儿',
      `${c.entries} 条`, '/memories/manage/entries'],
    ['长期资料', '只注入标题，正文要读的时候再翻。人物设定、说明书',
      `${c.docs} 份`, '/memories/manage/docs'],
    ['信息卡', '按主题持续追写。聊到哪一项就把那张翻开看',
      `${c.cards} 张`, '/memories/manage/cards'],
    ['世界书', '常驻或关键词激活。六个注入位置、优先级、预算',
      `${w.books} 本 · ${w.entries} 条`, '/memories/manage/books'],
    ['日记', '一天一篇。最近几篇进每轮，老的靠召回',
      `${c.journal} 篇`, '/memories/manage/journal'],
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

mp = 'src/memories-page.js'
print(mp)
s_mp = patch(mp, [
    ('引入计数',
     "import { renderTabs, TABS_CSS } from './tabs.js';",
     "import { renderTabs, TABS_CSS } from './tabs.js';\n"
     "import { counts as memCounts, getPrompt } from './memory-store.js';\n"
     "import { counts as wbCounts } from './world-books.js';",
     "import { counts as memCounts"),
    ('加六项函数',
     'export function registerMemoriesRoutes(app, { requireBasicAuth }) {',
     BLOCK + 'export function registerMemoriesRoutes(app, { requireBasicAuth }) {',
     'function memoryCards()'),
])

print('    注：六项要摆在哪里，要看这个文件怎么渲染列表——下面单独找锚点')

# libraries() 的输出拼在哪一行，文件里写法未知，所以这儿不猜：
# 找到 「${libraries」 这个调用点，在它前面插 memoryCards()。
import re
hits = [m.start() for m in re.finditer(r'\$\{libraries', s_mp)]
if '${memoryCards()}' in s_mp:
    print('  %-18s 已改过，跳过' % '六项摆在库前面')
elif len(hits) == 1:
    i = hits[0]
    s_mp = s_mp[:i] + '${memoryCards()}\n      ' + s_mp[i:]
    print('  %-18s 改了' % '六项摆在库前面')
else:
    print('  %-18s 找到 %d 处 ${libraries（要 1）——没改' % ('六项摆在库前面', len(hits)))
    ok = False

# 大框的样式。这个文件自己的类名叫什么我不知道，所以自带一套 .lib，
# 追在 TABS_CSS 后面——和气泡颜色那次同一个做法。
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

if '.lib{display:flex' in s_mp:
    print('  %-18s 已改过，跳过' % '大框样式')
elif s_mp.count('${TABS_CSS}') == 1:
    s_mp = s_mp.replace('${TABS_CSS}', '${TABS_CSS}' + LIB_CSS, 1)
    print('  %-18s 改了' % '大框样式')
else:
    print('  %-18s 找不到 ${TABS_CSS}（%d 处）——没改' % ('大框样式', s_mp.count('${TABS_CSS}')))
    ok = False

# ── 3. memory-ui.js：去掉胶囊导航，返回指回 /memories ──

mu = 'src/memory-ui.js'
print(mu)
s_mu = patch(mu, [
    ('去掉胶囊导航',
     '<div class="subs">${subs}</div>',
     '',
     'REMOVED_SUBS_NAV'),
])
# 上面那条的 mark 永远不在文件里，所以改成自己判：
if '<div class="subs">' not in s_mu:
    print('  %-18s 已经没了' % '胶囊导航')

s_mu = patch(mu, [
    ('总览指回记忆页',
     "app.get(P, requireBasicAuth, page(() => overview()));",
     "app.get(P, requireBasicAuth, (req, res) => res.redirect(302, '/memories'));",
     "res.redirect(302, '/memories')"),
]) if ok else s_mu

# ── 4. me-page.js：导入和设置摆进个人页 ──

ME_ROWS = '''    {
      name: '\\u8bb0\\u5fc6\\u8bbe\\u7f6e',
      what: '\\u6bcf\\u8f6e\\u4e0a\\u9650\\u3001\\u8df3\\u5bf9\\u8bdd\\u8bb0\\u5fc6\\u3001\\u5e26\\u51e0\\u7bc7\\u65e5\\u8bb0',
      href: '/memories/manage/settings',
    },
    {
      name: '\\u5bfc\\u5165\\u5907\\u4efd',
      what: '\\u628a Aru \\u5bfc\\u51fa\\u7684\\u8bb0\\u5fc6\\u642c\\u8fc7\\u6765',
      href: '/memories/manage/import',
    },
'''

mep = 'src/me-page.js'
print(mep)
s_mep = patch(mep, [
    ('加两行',
     "    {\n      name: '\\u6536\\u85cf',",
     ME_ROWS + "    {\n      name: '\\u6536\\u85cf',",
     "href: '/memories/manage/import',"),
])

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in [(tj, s_tj), (mp, s_mp), (mu, s_mu), (mep, s_mep)]:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in tabs memories-page memory-ui me-page memory-import; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
