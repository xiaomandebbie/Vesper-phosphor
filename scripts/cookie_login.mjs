#!/usr/bin/env node
// 不再弹密码框。
//
// 小满 2026-10-30 17:48：「还是弹密码框」
// （10-29 也说过一次：「想变成网页 app 但是每次填密码好麻烦」）
//
// 那个框是浏览器自己弹的（Basic Auth 的 401 + WWW-Authenticate），
// 不是网页里的表单，所以没法用样式或 JS 管它。从主屏幕打开、
// 或者 Safari 清过缓存，就会再问一次。
//
// ── 改法：不动 requireBasicAuth 一个字 ──
//
// 在所有路由前面加一层：
//   有合法 cookie   → 替这个请求补上 Authorization 头，后面一切照旧逻辑跑
//   没 cookie 且是网页 → 跳 /login 表单页，401 弹窗根本不会触发
//   其他（curl、快捷指令、MCP）→ 原样放行，走它们自己的 Basic / token
//
// 这样改动面小：只向 vesper.js 插两行（import + 挂载），
// 十八个本地改过的文件一个不碰。
//
// 密钥没有新增：会话签名用 VESPER_BASIC_USER/PASS 算出来。
// 改了密码，所有旧 cookie 自动作废。
//
// 重跑安全。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

// ════ 1. src/session-login.js ════
const MODULE = `// Cookie 会话登录：把浏览器那个密码弹窗换成一个网页表单。
//
// 小满 2026-10-30：「还是弹密码框」。Basic Auth 的 401 是浏览器自己弹的框，
// 从主屏幕打开或清过缓存就会再问一次，而且 standalone 模式下有时压根不弹、直接白屏。
//
// ── 为什么不改 requireBasicAuth ──
//
// 那个函数被几十处路由和两个转发共用，改它的话每一处都要重新验。
// 所以这层放在它前面：有合法 cookie 就替请求补上 Authorization 头，
// 下游根本不知道发生过什么。Basic Auth 这条路完整保留，
// curl、iOS 快捷指令、MCP 客户端都不受影响。
//
// ── 签名 ──
//
// 没新增密钥：HMAC 的 key 是从 VESPER_BASIC_USER/PASS 算出来的。
// 所以改密码 = 所有旧 cookie 立刻作废，这是想要的行为。
// 想单独控制就在 .env 里设 VESPER_SESSION_SECRET。
import crypto from 'crypto';

const COOKIE = 'vesper_session';
const MAX_AGE_DAYS = 365;

function creds() {
  return {
    user: process.env.VESPER_BASIC_USER || '',
    pass: process.env.VESPER_BASIC_PASS || '',
  };
}

function secret() {
  const explicit = String(process.env.VESPER_SESSION_SECRET || '').trim();
  if (explicit) return explicit;
  const { user, pass } = creds();
  return crypto.createHash('sha256').update('vesper-session:' + user + ':' + pass).digest('hex');
}

function sign(payload) {
  return crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
}

function issue() {
  const payload = Buffer.from(JSON.stringify({ t: Date.now() })).toString('base64url');
  return payload + '.' + sign(payload);
}

function valid(token) {
  const raw = String(token || '');
  const dot = raw.lastIndexOf('.');
  if (dot <= 0) return false;
  const payload = raw.slice(0, dot);
  const mac = raw.slice(dot + 1);
  const want = sign(payload);
  // 长度不等时 timingSafeEqual 会抛，先挡一道
  if (mac.length !== want.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return false;
  try {
    const { t } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isFinite(t) && Date.now() - t < MAX_AGE_DAYS * 86400000;
  } catch {
    return false;
  }
}

function readCookie(header, name) {
  for (const part of String(header || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return null;
}

// 表单页自己渲染，不引要认证的资源（菜单、星星转场那些都不带）。
// 配色跟晨暮星，但不做额外装饰——小满 10-30：「美化不要了，先保持整洁」。
function formPage(msg, next) {
  const back = String(next || '/').replace(/"/g, '');
  return '<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8" />' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />' +
    '<title>登录 · 晨暮星</title><style>' +
    '*{box-sizing:border-box}' +
    'body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'padding:24px;font-family:-apple-system,"PingFang SC",sans-serif;color:#2b2233;' +
    'background:linear-gradient(180deg,#efe7f4 0%,#f9f0ee 55%,#fdf8f2 100%)}' +
    'form{width:100%;max-width:320px;background:#fffdfb;border:1px solid #eadfe6;' +
    'border-radius:18px;padding:22px 20px;box-shadow:0 4px 18px rgba(60,30,60,.1)}' +
    'h1{margin:0 0 16px;font-size:16px;font-weight:600;color:#7a3e5d}' +
    'label{display:block;margin:0 0 5px;font-size:12px;color:#665a70}' +
    'input{width:100%;height:42px;padding:0 12px;margin:0 0 13px;border:1px solid #eadfe6;' +
    'border-radius:12px;background:#fff;font-size:16px;color:#2b2233}' +
    'button{width:100%;height:44px;border:none;border-radius:14px;background:#7a3e5d;' +
    'color:#fffdfb;font-size:15px}' +
    '.msg{margin:0 0 13px;font-size:12px;line-height:1.6;color:#b7792f}' +
    '.foot{margin:13px 0 0;font-size:11px;line-height:1.6;color:#a597ab}' +
    '</style></head><body>' +
    '<form method="POST" action="/login">' +
    '<h1>晨暮星</h1>' +
    (msg ? '<p class="msg">' + msg + '</p>' : '') +
    '<input type="hidden" name="next" value="' + back + '" />' +
    '<label for="u">账号</label>' +
    '<input id="u" name="user" type="text" autocomplete="username" autocapitalize="none" />' +
    '<label for="p">密码</label>' +
    '<input id="p" name="pass" type="password" autocomplete="current-password" />' +
    '<button type="submit">进去</button>' +
    '<p class="foot">登一次管一年。从主屏幕打开也不再问。</p>' +
    '</form></body></html>';
}

// 表单是 urlencoded，但这几条路由挂在 express.urlencoded 之前（要比两个转发更早），
// 所以自己读一遍 body。和 chat-page.js 里那个 form 中间件同一个做法。
function readForm(req) {
  return new Promise((done) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return done(req.body);
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 4096) req.destroy();
    });
    req.on('end', () => {
      const out = {};
      for (const pair of raw.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        out[decodeURIComponent(pair.slice(0, eq).replace(/\\+/g, ' '))] =
          decodeURIComponent(pair.slice(eq + 1).replace(/\\+/g, ' '));
      }
      done(out);
    });
    req.on('error', () => done({}));
  });
}

// 跳回去的地址只认本站路径，不认完整网址——否则这个参数能把人蹢到别的站点去。
function safeNext(value) {
  const v = String(value || '');
  if (!v.startsWith('/') || v.startsWith('//')) return '/';
  return v;
}

export function registerSessionLogin(app) {
  const { user, pass } = creds();
  if (!user || !pass) {
    console.log('login: 没设 VESPER_BASIC_USER/PASS，cookie 登录没开（整站本来就不要密码）');
    return { enabled: false };
  }

  app.get('/login', (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (valid(readCookie(req.headers.cookie, COOKIE))) {
      return res.redirect(302, safeNext(req.query.next));
    }
    res.status(200).send(formPage('', safeNext(req.query.next)));
  });

  app.post('/login', async (req, res) => {
    const body = await readForm(req);
    const okUser = String(body.user || '');
    const okPass = String(body.pass || '');
    const next = safeNext(body.next);
    if (okUser !== user || okPass !== pass) {
      console.log('login: 密码不对');
      return res.status(401).send(formPage('账号或密码不对。', next));
    }
    // Secure 只在 https 下加：本机调试走 http 时加了 Safari 不会存
    const https = String(req.headers['x-forwarded-proto'] || '').includes('https');
    res.set('Set-Cookie',
      COOKIE + '=' + issue() +
      '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + MAX_AGE_DAYS * 86400 +
      (https ? '; Secure' : ''));
    console.log('login: 进来了，cookie 给了一年');
    res.redirect(302, next);
  });

  app.post('/logout', (req, res) => {
    res.set('Set-Cookie', COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.redirect(302, '/login');
  });

  // 这层要挂在所有业务路由前面。
  app.use((req, res, next) => {
    const path = req.path || '';
    if (path === '/login' || path === '/logout') return next();
    // 已经自带凭据（curl、快捷指令、MCP 客户端）——原样放行
    if (req.headers.authorization) return next();

    if (valid(readCookie(req.headers.cookie, COOKIE))) {
      // 替它补上 Basic 头，下游 requireBasicAuth 照旧逻辑跑，一行不用改
      req.headers.authorization =
        'Basic ' + Buffer.from(user + ':' + pass).toString('base64');
      return next();
    }

    // 没 cookie 也没凭据。是网页请求就跳表单页，这样 401 弹窗不会触发。
    // 图片、接口、SSE 这些不动：让它们走原来的 401，
    // 客户端自己知道怎么处理，而且用户那边已经有 cookie 了。
    const wantsHtml = String(req.headers.accept || '').includes('text/html');
    if (req.method === 'GET' && wantsHtml) {
      const back = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(302, '/login?next=' + back);
    }
    return next();
  });

  console.log('login: cookie 会话开了（/login），Basic Auth 那条路照旧留着');
  return { enabled: true };
}
`;

const modPath = resolve(root, 'src/session-login.js');
if (existsSync(modPath) && readFileSync(modPath, 'utf8') === MODULE) {
  console.log('· src/session-login.js：已经是这样了');
} else {
  writeFileSync(modPath, MODULE, 'utf8');
  console.log('✓ 写了 src/session-login.js');
}

// ════ 2. vesper.js 插两行 ════
const vpPath = resolve(root, 'src/vesper.js');
if (!existsSync(vpPath)) {
  console.error('✗ src/vesper.js 不在');
  failed++;
} else {
  let t = readFileSync(vpPath, 'utf8');
  const before = t;

  const IMPORT_ANCHOR = "import { renderLoginPage } from './login-page.js';";
  if (t.includes("from './session-login.js'")) {
    console.log('· src/vesper.js · import：已经有了');
  } else if (t.includes(IMPORT_ANCHOR)) {
    t = t.replace(IMPORT_ANCHOR,
      IMPORT_ANCHOR + "\nimport { registerSessionLogin } from './session-login.js';");
    console.log('✓ src/vesper.js · import');
  } else {
    console.error('✗ src/vesper.js：找不到 login-page 那行 import');
    failed++;
  }

  // 挂在 registerSparkles 后面：要比两个转发（记忆库、音乐）更早，
  // 否则那两页还是会弹框。
  const MOUNT_ANCHOR = 'registerSparkles(app);';
  if (t.includes('registerSessionLogin(app)')) {
    console.log('· src/vesper.js · 挂载：已经有了');
  } else if (t.includes(MOUNT_ANCHOR)) {
    t = t.replace(MOUNT_ANCHOR,
      MOUNT_ANCHOR + '\n' +
      '// Cookie 会话登录（见 session-login.js）：把浏览器那个密码弹窗换成网页表单。\n' +
      '// 要挂在记忆库、音乐转发和所有页面路由前面——它认到 cookie 就替请求补上\n' +
      '// Authorization 头，下游 requireBasicAuth 一行不用改。\n' +
      'registerSessionLogin(app);');
    console.log('✓ src/vesper.js · 挂载');
  } else {
    console.error('✗ src/vesper.js：找不到 registerSparkles(app);');
    failed++;
  }

  if (t !== before) writeFileSync(vpPath, t, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处，没改完。把上面的输出发我。');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('然后手机上开 https://vesperphosphor.online/login 登一次。');
  console.log('账号密码就是 .env 里的 VESPER_BASIC_USER / VESPER_BASIC_PASS。');
  console.log('登完一年内不再问，主屏幕打开也不问。');
}
