// 外壳页 /app：动态、日记、心绪这些页面放进内容区（iframe #page），音乐播放器常驻在另一块（#player）。
// 换页只换内容区，播放器那块不重新加载，歌就不会断。
//
// - 地址栈停在 /app，当前在哪一页记在 # 后面（/app#/diary?d=2026-10-01），刷新能回到原来那页。
// - 直接打开 /moments、/drives、/diary 会被带回外壳（靠浏览器发的 Sec-Fetch-Dest: document 判断，
//   iframe 里加载的是 iframe，不会被带回去；老浏览器不发这个头，就照旧直接打开）。
// - 内容区里点到 /music 的链接不跳页，改成拉起播放器；点到站外的链接开新标签，免得把外壳整页换掉、歌停了。
// - 播放器全屏，没有额外的收起条：播放器顶栈左上角的按钮就是收起（见 music-proxy.js）。
// - 悬浮窗（#mini）：封面、歌名、播放暂停、下一首、红心、关闭；点封面或歌名展开播放器并打开歌词。
//   按住拖到别处，松手记住位置（存在这台设备上）。往左右边缘一甩或拖出去一半，就藏到边上只留一条小把手，点把手拉回来。
//   点 × 关掉悬浮窗并暂停；从菜单打开音乐、或者又开始放歌时，它会回来。
//   还没放歌时缩成一个 ♪ 小圆点，点开是播放器。
//   它和播放器之间用 postMessage 说话，指令见 music-proxy.js 里的 BRIDGE_SCRIPT。
// - 只在配了 MUSIC_PLAYER_URL（见 music-proxy.js）时启用，没配时一切照旧。
//
// ── 加载页和转场（2026-10-31）──
//
// 小满给了四个动效：一个加载页、三个转场。见 motion.js。
// 这两样必须挂在外壳上，不能挂在 page-chrome：
//   外壳是独立 HTML，内容页在 iframe 里——遮罩挂在 iframe 里只能盖住内容区，
//   盖不住播放器和悬浮窗，而且冷启动打开的是 /app，内容页那层压根没机会跑。
// 内容页里点链接时发 postMessage 过来，由这儿放转场（见 motion.js 的 MOTION_SCRIPT）。

import { MOTION_CSS, MOTION_SCRIPT, renderMotionTag } from './motion.js';

const START = '/moments';
const WRAPPED = /^\/(moments|drives|diary)(\/|$|\?)/;

function shellHtml() {
  return `<!DOCTYPE html>
<html lang="zh"><head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u6668\u66ae\u661f</title>
<style>
  html, body { margin: 0; height: 100%; overflow: hidden;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  #page { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; display: block; }
  #player { position: fixed; inset: 0; z-index: 50; box-sizing: border-box; padding-top: env(safe-area-inset-top, 0px);
    background: #f9f0ee; transform: translateY(100%); visibility: hidden;
    transition: transform .35s ease, visibility 0s linear .35s; }
  #player.open { transform: none; visibility: visible; transition: transform .35s ease; }
  #player-frame { width: 100%; height: 100%; border: 0; display: block; }

  /* \u60ac\u6d6e\u7a97 */
  #mini { position: fixed; right: 12px; bottom: calc(env(safe-area-inset-bottom, 0px) + 24px); z-index: 40;
    display: flex; align-items: center; gap: 0; box-sizing: border-box; width: min(340px, calc(100vw - 24px)); height: 60px;
    padding: 6px 2px 6px 6px; border-radius: 18px; overflow: hidden; background: rgba(255, 253, 251, .95);
    border: 1px solid #eadfe6; box-shadow: 0 6px 20px rgba(60, 30, 60, .16);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; color: #2b2233;
    touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  #mini.anim { transition: left .25s ease, right .25s ease, width .25s ease, border-radius .25s ease; }
  #mini.dragging { box-shadow: 0 10px 28px rgba(60, 30, 60, .28); }
  body.player-open #mini, #mini.closed { display: none; }
  #mini button { border: 0; background: none; padding: 0; margin: 0; color: inherit; font: inherit; cursor: pointer; }
  #mini button:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; border-radius: 10px; }
  #mini-open { flex: 1; min-width: 0; height: 48px; display: flex; align-items: center; gap: 10px; text-align: left; }
  #mini-cover { flex: none; width: 46px; height: 46px; border-radius: 12px; object-fit: cover; background: #f6eef3; }
  #mini-note { display: none; font-size: 20px; color: #7a3e5d; }
  #mini-text { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  #mini-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #mini-artist { font-size: 12px; color: #665a70; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .mini-btn { flex: none; width: 42px; height: 44px; display: flex; align-items: center; justify-content: center;
    border-radius: 12px; color: #7a3e5d !important; }
  .mini-btn:active { background: rgba(122, 62, 93, .08) !important; }
  .mini-btn svg { width: 22px; height: 22px; fill: currentColor; }
  #mini-like svg { fill: none; stroke: currentColor; stroke-width: 1.8; }
  #mini-like.liked svg { fill: #c2708a; stroke: #c2708a; }
  #mini-close { width: 30px; color: #998ca2 !important; }
  #mini-close svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; }
  #mini-bar { position: absolute; left: 0; bottom: 0; height: 2px; width: 0; background: #9b4a7a; pointer-events: none; }
  /* \u8fd8\u6ca1\u653e\u6b4c\uff1a\u7f29\u6210\u4e00\u4e2a\u5c0f\u5706\u70b9 */
  #mini.empty { width: 52px; height: 52px; padding: 0; border-radius: 50%; justify-content: center; }
  #mini.empty #mini-open { flex: none; width: 52px; height: 52px; justify-content: center; gap: 0; }
  #mini.empty #mini-cover, #mini.empty #mini-text, #mini.empty .mini-btn, #mini.empty #mini-bar { display: none; }
  #mini.empty #mini-note { display: block; }
  /* \u85cf\u5230\u8fb9\u4e0a\uff1a\u53ea\u7559\u4e00\u6761\u5c0f\u628a\u624b */
  #mini.tucked { width: 22px; height: 64px; padding: 0; justify-content: center; cursor: pointer; }
  #mini.tucked > * { display: none !important; }
  #mini.tucked::after { content: ''; width: 4px; height: 28px; border-radius: 2px; background: #c9b3c3; }
  #mini.tucked-left { border-radius: 0 14px 14px 0; border-left: 0; }
  #mini.tucked-right { border-radius: 14px 0 0 14px; border-right: 0; }
  @media (prefers-reduced-motion: reduce) { #player, #player.open, #mini.anim { transition: none; } }
${MOTION_CSS}
</style>
</head><body>
${renderMotionTag()}
<iframe id="page" title="\u6668\u66ae\u661f"></iframe>
<div id="mini" class="empty" role="region" aria-label="\u97f3\u4e50" title="\u6309\u4f4f\u53ef\u4ee5\u62d6\u5230\u522b\u5904\uff0c\u5f80\u8fb9\u4e0a\u4e00\u7529\u53ef\u4ee5\u85cf\u8d77\u6765">
  <button id="mini-open" type="button" aria-label="\u6253\u5f00\u97f3\u4e50">
    <img id="mini-cover" alt="" />
    <span id="mini-note" aria-hidden="true">\u266a</span>
    <span id="mini-text"><span id="mini-name"></span><span id="mini-artist"></span></span>
  </button>
  <button id="mini-toggle" class="mini-btn" type="button" aria-label="\u64ad\u653e"><svg viewBox="0 0 24 24" aria-hidden="true"><path id="mini-toggle-icon" d="M8 5v14l11-7z"/></svg></button>
  <button id="mini-next" class="mini-btn" type="button" aria-label="\u4e0b\u4e00\u9996"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l8.5 6L6 18zM16 6h2v12h-2z"/></svg></button>
  <button id="mini-like" class="mini-btn" type="button" aria-label="\u6536\u85cf" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-8.6A5.2 5.2 0 0 1 12 6.3a5.2 5.2 0 0 1 9.2 5.1C19 15.6 12 20 12 20z"/></svg></button>
  <button id="mini-close" class="mini-btn" type="button" aria-label="\u5173\u95ed\u60ac\u6d6e\u7a97"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
  <i id="mini-bar" aria-hidden="true"></i>
</div>
<div id="player" aria-hidden="true">
  <iframe id="player-frame" title="\u97f3\u4e50" src="/music/" allow="autoplay; picture-in-picture"></iframe>
</div>
<script>${MOTION_SCRIPT}</script>
<script>
(function () {
  var START = '${START}';
  var page = document.getElementById('page');
  var player = document.getElementById('player');
  var frame = document.getElementById('player-frame');
  var $ = function (id) { return document.getElementById(id); };
  var mini = $('mini');

  function openPlayer() { player.classList.add('open'); player.setAttribute('aria-hidden', 'false'); document.body.classList.add('player-open'); }
  function closePlayer() {
    player.classList.remove('open'); player.setAttribute('aria-hidden', 'true'); document.body.classList.remove('player-open');
    mini.classList.remove('closed');
  }
  window.vpPlayer = { open: openPlayer, close: closePlayer };
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closePlayer(); });

  // ---------- \u60ac\u6d6e\u7a97 ----------
  var st = { song: null, playing: false, liked: false, at: 0, duration: 0 };
  function send(type) { try { frame.contentWindow.postMessage({ type: type }, location.origin); } catch (e) {} }
  frame.addEventListener('load', function () { setTimeout(function () { send('music:state-ask'); }, 300); });

  var PLAY = 'M8 5v14l11-7z', PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z';
  function render() {
    var s = st.song;
    mini.classList.toggle('empty', !s);
    $('mini-open').setAttribute('aria-label', s ? '\u6253\u5f00\u6b4c\u8bcd\uff1a' + s.name : '\u6253\u5f00\u97f3\u4e50');
    if (s) {
      $('mini-name').textContent = s.name || '';
      $('mini-artist').textContent = s.artist || '';
      var cover = $('mini-cover');
      if (s.cover && cover.getAttribute('src') !== s.cover) cover.setAttribute('src', s.cover);
      if (!s.cover) cover.removeAttribute('src');
    }
    $('mini-toggle-icon').setAttribute('d', st.playing ? PAUSE : PLAY);
    $('mini-toggle').setAttribute('aria-label', st.playing ? '\u6682\u505c' : '\u64ad\u653e');
    $('mini-like').classList.toggle('liked', !!st.liked);
    $('mini-like').setAttribute('aria-pressed', st.liked ? 'true' : 'false');
    $('mini-like').setAttribute('aria-label', st.liked ? '\u53d6\u6d88\u6536\u85cf' : '\u6536\u85cf');
    $('mini-bar').style.width = st.duration ? Math.min(100, st.at / st.duration * 100) + '%' : '0';
    if (pos && !tuck) place(pos.x, pos.y);
  }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var d = ev.data || {};
    if (d.type === 'vp:open-music') return openPlayer();
    if (d.type === 'vp:close-music') return closePlayer();
    if (ev.source !== frame.contentWindow) return;
    var wasPlaying = st.playing;
    if (d.type === 'music:state') {
      st.song = d.song; st.playing = !!d.playing; st.liked = !!d.liked; st.at = d.at || 0; st.duration = d.duration || 0;
    } else if (d.type === 'music:tick') {
      st.at = d.at || 0; st.duration = d.duration || 0; st.playing = !!d.playing;
    } else if (d.type === 'music:song') {
      if (d.song) { st.song = d.song; st.playing = !!d.song.playing; }
      setTimeout(function () { send('music:state-ask'); }, 300);
    } else return;
    // \u5173\u6389\u60ac\u6d6e\u7a97\u4e4b\u540e\u53c8\u5f00\u59cb\u653e\u6b4c\uff08\u6bd4\u5982\u70b9\u6b4c\u53f0\u9012\u8fc7\u6765\u4e00\u9996\uff09\uff0c\u60ac\u6d6e\u7a97\u56de\u6765
    if (st.playing && !wasPlaying) mini.classList.remove('closed');
    render();
  });

  $('mini-open').addEventListener('click', function () { openPlayer(); if (st.song) send('music:lyrics'); });
  $('mini-toggle').addEventListener('click', function () { send('music:toggle'); });
  $('mini-next').addEventListener('click', function () { send('music:next'); });
  $('mini-like').addEventListener('click', function () { send('music:like'); });
  $('mini-close').addEventListener('click', function () {
    if (st.playing) { send('music:toggle'); st.playing = false; }
    mini.classList.add('closed');
  });

  // \u62d6\u52a8\uff1a\u632a\u4e0d\u5230 6 \u50cf\u7d20\u7b97\u70b9\u6309\uff1b\u62d6\u5b8c\u677e\u624b\u90a3\u4e00\u4e0b\u7684\u70b9\u51fb\u541e\u6389\uff0c\u4e0d\u89e6\u53d1\u6309\u94ae\u3002
  // \u677e\u624b\u65f6\u62d6\u51fa\u53bb\u4e00\u534a\u3001\u6216\u8005\u5f80\u5de6\u53f3\u4e00\u7529\uff0c\u5c31\u85cf\u5230\u90a3\u4e00\u8fb9
  var POS_KEY = 'vp-mini-pos', TUCK_KEY = 'vp-mini-tuck';
  var pos = null, tuck = null, drag = null, dragged = false;
  function place(x, y, loose) {
    var w = mini.offsetWidth || 52, h = mini.offsetHeight || 52;
    if (loose) x = Math.min(Math.max(24 - w, x), window.innerWidth - 24);
    else x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4));
    y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
    pos = { x: x, y: y };
    mini.style.left = x + 'px'; mini.style.top = y + 'px'; mini.style.right = 'auto'; mini.style.bottom = 'auto';
  }
  function setTuck(side, animate) {
    tuck = side || null;
    if (animate) { mini.classList.add('anim'); setTimeout(function () { mini.classList.remove('anim'); }, 300); }
    mini.classList.toggle('tucked', !!tuck);
    mini.classList.toggle('tucked-left', tuck === 'left');
    mini.classList.toggle('tucked-right', tuck === 'right');
    mini.setAttribute('aria-label', tuck ? '\u97f3\u4e50\uff08\u5df2\u85cf\u5230\u8fb9\u4e0a\uff0c\u70b9\u4e00\u4e0b\u62c9\u56de\u6765\uff09' : '\u97f3\u4e50');
    if (tuck) {
      var h = 64, y = pos ? pos.y : window.innerHeight - h - 24;
      y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
      mini.style.top = y + 'px'; mini.style.bottom = 'auto';
      if (tuck === 'left') { mini.style.left = '0px'; mini.style.right = 'auto'; }
      else { mini.style.left = 'auto'; mini.style.right = '0px'; }
    } else if (pos) {
      place(pos.x, pos.y);
    }
    try { localStorage.setItem(TUCK_KEY, tuck || ''); } catch (e) {}
  }
  try {
    var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    if (saved && isFinite(saved.x) && isFinite(saved.y)) place(Number(saved.x), Number(saved.y));
    var savedTuck = localStorage.getItem(TUCK_KEY);
    if (savedTuck === 'left' || savedTuck === 'right') setTuck(savedTuck);
  } catch (e) {}
  window.addEventListener('resize', function () { if (tuck) setTuck(tuck); else if (pos) place(pos.x, pos.y); });

  mini.addEventListener('pointerdown', function (e) {
    if (e.button !== 0 || tuck) return;
    var r = mini.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, lx: e.clientX, lt: e.timeStamp, vx: 0, dx: 0, dy: 0 };
    dragged = false;
  });
  mini.addEventListener('pointermove', function (e) {
    if (!drag || e.pointerId !== drag.id) return;
    var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    drag.dx = dx; drag.dy = dy;
    var dt = e.timeStamp - drag.lt;
    if (dt > 0) { drag.vx = (e.clientX - drag.lx) / dt; drag.lx = e.clientX; drag.lt = e.timeStamp; }
    if (!dragged && Math.abs(dx) + Math.abs(dy) < 6) return;
    if (!dragged) { dragged = true; mini.classList.add('dragging'); try { mini.setPointerCapture(e.pointerId); } catch (err) {} }
    e.preventDefault();
    place(drag.ox + dx, drag.oy + dy, true);
  });
  function stop(e) {
    if (!drag || e.pointerId !== drag.id) return;
    var d = drag;
    drag = null;
    mini.classList.remove('dragging');
    if (!dragged || !pos) return;
    var w = mini.offsetWidth || 52;
    var sideways = Math.abs(d.dx) > Math.abs(d.dy);
    var flungLeft = sideways && d.vx < -0.8, flungRight = sideways && d.vx > 0.8;
    var outLeft = pos.x < -w * 0.35, outRight = pos.x + w > window.innerWidth + w * 0.35;
    place(pos.x, pos.y); // \u5148\u6536\u56de\u5c4f\u5e55\u91cc\uff0c\u8bb0\u4e0b\u7684\u4f4d\u7f6e\u4ee5\u540e\u62c9\u56de\u6765\u65f6\u7528
    try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) {}
    if (outLeft || flungLeft) setTuck('left', true);
    else if (outRight || flungRight) setTuck('right', true);
  }
  mini.addEventListener('pointerup', stop);
  mini.addEventListener('pointercancel', stop);
  mini.addEventListener('click', function (e) {
    if (tuck) { e.preventDefault(); e.stopPropagation(); setTuck(null, true); return; }
    if (dragged) { e.preventDefault(); e.stopPropagation(); dragged = false; }
  }, true);
  render();

  // ---------- \u5185\u5bb9\u533a ----------
  // # \u540e\u9762\u53ea\u8ba4\u7ad9\u5185\u9875\u9762\uff0c/app \u548c /music \u4e0d\u80fd\u5957\u8fdb\u5185\u5bb9\u533a
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
}

export function registerShellRoutes(app, { requireBasicAuth }) {
  // \u76f4\u63a5\u6253\u5f00\u52a8\u6001\u3001\u65e5\u8bb0\u3001\u5fc3\u7eea\u9875\u65f6\u5e26\u56de\u5916\u58f3\u3002\u53ea\u7ba1\u6574\u9875\u6253\u5f00\uff08document\uff09\uff0ciframe \u91cc\u52a0\u8f7d\u7684\u4e0d\u52a8
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.headers['sec-fetch-dest'] !== 'document') return next();
    if (!WRAPPED.test(req.originalUrl)) return next();
    return res.redirect(302, `/app#${req.originalUrl}`);
  });

  app.get('/app', requireBasicAuth, (req, res) => {
    res.set('cache-control', 'no-store');
    // \u6bcf\u6b21\u73b0\u7b97\uff1a\u52a8\u6548\u6587\u4ef6\u662f\u4e0d\u662f\u5728\u78c1\u76d8\u4e0a\u53ef\u80fd\u53d8\uff0c\u4e0d\u80fd\u5728\u6a21\u5757\u52a0\u8f7d\u65f6\u5c31\u5b9a\u6b7b
    res.send(shellHtml());
  });
}
