// 音乐 /music/：把 Music-Mcp-Netease 的播放器（server/music.py，默认 127.0.0.1:9090）转发过来。
// 好处：
//   1. 登录和动态页共用 vesper 的 Basic Auth，以后把播放器嵌进晨暮星页面时不会再弹第二个登录框；
//   2. 页面换成晨暮星的配色，顺手去掉播放器自带的两行漏到页面上的注释；
//   3. 播放器看到 X-Music-Gateway 头就不要 token，这个头只在这里加，浏览器碰不到；
//   4. 注入一小段控制脚本，晨暮星的悬浮窗用 postMessage 就能暂停、切歌、点红心、打开歌词；
//   5. 嵌在晨暮星外壳里时也用完整版界面（播放器自己检测到在 iframe 里会切成聊天抽屉的精简版）；
//   6. 去掉播放器顶栏（music 标题、回主页），换成晨暮星的三条杠菜单，固定在屏幕上、可以拖动。
//      在外壳里点菜单项：内容区换到那一页、播放器收起，不在播放器里跳页。
// 播放器的代码一行不改，它以后怎么更新都不受影响。
// 要拿到原始请求体，所以 vesper.js 里必须挂在 express.json() 之前（和记忆库一样）。
import { Readable } from 'stream';
import { renderMenu, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const PREFIX = '/music';
const env = (k) => String(process.env[k] ?? '').trim();

// MUSIC_PLAYER_URL 形如 http://127.0.0.1:9090；不填或填 off 就不转发
export function musicPlayerBase() {
  const raw = env('MUSIC_PLAYER_URL');
  if (!raw || /^(off|0|false|no)$/i.test(raw)) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'x-music-gateway',
]);
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

// 播放器 index.html 里有两段注释开头丢了，后半句当正文显示在歌词页上
const STRAY_LINES = [/^.*syncDiscSpin 还在但查无此盘.*\r?\n/m, /^.*进度条滑块是兔兔本兔.*\r?\n/m];

// 播放器发现自己在 iframe 里就切成聊天抽屉的精简版（没有顶栏、首页、个人主页，默认停在歌单）。
// 晨暮星外壳里是全屏打开的，要完整版：
//   - 嵌入检测改成「不算嵌着」；
//   - 返回键接管只在独立打开时装，不然它往历史里塞记录，会搅乱外壳的后退。
// 找不到这些原文（上游改了写法）就什么都不换，最多退回精简版，不会弄坏页面。
const FULL_LAYOUT = [
  ['try { return window.self !== window.top; } catch { return true; }', 'return false;'],
  ['if (!isEmbedded) installBackGuard();', 'if (window.parent === window) installBackGuard();'],
];

// 晨暮星配色：覆盖播放器的颜色变量和底色。布局、动效都不动
const SKIN_CSS = `
  html:root {
    --ink: #2b2233; --ink-soft: #4a3d52; --muted: #665a70; --faint: #b9adbf;
    --rose: #9b4a7a; --rose-deep: #7a3e5d; --butter: #f6e6bf;
    --accent: #7a3e5d; --accent-soft: #9b4a7a; --btn: #7a3e5d; --accent-tint: rgba(122, 62, 93, 0.12);
    --bg: #f9f0ee; --milk: rgba(255, 253, 251, 0.72); --milk-strong: rgba(255, 253, 251, 0.92);
    --hairline: rgba(122, 62, 93, 0.14);
    --shadow-soft: 0 12px 32px rgba(90, 50, 80, 0.14); --shadow-sm: 0 4px 14px rgba(60, 30, 60, 0.1);
  }
  html, html body { background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%) fixed; }
  html .memory-view { background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  /* 播放器自己的顶栏（music 标题、回主页、缩成迷你窗）占视野，换成晨暮星的三条杠菜单 */
  html .topbar { display: none !important; }
`;

// 控制桥：播放器嵌在晨暮星页面里（iframe）时，父页面发这些消息就能遥控它。只认同源消息。
//   父页 → 播放器：music:toggle / music:next / music:prev / music:like / music:lyrics / music:close-lyrics / music:state-ask
//   播放器 → 父页：music:state {song, playing, liked, at, duration}（播放、暂停、换歌、红心变化时也会主动推）
//   三条杠菜单在外壳里点：内容区换页、播放器收起（直接用外壳的 #page 和 vpPlayer，同源可以直接调）；
//   站外链接开新标签；点「音乐」只收起菜单
// 播放器原有的 music:play / music:ask / music:tick 照常能用。
// 播放器脚本里的 state、likedIds、togglePlay 这些是顶层声明，同一页面里别的脚本能直接用到；
// 哪天上游改名了，这里只是不起作用，不会把播放器弄坏。
const BRIDGE_SCRIPT = `(function () {
  function hasState() { return typeof state !== 'undefined' && state; }
  function snap() {
    var s = hasState() ? state : null;
    var song = s && s.song;
    var liked = !!(song && song.songId && typeof likedIds !== 'undefined' && likedIds.has(song.songId));
    return {
      type: 'music:state',
      song: song ? { songId: song.songId || '', name: song.name || '', artist: song.artist || '', cover: song.cover || '' } : null,
      playing: !!(s && s.playing), liked: liked,
      at: s ? s.currentTime || 0 : 0, duration: s ? s.duration || 0 : 0
    };
  }
  function post() {
    if (window.parent === window) return;
    try { window.parent.postMessage(snap(), location.origin); } catch (e) {}
  }
  function call(name, arg) {
    try { if (typeof window[name] === 'function') return window[name](arg); } catch (e) { console.error('music bridge', name, e); }
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var t = (ev.data || {}).type;
    if (t === 'music:toggle') call('togglePlay');
    else if (t === 'music:next') call('playNext');
    else if (t === 'music:prev') call('playPrev');
    else if (t === 'music:like') { if (hasState() && state.song) call('likeSong', state.song); }
    else if (t === 'music:lyrics') call('openLyrics');
    else if (t === 'music:close-lyrics') call('closeLyrics');
    else if (t !== 'music:state-ask') return;
    setTimeout(post, 250);
  });
  // 外壳里点三条杠菜单：不在播放器里跳页，换外壳的内容区，再收起播放器
  document.addEventListener('click', function (e) {
    if (window.parent === window) return;
    var a = e.target.closest ? e.target.closest('.vp-menu a[href]') : null;
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    var menu = a.closest('[data-menu]');
    if (menu) menu.removeAttribute('open');
    var u;
    try { u = new URL(a.href, location.href); } catch (err) { return; }
    if (u.origin !== location.origin) { window.open(u.href, '_blank', 'noopener'); return; }
    if (u.pathname.indexOf('/music') === 0) return;
    try {
      var P = window.parent;
      P.document.getElementById('page').src = u.pathname + u.search + u.hash;
      P.vpPlayer.close();
    } catch (err) {
      try { window.parent.postMessage({ type: 'vp:close-music' }, location.origin); } catch (e2) {}
    }
  }, true);
  if (typeof refreshLikeHearts === 'function') {
    var origHearts = refreshLikeHearts;
    window.refreshLikeHearts = function () { var r = origHearts.apply(this, arguments); post(); return r; };
  }
  if (typeof audio !== 'undefined' && audio && audio.addEventListener) {
    ['play', 'pause', 'loadedmetadata', 'ended'].forEach(function (e) { audio.addEventListener(e, post); });
  }
  post();
})();`;

function rewriteHtml(html) {
  let out = html;
  for (const re of STRAY_LINES) out = out.replace(re, '');
  for (const [find, replacement] of FULL_LAYOUT) out = out.split(find).join(replacement);
  const style = `<style id="vesper-skin">${CHROME_CSS}${SKIN_CSS}</style>`;
  const head = out.search(/<\/head>/i);
  out = head >= 0 ? out.slice(0, head) + style + out.slice(head) : style + out;
  // 三条杠菜单：固定在屏幕上、按住可以拖（和记忆库那页一样，位置记在这台设备上）
  const menu = renderMenu(`${PREFIX}/`, { fixed: true });
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + menu) : out + menu;
  const script = `<script>${CHROME_SCRIPT}</script><script id="vesper-bridge">${BRIDGE_SCRIPT}</script>`;
  const body = out.toLowerCase().lastIndexOf('</body>');
  return body >= 0 ? out.slice(0, body) + script + out.slice(body) : out + script;
}

// 播放器跳到 /xxx 时补上前缀（它的页面本身在根路径 /，对外是 /music/）
function rewriteLocation(value, base) {
  let v = String(value);
  if (v.startsWith(base)) v = v.slice(base.length) || '/';
  if (!v.startsWith('/') || v.startsWith('//')) return v;
  if (v === '/' || v.startsWith('/?')) return `${PREFIX}${v}`;
  return v.startsWith(`${PREFIX}/`) ? v : `${PREFIX}${v}`;
}

export function registerMusicProxy(app, { requireBasicAuth }) {
  const base = musicPlayerBase();
  if (!base) return '';
  const gateway = env('MUSIC_GATEWAY_TOKEN') || 'music-gateway';

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    const [pathname, query] = req.originalUrl.split(/\?(.*)/s);
    if (pathname === PREFIX) return res.redirect(301, `${PREFIX}/${query ? `?${query}` : ''}`);
    // 播放器页面在它的根路径；接口和音频本来就在 /music/... 下面，原样转发
    const target = pathname === `${PREFIX}/` ? `/${query ? `?${query}` : ''}` : req.originalUrl;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      if (k === 'authorization' && /^basic\s/i.test(String(v))) continue; // vesper 的登录不往下传
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    headers['x-music-gateway'] = gateway;

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    let upstream;
    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      upstream = await fetch(base + target, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('music proxy: 连不上播放器', err.message);
      return res.status(502).send('连不上音乐播放器，看一下 pm2 status 里它在不在跑。');
    }

    try {
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key)) return;
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });
      const type = upstream.headers.get('content-type') || '';
      if (req.method !== 'HEAD' && upstream.body && type.includes('text/html')) {
        const html = rewriteHtml(await upstream.text());
        res.setHeader('cache-control', 'no-store');
        return res.end(html);
      }
      if (!upstream.body || req.method === 'HEAD') return res.end();
      // 音频走 Range 分段（206），这里原样流过去，拖进度条照常能用
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('music proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send('音乐播放器转发出错了，看一下 vesper 的日志。');
      else res.destroy();
    }
  });

  return base;
}
