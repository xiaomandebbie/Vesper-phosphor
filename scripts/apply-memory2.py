#!/usr/bin/env python3
# 接三件事：
#   1. 导览 Memory 那一栈直接落到记忆管理页（之前我只注册了路由、没放入口，是我的漏）
#   2. 导入页：选中 .polarisarchive 点一下
#   3. 上下文范围 = 最新那个窗
#
# 在 /root/vesper-phosphor 下跑。幂等，跑几遍一样。

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
    shutil.copy(path, '/root/' + os.path.basename(path) + '.before-m2')
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


# ── 1. tabs.js：Memory 落到管理页 ──
#
# aliases 里 '/memories': ['/memory'] 不动，所以 /memories 和 /memories/…
# 仍然都高亮 Memory 这一栈。

tj = 'src/tabs.js'
print(tj)
s_tj = patch(tj, [
    ('Memory 落地页',
     "    href: '/memories',",
     "    href: '/memories/manage',",
     "href: '/memories/manage',"),
])

# ── 2. memory-ui.js：加导入那一栈，总览里加一条回记忆库 ──

mu = 'src/memory-ui.js'
print(mu)
s_mu = patch(mu, [
    ('导入子栈',
     "  ['/settings', '\u8bbe\u7f6e'],\n];",
     "  ['/settings', '\u8bbe\u7f6e'],\n  ['/import', '\u5bfc\u5165\u5907\u4efd'],\n];",
     "['/import', '\u5bfc\u5165\u5907\u4efd']"),
    ('总览加库入口',
     "    <a class=\"back\" href=\"/memories\">\u2039 \u56de\u8bb0\u5fc6\u5e93</a>`);",
     "    <p class=\"hint\">\u8fd8\u6ca1\u5bfc\u5165\uff1f\u53bb\u300c\u5bfc\u5165\u5907\u4efd\u300d\u90a3\u4e00\u6808\u3002</p>\n"
     "    <a class=\"back\" href=\"/memories\">\u2039 Ombre / Latent \u8bb0\u5fc6\u5e93</a>`);",
     'Ombre / Latent \u8bb0\u5fc6\u5e93'),
])

# ── 3. memory-import.js：加导入页 ──

PAGE = """  app.get('/memories/manage/import', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u5bfc\u5165\u5907\u4efd \u00b7 \u6668\u66ae\u661f</title>
<style>
  body{margin:0;min-height:100vh;color:#252525;background:#f7f7f7;
    font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
  main{max-width:600px;margin:0 auto;padding:22px 16px 60px}
  h1{margin:6px 0 16px;font-size:22px;font-weight:200;letter-spacing:.26em;
    padding-left:.26em;text-align:center;color:#3a3a3a}
  .card{background:#fdfdfd;border:1px solid #e2e2e2;border-radius:16px;padding:16px;
    margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  input[type=file]{width:100%;padding:10px 0;font:inherit;font-size:15px}
  button{min-height:44px;padding:0 20px;border:0;border-radius:12px;background:#4d4d4d;
    color:#fff;font-size:15px;width:100%}
  button[disabled]{opacity:.5}
  .hint{margin:10px 0 0;font-size:11.5px;line-height:1.7;color:#5e5e5e}
  .st{margin:14px 0 0;font-size:13.5px;line-height:1.8;color:#4d4d4d;white-space:pre-wrap}
  a.back{display:inline-flex;min-height:44px;align-items:center;font-size:13px;color:#4d4d4d}
</style>
</head>
<body><main>
<h1>\u5bfc\u5165\u5907\u4efd</h1>
<div class="card">
  <input type="file" id="f" accept=".polarisarchive,.zip" />
  <p class="hint">\u9009 Aru \u5bfc\u51fa\u7684 <code>.polarisarchive</code>\u3002
    \u53ea\u8bfb\u91cc\u9762\u7684\u8bb0\u5fc6\uff1a\u6761\u76ee\u3001\u957f\u671f\u8d44\u6599\u3001\u4fe1\u606f\u5361\u3001\u65e5\u8bb0\u3001\u4e16\u754c\u4e66\u3001\u6307\u4ee4\u3002
    \u805a\u5929\u8bb0\u5f55\u548c\u8fd0\u884c\u75d5\u8ff9\uff08900 MB \u90a3\u51e0\u4efd\uff09\u4e0d\u8bfb\u3002</p>
  <p class="hint">\u6309\u539f id \u5199\u5e93\uff0c\u540c\u4e00\u4efd\u5bfc\u4e24\u6b21\u4e0d\u4f1a\u53d8\u6210\u53cc\u4efd\u3002
    \u4e0a\u4f20\u8fc7\u7a0b\u522b\u5207\u9875\u9762\u3002</p>
</div>
<div class="card">
  <button id="go" disabled>\u5bfc\u5165</button>
  <p class="st" id="st" role="status"></p>
</div>
<a class="back" href="/memories/manage">\u2039 \u56de\u8bb0\u5fc6</a>
</main>
<script>
(function(){
  var f=document.getElementById('f'),go=document.getElementById('go'),st=document.getElementById('st');
  function say(m){st.textContent=m||''}
  f.addEventListener('change',function(){
    go.disabled=!f.files.length;
    if(f.files.length) say(f.files[0].name+' \u00b7 '+(f.files[0].size/1048576).toFixed(1)+' MB');
  });
  go.addEventListener('click',function(){
    if(!f.files.length) return;
    go.disabled=true;
    say('\u6b63\u5728\u4e0a\u4f20\u548c\u8bfb\u53d6\u2026\u5927\u6587\u4ef6\u8981\u7b49\u4e00\u9635\uff0c\u522b\u5173\u9875\u9762\u3002');
    fetch('/memories/manage/import/upload',{method:'POST',credentials:'same-origin',
      headers:{'content-type':'application/octet-stream'},body:f.files[0]})
      .then(function(r){return r.json().catch(function(){return {error:'\u8fd4\u56de\u7684\u4e0d\u662f JSON'}})})
      .then(function(d){
        go.disabled=false;
        if(d.error) return say('\u6ca1\u5bfc\u6210\uff1a'+d.error);
        var c=d.counts||{};
        say('\u5bfc\u5b8c\u4e86\uff08'+d.megabytes+' MB\uff09\\n'
          +'\u6761\u76ee '+c.entries+' \u00b7 \u8d44\u6599 '+c.docs+' \u00b7 \u4fe1\u606f\u5361 '+c.cards+'\\n'
          +'\u65e5\u8bb0 '+c.journal+' \u00b7 \u4e16\u754c\u4e66 '+c.books+' \u672c/'+c.wbEntries+' \u6761'
          +' \u00b7 \u6307\u4ee4 '+(c.prompt?'\u6709':'\u6ca1\u6709')
          +((d.notes&&d.notes.length)?'\\n\\n'+d.notes.join('\\n'):''));
      })
      .catch(function(e){go.disabled=false;say('\u6ca1\u5bfc\u6210\uff1a'+(e&&e.message?e.message:String(e)))});
  });
})();
<\\/script>
</body>
</html>`);
  });

"""

mi = 'src/memory-import.js'
print(mi)
s_mi = patch(mi, [
    ('导入页', "  console.log('import: \u5bfc\u5165\u63a5\u53e3", PAGE + "  console.log('import: \u5bfc\u5165\u63a5\u53e3",
     "app.get('/memories/manage/import',"),
])

# ── 4. chat-bus.js：上下文范围 = 最新那个窗 ──

WIN = """    // 上下文范围就是最新那个窗（小满 2026-11-05）。
    // 开新窗 = 切一刀，之前的话不再进这一轮的输入。
    const wins = listWindows();
    if (wins.length) {
      const msgs = listWindowMessages(wins[0].id, HISTORY_TURNS * 2) || [];
      return msgs
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.from === 'human' ? 'user' : 'assistant', content: m.text }))
        .filter((m) => m.content);
    }
    rows = getRecentConversation(HISTORY_TURNS);"""

cb = 'src/chat-bus.js'
print(cb)
s_cb = patch(cb, [
    ('引入窗',
     "import { getRecentConversation } from './state.js';",
     "import { getRecentConversation } from './state.js';\n"
     "import { listWindows, listWindowMessages } from './chat-windows.js';",
     "from './chat-windows.js'"),
    ('只读最新窗',
     '    rows = getRecentConversation(HISTORY_TURNS);',
     WIN,
     'const wins = listWindows();'),
])

# ── 5. vesper.js：接导入路由 ──

IMP = "import { registerImportRoutes } from './memory-import.js';"
CALL = 'registerImportRoutes(app, { requireBasicAuth });'
A_IMP = "import { registerMemoryUI } from './memory-ui.js';"
A_CALL = 'registerMemoryUI(app, { requireBasicAuth });'

vp = 'src/vesper.js'
print(vp)
with open(vp, encoding='utf-8') as f:
    lines = f.read().split('\n')
shutil.copy(vp, '/root/vesper.js.before-m2')

has_imp = any(l.strip() == A_IMP for l in lines)
has_call = any(l.strip() == A_CALL for l in lines)
print('  锚点 import 在不在 ->', has_imp)
print('  锚点 调用   在不在 ->', has_call)
if not (has_imp and has_call):
    print('\n上一个脚本（apply-memory.py）还没跑。先跑那个。')
    sys.exit(1)

out = []
wi = wc = False
for l in lines:
    k = l.strip()
    if k in (IMP, CALL):
        continue
    out.append(l)
    if not wi and k == A_IMP:
        out.append(IMP)
        wi = True
    if not wc and k == A_CALL:
        out.append('// 一键导入 Aru 备份（见 memory-import.js）')
        out.append(CALL)
        wc = True
s_vp = '\n'.join(out)
print('  写入后 import %d 处 · 调用 %d 处' % (s_vp.count(IMP), s_vp.count(CALL)))

if not ok:
    print('\n有锚点没对上，没写盘。')
    sys.exit(1)

for path, body in [(tj, s_tj), (mu, s_mu), (mi, s_mi), (cb, s_cb), (vp, s_vp)]:
    with open(path, 'w', encoding='utf-8') as f:
        f.write(body)

print('\n写好了。接下来：')
print('  for f in tabs memory-ui memory-import chat-bus vesper; do node --check src/$f.js || echo FAIL $f; done')
print('  pm2 restart vesper --update-env')
