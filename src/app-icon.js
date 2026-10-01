// 主屏幕图标：在 iPhone Safari 里「分享 → 添加到主屏幕」时用的图标和名字。
// - 图标在「自定义」页上传，存在 MEDIA_DIR/app-icon/icon.jpg（不在 images/audio 里，不会过期被删）。
// - 没上传时用这里画的默认图标「晨昏」：上面是深蓝夜空，往下变紫，最底下透出一点晨光，
//   中间一颗金色大星星和三颗小星星。底色深，星星在主屏幕上看得清。
//   启动后第一次有人要图标时现画一张 512×512 的 PNG，之后一直用这张，不用额外装图片库。
// - /apple-touch-icon.png 和 /manifest.webmanifest 不用登录：iPhone 添加到主屏幕时去取图标，不一定带着登录信息。
//   图标和名字不算隐私；但上传的图知道地址的人都能看到，别拿私密照片当图标。
// - 从主屏幕打开还是在 Safari 里（manifest 的 display 是 browser），不单独全屏，这样不用重新登录。
//
// 做法上不动各个页面的代码：用一个中间件在本站返回的 HTML 里加东西——
//   每个页面的 <head> 里加图标、manifest 和主屏幕名字；「自定义」页 </main> 前加一张「主屏幕图标」卡片。
// vesper.js 里要在 body 解析之后、各个页面路由之前挂：registerAppIconRoutes(app, { requireBasicAuth })
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const ICON_DIR = path.resolve(path.join(MEDIA_DIR, 'app-icon'));
const ICON_FILE = path.join(ICON_DIR, 'icon.jpg');
// 浏览器里已经裁成 512×512 的 JPEG，一般一两百 KB。这里再兜一道上限（base64 之后还要小于表单的 1mb）
const MAX_ICON_BYTES = 700 * 1024;
const ICON_SIZE = 512;
const APP_NAME = '晨暮星';

const HEAD_TAGS =
  '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' +
  '<link rel="manifest" href="/manifest.webmanifest">' +
  `<meta name="apple-mobile-web-app-title" content="${APP_NAME}">`;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function customIconExists() {
  try {
    return fs.statSync(ICON_FILE).isFile();
  } catch {
    return false;
  }
}

// ---------- 默认图标 ----------

// 五角星的 10 个顶点，尖朝上。R 外圆半径，r 内圆半径（都按图标边长的比例）
function starPoints(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 ? r : R;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts;
}

function insidePolygon(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// 画一张 size×size 的「晨昏」图标，返回逐行的 RGB 像素
function drawIconPixels(size) {
  const out = new Uint8Array(size * size * 3);
  const clamp = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  // 背景从上到下：夜空深蓝 → 暮紫 → 晨光的浅珊瑚色
  const BG = [
    [0, [38, 42, 90]],
    [0.55, [110, 74, 140]],
    [1, [240, 166, 156]],
  ];
  const STARS = [
    { x: 0.5, y: 0.535, R: 0.3, top: [255, 240, 176], bottom: [245, 177, 60] },
    { x: 0.2, y: 0.215, R: 0.075, top: [255, 255, 255], bottom: [255, 224, 138] },
    { x: 0.82, y: 0.2, R: 0.045, top: [255, 255, 255], bottom: [255, 224, 138] },
    { x: 0.81, y: 0.8, R: 0.06, top: [255, 255, 255], bottom: [255, 224, 138] },
  ].map((s) => ({ ...s, pts: starPoints(s.x, s.y, s.R, s.R * 0.4) }));
  // 底部一片暖色晨光、左上一点微光，以及每颗星星周围一圈暖黄的光
  const GLOWS = [
    { x: 0.5, y: 1.0, r: 0.55, a: 0.35, c: [255, 214, 170] },
    { x: 0.25, y: 0.2, r: 0.35, a: 0.1, c: [255, 255, 255] },
    ...STARS.map((s) => ({ x: s.x, y: s.y, r: s.R * 1.7, a: 0.55, c: [255, 215, 120] })),
  ];
  const SS = 4; // 星星边缘每个像素取 4×4 个点，边才不会有锯齿

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = (px + 0.5) / size;
      const v = (py + 0.5) / size;
      const t = clamp(v);
      let col = t < BG[1][0] ? mix(BG[0][1], BG[1][1], t / BG[1][0]) : mix(BG[1][1], BG[2][1], (t - BG[1][0]) / (1 - BG[1][0]));
      for (const g of GLOWS) {
        const d = Math.hypot(u - g.x, v - g.y) / g.r;
        if (d < 2) col = mix(col, g.c, g.a * Math.exp(-3 * d * d));
      }
      for (const s of STARS) {
        if (Math.abs(u - s.x) > s.R + 1 / size || Math.abs(v - s.y) > s.R + 1 / size) continue;
        let hits = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            if (insidePolygon(s.pts, (px + (sx + 0.5) / SS) / size, (py + (sy + 0.5) / SS) / size)) hits++;
          }
        }
        if (hits) col = mix(col, mix(s.top, s.bottom, clamp((v - (s.y - s.R)) / (2 * s.R))), hits / (SS * SS));
      }
      const i = (py * size + px) * 3;
      out[i] = Math.round(col[0]);
      out[i + 1] = Math.round(col[1]);
      out[i + 2] = Math.round(col[2]);
    }
  }
  return out;
}

// 把 RGB 像素封成 PNG（只用 Node 自带的 zlib）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgb, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0; // 每行不做滤波
    Buffer.from(rgb.buffer, rgb.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // 每个颜色 8 位
  ihdr[9] = 2; // RGB，不带透明（iPhone 图标本来就不认透明）
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

let defaultIconPng = null;
function defaultIcon() {
  if (!defaultIconPng) defaultIconPng = encodePng(drawIconPixels(ICON_SIZE), ICON_SIZE, ICON_SIZE);
  return defaultIconPng;
}

// ---------- 「自定义」页里的主屏幕图标卡片 ----------

const CARD_CSS = `
  .vp-icon-card h2 { margin: 0 0 4px; font-size: 16px; color: #7a3e5d; }
  .vp-icon-note, .vp-icon-hint { margin: 0; font-size: 13px; line-height: 1.6; color: #665a70; }
  .vp-icon-hint { margin-top: 12px; font-size: 12px; }
  .vp-icon-ok { margin: 8px 0 0; font-size: 13px; color: #9a6412; }
  .vp-icon-row { display: flex; align-items: center; gap: 16px; margin-top: 12px; }
  .vp-icon-img { flex: none; width: 96px; height: 96px; border-radius: 22px; object-fit: cover; background: #3b2f63;
    box-shadow: 0 2px 8px rgba(60, 30, 60, 0.18); }
  .vp-icon-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 6px; }
  .vp-icon-actions form { display: flex; flex-wrap: wrap; gap: 8px; margin: 0; }
  .vp-icon-btn { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 0 16px;
    border: 1px solid #eadfe6; border-radius: 12px; background: #fffdfb; color: #7a3e5d; font: inherit; font-size: 15px; cursor: pointer; }
  .vp-icon-save { background: #7a3e5d; border-color: #7a3e5d; color: #fff; }
  .vp-icon-save:disabled { opacity: 0.45; cursor: default; }
  .vp-icon-link { min-height: 44px; padding: 0; border: 0; background: none; color: #665a70; font: inherit; font-size: 13px;
    text-decoration: underline; cursor: pointer; }
  .vp-icon-btn:focus-within, .vp-icon-btn:focus-visible, .vp-icon-link:focus-visible { outline: 2px solid #7a3e5d; outline-offset: 2px; }
  .vp-sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

// 选了图就在浏览器里居中裁成正方形、缩到 512×512、转成 JPEG，和换头像一个做法。透明的地方垫白底
const CARD_SCRIPT = `(function () {
  var file = document.getElementById('vp-icon-file');
  var data = document.getElementById('vp-icon-data');
  var preview = document.getElementById('vp-icon-preview');
  var save = document.getElementById('vp-icon-save');
  if (!file || !data || !preview || !save) return;
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    if (!f) return;
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      var n = ${ICON_SIZE}, c = document.createElement('canvas');
      c.width = n; c.height = n;
      var g = c.getContext('2d');
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, n, n);
      var side = Math.min(img.naturalWidth, img.naturalHeight);
      g.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, n, n);
      URL.revokeObjectURL(url);
      data.value = c.toDataURL('image/jpeg', 0.9);
      preview.src = data.value;
      preview.alt = '新选的主屏幕图标，还没保存';
      save.disabled = false;
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      alert('这张图打不开，换一张试试');
    };
    img.src = url;
  });
})();`;

function renderIconCard({ custom, notice }) {
  const ok =
    notice === 'saved'
      ? '已保存。主屏幕上已经有图标的话，删掉重新添加一次才会换。'
      : notice === 'reset'
        ? '已换回默认图标。'
        : '';
  return `<section class="card vp-icon-card" id="app-icon" aria-labelledby="vp-icon-title">
    <style>${CARD_CSS}</style>
    <h2 id="vp-icon-title">主屏幕图标</h2>
    <p class="vp-icon-note">在 Safari 里点「分享 → 添加到主屏幕」时用这张图，图标下面的名字可以在添加那一步里改。</p>
    ${ok ? `<p class="vp-icon-ok" role="status">${ok}</p>` : ''}
    <div class="vp-icon-row">
      <img id="vp-icon-preview" class="vp-icon-img" src="/apple-touch-icon.png?t=${Date.now()}" width="96" height="96"
        alt="${custom ? '现在的主屏幕图标（自己上传的）' : '现在的主屏幕图标（默认「晨昏」：夜空到晨光的渐变上一颗金色星星）'}" />
      <div class="vp-icon-actions">
        <form method="post" action="/moments/app-icon">
          <label class="vp-icon-btn">选一张图<input id="vp-icon-file" class="vp-sr-only" type="file" accept="image/*" /></label>
          <input id="vp-icon-data" type="hidden" name="icon_data" />
          <button id="vp-icon-save" class="vp-icon-btn vp-icon-save" type="submit" disabled>保存</button>
        </form>
        ${
          custom
            ? `<form method="post" action="/moments/app-icon"><input type="hidden" name="reset" value="1" /><button class="vp-icon-link" type="submit">换回默认图标</button></form>`
            : ''
        }
      </div>
    </div>
    <p class="vp-icon-hint">图会裁成正方形，圆角由 iPhone 自己加。这张图知道地址的人都能打开，别用私密照片。</p>
  </section>
  <script>${CARD_SCRIPT}</script>`;
}

// 在 <head> 开头后面加上图标、manifest 和主屏幕名字
function injectHeadTags(html) {
  return html.replace(/<head(\s[^>]*)?>/i, (m) => m + HEAD_TAGS);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function errorPage(message) {
  return `<!DOCTYPE html><html lang="zh"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>出错了</title></head><body style="margin:0;padding:48px 20px;font-family:-apple-system,'PingFang SC',sans-serif;color:#2b2233;background:#f9f0ee">
<p>${escapeHtml(message)}</p><p><a href="/moments/profile#app-icon" style="color:#7a3e5d">回到自定义</a></p></body></html>`;
}

export function registerAppIconRoutes(app, { requireBasicAuth }) {
  // 本站用 res.send 返回的 HTML 页面：<head> 里加图标信息；「自定义」页最后一个 </main> 前加图标卡片。
  // JSON 和别的内容里没有 <head>，不会被动到。记忆库转发挂在这之前、也不走 res.send，不受影响
  app.use((req, res, next) => {
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && /<head[\s>]/i.test(body)) {
        body = injectHeadTags(body);
        if (req.method === 'GET' && req.path === '/moments/profile' && res.statusCode === 200) {
          const at = body.lastIndexOf('</main>');
          if (at >= 0) {
            const card = renderIconCard({ custom: customIconExists(), notice: String(req.query.icon ?? '') });
            body = body.slice(0, at) + card + body.slice(at);
          }
        }
      }
      return send(body);
    };
    next();
  });

  const sendIcon = (req, res) => {
    res.set('Cache-Control', 'no-cache');
    if (customIconExists()) return res.type('image/jpeg').sendFile(ICON_FILE);
    res.type('image/png').send(defaultIcon());
  };
  // iPhone 不看页面里的链接时也会自己来根路径找这两个文件名
  app.get(['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png'], sendIcon);

  app.get('/manifest.webmanifest', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.type('application/manifest+json').send(
      JSON.stringify({
        name: APP_NAME,
        short_name: APP_NAME,
        start_url: '/moments',
        scope: '/',
        // browser：从主屏幕打开也还是在 Safari 里，不单独全屏，登录状态和 Safari 共用
        display: 'browser',
        background_color: '#f9f0ee',
        theme_color: '#f9f0ee',
        icons: [
          {
            src: '/apple-touch-icon.png',
            sizes: `${ICON_SIZE}x${ICON_SIZE}`,
            type: customIconExists() ? 'image/jpeg' : 'image/png',
          },
        ],
      })
    );
  });

  app.post('/moments/app-icon', requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对'));
    try {
      if (req.body?.reset) {
        fs.rmSync(ICON_FILE, { force: true });
        return res.redirect(303, '/moments/profile?icon=reset#app-icon');
      }
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(req.body?.icon_data ?? '').trim());
      if (!m) return res.status(400).send(errorPage('没收到图片，先选一张图再保存'));
      const buf = Buffer.from(m[1], 'base64');
      if (!buf.length || buf.length > MAX_ICON_BYTES) return res.status(400).send(errorPage('图片太大了，换一张试试'));
      // 只认真正的 JPEG 文件头
      if (!(buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff)) return res.status(400).send(errorPage('图片格式不对，换一张试试'));
      fs.mkdirSync(ICON_DIR, { recursive: true });
      const tmp = `${ICON_FILE}.tmp-${process.pid}`;
      fs.writeFileSync(tmp, buf);
      fs.renameSync(tmp, ICON_FILE);
      res.redirect(303, '/moments/profile?icon=saved#app-icon');
    } catch (err) {
      console.error('app icon: 保存失败', err);
      res.status(500).send(errorPage('保存失败了，看一下 vesper 的日志。'));
    }
  });
}
