// 外壳页 /app：动态、日记、心绪这些页面放进内容区（iframe #page），音乐播放器常驻在另一块（#player）。
// 换页只换内容区，播放器那块不重新加载，歌就不会断。
//
// - 地址栏停在 /app，当前在哪一页记在 # 后面（/app#/diary?d=2026-10-01），刷新能回到原来那页。
// - 直接打开 /moments、/drives、/diary 会被带回外壳（靠浏览器发的 Sec-Fetch-Dest: document 判断，
//   iframe 里加载的是 iframe，不会被带回去；老浏览器不发这个头，就照旧直接打开）。
// - 内容区里点到 /music 的链接不跳页，改成拉起播放器；点到站外的链接开新标签，免得把外壳整页换掉、歌停了。
// - 只在配了 MUSIC_PLAYER_URL（见 music-proxy.js）时启用，没配时一切照旧。

const START = '/moments';
const WRAPPED = /^\/(moments|drives|diary)(\/|$|\?)/;

const SHELL_HTML = `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>晨暮星</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  #page { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
  #player { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; background: #f9f0ee;
    transform: translateY(100%); visibility: hidden; transition: transform .35s ease, visibility 0s linear .35s; }
  #player.open { transform: none; visibility: visible; transition: transform .35s ease; }
  #player-bar { flex: none; display: flex; justify-content: center; padding: calc(env(safe-area-inset-top, 0px) + 4px) 0 2px; }
  #player-close { min-width: 88px; min-height: 36px; border: 0; border-radius: 999px; background: rgba(122, 62, 93, .08);
    color: #7a3e5d; font: 14px -apple-system, "PingFang SC", sans-serif; cursor: pointer; }
  #player-close:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; }
  #player-frame { flex: 1; width: 100%; border: 0; display: block; }
  /* 临时入口：下一步换成可以拖的悬浮窗 */
  #music-fab { position: fixed; right: 16px; bottom: calc(env(safe-area-inset-bottom, 0px) + 20px); z-index: 40;
    width: 48px; height: 48px; border: 0; border-radius: 50%; background: #fffdfb; color: #7a3e5d; font-size: 20px;
    box-shadow: 0 4px 14px rgba(60, 30, 60, .18); cursor: pointer; }
  @media (prefers-reduced-motion: reduce) { #player, #player.open { transition: none; } }
</style>
</head><body>
<iframe id="page" title="晨暮星"></iframe>
<button id="music-fab" type="button" aria-label="打开音乐">♪</button>
<div id="player" aria-hidden="true">
  <div id="player-bar"><button id="player-close" type="button">收起 ↓</button></div>
  <iframe id="player-frame" title="音乐" src="/music/" allow="autoplay; picture-in-picture"></iframe>
</div>
<script>
(function () {
  var START = '${START}';
  var page = document.getElementById('page');
  var player = document.getElementById('player');

  function openPlayer() { player.classList.add('open'); player.setAttribute('aria-hidden', 'false'); }
  function closePlayer() { player.classList.remove('open'); player.setAttribute('aria-hidden', 'true'); }
  window.vpPlayer = { open: openPlayer, close: closePlayer };
  document.getElementById('player-close').addEventListener('click', closePlayer);
  document.getElementById('music-fab').addEventListener('click', openPlayer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePlayer(); });

  // # 后面只认站内页面，/app 和 /music 不能套进内容区
  function target() {
    var h = '';
    try { h = decodeURIComponent(location.hash.slice(1)); } catch (e) {}
    return /^\\/(?!\\/)/.test(h) && !/^\\/(app|music)(\\/|$|\\?|#)/.test(h) ? h : START;
  }
  function current() {
    try { var l = page.contentWindow.location; return l.pathname + l.search + l.hash; } catch (e) { return ''; }
  }
  page.src = target();

  page.addEventListener('load', function () {
    var doc;
    try { doc = page.contentDocument; } catch (e) { return; }
    if (!doc) return;
    var path = page.contentWindow.location.pathname;
    if (/^\\/(app|music)(\\/|$)/.test(path)) { page.src = START; if (/^\\/music/.test(path)) openPlayer(); return; }
    history.replaceState(null, '', '#' + current());
    if (doc.title) document.title = doc.title;

    doc.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.hasAttribute('download')) return;
      var u;
      try { u = new URL(a.href, doc.baseURI); } catch (err) { return; }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
      if (u.origin === location.origin && /^\\/music(\\/|$)/.test(u.pathname)) {
        e.preventDefault(); e.stopPropagation();
        var menu = doc.querySelector('[data-menu][open]');
        if (menu) menu.removeAttribute('open');
        openPlayer();
      } else if (u.origin !== location.origin) {
        e.preventDefault(); e.stopPropagation();
        window.open(u.href, '_blank', 'noopener');
      }
    }, true);
  });

  window.addEventListener('hashchange', function () {
    var t = target();
    if (t !== current()) page.src = t;
  });

  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var t = (ev.data || {}).type;
    if (t === 'vp:open-music') openPlayer();
    else if (t === 'vp:close-music') closePlayer();
  });
})();
</script>
</body></html>`;

export function registerShellRoutes(app, { requireBasicAuth }) {
  // 直接打开动态、日记、心绪页时带回外壳。只管整页打开（document），iframe 里加载的不动
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document') return next();
    if (!WRAPPED.test(req.originalUrl)) return next();
    return res.redirect(302, `/app#${req.originalUrl}`);
  });

  app.get('/app', requireBasicAuth, (req, res) => {
    res.set('cache-control', 'no-store');
    res.send(SHELL_HTML);
  });
}
