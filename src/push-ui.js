// 通知这一半：个人页那一行入口、设置页 /me/push、service worker、三条接口。
//
// 推送本体（VAPID、订阅表、发送）在 push.js。
//
// ── 为什么 service worker 在这儿，不在 pwa.js（2026-11-05）──
//
// 她点「打开」时报 `sw.js load failed`。查出来的原因：
// pwa.js 里有 /app/sw.js 的路由，但 registerPwaRoutes(app) 在 vesper.js 里
// 从来没被调用过——整个 pwa.js 是死代码。手机上那个 PWA 是 app-icon.js
// 在根路径提供的 manifest 装的，和它无关。
//
// 不去补挂 registerPwaRoutes：那套还带一个自己的 /login，挂上去会和
// session-login.js 那一套打架，而现在登录是好的——为了一个 sw.js 去动
// 登录链路不值。所以 service worker 这边自己发一份。
//
// 免认证：里面没有任何秘密，而且浏览器注册 service worker 时未必带得上 cookie。
//
// ── 卡在「正在开…」的那次（2026-11-05）──
//
// 上一版点「打开」之后屏幕上就停在「正在开…」，不报错也不往下走。
// 两个原因，都改了：
//
//   1. iOS 上 Notification.requestPermission() 的 Promise 形式有时不 resolve
//      （WebKit 早期只有 callback 版，这两年才补的 Promise）。现在两种都接，
//      谁先回算谁，再加一道超时读 Notification.permission 兜底。
//
//   2. 每一步没有进度。卡住时一点信息都没有，只能猜——这是真正的问题。
//      现在问权限、装 sw、要订阅、存服务器四步各自报一句，各自带超时。
//
// ── 外观：一行，点进去改 ──
//
// 她说「要和其他外观一致，点进去更改」。所以个人页上只是一行带 › 的条目，
// 和后台日志、收藏用同一套 .row 样式；开关、那两段说明、试一条全挪进 /me/push。
//
// ── 权限只弹一次 ──
//
// iOS 上拒了就得进系统设置里手动开，网页再调也不会再弹。所以只在她真的
// 点那个开关时弹，而且弹之前先把「这次没戏」的情况（不是 PWA、不是 HTTPS）说清楚。
//
// iOS 的 Web Push 只在 standalone 模式下有效，Safari 标签页里永远收不到。

import { isPushConfigured, publicKey, countSubs, saveSub, dropSub, dropAllSubs, sendPush } from './push.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/me/push';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// ── 个人页上那一行 ──
// 用 me-page.js 自己的 .row 类名，所以和后台日志、收藏长得一样。
// 这边不带任何自己的样式——要的就是跟那边一致。
export function renderPushRow() {
  const configured = isPushConfigured();
  const n = configured ? countSubs() : 0;
  const what = !configured
    ? '服务器还没配 VAPID 密钥'
    : n
      ? `已经开着，${n} 台设备收得到`
      : `${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知`;
  return `<a class="row" href="${PREFIX}">
    <div class="row-in">
      <span class="row-name">通知</span>
      <span class="row-what">${what}</span>
    </div>
    ${configured && n ? '<span class="row-val">已开启</span>' : ''}
    <span class="row-go" aria-hidden="true">\u203a</span>
  </a>`;
}

// ── service worker ──
// 只有推送那两个监听，不缓存任何东西——这几个页面全是实时的，
// 缓存正文只会让你看到旧的。它存在的唯一理由是：iOS 要求有
// service worker 才能收 Web Push。
const SW = `// 晨暮星的 service worker。只管推送，不缓存页面。
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// 收到推送。payload 是 push.js 发的 { title, body, url, tag }。
// 解不出来也要弹一条：userVisibleOnly 说好了每条推送都要有可见通知，
// 不弹的话浏览器记一笔，次数多了就把订阅废掉。
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = {}; }
  e.waitUntil(
    self.registration.showNotification(d.title || '晨暮星', {
      body: d.body || '',
      icon: '/apple-touch-icon.png',
      badge: '/apple-touch-icon.png',
      tag: d.tag || undefined,
      renotify: Boolean(d.tag),
      data: { url: d.url || '/home' },
    })
  );
});

// 点通知：先找已经开着的窗口，没有才新开。
// 不这样的话每条通知点一下就多一个 PWA 窗口。
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/home';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if ('navigate' in c) c.navigate(target).catch(() => {});
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
`;

// ── 设置页的脚本 ──

const PAGE_SCRIPT = `(function () {
  var toggle = document.querySelector('[data-push-toggle]');
  if (!toggle) return;
  var acts = document.querySelector('[data-push-acts]');
  var status = document.querySelector('[data-push-status]');
  var what = document.querySelector('[data-push-what]');
  var testBtn = document.querySelector('[data-push-test]');
  var offBtn = document.querySelector('[data-push-off]');
  var KEY = '${isPushConfigured() ? publicKey() : ''}';

  function say(msg) { if (status) status.textContent = msg || ''; }

  // 装到主屏幕了没有。iOS 用 navigator.standalone，其他用 display-mode
  function isStandalone() {
    if (window.navigator.standalone === true) return true;
    try { return window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  }

  // base64url → Uint8Array。applicationServerKey 要这个形状
  function toKey(b64) {
    var pad = '='.repeat((4 - (b64.length % 4)) % 4);
    var s = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
    var raw = atob(s);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  // 哪一步挂住都要能看见。上一版卡在「正在开…」一点信息没有，只能猜。
  function withTimeout(p, ms, what) {
    return Promise.race([
      p,
      new Promise(function (_, reject) {
        setTimeout(function () { reject(new Error(what + '超过 ' + Math.round(ms / 1000) + ' 秒没回应')); }, ms);
      }),
    ]);
  }

  // iOS 上这个函数的 Promise 形式有时不 resolve（WebKit 早期只有 callback 版）。
  // 两种都接，谁先回算谁；都不回就超时读一次 Notification.permission——
  // 弹窗点过之后那个值是准的，就算回调丢了也能救回来。
  function askPermission() {
    return new Promise(function (resolve) {
      var done = false;
      function finish(p) {
        if (done) return;
        done = true;
        resolve(p || Notification.permission);
      }
      setTimeout(function () { finish(Notification.permission); }, 12000);
      try {
        var r = Notification.requestPermission(finish);
        if (r && typeof r.then === 'function') r.then(finish).catch(function () { finish(); });
      } catch (e) {
        finish();
      }
    });
  }

  toggle.addEventListener('click', function () {
    // 先把没戏的情况说清楚，不动权限
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      say('这个浏览器不支持网页推送。');
      return;
    }
    if (location.protocol !== 'https:') {
      say('推送要 HTTPS。现在这个地址是 http，收不到。');
      return;
    }
    if (!isStandalone()) {
      say('先把站点装到主屏幕（分享 → 添加到主屏幕），从那个图标进来再点这里。Safari 标签页里 iOS 不发推送。');
      return;
    }
    if (Notification.permission === 'denied') {
      say('通知被拒过了，网页这边弹不出来。去 设置 → 通知 → 晨暮星 里打开。');
      return;
    }
    if (!KEY) {
      say('服务器没把公钥发下来。看一下 .env 里的 VAPID_PUBLIC_KEY，改完要 pm2 restart vesper --update-env。');
      return;
    }

    toggle.disabled = true;
    say('在问系统要不要通知权限…');

    askPermission()
      .then(function (perm) {
        if (perm !== 'granted') {
          toggle.disabled = false;
          say(perm === 'denied'
            ? '你点了不允许。这个系统只问一次，要改得去 设置 → 通知 → 晨暮星。'
            : '还没拿到权限（' + perm + '）。再点一下试试。');
          return null;
        }
        say('权限有了，正在装 service worker…');
        // 不等 ready：它等的是「有 worker 真正接管了这个页面」，
        // 而订阅只要 registration 就够。旧 worker 卡着不退时
        // ready 永远等不到（2026-11-05 她这台就是）。
        return withTimeout(
          navigator.serviceWorker.register('/app/sw.js'),
          20000,
          'service worker '
        );
      })
      .then(function (reg) {
        if (!reg) return null;
        say('service worker 好了，正在向苹果要一个订阅…');
        return withTimeout(
          reg.pushManager.getSubscription().then(function (old) {
            if (old) return old;
            return reg.pushManager.subscribe({
              userVisibleOnly: true,
              applicationServerKey: toKey(KEY),
            });
          }),
          25000,
          '苹果那边'
        );
      })
      .then(function (sub) {
        if (!sub) return null;
        say('订阅拿到了，正在存到服务器…');
        var j = sub.toJSON();
        return post('/push/subscribe', {
          endpoint: j.endpoint,
          p256dh: j.keys && j.keys.p256dh,
          auth: j.keys && j.keys.auth,
        });
      })
      .then(function (res) {
        if (!res) return;
        if (res.error) {
          toggle.disabled = false;
          say('存不下来：' + res.error);
          return;
        }
        toggle.textContent = '已开启';
        toggle.disabled = false;
        if (acts) acts.hidden = false;
        if (what) what.textContent = '已经开着' + (res.count ? '，' + res.count + ' 台设备收得到' : '');
        say('开好了。点「试一条」看看能不能收到。');
      })
      .catch(function (err) {
        toggle.disabled = false;
        say('没开成：' + (err && err.message ? err.message : String(err)));
      });
  });

  if (testBtn) {
    testBtn.addEventListener('click', function () {
      testBtn.disabled = true;
      say('发了，等一下…');
      post('/push/test', {})
        .then(function (r) {
          testBtn.disabled = false;
          if (r.error) return say('没发成：' + r.error);
          if (r.skipped) return say('没发：' + r.skipped);
          say('发给了 ' + (r.sent || 0) + ' 台设备' + (r.gone ? '，清了 ' + r.gone + ' 个死订阅' : '') + '。');
        })
        .catch(function (err) {
          testBtn.disabled = false;
          say('没发成：' + (err && err.message ? err.message : String(err)));
        });
    });
  }

  if (offBtn) {
    offBtn.addEventListener('click', function () {
      offBtn.disabled = true;
      // 两边都要撤：浏览器这边退订，服务器那边删记录
      Promise.resolve(navigator.serviceWorker.getRegistration('/app/sw.js'))
        .then(function (reg) { return reg ? reg.pushManager.getSubscription() : null; })
        .then(function (sub) {
          var ep = sub ? sub.endpoint : '';
          var p = sub ? sub.unsubscribe().catch(function () {}) : Promise.resolve();
          return p.then(function () { return post('/push/unsubscribe', { endpoint: ep }); });
        })
        .then(function () {
          offBtn.disabled = false;
          toggle.textContent = '打开';
          toggle.disabled = false;
          if (acts) acts.hidden = true;
          if (what) what.textContent = '${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知';
          say('关了。系统那个权限还在，以后再打开不用再问一次。');
        })
        .catch(function (err) {
          offBtn.disabled = false;
          say('没关成：' + (err && err.message ? err.message : String(err)));
        });
    });
  }
})();`;

// ── 设置页 ──
// 样式照抄个人页和纪念日设置页，这样点进来不像换了个地方。

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>通知 · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}
  :root { --ink: #252525; --muted: #5e5e5e; --accent: #4d4d4d; --gold: #818181;
    --card: #fdfdfd; --card-soft: #f2f2f2; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 18px; }
  .title { margin: 0; font-size: 24px; font-weight: 200; letter-spacing: 0.28em; padding-left: 0.28em;
    color: #3a3a3a; }
  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
  .row-in { flex: 1; min-width: 0; }
  .row-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .row-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .row-note { flex: none; font-size: 11px; color: #a0a0a0; border: 1px solid var(--line);
    border-radius: 999px; padding: 1px 9px; }
  button { min-height: 36px; padding: 0 16px; border: 0; border-radius: 11px;
    background: var(--accent); color: #fff; font-size: 13px; cursor: pointer; }
  button:active { opacity: 0.85; }
  button[disabled] { opacity: 0.5; cursor: default; }
  button.ghost { background: none; color: var(--accent); border: 1px solid var(--line); }
  .status { margin: 12px 2px 0; min-height: 1.3em; font-size: 13px; line-height: 1.6; color: var(--accent); }
  .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
  .acts[hidden] { display: none; }
  .hint { margin: 14px 2px 0; font-size: 12px; line-height: 1.75; color: var(--muted); }
  .hint code { padding: 1px 5px; border-radius: 5px; font-size: 11.5px; background: var(--card-soft); }
  .back { display: inline-flex; align-items: center; min-height: 44px; margin-top: 18px;
    font-size: 13px; color: var(--accent); text-decoration: none; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
</style>
</head>
<body><main>${renderMenu('/me')}${body}</main>
${renderTabs('/me')}
<script>${PAGE_SCRIPT}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

function settingsPage() {
  const head = `<header class="hero"><h1 class="title">通知</h1></header>`;

  if (!isPushConfigured()) {
    return layout(`${head}
      <div class="row">
        <div class="row-in">
          <span class="row-name">PWA 通知</span>
          <span class="row-what">${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知</span>
        </div>
        <span class="row-note">缺密钥</span>
      </div>
      <p class="hint">在服务器上跑 <code>npx web-push generate-vapid-keys</code>，把两把密钥填进
        <code>.env</code> 的 <code>VAPID_PUBLIC_KEY</code> 和 <code>VAPID_PRIVATE_KEY</code>，
        然后 <code>pm2 restart vesper --update-env</code>。</p>
      <a class="back" href="/me">\u2039 回个人</a>`);
  }

  const n = countSubs();
  return layout(`${head}
    <div class="row">
      <div class="row-in">
        <span class="row-name">PWA 通知</span>
        <span class="row-what" data-push-what>${
          n ? `已经开着，${n} 台设备收得到` : `${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知`
        }</span>
      </div>
      <button type="button" data-push-toggle>${n ? '已开启' : '打开'}</button>
    </div>
    <p class="status" role="status" data-push-status></p>
    <div class="acts" data-push-acts${n ? '' : ' hidden'}>
      <button type="button" class="ghost" data-push-test>试一条</button>
      <button type="button" class="ghost" data-push-off>关掉通知</button>
    </div>
    <p class="hint">要从主屏幕那个图标打开才收得到。Safari 标签页里 iOS 不发推送，
      这是系统的规矩。还要 iOS 16.4 以上。</p>
    <p class="hint">系统只问你一次要不要通知。要是上次点了「不允许」，
      得去 设置 → 通知 → 晨暮星 里手动开。</p>
    <a class="back" href="/me">\u2039 回个人</a>`);
}

export function registerPushRoutes(app, { requireBasicAuth }) {
  // service worker：免认证。里面没秘密，而且浏览器注册时未必带 cookie。
  // 这一条就是「sw.js load failed」的修法（见文件头）。
  app.get('/app/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.set('Service-Worker-Allowed', '/');
    res.send(SW);
  });

  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(settingsPage());
    } catch (err) {
      console.error('push: 渲染设置页失败', err);
      res.status(500).send('通知这页出错了，看一下 vesper 的日志。');
    }
  });

  app.post('/push/subscribe', requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    if (!isPushConfigured()) return res.status(400).json({ error: '服务器还没配 VAPID 密钥' });
    const r = saveSub({
      endpoint: req.body?.endpoint,
      p256dh: req.body?.p256dh,
      auth: req.body?.auth,
    });
    if (r.error) return res.status(400).json(r);
    console.log(`push: 新增一个订阅，现在 ${r.count} 台`);
    res.json(r);
  });

  app.post('/push/unsubscribe', requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    const ep = String(req.body?.endpoint ?? '').trim();
    // 没给 endpoint 就全清：就一个用户，她说关就是都关
    const n = ep ? (dropSub(ep) ? 1 : 0) : dropAllSubs();
    console.log(`push: 取消了 ${n} 个订阅`);
    res.json({ ok: true, removed: n });
  });

  app.post('/push/test', requireBasicAuth, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    try {
      const r = await sendPush({
        title: `${AI_NAME}在这儿`,
        body: '通知通了。以后他发动态、做了事你都会收到。',
        url: '/home',
        tag: 'vp-test',
      });
      res.json(r);
    } catch (err) {
      console.error('push: 试发失败', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`push: 设置页 ${PREFIX}，service worker /app/sw.js，接口 /push/subscribe、/push/unsubscribe、/push/test`);
}
