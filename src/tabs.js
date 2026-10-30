// 底栅导航：聊天、记忆、主页、发现、个人。
//
// 小满 2026-10-30：「导航页面要下栅目那种」
//
// 主页只留唤醒时间；动作卡片进聊天；动态进发现；后台和自定义进个人。
// 记忆先把 Ombre Brain 当成其中一条（以后还会装别的库）。
//
// ── 为什么用脚本注入而不改十几个文件 ──
//
// 现有页面（动态、星星罐、共读、小酒馆…）每个都有自己的 layout()，
// 改一十几处每处都是一次出错机会。所以底栅跟 PWA 那套一个做法：
// CHROME_SCRIPT 里跑一段，运行时往 body 里插。新页自己服务端渲染一份（快一点），
// 脚本发现已经有了就不重复插。
//
// 图标用内联 SVG，不用 emoji：emoji 在不同系统上形状和容边跑得很乱，
// 而且没法跟着主题色走。

const TABS = [
  {
    href: '/chat',
    label: '\u804a\u5929',
    // 气泡
    icon:
      '<path d="M12 4c-4.4 0-8 2.8-8 6.3 0 2 1.2 3.8 3 5-.1 1-.5 2-1.2 2.9 1.5-.3 2.8-1 3.7-1.8.8.2 1.6.3 2.5.3 4.4 0 8-2.8 8-6.4S16.4 4 12 4z"/>',
  },
  {
    href: '/memories',
    label: '\u8bb0\u5fc6',
    // 四角星
    icon: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
  },
  {
    href: '/home',
    label: '\u4e3b\u9875',
    // 屋顶
    icon: '<path d="M12 3.8l8 6.4V20h-5.6v-5.2H9.6V20H4v-9.8z"/>',
  },
  {
    href: '/discover',
    label: '\u53d1\u73b0',
    // 指南针
    icon:
      '<path d="M12 3.6a8.4 8.4 0 100 16.8 8.4 8.4 0 000-16.8zm3.4 5l-2 4.6-4.6 2 2-4.6z"/>',
  },
  {
    href: '/me',
    label: '\u4e2a\u4eba',
    // 人
    icon:
      '<path d="M12 4.2a3.6 3.6 0 100 7.2 3.6 3.6 0 000-7.2zM5.2 19.8c0-3.4 3-5.4 6.8-5.4s6.8 2 6.8 5.4z"/>',
  },
];

// 哪些路径算在某个栅目下面——进了动态页，底栅上该亮「发现」。
const UNDER = {
  '/discover': ['/moments', '/diary', '/dreams', '/music', '/bar', '/drives', '/books', '/wallet'],
  '/me': ['/logs', '/moments/profile'],
  '/memories': ['/memory'],
};

// 当前路径属于哪个栅目。认不出就哪个都不亮。
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

// 底栅本身的样式。和 page-chrome 一个路子：类名带 vp- 前缀，
// 字体和间距写死，不吃所在页面的样式。
export const TABS_CSS = `
  .vp-tabs, .vp-tabs * { box-sizing: border-box;
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
  /* 正文别被底栅压住。各页 main 的 padding-bottom 不一样，这儿统一抬一抬 */
  body.vp-has-tabs main { padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px)) !important; }
  html[data-face="night"] .vp-tabs, html[data-face="dusk"] .vp-tabs {
    background: rgba(60, 47, 82, 0.92); border-color: #4b3d63; }
  html[data-face="night"] .vp-tab, html[data-face="dusk"] .vp-tab { color: #9a8ead; }
  html[data-face="night"] .vp-tab.on, html[data-face="dusk"] .vp-tab.on {
    color: #ecb0ce; background: rgba(236, 176, 206, 0.14); }
`;

// 跑在 CHROME_SCRIPT 末尾：页面自己没渲染底栅的话，运行时补一个。
// 转发过来的页（/memory/、/music/）不跑这段，所以那两处没有底栅——
// 它们是别人的页面，强塞进去反而挡东西。
export const TABS_SCRIPT = `(function () {
  if (document.querySelector('[data-tabs]')) { document.body.classList.add('vp-has-tabs'); return; }
  var TABS = ${JSON.stringify(TABS)};
  var UNDER = ${JSON.stringify(UNDER)};
  var path = location.pathname;
  var here = '';
  for (var i = 0; i < TABS.length; i++) if (path === TABS[i].href) here = TABS[i].href;
  if (!here) {
    Object.keys(UNDER).forEach(function (tab) {
      UNDER[tab].forEach(function (p) {
        if (path === p || path.indexOf(p + '/') === 0) here = tab;
      });
    });
  }
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
  document.body.classList.add('vp-has-tabs');
})();`;
