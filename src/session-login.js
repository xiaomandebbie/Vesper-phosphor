// Cookie 会话登录：把浏览器那个密码弹窗换成一个网页表单。
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
    'padding:24px;font-family:-apple-system,"PingFang SC",sans-serif;color:#252525;' +
    'background:linear-gradient(180deg,#eaeaea 0%,#f2f2f2 55%,#f9f9f9 100%)}' +
    'form{width:100%;max-width:320px;background:#fdfdfd;border:1px solid #e2e2e2;' +
    'border-radius:18px;padding:22px 20px;box-shadow:0 4px 18px rgba(39, 39, 39, .1)}' +
    'h1{margin:0 0 16px;font-size:16px;font-weight:600;color:#4d4d4d}' +
    'label{display:block;margin:0 0 5px;font-size:12px;color:#5e5e5e}' +
    'input{width:100%;height:42px;padding:0 12px;margin:0 0 13px;border:1px solid #e2e2e2;' +
    'border-radius:12px;background:#ffffff;font-size:16px;color:#252525}' +
    'button{width:100%;height:44px;border:none;border-radius:14px;background:#4d4d4d;' +
    'color:#fdfdfd;font-size:15px}' +
    '.msg{margin:0 0 13px;font-size:12px;line-height:1.6;color:#818181}' +
    '.foot{margin:13px 0 0;font-size:11px;line-height:1.6;color:#9b9b9b}' +
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
        out[decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '))] =
          decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
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
