// 私域页 /uranus：全屏嵌 Uranus 自己的子域名。
//
// 小满 2026-11-08：「你直接嵌入网站不行吗，我自己输入密码」
//
// ── 为什么不再转发 ──
//
// 转发到 /uranus 子路径一直是白屏：Uranus 构建出来的页面引的是
// /assets/main-xxx.js 这种根路径，放在 /uranus 下面浏览器会去晨暮星的
// 根目录找，找不到。要改写就得动它的 HTML 和运行时 import，越补越乱。
//
// 给它一个子域名（uranus.vesperphosphor.online，Caddy 反代到 127.0.0.1:8888，
// 证书 Caddy 自己签）之后，它就站在自己的根上，路径一个都不用改。
// 这边只管摆一个全屏 iframe。登录她自己在里面输，cookie 归 Uranus 自己。
//
// 子域名和晨暮星是同一个站点（vesperphosphor.online），所以 iframe 里的
// cookie 不算第三方，iOS 不会拦。
//
// ── 高度用 100vh ──
//
// 不用 100dvh：iOS PWA 里 100dvh 只撑到 WebKit 认的可视区，底下会露白边
// （10-31 那次外壳就是这么修好的）。
//
// ── 端口 ──
//
// Uranus 在 8888。8787 是 Aru Host 的，2026-11-08 被 Uranus 占过一次，
// Aru 配对直接报 manifest 不兼容。别再让任何东西用 8787。

const PREFIX = '/uranus';
const env = (k) => String(process.env[k] ?? '').trim();

// Uranus 对外的地址。只认 https——http 嵌进来就是混合内容，Safari 会拦。
export function uranusBase() {
  const raw = env('URANUS_PUBLIC_URL');
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

export function uranusEnabled() {
  return Boolean(uranusBase());
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function page(src) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u79c1\u57df \u00b7 \u6668\u66ae\u661f</title>
<style>
  html, body { margin: 0; padding: 0; height: 100vh; overflow: hidden; background: #fff; }
  iframe { display: block; width: 100%; height: 100vh; border: 0; }
  .back { position: fixed; z-index: 10; left: 10px; top: calc(10px + env(safe-area-inset-top, 0px));
    width: 36px; height: 36px; border-radius: 50%; display: flex; align-items: center;
    justify-content: center; background: rgba(255, 255, 255, 0.88); color: #333;
    text-decoration: none; font-size: 20px; line-height: 1;
    box-shadow: 0 1px 6px rgba(0, 0, 0, 0.15); }
</style>
</head>
<body>
<iframe src="${esc(src)}" allow="microphone; camera; autoplay; clipboard-write"></iframe>
<a class="back" href="/discover" aria-label="\u8fd4\u56de">\u2039</a>
</body>
</html>`;
}

export function registerUranusProxy(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    const src = uranusBase();
    res.set('Cache-Control', 'no-store');
    if (!src) {
      return res
        .status(404)
        .send('\u8fd8\u6ca1\u914d URANUS_PUBLIC_URL\uff08\u8981 https \u7684\u5b50\u57df\u540d\uff09\u3002');
    }
    res.send(page(src + '/'));
  });

  const src = uranusBase();
  console.log(`uranus: \u79c1\u57df\u9875 ${PREFIX} \u5d4c ${src || '\uff08\u6ca1\u914d URANUS_PUBLIC_URL\uff09'}`);
  return src;
}
