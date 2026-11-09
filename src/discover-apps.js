// 发现页那些应用方块：网格本身、长按，和改名字 / 换图标的设置页。
//
// 小满 2026-11-04：「发现页面的所有功能能不能做成像手机应用一样的圆角方形，
// 每一个下面写着名称（不需要介绍词）一行四个。长按可以修改名称和图标」
//
// ── key 是定死的，不从名字或路径推 ──
//
// 改过的名字和图标按 key 存。要是拿「默认名字」或者「huref」当 key，
// 哪天改了默认名字、或者换了路径，她改过的那些就全对不上了——
// 和书架那次猜 localStorage 键名是同一类坑。所以 key 在 discover-page.js 里写死。
//
// ── 长按怎么认 ──
//
// touchstart 起一个 480ms 的计时，中间按住不动就算长按；手指一动、或者松得早
// 就撤掉，还是普通点击。长按触发过之后，松手那下浏览器还会补一次 click，
// 用 capture 阶段吞掉，不然会进设置页的同时又跳一次应用。
// 鼠标那边走 contextmenu（右键），算同一个入口。
// 没有 JavaScript 时长按不生效，点击照旧进应用——这一页本来就是一堆链接。
//
// 图标走和动态配图同一条路（my-photo.js 的 saveUserMomentImage）：
// 浏览器里先压好再传，服务器只认真正的图文件头。不再写一套上传。

import db from './state.js';
import { saveUserMomentImage } from './my-photo.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/discover/app';
// 一行四个，名字长了放不下。超过这个数的 CSS 会给它省略号
const MAX_NAME_CHARS = 8;

db.exec(`
CREATE TABLE IF NOT EXISTS discover_apps (
  key TEXT PRIMARY KEY,
  name TEXT,
  icon_url TEXT,
  updated_at INTEGER NOT NULL
);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 只放行本项目自己生成的媒体路径（和其他页同口径）
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio|avatars)\/[\w.-]+$/.test(url) ? url : null;
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

// 没换过图标时方块里那个字符。按 key 挑，认不出就用名字第一个字
const DEFAULT_GLYPH = {
  moments: '\u2726',
  music: '\u266a',
  dreams: '\u2601',
  books: '\u2709',
  games: '\u25c6',
  lamp: '\u273a',
  bar: '\u25cf',
  drives: '\u2727',
  jar: '\u2605',
  diary: '\u270e',
  wallet: '\u25a0',
  forum: '\u2630',
};

function overrideOf(key) {
  const row = stmt('SELECT name, icon_url FROM discover_apps WHERE key = ?').get(key);
  return {
    name: String(row?.name ?? '').trim(),
    iconUrl: safeMediaUrl(row?.icon_url),
  };
}

function saveOverride(key, { name, iconUrl }) {
  stmt('INSERT OR IGNORE INTO discover_apps (key, updated_at) VALUES (?, ?)').run(key, Date.now());
  stmt('UPDATE discover_apps SET name = ?, icon_url = ?, updated_at = ? WHERE key = ?')
    .run(name || null, iconUrl || null, Date.now(), key);
}

// 一个方块。spot 是 discover-page.js 那边给的 { key, name, href, external, note }
function renderApp(spot) {
  const o = overrideOf(spot.key);
  const name = o.name || spot.name;
  const label = escapeHtml(name);
  const face = o.iconUrl
    ? `<img src="${o.iconUrl}" alt="" loading="lazy" />`
    : `<span class="app-glyph" aria-hidden="true">${escapeHtml(
        DEFAULT_GLYPH[spot.key] || Array.from(name.trim())[0] || '\u2726'
      )}</span>`;

  // 没配好的不藏起来，只是淡下去、点不进；
  // 要知道差什么变量长按进设置页有写
  const tile = spot.href
    ? `<a class="app-tile" href="${escapeHtml(spot.href)}"${spot.external ? ' data-stars rel="noopener"' : ''}${
        spot.href === '/music/' ? ' data-no-stars' : ''
      } aria-label="${label}">${face}</a>`
    : `<span class="app-tile off" role="img" aria-label="${label}，还没配好">${face}</span>`;

  return `<div class="app" data-app="${escapeHtml(spot.key)}">
    ${tile}
    <span class="app-name">${label}</span>
  </div>`;
}

export function renderAppGrid(spots) {
  let html;
  try {
    html = spots.map(renderApp).join('');
  } catch (err) {
    console.error('discover: 渲染应用网格失败', err.message);
    return '';
  }
  return `<div class="apps">${html}</div>
  <p class="apps-hint">长按一个图标可以改名字和图标</p>`;
}

export const APPS_CSS = `
  /* 一行四个圆角方块。颜色全走 var()，跟着整屋的配色和早晚四张脸 */
  .apps { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px 8px; margin: 2px 0 0; }
  .app { display: flex; flex-direction: column; align-items: center; gap: 7px;
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; }
  .app-tile { position: relative; display: flex; align-items: center; justify-content: center;
    width: 78%; aspect-ratio: 1 / 1; overflow: hidden;
    /* 22% 比正圆角更贴近 iOS 图标那种弧度 */
    border-radius: 22%;
    background: var(--card, #fdfdfd); border: 1px solid var(--line, #e2e2e2);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.07);
    color: var(--accent, #4d4d4d); text-decoration: none;
    transition: transform 0.14s ease; }
  .app-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .app-glyph { font-size: 21px; line-height: 1; }
  .app-tile:active { transform: scale(0.93); }
  .app-tile.off { opacity: 0.4; }
  /* 名字只一行，长了省略号——折行会把下一排顶歪 */
  .app-name { max-width: 100%; font-size: 11.5px; line-height: 1.3; text-align: center;
    color: var(--ink, #252525); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .apps-hint { margin: 22px 0 0; font-size: 11px; text-align: center; color: var(--muted, #5e5e5e); }
  @media (prefers-reduced-motion: reduce) { .app-tile { transition: none; } .app-tile:active { transform: none; } }
`;

// 长按 480ms 进设置页。手指一动就算滑页，不算长按
export const APPS_SCRIPT = `(function () {
  var LONG = 480;
  document.querySelectorAll('[data-app]').forEach(function (el) {
    var key = el.getAttribute('data-app');
    var timer = null, fired = false;
    function go() {
      fired = true;
      location.href = '${PREFIX}/' + encodeURIComponent(key);
    }
    function clear() {
      if (timer) { clearTimeout(timer); timer = null; }
    }
    el.addEventListener('touchstart', function () {
      fired = false;
      clear();
      timer = setTimeout(go, LONG);
    }, { passive: true });
    el.addEventListener('touchmove', clear, { passive: true });
    el.addEventListener('touchend', clear);
    el.addEventListener('touchcancel', clear);
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); go(); });
    // 长按触发过了，松手那下浏览器补的 click 要吞掉，
    // 不然进设置页的同时又跳一次应用
    el.addEventListener('click', function (e) {
      if (!fired) return;
      e.preventDefault();
      e.stopPropagation();
      fired = false;
    }, true);
  });
})();`;

// ── 设置页 ──

const PICK_SCRIPT = `(function () {
  var MAX = 256;
  var form = document.querySelector('[data-icon-form]');
  if (!form) return;
  var file = form.querySelector('[data-icon-file]');
  var data = form.querySelector('[data-icon-data]');
  var status = form.querySelector('[data-icon-status]');
  var preview = form.querySelector('[data-icon-preview]');
  var box = form.querySelector('[data-icon-pick]');
  if (!file || !data) return;
  if (box) box.style.display = '';
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    data.value = '';
    if (!f) return;
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      // 裁成正方形：方块本身是方的，不裁的话长图会被截得很怪
      var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
      var c = document.createElement('canvas');
      c.width = MAX;
      c.height = MAX;
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, MAX, MAX);
      ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, MAX, MAX);
      data.value = c.toDataURL('image/jpeg', 0.86);
      URL.revokeObjectURL(url);
      if (preview) {
        preview.innerHTML = '';
        var el = new Image();
        el.alt = '';
        el.src = data.value;
        preview.appendChild(el);
      }
      if (status) status.textContent = '新图标选好了，点保存才会生效';
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      file.value = '';
      if (status) status.textContent = '这张图读不了，换一张试试';
    };
    img.src = url;
  });
})();`;

function layout(title, body, script = '') {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)} · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}
  :root { --ink: #252525; --muted: #5e5e5e; --accent: #4d4d4d; --gold: #818181;
    --card: #fdfdfd; --card-soft: #f2f2f2; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
  .card h2 { margin: 0 0 4px; font-size: 15px; color: var(--accent); letter-spacing: 0.1em; }
  .card .who { margin: 0 0 14px; font-size: 12px; color: var(--muted); }
  .field { display: grid; gap: 6px; margin-bottom: 14px; }
  .field label { font-size: 13px; color: var(--muted); }
  input[type="text"] { padding: 10px 12px; font: inherit; font-size: 16px; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  input[type="file"] { border: 0; padding: 4px 0; background: none; font-size: 14px; max-width: 100%; }
  .shot { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .shot-face { flex: none; display: flex; align-items: center; justify-content: center;
    width: 64px; height: 64px; border-radius: 22%; overflow: hidden;
    background: var(--card-soft); border: 1px solid var(--line); color: var(--accent); font-size: 26px; }
  .shot-face img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .status { margin: 10px 0 0; min-height: 1.2em; font-size: 13px; color: var(--accent); }
  .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 12px;
    background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; }
  button.ghost { background: none; color: var(--accent); border: 1px solid var(--line); }
  .back { display: inline-flex; align-items: center; min-height: 44px; font-size: 13px;
    color: var(--accent); text-decoration: none; }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  html[data-dark] input { background: var(--card); color: var(--ink); border-color: var(--line); }
  html[data-dark] button.ghost { color: var(--gold); }
</style>
</head>
<body><main>${renderMenu('/discover')}${body}</main>
${renderTabs('/discover')}
<script>${script}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

// spots 由 discover-page.js 传进来：设置页要知道这个 key 默认叫什么、配好了没有
export function registerDiscoverAppRoutes(app, { requireBasicAuth, spots }) {
  const find = (key) => spots().find((s) => s.key === key);

  app.get(`${PREFIX}/:key`, requireBasicAuth, (req, res) => {
    res.set('cache-control', 'no-store');
    const key = String(req.params.key);
    const spot = find(key);
    if (!spot) return res.status(404).send('没有这个入口');
    const o = overrideOf(key);
    const name = o.name || spot.name;
    const glyph = DEFAULT_GLYPH[key] || Array.from(name.trim())[0] || '\u2726';
    const face = o.iconUrl
      ? `<img src="${o.iconUrl}" alt="" />`
      : `<span aria-hidden="true">${escapeHtml(glyph)}</span>`;

    res.send(
      layout(
        name,
        `<section class="card">
      <h2>${escapeHtml(name)}</h2>
      <p class="who">默认叫「${escapeHtml(spot.name)}」${
          spot.href ? '' : `，${escapeHtml(spot.note || '还没接上')}`
        }</p>
      <form method="post" action="${PREFIX}/${encodeURIComponent(key)}" data-icon-form>
        <div class="shot">
          <span class="shot-face" data-icon-preview>${face}</span>
          <p class="hint">图标会裁成正方形，在手机里先缩小再上传。</p>
        </div>
        <div class="field">
          <label for="app-name">叫什么</label>
          <input id="app-name" type="text" name="name" maxlength="${MAX_NAME_CHARS}"
            value="${escapeHtml(o.name)}" placeholder="${escapeHtml(spot.name)}" autocomplete="off" />
        </div>
        <div class="field" data-icon-pick style="display:none">
          <label for="app-file">换图标</label>
          <input id="app-file" type="file" accept="image/*" data-icon-file />
          <input type="hidden" name="icon_data" data-icon-data />
        </div>
        <p class="hint">名字留空就用默认的，最多 ${MAX_NAME_CHARS} 个字。</p>
        <p class="status" role="status" data-icon-status>${req.query.saved === '1' ? '已保存' : ''}</p>
        <div class="acts">
          <button type="submit">保存</button>
          ${o.iconUrl ? '<button type="submit" name="drop_icon" value="1" class="ghost">恢复默认图标</button>' : ''}
          ${o.name || o.iconUrl ? '<button type="submit" name="reset" value="1" class="ghost">全部恢复默认</button>' : ''}
        </div>
      </form>
      <a class="back" href="/discover">\u2039 回发现</a>
    </section>`,
        PICK_SCRIPT
      )
    );
  });

  app.post(`${PREFIX}/:key`, requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');
    const key = String(req.params.key);
    if (!find(key)) return res.status(404).send('没有这个入口');
    const back = `${PREFIX}/${encodeURIComponent(key)}`;
    const now = overrideOf(key);
    try {
      if (req.body?.reset) {
        saveOverride(key, { name: '', iconUrl: null });
        return res.redirect(303, back);
      }
      const name = Array.from(String(req.body?.name ?? '').replace(/\s+/g, ' ').trim())
        .slice(0, MAX_NAME_CHARS)
        .join('');

      let iconUrl = now.iconUrl;
      if (req.body?.drop_icon) {
        iconUrl = null;
      } else {
        const raw = String(req.body?.icon_data ?? '').trim();
        if (raw) {
          const r = saveUserMomentImage(raw);
          if (r.error) {
            console.error('discover: 存图标失败 —', r.error);
            return res.redirect(303, back);
          }
          iconUrl = r.url;
        }
      }
      saveOverride(key, { name, iconUrl });
    } catch (err) {
      console.error('discover: 保存入口失败', err);
      return res.status(500).send('保存失败了，看一下 vesper 的日志。');
    }
    res.redirect(303, `${back}?saved=1`);
  });

  console.log(`discover: 入口设置页 ${PREFIX}/:key`);
}
