// 加载页和转场的自定义动效。
//
// 小满 2026-10-31：「29 是登录页面30-32 是切换页面」「转页面 2 秒」
// 「加载页那条 10 秒的…我倾向播一遍不等它完，首屏数据好了就淡出」✓
//
// ── 文件 ──
//
// public/motion/ 下：
//   load.webm + p29.jpg   加载页（536K，取原片前 5 秒）
//   t30.webm  + p30.jpg   转场（392K）
//   t31.webm  + p31.jpg   转场（387K）
//   t32.webm  + p32.jpg   转场（363K）
//
// 原件 29_raw.mp4 那四个是 HEVC（hvc1），**Safari 在 <video> 里基本播不了**，
// 所以转码不是为了省流量，是必须的。这台机器没有 libx264
// （openh264 因专利不在源里），所以走 VP9/WebM。
//
// WebM 在 iOS 16 之后才能播，所以每个 <video> 都带 poster：
// 视频能播就播，播不了停在那张封面图上——不黑屏、画面还是对的。
//
// ── iOS 上自动播放的三个必要条件 ──
//
// muted + playsinline + autoplay，少一个就不播。playsinline 尤其要紧：
// 不写它 iPhone 会把视频推到全屏播放器里，整个转场就毁了。
// 另外 muted 必须是 HTML 属性，光设 video.muted = true 有时不算。
//
// ── 两处挂在不同地方 ──
//
// /app 外壳（shell.js）是独立 HTML，不走 page-chrome，内容页在 iframe 里。所以：
//   加载页  → 挂在 shell.js 上，这样才能盖满全屏
//   转场    → iframe 里的脚本只负责 postMessage 通知外壳，由外壳放遮罩
// 不然遮罩会被关在 iframe 里，盖不住播放器和悬浮窗。
//
// 文件不在就退回去：hasMotion() 真的去磁盘看，不在就不注入，
// page-chrome 那套粉雾加星星照旧跑。

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'public', 'motion');

// 转场总时长，小满定的 2 秒。page-chrome 里原来是 900ms。
export const TRANS_MS = 2000;

function exists(name) {
  try {
    return fs.existsSync(path.join(DIR, name));
  } catch {
    return false;
  }
}

// 一组 = 一个视频加它的封面。视频不在就整组不算；
// 封面不在还能用，只是没了兑底。
function pair(video, poster) {
  if (!exists(video)) return null;
  return { src: `/motion/${video}`, poster: exists(poster) ? `/motion/${poster}` : '' };
}

export function motionAssets() {
  const load = pair('load.webm', 'p29.jpg');
  const trans = [
    pair('t30.webm', 'p30.jpg'),
    pair('t31.webm', 'p31.jpg'),
    pair('t32.webm', 'p32.jpg'),
  ].filter(Boolean);
  return { load, trans };
}

export function hasMotion() {
  const a = motionAssets();
  return Boolean(a.load || a.trans.length);
}

// 视频铺满屏幕。object-fit: cover —— 宽高比和屏幕对不上时裁掉边，不拉变形。
// 底色用深色：视频还没解码出第一帧的那一瞬，比白闪好。
export const MOTION_CSS = `
  .vp-motion { position: fixed; inset: 0; z-index: 99999; overflow: hidden;
    pointer-events: none; opacity: 0; background: #14101a;
    transition: opacity 0.45s ease; }
  .vp-motion.on { opacity: 1; }
  .vp-motion video, .vp-motion .vp-motion-img {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block; }
  /* 加载页要挡住点击（别让人透过它点到东西），转场不用 */
  .vp-motion.vp-motion-load { pointer-events: auto; }
  /* 开了「减弱动态效果」就只留封面图，不播视频 */
  @media (prefers-reduced-motion: reduce) {
    .vp-motion video { display: none; }
  }
`;

// 这整段是模板字符串，里面不能出现 ${ —— 会被当成插值。
// 资源路径通过 data-* 从 HTML 上读，不在这儿拼。
//
// 这段既给外壳用（放加载页和收到通知后放转场），也给内容页用
// （内容页里只发通知，不自己画）。靠 window.parent !== window 分辨。
export const MOTION_SCRIPT = `(function () {
  var cfg = document.querySelector('[data-motion]');
  if (!cfg) return;
  var inFrame = false;
  try { inFrame = window.parent && window.parent !== window; } catch (e) { inFrame = true; }

  var loadSrc = cfg.getAttribute('data-load') || '';
  var loadPoster = cfg.getAttribute('data-load-poster') || '';
  var transRaw = cfg.getAttribute('data-trans') || '';
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // data-trans 格式：视频|封面,视频|封面
  var transList = transRaw.split(',').filter(Boolean).map(function (s) {
    var p = s.split('|');
    return { src: p[0], poster: p[1] || '' };
  });

  function layer(item, isLoad) {
    var box = document.createElement('div');
    box.className = 'vp-motion' + (isLoad ? ' vp-motion-load' : '');
    box.setAttribute('aria-hidden', 'true');
    if (!item) { document.body.appendChild(box); return box; }

    // 封面先铺上：视频解码前、或者根本播不了时就是它
    if (item.poster) {
      var img = document.createElement('img');
      img.className = 'vp-motion-img';
      img.src = item.poster;
      img.alt = '';
      box.appendChild(img);
    }

    if (!reduce) {
      var v = document.createElement('video');
      v.muted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('autoplay', '');
      v.setAttribute('preload', 'auto');
      if (item.poster) v.setAttribute('poster', item.poster);
      if (!isLoad) v.setAttribute('loop', '');
      v.src = item.src;
      // 视频起不来就把它拿掉，让下面的封面图露出来
      v.addEventListener('error', function () { if (v.parentNode) v.remove(); });
      box.appendChild(v);
      try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    document.body.appendChild(box);
    return box;
  }

  function fade(box) {
    box.classList.remove('on');
    setTimeout(function () { if (box.parentNode) box.remove(); }, 460);
  }

  var LEAVE_KEY = 'vp-stars';

  // ── 加载页：只在外壳、只在冷启动 ──
  //
  // 冷启动的判法：sessionStorage 里没有跳转记号。
  // 那个记号是点站内链接时写的，有它 = 从别的页过来的。
  if (!inFrame && loadSrc) {
    var cold = true;
    try { cold = !sessionStorage.getItem(LEAVE_KEY); } catch (e) {}
    if (cold) {
      var load = layer({ src: loadSrc, poster: loadPoster }, true);
      void load.offsetWidth;
      load.classList.add('on');
      var gone = false;
      function dismiss() {
        if (gone) return;
        gone = true;
        fade(load);
      }
      // 「播一遍不等它完，首屏数据好了就淡出」
      // 两个条件谁先到算谁；上限是必要的，因为图片、字体、SSE 都能拖住 load
      if (document.readyState === 'complete') setTimeout(dismiss, 900);
      else window.addEventListener('load', function () { setTimeout(dismiss, 500); });
      setTimeout(dismiss, 2600);
    }
  }

  // ── 外壳：收到内容页的通知就放转场 ──
  if (!inFrame && transList.length) {
    window.addEventListener('message', function (ev) {
      if (ev.origin !== location.origin) return;
      var d = ev.data || {};
      if (d.type !== 'vp:transition') return;
      var pick = transList[Math.floor(Math.random() * transList.length)];
      var box = layer(pick, false);
      void box.offsetWidth;
      box.classList.add('on');
      // 等内容页换完再淡出。内容页那边跳转用的是同一个时长，
      // 所以这儿多给一点，避开新页还在白屏的那一瞬
      setTimeout(function () { fade(box); }, ${TRANS_MS} + 350);
    });
  }

  // ── 内容页：接管 click，通知外壳，等 2 秒再跳 ──
  //
  // 用 capture 阶段——page-chrome 的星星转场在冒泡阶段，这样它跑不到，
  // 不用改那个文件（它被九个脚本轮流改坏过一次）。
  if (inFrame) {
    var leaving = false;
    document.addEventListener('click', function (e) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      var a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-no-stars')) return;
      var raw = a.getAttribute('href') || '';
      if (raw.charAt(0) === '#') return;
      var url;
      try { url = new URL(a.href, location.href); } catch (err) { return; }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search && url.hash) return;
      // /music 由外壳拦成拉起播放器，不是换页，不走转场
      if (/^\\/music(\\/|$)/.test(url.pathname)) return;

      e.preventDefault();
      e.stopPropagation();
      if (leaving) return;
      leaving = true;

      // 留记号：下一页知道自己不是冷启动，不再放加载页
      try { sessionStorage.setItem(LEAVE_KEY, '1'); } catch (err) {}
      try { window.parent.postMessage({ type: 'vp:transition' }, location.origin); } catch (err) {}

      setTimeout(function () { location.href = url.href; }, reduce ? 200 : ${TRANS_MS});

      setTimeout(function () {
        leaving = false;
        try { sessionStorage.removeItem(LEAVE_KEY); } catch (err) {}
      }, 7000);
    }, true);
  }

  // 后退缓存回来：把挂着的遮罩清干净
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    try { sessionStorage.removeItem(LEAVE_KEY); } catch (err) {}
    document.querySelectorAll('.vp-motion').forEach(function (b) { b.remove(); });
  });
})();`;

// 放进 <body> 的配置标签。路径写在 data-* 上，脚本自己读。
export function renderMotionTag() {
  const a = motionAssets();
  if (!a.load && !a.trans.length) return '';
  const load = a.load ? a.load.src : '';
  const poster = a.load ? a.load.poster : '';
  const trans = a.trans.map((t) => `${t.src}|${t.poster}`).join(',');
  return `<span data-motion hidden data-load="${load}" data-load-poster="${poster}" data-trans="${trans}"></span>`;
}
