// 私域页 /uranus：把 Uranus（默认 127.0.0.1:8787）转发过来。
//
// 小满 2026-11-08：「我想包成私域放晨暮星的发现页面，也要做成其他
// 入口一样的小应用样式」「在同一个 VPS，要登录，有自己一套密码」
//
// ── 为什么要转发，而不是直接开个外链 ──
//
// 晨暮星是 HTTPS，Uranus 是 HTTP。iframe 嵌一个 http:// 进来是混合内容，
// Safari 直接拦。给 IP 申证书又基本办不到——要域名。
//
// 转一道之后，浏览器只看见晨暮星自己的 HTTPS，这个问题根本不出现。
// 和台灯、记忆库、音乐同一个路子（见 light-proxy.js）。
//
// ── 登录和台灯不一样 ──
//
// 台灯是 Basic Auth，注一个 header 就完事。Uranus 不是：
// 它用 HMAC 签名的 cookie（uranus_session，形如 <用户名>.<签发时间>.<签名>，
// 30 天有效，见 server/src/auth.js）。
//
// 所以这边自己掌握一份 cookie：
//   第一次转发前先 POST /api/auth/login 拿一个；
//   拿到之后缓着，每次请求带上；
//   万一过期（上游回 401）就重登一次再试。
//
// 密码在服务器的 .env 里，浏览器一眼都没见过。她不会碰上第二个登录页。
//
// ── 为什么必须挂在 body 解析之前 ──
//
// Uranus 是个带图片、音频、SSE 的完整应用。要是挂在 express.json() 后面，
// 请求体已经被解成对象了，重新编一遍会弄坏上传——所以跟记忆库和音乐
// 一样，要在全局 json 之前挂，原样把字节流 pipe 过去。
//
// 这是个硬要求，接线脚本里会检查位置。

import { Readable } from 'node:stream';

const PREFIX = '/uranus';
const env = (k) => String(process.env[k] ?? '').trim();

// Uranus 在本机的地址。填 off 就不转发。
export function uranusBase() {
  const raw = env('URANUS_PAGE_URL') || 'http://127.0.0.1:8787';
  if (/^(off|0|false|no)$/i.test(raw)) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

export function uranusEnabled() {
  return Boolean(uranusBase());
}

const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding',
  // 晨暮星自己的登录凭证不该流到那边去
  'authorization', 'cookie',
]);

const RESPONSE_SKIP = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  // 它的 cookie 由这边代管，不透给浏览器
  'set-cookie',
  // 空间限制：我们是在 iframe 里嵌它，透出去浏览器就拒渲染了
  'x-frame-options', 'content-security-policy',
]);

// ── 自己掌握的那份 cookie ──

let session = '';
let loggingIn = null;

async function login(base) {
  const user = env('URANUS_USER') || 'Uranus';
  const pass = env('URANUS_PASSWORD');
  if (!pass) throw new Error('没配 URANUS_PASSWORD');

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
    signal: AbortSignal.timeout(15000),
  });

  const raw = res.headers.get('set-cookie') || '';
  // Set-Cookie 里只要 uranus_session=… 那一段，后面的 Path/Max-Age 不带
  const hit = /uranus_session=([^;]+)/.exec(raw);
  if (!res.ok || !hit) {
    const detail = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(`登不进去（${res.status}）：${detail}`);
  }
  session = `uranus_session=${hit[1]}`;
  console.log('uranus: 登上了');
  return session;
}

// 同时来好几个请求时只登一次
function ensureSession(base) {
  if (session) return Promise.resolve(session);
  if (!loggingIn) {
    loggingIn = login(base).finally(() => {
      loggingIn = null;
    });
  }
  return loggingIn;
}

// 重定向回来的绝对地址：把本机 origin 剥掉，否则浏览器会跳到 127.0.0.1
function rewriteLocation(value, base) {
  const v = String(value);
  if (v.startsWith(base)) {
    const rest = v.slice(base.length);
    return `${PREFIX}${rest}` || PREFIX;
  }
  // 它给的是 /xxx 这种根路径，补上前缀
  if (v.startsWith('/') && !v.startsWith(PREFIX)) return `${PREFIX}${v}`;
  return v;
}

// HTML 里的根路径要加前缀。
//
// Uranus 的页面里写的是 /assets/xxx.js、fetch('/api/xxx') 这种根路径。
// 嵌在 /uranus 下面的话，浏览器会拿它们去请晨暮星的根——全部 404。
//
// 最干净的办法是在 <head> 插一个 <base>：相对路径自动落到 /uranus/ 下面。
// 但 <base> 管不了 JS 里的 fetch('/api/…')——那些是运行时拼的，
// 所以再装一层 fetch / XHR，把根路径请求改到 /uranus 下面。
//
// 不改 Uranus 一行代码，它以后怎么更新都不受影响。
const PATCH = `<script>(function () {
  var P = '${PREFIX}';
  function fix(u) {
    if (typeof u !== 'string') return u;
    // 只动根路径；//host 和 http(s):// 都不碰
    if (u.charAt(0) !== '/' || u.charAt(1) === '/') return u;
    if (u.indexOf(P + '/') === 0 || u === P) return u;
    return P + u;
  }
  var of = window.fetch;
  if (of) {
    window.fetch = function (input, init) {
      if (typeof input === 'string') return of.call(this, fix(input), init);
      if (input && input.url) {
        try {
          return of.call(this, new Request(fix(input.url), input), init);
        } catch (e) {
          return of.call(this, input, init);
        }
      }
      return of.call(this, input, init);
    };
  }
  var oo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    var a = [].slice.call(arguments);
    a[1] = fix(u);
    return oo.apply(this, a);
  };
  var OES = window.EventSource;
  if (OES) {
    window.EventSource = function (u, c) { return new OES(fix(u), c); };
    window.EventSource.prototype = OES.prototype;
  }
  var OWS = window.WebSocket;
  if (OWS) {
    window.WebSocket = function (u, p) {
      var s = String(u);
      if (s.indexOf('/') === 0 && s.charAt(1) !== '/') {
        s = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + fix(s);
      }
      return p === undefined ? new OWS(s) : new OWS(s, p);
    };
    window.WebSocket.prototype = OWS.prototype;
  }
})();<\/script>`;

function rewriteHtml(html) {
  let out = String(html);
  const baseTag = `<base href="${PREFIX}/">`;
  const head = /<head(\s[^>]*)?>/i.exec(out);
  if (head) {
    const at = head.index + head[0].length;
    out = out.slice(0, at) + baseTag + PATCH + out.slice(at);
  } else {
    out = baseTag + PATCH + out;
  }
  return out;
}

export function registerUranusProxy(app, { requireBasicAuth }) {
  const base = uranusBase();
  if (!base) return '';

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }

    // 路径：req.url 已经是去掉 /uranus 之后的部分（app.use 的行为）
    const target = base + (req.url === '/' ? '/' : req.url);

    const hasBody = !['GET', 'HEAD'].includes(req.method);

    const send = async (cookie) => {
      return fetch(target, {
        method: req.method,
        headers: { ...headers, ...(cookie ? { cookie } : {}) },
        // 原样把字节流过去。duplex 是 Node 要求的（流式请求体）
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: ac.signal,
      });
    };

    let upstream;
    try {
      const cookie = await ensureSession(base);
      upstream = await send(cookie);
      // cookie 过期了（改过密码、超过 30 天）：重登一次再试。
      // 带请求体的不重试——流已经读完了，重发只会发个空的
      if (upstream.status === 401 && !hasBody) {
        session = '';
        upstream = await send(await ensureSession(base));
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('uranus proxy: 连不上', err.message);
      return res
        .status(502)
        .send(`连不上私域那个服务（${base}）。${err.message}`);
    }

    try {
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key)) return;
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });

      if (req.method === 'HEAD') return res.end();

      const type = upstream.headers.get('content-type') || '';
      if (type.includes('text/html')) {
        res.setHeader('cache-control', 'no-store');
        return res.end(rewriteHtml(await upstream.text()));
      }

      // 其余原样过去。SSE 这种长连接要流式转，不能等全部收完
      if (!upstream.body) return res.end();
      if (type.includes('text/event-stream')) {
        res.setHeader('x-accel-buffering', 'no');
        if (res.flushHeaders) res.flushHeaders();
      }
      const body = Readable.fromWeb(upstream.body);
      body.on('error', () => res.end());
      body.pipe(res);
      req.on('close', () => body.destroy());
      return undefined;
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('uranus proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send('私域页转发出错了，看一下 vesper 的日志。');
      else res.destroy();
      return undefined;
    }
  });

  console.log(`uranus: 私域页 ${PREFIX} → ${base}`);
  return base;
}
