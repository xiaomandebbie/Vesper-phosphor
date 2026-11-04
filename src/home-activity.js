// 主页上那一条动作卡。
//
// 小满 2026-11-04：「动作卡片这里加一份」——聊天页那份留着不动，
// 主页再摆一份。不是搬，是另一份。
//
// 读取口径照抄 chat-page.js，不自己另造一套：
//   listMomentsBetween 拿最近七天，滤 kind='activity'；
//   splitCard 按第一个换行拆成「MM-DD HH:mm」和正文（见 addActivityMoment）。
// 那边改了这边要跟着核一遍。
//
// 叠成一摞那套（groupForDisplay / renderStack）没搬过来：
// 主页只是瞥一眼最近做了什么，一张张排开就行，不需要翻。
//
// 颜色全走 var()：主页是灰阶的，写死原来那个暖黄框就跟不上。

import { listMomentsBetween } from './moments-store.js';
import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';

// 主页摆几张。多了把下面的东西挤没，要看全部去聊天页
const LIMIT = 6;
const DAYS = 7;

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 行动卡的正文是「MM-DD HH:mm\n做了什么」两行（和 chat-page.js 同一个拆法）
function splitCard(raw) {
  const text = tidyActivityContent(raw);
  const nl = text.indexOf('\n');
  if (nl < 0) return { when: '', body: text.trim() };
  return { when: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
}

export function renderActivityStrip(now = Date.now()) {
  let rows;
  try {
    rows = listMomentsBetween(now - DAYS * 86400000, now + 60000)
      .filter((m) => m.kind === 'activity')
      .slice(0, LIMIT);
  } catch (err) {
    console.error('home page: 读不到动作卡', err.message);
    return '';
  }
  if (!rows.length) return '';

  const cards = rows.map((m) => {
    const { when, body } = splitCard(m.content);
    const detail = tidyActivityDetail(m.detail);
    const head = `<span class="act-when">${escapeHtml(when)}</span><span class="act-body">${escapeHtml(body)}</span>`;
    // 有详情的点开能看，没详情的就是一行字，不给它假的展开箭头
    const inner = detail
      ? `<details class="act-fold">
          <summary>${head}<i class="act-more" aria-hidden="true">\u25be</i><span class="sr-only">，展开详情</span></summary>
          <div class="act-detail">${escapeHtml(detail)}</div>
        </details>`
      : head;
    return `<article class="act" id="home-m${m.id}">${inner}</article>`;
  });

  return `<section class="act-strip" aria-label="最近做的事">
    <h2 class="act-title">最近做的事</h2>
    ${cards.join('')}
  </section>`;
}

export const ACTIVITY_STRIP_CSS = `
  .act-strip { margin: 26px 0 0; }
  .act-title { margin: 0 4px 10px; font-size: 13px; font-weight: 500; letter-spacing: 0.14em;
    color: var(--muted, #5e5e5e); }
  .act { margin-bottom: 10px; padding: 12px 14px; border-radius: 14px;
    background: var(--card, #fdfdfd); border: 1px solid var(--line, #e2e2e2);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
  .act-when { display: block; font-size: 11px; letter-spacing: 0.05em; color: var(--muted, #5e5e5e);
    font-variant-numeric: tabular-nums; }
  .act-body { display: block; margin-top: 3px; font-size: 14px; line-height: 1.55;
    color: var(--ink, #252525); word-break: break-word; }
  .act-fold > summary { list-style: none; cursor: pointer; position: relative; padding-right: 20px; }
  .act-fold > summary::-webkit-details-marker { display: none; }
  .act-more { position: absolute; right: 0; top: 50%; margin-top: -8px; font-style: normal;
    font-size: 12px; color: var(--gold, #818181); transition: transform 0.2s ease; }
  .act-fold[open] .act-more { transform: rotate(180deg); }
  .act-detail { margin-top: 9px; padding: 10px 12px; border-radius: 10px;
    background: var(--card-soft, #f2f2f2); color: var(--ink, #252525);
    font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    max-height: 300px; overflow-y: auto; }
  @media (prefers-reduced-motion: reduce) { .act-more { transition: none; } }
`;
