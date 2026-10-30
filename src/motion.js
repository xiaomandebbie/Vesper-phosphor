// 加载页和转场的自定义动效。
//
// 小满 2026-10-31 02:5x：「29 是登录页面30-32 是切换页面」「转页面 2 秒」
// 「加载页那条 10 秒的…我倾向播一遍不等它完，首屏数据好了就淡出」✓
//
// ── 文件在哪儿、叫什么 ──
//
// public/motion/ 下四个 mp4，名字就是上传时的原名，不改名：
//   29_raw.mp4  登录/加载页（7.1M，10 秒）
//   30_raw.mp4  转场（739K）
//   31_raw.mp4  转场（736K）
//   32_raw.mp4  转场（626K）
//
// 没转码：那台机器没 ffmpeg，凌晨三点不装。所以 29 那个 7.1M 原样用——
// 它只在登录页加载一次，而且 preload="auto" 会缓存。哪天装上 ffmpeg 再压。
//
// ── iOS 上自动播放的三个必要条件 ──
//
// muted + playsinline + autoplay，少一个就不播。playsinline 尤其要紧：
// 不写它 iPhone 会把视频推到全屏播放器里，整个转场就毁了。
// 另外 muted 必须是 HTML 属性，光设 video.muted = true 有时不算。
//
// ── 文件不在就退回去 ──
//
// hasMotion() 真的去磁盘上看文件存不存在。不在就不注入这套 CSS/JS，
// page-chrome 那套粉雾加星星照旧跑。不会因为缺文件白屏。

import fs from 'fs';
import path from 'path';

const DIR = path.join(process.cwd(), 'public', 'motion');
const LOAD = '29_raw.mp4';
const TRANS = ['30_raw.mp4', '31_raw.mp4', '32_raw.mp4'];

// 转场总时长，小满定的 2 秒。page-chrome 里原来是 900ms。
export const TRANS_MS = 2000;

function exists(name) {
  try {
    return fs.existsSync(path.join(DIR, name));
  } catch {
    return false;
  }
}

// 有哪几个能用。转场那三个少一两个也能跑，剩下的轮着用。
export function motionAssets() {
  return {
    load: exists(LOAD) ? `/motion/${LOAD}` : '',
    trans: TRANS.filter(exists).map((n) => `/motion/${n}`),
  };
}

export function hasMotion() {
  const a = motionAssets();
  return Boolean(a.load || a.trans.length);
}

// 视频铺满屏幕。object-fit: cover —— 宽高比和屏幕对不上时裁掉边，
// 不拉变形。z-index 比 page-chrome 的雾面高一级，盖在它上面。
export const MOTION_CSS = `
  .vp-motion { position: fixed; inset: 0; z-index: 99999; overflow: hidden;
    pointer-events: none; opacity: 0; background: #0e0c10;
    transition: opacity 0.45s ease; }
  .vp-motion.on { opacity: 1; }
  .vp-motion video { position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: cover; display: block; }
  /* 加载页要挡住点击（别让人透过它点到东西），转场不用 */
  .vp-motion.vp-motion-load { pointer-events: auto; }
  @media (prefers-reduced-motion: reduce) {
    .vp-motion video { display: none; }
  }
`;

// 这整段是模板字符串，里面不能出现 ${ —— 会被当成插值。
// 资源路径通过 data-* 从 HTML 上读，不在这儿拼。
export const MOTION_SCRIPT = `(function () {
  var cfg = document.querySelector('[data-motion]');
  if (!cfg) return;
  var loadSrc = cfg.getAttribute('data-load') || '';
  var transList = (cfg.getAttribute('data-trans') || '').split(',').filter(Boolean);
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  function layer(src, isLoad) {
    var box = document.createElement('div');
    box.className = 'vp-motion' + (isLoad ? ' vp-motion-load' : '');
    box.setAttribute('aria-hidden', 'true');
    if (src && !reduce) {
      var v = document.createElement('video');
      // iOS 三件套：少一个就不自动播
      v.muted = true;
      v.setAttribute('muted', '');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('autoplay', '');
      v.setAttribute('preload', 'auto');
      if (!isLoad) v.setAttribute('loop', '');
      v.src = src;
      box.appendChild(v);
      // play() 在 Safari 里返 Promise，被拦了也不要报错——
      // 它被拦就是一层深色底，比白屏强
      try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    }
    document.body.appendChild(box);
    return box;
  }

  // ── 加载页：只在冷启动出。站内跳转走转场，不走这里 ──
  //
  // 冷启动的判法：sessionStorage 里没有 page-chrome 留的跳转记号。
  // 那个记号是点站内链接时写的，所以有它 = 从别的页过来的。
  var LEAVE_KEY = 'vp-stars';
  var cold = true;
  try { cold = !sessionStorage.getItem(LEAVE_KEY); } catch (e) {}

  if (cold && loadSrc) {
    var load = layer(loadSrc, true);
    void load.offsetWidth;
    load.classList.add('on');

    var gone = false;
    function dismiss() {
      if (gone) return;
      gone = true;
      load.classList.remove('on');
      setTimeout(function () { if (load.parentNode) load.remove(); }, 460);
    }

    // 「播一遍不等它完，首屏数据好了就淡出」——
    // 两个条件谁先到算谁：页面 load 事件，或者最多 2.4 秒。
    // 上限是必要的：图片、字体、SSE 都能拖住 load，没上限会卡很久。
    if (document.readyState === 'complete') setTimeout(dismiss, 900);
    else window.addEventListener('load', function () { setTimeout(dismiss, 500); });
    setTimeout(dismiss, 2400);
  }

  // ── 转场：替掉 page-chrome 的粉雾。三个随机一个 ──
  //
  // 停掉原来那套的做法：在 document 上用 capture 阶段接管 click，
  // 自己 preventDefault 并跳转。page-chrome 的监听器在冒泡阶段，
  // 没机会跑到。不改那个文件——它被九个脚本轮流改坏过一次。
  if (!transList.length) return;
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
    var same = url.origin === location.origin;
    var outside = a.hasAttribute('data-stars');
    if (!same && !outside) return;
    if (same && url.pathname === location.pathname && url.search === location.search && url.hash) return;

    e.preventDefault();
    e.stopPropagation();
    if (leaving) return;
    leaving = true;

    // 站内跳转留记号：这样下一页知道自己不是冷启动，不再放加载页
    if (same && !outside) { try { sessionStorage.setItem(LEAVE_KEY, '1'); } catch (err) {} }

    var pick = transList[Math.floor(Math.random() * transList.length)];
    var box = layer(pick, false);
    void box.offsetWidth;
    box.classList.add('on');

    // 2 秒（小满定的）。减弱动态效果时缩短——那种情况下没视频，
    // 干等两秒一层深色底没意义
    setTimeout(function () { location.href = url.href; }, reduce ? 200 : ${TRANS_MS});

    // 过了很久还在这一页（比如点的是下载链接），把遮罩撕掉
    setTimeout(function () {
      leaving = false;
      try { sessionStorage.removeItem(LEAVE_KEY); } catch (err) {}
      box.classList.remove('on');
      setTimeout(function () { if (box.parentNode) box.remove(); }, 460);
    }, 7000);
  }, true);

  // 后退缓存回来：把挂着的遮罩清干净
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    try { sessionStorage.removeItem(LEAVE_KEY); } catch (err) {}
    document.querySelectorAll('.vp-motion').forEach(function (b) { b.remove(); });
  });
})();`;

// 放进 <body> 的配置标签。路径写在 data-* 上，脚本自己读。
export function renderMotionTag() {
  const a = motionAssets();
  if (!a.load && !a.trans.length) return '';
  return `<span data-motion hidden data-load="${a.load}" data-trans="${a.trans.join(',')}"></span>`;
}
