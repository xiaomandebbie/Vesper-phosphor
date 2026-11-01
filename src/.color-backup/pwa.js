// 把晨暮星做成能装到主屏的网页 App。
//
// 小满 2026-10-30：「想变成网页 app 但是每次填密码好麻烦」
//
// ── 为什么密码那一半比 manifest 要紧 ──
//
// 现在走 Basic Auth（浏览器那个弹窗）。装到主屏幕之后有两个坑：
//   standalone 的 WebView 和 Safari 不共享凭据，你在 Safari 里存过的密码到那里不认；
//   更糟的是 401 弹窗在 standalone 下经常不弹，直接白屏。
// 所以要真好用，得换成 cookie 会话。
//
// ── 只加一层，不拆旧的 ──
//
// requireBasicAuth 里先看 cookie，没有再走原来那套。所以：
//   · iOS 快捷指令上报（requireApiKey）一个字不用改
//   · /wake/* 那些接口照旧
//   · 出问题删掉 cookie 就退回原样
//
// ── cookie 怎么签 ──
//
// 不存 session 表：就一个用户，建表是浪费。
// cookie 里放 `过期时间.签名`，签名 = HMAC-SHA256(过期时间, 密钥)。
// 密钥从 VESPER_SESSION_SECRET 读；没配就用 BASIC_PASS 派一个
// （那样改密码等于把所有会话踢下线，正是想要的）。
// 比签名用 timingSafeEqual，和 wake-mcp 那边一个理由。
//
// ── 登录页要的图 ──
//
// /media 整个挂在 requireBasicAuth 后面，而登录页是没登录时看的，
// 引用 /media/app/... 会被挡。所以这里单开两条免认证的路，
// 只放这两张图，其他照旧。

import fs from 'fs';
import path from 'path';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const APP_DIR = path.join(MEDIA_DIR, 'app');

// 这两张图是她传进来的（见上面）。图标那张存的是 JPEG，文件名却是 .png——
// 文件名不影响浏览器显示（它看内容不看后缀），但 manifest 里得写真实 MIME。
const FRAME_FILE = path.join(APP_DIR, 'login-frame.png');
const ICON_FILE = path.join(APP_DIR, 'icon.png');

const APP_NAME = '\u6668\u66ae\u661f vesper\u2728phosphor';
const APP_SHORT = '\u6668\u66ae\u661f';
const START_URL = '/home';

const COOKIE_NAME = 'vp_session';
// 一年。装到主屏的东西不应该每周让你重新登录。
const MAX_AGE_MS = 365 * 24 * 3600 * 1000;

const BASIC_USER = process.env.VESPER_BASIC_USER || '';
const BASIC_PASS = process.env.VESPER_BASIC_PASS || '';

// 签 cookie 的密钥。没配就从密码派一个：改密码 = 所有会话失效。
const SECRET = (() => {
  const s = String(process.env.VESPER_SESSION_SECRET || '').trim();
  if (s) return s;
  if (BASIC_PASS) return `derived:${BASIC_PASS}`;
  // 连密码都没配的话本来就不验证，这把密钥用不上；给个随机的就行
  return randomBytes(32).toString('hex');
})();

export function isAuthConfigured() {
  return Boolean(BASIC_USER && BASIC_PASS);
}

function sign(expires) {
  return createHmac('sha256', SECRET).update(String(expires)).digest('hex');
}

function makeToken() {
  const expires = Date.now() + MAX_AGE_MS;
  return `${expires}.${sign(expires)}`;
}

// cookie 有效吗。过期、签名不对、形状不对都算无效。
function tokenOk(raw) {
  const token = String(raw || '');
  const dot = token.indexOf('.');
  if (dot <= 0) return false;
  const expires = Number(token.slice(0, dot));
  if (!Number.isFinite(expires) || expires <= Date.now()) return false;
  const given = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(expires));
  if (given.length !== want.length) return false;
  return timingSafeEqual(given, want);
}

// 不装 cookie-parser，就读这一个值
function readCookie(req, name) {
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return '';
}

// requireBasicAuth 在最前面调这一句：有效 cookie 就直接过
export function hasSession(req) {
  return tokenOk(readCookie(req, COOKIE_NAME));
}

function setSessionCookie(res, req) {
  // 同一个域名下 HTTPS 才加 Secure；没走 HTTPS 时加了等于 cookie 永远存不下来。
  // 反代后面要认 X-Forwarded-Proto（nginx / Caddy 都会带）。
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() || req.protocol;
  const secure = proto === 'https';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(makeToken())}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.append('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  res.append('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// ── 登录页 ──
// 边框那张图做背景，输入框居中落在里面。图是 1619×971，模板里按比例摆。

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loginPage({ error = '', next = START_URL } = {}) {
  const hint = error
    ? `<p class="err" role="alert">${escapeHtml(error)}</p>`
    : '<p class="hint">\u8fdb\u6765\u770b\u4ed6\u6700\u8fd1\u505a\u4e86\u4ec0\u4e48</p>';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="robots" content="noindex" />
<title>${escapeHtml(APP_NAME)}</title>
<link rel="manifest" href="/app/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/app/icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="${escapeHtml(APP_SHORT)}" />
<meta name="theme-color" content="#f9f0ee" />
<style>
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    padding: 24px 16px; color: #2b2233;
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  /* 边框图做背景，它自带透明通道，所以清底会透出渐变 */
  .frame { position: relative; width: 100%; max-width: 460px; aspect-ratio: 1619 / 971;
    background: url('/app/frame.png') center/contain no-repeat; }
  .inner { position: absolute; inset: 17% 13% 15%; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 12px; text-align: center; }
  h1 { margin: 0; font-size: 21px; font-weight: 200; letter-spacing: 0.3em; padding-left: 0.3em;
    color: #5b2e52; }
  .sub { margin: 0; font-family: "Cormorant Garamond", Georgia, serif; font-style: italic;
    font-size: 12px; letter-spacing: 0.16em; color: #7a6a80; }
  .hint, .err { margin: 0; font-size: 12px; line-height: 1.5; }
  .hint { color: #8a7d90; }
  .err { color: #a8415f; }
  form { display: flex; flex-direction: column; gap: 8px; width: 100%; max-width: 230px; }
  input { width: 100%; height: 40px; padding: 0 12px; border-radius: 11px;
    border: 1px solid #e3d2de; background: rgba(255, 253, 251, 0.9); font-size: 16px; color: #2b2233; }
  input:focus { outline: 2px solid #c58da8; outline-offset: 1px; }
  button { height: 40px; border: none; border-radius: 11px; background: #7a3e5d; color: #fffdfb;
    font-size: 15px; font-weight: 600; letter-spacing: 0.08em; }
  button:active { background: #693350; }
  @media (max-width: 380px) {
    .inner { inset: 15% 11% 13%; gap: 8px; }
    h1 { font-size: 18px; }
    .sub, .hint, .err { font-size: 11px; }
  }
</style>
</head>
<body>
  <main class="frame">
    <div class="inner">
      <h1>${escapeHtml(APP_SHORT)}</h1>
      <p class="sub">vesper \u2726 phosphor</p>
      ${hint}
      <form method="POST" action="/login">
        <input type="hidden" name="next" value="${escapeHtml(next)}" />
        <input type="text" name="user" placeholder="\u7528\u6237\u540d" autocomplete="username"
          autocapitalize="none" autocorrect="off" required />
        <input type="password" name="pass" placeholder="\u5bc6\u7801" autocomplete="current-password" required />
        <button type="submit">\u8fdb\u53bb</button>
      </form>
    </div>
  </main>
</body>
</html>`;
}

// 跳回哪里：只认本站的路径，不认完整网址（免得成个开放跳转）
function safeNext(raw) {
  const s = String(raw || '').trim();
  if (!s.startsWith('/') || s.startsWith('//')) return START_URL;
  if (s.startsWith('/login') || s.startsWith('/app/')) return START_URL;
  return s;
}

// ── manifest ──
// 图标存的是 JPEG（文件名是 .png），所以 type 写 image/jpeg。
// 192 和 512 两档共用同一张 941×941：系统自己缩，看不出来。
function manifest() {
  const icon = (size) => ({
    src: '/app/icon.png',
    sizes: size,
    type: 'image/jpeg',
    purpose: 'any',
  });
  return {
    name: APP_NAME,
    short_name: APP_SHORT,
    description: '\u4e00\u4e2a\u4f1a\u81ea\u5df1\u9192\u6765\u7684 TA',
    start_url: START_URL,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f9f0ee',
    theme_color: '#f9f0ee',
    lang: 'zh-Hans',
    icons: [icon('192x192'), icon('512x512'), icon('941x941')],
  };
}

// ── service worker ──
// 故意写得极简：这几个页面全是实时的，缓存正文只会让你看到旧的。
// 它存在的唯一理由是：iOS 要求有 service worker 才算数的 PWA，
// 而以后接 ios-web-push 那套推送也得靠它。所以只缓存图标和边框。
const SW = `const CACHE = 'vp-shell-v1';
const ASSETS = ['/app/icon.png', '/app/frame.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// 只管那两张图，其他一概不接——页面必须是活的
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || !ASSETS.includes(url.pathname)) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request)));
});
`;

// 注册 service worker 的那两行。page-chrome 的 CHROME_SCRIPT 末尾接上它。
export const PWA_SCRIPT = `if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/app/sw.js').catch(function () {});
  });
}`;

// 每个页面 <head> 里要的那几行。page-chrome 导出给各页用。
export const PWA_HEAD = `<link rel="manifest" href="/app/manifest.webmanifest" />
<link rel="apple-touch-icon" href="/app/icon.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="${APP_SHORT}" />
<meta name="theme-color" content="#f9f0ee" />`;

// ── 挂载 ──
// 要在 requireBasicAuth 之前挂：登录页和那两张图必须没登录也能看。
export function registerPwaRoutes(app) {
  const sendFile = (res, file, type) => {
    if (!fs.existsSync(file)) return res.status(404).send('\u6ca1\u6709\u8fd9\u4e2a\u6587\u4ef6');
    res.set('Content-Type', type);
    res.set('Cache-Control', 'public, max-age=86400');
    return res.sendFile(file);
  };

  // 图标和边框：免认证，只这两张
  app.get('/app/icon.png', (req, res) => sendFile(res, ICON_FILE, 'image/jpeg'));
  app.get('/app/frame.png', (req, res) => sendFile(res, FRAME_FILE, 'image/png'));

  app.get('/app/manifest.webmanifest', (req, res) => {
    res.set('Content-Type', 'application/manifest+json; charset=utf-8');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(JSON.stringify(manifest(), null, 1));
  });

  app.get('/app/sw.js', (req, res) => {
    res.set('Content-Type', 'application/javascript; charset=utf-8');
    res.set('Cache-Control', 'no-cache');
    res.send(SW);
  });

  // 登录页
  app.get('/login', (req, res) => {
    if (!isAuthConfigured()) return res.redirect(302, START_URL);
    if (hasSession(req)) return res.redirect(302, safeNext(req.query.next));
    res.set('Cache-Control', 'no-store');
    res.send(loginPage({ next: safeNext(req.query.next) }));
  });

  // express.json() 挂在这之前，但表单是 urlencoded，这儿单独挂一个
  app.post('/login', express_urlencoded(), (req, res) => {
    if (!isAuthConfigured()) return res.redirect(302, START_URL);
    const user = String(req.body?.user ?? '');
    const pass = String(req.body?.pass ?? '');
    const next = safeNext(req.body?.next);
    // 定长比：用户名和密码都比到底，不提前返回
    const okUser = safeCompare(user, BASIC_USER);
    const okPass = safeCompare(pass, BASIC_PASS);
    if (!okUser || !okPass) {
      console.log('login: \u5bc6\u7801\u4e0d\u5bf9');
      res.set('Cache-Control', 'no-store');
      return res.status(401).send(loginPage({ error: '\u7528\u6237\u540d\u6216\u5bc6\u7801\u4e0d\u5bf9', next }));
    }
    setSessionCookie(res, req);
    console.log('login: \u8fdb\u6765\u4e86\uff0ccookie \u7b7e\u4e86\u4e00\u5e74');
    return res.redirect(302, next);
  });

  app.post('/logout', (req, res) => {
    clearSessionCookie(res);
    res.redirect(302, '/login');
  });

  console.log(
    `pwa: \u767b\u5f55\u9875 /login\uff0cmanifest /app/manifest.webmanifest\uff0c\u56fe\u6807 /app/icon.png` +
      `${fs.existsSync(ICON_FILE) ? '' : '\uff08\u56fe\u6807\u6587\u4ef6\u8fd8\u6ca1\u4f20\uff09'}` +
      `${fs.existsSync(FRAME_FILE) ? '' : '\uff08\u8fb9\u6846\u6587\u4ef6\u8fd8\u6ca1\u4f20\uff09'}`
  );
  return { enabled: true, loginUrl: '/login' };
}

function safeCompare(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return timingSafeEqual(x, y);
}

// 不想把 express 整个 import 进来（这文件本来不认识它），
// 自己解一下表单就行——只有三个字段。
function express_urlencoded() {
  return (req, res, next) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return next();
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // 登录表单不可能大，超了就是有人在搞事
      if (raw.length > 4096) req.destroy();
    });
    req.on('end', () => {
      const out = {};
      for (const pair of raw.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
        const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        out[k] = v;
      }
      req.body = out;
      next();
    });
    req.on('error', () => next());
  };
}
