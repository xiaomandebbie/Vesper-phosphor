// 两个页：语义索引、聊天记录导入。
//
// 小满 2026-11-05：「我还想导入允朔的之前的聊天记录，但是不要其他两个协作者的」
// 「还有向量索引记忆召回怎么做」
//
// 单独一个文件是为了别去动 memory-ui.js 那一大堆——改它要新增好几处锚点，
// 而这两页和它没什么共用逻辑。
//
// ── 聊天记录为什么必须分两步 ──
//
// 备份里 messages.jsonl **没有** collaboratorId，只有 conversationId；
// 协作者 id 在 conversations.jsonl 里。所以：
//   1. 先读 conversations + collaborators，知道哪些对话属于谁
//   2. 她选一位，再读 messages，按那些对话 id 筛
//
// 筛在浏览器里做：messages.jsonl 有 40 MB，全传上来再让服务器丢是白费流量。
// 服务器那边还会再卡一道（见 memory-chat-import.js）。

import {
  getSettings,
  setSetting,
} from './memory-store.js';
import { status as vecStatus, runBatch, clearIndex, testConnection } from './memory-vectors.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const P = '/memories/manage';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

const STYLE = `
  :root{--ink:#252525;--muted:#5e5e5e;--accent:#4d4d4d;--card:#fdfdfd;--soft:#f2f2f2;--line:#e2e2e2}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;color:var(--ink);
    font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
  main{position:relative;z-index:1;max-width:620px;margin:0 auto;padding:18px 16px 60px}
  .hero{text-align:center;margin:6px 0 16px}
  .title{margin:0;font-size:23px;font-weight:200;letter-spacing:.26em;padding-left:.26em;color:#3a3a3a}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;
    padding:15px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .sect{margin:20px 2px 9px;font-size:12px;letter-spacing:.14em;color:var(--muted)}
  label{display:block;margin:0 0 5px;font-size:12.5px;color:var(--muted)}
  input,select,textarea{width:100%;padding:9px 11px;font:inherit;font-size:16px;color:var(--ink);
    background:#fff;border:1px solid var(--line);border-radius:10px}
  .f{margin-bottom:11px}
  .two{display:flex;gap:9px}
  .two>div{flex:1;min-width:0}
  .hint{margin:7px 0 0;font-size:11.5px;line-height:1.7;color:var(--muted)}
  .hint code{padding:1px 5px;border-radius:5px;font-size:11px;background:var(--soft)}
  button{min-height:40px;padding:0 16px;border:0;border-radius:11px;background:var(--accent);
    color:#fff;font-size:14px}
  button.ghost{background:none;color:var(--accent);border:1px solid var(--line)}
  button.danger{background:none;color:#8a2a2a;border:1px solid var(--line)}
  button[disabled]{opacity:.45}
  .acts{display:flex;flex-wrap:wrap;gap:9px;margin-top:4px}
  .sw{display:flex;align-items:center;justify-content:space-between;gap:12px;
    padding:11px 0;border-top:1px solid var(--line)}
  .sw:first-child{border-top:0}
  .nm{display:block;font-size:14.5px;font-weight:600;color:var(--accent)}
  .wt{display:block;margin-top:4px;font-size:12px;line-height:1.6;color:var(--muted)}
  .st{margin:13px 0 0;font-size:13px;line-height:1.85;color:var(--accent);white-space:pre-wrap;
    font-variant-numeric:tabular-nums}
  .num{display:flex;gap:10px;margin:2px 0 0}
  .num div{flex:1;background:var(--soft);border-radius:12px;padding:11px 9px;text-align:center}
  .num b{display:block;font-size:19px;font-weight:600;color:var(--ink);font-variant-numeric:tabular-nums}
  .num span{display:block;margin-top:3px;font-size:11px;color:var(--muted)}
  .who{display:flex;align-items:center;gap:11px;padding:12px 0;border-top:1px solid var(--line)}
  .who:first-of-type{border-top:0}
  .who input{width:auto;flex:none}
  .who-in{flex:1;min-width:0}
  .back{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;
    font-size:13px;color:var(--accent);text-decoration:none}
`;

function layout(title, body, script) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}${STYLE}</style>
</head>
<body><main>${renderMenu('/memories')}
<header class="hero"><h1 class="title">${esc(title)}</h1></header>
${body}</main>
${renderTabs('/memories')}
<script>${script || ''}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

// ── 语义索引 ──

const VEC_SCRIPT = `(function () {
  var st = document.querySelector('[data-vst]');
  var build = document.querySelector('[data-build]');
  var test = document.querySelector('[data-test]');
  if (!st) return;

  function say(m) { st.textContent = m || ''; }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {})
    }).then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); });
  }

  if (test) {
    test.addEventListener('click', function () {
      test.disabled = true;
      say('在连一下看看…');
      post('${P}/vectors/test').then(function (d) {
        test.disabled = false;
        say(d.error ? '连不上：' + d.error : d.message);
      });
    });
  }

  if (build) {
    build.addEventListener('click', function () {
      build.disabled = true;
      var total = 0;
      say('开始建索引…');

      function step() {
        return post('${P}/vectors/build').then(function (d) {
          if (d.error) { build.disabled = false; return say('停了：' + d.error); }
          total += d.did || 0;
          if (d.left > 0) {
            say('已经做了 ' + total + ' 条，还剩 ' + d.left + ' 条…');
            return step();
          }
          build.disabled = false;
          say('建完了。这次做了 ' + total + ' 条'
            + (d.cleaned ? '，清掉 ' + d.cleaned + ' 条已经删了的' : '') + '。');
          setTimeout(function () { location.reload(); }, 900);
        }).catch(function (e) {
          build.disabled = false;
          say('停了：' + (e && e.message ? e.message : String(e)));
        });
      }
      step();
    });
  }
})();`;

function vectorsPage() {
  const s = getSettings();
  const v = vecStatus();
  const on = s.semantic_recall === '1';
  return layout('语义索引',
    `<div class="card">
      <div class="num">
        <div><b>${v.done}</b><span>已建</span></div>
        <div><b>${v.todo}</b><span>待建</span></div>
        <div><b>${v.stale}</b><span>该清</span></div>
      </div>
      <p class="hint">关键词那层单独就能用，现在已经在跑。语义是在它之上多一层：
        你说「阳台的小花园」时，关键词找不到以前聊「盆栽」那段，向量能。</p>
    </div>

    <div class="card">
      <form method="post" action="${P}/vectors">
        <div class="f"><label for="b">embedding 地址</label>
          <input id="b" name="embedding_base_url" value="${esc(s.embedding_base_url)}"
            placeholder="https://api.siliconflow.cn" autocomplete="off"
            autocapitalize="none" spellcheck="false" /></div>
        <div class="f"><label for="m">模型</label>
          <input id="m" name="embedding_model" value="${esc(s.embedding_model)}"
            placeholder="BAAI/bge-m3" autocomplete="off"
            autocapitalize="none" spellcheck="false" /></div>
        <div class="f"><label for="k">API Key</label>
          <input id="k" name="embedding_api_key" type="password"
            placeholder="${s.embedding_api_key ? '已经有了（空着就不改）' : '还没填'}"
            autocomplete="off" autocapitalize="none" spellcheck="false" /></div>
        <div class="sw"><div class="nm">开启语义召回
            <span class="wt">关掉之后召回只走关键词，索引还在</span></div>
          <input type="checkbox" name="semantic_recall" value="1"
            style="width:auto" ${on ? 'checked' : ''} /></div>
        <div class="acts"><button type="submit">保存</button></div>
      </form>
      <p class="hint">地址写到哪一层都认：带 <code>/embeddings</code> 的原样用，
        只写域名的自己补 <code>/v1/embeddings</code>。</p>
    </div>

    <div class="card">
      <div class="acts">
        <button type="button" data-build ${v.configured ? '' : 'disabled'}>建索引</button>
        <button type="button" class="ghost" data-test ${v.configured ? '' : 'disabled'}>测连接</button>
        <form method="post" action="${P}/vectors/clear" style="margin:0"
          onsubmit="return confirm('清空索引？记忆本身不删，只是要重新 embed 一遍。')">
          <button type="submit" class="danger">清空</button></form>
      </div>
      <p class="st" role="status" data-vst></p>
      <p class="hint">分批跑，一批 24 条。正文没改过的不重算，所以点多少次都不会重复花钱。
        断了接着点就行。</p>
    </div>

    <a class="back" href="/memories">‹ 回记忆</a>`,
    VEC_SCRIPT);
}

// ── 聊天记录导入 ──
//
// 这段在模板字符串里，所以不能出现 ${ 和反引号。

const CHAT_SCRIPT = `(function () {
  var fileEl = document.getElementById('f');
  var scanEl = document.getElementById('scan');
  var goEl = document.getElementById('go');
  var whoEl = document.getElementById('who');
  var stEl = document.getElementById('st');
  var BATCH = 400000;
  var zip = null;
  var convMap = null;

  function say(m) { stEl.textContent = m || ''; }
  function add(m) { stEl.textContent = stEl.textContent + '\\n' + m; }
  function last(m) {
    var cur = stEl.textContent.split('\\n');
    cur[cur.length - 1] = m;
    stEl.textContent = cur.join('\\n');
  }

  if (typeof DecompressionStream === 'undefined') {
    say('这个浏览器不会解压（没有 DecompressionStream）。');
    scanEl.disabled = true;
    return;
  }

  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 16777216)) >>> 0; }
  function u64(b, i) { return u32(b, i) + u32(b, i + 4) * 4294967296; }

  function slice(f, start, len) {
    return f.slice(start, start + len).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  }

  function findCD(f) {
    var span = Math.min(66560, f.size);
    return slice(f, f.size - span, span).then(function (b) {
      for (var i = b.length - 22; i >= 0; i--) {
        if (u32(b, i) !== 101010256) continue;
        var L = i - 20;
        if (L >= 0 && u32(b, L) === 117853008) {
          return slice(f, u64(b, L + 8), 56).then(function (r) {
            if (u32(r, 0) !== 101075792) throw new Error('ZIP64 目录记录的头不对');
            return { size: u64(r, 40), at: u64(r, 48) };
          });
        }
        return { size: u32(b, i + 12), at: u32(b, i + 16) };
      }
      return null;
    });
  }

  function walk(f) {
    return findCD(f).then(function (cd) {
      if (!cd) throw new Error('这不像个 zip');
      return slice(f, cd.at, cd.size);
    }).then(function (cd) {
      var want = {
        'objects/collaborators.jsonl': 'who',
        'objects/conversations.jsonl': 'conv',
        'objects/messages.jsonl': 'msg'
      };
      var found = {};
      var p = 0;
      while (p + 46 <= cd.length) {
        if (u32(cd, p) !== 33639248) break;
        var method = u16(cd, p + 10);
        var compSize = u32(cd, p + 20);
        var nameLen = u16(cd, p + 28);
        var extraLen = u16(cd, p + 30);
        var cmtLen = u16(cd, p + 32);
        var localAt = u32(cd, p + 42);
        var name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
        if (compSize === 4294967295 || localAt === 4294967295) {
          var ex = p + 46 + nameLen;
          var exEnd = ex + extraLen;
          while (ex + 4 <= exEnd) {
            if (u16(cd, ex) === 1) {
              var q = ex + 4;
              if (u32(cd, p + 24) === 4294967295) q += 8;
              if (compSize === 4294967295) { compSize = u64(cd, q); q += 8; }
              if (localAt === 4294967295) { localAt = u64(cd, q); }
              break;
            }
            ex += 4 + u16(cd, ex + 2);
          }
        }
        p += 46 + nameLen + extraLen + cmtLen;
        if (want[name]) found[want[name]] = { method: method, size: compSize, at: localAt };
      }
      return found;
    });
  }

  function read(f, hit) {
    return slice(f, hit.at, 30).then(function (lh) {
      return slice(f, hit.at + 30 + u16(lh, 26) + u16(lh, 28), hit.size);
    }).then(function (raw) {
      if (hit.method === 0) return new TextDecoder('utf-8').decode(raw);
      var ds = new DecompressionStream('deflate-raw');
      return new Response(new Blob([raw]).stream().pipeThrough(ds)).arrayBuffer()
        .then(function (ab) { return new TextDecoder('utf-8').decode(ab); });
    });
  }

  function post(body) {
    return fetch('${P}/import/chat', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status }; }); });
  }

  function bytesOf(t) {
    var n = t.length;
    for (var k = 0; k < t.length; k++) if (t.charCodeAt(k) > 127) n += 2;
    return n;
  }

  fileEl.addEventListener('change', function () {
    var f = fileEl.files && fileEl.files[0];
    scanEl.disabled = !f;
    goEl.disabled = true;
    whoEl.innerHTML = '';
    if (f) say(f.name + '\\n' + (f.size / 1048576).toFixed(0) + ' MB');
  });

  // 第一步：读协作者和对话
  scanEl.addEventListener('click', function () {
    var f = fileEl.files && fileEl.files[0];
    if (!f) return;
    scanEl.disabled = true;
    say('在读备份目录…');

    walk(f).then(function (found) {
      if (!found.conv) throw new Error('备份里没有 conversations.jsonl');
      if (!found.msg) throw new Error('备份里没有 messages.jsonl');
      zip = { f: f, found: found };
      add('在读协作者和对话…');
      return Promise.all([
        found.who ? read(f, found.who) : Promise.resolve(''),
        read(f, found.conv)
      ]);
    }).then(function (both) {
      var names = {};
      both[0].split('\\n').forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        try {
          var o = JSON.parse(t);
          if (o && o.payload && o.payload.name) names[o.id || o.payload.id] = o.payload.name;
        } catch (e) {}
      });

      // 对话：边数边攒，攒满一批就发
      convMap = {};
      var tally = {};
      var batch = [];
      var bytes = 0;
      var chain = Promise.resolve();
      var sent = 0;

      function flush() {
        if (!batch.length) return;
        var mine = batch;
        batch = [];
        bytes = 0;
        chain = chain.then(function () {
          return post({ step: 'conversations', rows: mine }).then(function (d) {
            if (d.error) throw new Error(d.error);
            sent += d.n || 0;
          });
        });
      }

      both[1].split('\\n').forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        var o = null;
        try { o = JSON.parse(t); } catch (e) { return; }
        if (!o || !o.payload) return;
        var cid = o.id || o.payload.id;
        var who = o.payload.collaboratorId || '';
        if (cid && who) {
          convMap[cid] = who;
          tally[who] = (tally[who] || 0) + 1;
        }
        var n = bytesOf(t);
        if (bytes && bytes + n > BATCH) flush();
        batch.push(o);
        bytes += n;
        if (bytes >= BATCH) flush();
      });
      flush();

      return chain.then(function () {
        last('对话：' + sent + ' 个');
        var ids = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
        if (!ids.length) throw new Error('一个对话都没认出协作者');
        whoEl.innerHTML = '<p class="sect">要导谁的？</p><div class="card">'
          + ids.map(function (id, i) {
            return '<label class="who">'
              + '<input type="radio" name="keep" value="' + id + '"' + (i === 0 ? ' checked' : '') + ' />'
              + '<span class="who-in"><span class="nm">' + (names[id] || id.slice(0, 8)) + '</span>'
              + '<span class="wt">' + tally[id] + ' 个对话</span></span></label>';
          }).join('') + '</div>';
        goEl.disabled = false;
        add('');
        add('选一位，然后点「导入这一位的话」。');
      });
    }).catch(function (e) {
      scanEl.disabled = false;
      add('');
      add('停了：' + (e && e.message ? e.message : String(e)));
    });
  });

  // 第二步：只传选中那一位的消息
  goEl.addEventListener('click', function () {
    var picked = document.querySelector('input[name=keep]:checked');
    if (!picked || !zip) return;
    var keep = picked.value;
    goEl.disabled = true;
    scanEl.disabled = true;
    add('');
    add('在解 messages.jsonl，40 MB，要等一阵…');

    // 这一位名下的对话 id。浏览器这边先筛一遍，别的人的话不走网。
    var mine = {};
    Object.keys(convMap).forEach(function (cid) {
      if (convMap[cid] === keep) mine[cid] = 1;
    });

    read(zip.f, zip.found.msg).then(function (text) {
      last('解开了。在筛并上传…');
      var batch = [];
      var bytes = 0;
      var chain = Promise.resolve();
      var done = 0;
      var skipped = 0;
      var dup = 0;

      function flush() {
        if (!batch.length) return;
        var part = batch;
        batch = [];
        bytes = 0;
        chain = chain.then(function () {
          return post({ step: 'messages', keep: keep, rows: part }).then(function (d) {
            if (d.error) throw new Error(d.error);
            done += d.n || 0;
            skipped += d.skipped || 0;
            dup += d.dup || 0;
            last('已经导进 ' + done + ' 条' + (dup ? '（跳过重复 ' + dup + '）' : '') + '…');
          });
        });
      }

      var lines = text.split('\\n');
      text = null;
      for (var i = 0; i < lines.length; i++) {
        var t = lines[i].trim();
        if (!t) continue;
        var o = null;
        try { o = JSON.parse(t); } catch (e) { continue; }
        if (!o || !o.payload) continue;
        var p = o.payload;
        if (p.role !== 'user' && p.role !== 'assistant') continue;
        if (!p.conversationId || !mine[p.conversationId]) continue;
        if (!p.content) continue;
        var n = bytesOf(t);
        if (bytes && bytes + n > BATCH) flush();
        batch.push(o);
        bytes += n;
        if (bytes >= BATCH) flush();
      }
      flush();

      return chain.then(function () {
        goEl.disabled = false;
        scanEl.disabled = false;
        add('');
        add('导完了：' + done + ' 条进了归档。');
        add('这些话平时不占上下文，跳天锚点和搜旧账时才查。');
      });
    }).catch(function (e) {
      goEl.disabled = false;
      scanEl.disabled = false;
      add('');
      add('停了：' + (e && e.message ? e.message : String(e)));
    });
  });
})();`;

function chatImportPage(archived) {
  return layout('导入聊天记录',
    `<div class="card">
      <input type="file" id="f" accept=".polarisarchive,.zip" />
      <p class="hint">选同一份 <code>.polarisarchive</code>。先读对话认协作者，
        你选一位，再只导那一位的话——别人的一句也不进来。</p>
      <p class="hint">备份里的消息表没有「这是谁的话」这个字段，只有对话编号；
        协作者在对话表里。所以必须分两步，反过来做就全丢光了。</p>
    </div>

    <div class="card">
      <div class="acts">
        <button type="button" id="scan" disabled>第一步：读对话</button>
        <button type="button" id="go" class="ghost" disabled>导入这一位的话</button>
      </div>
      <p class="st" role="status" id="st"></p>
    </div>

    <div id="who"></div>

    <div class="card">
      <p class="hint">现在归档里有 <strong>${archived}</strong> 条。
        导进来的话放在归档表，不进「最近说的话」——后者是网关每轮追写的，
        災进两万条历史他就分不清哪句是刚说的了。
        归档的话照样能被召回和翻旧账。</p>
    </div>

    <a class="back" href="/memories">‹ 回记忆</a>`,
    CHAT_SCRIPT);
}

// ── 路由 ──

export function registerMemoryUI2(app, { requireBasicAuth }) {
  const guard = (req, res) => {
    if (sameOrigin(req)) return false;
    res.status(403).send('请求来源不对');
    return true;
  };

  app.get(`${P}/vectors`, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(vectorsPage());
    } catch (err) {
      console.error('vec ui:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  app.post(`${P}/vectors`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    for (const k of ['embedding_base_url', 'embedding_model']) {
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, k)) setSetting(k, req.body[k]);
    }
    // key 空着提交 = 不改，和模型页那边一个口径
    const key = String(req.body?.embedding_api_key ?? '').trim();
    if (key) setSetting('embedding_api_key', key);
    setSetting('semantic_recall', req.body?.semantic_recall ? '1' : '0');
    res.redirect(303, `${P}/vectors`);
  });

  app.post(`${P}/vectors/build`, requireBasicAuth, async (req, res) => {
    if (guard(req, res)) return;
    try {
      res.json(await runBatch(24));
    } catch (err) {
      console.error('vec: 这批没做成', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.post(`${P}/vectors/test`, requireBasicAuth, async (req, res) => {
    if (guard(req, res)) return;
    res.json(await testConnection());
  });

  app.post(`${P}/vectors/clear`, requireBasicAuth, (req, res) => {
    if (guard(req, res)) return;
    clearIndex();
    res.redirect(303, `${P}/vectors`);
  });

  app.get(`${P}/import/chat-page`, requireBasicAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const { archiveCount } = await import('./memory-chat-import.js');
      res.send(chatImportPage(archiveCount()));
    } catch (err) {
      console.error('chat import ui:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  console.log(`memory: 语义索引 ${P}/vectors，聊天导入 ${P}/import/chat-page`);
  return { enabled: true };
}
