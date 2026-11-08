// 私域页 /uranus：把 Uranus（默认 127.0.0.1:8787）转发过来。
//
// 小满 2026-11-08：「那算了你直接嵌入网站不行吗，我自己输入密码」
//
// ── 这一层只做一件事 ──
//
// 把 HTTP 变成 HTTPS。就这么多。
//
// 晨暮星是 HTTPS，Uranus 是 HTTP。iframe 嵌一个 http:// 进来是混合内容，
// Safari 直接拦；给 IP 申证书又基本办不到（要域名）。转一道之后
// 浏览器只看见晨暮星自己的 HTTPS，这个问题根本不出现。
//
// ── 上一版为什么空白 ──
//
// 我干了两件多余的事：替她注入 cookie 登录，和往 <head> 插
// <base href="/uranus/">。
//
// 那个 <base> 是空白的根源：Uranus 的页面只有一个空 <div id="root">
// 和 <script type="module" src="/src/main.jsx">，界面全靠那段 JS 渲染。
// 插了 <base>，那些模块运行时用 import 继续拉的东西（/@vite/client
// 之类）全死在半路上——import 不过 fetch，我那层补丁接不到。
//
// 而它的资源本来就是绝对路径，转发时路径本来就带着前缀进来——
// <base> 是多余的，去掉就行。
//
// ── 登录交给她 ──
//
// 不再替她登。cookie 原样来回传，Uranus 自己的登录页就正常出现在
// iframe 里。她输一次，30 天内不用再输（它的 session 是 30 天）。
//
// 这比我代登好：密码不用进 .env，她改密码也不影响这边。
//
// ── 为什么必须挂在 body 解析之前 ──
//
// Uranus 带图片上传和 SSE。要是挂在 express.json() 后面，请求体已经被
// 解成对象了，重新编一遍会弄坏上传——跟记忆库和音乐一个道理。

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
  // 晨暮星自己的 Basic Auth 凭证不该流到那边去。
  // cookie 要传：那是 Uranus 的登录状态，她自己输的。
  'authorization',
]);

const RESPONSE_SKIP = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  // 空间限制：我们在 iframe 里嵌它，透出去浏览器就拒渲染
  'x-frame-options', 'content-security-policy',
]);

// 重定向回来的绝对地址：把本机 origin 剥掉，否则浏览器会跳到 127.0.0.1
function rewriteLocation(value, base) {
  const v = String(value);
  if (v.startsWith(base)) {
    const rest = v.slice(base.length);
    return `${PREFIX}${rest}` || PREFIX;
  }
  if (v.startsWith('/') && !v.startsWith(PREFIX)) return `${PREFIX}${v}`;
  return v;
}

// Set-Cookie 里的 Path 要加前缀。
//
// Uranus 签的是 Path=/，浏览器按晨暮星的域存——没改的话这个 cookie
// 会跟着所有晨暮星的请求跑，没必要也不干净。改成 /uranus 之后
// 它只在这一块生效。
function rewriteCookie(value) {
  return String(value).replace(/;\s*Path=\/(?=[;\s]|$)/i, `; Path=${PREFIX}/`);
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

    // req.url 已经是去掉 /uranus 之后的部分（app.use 的行为）
    const target = base + (req.url === '/' ? '/' : req.url);
    const hasBody = !['GET', 'HEAD'].includes(req.method);

    let upstream;
    try {
      upstream = await fetch(target, {
        method: req.method,
        headers,
        // 原样把字节流过去。duplex 是 Node 要求的（流式请求体）
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('uranus proxy: 连不上', err.message);
      return res.status(502).send(`连不上私域那个服务（${base}）。${err.message}`);
    }

    try {
      res.status(upstream.status);

      // Set-Cookie 可能有多条，getSetCookie() 才拿得全——
      // forEach 会把它们拼成一条，浏览器就只认第一个
      const cookies = typeof upstream.headers.getSetCookie === 'function'
        ? upstream.headers.getSetCookie()
        : [];
      if (cookies.length) res.setHeader('set-cookie', cookies.map(rewriteCookie));

      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key)) return;
        if (key === 'set-cookie') return; // 上面单独处理了
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });

      if (req.method === 'HEAD') return res.end();
      if (!upstream.body) return res.end();

      // SSE 这种长连接要流式转，不能等全部收完
      const type = upstream.headers.get('content-type') || '';
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

  console.log(`uranus: 私域页 ${PREFIX} → ${base}（登录自己输）`);
  return base;
}
