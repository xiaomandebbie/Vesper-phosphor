// 主页 /home：现在只有标题那一块，内容先空着。
//
// 原来动态页顶上那套搬到这里：晨暮星 + Vesper✨Phosphor + 「TA此刻」 + 唤醒时间。
// 动态页换成和日记、梦境、心绪一样的格式（跳星星 + 大标题 + 英文✦中文）。
//
// 「TA此刻」和唤醒时间那两行是从 moments-page.js 搬过来的，这边自己留一份——
// 两页之后会各自长成不同的东西，现在强行共用只会绑死。
// 都只读库，不调模型；读不到就整行不显示，不影响页面其他部分。
//
// vesper.js 里挂载：registerHomeRoutes(app, { requireBasicAuth })
import { getWakeState } from './state.js';
import { getProfile } from './moments-store.js';
import { getTopDrives } from './drives.js';
import { getWakeTimes } from './wake-info.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

const MAX_MOOD_CHARS = 60;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nameOf = (who) => getProfile(who === 'user' ? 'user' : 'assistant').name;

// TA 最近一次醒来时写下的心情（wake_state.mood）。读库，不调模型
function currentMood() {
  try {
    const s = String(getWakeState()?.mood ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    const chars = Array.from(s);
    return chars.length > MAX_MOOD_CHARS ? `${chars.slice(0, MAX_MOOD_CHARS).join('')}\u2026` : s;
  } catch {
    return null;
  }
}

// 接了 Drivesoid 就显示此刻最明显的三项情绪，读不到退回上次写下的心情。
// 整行始终可以点，进心绪页
function renderMoodLine(mood, top) {
  const aiName = nameOf('assistant');
  const label = `<span class="mood-label">${escapeHtml(aiName)}此刻：</span>`;
  let inner;
  if (top?.length) {
    inner = label + top
      .map((t) => `${escapeHtml(t.label)} <b class="mood-num">${t.value}</b>`)
      .join('<span class="mood-sep" aria-hidden="true"> · </span><span class="sr-only">，</span>');
  } else if (mood) {
    inner = label + escapeHtml(mood);
  } else {
    inner = `看看${escapeHtml(aiName)}此刻的心绪`;
  }
  return `<p class="mood-line"><a class="mood-link" href="/drives">${inner}<span class="mood-more" aria-hidden="true">✦ 心绪 ›</span><span class="sr-only">，点开看心绪</span></a></p>`;
}

// 今天的只写 HH:mm，别的天写 MM-DD HH:mm
function whenLabel(ms, now) {
  const t = formatDateTime(ms);
  return t.slice(0, 10) === formatDateTime(now).slice(0, 10) ? t.slice(11) : t.slice(5);
}

// 上次唤醒、下次唤醒、自主唤醒（TA 自己约的精确唤醒里最早那次）
function renderWakeLine() {
  let w;
  try {
    w = getWakeTimes();
  } catch (err) {
    console.error('home page: 读唤醒时间失败', err.message);
    return '';
  }
  const now = Date.now();
  const last = w.lastAt ? whenLabel(w.lastAt, now) : '还没醒过';
  let next;
  if (w.mode === 'silent') next = '暂停中';
  else if (!w.nextAt) next = '—';
  else if (w.nextAt <= now) next = '马上';
  else next = whenLabel(w.nextAt, now);
  const self = w.selfAt ? whenLabel(w.selfAt, now) : '没有约';
  const selfTitle = w.selfAt && w.selfNote ? `${nameOf('assistant')}留的话：${w.selfNote}` : '';
  const items = [
    ['上次唤醒', last, ''],
    ['下次唤醒', next, ''],
    ['自主唤醒', self, selfTitle],
  ];
  return `<p class="wake-line">${items
    .map(([k, v, title]) =>
      `<span class="wake-item"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="wake-k">${k}</span> ${escapeHtml(v)}</span>`)
    .join('<span class="wake-sep" aria-hidden="true">·</span>')}</p>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --activity: #E6B652; --place: #9a6412; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 14px 0 24px; }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif;
    font-size: 42px; font-weight: 700; letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif;
    font-style: italic; font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .mood-line { margin: 12px auto 0; max-width: 90%; font-size: 13px; line-height: 1.5; color: var(--muted);
    word-break: break-word; }
  .mood-line .mood-label { color: var(--accent); margin-right: 4px; }
  .mood-link { display: inline-block; min-height: 44px; padding: 12px 10px; margin: -12px 0; color: inherit;
    text-decoration: none; border-radius: 12px; }
  .mood-link:active { background: rgba(122, 62, 93, 0.06); }
  .mood-num { font-family: Georgia, "Times New Roman", serif; font-size: 15px; color: var(--accent); }
  .mood-sep { color: var(--gold); }
  .mood-more { margin-left: 6px; color: var(--gold); font-size: 12px; white-space: nowrap; }
  .wake-line { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 6px; width: fit-content;
    max-width: 92%; margin: 12px auto 0; padding: 3px 12px; font-size: 12px; line-height: 1.6; font-style: italic;
    color: var(--place); background: #fff; border: 1px solid var(--activity); border-radius: 999px; }
  .wake-k { font-weight: 600; }
  .wake-sep { color: var(--activity); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>晨暮星</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu('/home')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function registerHomeRoutes(app, { requireBasicAuth }) {
  app.get('/home', requireBasicAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const top = await getTopDrives();
      res.send(layout(`<header class="hero">
        <h1 class="title">晨暮星</h1>
        <p class="subtitle" lang="en">Vesper<span aria-hidden="true">✨</span><span class="sr-only"> </span>Phosphor</p>
        ${renderMoodLine(currentMood(), top)}
        ${renderWakeLine()}
      </header>`));
    } catch (err) {
      console.error('home page: 渲染失败', err);
      // 情绪读不到也要把标题摆出来，不要整页 500
      res.send(layout(`<header class="hero">
        <h1 class="title">晨暮星</h1>
        <p class="subtitle" lang="en">Vesper<span aria-hidden="true">✨</span><span class="sr-only"> </span>Phosphor</p>
      </header>`));
    }
  });

  return true;
}
