// 记忆库 /memory/：把 Ombre Brain 的管理页原样转发过来，管理功能（改记忆、删记忆、设置……）都在，
// 只是换成晨暮星的配色，再加上右上角菜单和星星转场。Ombre Brain 本身的代码一行不改，它以后怎么更新都不受影响。
//
// 怎么做到的：
//   1. vesper 收到 /memory/xxx，转发给本机的 Ombre Brain（地址见 page-chrome.js 的 ombreDashboardBase）。
//   2. 管理页里写死的 /api/、/auth/、/static/ 这些路径，改成 /memory/api/ ……，请求才会回到这里。
//      页面里拼出来的路径改不到，所以再往页面最前面塞一小段脚本，把 fetch / XHR / EventSource 的这些路径也补上前缀。
//   3. 页面 <head> 末尾加一段样式，覆盖它的配色变量；<body> 开头加菜单，结尾加转场脚本。
//
// 要拿到原始请求体（上传、导入都要），所以 vesper.js 里必须挂在 express.json() 之前。
// Ombre Brain 自己的登录照常要登；vesper 这边的 Basic Auth 也照常要过。
import { Readable } from 'stream';
import { ombreDashboardBase, renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const PREFIX = '/memory';
// Ombre Brain 管理页用到的根路径
const ROOTS = 'api|auth|static|onboarding|oauth|dashboard|health|favicon\\.ico';

// 转发请求时不带过去的头。accept-encoding 去掉，让它回不压缩的内容，页面才好改
const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding',
]);
// 回给浏览器时不带的头：内容可能被改过，长度和压缩方式都不对了
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

// 塞进页面最前面：页面里用 JavaScript 拼出来的 /api/... 请求，补上 /memory 前缀
const PATCH_SCRIPT =
  "(function(){var P='" + PREFIX + "',R=/^\\/(?:" + ROOTS + ")(?:[\\/?#]|$)/;" +
  "function fix(u){return typeof u==='string'&&R.test(u)?P+u:u;}" +
  "function fixUrl(x){try{if(x.origin===location.origin&&R.test(x.pathname))return P+x.pathname+x.search;}catch(e){}return null;}" +
  "var f=window.fetch;if(f){window.fetch=function(i,o){" +
  "if(typeof i==='string'){i=fix(i);}" +
  "else if(window.URL&&i instanceof URL){var a=fixUrl(i);if(a)i=a;}" +
  "else if(window.Request&&i instanceof Request){var b=fixUrl(new URL(i.url));if(b)i=new Request(b,i);}" +
  "return f.call(this,i,o);};}" +
  "var X=window.XMLHttpRequest&&XMLHttpRequest.prototype.open;if(X){XMLHttpRequest.prototype.open=function(m,u){" +
  "var a=[].slice.call(arguments);a[1]=fix(u);return X.apply(this,a);};}" +
  "if(window.EventSource){var E=window.EventSource,W=function(u,c){return new E(fix(u),c);};W.prototype=E.prototype;window.EventSource=W;}" +
  "})();";

// 晨暮星配色，覆盖 Ombre Brain 管理页的颜色变量。布局、字体、功能都不动
const SKIN_CSS = `
  html:root {
    --bg: #f4ecf2;
    --bg-gradient: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%);
    --surface: #fffdfb;
    --surface-solid: #faf3f6;
    --border: #eadfe6;
    --border-strong: #d8c4d0;
    --text: #2b2233;
    --text-dim: #665a70;
    --text-light: #998ca2;
    --accent: #7a3e5d;
    --accent-light: #9b4a7a;
    --accent-glow: rgba(122, 62, 93, 0.18);
    --warning: #b7792f;
    --shadow-light: rgba(255, 255, 255, 0.9);
    --shadow-dark: rgba(90, 50, 80, 0.16);
    --shadow-dark-subtle: rgba(90, 50, 80, 0.08);
    --lcd: #fbeef3;
    --lcd-text: #5b2e52;
    --lcd-dim: #8f6a84;
    --lcd-glow: rgba(155, 74, 122, 0.14);
  }
  html body { background: var(--bg-gradient); background-attachment: fixed; }
`;

// 页面里写死的路径加前缀："/api/..."、'/static/...'、url(/static/...)，以及跳回根路径的 location.href = '/'
const LITERAL_RE = new RegExp('(["\'`])\\/(' + ROOTS + ')(?=[\\/"\'`?#])', 'g');
const CSS_URL_RE = new RegExp('url\\(\\s*([\'"]?)\\/(' + ROOTS + ')\\/', 'g');
const ROOT_NAV_RE = /(location(?:\.href)?\s*=\s*|location\.(?:replace|assign)\(\s*|href\s*=\s*)(["'`])\/\2/g;

function rewriteHtml(html) {
  return html
    .replace(LITERAL_RE, (_, q, r) => `${q}${PREFIX}/${r}`)
    .replace(CSS_URL_RE, (_, q, r) => `url(${q}${PREFIX}/${r}/`)
    .replace(ROOT_NAV_RE, (_, lead, q) => `${lead}${q}${PREFIX}/${q}`);
}

function injectChrome(html) {
  let out = html;
  const headScript = `<script>${HEAD_SCRIPT}${PATCH_SCRIPT}</script>`;
  const headOpen = /<head(\s[^>]*)?>/i;
  out = headOpen.test(out) ? out.replace(headOpen, (m) => m + headScript) : headScript + out;

  const style = `<style>${CHROME_CSS}${SKIN_CSS}</style>`;
  const headClose = out.search(/<\/head>/i);
  out = headClose >= 0 ? out.slice(0, headClose) + style + out.slice(headClose) : style + out;

  const menu = renderMenu(`${PREFIX}/`, { fixed: true });
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + menu) : out + menu;

  const tail = `<script>${CHROME_SCRIPT}</script>`;
  const bodyClose = out.toLowerCase().lastIndexOf('</body>');
  return bodyClose >= 0 ? out.slice(0, bodyClose) + tail + out.slice(bodyClose) : out + tail;
}

// 它跳转到 /xxx 时，改成 /memory/xxx；跳到它自己的完整地址时也改回来
function rewriteLocation(value, base) {
  const v = String(value);
  if (v.startsWith('/') && !v.startsWith('//')) return PREFIX + v;
  const origin = new URL(base).origin;
  if (v.startsWith(origin)) return PREFIX + (v.slice(origin.length) || '/');
  return v;
}

// Cookie 去掉 Domain（不然浏览器不认），Path 不是根路径时加前缀
function rewriteCookie(cookie) {
  return String(cookie)
    .replace(/;\s*domain=[^;]*/i, '')
    .replace(/;\s*path=\/([^;]*)/i, (m, rest) => (rest ? `; Path=${PREFIX}/${rest}` : m));
}

function errorPage(message) {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>记忆库 · 晨暮星</title><style>${CHROME_CSS}
  body { margin: 0; min-height: 100vh; font-family: -apple-system, "PingFang SC", sans-serif; color: #2b2233;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 80px 16px; }
  .card { background: #fffdfb; border-radius: 16px; padding: 16px; border-left: 4px solid #b7792f; font-size: 14px; line-height: 1.6; }
</style></head><body><main>${renderMenu(`${PREFIX}/`)}<div class="card" role="alert">${message}</div></main><script>${CHROME_SCRIPT}</script></body></html>`;
}

// 返回转发到的地址；没配就返回空字符串，不挂路由（菜单里的记忆库会退回 NAV_MEMORY_URL 或「没配置」）
export function registerMemoryProxy(app, { requireBasicAuth }) {
  const base = ombreDashboardBase();
  if (!base) return '';
  const upstreamOrigin = new URL(base).origin;

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    // /memory 不带斜杠时补上，不然页面里的相对路径会错
    const [pathname, query] = req.originalUrl.split(/\?(.*)/s);
    if (pathname === PREFIX) return res.redirect(301, `${PREFIX}/${query ? `?${query}` : ''}`);

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      // vesper 的 Basic Auth 不转发；别的鉴权头（比如它自己发的 Bearer）照常带过去
      if (k === 'authorization' && /^basic\s/i.test(String(v))) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    // Ombre Brain 收到 POST 会核对 Origin 是不是它自己（防跨站伪造请求）。http 下浏览器不发 Sec-Fetch-Site，
    // 只能靠 Origin 对上，所以换成它自己的地址。
    // X-Forwarded-Host / Proto 故意不带：它信任本机代理时会用这两个头算「自己的地址」，算出来是 vesper 的地址，
    // 和换过的 Origin 对不上，改记忆、删记忆这些 POST 就全被拒（403）
    if (headers.origin) headers.origin = upstreamOrigin;
    if (headers.referer) headers.referer = `${upstreamOrigin}/`;
    // 真实来源 IP 照常带过去，它的登录限流按这个算
    const prior = req.headers['x-forwarded-for'];
    headers['x-forwarded-for'] = prior ? `${prior}, ${req.socket.remoteAddress}` : String(req.socket.remoteAddress || '');

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    let upstream;
    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      upstream = await fetch(base + req.url, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('memory proxy: 连不上 Ombre Brain', err.message);
      return res
        .status(502)
        .send(errorPage('连不上记忆库（Ombre Brain）。它在运行吗？可以用 <code>docker ps</code> 或 <code>pm2 status</code> 看一下。'));
    }

    try {
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key) || key === 'set-cookie') return;
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });
      const cookies = typeof upstream.headers.getSetCookie === 'function' ? upstream.headers.getSetCookie() : [];
      if (cookies.length) res.setHeader('set-cookie', cookies.map(rewriteCookie));

      const type = upstream.headers.get('content-type') || '';
      if (req.method !== 'HEAD' && upstream.body && type.includes('text/html')) {
        const html = injectChrome(rewriteHtml(await upstream.text()));
        res.setHeader('cache-control', 'no-store');
        return res.end(html);
      }
      if (!upstream.body || req.method === 'HEAD') return res.end();
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('memory proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send(errorPage('记忆库转发出错了，看一下 vesper 的日志。'));
      else res.destroy();
    }
  });

  return base;
}