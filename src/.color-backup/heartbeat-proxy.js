// heartbeat 管理页 /heartbeat/：把 heartbeat 的 /admin 转发过来，换成晨暮星的配色，
// 再加上右上角菜单和星星转场。heartbeat 自己的代码一行不改。
//
// 做法和记忆库那边（memory-proxy.js）一模一样，只是根路径不同：
// heartbeat 的管理页用 /admin/save、/admin/presets/*、/admin/restart 这几条，
// 全部要加上 /heartbeat 前缀才能回到这里。
//
// 为什么要做：记忆库那页已经跟着早晚两张脸走了（memory-proxy 注入了 HEAD_SCRIPT），
// 但 heartbeat 的管理页还是它自带的粉色，天黑了也不变。这次把它也接进来。
//
// 要拿到原始请求体（保存配置、重启都是 POST），所以 vesper.js 里必须挂在 express.json() 之前。
// heartbeat 自己的 Basic Auth 照常要登；vesper 这边的也照常要过。
import { Readable } from 'stream';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const PREFIX = '/heartbeat';
// heartbeat 管理页用到的根路径
const ROOTS = 'admin|healthz|internal|test-bark|favicon\\.ico';

const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding',
]);
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

const env = (k) => String(process.env[k] ?? '').trim();

// heartbeat 的地址。没配 HEARTBEAT_ADMIN_URL 就从 HEARTBEAT_EVENT_URL 推；填 off 不转发
export function heartbeatBase() {
  const explicit = env('HEARTBEAT_ADMIN_URL');
  if (/^(off|0|false|no)$/i.test(explicit)) return '';
  const raw = explicit || env('HEARTBEAT_EVENT_URL') || 'http://localhost:3000';
  try {
    const u = new URL(raw);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.origin;
  } catch {
    return '';
  }
}

// 晨暮星配色，盖掉 heartbeat 管理页自带的粉。布局、字体、功能都不动。
// 它的颜色是写死在 CSS 里的（没用变量），所以这里按选择器覆盖，
// 并且全部跟着 --card / --ink 这套变量走——天黑了就跟着沉下来。
const SKIN_CSS = `
  html body {
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%) fixed !important;
    background-image: none;
    color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
  }
  html body .container {
    background: color-mix(in srgb, var(--card) 82%, transparent);
    backdrop-filter: blur(18px) saturate(1.08);
    -webkit-backdrop-filter: blur(18px) saturate(1.08);
    box-shadow: 0 2px 10px rgba(80, 50, 90, 0.06), 0 16px 44px rgba(80, 50, 90, 0.14),
      0 0 0 1px color-mix(in srgb, var(--line) 60%, transparent) inset;
  }
  html body h2 { color: var(--accent); }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    html body h2 { background: linear-gradient(100deg, var(--t1) 0%, var(--t2) 52%, var(--t3) 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  html body .subtitle { color: var(--muted); }
  html body .status, html body .presets-box, html body .config-box, html body .diary-box {
    background: color-mix(in srgb, var(--card) 62%, transparent);
    border-color: color-mix(in srgb, var(--line) 70%, transparent);
  }
  html body .status p { color: var(--ink); }
  html body .status strong { color: var(--accent); }
  html body label { color: var(--muted); }
  html body input, html body select {
    background: color-mix(in srgb, var(--card) 88%, transparent);
    border-color: color-mix(in srgb, var(--line) 80%, transparent);
    color: var(--ink);
  }
  html body input:focus, html body select:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 14%, transparent);
  }
  html body input::placeholder { color: var(--muted); }
  html body .presets-box h3, html body .diary-box h3, html body .add-preset strong,
  html body .section-title { color: var(--accent); }
  html body .preset-btn {
    background: color-mix(in srgb, var(--card) 72%, transparent);
    border-color: color-mix(in srgb, var(--line) 70%, transparent);
    color: var(--ink);
  }
  html body .preset-btn span, html body .hint, html body .note,
  html body .diary-entry summary em, html body .diary-empty { color: var(--muted); }
  html body button.save, html body .add-preset button {
    background: linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 80%, #000) 100%);
  }
  html body button.restart {
    background: linear-gradient(135deg, var(--gold) 0%, color-mix(in srgb, var(--gold) 82%, #000) 100%);
  }
  html body .diary-entry {
    background: color-mix(in srgb, var(--card) 58%, transparent);
    border-color: color-mix(in srgb, var(--line) 70%, transparent);
  }
  html body .diary-entry summary { color: var(--ink); }
  html body .diary-entry pre { color: var(--ink); }
  html body .preset-del {
    background: color-mix(in srgb, var(--card) 70%, transparent);
    border-color: color-mix(in srgb, var(--line) 70%, transparent);
    color: var(--accent);
  }
  /* 天黑了按钮上的白字要换成深底色，不然浅紫底配白字看不见 */
  html[data-dark] body button.save, html[data-dark] body button.restart,
  html[data-dark] body .add-preset button { color: var(--bg1); }
`;

// 页面里写死的路径加前缀
const LITERAL_RE = new RegExp('(["\'`])\\/(' + ROOTS + ')(?=[\\/"\'`?#])', 'g');
const ROOT_NAV_RE = /(location(?:\.href)?\s*=\s*|location\.(?:replace|assign)\(\s*|href\s*=\s*)(["'`])\/\2/g;
// fetch("/admin/save") 这种在脚本里拼好的也要改
const FETCH_RE = /fetch\(\s*(["'`])\/(admin|internal)/g;

function rewriteHtml(html) {
  return html
    .replace(LITERAL_RE, (_, q, r) => `${q}${PREFIX}/${r}`)
    .replace(FETCH_RE, (_, q, r) => `fetch(${q}${PREFIX}/${r}`)
    .replace(ROOT_NAV_RE, (_, lead, q) => `${lead}${q}${PREFIX}/${q}`);
}

function injectChrome(html) {
  let out = html;
  const headScript = `<script>${HEAD_SCRIPT}</script>`;
  const headOpen = /<head(\s[^>]*)?>/i;
  out = headOpen.test(out) ? out.replace(headOpen, (m) => m + headScript) : headScript + out;

  const style = `<style>${CHROME_CSS}${SKIN_CSS}</style>`;
  const headClose = out.search(/<\/head>/i);
  out = headClose >= 0 ? out.slice(0, headClose) + style + out.slice(headClose) : style + out;

  const menu = renderMenu(`${PREFIX}/admin`, { fixed: true });
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + menu) : out + menu;

  const tail = `<script>${CHROME_SCRIPT}</script>`;
  const bodyClose = out.toLowerCase().lastIndexOf('</body>');
  return bodyClose >= 0 ? out.slice(0, bodyClose) + tail + out.slice(bodyClose) : out + tail;
}

function rewriteLocation(value, base) {
  const v = String(value);
  if (v.startsWith('/') && !v.startsWith('//')) return PREFIX + v;
  const origin = new URL(base).origin;
  if (v.startsWith(origin)) return PREFIX + (v.slice(origin.length) || '/');
  return v;
}

function errorPage(message) {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>heartbeat · 晨暮星</title><script>${HEAD_SCRIPT}</script><style>${CHROME_CSS}
  body { margin: 0; min-height: 100vh; font-family: -apple-system, "PingFang SC", sans-serif; color: var(--ink); }
  main { max-width: 600px; margin: 0 auto; padding: 80px 16px; }
  .card { background: var(--card); border-radius: 16px; padding: 16px; border-left: 4px solid var(--gold);
    font-size: 14px; line-height: 1.7; }
  code { background: color-mix(in srgb, var(--line) 50%, transparent); padding: 1px 4px; border-radius: 4px; }
</style></head><body><main>${renderMenu(`${PREFIX}/admin`)}<div class="card" role="alert">${message}</div></main><script>${CHROME_SCRIPT}</script></body></html>`;
}

// 返回转发到的地址；没配就返回空字符串，不挂路由
export function registerHeartbeatProxy(app, { requireBasicAuth }) {
  const base = heartbeatBase();
  if (!base) return '';
  const user = env('HEARTBEAT_ADMIN_USER');
  const pass = env('HEARTBEAT_ADMIN_PASSWORD');

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    const [pathname, query] = req.originalUrl.split(/\?(.*)/s);
    // /heartbeat 和 /heartbeat/ 都开管理页
    if (pathname === PREFIX || pathname === `${PREFIX}/`) {
      return res.redirect(302, `${PREFIX}/admin${query ? `?${query}` : ''}`);
    }
    const target = req.url.replace(/^\/+/, '/');

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      // vesper 的登录不往下传；heartbeat 自己的账号密码从 .env 带
      if (k === 'authorization') continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    if (user && pass) {
      headers.authorization = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
    }

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    let upstream;
    try {
      const hasBody = !['GET', 'HEAD'].includes(req.method);
      upstream = await fetch(base + target, {
        method: req.method,
        headers,
        body: hasBody ? Readable.toWeb(req) : undefined,
        duplex: hasBody ? 'half' : undefined,
        redirect: 'manual',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('heartbeat proxy: 连不上 heartbeat', err.message);
      return res.status(502).send(errorPage('连不上 heartbeat。它在运行吗？可以用 <code>pm2 status</code> 看一下。'));
    }

    try {
      // 它要求 Basic Auth 而我们没配账号：别把登录框透到浏览器，换成一句说明
      if (upstream.status === 401) {
        return res.status(200).send(
          errorPage('heartbeat 管理页要账号。在 vesper 的 .env 里填上 <code>HEARTBEAT_ADMIN_USER</code> 和 <code>HEARTBEAT_ADMIN_PASSWORD</code>（和 heartbeat 自己 .env 里的 ADMIN_USER / ADMIN_PASSWORD 一样），然后重启 vesper。')
        );
      }
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key)) return;
        // 别把它的 WWW-Authenticate 透出去，不然浏览器会弹第二个登录框
        if (key === 'www-authenticate') return;
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });

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
      console.error('heartbeat proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send(errorPage('heartbeat 转发出错了，看一下 vesper 的日志。'));
      else res.destroy();
    }
  });

  return base;
}
