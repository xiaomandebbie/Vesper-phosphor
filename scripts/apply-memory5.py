#!/usr/bin/env python3
# 接四件事：
#   1. vesper.js 挂 memory-ui2（语义索引页）和 memory-chat-import（聊天导入）
#   2. tabs.js 的 Memory 指回 /memories
#   3. memories-page.js 加记忆六项大框（摆在两个库前面）
#   4. me-page.js 加记忆设置 / 导入备份 / 导入聊天记录
#
# 在 /root/vesper-phosphor 下跑。幂等，跑几遍一样。
# 锚点都是读过真实原文的：memories-page.js 用 ${renderList()}，
# me-page.js 里是真中文 name: '收藏'。

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
        print('  %-22s 已改过，跳过' % name)
        return
    n = s.count(old)
    if n != 1:
        print('  %-22s 锚点命中 %d 次（要 1）——没改' % (name, n))
        ok = False
        return
    bodies[path] = s.replace(old, new, 1)
    print('  %-22s 改了' % name)


# ── 1. tabs.js ──
print('src/tabs.js')
tj = load('src/tabs.js')
if "href: '/memories'," in tj:
    print('  %-22s 已经是 /memories' % 'Memory 落地页')
else:
    edit('src/tabs.js', 'Memory 落地页',
         "    href: '/memories/manage',", "    href: '/memories',",
         'NEVER_MATCHES_PLACEHOLDER')

# ── 2. memories-page.js：记忆六项 ──

FUNC = '''// 记忆本体那六项。
//
// 小满 2026-11-05：「还是要和 ombre brain 这些一样做成这种框框，点击进入编辑。
// 现在这两个库放在最后面」
//
// 所以和下面 libraries() 那两个库用同一种大框，摆在它们前面。
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
     'function libraries() {', FUNC + 'function libraries() {',
     'function memoryCards()')
edit(mp, '六项摆在库前',
     '${renderList()}', '${memoryCards()}\n      ${renderList()}',
     '${memoryCards()}')
edit(mp, '大框样式',
     '${TABS_CSS}', '${TABS_CSS}' + LIB_CSS, '.lib{display:flex')

# ── 3. me-page.js：三行 ──

ME = """    {
      name: '记忆设置',
      what: '每轮上限、跳对话记忆、语义索引',
      href: '/memories/manage/settings',
    },
    {
      name: '导入记忆',
      what: '把 Aru 导出的条目、资料、信息卡、日记、世界书搬过来',
      href: '/memories/manage/import',
    },
    {
      name: '导入聊天记录',
      what: '只导一位协作者的，其他人的不进来',
      href: '/memories/manage/import/chat-page',
    },
    {
      name: '收藏',
"""

mep = 'src/me-page.js'
print(mep)
edit(mep, '加三行',
     "    {\n      name: '收藏',\n", ME,
     "href: '/memories/manage/import/chat-page',")

# ── 4. vesper.js：挂两个模块 ──

PAIRS = [
    ("import { registerMemoryUI2 } from './memory-ui2.js';",
     'registerMemoryUI2(app, { requireBasicAuth });',
     '// 语义索引和聊天导入页（见 memory-ui2.js）'),
    ("import { registerChatImportRoutes } from './memory-chat-import.js';",
     'registerChatImportRoutes(app, { requireBasicAuth });',
     '// 只导入一位协作者的聊天记录（见 memory-chat-import.js）'),
]
A_IMP = "import { registerImportRoutes } from './memory-import.js';"
A_CALL = 'registerImportRoutes(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
lines = load(vp).split('\n')
has_imp = any(l.strip() == A_IMP for l in lines)
has_call = any(l.strip() == A_CALL for l in lines)
print('  锚点 import 在不在 ->', has_imp)
print('  锚点 调用   在不在 ->', has_call)
if not (has_imp and has_call):
    print('\n前面那几个脚本还没跑完（没找到 registerImportRoutes）。')
    sys.exit(1)

out = []
wrote = {imp: False for imp, _, _ in PAIRS}
wrote_call = {call: False for _, call, _ in PAIRS}
for l in lines:
    k = l.strip()
    if any(k == imp or k == call for imp, call, _ in PAIRS):
        continue  # 先丢掉已有的，下面统一加回
    out.append(l)
    if k == A_IMP:
        for imp, _, _ in PAIRS:
            if not wrote[imp]:
                out.append(imp)
                wrote[imp] = True
    if k == A_CALL:
        for _, call, note in PAIRS:
            if not wrote_call[call]:
                out.append(note)
                out.append(call)
                wrote_call[call] = True

bodies[vp] = '\n'.join(out)
for imp, call, _ in PAIRS:
    print('  %s -> import %d · 调用 %d'
          % (call.split('(')[0], bodies[vp].count(imp), bodies[vp].count(call)))

if not ok:
    print('\n有锚点没对上，没写盘。把上面那几行发给小克。')
    sys.exit(1)

for path, body in bodies.items():
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-m5')
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in tabs memories-page me-page memory-ui memory-ui2 \\')
print('           memory-vectors memory-chat-import vesper; do \\')
print('    node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
