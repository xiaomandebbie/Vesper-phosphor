// 底栅导航，以及顺带把顶上那一套收掉。
//
// 小满 2026-10-30：「不要大标题和右上角导览了，只需要左上角返回键」
//
// 有了底栅，右上角那个三条杠就是多余的；大标题占半屏，而底栅已经标明你在哪。
// 主页是例外：那个「晨暮星 / Vesper✨Phosphor」是整个东西的名字，下面还挂着
// 心绪和唤醒时间，去掉就空了。
//
// ── 为什么用脚本注入而不改十几个文件 ──
//
// 现有页面每个都有自己的 layout()，改一十几处每处都是一次出错机会。
// 所以底栅、隐标题、返回键都走 CHROME_CSS / CHROME_SCRIPT，一处改全部生效。
// 转发过来的页（/memory/、/music/、/books）不跑这段，所以那几处保持原样——
// 它们是别人的前端，强塞东西进去反而挡他们自己的按钮。
//
// 图标用内联 SVG 不用 emoji：emoji 在不同系统上形状和容边跑得很乱，
// 而且没法跟着主题色走。

const TABS = [
  {
    href: '/chat',
    label: '\u804a\u5929',
    icon:
      '<path d="M12 4c-4.4 0-8 2.8-8 6.3 0 2 1.2 3.8 3 5-.1 1-.5 2-1.2 2.9 1.5-.3 2.8-1 3.7-1.8.8.2 1.6.3 2.5.3 4.4 0 8-2.8 8-6.4S16.4 4 12 4z"/>',
  },
  {
    href: '/memories',
    label: '\u8bb0\u5fc6',
    icon: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
  },
  {
    href: '/home',
    label: '\u4e3b\u9875',
    icon: '<path d="M12 3.8l8 6.4V20h-5.6v-5.2H9.6V20H4v-9.8z"/>',
  },
  {
    href: '/discover',
    label: '\u53d1\u73b0',
    icon:
      '<path d="M12 3.6a8.4 8.4 0 100 16.8 8.4 8.4 0 000-16.8zm3.4 5l-2 4.6-4.6 2 2-4.6z"/>',
  },
  {
    href: '/me',
    label: '\u4e2a\u4eba',
    icon:
      '<path d="M12 4.2a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2zM5.2 19.8c0-3.4 3-5.4 6.8-5.4s6.8 2 6.8 5.4z"/>',
  },
];

// 哪些路径算在某个栅目下面——进了动态页，底栅上该亮「发现」，
// 返回键也知道没有历史时该退到哪里。
const UNDER = {
  '/discover': ['/moments', '/diary', '/dreams', '/music', '/bar', '/drives', '/books', '/wallet'],
  '/me': ['/logs', '/moments/profile', '/moments/favorites'],
  '/memories': ['/memory'],
};

export function tabOf(pathname) {
  const p = String(pathname || '');
  for (const t of TABS) if (p === t.href) return t.href;
  for (const [tab, list] of Object.entries(UNDER)) {
    if (list.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) return tab;
  }
  return '';
}

export function renderTabs(current) {
  const here = tabOf(current) || current;
  const items = TABS.map((t) => {
    const on = t.href === here;
    return (
      `<a class="vp-tab${on ? ' on' : ''}" href="${t.href}" data-no-stars${on ? ' aria-current="page"' : ''}>` +
      `<svg viewBox="0 0 24 24" aria-hidden="true">${t.icon}</svg>` +
      `<span>${t.label}</span></a>`
    );
  }).join('');
  return `<nav class="vp-tabs" data-tabs aria-label="\u5bfc\u822a">${items}</nav>`;
}

// 底栅、返回键，以及把三条杠和大标题收掉的那几行。
// 类名带 vp- 前缀、字体和间距写死，不吃所在页面的样式。
export const TABS_CSS = `
  .vp-tabs, .vp-tabs *, .vp-back { box-sizing: border-box;
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; letter-spacing: normal; }
  .vp-tabs { position: fixed; z-index: 90; left: 50%; transform: translateX(-50%);
    bottom: calc(10px + env(safe-area-inset-bottom, 0px));
    display: flex; align-items: stretch; gap: 2px; width: calc(100% - 24px); max-width: 420px;
    padding: 6px; background: rgba(255, 253, 251, 0.94); backdrop-filter: blur(12px);
    border: 1px solid #eadfe6; border-radius: 22px; box-shadow: 0 6px 22px rgba(60, 30, 60, 0.13); }
  .vp-tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 2px; min-height: 48px; padding: 4px 2px; border-radius: 16px;
    color: #8f8296; text-decoration: none; font-size: 11px; line-height: 1.2; }
  .vp-tab svg { width: 22px; height: 22px; fill: currentColor; }
  .vp-tab.on { color: #7a3e5d; background: #f6eef3; font-weight: 600; }
  .vp-tab:active { background: rgba(122, 62, 93, 0.07); }
  .vp-tab:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 1px; }
  body.vp-has-tabs main { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important; }

  /* 右上角那个三条杠：底栅替代了它。
     转发过来的页面（.vp-menu-fixed，比如记忆库）留着——那几页没有底栅，
     把菜单也藏了就出不来了。 */
  .vp-menu:not(.vp-menu-fixed) { display: none !important; }

  /* 主页以外都不要那个大标题。各页的标题块类名不完全一致，
     常见的这几种都盖上；盖不到的最多是标题还在，不致命。 */
  body.vp-no-hero .hero,
  body.vp-no-hero > main > header.hero,
  body.vp-no-hero .page-hero { display: none !important; }
  body.vp-no-hero main { padding-top: calc(52px + env(safe-area-inset-top, 0px)) !important; }

  /* 左上角返回键，只给二级页面 */
  .vp-back { position: fixed; z-index: 92;
    top: calc(12px + env(safe-area-inset-top, 0px)); left: 12px;
    display: flex; align-items: center; justify-content: center; gap: 4px;
    min-width: 44px; height: 38px; padding: 0 13px 0 10px; border: 1px solid #eadfe6;
    border-radius: 999px; background: rgba(255, 253, 251, 0.94); backdrop-filter: blur(10px);
    color: #7a3e5d; font-size: 13px; text-decoration: none;
    box-shadow: 0 2px 10px rgba(60, 30, 60, 0.12); }
  .vp-back svg { width: 16px; height: 16px; fill: currentColor; }
  .vp-back:active { background: #f6eef3; }
  .vp-back:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; }

  html[data-face="night"] .vp-tabs, html[data-face="dusk"] .vp-tabs,
  html[data-face="night"] .vp-back, html[data-face="dusk"] .vp-back {
    background: rgba(60, 47, 82, 0.92); border-color: #4b3d63; }
  html[data-face="night"] .vp-tab, html[data-face="dusk"] .vp-tab { color: #9a8ead; }
  html[data-face="night"] .vp-tab.on, html[data-face="dusk"] .vp-tab.on {
    color: #ecb0ce; background: rgba(236, 176, 206, 0.14); }
  html[data-face="night"] .vp-back, html[data-face="dusk"] .vp-back { color: #ecb0ce; }
`;

// 跑在 CHROME_SCRIPT 末尾：补底栅、按页面层级决定要不要返回键。
export const TABS_SCRIPT = `(function () {
  var TABS = ${JSON.stringify(TABS)};
  var UNDER = ${JSON.stringify(UNDER)};
  var path = location.pathname;

  var here = '';
  for (var i = 0; i < TABS.length; i++) if (path === TABS[i].href) here = TABS[i].href;
  var primary = !!here;
  if (!here) {
    Object.keys(UNDER).forEach(function (tab) {
      UNDER[tab].forEach(function (p) {
        if (path === p || path.indexOf(p + '/') === 0) here = tab;
      });
    });
  }

  // 底栅：页面自己渲染过就不重复插
  if (!document.querySelector('[data-tabs]')) {
    var nav = document.createElement('nav');
    nav.className = 'vp-tabs';
    nav.setAttribute('data-tabs', '');
    nav.setAttribute('aria-label', '\u5bfc\u822a');
    nav.innerHTML = TABS.map(function (t) {
      var on = t.href === here;
      return '<a class="vp-tab' + (on ? ' on' : '') + '" href="' + t.href + '" data-no-stars'
        + (on ? ' aria-current="page"' : '') + '>'
        + '<svg viewBox="0 0 24 24" aria-hidden="true">' + t.icon + '</svg>'
        + '<span>' + t.label + '</span></a>';
    }).join('');
    document.body.appendChild(nav);
  }
  document.body.classList.add('vp-has-tabs');

  // 主页留着那个大标题（它是整个东西的名字，下面还挂着心绪和唤醒时间）
  if (path !== '/home') document.body.classList.add('vp-no-hero');

  // 返回键只给二级页面：底栅那五页本来就是平的，没「回去」这回事
  if (!primary && !document.querySelector('[data-back]')) {
    var fallback = here || '/home';
    var back = document.createElement('a');
    back.className = 'vp-back';
    back.setAttribute('data-back', '');
    back.setAttribute('data-no-stars', '');
    back.setAttribute('href', fallback);
    back.setAttribute('aria-label', '\u8fd4\u56de');
    back.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M14.6 5.4l-6.6 6.6 6.6 6.6 1.5-1.5-5.1-5.1 5.1-5.1z"/></svg>'
      + '<span>\u8fd4\u56de</span>';
    back.addEventListener('click', function (e) {
      // 有来处就退回去；直接打开这一页的（比如从主屏幕）就回所属栅目
      if (window.history.length > 1) {
        e.preventDefault();
        window.history.back();
      }
    });
    document.body.appendChild(back);
  }
})();`;
