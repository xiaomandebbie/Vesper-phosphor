// 动态页最上面那张纪念日卡，和它的设置页 /moments/anniversary。
//
// 小满 2026-11-04：「在晨暮星标题和允朔此刻：… 之间加一个纪念日」
// 样子按她给的那张图：TOGETHER · 在一起、两个头像夹一颗心、
// 大字的天数、底下一行小字，整张浮在一张背景图上。
//
// ── 几个定下来的做法 ──
//
// 天数现算，不存字段。和梦的「消散」同一个道理（见 dreams.js）：
// 那不是某一刻发生的动作，是一个事实——读的时候算一下就知道，
// 不需要谁在半夜跑个定时任务给它加一。
//
// 开始那天算第 1 天，不是第 0 天。对着她那张图核过：
// 2026.10.02 到 11.01 显示「第 31 天」，所以是间隔天数 + 1。
//
// 老的 anniversaries 表（moments-store.js）和 /wake/anniversaries 接口一行没动。
// 那张表是「一串日子」，这张卡是「置顶那一个」，两回事；
// 挤在一起要么得挑哪一条置顶、要么得给那张表加字段，不如单独一行记录。
//
// 背景图走和动态配图同一条路（my-photo.js 的 saveUserMomentImage）：
// 浏览器里先压好再传，服务器只认真正的图文件头。不再写一套上传。

import db from './state.js';
import { getProfile } from './moments-store.js';
import { saveUserMomentImage } from './my-photo.js';
import { wallParts, parseDate, daysBetween, pad } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { TABS_CSS } from './tabs.js';

const PREFIX = '/moments/anniversary';
const MAX_LABEL_CHARS = 16;

db.exec(`
CREATE TABLE IF NOT EXISTS anniversary (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  started_on TEXT,
  label TEXT,
  image_url TEXT,
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

// 只放行本项目自己生成的媒体路径（和 moments-page.js 同口径）
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio|avatars)\/[\w.-]+$/.test(url) ? url : null;
}

// Basic Auth 下别的网站也能偷偷替你提交表单，所以写操作只接受同源提交
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function getAnniversary() {
  const row = stmt('SELECT started_on, label, image_url FROM anniversary WHERE id = 1').get();
  return {
    startedOn: row?.started_on || '',
    label: String(row?.label ?? '').trim() || '在一起',
    imageUrl: row?.image_url || null,
  };
}

function saveAnniversary({ startedOn, label, imageUrl }) {
  stmt('INSERT OR IGNORE INTO anniversary (id, updated_at) VALUES (1, ?)').run(Date.now());
  stmt('UPDATE anniversary SET started_on = ?, label = ?, image_url = ?, updated_at = ? WHERE id = 1')
    .run(startedOn || null, label || null, imageUrl || null, Date.now());
}

// 头像：设过就用图片，没设就是名字第一个字。
// 这张卡上不写名字，所以给读屏留一句
function faceHtml(who) {
  const p = getProfile(who);
  const url = safeMediaUrl(p.avatarUrl);
  const alt = `${p.name}的头像`;
  if (url) return `<img class="anniv-face" src="${url}" alt="${escapeHtml(alt)}" loading="lazy" />`;
  const first = Array.from(p.name.trim())[0] || '?';
  return `<span class="anniv-face anniv-face-blank" role="img" aria-label="${escapeHtml(alt)}">${escapeHtml(first)}</span>`;
}

// “2026.10.02”
const dotted = (p) => `${p.y}.${pad(p.m)}.${pad(p.d)}`;

// 第几天。开始那天是第 1 天。
// 日子填在未来时返回负数，谁调谁处理
function dayNumber(start, now = wallParts()) {
  return daysBetween(start, { y: now.y, m: now.m, d: now.d }) + 1;
}

// 动态页顶上那张卡。没设日子时只留一行淡入口，
// 不占地方也不至于没入口可进
export function renderAnniversaryCard() {
  let a;
  try {
    a = getAnniversary();
  } catch (err) {
    console.error('anniversary: 读不到纪念日', err.message);
    return '';
  }
  if (!a.startedOn) {
    return `<a class="anniv-set" href="${PREFIX}"><span aria-hidden="true">\u2726</span> 设个纪念日 ›</a>`;
  }
  const start = parseDate(a.startedOn);
  if (!start) return '';

  const n = dayNumber(start);
  const big = n >= 1 ? String(n) : String(1 - n);
  const foot = n >= 1
    ? `${escapeHtml(a.label)}的第 ${n} 天 · ${dotted(start)} —`
    : `还有 ${1 - n} 天 · ${dotted(start)}`;
  const bg = safeMediaUrl(a.imageUrl);

  return `<a class="anniv${bg ? ' has-bg' : ''}" href="${PREFIX}"${bg ? ` style="background-image:url('${bg}')"` : ''} aria-label="${escapeHtml(foot)}，点开改日子和背景图">
    <span class="anniv-inner">
      <span class="anniv-label" aria-hidden="true">TOGETHER · ${escapeHtml(a.label)}</span>
      <span class="anniv-faces">${faceHtml('assistant')}<i class="anniv-heart" aria-hidden="true">\u2661</i>${faceHtml('user')}</span>
      <span class="anniv-num" aria-hidden="true">${big}</span>
      <span class="anniv-foot">${foot}</span>
    </span>
  </a>`;
}

export const ANNIVERSARY_CSS = `
  /* 纪念日卡。颜色全走 var()：跟着整屋的配色和早晚四张脸，
     不写死粉或灰——她在 VPS 上把配色换成过灰阶，写死就不跟了 */
  .anniv { position: relative; display: block; overflow: hidden; margin: 16px auto 4px; padding: 0;
    border-radius: 20px; text-decoration: none; color: inherit;
    background: var(--card-soft, #f3eef2) center/cover no-repeat;
    box-shadow: 0 2px 10px rgba(60, 30, 60, 0.1); }
  .anniv:active { transform: scale(0.995); }
  /* 没背景图时给一层淡淡的底，别是一块死灰 */
  .anniv:not(.has-bg) { background:
    radial-gradient(120% 80% at 20% 15%, var(--card, #fffdfb), transparent 70%),
    radial-gradient(100% 70% at 85% 90%, var(--accent-soft, #f3eef2), transparent 72%),
    var(--card-soft, #f3eef2); }
  /* 毛玻璃那一层。backdrop-filter 不支持时退回半透的底色，字照样认得出 */
  .anniv-inner { position: relative; display: block; padding: 22px 20px 18px; text-align: center;
    background: rgba(255, 255, 255, 0.34); }
  @supports ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
    .anniv-inner { -webkit-backdrop-filter: blur(14px) saturate(1.1); backdrop-filter: blur(14px) saturate(1.1);
      background: rgba(255, 255, 255, 0.22); }
  }
  html[data-dark] .anniv-inner { background: rgba(20, 14, 30, 0.34); }
  .anniv-label { display: block; font-size: 11px; letter-spacing: 0.3em; padding-left: 0.3em;
    color: var(--muted, #665a70); }
  .anniv-faces { display: flex; align-items: center; justify-content: center; gap: 14px; margin: 14px 0 6px; }
  .anniv-face { width: 62px; height: 62px; border-radius: 50%; object-fit: cover; flex: none;
    border: 2px solid rgba(255, 255, 255, 0.82); box-shadow: 0 2px 8px rgba(60, 30, 60, 0.16); }
  .anniv-face-blank { display: inline-flex; align-items: center; justify-content: center;
    background: var(--card, #fffdfb); color: var(--accent, #7a3e5d); font-size: 22px; font-weight: 600; }
  .anniv-heart { font-style: normal; font-size: 17px; color: var(--gold, #b7792f); }
  /* 天数：这张卡的主角。转数字用衬线体，和她图里那个 31 一个调 */
  .anniv-num { display: block; font-family: "Didot", "Bodoni 72", "Times New Roman", Georgia, serif;
    font-size: 64px; line-height: 1.05; font-weight: 400; letter-spacing: 0.02em;
    color: var(--ink, #2b2233); font-variant-numeric: tabular-nums; }
  .anniv-foot { display: block; margin-top: 6px; font-size: 12px; color: var(--muted, #665a70); }
  /* 没设日子时那一行 */
  .anniv-set { display: flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 44px; margin: 12px auto 0; width: fit-content; padding: 0 16px; border-radius: 999px;
    font-size: 13px; color: var(--muted, #665a70); text-decoration: none;
    border: 1px dashed var(--line, #eadfe6); }
  .anniv-set:active { background: var(--card-soft, #f3eef2); }
  /* ── 字看不清的修法（2026-11-04）──
     两个原因叠在一起：backdrop-filter 把背景图糊成一团（她挑图就是想看见图），
     而文字还是深灰的，压在暗背景上就没了。
     所以：模糊去掉；有背景图时盖一层暗遮罩、字换白的。
     背景图是随手挑的，亮暗不可控，只有「压暗 + 白字」在任何图上都认得出。
     没背景图那张卡照旧走浅底深字，不受影响。 */
  .anniv-inner { -webkit-backdrop-filter: none; backdrop-filter: none; }
  /* 背景图上什么都不盖（2026-11-04：「完全不要灰色，字可以用灰色」）。
     字还是灰的，只给一道极淡的白描边把它从花纹里拎出来——
     那是沿着字形的一圈，不是一块底色。 */
  .anniv.has-bg .anniv-inner { background: none; }
  .anniv.has-bg .anniv-label, .anniv.has-bg .anniv-foot, .anniv.has-bg .anniv-num,
  .anniv.has-bg .anniv-heart { text-shadow: 0 1px 2px rgba(255, 255, 255, 0.85); }
  @media (prefers-reduced-motion: reduce) { .anniv:active { transform: none; } }
`;

// ── 设置页 ──
// 选了图就在浏览器里缩到长边 1280 再传，和头像那边一个做法（canvas）。
// 没有 JavaScript 时这个入口整个隐起来，日子还是能改——日期是普通表单。
const PICK_SCRIPT = `(function () {
  var MAX = 1280;
  var form = document.querySelector('[data-anniv-form]');
  if (!form) return;
  var file = form.querySelector('[data-anniv-file]');
  var data = form.querySelector('[data-anniv-data]');
  var status = form.querySelector('[data-anniv-status]');
  var box = form.querySelector('[data-anniv-pick]');
  if (!file || !data) return;
  if (box) box.style.display = '';
  file.addEventListener('change', function () {
    var f = file.files && file.files[0];
    data.value = '';
    if (!f) return;
    var url = URL.createObjectURL(f);
    var img = new Image();
    img.onload = function () {
      var w = img.naturalWidth, h = img.naturalHeight;
      var k = Math.min(1, MAX / Math.max(w, h));
      var c = document.createElement('canvas');
      c.width = Math.round(w * k);
      c.height = Math.round(h * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      data.value = c.toDataURL('image/jpeg', 0.84);
      URL.revokeObjectURL(url);
      if (status) status.textContent = '背景图选好了，点保存才会生效';
    };
    img.onerror = function () {
      URL.revokeObjectURL(url);
      file.value = '';
      if (status) status.textContent = '这张图读不了，换一张试试';
    };
    img.src = url;
  });
})();`;

function layout(body, script = '') {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>纪念日 · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --card-soft: #f3eef2; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); }
  .card h2 { margin: 0 0 12px; font-size: 15px; color: var(--accent); letter-spacing: 0.1em; }
  .field { display: grid; gap: 6px; margin-bottom: 14px; }
  .field label { font-size: 13px; color: var(--muted); }
  input[type="date"], input[type="text"] { padding: 10px 12px; font: inherit; font-size: 16px;
    color: var(--ink); background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  input[type="file"] { border: 0; padding: 4px 0; background: none; font-size: 14px; max-width: 100%; }
  .hint { margin: 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .status { margin: 10px 0 0; min-height: 1.2em; font-size: 13px; color: var(--accent); }
  .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
  button { min-height: 44px; padding: 0 18px; border: 0; border-radius: 12px;
    background: var(--accent); color: #fff; font-size: 15px; cursor: pointer; }
  button.ghost { background: none; color: var(--accent); border: 1px solid var(--line); }
  .preview { margin-top: 12px; }
  a:focus-visible, button:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  html[data-dark] input { background: var(--card); color: var(--ink); border-color: var(--line); }
  html[data-dark] button.ghost { color: var(--gold); }
${ANNIVERSARY_CSS}
</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
<script>${script}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

function settingsPage(saved) {
  const a = getAnniversary();
  const hasBg = Boolean(safeMediaUrl(a.imageUrl));
  return layout(
    `<section class="card">
      <h2>纪念日</h2>
      <form method="post" action="${PREFIX}" data-anniv-form>
        <div class="field">
          <label for="anniv-date">从哪天开始</label>
          <input id="anniv-date" type="date" name="started_on" value="${escapeHtml(a.startedOn)}" />
        </div>
        <div class="field">
          <label for="anniv-label">叫什么</label>
          <input id="anniv-label" type="text" name="label" maxlength="${MAX_LABEL_CHARS}"
            value="${escapeHtml(a.label)}" placeholder="在一起" autocomplete="off" />
        </div>
        <div class="field" data-anniv-pick style="display:none">
          <label for="anniv-file">背景图</label>
          <input id="anniv-file" type="file" accept="image/*" data-anniv-file />
          <input type="hidden" name="image_data" data-anniv-data />
        </div>
        <p class="hint">开始那天算第 1 天。背景图会在手机里先缩小再上传；不传就用淡色的底。</p>
        <p class="status" role="status" data-anniv-status>${saved ? '已保存' : ''}</p>
        <div class="acts">
          <button type="submit">保存</button>
          ${hasBg ? '<button type="submit" name="drop_image" value="1" class="ghost">去掉背景图</button>' : ''}
          ${a.startedOn ? '<button type="submit" name="clear" value="1" class="ghost">不要这张卡了</button>' : ''}
        </div>
      </form>
      <div class="preview">${renderAnniversaryCard()}</div>
    </section>`,
    PICK_SCRIPT
  );
}

export function registerAnniversaryRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('cache-control', 'no-store');
    try {
      res.send(settingsPage(req.query.saved === '1'));
    } catch (err) {
      console.error('anniversary: 渲染设置页失败', err);
      res.status(500).send('纪念日这页出错了，看一下 vesper 的日志。');
    }
  });

  app.post(PREFIX, requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');
    const now = getAnniversary();
    try {
      if (req.body?.clear) {
        saveAnniversary({ startedOn: '', label: '', imageUrl: null });
        return res.redirect(303, PREFIX);
      }
      // 日期认不出来就留着原来那个，不把已经设好的洗成空
      const picked = parseDate(String(req.body?.started_on ?? '').trim());
      const startedOn = picked
        ? `${picked.y}-${pad(picked.m)}-${pad(picked.d)}`
        : now.startedOn;
      const label = Array.from(String(req.body?.label ?? '').replace(/\s+/g, ' ').trim())
        .slice(0, MAX_LABEL_CHARS)
        .join('');

      let imageUrl = now.imageUrl;
      if (req.body?.drop_image) {
        imageUrl = null;
      } else {
        const raw = String(req.body?.image_data ?? '').trim();
        if (raw) {
          const r = saveUserMomentImage(raw);
          if (r.error) {
            console.error('anniversary: 存背景图失败 —', r.error);
            return res.redirect(303, PREFIX);
          }
          imageUrl = r.url;
        }
      }
      saveAnniversary({ startedOn, label, imageUrl });
    } catch (err) {
      console.error('anniversary: 保存失败', err);
      return res.status(500).send('保存失败了，看一下 vesper 的日志。');
    }
    res.redirect(303, `${PREFIX}?saved=1`);
  });

  console.log(`anniversary: 纪念日设置页 ${PREFIX}`);
}
