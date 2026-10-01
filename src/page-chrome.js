// 几个页面共用的外框：右上角的三条杠菜单，以及换页、换日期时的星星转场。
// moments-page.js（动态页、自定义页）和 drives-page.js（心绪页）都从这里拿，改一处几个页面一起变。
//
// 星星转场：点站内链接时先盖上一层粉色雾面，星星一颗颗闪出来，再跳过去；
// 新页面打开时先盖着，星星再闪几下后淡出。系统开了「减弱动态效果」就只淡入淡出。
// 菜单里的外部页面（日记、记忆库）离开时也走转场；那边不是本项目的页面，所以没有进场动画。
// 没有 JavaScript 时链接照常跳，没有转场。表单提交（留言、点赞）不走转场。

const env = (k) => String(process.env[k] ?? '').trim();

// 外部地址只放行 http(s)，填错了就当没填
function externalUrl(k) {
  const v = env(k);
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
}

function escapeAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// 菜单入口。外部页面的地址在 .env 里配（NAV_DIARY_URL、NAV_MEMORY_URL），没配就显示成灰色、点不了。
// 音乐、论坛还没有页面，先占个位置；做好了给它一个 href 就行
function navItems() {
  return [
    { href: '/moments', label: '回到主页' },
    { href: externalUrl('NAV_DIARY_URL'), label: '日记', external: true, note: '没配置' },
    { href: '/drives', label: '心绪' },
    { label: '音乐', note: '还没做' },
    { label: '论坛', note: '还没做' },
    { href: externalUrl('NAV_MEMORY_URL'), label: '记忆库', external: true, note: '没配置' },
    { href: '/moments/profile', label: '自定义' },
  ];
}

// 右上角三条杠。<details> 本身就能展开收起，没有 JavaScript 也能用
export function renderMenu(current) {
  const items = navItems()
    .map((item) => {
      if (!item.href) {
        return `<li><span class="menu-soon" aria-disabled="true">${item.label}<small>${item.note || '还没做'}</small></span></li>`;
      }
      const here = !item.external && item.href === current;
      const attrs = item.external ? ' data-stars rel="noopener"' : here ? ' aria-current="page"' : '';
      return `<li><a href="${escapeAttr(item.href)}"${attrs}>${item.label}</a></li>`;
    })
    .join('');
  return `<details class="menu" data-menu>
    <summary class="menu-btn" aria-label="菜单"><span class="bars" aria-hidden="true"><i></i><i></i><i></i></span></summary>
    <nav class="menu-panel" aria-label="页面"><ul>${items}</ul></nav>
  </details>`;
}

// 放在 <head> 里最先跑：上一页是点链接跳过来的，就先把整页盖住，免得内容闪一下才盖上转场
export const HEAD_SCRIPT = "try{if(sessionStorage.getItem('vp-stars'))document.documentElement.classList.add('stars-in')}catch(e){}";

export const CHROME_CSS = `
  main { position: relative; }
  /* 右上角三条杠，展开后三条变成一个叉 */
  .menu { position: absolute; top: 14px; right: 12px; z-index: 20; }
  .menu-btn { list-style: none; display: flex; align-items: center; justify-content: center; width: 44px; height: 44px;
    border-radius: 12px; cursor: pointer; color: #7a3e5d; }
  .menu-btn::-webkit-details-marker { display: none; }
  .menu-btn:active { background: rgba(122, 62, 93, 0.08); }
  .bars { display: grid; gap: 4px; width: 20px; }
  .bars i { display: block; height: 2px; border-radius: 1px; background: currentColor; transition: transform 0.25s ease, opacity 0.2s ease; }
  .menu[open] .bars i:nth-child(1) { transform: translateY(6px) rotate(45deg); }
  .menu[open] .bars i:nth-child(2) { opacity: 0; }
  .menu[open] .bars i:nth-child(3) { transform: translateY(-6px) rotate(-45deg); }
  .menu-panel { position: absolute; right: 0; top: 48px; min-width: 10em; padding: 6px; background: #fffdfb;
    border: 1px solid #eadfe6; border-radius: 14px; box-shadow: 0 8px 24px rgba(60, 30, 60, 0.16);
    animation: menu-in 0.2s ease-out; transform-origin: top right; }
  .menu-panel ul { list-style: none; margin: 0; padding: 0; }
  .menu-panel a, .menu-soon { display: flex; align-items: center; min-height: 44px; padding: 0 14px; border-radius: 10px;
    font-size: 15px; white-space: nowrap; }
  .menu-panel a { color: #2b2233; text-decoration: none; }
  .menu-panel a:hover, .menu-panel a:focus-visible { background: #f6eef3; }
  .menu-panel a[aria-current="page"] { color: #7a3e5d; font-weight: 600; }
  .menu-panel a[aria-current="page"]::before { content: '✦'; margin-right: 6px; font-size: 12px; color: #b7792f; }
  .menu-soon { justify-content: space-between; gap: 12px; color: #8f8296; cursor: default; }
  .menu-soon small { font-size: 11px; color: #a597ab; }
  .menu-btn:focus-visible, .menu-panel a:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; }
  @keyframes menu-in { from { opacity: 0; transform: translateY(-4px) scale(0.96); } to { opacity: 1; transform: none; } }

  /* 星星转场 */
  html.stars-in body::after { content: ''; position: fixed; inset: 0; z-index: 999; pointer-events: none;
    background: linear-gradient(160deg, #fde6ee 0%, #f9d4e1 55%, #fbe3ea 100%);
    animation: cover-out 0.4s ease 1.6s forwards; }
  @keyframes cover-out { to { opacity: 0; visibility: hidden; } }
  .star-veil { position: fixed; inset: 0; z-index: 1000; overflow: hidden; pointer-events: none; opacity: 0;
    background: linear-gradient(160deg, #fde6ee 0%, #f9d4e1 55%, #fbe3ea 100%); transition: opacity 0.35s ease; }
  .star-veil.on { opacity: 1; pointer-events: auto; }
  .star-veil.instant { transition: none; }
  .star-veil::before { content: ''; position: absolute; inset: -20%;
    background:
      radial-gradient(40% 35% at 25% 30%, rgba(255, 255, 255, 0.75), transparent 70%),
      radial-gradient(35% 30% at 75% 65%, rgba(255, 192, 214, 0.7), transparent 70%),
      radial-gradient(30% 25% at 60% 20%, rgba(255, 236, 242, 0.8), transparent 70%);
    animation: veil-drift 2s ease-in-out forwards; }
  @keyframes veil-drift { from { transform: none; } to { transform: translate3d(-3%, 2%, 0) scale(1.06); } }
  .tstar { position: absolute; z-index: 1; width: var(--s); height: var(--s); color: #ffd45c; opacity: 0;
    filter: drop-shadow(0 0 6px rgba(255, 212, 92, 0.65)); animation: tstar 1.1s ease-in-out var(--d) forwards; }
  .tstar svg { display: block; width: 100%; height: 100%; }
  @keyframes tstar {
    0% { opacity: 0; transform: scale(0.3) rotate(-20deg); }
    40% { opacity: 1; transform: scale(1) rotate(0deg); }
    100% { opacity: 0; transform: scale(0.6) rotate(15deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    .star-veil::before, .menu-panel { animation: none; }
    .bars i { transition: none; }
  }
`;

// 放在 </body> 前：菜单点外面收起，站内链接和菜单里的外部页面走星星转场
export const CHROME_SCRIPT = `(function () {
  var KEY = 'vp-stars';
  var SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';
  var root = document.documentElement;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

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

  function veil(count, step) {
    var v = document.createElement('div');
    v.className = 'star-veil';
    v.setAttribute('aria-hidden', 'true');
    for (var i = 0; i < count; i++) {
      var s = document.createElement('span');
      s.className = 'tstar';
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
  if (root.classList.contains('stars-in')) {
    try { sessionStorage.removeItem(KEY); } catch (err) {}
    var arrive = veil(reduce ? 0 : 6, 0.08);
    arrive.classList.add('instant', 'on');
    root.classList.remove('stars-in');
    void arrive.offsetWidth;
    arrive.classList.remove('instant');
    setTimeout(function () {
      arrive.classList.remove('on');
      setTimeout(function () { arrive.remove(); }, 400);
    }, reduce ? 60 : 650);
  }

  // 离场：先盖上雾面、星星闪出来，再跳。站外链接只有带 data-stars 的（菜单里的日记、记忆库）才走
  var leaving = false;
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest ? e.target.closest('a[href]') : null;
    if (!a || a.target || a.hasAttribute('download') || a.hasAttribute('data-no-stars')) return;
    var raw = a.getAttribute('href') || '';
    if (raw.charAt(0) === '#') return;
    var url;
    try { url = new URL(a.href, location.href); } catch (err) { return; }
    var same = url.origin === location.origin;
    if (!same && !a.hasAttribute('data-stars')) return;
    if (same && url.pathname === location.pathname && url.search === location.search && url.hash) return;
    e.preventDefault();
    if (leaving) return;
    leaving = true;
    if (same) { try { sessionStorage.setItem(KEY, '1'); } catch (err) {} }
    var leave = veil(reduce ? 0 : 12, 0.06);
    void leave.offsetWidth;
    leave.classList.add('on');
    setTimeout(function () { location.href = url.href; }, reduce ? 150 : 900);
  });

  // 从后退缓存回来时把盖着的东西清掉
  window.addEventListener('pageshow', function (e) {
    if (!e.persisted) return;
    leaving = false;
    root.classList.remove('stars-in');
    try { sessionStorage.removeItem(KEY); } catch (err) {}
    document.querySelectorAll('.star-veil').forEach(function (v) { v.remove(); });
  });
})();`;
