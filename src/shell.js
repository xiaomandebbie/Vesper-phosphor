// 外壳页 /app：动态、日记、心绪这些页面放进内容区（iframe #page），音乐播放器常驻在另一块（#player）。
// 换页只换内容区，播放器那块不重新加载，歌就不会断。
//
// - 地址栏停在 /app，当前在哪一页记在 # 后面（/app#/diary?d=2026-10-01），刷新能回到原来那页。
// - 直接打开 /moments、/drives、/diary 会被带回外壳（靠浏览器发的 Sec-Fetch-Dest: document 判断，
//   iframe 里加载的是 iframe，不会被带回去；老浏览器不发这个头，就照旧直接打开）。
// - 内容区里点到 /music 的链接不跳页，改成拉起播放器；点到站外的链接开新标签，免得把外壳整页换掉、歌停了。
// - 悬浮窗（#mini）：封面、歌名、播放暂停、下一首、红心；点封面或歌名展开播放器并打开歌词。
//   按住拖到别处，松手记住位置（存在这台设备上）。还没放歌时缩成一个 ♪ 小圆点，点开是播放器。
//   它和播放器之间用 postMessage 说话，指令见 music-proxy.js 里的 BRIDGE_SCRIPT。
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
  #player-frame { flex: 1; width: 100%; border: 0; display: block; }

  /* 悬浮窗 */
  #mini { position: fixed; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 24px); z-index: 40;
    display: flex; align-items: center; gap: 2px; box-sizing: border-box; width: min(320px, calc(100vw - 24px)); height: 60px;
    padding: 6px 6px 6px 6px; border-radius: 18px; overflow: hidden; background: rgba(255, 253, 251, .95);
    border: 1px solid #eadfe6; box-shadow: 0 6px 20px rgba(60, 30, 60, .16);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; color: #2b2233;
    touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #mini.dragging { box-shadow: 0 10px 28px rgba(60, 30, 60, .28); }
  body.player-open #mini { display: none; }
  #mini button { border: 0; background: none; padding: 0; margin: 0; color: inherit; font: inherit; cursor: pointer; }
  #mini button:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; border-radius: 10px; }
  #mini-open { flex: 1; min-width: 0; height: 48px; display: flex; align-items: center; gap: 10px; text-align: left; }
  #mini-cover { flex: none; width: 46px; height: 46px; border-radius: 12px; object-fit: cover; background: #f6eef3; }
  #mini-note { display: none; font-size: 20px; color: #7a3e5d; }
  #mini-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  #mini-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #mini-artist { font-size: 12px; color: #665a70; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini-btn { flex: none; width: 44px; height: 44px; display: flex; align-items: center; justify-content: center;
    border-radius: 12px; color: #7a3e5d !important; }
  .mini-btn:active { background: rgba(122, 62, 93, .08) !important; }
  .mini-btn svg { width: 22px; height: 22px; fill: currentColor; }
  #mini-like svg { fill: none; stroke: currentColor; stroke-width: 1.8; }
  #mini-like.liked svg { fill: #c2708a; stroke: #c2708a; }
  #mini-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: #9b4a7a; pointer-events: none; }
  /* 还没放歌：缩成一个小圆点 */
  #mini.empty { width: 52px; height: 52px; padding: 0; border-radius: 50%; justify-content: center; }
  #mini.empty #mini-open { flex: none; width: 52px; height: 52px; justify-content: center; gap: 0; }
  #mini.empty #mini-cover, #mini.empty #mini-text, #mini.empty .mini-btn, #mini.empty #mini-bar { display: none; }
  #mini.empty #mini-note { display: block; }
  @media (prefers-reduced-motion: reduce) { #player, #player.open { transition: none; } }
</style>
</head><body>
<iframe id="page" title="晨暮星"></iframe>
<div id="mini" class="empty" role="region" aria-label="音乐" title="按住可以拖到别处">
  <button id="mini-open" type="button" aria-label="打开音乐">
    <img id="mini-cover" alt="" />
    <span id="mini-note" aria-hidden="true">♪</span>
    <span id="mini-text"><span id="mini-name"></span><span id="mini-artist"></span></span>
  </button>
  <button id="mini-toggle" class="mini-btn" type="button" aria-label="播放"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="mini-toggle-icon" d="M8 5v14l11-7z"/></svg></button>
  <button id="mini-next" class="mini-btn" type="button" aria-label="下一首"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/></svg></button>
  <button id="mini-like" class="mini-btn" type="button" aria-label="收藏" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6A5.2 5.2 0 0 1 12 6.3a5.2 5.2 0 0 1 9.2 5.1C19 15.6 12 20 12 20z"/></svg></button>
  <i id="mini-bar" aria-hidden="true"></i>
</div>
<div id="player" aria-hidden="true">
  <div id="player-bar"><button id="player-close" type="button">收起 ↓</button></div>
  <iframe id="player-frame" title="音乐" src="/music/" allow="autoplay; picture-in-picture"></iframe>
</div>
<script>
(function () {
  var START = '${START}';
  var page = document.getElementById('page');
  var player = document.getElementById('player');
  var frame = document.getElementById('player-frame');
  var $ = function (id) { return document.getElementById(id); };

  function openPlayer() { player.classList.add('open'); player.setAttribute('aria-hidden', 'false'); document.body.classList.add('player-open'); }
  function closePlayer() { player.classList.remove('open'); player.setAttribute('aria-hidden', 'true'); document.body.classList.remove('player-open'); }
  window.vpPlayer = { open: openPlayer, close: closePlayer };
  $('player-close').addEventListener('click', closePlayer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePlayer(); });

  // ---------- 悬浮窗 ----------
  var mini = $('mini');
  var st = { song: null, playing: false, liked: false, at: 0, duration: 0 };
  function send(type) { try { frame.contentWindow.postMessage({ type: type }, location.origin); } catch (e) {} }
  frame.addEventListener('load', function () { setTimeout(function () { send('music:state-ask'); }, 300); });

  var PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
  function render() {
    var s = st.song;
    mini.classList.toggle('empty', !s);
    $('mini-open').setAttribute('aria-label', s ? '打开歌词：' + s.name : '打开音乐');
    if (s) {
      $('mini-name').textContent = s.name || '';
      $('mini-artist').textContent = s.artist || '';
      var cover = $('mini-cover');
      if (s.cover && cover.getAttribute('src') !== s.cover) cover.setAttribute('src', s.cover);
      if (!s.cover) cover.removeAttribute('src');
    }
    $('mini-toggle-icon').setAttribute('d', st.playing ? PAUSE : PLAY);
    $('mini-toggle').setAttribute('aria-label', st.playing ? '暂停' : '播放');
    $('mini-like').classList.toggle('liked', !!st.liked);
    $('mini-like').setAttribute('aria-pressed', st.liked ? 'true' : 'false');
    $('mini-like').setAttribute('aria-label', st.liked ? '取消收藏' : '收藏');
    $('mini-bar').style.width = st.duration ? Math.min(100, st.at / st.duration * 100) + '%' : '0';
    if (pos) place(pos.x, pos.y);
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var d = ev.data || {};
    if (d.type === 'vp:open-music') return openPlayer();
    if (d.type === 'vp:close-music') return closePlayer();
    if (ev.source !== frame.contentWindow) return;
    if (d.type === 'music:state') {
      st.song = d.song; st.playing = !!d.playing; st.liked = !!d.liked; st.at = d.at || 0; st.duration = d.duration || 0;
    } else if (d.type === 'music:tick') {
      st.at = d.at || 0; st.duration = d.duration || 0; st.playing = !!d.playing;
    } else if (d.type === 'music:song') {
      if (d.song) { st.song = d.song; st.playing = !!d.song.playing; }
      setTimeout(function () { send('music:state-ask'); }, 300);
    } else return;
    render();
  });

  $('mini-open').addEventListener('click', function () { openPlayer(); if (st.song) send('music:lyrics'); });
  $('mini-toggle').addEventListener('click', function () { send('music:toggle'); });
  $('mini-next').addEventListener('click', function () { send('music:next'); });
  $('mini-like').addEventListener('click', function () { send('music:like'); });

  // 拖动：挪不到 6 像素算点按；拖完松手那一下的点击吞掉，不触发按钮
  var POS_KEY = 'vp-mini-pos', pos = null, drag = null, dragged = false;
  function place(x, y) {
    var w = mini.offsetWidth || 52, h = mini.offsetHeight || 52;
    x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4));
    y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
    pos = { x: x, y: y };
    mini.style.left = x + 'px'; mini.style.top = y + 'px'; mini.style.right = 'auto'; mini.style.bottom = 'auto';
  }
  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && isFinite(saved.x) && isFinite(saved.y)) place(Number(saved.x), Number(saved.y));
  } catch (e) {}
  window.addEventListener('resize', function () { if (pos) place(pos.x, pos.y); });
  mini.addEventListener('pointerdown', function (e) {
    if (e.button !== 0) return;
    var r = mini.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    dragged = false;
  });
  mini.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!dragged) { dragged = true; mini.classList.add('dragging'); try { mini.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
    place(drag.ox + dx, drag.oy + dy);
  });
  function stop(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    mini.classList.remove('dragging');
    if (dragged && pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) {} }
  }
  mini.addEventListener('pointerup', stop);
  mini.addEventListener('pointercancel', stop);
  mini.addEventListener('click', function (e) {
    if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
  }, true);
  render();

  // ---------- 内容区 ----------
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
