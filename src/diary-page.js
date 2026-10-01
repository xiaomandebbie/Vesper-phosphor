// 日记页 /diary：heartbeat 自动写的日记，换成晨暮星的样子。只读，不改 heartbeat 的任何东西。
// heartbeat 把日记存成一天一个 .md 文件（YYYY-MM-DD.md），每篇是「## YYYY-MM-DD HH:mm」开头的一段。
// 目录在 .env 的 HEARTBEAT_DIARY_DIR 里配（绝对路径）；没配就不挂这个页面，/diary 还是跳回动态页。
// vesper.js 里挂载：registerDiaryRoutes(app, { requireBasicAuth })，要挂在动态页路由之前。
import fs from 'fs';
import path from 'path';
import { pad, wallParts, parseDate, parseMonth, daysInMonth, firstWeekday } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT, diaryDir } from './page-chrome.js';

const FILE_RE = /^(\d{4})-(\d{2})-(\d{2})\.md$/;
// 每篇的开头：heartbeat 写的「## 2026-10-01 07:34」。正文里 TA 自己写的「## 小标题」不算新的一篇
const ENTRY_HEAD_RE = /^##[ \t]+(\d{4}-\d{2}-\d{2}[ T]\d{1,2}:\d{2}[^\n]*)$/m;
// 一天的日记最多读这么多，再多就截断（正常一天几 KB）
const MAX_FILE_BYTES = 512 * 1024;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const ymd = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

function shiftMonth(y, m, delta) {
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}

const dayUrl = (key) => `/diary?day=${key}`;
const monthUrl = (y, m) => `/diary?month=${y}-${pad(m)}&open=1`;

// 有日记的日子，新的在前。目录还不存在就当没有
function listDays(dir) {
  try {
    return fs
      .readdirSync(dir)
      .filter((name) => FILE_RE.test(name))
      .map((name) => name.slice(0, 10))
      .sort()
      .reverse();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

// 一天的日记拆成一篇篇：「## 日期 时间」是每篇的开头，前面没有标题的部分也算一篇
function readEntries(dir, key) {
  let buf;
  try {
    const file = path.join(dir, `${key}.md`);
    if (!fs.statSync(file).isFile()) return { entries: [], truncated: false };
    buf = fs.readFileSync(file);
  } catch {
    return { entries: [], truncated: false };
  }
  const truncated = buf.length > MAX_FILE_BYTES;
  const text = buf.subarray(0, MAX_FILE_BYTES).toString('utf-8');
  const parts = text.split(new RegExp(ENTRY_HEAD_RE.source, 'gm'));
  const entries = [];
  if (parts[0].trim()) entries.push({ when: '', body: parts[0].trim() });
  for (let i = 1; i < parts.length; i += 2) {
    const body = String(parts[i + 1] ?? '').trim();
    if (body) entries.push({ when: parts[i].trim(), body });
  }
  return { entries, truncated };
}

// 标题里有时间就只显示时间（"2026-10-01 07:34" → "07:34"）
function entryTime(when) {
  const m = /(\d{1,2}:\d{2})/.exec(when);
  return m ? m[1] : when;
}

// 正文转义后保留换行。「# 小标题」一行和 **加粗** 显示成加粗，别的 Markdown 原样显示
function formatBody(text) {
  return escapeHtml(text)
    .replace(/^#{1,6}[ \t]+(.+)$/gm, '<b>$1</b>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
}

function renderCalendar({ y, m, today, selected, marked, open }) {
  const prev = shiftMonth(y, m, -1);
  const next = shiftMonth(y, m, 1);
  const todayKey = ymd(today);
  const selectedKey = selected ? ymd(selected) : '';
  const cells = [];
  for (let i = 0; i < firstWeekday(y, m); i++) cells.push('<td></td>');
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    const has = marked.has(key);
    const isToday = key === todayKey;
    const isSelected = key === selectedKey;
    const cls = ['day', has ? 'has' : '', isToday ? 'today' : '', isSelected ? 'selected' : ''].filter(Boolean).join(' ');
    const label = `${m} 月 ${d} 日${isToday ? '，今天' : ''}${has ? '，有日记' : ''}`;
    cells.push(
      `<td><a class="${cls}" href="${dayUrl(key)}" aria-label="${label}"${isSelected ? ' aria-current="date"' : ''}><span aria-hidden="true">${d}</span>${has ? '<i class="dot" aria-hidden="true"></i>' : ''}</a></td>`
    );
  }
  while (cells.length % 7) cells.push('<td></td>');
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  return `<section class="card cal-card" aria-label="日历">
    <a class="cal-nav cal-prev" href="${monthUrl(prev.y, prev.m)}" aria-label="上个月">‹</a>
    <a class="cal-nav cal-next" href="${monthUrl(next.y, next.m)}" aria-label="下个月">›</a>
    <details class="cal-fold"${open ? ' open' : ''}>
      <summary><h2 class="cal-title">${y} 年 ${m} 月</h2><span class="cal-caret" aria-hidden="true">▾</span><span class="sr-only">，点开看日期</span></summary>
      <div class="cal-body">
        <table class="cal">
          <thead><tr>${WEEKDAYS.map((w) => `<th scope="col">${w}</th>`).join('')}</tr></thead>
          <tbody>${rows.join('')}</tbody>
        </table>
      </div>
    </details>
  </section>`;
}

// 前一篇 / 后一篇：跳到有日记的那一天，不是简单的前一天后一天
function renderDayNav(days, key) {
  const older = days.find((d) => d < key);
  const newer = [...days].reverse().find((d) => d > key);
  const link = (d, text, cls) =>
    d ? `<a class="day-nav-link ${cls}" href="${dayUrl(d)}">${text}</a>` : `<span class="day-nav-link ${cls} off" aria-hidden="true">${text}</span>`;
  return `<nav class="day-nav" aria-label="翻日记">${link(older, '‹ 前一篇', 'prev')}${link(newer, '后一篇 ›', 'next')}</nav>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 10px 0 20px; }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif; font-size: 28px;
    font-weight: 700; letter-spacing: 0.3em; padding-left: 0.3em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .notice { font-size: 14px; line-height: 1.6; border-left: 4px solid var(--gold); }
  .notice code { font-size: 12px; background: #f6eef3; padding: 1px 4px; border-radius: 4px; word-break: break-all; }
  /* 日历：平时只有月份这一行，点开才露出日期 */
  .cal-card { position: relative; padding: 0; }
  .cal-fold > summary { list-style: none; display: flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 56px; padding: 6px 56px; cursor: pointer; border-radius: 16px; }
  .cal-fold > summary::-webkit-details-marker { display: none; }
  .cal-title { margin: 0; font-size: 15px; color: var(--accent); letter-spacing: 0.1em; }
  .cal-caret { color: var(--gold); font-size: 12px; transition: transform 0.2s ease; }
  .cal-fold[open] .cal-caret { transform: rotate(180deg); }
  .cal-fold[open] .cal-body { animation: cal-in 0.24s ease-out; }
  @keyframes cal-in { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }
  .cal-body { padding: 0 16px 14px; }
  .cal-nav { position: absolute; top: 6px; z-index: 1; display: inline-flex; align-items: center; justify-content: center;
    width: 44px; height: 44px; font-size: 26px; color: var(--accent); text-decoration: none; border-radius: 50%; }
  .cal-prev { left: 8px; }
  .cal-next { right: 8px; }
  .cal { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .cal th { font-size: 12px; color: var(--muted); font-weight: 500; padding: 6px 0; }
  .cal td { text-align: center; padding: 2px; }
  .day { position: relative; display: flex; align-items: center; justify-content: center; height: 42px; border-radius: 12px;
    color: var(--ink); text-decoration: none; font-size: 15px; }
  .day.today { box-shadow: inset 0 0 0 1.5px var(--accent); font-weight: 700; }
  .day.selected { background: var(--accent); color: #fff; }
  .dot { position: absolute; bottom: 5px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--gold); }
  .day.selected .dot { background: #fff; }
  .list-title { font-size: 15px; color: var(--accent); margin: 22px 4px 10px; letter-spacing: 0.1em; }
  /* 一篇日记：时间在上，正文用宋体，像写在本子上 */
  .entry { background: var(--card); border-radius: 14px; padding: 14px 18px 16px; margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); border-left: 3px solid #e3b7cb; }
  .entry-when { font-size: 12px; color: var(--gold); letter-spacing: 0.08em; margin-bottom: 6px; }
  .entry-when::before { content: '✦ '; }
  .entry-body { font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif; font-size: 16px; line-height: 1.85;
    white-space: pre-wrap; word-break: break-word; }
  .entry-body b { color: var(--accent); }
  .day-nav { display: flex; justify-content: space-between; margin: 6px 4px 0; }
  .day-nav-link { display: inline-flex; align-items: center; min-height: 44px; padding: 0 6px; font-size: 14px; color: var(--accent); }
  .day-nav-link.off { color: #c8bccb; }
  .empty { color: var(--muted); font-size: 14px; margin: 0 4px; }
  .hint { color: var(--muted); font-size: 12px; margin: 4px 4px 0; }
  a:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
  @media (prefers-reduced-motion: reduce) { .cal-fold[open] .cal-body { animation: none; } .cal-caret { transition: none; } }
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
<body><main>${renderMenu('/diary')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

function hero() {
  const name = getProfile('assistant').name;
  return `<header class="hero">
    <h1 class="title">日记</h1>
    <p class="subtitle"><span lang="en">Diary</span> <span aria-hidden="true">✦</span> ${escapeHtml(name)}写的</p>
  </header>`;
}

export function registerDiaryRoutes(app, { requireBasicAuth }) {
  const configured = diaryDir();
  if (!configured) return false;
  const dir = path.resolve(configured);

  app.get('/diary', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const now = wallParts();
      const today = { y: now.y, m: now.m, d: now.d };
      const days = listDays(dir);
      const selected = parseDate(req.query.day) ?? (days[0] ? parseDate(days[0]) : today);
      const month = parseMonth(req.query.month) ?? { y: selected.y, m: selected.m };
      const key = ymd(selected);
      const { entries, truncated } = readEntries(dir, key);

      const list = entries.length
        ? entries
            .map(
              (e) => `<article class="entry">
          ${e.when ? `<div class="entry-when">${escapeHtml(entryTime(e.when))}</div>` : ''}
          <div class="entry-body">${formatBody(e.body)}</div>
        </article>`
            )
            .join('')
        : `<p class="empty">${days.length ? '这一天没有日记。' : '还没有日记。heartbeat 醒来写了日记之后会出现在这里。'}</p>`;

      const body = `${hero()}
        ${renderCalendar({ y: month.y, m: month.m, today, selected, marked: new Set(days), open: req.query.open === '1' })}
        <section aria-labelledby="day-title">
          <h2 id="day-title" class="list-title">${pad(selected.m)}月${pad(selected.d)}日的日记</h2>
          ${list}
          ${truncated ? '<p class="hint">这一天写得太多了，后面没显示全。</p>' : ''}
          ${days.length ? renderDayNav(days, key) : ''}
        </section>`;
      res.send(layout('日记 · 晨暮星', body));
    } catch (err) {
      console.error('diary page: 渲染失败', err);
      res
        .status(500)
        .send(
          layout(
            '日记 · 晨暮星',
            `${hero()}<div class="card notice" role="alert">读不了日记目录 <code>${escapeHtml(dir)}</code>。看一下 HEARTBEAT_DIARY_DIR 填得对不对、vesper 有没有权限读它。</div>`
          )
        );
    }
  });

  return true;
}
