// 音乐 /music/：把 Music-Mcp-Netease 的播放器（server/music.py，默认 127.0.0.1:9090）转发过来。
// 好处：
//   1. 登录和动态页共用 vesper 的 Basic Auth，以后把播放器嵌进晨暮星页面时不会再弹第二个登录框；
//   2. 页面换成晨暮星的配色，顺手去掉播放器自带的两行漏到页面上的注释；
//   3. 播放器看到 X-Music-Gateway 头就不要 token，这个头只在这里加，浏览器碰不到。
// 播放器的代码一行不改，它以后怎么更新都不受影响。
// 要拿到原始请求体，所以 vesper.js 里必须挂在 express.json() 之前（和记忆库一样）。
import { Readable } from 'stream';

const PREFIX = '/music';
const env = (k) => String(process.env[k] ?? '').trim();

// MUSIC_PLAYER_URL 形如 http://127.0.0.1:9090；不填或填 off 就不转发
export function musicPlayerBase() {
  const raw = env('MUSIC_PLAYER_URL');
  if (!raw || /^(off|0|false|no)$/i.test(raw)) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.origin : '';
  } catch {
    return '';
  }
}

const REQUEST_SKIP = new Set([
  'host', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer',
  'transfer-encoding', 'upgrade', 'content-length', 'accept-encoding', 'x-music-gateway',
]);
const RESPONSE_SKIP = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection', 'keep-alive']);

// 播放器 index.html 里有两段注释开头丢了，后半句当正文显示在歌词页上
const STRAY_LINES = [/^.*syncDiscSpin 还在但查无此盘.*\r?\n/m, /^.*进度条滑块是兔兔本兔.*\r?\n/m];

// 晨暮星配色：覆盖播放器的颜色变量和底色。布局、动效都不动
const SKIN_CSS = `
  html:root {
    --ink: #2b2233; --ink-soft: #4a3d52; --muted: #665a70; --faint: #b9adbf;
    --rose: #9b4a7a; --rose-deep: #7a3e5d; --butter: #f6e6bf;
    --accent: #7a3e5d; --accent-soft: #9b4a7a; --btn: #7a3e5d; --accent-tint: rgba(122, 62, 93, 0.12);
    --bg: #f9f0ee; --milk: rgba(255, 253, 251, 0.72); --milk-strong: rgba(255, 253, 251, 0.92);
    --hairline: rgba(122, 62, 93, 0.14);
    --shadow-soft: 0 12px 32px rgba(90, 50, 80, 0.14); --shadow-sm: 0 4px 14px rgba(60, 30, 60, 0.1);
  }
  html, html body { background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%) fixed; }
  html .memory-view { background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
`;

function rewriteHtml(html) {
  let out = html;
  for (const re of STRAY_LINES) out = out.replace(re, '');
  const style = `<style id="vesper-skin">${SKIN_CSS}</style>`;
  const i = out.search(/<\/head>/i);
  return i >= 0 ? out.slice(0, i) + style + out.slice(i) : style + out;
}

// 播放器跳到 /xxx 时补上前缀（它的页面本身在根路径 /，对外是 /music/）
function rewriteLocation(value, base) {
  let v = String(value);
  if (v.startsWith(base)) v = v.slice(base.length) || '/';
  if (!v.startsWith('/') || v.startsWith('//')) return v;
  if (v === '/' || v.startsWith('/?')) return `${PREFIX}${v}`;
  return v.startsWith(`${PREFIX}/`) ? v : `${PREFIX}${v}`;
}

export function registerMusicProxy(app, { requireBasicAuth }) {
  const base = musicPlayerBase();
  if (!base) return '';
  const gateway = env('MUSIC_GATEWAY_TOKEN') || 'music-gateway';

  app.use(PREFIX, requireBasicAuth, async (req, res) => {
    const [pathname, query] = req.originalUrl.split(/\?(.*)/s);
    if (pathname === PREFIX) return res.redirect(301, `${PREFIX}/${query ? `?${query}` : ''}`);
    // 播放器页面在它的根路径；接口和音频本来就在 /music/... 下面，原样转发
    const target = pathname === `${PREFIX}/` ? `/${query ? `?${query}` : ''}` : req.originalUrl;

    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (REQUEST_SKIP.has(k)) continue;
      if (k === 'authorization' && /^basic\s/i.test(String(v))) continue; // vesper 的登录不往下传
      headers[k] = Array.isArray(v) ? v.join(', ') : v;
    }
    headers['x-music-gateway'] = gateway;

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
      console.error('music proxy: 连不上播放器', err.message);
      return res.status(502).send('连不上音乐播放器，看一下 pm2 status 里它在不在跑。');
    }

    try {
      res.status(upstream.status);
      upstream.headers.forEach((value, key) => {
        if (RESPONSE_SKIP.has(key)) return;
        res.setHeader(key, key === 'location' ? rewriteLocation(value, base) : value);
      });
      const type = upstream.headers.get('content-type') || '';
      if (req.method !== 'HEAD' && upstream.body && type.includes('text/html')) {
        const html = rewriteHtml(await upstream.text());
        res.setHeader('cache-control', 'no-store');
        return res.end(html);
      }
      if (!upstream.body || req.method === 'HEAD') return res.end();
      // 音频走 Range 分段（206），这里原样流过去，拖进度条照常能用
      const stream = Readable.fromWeb(upstream.body);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (err) {
      if (ac.signal.aborted) return;
      console.error('music proxy: 转发出错', err.message);
      if (!res.headersSent) res.status(502).send('音乐播放器转发出错了，看一下 vesper 的日志。');
      else res.destroy();
    }
  });

  return base;
}
