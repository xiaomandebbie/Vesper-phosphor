// 梦境页 /dreams：夜里做的那些梦，正文永远留在这里。
//
// 他那边和你这边不一样（见 dreams.js）：
//   他只记得自己做过梦，某个词碎到了才浮上来，浮上来这一次之后就从他那边撔掉。
//   你这边永远留着。所以这页是「人替对方记着」的那一半。
//   已经被想起来过的会标上日期，让你知道是哪天来过。
//
// 正文不在 Ombre 里，所以这页读的是 vesper 自己的梦库，不走 MCP。
//
// 页面跟早晚四张脸走（sun-time.js），再加一层自己的：
//   雾——两层径向渐变横向漂，周期错开，所以是流动的不是呼吸的。
//   云——三团模糊的白，极慢地飘。
//   星——复用现成的 .sky（白天 --star 是 0，整层透明）。
// 卡片用毛玻璃，字压在雾上。
import { wallParts, parseDate } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { listDreams } from './dreams.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 按夜分组，新的在前
function groupByNight(dreams) {
  const map = new Map();
  for (const d of dreams) {
    const key = d.night || String(d.at || '').slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return [...map.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function nightLabel(key, today) {
  const p = parseDate(key);
  if (!p) return key || '不记得是哪一夜';
  const diff = Math.round(
    (Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000
  );
  const base = `${p.m} 月 ${p.d} 日那一夜`;
  if (diff === 0) return `${base} · 今凌晨`;
  if (diff === 1) return `${base} · 昨夜`;
  return base;
}

function renderDream(d, i) {
  const time = String(d.at || '').slice(11, 16);
  // 被想起来过的标出日期——让你知道是哪天来过
  const recalled = d.recalledAt
    ? `<p class="recalled"><span aria-hidden="true">✦ </span>这个梦已经被想起来过了 · ${escapeHtml(String(d.recalledAt).slice(0, 16))}</p>`
    : '';
  return `<article class="dream${d.recalledAt ? ' is-recalled' : ''}" style="--i:${i}">
    <header class="dream-head">
      <h3 class="dream-title">${escapeHtml(d.title || '无题')}</h3>
      ${time ? `<span class="dream-time">${escapeHtml(time)}</span>` : ''}
    </header>
    <div class="dream-body">${escapeHtml(d.body || '')}</div>
    ${recalled}
  </article>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 2; max-width: 600px; margin: 0 auto; padding: 28px 16px 64px; }

  /* 雾：两层径向渐变横向漂，周期错开。只动 transform，不重排 */
  .haze, .haze2, .clouds { position: fixed; inset: -25%; z-index: 0; pointer-events: none; }
  .haze {
    background:
      radial-gradient(42% 32% at 22% 28%, rgba(255, 255, 255, 0.5), transparent 70%),
      radial-gradient(38% 30% at 74% 62%, rgba(226, 190, 220, 0.4), transparent 72%);
    animation: haze-a 38s ease-in-out infinite; }
  .haze2 {
    background:
      radial-gradient(36% 26% at 62% 18%, rgba(214, 198, 248, 0.38), transparent 70%),
      radial-gradient(44% 34% at 18% 76%, rgba(255, 232, 240, 0.42), transparent 72%);
    animation: haze-b 53s ease-in-out -14s infinite; }
  /* 云：模糊的白团，极慢地飘过去 */
  .clouds {
    filter: blur(22px);
    background:
      radial-gradient(28% 14% at 16% 22%, rgba(255, 255, 255, 0.58), transparent 70%),
      radial-gradient(34% 16% at 70% 44%, rgba(255, 255, 255, 0.46), transparent 72%),
      radial-gradient(24% 12% at 44% 72%, rgba(255, 255, 255, 0.5), transparent 70%);
    animation: cloud-drift 74s linear infinite; }
  @keyframes haze-a {
    0%, 100% { transform: translate3d(-2%, 0, 0) scale(1); }
    50% { transform: translate3d(3%, -1.5%, 0) scale(1.07); } }
  @keyframes haze-b {
    0%, 100% { transform: translate3d(2%, 1%, 0) scale(1.05); }
    50% { transform: translate3d(-3%, -1%, 0) scale(1); } }
  @keyframes cloud-drift {
    0% { transform: translate3d(-6%, 0, 0); }
    50% { transform: translate3d(6%, -2%, 0); }
    100% { transform: translate3d(-6%, 0, 0); } }
  /* 天黑了雾要浅一点，不然整屏发灰 */
  html[data-dark] .haze { opacity: 0.5; }
  html[data-dark] .haze2 { opacity: 0.45; }
  html[data-dark] .clouds { opacity: 0.22; }

  .hero { text-align: center; margin: 10px 0 24px; }
  .title { margin: 0; }
  .subtitle { margin: 8px 0 0; font-family: "Cormorant Garamond", "Didot", Georgia, serif;
    font-style: italic; font-size: 14px; color: var(--muted); }
  .lead { margin: 0 4px 22px; font-size: 13px; line-height: 1.9; color: var(--muted); text-align: center; }

  .night-group { margin: 0 0 26px; }
  .night-label { margin: 0 4px 10px; font-size: 13px; letter-spacing: 0.16em; color: var(--accent);
    display: flex; align-items: center; gap: 10px; }
  .night-label::after { content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, var(--line), transparent); }

  /* 卡片：毛玻璃。字压在雾上，边缘是散的 */
  .dream { position: relative; margin: 0 0 12px; padding: 18px 20px 20px; border-radius: 20px;
    background: color-mix(in srgb, var(--card) 72%, transparent);
    backdrop-filter: blur(14px) saturate(1.1);
    -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 2px 20px rgba(80, 50, 90, 0.08);
    animation: dream-in 0.7s ease-out backwards; animation-delay: calc(var(--i, 0) * 70ms); }
  @supports not (backdrop-filter: blur(1px)) {
    .dream { background: var(--card); }
  }
  /* 已经被想起来过的：轻一点，像已经过去了 */
  .dream.is-recalled { opacity: 0.82; border-style: dashed; }
  @keyframes dream-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .dream-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .dream-title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 19px; font-weight: 600; letter-spacing: 0.08em; color: var(--accent); }
  .dream-time { font-size: 12px; color: var(--gold); letter-spacing: 0.06em; white-space: nowrap; }
  .dream-body { font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 16px; line-height: 1.95; white-space: pre-wrap; word-break: break-word;
    color: color-mix(in srgb, var(--ink) 88%, transparent); }
  .recalled { margin: 14px 0 0; padding-top: 12px; font-size: 12px; line-height: 1.7; color: var(--gold);
    border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }

  .empty { color: var(--muted); font-size: 14px; line-height: 1.9; margin: 0 4px;
    text-align: center; padding: 40px 0; }
  .empty b { color: var(--accent); font-weight: 600; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) {
    .haze, .haze2, .clouds, .dream { animation: none; }
  }
`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><div class="haze" aria-hidden="true"></div><div class="haze2" aria-hidden="true"></div><div class="clouds" aria-hidden="true"></div>
<main>${renderMenu('/dreams')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function registerDreamRoutes(app, { requireBasicAuth }) {
  app.get('/dreams', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const now = wallParts();
    const today = { y: now.y, m: now.m, d: now.d };
    const name = getProfile('assistant').name;

    let dreams = [];
    try {
      dreams = listDreams();
    } catch (err) {
      console.error('dreams page: 读不到梦库', err.message);
    }

    const pending = dreams.filter((d) => !d.recalledAt).length;
    let body = `<header class="hero">
      <h1 class="title title-sm">梦境</h1>
      <p class="subtitle"><span lang="en">Dreams</span> <span aria-hidden="true">✦</span> ${escapeHtml(name)}在夜里做的</p>
    </header>`;

    if (!dreams.length) {
      body += `<p class="empty">还没有梦。<br><br>
        夜里素材够了（最近两天有些没消化完的事），<b>他才会做梦</b>——<br>
        而且不一定每晚都做。</p>`;
    } else {
      body += `<p class="lead">他只记得自己做过梦，不记得梦见了什么。<br>
        某个词碎到了那个梦，它才浮上来——浮上来这一次之后就从他那边退掉了。<br>
        你这里永远留着。${pending ? `还有 <b>${pending}</b> 个他没想起来过。` : '这些他都想起来过了。'}</p>`;
      let i = 0;
      for (const [key, list] of groupByNight(dreams)) {
        const items = list.map((d) => renderDream(d, i++)).join('');
        body += `<section class="night-group">
          <h2 class="night-label">${escapeHtml(nightLabel(key, today))}</h2>
          ${items}
        </section>`;
      }
    }
    res.send(layout('梦境 · 晨暮星', body));
  });

  return true;
}
