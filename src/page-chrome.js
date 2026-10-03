// 几个页面共用的外框：右上角的三条杠菜单，换页、换日期时的星星转场，以及早晚两张脸。
// 动态页、自定义页、心绪页、日记页，以及转发过来的记忆库（Ombre Brain 管理页）都从这里拿，改一处几个页面一起变。
//
// 星星转场：点站内链接时先盖上一层粉色雾面，星星一颗颗闪出来，再跳过去；
// 新页面打开时先盖着，星星再闪几下后淡出。系统开了「减弱动态效果」就只淡入淡出。
// 菜单里的外部页面离开时也走转场；那边不是本项目的页面，所以没有进场动画。
// 没有 JavaScript 时链接照常跳，没有转场。表单提交（留言、点赞）不走转场。
//
// 早晚两张脸：页面底色按长沙真实的日出日落走（见 sun-time.js），不按系统时区切。
// 颜色跑在 HEAD_SCRIPT 里，在 head 里最先执行，所以首屏绘制前就定好了，不会先亮一下再变暗。
// 各页自己 STYLE 里 :root 写死的 --ink 这些值照旧留着，当做没 JavaScript 时的底；
// 有 JavaScript 时行内样式挂在 <html> 上，优先级更高，赢过 :root。
//
// 记忆库那页的菜单是固定在屏幕上的，按住可以拖到别处，免得挡住 Ombre Brain 自己的按钮；拖到哪记在这台设备上。
//
// 类名都带 vp- 前缀：记忆库那页是别人的页面，样式要和它的类名错开。

import { FACE_CSS, FACE_SCRIPT } from './sun-time.js';

const env = (k) => String(process.env[k] ?? '').trim();

// 外部地址只放行 http(s)，填错了就当没填。
// allowPath：也接受 /music 这种同一个域名下的路径（比如 nginx 把 /music 转给另一个程序）
function externalUrl(k, { allowPath = false } = {}) {
  const v = env(k);
  if (allowPath && /^\/(?!\/)[^\s"'<>]*$/.test(v)) return v;
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// heartbeat 存日记的目录（绝对路径）。填了就有站内日记页 /diary
export function diaryDir() {
  return env('HEARTBEAT_DIARY_DIR');
}

// Ombre Brain 管理页在本机的地址，vesper 把它转发到 /memory/。
// 没填 OMBRE_DASHBOARD_URL 就用 OMBRE_BRAIN_URL 的地址（只取协议、主机和端口，去掉 /mcp）；填 off 不转发
export function ombreDashboardBase() {
  const explicit = env('OMBRE_DASHBOARD_URL');
  if (/^(off|0|false|no)$/i.test(explicit)) return '';
  const raw = explicit || env('OMBRE_BRAIN_URL');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return explicit ? `${u.origin}${u.pathname.replace(/\/+$/, '')}` : u.origin;
  } catch {
    return '';
  }
}

// 菜单入口。日记、记忆库优先用站内页面；没配站内页面时可以用 NAV_DIARY_URL / NAV_MEMORY_URL 跳外部地址，
// 都没配就显示成灰色「没配置」。
// 论坛是给人看的网页（比如 Lutopia 社区首页），填 NAV_FORUM_URL 才能点；和 TA 自己连论坛用的 LUTOPIA_MCP_URL 无关。
// 音乐是另一个程序的页面，填 NAV_MUSIC_URL：同域名下的路径（/music）或完整地址都行
function navItems() {
  const diary = diaryDir()
    ? { href: '/diary', label: '日记' }
    : { href: externalUrl('NAV_DIARY_URL'), label: '日记', external: true, note: '没配置' };
  const memory = ombreDashboardBase()
    ? { href: '/memory/', label: '记忆库' }
    : { href: externalUrl('NAV_MEMORY_URL'), label: '记忆库', external: true, note: '没配置' };
  return [
    { href: '/moments', label: '回到主页' },
    diary,
    { href: '/drives', label: '心绪' },
    { href: externalUrl('NAV_MUSIC_URL', { allowPath: true }), label: '音乐', external: true, note: '没配置' },
    { href: externalUrl('NAV_FORUM_URL'), label: '论坛', external: true, note: '没配置' },
    memory,
    { href: '/moments/profile', label: '自定义' },
  ];
}

// 右上角三条杠。<details> 本身就能展开收起，没有 JavaScript 也能用。
// fixed：固定在屏幕上、可以拖动，给记忆库那种不是我们自己排版的页面用
export function renderMenu(current, { fixed = false } = {}) {
  const items = navItems()
    .map((item) => {
      if (!item.href) {
        return `<li><span class="vp-menu-soon" aria-disabled="true">${item.label}<small>${item.note || '还没做'}</small></span></li>`;
      }
      const here = !item.external && item.href === current;
      const attrs = item.external ? ' data-stars rel="noopener"' : here ? ' aria-current="page"' : '';
      return `<li><a href="${escapeAttr(item.href)}"${attrs}>${item.label}</a></li>`;
    })
    .join('');
  const hint = fixed ? ' title="点开是菜单，按住可以拖到别处"' : '';
  return `<details class="vp-menu${fixed ? ' vp-menu-fixed' : ''}" data-menu>
    <summary class="vp-menu-btn" aria-label="菜单"${hint}><span class="vp-bars" aria-hidden="true"><i></i><i></i><i></i></span></summary>
    <nav class="vp-menu-panel" aria-label="页面"><ul>${items}</ul></nav>
  </details>`;
}

// 放在 <head> 里最先跑：
//   1. 上一页是点链接跳过来的，就先把整页盖住，免得内容闪一下才盖上转场；
//   2. 按长沙的日出日落把当下该用的颜色定下来（见 sun-time.js）。
//      要在首屏绘制前做完，所以跑在这里，不在 </body> 前。
export const HEAD_SCRIPT =
  "try{if(sessionStorage.getItem('vp-stars'))document.documentElement.classList.add('vp-stars-in')}catch(e){}" +
  FACE_SCRIPT;

// 四张脸要追着改的页面元素。各页 STYLE 里这些颜色是写死的，这里排在它们后面盖过去。
const FACE_PATCH_CSS = `
  /* 标题：苹方超细 + 大字距。
     之前是宋体 700 + 0.35em，粗、紧、端正、居中四个规整叠在一起，所以死沉。
     苹方是系统字体，一定在；行楷、魏碑这些本机没装就会退回宋体，所以没用。
     字重、字距、行高得一起改 —— 只换字体名还是那个骨架。
     字距给最后一个字也加了右边距，用 padding-left 把居中找回来。 */
  .title { font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    font-weight: 200; font-size: 34px; letter-spacing: 0.62em; padding-left: 0.62em; line-height: 1.3; }
  .title.title-sm { font-size: 24px; letter-spacing: 0.42em; padding-left: 0.42em; }
  /* 副标跟着疏开一点，和标题的留白对得上 */
  .subtitle { letter-spacing: 0.3em; }

  /* 标题的文字渐变：白天是紫→玕→金，夜里换成浅紫→粉→淡金，不然深底上的深紫字认不出来 */
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, var(--t1) 0%, var(--t2) 52%, var(--t3) 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  /* 星星转场的雾面：白天粉色，入夜换成深紫，不然天黑了点个链接闪一屏粉 */
  html[data-face="night"] .vp-veil, html[data-face="night"].vp-stars-in body::after,
  html[data-face="dusk"] .vp-veil, html[data-face="dusk"].vp-stars-in body::after {
    background: linear-gradient(160deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%); }
  html[data-face="night"] .vp-veil::before, html[data-face="dusk"] .vp-veil::before {
    background:
      radial-gradient(40% 35% at 25% 30%, rgba(255, 255, 255, 0.16), transparent 70%),
      radial-gradient(35% 30% at 75% 65%, rgba(226, 166, 196, 0.22), transparent 70%),
      radial-gradient(30% 25% at 60% 20%, rgba(196, 178, 246, 0.2), transparent 70%); }
  html[data-face="night"] .vp-menu-soon, html[data-face="dusk"] .vp-menu-soon { color: var(--muted); }
  html[data-face="night"] .vp-menu-soon small, html[data-face="dusk"] .vp-menu-soon small { color: var(--muted); }
  html[data-face="night"] .vp-menu-fixed .vp-menu-btn, html[data-face="dusk"] .vp-menu-fixed .vp-menu-btn {
    background: var(--card); }
`;

export const CHROME_CSS = `
  main { position: relative; }
  /* 右上角三条杠，展开后三条变成一个叉。字体、间距都写死，不吃所在页面的样式 */
  .vp-menu, .vp-menu * { box-sizing: border-box; font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    letter-spacing: normal; text-transform: none; line-height: 1.4; }
  .vp-menu { position: absolute; top: 14px; right: 12px; z-index: 20; margin: 0; padding: 0; }
  .vp-menu.vp-menu-fixed { position: fixed; top: 10px; right: 10px; z-index: 9990; }
  .vp-menu-btn { list-style: none; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;
    margin: 0; padding: 0; border-radius: 12px; cursor: pointer; color: #7a3e5d; }
  .vp-menu-btn::-webkit-details-marker { display: none; }
  .vp-menu-btn::marker { content: ''; }
  .vp-menu-fixed .vp-menu-btn { background: rgba(255, 253, 251, 0.94); box-shadow: 0 2px 10px rgba(60, 30, 60, 0.16);
    touch-action: none; -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }
  .vp-menu-fixed.vp-dragging .vp-menu-btn { cursor: grabbing; box-shadow: 0 6px 18px rgba(60, 30, 60, 0.28); }
  .vp-menu-btn:active { background: rgba(122, 62, 93, 0.08); }
  .vp-bars { display: grid; gap: 4px; width: 20px; }
  .vp-bars i { display: block; height: 2px; border-radius: 1px; background: currentColor; transition: transform 0.25s ease, opacity 0.2s ease; }
  .vp-menu[open] .vp-bars i:nth-child(1) { transform: translateY(6px) rotate(45deg); }
  .vp-menu[open] .vp-bars i:nth-child(2) { opacity: 0; }
  .vp-menu[open] .vp-bars i:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
  .vp-menu-panel { position: absolute; right: 0; top: 48px; min-width: 10em; padding: 6px; background: #fffdfb;
    border: 1px solid #eadfe6; border-radius: 14px; box-shadow: 0 8px 24px rgba(60, 30, 60, 0.16);
    animation: vp-menu-in 0.2s ease-out; transform-origin: top right; }
  /* 菜单被拖到左半边就往右展开，拖到下半边就往上展开，免得跑出屏幕 */
  .vp-menu.vp-menu-left .vp-menu-panel { right: auto; left: 0; transform-origin: top left; }
  .vp-menu.vp-menu-up .vp-menu-panel { top: auto; bottom: 48px; transform-origin: bottom right; }
  .vp-menu.vp-menu-up.vp-menu-left .vp-menu-panel { transform-origin: bottom left; }
  .vp-menu-panel ul { list-style: none; margin: 0; padding: 0; }
  .vp-menu-panel li { margin: 0; padding: 0; list-style: none; }
  .vp-menu-panel a, .vp-menu-soon { display: flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px;
    font-size: 15px; font-weight: 400; white-space: nowrap; }
  .vp-menu-panel a { color: #2b2233; text-decoration: none; background: none; }
  .vp-menu-panel a:hover, .vp-menu-panel a:focus-visible { background: #f6eef3; }
  .vp-menu-panel a[aria-current="page"] { color: #7a3e5d; font-weight: 600; }
  .vp-menu-panel a[aria-current="page"]::before { content: '✦'; margin-right: 6px; font-size: 12px; color: #b7792f; }
  .vp-menu-soon { justify-content: space-between; gap: 12px; color: #8f8296; cursor: default; }
  .vp-menu-soon small { font-size: 11px; color: #a597ab; }
  .vp-menu-btn:focus-visible, .vp-menu-panel a:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; }
  @keyframes vp-menu-in { from { opacity: 0; transform: translateY(-4px) scale(0.96); } to { opacity: 1; transform: none; } }

  /* 星星转场 */
  html.vp-stars-in body::after { content: ''; position: fixed; inset: 0; z-index: 99998; pointer-events: none;
    background: linear-gradient(160deg, #fde6ee 0%, #f9d4e1 55%, #fbe3ea 100%);
    animation: vp-cover-out 0.4s ease 1.6s forwards; }
  @keyframes vp-cover-out { to { opacity: 0; visibility: hidden; } }
  .vp-veil { position: fixed; inset: 0; z-index: 99999; overflow: hidden; pointer-events: none; opacity: 0;
    background: linear-gradient(160deg, #fde6ee 0%, #f9d4e1 55%, #fbe3ea 100%); transition: opacity 0.35s ease; }
  .vp-veil.on { opacity: 1; pointer-events: auto; }
  .vp-veil.instant { transition: none; }
  .vp-veil::before { content: ''; position: absolute; inset: -20%;
    background:
      radial-gradient(40% 35% at 25% 30%, rgba(255, 255, 255, 0.75), transparent 70%),
      radial-gradient(35% 30% at 75% 65%, rgba(255, 192, 214, 0.7), transparent 70%),
      radial-gradient(30% 25% at 60% 20%, rgba(255, 236, 242, 0.8), transparent 70%);
    animation: vp-veil-drift 2s ease-in-out forwards; }
  @keyframes vp-veil-drift { from { transform: none; } to { transform: translate3d(-3%, 2%, 0) scale(1.06); } }
  .vp-tstar { position: absolute; z-index: 1; width: var(--s); height: var(--s); color: #ffd45c; opacity: 0;
    filter: drop-shadow(0 0 6px rgba(255, 212, 92, 0.65)); animation: vp-tstar 1.1s ease-in-out var(--d) forwards; }
  .vp-tstar svg { display: block; width: 100%; height: 100%; }
  @keyframes vp-tstar {
    0% { opacity: 0; transform: scale(0.3) rotate(-20deg); }
    40% { opacity: 1; transform: scale(1) rotate(0deg); }
    100% { opacity: 0; transform: scale(0.6) rotate(15deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .vp-veil::before, .vp-menu-panel { animation: none; }
    .vp-bars i { transition: none; }
  }
${FACE_CSS}${FACE_PATCH_CSS}`;

// 放在 </body> 前：铺上夜空的星星层，菜单点外面收起，站内链接和菜单里的外部页面走星星转场，固定的菜单可以拖
export const CHROME_SCRIPT = `(function () {
  var KEY = 'vp-stars';
  var SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';
  var root = document.documentElement;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 夜空的星星层：白天 --star 是 0，整层透明；入夜浮上来，在最上面。不挡点击
  if (!document.querySelector('.sky')) {
    var sky = document.createElement('div');
    sky.className = 'sky';
    sky.setAttribute('aria-hidden', 'true');
    document.body.insertBefore(sky, document.body.firstChild);
  }

  document.addEventListener('click', function (e) {
    document.querySelectorAll('[data-menu][open]').forEach(function (m) {
      if (!m.contains(e.target)) m.removeAttribute('open');
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('[data-menu][open]').forEach(function (m) {
      m.removeAttribute('open');
      var s = m.querySelector('summary');
      if (s) s.focus();
    });
  });

  // 固定在屏幕上的菜单（记忆库那页）：按住拖开，松手记住位置；轻点还是开关菜单
  var fixed = document.querySelector('.vp-menu-fixed');
  var handle = fixed && fixed.querySelector('summary');
  if (fixed && handle) {
    var POS_KEY = 'vp-menu-pos';
    var pos = null;
    var place = function (x, y) {
      var w = handle.offsetWidth || 44, h = handle.offsetHeight || 44;
      x = Math.min(Math.max(4, x), Math.max(4, window.innerWidth - w - 4));
      y = Math.min(Math.max(4, y), Math.max(4, window.innerHeight - h - 4));
      pos = { x: x, y: y };
      fixed.style.left = x + 'px';
      fixed.style.top = y + 'px';
      fixed.style.right = 'auto';
      fixed.classList.toggle('vp-menu-left', x + w / 2 < window.innerWidth / 2);
      fixed.classList.toggle('vp-menu-up', y + h / 2 > window.innerHeight / 2);
    };
    try {
      var saved = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (saved && isFinite(saved.x) && isFinite(saved.y)) place(Number(saved.x), Number(saved.y));
    } catch (err) {}
    // 转屏、窗口变小时拉回屏幕里
    window.addEventListener('resize', function () { if (pos) place(pos.x, pos.y); });

    var drag = null, dragged = false;
    handle.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      var r = fixed.getBoundingClientRect();
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
      dragged = false;
      try { handle.setPointerCapture(e.pointerId); } catch (err) {}
    });
    handle.addEventListener('pointermove', function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      var dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      // 挪不到 6 像素算点按，不算拖
      if (!dragged && Math.abs(dx) + Math.abs(dy) < 6) return;
      if (!dragged) { dragged = true; fixed.removeAttribute('open'); fixed.classList.add('vp-dragging'); }
      e.preventDefault();
      place(drag.ox + dx, drag.oy + dy);
    });
    var stop = function (e) {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      fixed.classList.remove('vp-dragging');
      if (dragged && pos) { try { localStorage.setItem(POS_KEY, JSON.stringify(pos)); } catch (err) {} }
    };
    handle.addEventListener('pointerup', stop);
    handle.addEventListener('pointercancel', stop);
    // 拖完松手时浏览器还会补一次点击，别让它把菜单打开
    handle.addEventListener('click', function (e) {
      if (dragged) { e.preventDefault(); dragged = false; }
    }, true);
  }

  function veil(count, step) {
    var v = document.createElement('div');
    v.className = 'vp-veil';
    v.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < count; i++) {
      var s = document.createElement('span');
      s.className = 'vp-tstar';
      s.innerHTML = SVG;
      s.style.setProperty('--s', (12 + Math.random() * 22) + 'px');
      s.style.setProperty('--d', (i * step + Math.random() * 0.05) + 's');
      s.style.left = (6 + Math.random() * 86) + '%';
      s.style.top = (8 + Math.random() * 80) + '%';
      v.appendChild(s);
    }
    document.body.appendChild(v);
    return v;
  }

  // 进场：盖着的那层换成带星星的雾面，闪几下再淡出
  if (root.classList.contains('vp-stars-in')) {
    try { sessionStorage.removeItem(KEY); } catch (err) {}
    var arrive = veil(reduce ? 0 : 6, 0.08);
    arrive.classList.add('instant', 'on');
    root.classList.remove('vp-stars-in');
    void arrive.offsetWidth;
    arrive.classList.remove('instant');
    setTimeout(function () {
      arrive.classList.remove('on');
      setTimeout(function () { arrive.remove(); }, 400);
    }, reduce ? 60 : 650);
  }

  // 离场：先盖上雾面、星星闪出来，再跳。站外链接只有带 data-stars 的（菜单里的外部页面）才走
  var leaving = false;
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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
    if (leaving) return;
    leaving = true;
    // 进场动画只给本项目的页面留记号。同域名下的别的程序（比如 /music）不认这个记号，留着会在之后乱触发
    if (same && !outside) { try { sessionStorage.setItem(KEY, '1'); } catch (err) {} }
    var leave = veil(reduce ? 0 : 12, 0.06);
    void leave.offsetWidth;
    leave.classList.add('on');
    setTimeout(function () { location.href = url.href; }, reduce ? 150 : 900);
    // 过了好一会儿还在这一页（比如点的是下载链接，页面没换），就把雾面撕掉，不然会一直盖着
    setTimeout(function () {
      leaving = false;
      try { sessionStorage.removeItem(KEY); } catch (err) {}
      leave.classList.remove('on');
      setTimeout(function () { leave.remove(); }, 400);
    }, 6000);
  });

  // 从后退缓存回来时把盖着的东西清掉
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove('vp-stars-in');
    try { sessionStorage.removeItem(KEY); } catch (err) {}
    document.querySelectorAll('.vp-veil').forEach(function (v) { v.remove(); });
  });
})();`;
