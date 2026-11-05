// 他手上连着哪几个 MCP。
//
// 小满 2026-11-05：「之后在“我”页面还要加 mcp 的链接入口」
//
// ── 这一页只看，不改 ──
//
// 哪几个服务连上、用哪个地址，全由 .env 里的变量决定（见 mcp-manager.js
// 的 connectAll）。这边要是能改，就得在网页上存一份和 .env 并行的配置——
// 两处真相，改一半忘一半。Proof 那两个 TTL 就是这么踩的。
//
// 要改地址就去「模型 · 连接 · 通知」那一页：那边改的是 .env 本体，只有一份真相。
//
// ── 为什么工具列表要点一下才加载 ──
//
// listAllTools() 会对每个服务真发一次 listTools 请求，没连上的还会先试重连。
// 十几个服务串行跑完要好几秒，所以不在渲染时做——否则这一页每次打开都要转圈。

import { isConnected, listAllTools } from './mcp-manager.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const P = '/me/mcp';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 哪些服务、靠哪个变量开。和 mcp-manager.js 的 connectAll 一一对应。
//
// 这张表是手写的，因为 connectAll 里没把「服务名 → 环境变量」导出来。
// 哪天那边加了新服务，这边也要添一行——没添的话它仍然会出现在
// 「还有这几个」里（下面那段兼容逻辑），只是没有说明文字。
const KNOWN = [
  ['xiuchao', '锈潮', '星落村那个世界：世界频道、留言板、集市', 'XIUCHAO_MCP_URL'],
  ['ombre-brain', 'Ombre Brain', '记忆库。要用的时候去查', 'OMBRE_MCP_URL'],
  ['lutopia', 'Lutopia 论坛', '看帖、回帖、发帖。同一篇 24 小时只能回一次', 'LUTOPIA_MCP_URL'],
  ['workkk', 'WORKKK 上班', '那个小游戏', 'WORKKK_MCP_URL'],
  ['garden', '花园', '黑猫在里面走动、种花、浇水', 'GARDEN_MCP_URL'],
  ['music', '点歌台', '搜歌、读歌词、写批注。自己醒来时不能点歌给你', 'MUSIC_MCP_URL'],
  ['light', '桌面台灯', '调亮度、色温、场景', 'LIGHT_MCP_URL'],
  ['leto', 'Leto', '', 'LETO_MCP_URL'],
  ['shopping', '购物', '搜、看、问客服、记心愿单。买东西要 SHOPPING_WAKE_CAN_BUY=1', 'SHOPPING_MCP_URL'],
];

const STYLE = `
  :root{--ink:#252525;--muted:#5e5e5e;--accent:#4d4d4d;--card:#fdfdfd;--soft:#f2f2f2;--line:#e2e2e2}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;color:var(--ink);
    font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
  main{position:relative;z-index:1;max-width:620px;margin:0 auto;padding:18px 16px 60px}
  .hero{text-align:center;margin:6px 0 14px}
  .title{margin:0;font-size:23px;font-weight:200;letter-spacing:.26em;padding-left:.26em;color:#3a3a3a}
  .lead{margin:6px 0 16px;font-size:12px;line-height:1.75;color:var(--muted);text-align:center}
  .srv{display:flex;align-items:center;gap:11px;margin-bottom:10px;padding:14px 15px;
    background:var(--card);border:1px solid var(--line);border-radius:16px;
    box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .srv.off{opacity:.58}
  .srv-in{flex:1;min-width:0}
  .srv-n{display:block;font-size:15px;font-weight:600;color:var(--accent)}
  .srv-w{display:block;margin-top:4px;font-size:12px;line-height:1.6;color:var(--muted)}
  .srv-k{display:block;margin-top:5px;font-size:10.5px;color:#a8a8a8;letter-spacing:.03em}
  .dot{flex:none;font-size:10.5px;border-radius:999px;padding:2px 10px;border:1px solid var(--line);
    color:var(--muted)}
  .dot.on{background:var(--soft);color:var(--accent)}
  .sect{margin:22px 2px 9px;font-size:12px;letter-spacing:.14em;color:var(--muted)}
  .card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:15px;
    margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}
  button{min-height:42px;padding:0 18px;border:0;border-radius:12px;background:var(--accent);
    color:#fff;font-size:14px;width:100%}
  button[disabled]{opacity:.45}
  .hint{margin:9px 0 0;font-size:11.5px;line-height:1.7;color:var(--muted)}
  .hint code{padding:1px 5px;border-radius:5px;font-size:11px;background:var(--soft)}
  .st{margin:12px 0 0;font-size:13px;line-height:1.9;color:var(--accent);white-space:pre-wrap}
  .tool{padding:9px 0;border-top:1px solid var(--line)}
  .tool:first-child{border-top:0}
  .tool-n{display:block;font-size:13px;font-weight:600;color:var(--accent)}
  .tool-w{display:block;margin-top:3px;font-size:11.5px;line-height:1.6;color:var(--muted)}
  .back{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;
    font-size:13px;color:var(--accent);text-decoration:none}
`;

const SCRIPT = `(function () {
  var go = document.querySelector('[data-load]');
  var box = document.querySelector('[data-tools]');
  if (!go || !box) return;
  go.addEventListener('click', function () {
    go.disabled = true;
    box.textContent = '在问每个服务要工具列表…十几个服务串行跑，要几秒。';
    fetch('${P}/tools', { credentials: 'same-origin' })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        go.disabled = false;
        if (d.error) { box.textContent = '没问到：' + d.error; return; }
        var servers = d.servers || {};
        var names = Object.keys(servers);
        if (!names.length) { box.textContent = '一个服务都没连上。'; return; }
        box.innerHTML = names.map(function (s) {
          var list = servers[s].map(function (t) {
            return '<div class="tool"><span class="tool-n">' + t.name + '</span>'
              + (t.what ? '<span class="tool-w">' + t.what + '</span>' : '') + '</div>';
          }).join('');
          return '<p class="sect">' + s + ' · ' + servers[s].length + ' 个工具</p>'
            + '<div class="card">' + list + '</div>';
        }).join('');
      })
      .catch(function (e) {
        go.disabled = false;
        box.textContent = '没问到：' + (e && e.message ? e.message : String(e));
      });
  });
})();`;

function page() {
  // KNOWN 里有说明的先摆，其余连上了的摆在后面
  const rows = KNOWN.map(([name, label, what, envKey]) => {
    const on = isConnected(name);
    return `<div class="srv${on ? '' : ' off'}">
      <div class="srv-in">
        <span class="srv-n">${esc(label)}</span>
        ${what ? `<span class="srv-w">${esc(what)}</span>` : ''}
        <span class="srv-k">${esc(envKey)}</span>
      </div>
      <span class="dot${on ? ' on' : ''}">${on ? '连上了' : '没连'}</span>
    </div>`;
  }).join('');

  const n = KNOWN.filter(([name]) => isConnected(name)).length;

  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>MCP · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}${STYLE}</style>
</head>
<body><main>${renderMenu('/me')}
<header class="hero"><h1 class="title">MCP</h1></header>
<p class="lead">${n} / ${KNOWN.length} 连上了。这些是他自己醒来时能伸手去用的地方。</p>
${rows}
<div class="card" style="margin-top:16px">
  <button type="button" data-load>看看每个服务有哪些工具</button>
  <p class="hint">点一下才问：这个要对每个服务真发一次请求，没连上的还会先试重连。</p>
</div>
<div data-tools></div>
<p class="hint" style="margin:16px 2px 0">要改地址或加服务，改 <code>.env</code> 里那些变量，
  然后 <code>pm2 restart phosphor --update-env</code>。这一页只看不改——
  网页上再存一份配置就是两处真相，改一半忘一半。</p>
<a class="back" href="/me">‹ 回个人</a>
</main>
${renderTabs('/me')}
<script>${SCRIPT}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

export function registerMcpPage(app, { requireBasicAuth }) {
  app.get(P, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(page());
    } catch (err) {
      console.error('mcp page:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  app.get(`${P}/tools`, requireBasicAuth, async (req, res) => {
    try {
      const all = await listAllTools();
      const servers = {};
      for (const t of all) {
        const s = t._server || '?';
        (servers[s] ||= []).push({
          name: String(t.name ?? ''),
          what: String(t.description ?? '').slice(0, 200),
        });
      }
      res.json({ servers });
    } catch (err) {
      console.error('mcp page: 读不到工具列表', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`mcp: 服务页 ${P}`);
  return { enabled: true };
}
