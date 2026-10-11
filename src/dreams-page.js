// 梦境页 /dreams：夜里做的那些梦，从 Ombre Brain 读回来。
//
// 梦存在记忆库里（domain='dream'，见 dreams.js），所以这页是只读的：
// 用 breath_advanced 按 domain 拉回来，按日期分组摆出来。
// 梦会衰减、会被归档——这页也就会跟着变少，和人一样。
//
// 页面跟早晚两张脸走（sun-time.js），再加一层自己的东西：
//   雾——两层径向渐变横向漂，周期错开，所以是流动的不是呼吸的。
//   云——三团模糊的白，极慢地飘。
//   星——复用现成的 .sky（白天 --star 是 0，整层透明）。
// 卡片本身用毛玻璃：backdrop-filter 加半透明底，字压在雾上。
//
// vesper.js 里挂载：registerDreamRoutes(app, { requireBasicAuth })，要挂在动态页之前。
import { pad, wallParts, parseDate } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { callTool, isConnected } from './mcp-manager.js';

// 一次最多拉回来多少个梦
const MAX_DREAMS = 60;
// 读记忆库最多等多久
const TIMEOUT_MS = 8000;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

// Ombre 把每个桶渲成人读的文本，形如：
//   ## 梦：湿掉的楼梯  [a1b2c3]  2026-10-11 04:12
//   正文……
// 格式各版本略有不同，所以按「标题行 + 跟在后面的正文」宽松切，
// 切不出来就把整段当一个梦，不寄望于某一版的渲染细节。
const HEAD_RE = /^#{1,4}\s*(?:梦[：:]\s*)?(.+?)\s*$/;
const DATE_RE = /(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?/;

function parseDreams(text) {
  if (!text) return [];
  const blocks = text.split(/\n(?=#{1,4}\s)/);
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const head = lines[0] ?? '';
    const m = HEAD_RE.exec(head.trim());
    if (!m) continue;
    // 标题里可能带着 [桶id] 和时间，拆出来
    const raw = m[1];
    const when = DATE_RE.exec(head);
    const title = raw
      .replace(/\[[0-9a-f]{6,}\]/gi, '')
      .replace(DATE_RE, '')
      .replace(/[|·｜]+\s*$/, '')
      .trim();
    const body = lines.slice(1).join('\n').trim();
    if (!body) continue;
    out.push({
      title: title || '无题',
      body,
      day: when ? `${when[1]}-${when[2]}-${when[3]}` : '',
      time: when && when[4] ? `${pad(when[4])}:${when[5]}` : '',
    });
  }
  // 一个桶都没切出来但确实有文字：整段当一个
  if (!out.length && text.length > 20) {
    const when = DATE_RE.exec(text);
    out.push({
      title: '梦',
      body: text,
      day: when ? `${when[1]}-${when[2]}-${when[3]}` : '',
      time: '',
    });
  }
  return out;
}

async function readDreams() {
  if (!isConnected('ombre-brain')) {
    return { dreams: [], error: '还没接上记忆库（Ombre Brain）。梦存在那里，所以这一页暂时是空的。' };
  }
  try {
    const result = await Promise.race([
      callTool('ombre-brain', 'breath_advanced', { domain: 'dream', max_results: MAX_DREAMS, max_tokens: 24000 }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), TIMEOUT_MS)),
    ]);
    const dreams = parseDreams(toolText(result));
    return { dreams, error: '' };
  } catch (err) {
    console.error('dreams page: 读不到梦', err.message);
    return { dreams: [], error: '记忆库暂时没应门。过一会儿再刷一下。' };
  }
}

// 按日期分组，新的在前。没日期的摆最后
function groupByDay(dreams) {
  const map = new Map();
  for (const d of dreams) {
    const key = d.day || '';
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(d);
  }
  return [...map.entries()].sort((a, b) => {
    if (!a[0]) return 1;
    if (!b[0]) return -1;
    return b[0].localeCompare(a[0]);
  });
}

function dayLabel(key, today) {
  if (!key) return '不记得是哪一夜';
  const p = parseDate(key);
  if (!p) return key;
  const diff = Math.round(
    (Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000
  );
  const base = `${p.m} 月 ${p.d} 日`;
  if (diff === 0) return `${base} · 今凌晨`;
  if (diff === 1) return `${base} · 昨夜`;
  return base;
}

function renderDream(d, i) {
  return `<article class="dream" style="--i:${i}">
    <header class="dream-head">
      <h3 class="dream-title">${escapeHtml(d.title)}</h3>
      ${d.time ? `<span class="dream-time">${escapeHtml(d.time)}</span>` : ''}
    </header>
    <div class="dream-body">${escapeHtml(d.body)}</div>
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

  .day-group { margin: 0 0 26px; }
  .day-label { margin: 0 4px 10px; font-size: 13px; letter-spacing: 0.16em; color: var(--accent);
    display: flex; align-items: center; gap: 10px; }
  .day-label::after { content: ''; flex: 1; height: 1px;
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
  @keyframes dream-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .dream-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .dream-title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 19px; font-weight: 600; letter-spacing: 0.08em; color: var(--accent); }
  .dream-time { font-size: 12px; color: var(--gold); letter-spacing: 0.06em; white-space: nowrap; }
  .dream-body { font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 16px; line-height: 1.95; white-space: pre-wrap; word-break: break-word;
    color: color-mix(in srgb, var(--ink) 88%, transparent); }

  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .notice { font-size: 14px; line-height: 1.7; border-left: 4px solid var(--gold); }
  .empty { color: var(--muted); font-size: 14px; line-height: 1.8; margin: 0 4px;
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

function hero() {
  const name = getProfile('assistant').name;
  return `<header class="hero">
    <h1 class="title title-sm">梦境</h1>
    <p class="subtitle"><span lang="en">Dreams</span> <span aria-hidden="true">✦</span> ${escapeHtml(name)}在夜里做的</p>
  </header>`;
}

export function registerDreamRoutes(app, { requireBasicAuth }) {
  app.get('/dreams', requireBasicAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const now = wallParts();
    const today = { y: now.y, m: now.m, d: now.d };
    const { dreams, error } = await readDreams();

    let body = hero();
    if (error) {
      body += `<div class="card notice" role="alert">${escapeHtml(error)}</div>`;
    } else if (!dreams.length) {
      body += `<p class="empty">还没有梦。<br><br>
        夜里素材够了（最近两天有些没消化完的事），<b>他才会做梦</b>——<br>
        而且不一定每晚都做。</p>`;
    } else {
      let i = 0;
      for (const [key, list] of groupByDay(dreams)) {
        const items = list.map((d) => renderDream(d, i++)).join('');
        body += `<section class="day-group">
          <h2 class="day-label">${escapeHtml(dayLabel(key, today))}</h2>
          ${items}
        </section>`;
      }
    }
    res.send(layout('梦境 · 晨暮星', body));
  });

  return true;
}
