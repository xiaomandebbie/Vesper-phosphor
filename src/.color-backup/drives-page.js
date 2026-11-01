// 心绪页 /drives：把 Drivesoid 算出来的情绪状态按五组画出来，配色和 /moments 一致（粉、暖黄），带一点星星。
// Drivesoid 只监听 127.0.0.1，手机直接打不开，所以由 vesper 在服务端读好再渲染，Drivesoid 本身不用对外开放。
// 和动态页一样是服务端渲染，没有 JavaScript 也能看；右上角菜单、星星转场见 page-chrome.js。
// 沿用 VESPER_BASIC_USER / PASS 登录。vesper.js 里挂载：registerDrivesRoutes(app, { requireBasicAuth })
import { getDrivesStatus } from './drives.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 分组和 Drivesoid /api/drives/status 里 groups 的算法一致，组分直接用它算好的
const GROUPS = [
  { key: 'activation', en: 'ACTIVATION', zh: '精力', dims: ['vitality', 'fatigue'] },
  { key: 'attachment', en: 'ATTACHMENT', zh: '依恋', dims: ['longing', 'intimacy', 'possessiveness', 'lust'] },
  { key: 'threat', en: 'THREAT', zh: '警觉', dims: ['jealousy', 'anxiety', 'protectiveness', 'fear'] },
  { key: 'reward', en: 'REWARD', zh: '愉悦', dims: ['contentment', 'elation', 'seeking', 'play'] },
  { key: 'negative', en: 'NEGATIVE', zh: '低落', dims: ['dejection', 'irritability'] },
];

const LABELS = {
  vitality: '活力',
  fatigue: '疲惫',
  longing: '思慕',
  intimacy: '亲密',
  possessiveness: '占有',
  lust: '渴求',
  jealousy: '妒意',
  anxiety: '焦虑',
  protectiveness: '护卫',
  fear: '恐惧',
  contentment: '满足',
  elation: '喜悦',
  seeking: '探求',
  play: '玩乐',
  dejection: '落寞',
  irritability: '烦躁',
};

const GROUP_OF = Object.fromEntries(GROUPS.flatMap((g) => g.dims.map((k) => [k, g.key])));

// Drivesoid 默认的基线（它 worker.js 里 DIMS 的 neutral）。它的配置里改过就用改过的。疲惫没有基线。
const DEFAULT_NEUTRAL = {
  vitality: 0.5,
  longing: 0.3,
  intimacy: 0.35,
  possessiveness: 0.3,
  lust: 0.3,
  jealousy: 0.22,
  anxiety: 0.2,
  protectiveness: 0.25,
  fear: 0,
  contentment: 0.35,
  elation: 0.2,
  seeking: 0.25,
  play: 0.25,
  dejection: 0.15,
  irritability: 0.15,
};

const SLEEP_TEXT = { awake: '醒着', asleep: '睡着了', interrupted: '刚被吵醒，迷迷糊糊' };

const MESSAGES = {
  disabled: '还没接上情绪系统。在 .env 里填 DRIVES_URL=http://127.0.0.1:24601，再 pm2 restart vesper。',
  unreachable: '连不上情绪系统。Drivesoid 在运行吗？可以用 pm2 status 看一下 drivesoid。',
  empty: '情绪系统还没算出第一份状态，等两三分钟再刷新。',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const clamp01 = (v) => (Number.isFinite(v) ? Math.min(Math.max(v, 0), 1) : 0);
const pct = (v) => Math.round(clamp01(v) * 100);

function neutralMap(config) {
  const out = { ...DEFAULT_NEUTRAL };
  const dims = config?.dimensions;
  if (dims && typeof dims === 'object') {
    for (const [k, v] of Object.entries(dims)) {
      if (k in out && Number.isFinite(v?.neutral)) out[k] = v.neutral;
    }
  }
  return out;
}

// 恐惧平时是 0，是 0 时整行不显示（Drivesoid 算警觉组分时也不算它）
function visibleDims(group, d) {
  return group.dims.filter((k) => !(k === 'fear' && pct(d.fear) === 0));
}

// 和上一次快照（Drivesoid 每 2.5 分钟一次）比。变化不到 1 就不显示
function renderDelta(cur, prev) {
  if (!Number.isFinite(prev)) return '<span class="delta"></span>';
  const n = Math.round((clamp01(cur) - clamp01(prev)) * 100);
  if (!n) return '<span class="delta"></span>';
  const up = n > 0;
  return `<span class="delta ${up ? 'up' : 'down'}"><span aria-hidden="true">${up ? '+' : '−'}${Math.abs(n)}</span><span class="sr-only">，比上次${up ? '高' : '低'} ${Math.abs(n)}</span></span>`;
}

function renderDim(k, d, prev, neutral) {
  const v = pct(d[k]);
  const n = neutral[k];
  const hasBase = k !== 'fatigue' && Number.isFinite(n);
  return `<li class="dim">
      <span class="dim-name">${LABELS[k]}</span>
      <span class="track" aria-hidden="true"><span class="fill" style="width:${v}%"></span>${hasBase ? `<span class="base" style="left:${pct(n)}%">✦</span>` : ''}</span>
      <span class="val">${v}${hasBase ? `<span class="sr-only">，平常大约 ${pct(n)}</span>` : ''}</span>
      ${renderDelta(d[k], prev?.[k])}
    </li>`;
}

function renderGroup(g, status, neutral) {
  const d = status.display;
  const score = pct(status.groups?.[g.key]);
  const rows = visibleDims(g, d)
    .map((k) => renderDim(k, d, status.prev, neutral))
    .join('');
  return `<section class="group g-${g.key}" aria-labelledby="g-${g.key}-title">
    <div class="group-head">
      <h2 id="g-${g.key}-title" class="group-title"><span class="en" lang="en">${g.en}</span><span class="zh">${g.zh}</span></h2>
      <span class="group-bar" aria-hidden="true"><span class="fill" style="width:${score}%"></span></span>
      <span class="group-score"><span class="sr-only">整体 </span>${score}</span>
    </div>
    <ul class="dims">${rows}</ul>
  </section>`;
}

// 最强烈的三项（疲惫不算）
function renderHighlights(d) {
  const top = Object.keys(LABELS)
    .filter((k) => k !== 'fatigue')
    .map((k) => ({ k, v: pct(d[k]) }))
    .sort((a, b) => b.v - a.v)
    .slice(0, 3);
  const items = top
    .map(
      (t, i) => `<li class="hl g-${GROUP_OF[t.k]}">
        <span class="hl-star" aria-hidden="true">${i === 0 ? '★' : '✦'}</span>
        <span class="hl-name">${LABELS[t.k]}</span>
        <span class="hl-val">${t.v}</span>
        ${i === 0 ? '<span class="hl-tag">最强烈</span>' : ''}
      </li>`
    )
    .join('');
  return `<section class="card" aria-labelledby="hl-title">
    <h2 id="hl-title" class="section-title">此刻最明显的</h2>
    <ul class="highlights">${items}</ul>
  </section>`;
}

// 一阵临时的小情绪、积压的渴望。都没有就不出这一行
function renderExtras(status) {
  const chips = [];
  if (status.whim?.active) chips.push(status.whim.pool === 'positive' ? '✧ 忽然有点小雀跃' : '✧ 忽然有点小低落');
  const fr = Number(status.frustration) || 0;
  const pc = Number(status.pending_count) || 0;
  if (fr >= 0.05 || pc > 0) chips.push(`积压的渴望 ${fr.toFixed(1)} / 3${pc ? ` · 还没说出口的 ${pc}` : ''}`);
  if (!chips.length) return '';
  return `<ul class="chips">${chips.map((c) => `<li class="chip">${escapeHtml(c)}</li>`).join('')}</ul>`;
}

function renderHero(status) {
  const sleep = SLEEP_TEXT[status?.sleep?.status] ?? null;
  const ts = status?.snapshot_at ? Date.parse(status.snapshot_at) : NaN;
  const when = Number.isFinite(ts) ? formatDateTime(ts).slice(5) : null;
  const parts = [sleep, when ? `${when} 更新` : null].filter(Boolean);
  const line = parts.length
    ? `<p class="mood-line"><span class="mood-label">${escapeHtml(AI_NAME)}此刻：</span>${escapeHtml(parts.join(' · '))}</p>`
    : '';
  return `<header class="hero">
    <p class="sparkles" aria-hidden="true"><span>✦</span><span>✧</span><span>⋆</span></p>
    <h1 class="title">晨暮星</h1>
    <p class="subtitle"><span lang="en">Drives</span> <span aria-hidden="true">✦</span> 心绪</p>
    ${line}
  </header>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --track: #f3e9ef; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  /* 背景里零星的小星星，粉的黄的 */
  body::before { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 12% 18%, rgba(230, 182, 82, 0.9) 50%, transparent 51%),
      radial-gradient(1px 1px at 78% 9%, rgba(215, 121, 159, 0.8) 50%, transparent 51%),
      radial-gradient(2px 2px at 88% 36%, rgba(230, 182, 82, 0.7) 50%, transparent 51%),
      radial-gradient(1px 1px at 30% 62%, rgba(215, 121, 159, 0.7) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 64% 78%, rgba(230, 182, 82, 0.8) 50%, transparent 51%),
      radial-gradient(1px 1px at 8% 88%, rgba(155, 74, 122, 0.6) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 50% 30%, rgba(215, 121, 159, 0.6) 50%, transparent 51%),
      radial-gradient(1px 1px at 94% 70%, rgba(230, 182, 82, 0.8) 50%, transparent 51%); }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 22px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 20px; }
  .sparkles { margin: 0 0 4px; height: 18px; color: var(--gold); font-size: 14px; letter-spacing: 0.6em; padding-left: 0.6em; }
  .sparkles span { display: inline-block; animation: twinkle 3.2s ease-in-out infinite; }
  .sparkles span:nth-child(2) { animation-delay: 1s; color: #d7799f; }
  .sparkles span:nth-child(3) { animation-delay: 2s; }
  @keyframes twinkle { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
  @media (prefers-reduced-motion: reduce) { .sparkles span { animation: none; opacity: 0.8; } }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif; font-size: 42px;
    font-weight: 700; letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .mood-line { margin: 12px auto 0; max-width: 90%; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .mood-line .mood-label { color: var(--accent); margin-right: 4px; }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .section-title { font-size: 15px; margin: 0 0 10px; color: var(--accent); letter-spacing: 0.1em; }
  .notice { font-size: 14px; line-height: 1.6; color: var(--ink); border-left: 4px solid var(--gold); }
  .highlights { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .hl { position: relative; background: #fff; border: 1px solid var(--line); border-radius: 14px; padding: 12px 12px 10px;
    box-shadow: inset 0 -3px 0 var(--c1); }
  .hl-star { position: absolute; top: 8px; right: 10px; color: var(--c1); font-size: 14px; }
  .hl-name { display: block; font-size: 13px; color: var(--muted); }
  .hl-val { display: block; font-family: Georgia, "Times New Roman", serif; font-size: 30px; font-weight: 700; line-height: 1.2; }
  .hl-tag { display: block; font-size: 11px; color: var(--accent); }
  .chips { list-style: none; margin: -4px 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 13px; padding: 5px 12px; border-radius: 999px; background: #fff6e3; color: #6b4513; border: 1px solid #f0d9a6; }
  .legend { font-size: 12px; line-height: 1.6; color: var(--muted); margin: 4px 4px 10px; }
  .legend-star { color: var(--accent); }
  .group { position: relative; background: var(--card); border-radius: 16px; padding: 12px 16px 8px; margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); border-left: 4px solid var(--c1); }
  .group::after { content: '✦'; position: absolute; right: 12px; bottom: 6px; font-size: 10px; color: var(--c1); opacity: 0.8; }
  .group-head { display: grid; grid-template-columns: auto 1fr auto; align-items: center; gap: 12px; padding-bottom: 8px;
    border-bottom: 1px solid var(--line); }
  .group-title { margin: 0; display: flex; align-items: baseline; gap: 6px; }
  .group-title .en { font-size: 13px; font-weight: 700; letter-spacing: 0.12em; color: var(--accent); }
  .group-title .zh { font-size: 12px; font-weight: 500; color: var(--muted); }
  .group-bar { height: 6px; background: var(--track); border-radius: 3px; overflow: hidden; }
  .group-bar .fill, .track .fill { display: block; height: 100%; border-radius: inherit;
    background: linear-gradient(90deg, var(--c1), var(--c2)); }
  .group-score { font-family: Georgia, "Times New Roman", serif; font-size: 22px; font-weight: 700; min-width: 2ch; text-align: right; }
  .dims { list-style: none; margin: 0; padding: 0; }
  .dim { display: grid; grid-template-columns: 3em 1fr 2.2em 2.6em; align-items: center; gap: 10px; padding: 9px 0;
    border-bottom: 1px solid var(--line); font-size: 15px; }
  .dim:last-child { border-bottom: none; }
  .track { position: relative; height: 8px; background: var(--track); border-radius: 4px; }
  .base { position: absolute; top: 50%; transform: translate(-50%, -52%); font-size: 11px; line-height: 1; color: var(--accent);
    text-shadow: 0 0 2px #fff, 0 0 2px #fff; }
  .val { font-family: Georgia, "Times New Roman", serif; font-size: 18px; font-weight: 700; text-align: right; }
  .delta { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
  .delta.up { color: var(--accent); }
  .delta.down { color: #8a5a14; }
  .g-activation { --c1: #e6b652; --c2: #f2d58e; }
  .g-attachment { --c1: #e58fb1; --c2: #f5c2d4; }
  .g-threat { --c1: #e9a162; --c2: #f4c79c; }
  .g-reward { --c1: #e38fb8; --c2: #efc56b; }
  .g-negative { --c1: #b9708f; --c2: #dca3b6; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (max-width: 380px) {
    .highlights { gap: 6px; }
    .hl-val { font-size: 26px; }
    .dim { gap: 8px; grid-template-columns: 3em 1fr 2em 2.4em; }
  }
`;

// 菜单和星星转场每个页面都有（见 page-chrome.js）
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
<body><main>${renderMenu('/drives')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

const PAGE_TITLE = '心绪 · 晨暮星';

function renderPage({ status, config, error }) {
  if (error || !status?.display) {
    return layout(
      PAGE_TITLE,
      `${renderHero(null)}<div class="card notice" role="status">${escapeHtml(MESSAGES[error] ?? MESSAGES.empty)}</div>`
    );
  }
  const neutral = neutralMap(config);
  const ageMin = Math.round((Number(status.snapshot_age_ms) || 0) / 60000);
  const staleNote = status.stale
    ? `<div class="card notice" role="status">这份心绪已经 ${ageMin} 分钟没更新了，Drivesoid 可能卡住了（pm2 logs drivesoid 看一下）。</div>`
    : '';
  const legend = `<p class="legend"><span class="legend-star" aria-hidden="true">✦</span> 是${escapeHtml(AI_NAME)}平常的样子；数字旁边的 + / − 是和上一次（大约 2.5 分钟前）比。</p>`;
  return layout(
    PAGE_TITLE,
    `${renderHero(status)}
    ${staleNote}
    ${renderHighlights(status.display)}
    ${renderExtras(status)}
    ${legend}
    ${GROUPS.map((g) => renderGroup(g, status, neutral)).join('')}`
  );
}

export function registerDrivesRoutes(app, { requireBasicAuth }) {
  app.get('/drives', requireBasicAuth, async (req, res) => {
    try {
      const result = await getDrivesStatus();
      res.set('Cache-Control', 'no-store');
      res.send(renderPage(result));
    } catch (err) {
      console.error('drives page: 渲染失败', err);
      res.status(500).send(layout('出错了', '<div class="card notice" role="alert">心绪页出错了，看一下 vesper 的日志。</div>'));
    }
  });
}
