// 「打开 PWA 通知」那个开关：前端订阅脚本、设置页的卡片、三条接口。
//
// 推送本体在 push.js（VAPID、订阅表、发送）；service worker 那半在 pwa.js。
// 这边只管「她点一下开关」到「订阅存进数据库」这一段。
//
// ── 权限只弹一次 ──
//
// iOS 上 Notification.requestPermission() 只有一次机会：拒了就得进
// 系统设置里手动开，网页再调也不会再弹。所以：
//   · 进页不弹、加载不弹，只在她真的点了那个开关时弹
//   · 弹之前先检查是不是 PWA 模式（见下），不对就先说清楚，
//     不让她在 Safari 标签页里白白用掉那一次
//
// ── 必须是装到主屏幕的 PWA ──
//
// iOS 的 Web Push 只在 standalone 模式下有效，Safari 标签页里永远收不到。
// 用 navigator.standalone 或 display-mode: standalone 认；两个都不是就提示先装到主屏幕。
//
// ── 为什么要一个「试一条」 ──
//
// 推送这条链路很长：密钥 → 订阅 → APNs → service worker。
// 哪一节断了都是「没收到通知」这一个表现。有个按钮能当场试，
// 就不用等他下次醒来才知道通没通。

import { isPushConfigured, publicKey, countSubs, saveSub, dropSub, dropAllSubs, sendPush } from './push.js';

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

// 设置页那张卡。没配密钥时置灰并写明差哪两个变量（和其他未配置项一个口径）
export function renderPushCard() {
  if (!isPushConfigured()) {
    return `<section class="card" aria-labelledby="push-title">
      <h2 id="push-title" class="section-title">模型 · 连接 · 通知</h2>
      <div class="row off">
        <div class="row-in">
          <span class="row-name">PWA 通知</span>
          <span class="row-what">${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知</span>
        </div>
        <span class="row-note">缺 VAPID 密钥</span>
      </div>
      <p class="hint">在服务器上跑 <code>npx web-push generate-vapid-keys</code>，把两把密钥填进 <code>.env</code> 的
        <code>VAPID_PUBLIC_KEY</code> 和 <code>VAPID_PRIVATE_KEY</code>，然后 <code>pm2 restart vesper --update-env</code>。</p>
    </section>`;
  }

  const n = countSubs();
  return `<section class="card" aria-labelledby="push-title" data-push-card>
    <h2 id="push-title" class="section-title">模型 · 连接 · 通知</h2>
    <div class="row flat">
      <div class="row-in">
        <span class="row-name">PWA 通知</span>
        <span class="row-what" data-push-what>${
          n ? `已经开着，${n} 台设备收得到` : `${escapeHtml(AI_NAME)}发动态、做了事的时候给你一条通知`
        }</span>
      </div>
      <button type="button" class="push-btn" data-push-toggle>${n ? '已开启' : '打开'}</button>
    </div>
    <p class="status" role="status" data-push-status></p>
    <div class="acts" data-push-acts${n ? '' : ' hidden'}>
      <button type="button" class="ghost" data-push-test>试一条</button>
      <button type="button" class="ghost" data-push-off>关掉通知</button>
    </div>
    <p class="hint">要先把站点装到主屏幕（Safari → 分享 → 添加到主屏幕），从主屏幕这个图标打开再开通知。
      Safari 标签页里收不到——这是 iOS 自己的规矩。还要 iOS 16.4 以上。</p>
    <p class="hint">系统只问你一次要不要通知。要是上次点了「不允许」，得去
      设置 → 通知 → 晨暮星 里手动开，网页这边再点也弹不出来了。</p>
  </section>`;
}

export const PUSH_CSS = `
  .push-btn { flex: none; min-height: 36px; padding: 0 14px; border: 0; border-radius: 11px;
    background: var(--accent, #4d4d4d); color: #fff; font-size: 13px; cursor: pointer; }
  .push-btn:active { opacity: 0.85; }
  .push-btn[disabled] { opacity: 0.5; cursor: default; }
  [data-push-acts][hidden] { display: none; }
  [data-push-card] code { padding: 1px 5px; border-radius: 5px; font-size: 11.5px;
    background: var(--card-soft, #f2f2f2); }
`;

// 前端订阅。三步：要权限 → 注册订阅 → 存进数据库。
// 开头那几行检查是先把「这次没戏」的情况说清楚，别白白用掉唯一那次权限请求。
export const PUSH_SCRIPT = `(function () {
  var card = document.querySelector('[data-push-card]');
  if (!card) return;
  var toggle = card.querySelector('[data-push-toggle]');
  var acts = card.querySelector('[data-push-acts]');
  var status = card.querySelector('[data-push-status]');
  var what = card.querySelector('[data-push-what]');
  var testBtn = card.querySelector('[data-push-test]');
  var offBtn = card.querySelector('[data-push-off]');
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

  function openedUp(n) {
    toggle.textContent = '已开启';
    toggle.disabled = false;
    if (acts) acts.hidden = false;
    if (what) what.textContent = '已经开着' + (n ? '，' + n + ' 台设备收得到' : '');
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

    toggle.disabled = true;
    say('正在开…');

    Notification.requestPermission()
      .then(function (perm) {
        if (perm !== 'granted') {
          toggle.disabled = false;
          say(perm === 'denied'
            ? '你点了不允许。这个系统只问一次，要改得去 设置 → 通知 → 晨暮星。'
            : '还没允许。');
          return null;
        }
        return navigator.serviceWorker.register('/app/sw.js').then(function () {
          return navigator.serviceWorker.ready;
        });
      })
      .then(function (reg) {
        if (!reg) return null;
        return reg.pushManager.getSubscription().then(function (old) {
          if (old) return old;
          return reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: toKey(KEY),
          });
        });
      })
      .then(function (sub) {
        if (!sub) return null;
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
        openedUp(res.count);
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
          say('发给了 ' + (r.sent || 0) + ' 台设备' + (r.gone ? '，清了 ' + r.gone + ' 个死订阅' : '') + '。收不到就是链路还有一节没通。');
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
      (navigator.serviceWorker.getRegistration('/app/sw.js') || Promise.resolve(null))
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

export function registerPushRoutes(app, { requireBasicAuth }) {
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

  console.log(`push: 订阅接口 /push/subscribe、/push/unsubscribe、/push/test`);
}
