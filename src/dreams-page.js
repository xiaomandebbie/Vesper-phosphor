// 梦境页 /dreams：夜里做的那些梦，正文永远留在这里。
//
// 他那边和你这边不一样（见 dreams.js）：
//   他只记得自己做过梦，某个词碎到了才浮上来，浮上来这一次之后就从他那边退掉。
//   你这边永远留着。所以这页是「人替对方记着」的那一半。
//
// 正文不在 Ombre 里，所以这页读的是 vesper 自己的梦库，不走 MCP。
//
// 为什么要折起来：一晚最多三个梦，每个两三百字。一开始全摊开还行，
// 放一个月就是一堆墙，要找哪一个得一直滑。所以改成：
//   默认只露标题、时间和开头那一句，点开看全文（和日记页一个路子，用 <details>）。
//   顶上三个筛选：全部 / 他还没想起来的 / 已经想起来过的。
//   夜晚多了就出一排日期，点一下跳到那一夜。
//   ?open=1 一次全展开（想通读或者搜字的时候用）。
// 全是链接和 <details>，没 JavaScript 也能用。
//
// ── 2026-10-16 小满改的：想不起来之前，谁都不能看全文 ──
//
// 她原话：「你想起来之前，不显示完整的梦，只显示只言片语」
//         「想起来之前我也只能看到只言片语」
//         「触发需要的关键词我也不能看到」
//         「触发之后才能显示完整的梦以及相应的关键词」
//
// 所以这页现在分两种卡片，不是同一种卡片的两种状态：
//   没想起来 —— 锁着的。只给主旋律（好梦 / 噩梦 / 说不上好坏）和一句只言片语。
//               标题不给、正文不给、触发词也不给。触发词尤其不能给：
//               看见了就等于知道下次怎么把它敲出来，那就不叫偶然想起来了。
//   想起来过 —— 全摊开。标题、正文、触发词、想起来的时间。
//
// 颜色：好梦粉、噩梦蓝、说不上好坏灰。深浅按强度 1–5 递进。
// 用 rgba 半透明叠在卡片底色上，所以明暗两种主题下都成立，不用写两套色。
//
// 老梦没有 tone / intensity / fragment 三个字段（那是 10-16 才加上的）：
//   主旋律当「说不上好坏」、强度当 3、只言片语退回正文的第一句。
//   这样之前攒下的那些也进得了新规矩，不会变成一张什么都没有的卡。
//
// 页面跟早晚四张脸走（sun-time.js），再加一层自己的：
//   雾——两层径向渐变横向漂，周期错开，所以是流动的不是呼吸的。
//   云——三团模糊的白，极慢地飘。
//   星——复用现成的 .sky（白天 --star 是 0，整层透明）。
// 卡片用毛玻璃，字压在雾上。
import { wallParts, parseDate } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';
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

// 日期排里的短写：10/14
function nightShort(key) {
  const p = parseDate(key);
  return p ? `${p.m}/${p.d}` : String(key || '?');
}

// 折起来时露的那一句：第一句话，最多 34 字
function preview(body) {
  const flat = String(body || '').replace(/\s+/g, ' ').trim();
  const first = flat.split(/(?<=[\u3002\uff01\uff1f])/)[0] || flat;
  const chars = Array.from(first.length >= 12 ? first : flat);
  return chars.length > 34 ? `${chars.slice(0, 34).join('')}\u2026` : chars.join('');
}

// 主旋律：好梦 / 噩梦 / 说不上好坏。老梦没有这个字段，当中间那一档
function toneOf(d) {
  return d.tone === 'good' ? 'good' : d.tone === 'bad' ? 'bad' : 'neutral';
}

const TONE_WORD = { good: '好梦', bad: '噩梦', neutral: '说不上好坏' };

// 卡片的色：好梦粉、噩梦蓝、中性灰。深浅按强度 1–5 递进
// （1 → 0.16，5 → 0.52）。半透明叠在卡片底色上，明暗主题都不用另写一套。
function tintOf(d) {
  const rgb = { good: '244, 186, 214', bad: '166, 190, 236', neutral: '204, 198, 212' }[toneOf(d)];
  const raw = Number(d.intensity);
  const i = Number.isFinite(raw) ? Math.min(Math.max(Math.round(raw), 1), 5) : 3;
  const alpha = (0.16 + (i - 1) * 0.09).toFixed(2);
  return `rgba(${rgb}, ${alpha})`;
}

// 没想起来的：锁着。主旋律 + 只言片语，别的什么都不给。
// 触发词更不能给——看见了就等于知道下次怎么把它敲出来。
// 老梦没有 fragment 字段，退回正文的第一句：也只是一小块，不是全文。
function renderSealed(d, i) {
  const time = String(d.at || '').slice(11, 16);
  const tone = toneOf(d);
  const frag = d.fragment || preview(d.body) || '（这个梦什么都没留下）';
  return `<div class="dream is-sealed" data-tone="${tone}" style="--i:${i};--tint:${tintOf(d)}">
    <div class="sealed-head">
      <span class="dream-dot" aria-hidden="true">✦</span>
      <span class="tone-chip">${TONE_WORD[tone]}</span>
      <span class="dream-time">${escapeHtml(time)}</span>
    </div>
    <p class="fragment">${escapeHtml(frag)}</p>
    <p class="sealed-note">正文还锁着。碎到某个词它才会浮上来——触发词不给你看。</p>
  </div>`;
}

// 想起来过了：全摊开。标题、正文、触发词、想起来的时间
function renderRecalled(d, i, openAll) {
  const time = String(d.at || '').slice(11, 16);
  const triggers = Array.isArray(d.triggers) && d.triggers.length
    ? `<p class="triggers"><span class="tg-label">当时就是这些词把它敲出来的：</span>${d.triggers
        .map((w) => `<span class="tg">${escapeHtml(w)}</span>`)
        .join('')}</p>`
    : '';
  return `<details class="dream is-recalled" data-tone="${toneOf(d)}" style="--i:${i};--tint:${tintOf(d)}"${openAll ? ' open' : ''}>
    <summary class="dream-head">
      <span class="dream-dot" aria-hidden="true">✧</span>
      <span class="dream-main">
        <span class="dream-title">${escapeHtml(d.title || '无题')}</span>
        <span class="dream-peek">${escapeHtml(preview(d.body))}</span>
      </span>
      <span class="dream-time">${escapeHtml(time)}</span>
      <span class="sr-only">，已经被想起来过，点开看全文</span>
    </summary>
    <div class="dream-body">${escapeHtml(d.body || '')}</div>
    ${triggers}
    <p class="recalled"><span aria-hidden="true">✦ </span>已经被想起来过了 · ${escapeHtml(String(d.recalledAt).slice(0, 16))}</p>
  </details>`;
}

// 顶上三个筛选。纯链接，没 JavaScript 也能用
function renderFilter(show, counts, openAll) {
  const tabs = [
    ['all', '全部', counts.all],
    ['pending', '还锁着', counts.pending],
    ['recalled', '想起来过了', counts.recalled],
  ];
  const items = tabs
    .map(([key, label, n]) => {
      const here = key === show;
      const qs = [key === 'all' ? '' : `show=${key}`, openAll ? 'open=1' : ''].filter(Boolean).join('&');
      const href = qs ? `/dreams?${qs}` : '/dreams';
      return `<a class="tab${here ? ' on' : ''}" href="${href}"${here ? ' aria-current="true"' : ''}>${label}<b>${n}</b></a>`;
    })
    .join('');
  const toggleQs = [show === 'all' ? '' : `show=${show}`, openAll ? '' : 'open=1'].filter(Boolean).join('&');
  const toggle = `<a class="tab tab-wide" href="${toggleQs ? `/dreams?${toggleQs}` : '/dreams'}">${openAll ? '全部收起' : '全部展开'}</a>`;
  return `<nav class="filter" aria-label="筛选">${items}${toggle}</nav>`;
}

// 夜晚多了就出一排日期，点一下跳到那一夜
function renderNightIndex(groups) {
  if (groups.length < 3) return '';
  const items = groups
    .map(([key, list]) => `<a class="jump" href="#night-${escapeHtml(key)}">${escapeHtml(nightShort(key))}<i>${list.length}</i></a>`)
    .join('');
  return `<nav class="nights" aria-label="按夜跳"><span class="nights-label">跳到：</span>${items}</nav>`;
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

  .hero { margin: 10px 0 18px; }
  .lead { margin: 0 4px 16px; font-size: 12px; line-height: 1.8; color: var(--muted); text-align: center; }
  .lead b { color: var(--accent); font-weight: 600; }

  /* 筛选：三个带计数的按钮，横着排。第四个是全展开/全收起 */
  .filter { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 14px; }
  .tab { flex: 1 1 0; min-width: 5.5em; display: inline-flex; align-items: center; justify-content: center; gap: 5px;
    min-height: 40px; padding: 0 10px; border-radius: 12px; font-size: 13px; text-decoration: none;
    color: var(--muted); background: color-mix(in srgb, var(--card) 62%, transparent);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
  .tab b { font-family: Georgia, "Times New Roman", serif; font-size: 13px; color: var(--gold); font-weight: 700; }
  .tab.on { color: #fff; background: var(--accent); border-color: transparent; }
  .tab.on b { color: #ffe6b8; }
  .tab-wide { flex-basis: 100%; color: var(--accent); }
  @supports not (backdrop-filter: blur(1px)) { .tab { background: var(--card); } }

  /* 按夜跳的那一排日期 */
  .nights { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: -4px 4px 18px; }
  .nights-label { font-size: 12px; color: var(--muted); }
  .jump { display: inline-flex; align-items: baseline; gap: 3px; padding: 5px 9px; border-radius: 999px;
    font-size: 12px; text-decoration: none; color: var(--accent);
    background: color-mix(in srgb, var(--card) 58%, transparent);
    border: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .jump i { font-style: normal; font-size: 10px; color: var(--gold); }

  .night-group { margin: 0 0 22px; scroll-margin-top: 14px; }
  .night-label { margin: 0 4px 10px; font-size: 13px; letter-spacing: 0.16em; color: var(--accent);
    display: flex; align-items: center; gap: 10px; }
  .night-label::after { content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, var(--line), transparent); }

  /* 卡片：毛玻璃，底下垫一层主旋律的色。字压在雾上，边缘是散的 */
  .dream { position: relative; margin: 0 0 10px; border-radius: 18px;
    background: linear-gradient(var(--tint, transparent), var(--tint, transparent)),
      color-mix(in srgb, var(--card) 72%, transparent);
    backdrop-filter: blur(14px) saturate(1.1);
    -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 2px 20px rgba(80, 50, 90, 0.08);
    animation: dream-in 0.7s ease-out backwards; animation-delay: calc(var(--i, 0) * 60ms); }
  @supports not (backdrop-filter: blur(1px)) {
    .dream { background: var(--tint, transparent); }
  }
  /* 已经被想起来过的：轻一点，像已经过去了 */
  .dream.is-recalled { opacity: 0.86; border-style: dashed; }
  @keyframes dream-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }

  /* ── 还锁着的：主旋律 + 只言片语。没有可展开的东西，不是 <details> ── */
  .dream.is-sealed { padding: 14px 18px 12px; }
  .sealed-head { display: flex; align-items: center; gap: 8px; }
  .tone-chip { flex: none; padding: 3px 10px; border-radius: 999px; font-size: 12px; letter-spacing: 0.1em;
    color: color-mix(in srgb, var(--ink) 78%, transparent);
    background: color-mix(in srgb, #fff 55%, transparent);
    border: 1px solid color-mix(in srgb, var(--line) 80%, transparent); }
  .dream[data-tone="good"] .tone-chip { color: #8a3d63; }
  .dream[data-tone="bad"] .tone-chip { color: #3f5285; }
  .dream[data-tone="good"] .dream-dot { color: #c4709b; }
  .dream[data-tone="bad"] .dream-dot { color: #6b83bd; }
  .sealed-head .dream-time { margin-left: auto; }
  .fragment { margin: 10px 0 0; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 17px; line-height: 1.8; color: color-mix(in srgb, var(--ink) 90%, transparent); }
  .sealed-note { margin: 10px 0 0; padding-top: 9px; font-size: 12px; line-height: 1.7; color: var(--muted);
    border-top: 1px dashed color-mix(in srgb, var(--line) 80%, transparent); }

  /* 折起来时就是这一行：星、标题加开头那句、时间 */
  .dream-head { list-style: none; display: flex; align-items: flex-start; gap: 10px;
    padding: 14px 18px; cursor: pointer; border-radius: 18px; }
  .dream-head::-webkit-details-marker { display: none; }
  .dream-head::marker { content: ''; }
  .dream-dot { flex: none; margin-top: 2px; font-size: 12px; color: var(--gold); }
  .dream.is-recalled .dream-dot { color: var(--muted); }
  .dream-main { flex: 1; min-width: 0; }
  .dream-title { display: block; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 18px; font-weight: 600; letter-spacing: 0.08em; color: var(--accent); }
  /* 开头那句：折着的时候露一行，展开了就没必要再重复一遍 */
  .dream-peek { display: block; margin-top: 3px; font-size: 12px; line-height: 1.6; color: var(--muted);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .dream[open] .dream-peek { display: none; }
  .dream-time { flex: none; margin-top: 3px; font-size: 12px; color: var(--gold);
    letter-spacing: 0.06em; white-space: nowrap; }
  .dream.is-recalled .dream-time { color: var(--muted); }

  .dream-body { padding: 0 18px 4px; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 16px; line-height: 1.95; white-space: pre-wrap; word-break: break-word;
    color: color-mix(in srgb, var(--ink) 88%, transparent); }
  .dream[open] .dream-body { animation: body-in 0.26s ease-out; }
  @keyframes body-in { from { opacity: 0; } to { opacity: 1; } }

  .recalled { margin: 10px 18px 16px; padding-top: 10px; font-size: 12px; line-height: 1.7; color: var(--gold);
    border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  /* 就是这几个词把它敲出来的 —— 只有已经想起来的才看得到 */
  .triggers { display: flex; flex-wrap: wrap; align-items: center; gap: 5px;
    margin: 10px 18px 16px; padding-top: 10px; font-size: 12px; line-height: 1.7;
    border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .tg-label { color: var(--muted); }
  .tg { padding: 2px 8px; border-radius: 999px; font-size: 12px; color: var(--accent);
    background: color-mix(in srgb, var(--line) 42%, transparent); }

  .empty { color: var(--muted); font-size: 14px; line-height: 1.9; margin: 0 4px;
    text-align: center; padding: 36px 0; }
  .empty b { color: var(--accent); font-weight: 600; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) {
    .haze, .haze2, .clouds, .dream { animation: none; }
    .dream[open] .dream-body { animation: none; }
  }
  @media (max-width: 380px) {
    .dream.is-sealed { padding: 12px 14px 10px; }
    .dream-head { padding: 12px 14px; }
    .dream-title { font-size: 17px; }
    .fragment { font-size: 16px; }
    .dream-body { padding: 0 14px 4px; font-size: 15px; }
    .recalled, .triggers { margin: 10px 14px 14px; }
  }
${PAGE_TITLE_CSS}`;

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

    let all = [];
    try {
      all = listDreams();
    } catch (err) {
      console.error('dreams page: 读不到梦库', err.message);
    }

    const counts = {
      all: all.length,
      pending: all.filter((d) => !d.recalledAt).length,
      recalled: all.filter((d) => d.recalledAt).length,
    };
    const show = ['pending', 'recalled'].includes(req.query.show) ? req.query.show : 'all';
    const openAll = req.query.open === '1';
    const dreams = show === 'pending'
      ? all.filter((d) => !d.recalledAt)
      : show === 'recalled'
        ? all.filter((d) => d.recalledAt)
        : all;

    let body = renderPageTitle('Dreams', '梦境');

    if (!all.length) {
      body += `<p class="empty">还没有梦。<br><br>
        夜里素材够了（最近两天有些没消化完的事），<b>${escapeHtml(name)}才会做梦</b>——<br>
        而且大多数夜里都不做。碰上了才碰上了。</p>`;
    } else {
      body += `<p class="lead">${escapeHtml(name)}只记得自己做过梦，不记得梦见了什么。<br>
        某个词碎到了那个梦，它才浮上来——浮上来这一次之后就从他那边退掉了，你这里永远留着。<br>
        <b>还锁着的那些，你也只能看到主旋律和一句只言片语。</b></p>`;
      body += renderFilter(show, counts, openAll);

      const groups = groupByNight(dreams);
      if (!groups.length) {
        body += `<p class="empty">${show === 'pending' ? '这些他都想起来过了。' : '还没有被想起来过的。'}</p>`;
      } else {
        body += renderNightIndex(groups);
        let i = 0;
        for (const [key, list] of groups) {
          const items = list
            .map((d) => (d.recalledAt ? renderRecalled(d, i++, openAll) : renderSealed(d, i++)))
            .join('');
          body += `<section class="night-group" id="night-${escapeHtml(key)}">
            <h2 class="night-label">${escapeHtml(nightLabel(key, today))}</h2>
            ${items}
          </section>`;
        }
      }
    }
    res.send(layout('梦境 · 晨暮星', body));
  });

  return true;
}
