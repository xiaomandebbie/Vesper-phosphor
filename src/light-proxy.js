// 台灯页 /lamp：把 Vesper-light 的管理页（默认 127.0.0.1:3003/lamp）转发过来。
//
// ── 为什么要转发，而不是菜单里直接挂个外链 ──
//
// 灯那个服务只听 127.0.0.1（故意的：它能动家里的硬件，不该开到公网）。
// 菜单里写 http://127.0.0.1:3003/lamp 的话，手机上点过去是打不开的——
// 那个地址指的是手机自己。所以走 vesper 转一道，和记忆库、音乐同一个路子。
//
// 顺带赚到三件事：
//   1. 登录和动态页共用 vesper 的 Basic Auth——灯自己那道密码在这里注进去，
//      浏览器碰不到，不会弹第二个登录框；
//   2. 页面换成晨暮星的配色，而且跟着早晨两张脸走（见 sun-time.js）；
//   3. 加上三条杠菜单，固定在屏幕上、按住可以拖（和记忆库那页一样）。
//
// 灯那个库的代码一行不改，它以后怎么更新都不受影响。
//
// ── 为什么可以挂在 body 解析之后 ──
//
// 记忆库和音乐必须挂在 express.json() 前面，因为它们要原样拿到请求体。
// 这里不用：灯的管理页只有几个普通表单，没有文件上传、没有流。
// 所以挂在后面，把已经解好的 req.body 重新编一遍发过去就行——
// 这样不必动 vesper.js 顶上那一排 import 和最早那几行，少两处冲突点。
//
// 一件事没做：/lamp/mcp 不转发。那是给允朔和 Aru 用的端点，有自己的 token，
// 不该顺着这条路暴露在 vesper 上。
import { renderMenu, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const PREFIX = '/lamp';
const env = (k) => String(process.env[k] ?? '').trim();

// 灯那个服务在本机的地址。没单独配 LIGHT_PAGE_URL 时，
// 直接从已经配好的 LIGHT_MCP_URL 里取协议和主机（去掉 /lamp/mcp）——
// 那两个本来就是同一个服务，不必让人填两遍。填 off 就不转发。
export function lightPageBase() {
  const explicit = env('LIGHT_PAGE_URL');
  if (/^(off|0|false|no)$/i.test(explicit)) return '';
  const raw = explicit || env('LIGHT_MCP_URL');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'authorization',
]);
const RESPONSE_SKIP = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive',
  // 灯那边要密码，但那道门由这里代签了。把它的 401 挑战头透出去，
  // 浏览器就会再弹一个登录框，而那个密码她未必记得
  'www-authenticate',
]);

// 晨暮星配色：把灯那页自己的颜色变量改成晨暮星的。
//
// 用 html:root 而不是 :root——多一个元素选择器，赢过灯那页 STYLE 里的 :root。
// --card / --ink / --muted 这几个名字两边撞上了，正好：FACE_CSS 挂在
// html[data-face] 上，比 :root 特指度高，所以灯那页的卡片自动跟着早晨两张脸走。
// 剩下不撞名的（--text/--dim/--line/--warm/--cool/--bad）在这里挂过去。
const SKIN_CSS = `
  html:root {
    --text: #252525; --dim: #5e5e5e;
    --line: rgba(77, 77, 77, 0.16);
    --warm: #818181; --cool: #767676; --bad: #6a6a6a;
  }
  html, html body {
    background: linear-gradient(180deg, #eaeaea 0%, #f2f2f2 55%, #f9f9f9 100%) fixed;
    color: var(--text);
  }
  /* 天黑了换成晨暮星的夜色，不然深底上的深字认不出来 */
  html[data-face="night"], html[data-face="night"] body,
  html[data-face="dusk"], html[data-face="dusk"] body {
    background: linear-gradient(160deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%) fixed;
  }
  html[data-face="night"], html[data-face="dusk"] {
    --text: var(--ink, #eaeaea); --dim: var(--muted, #9b9b9b);
    --line: rgba(255, 255, 255, 0.14);
  }
  /* 卡片、输入框、按钮：跟晨暮星的奶白走，别停在灯那页原来的棕黑 */
  html .card { background: var(--card, rgba(253, 253, 253, 0.92)); border-color: var(--line); }
  html button, html .btn, html input[type=text], html input[type=number], html select {
    background: var(--milk-strong, rgba(253, 253, 253, 0.92));
    color: var(--text); border-color: var(--line);
  }
  html button:active { background: var(--accent-tint, rgba(77, 77, 77, 0.12)); }
  html button.on { border-color: var(--warm); color: var(--warm); }
  html button.off { border-color: var(--line); color: var(--dim); }
  html input[type=range] { accent-color: var(--rose, #5f5f5f); }
  html h1, html h2 { color: var(--text); }
  html h2 { color: var(--rose-deep, #4d4d4d); }
  html td { border-bottom-color: var(--line); }
  /* 页面自己没留菜单的位置，标题右边让出一块别被三条杠盖住 */
  html h1 { padding-right: 56px; }
`;

function rewriteHtml(html) {
  let out = html;
  const style = `<style id="vesper-skin">${CHROME_CSS}${SKIN_CSS}</style>`;
  const head = out.search(/<\/head>/i);
  out = head >= 0 ? out.slice(0, head) + style + out.slice(head) : style + out;

  // 三条杠菜单：固定在屏幕上、按住可以拖（位置记在这台设备上）。
  // 灯那页排版里没有菜单的位子，所以用 fixed，和记忆库、音乐一样
  const menu = ''; // 小满 10-30：台灯页不要导览
  const bodyOpen = /<body(\s[^>]*)?>/i;
  out = bodyOpen.test(out) ? out.replace(bodyOpen, (m) => m + menu) : out + menu;

  const script = `<script>${CHROME_SCRIPT}</script>`;
  const body = out.toLowerCase().lastIndexOf('</body>');
  return body >= 0 ? out.slice(0, body) + script + out.slice(body) : out + script;
}

// 灯那边重定向回 /lamp?msg=…，路径本来就是对的（两边用同一个前缀）。
// 只处理它偶尔给绝对地址的情况：把本机 origin 剥掉，不然浏览器会跳到 127.0.0.1
function rewriteLocation(value, base) {
  const v = String(value);
  return v.startsWith(base) ? v.slice(base.length) || PREFIX : v;
}

// body 已经被 express 解成对象了，重新编一遍发过去。
// 灯的管理页只有普通表单，所以这样够了；这也是它能挂在 body 解析之后的原因。
function encodeBody(req) {
  const type = String(req.headers['content-type'] ?? '');
  const b = req.body;
  if (b === undefined || b === null) return { body: undefined, type: null };
  if (Buffer.isBuffer(b)) return { body: b, type: null };
  if (typeof b === 'string') return { body: b, type: null };
  if (/json/i.test(type)) return { body: JSON.stringify(b), type: 'application/json' };
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(b)) {
    if (Array.isArray(v)) for (const one of v) form.append(k, String(one));
    else if (v !== undefined && v !== null) form.append(k, String(v));
  }
  return { body: form.toString(), type: 'application/x-www-form-urlencoded' };
}

export function registerLightProxy(app, { requireBasicAuth }) {
  const base = lightPageBase();
  if (!base) return '';

  // 灯自己那道 Basic Auth。两边填同一对（和 token 一个道理）；
  // 没填的话还是转发，只是灯那边会回 401——页面上看得见原因，比默默不出现强
  const user = env('LIGHT_BASIC_USER');
  const pass = env('LIGHT_BASIC_PASS');
  const credential = user && pass ? `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}` : '';

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    // MCP 端点不转发：那是给允朔和 Aru 用的，有自己的 token，不该走这条路
    if (/^\/mcp(\/|$)/.test(req.path)) {
      return res.status(404).json({ error: 'not here', hint: 'MCP 端点直连灯那个服务，不走 vesper' });
    }

    const ac = new AbortController();
    res.on('close', () => {
      if (!res.writableEnded) ac.abort();
    });

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    if (credential) headers.authorization = credential;

    const hasBody = !['GET', 'HEAD'].includes(req.method);
    const encoded = hasBody ? encodeBody(req) : { body: undefined, type: null };
    if (encoded.type) headers['content-type'] = encoded.type;

    let upstream;
    try {
      upstream = await fetch(base + req.originalUrl, {
        method: req.method,
        headers,
        body: encoded.body,
        redirect: 'manual',
        signal: ac.signal,
      });
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('light proxy: 连不上台灯服务', err.message);
      return res
        .status(502)
        .send('连不上台灯那个服务。看一下 pm2 status 里 vesper-light 在不在跑。');
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
      // JSON、纯文字这些原样过去
      const buf = Buffer.from(await upstream.arrayBuffer());
      return res.end(buf);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('light proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send('台灯页转发出错了，看一下 vesper 的日志。');
      else res.destroy();
    }
  });

  return base;
}
