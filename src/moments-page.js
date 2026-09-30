// 动态页 /moments：标题、此刻心情、纪念日、小日历、按天看动态、留言、回复、点赞。
// vesper.js 里挂载：registerMomentRoutes(app, { requireBasicAuth, requireApiKey })
// 页面是纯服务端渲染，不依赖 JavaScript，手机浏览器直接能用。展开详情、回复框都用 <details>。
import { getMoment, listMoments, listMomentComments, addMomentComment, getWakeState } from './state.js';
import {
  listMomentsBetween,
  listMomentTimestampsBetween,
  listAnniversaries,
  addAnniversary,
  deleteAnniversary,
  getComment,
  toggleLike,
  listLikes,
} from './moments-store.js';
import {
  pad,
  wallParts,
  wallMidnight,
  formatDateTime,
  parseDate,
  parseMonth,
  daysBetween,
  daysInMonth,
  firstWeekday,
} from './wall-time.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '我';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const MAX_COMMENT_CHARS = 1000;
const MAX_ANNIV_NAME = 30;
const MAX_MOOD_CHARS = 60;
const RECENT_LIMIT = 20;
const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];

// 动态、留言、纪念日名字都是模型 / 用户写的文字，拼进 HTML 前必须转义
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const nameOf = (author) => (author === 'user' ? USER_NAME : AI_NAME);

// 只放行本项目自己生成的媒体路径
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio)\/[\w.-]+$/.test(url) ? url : null;
}

// Basic Auth 下浏览器会自动带账号密码，别的网站也能偷偷替你提交表单。
// 所以写操作只接受同源提交：有 Origin 头就必须和本站一致。
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// 表单提交完跳回原来的页面，只允许跳到 /moments 自己
function safeBack(value) {
  const s = String(value ?? '');
  return /^\/moments(\?[\w=&%.-]*)?$/.test(s) ? s : '/moments';
}

const ymd = (p) => `${p.y}-${pad(p.m)}-${pad(p.d)}`;

function shiftMonth(y, m, delta) {
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1 };
}

function pageUrl(y, m, day) {
  return `/moments?month=${y}-${pad(m)}${day ? `&day=${day}` : ''}`;
}

// TA 最近一次醒来时写下的心情（wake_state.mood）。每次醒来都会更新，读库不调模型。
function currentMood() {
  try {
    const s = String(getWakeState()?.mood ?? '').replace(/\s+/g, ' ').trim();
    if (!s) return null;
    return s.length > MAX_MOOD_CHARS ? `${s.slice(0, MAX_MOOD_CHARS)}…` : s;
  } catch {
    return null;
  }
}

// 过去的日子显示已经多少天，将来的显示还有多少天
function describeCount(days) {
  if (days > 0) return `<b>${days}</b> 天`;
  if (days === 0) return '<b class="today-mark">就是今天</b>';
  return `还有 <b>${-days}</b> 天`;
}

function renderAnniversaries(list, today, back) {
  const items = list
    .map((a) => {
      const d = parseDate(a.date);
      const count = d ? describeCount(daysBetween(d, today)) : '';
      return `<li class="anniv-item">
        <div class="anniv-main"><span class="anniv-name">${escapeHtml(a.name)}</span><span class="anniv-date">${escapeHtml(a.date)}</span></div>
        <div class="anniv-count">${count}</div>
        <form method="post" action="/moments/anniversaries/${a.id}/delete" class="anniv-del" onsubmit="return confirm('确定删除这个纪念日吗？')">
          <input type="hidden" name="back" value="${escapeHtml(back)}" />
          <button type="submit" aria-label="删除纪念日：${escapeHtml(a.name)}" title="删除">×</button>
        </form>
      </li>`;
    })
    .join('');
  return `<section class="card" aria-labelledby="anniv-title">
    <h2 id="anniv-title" class="section-title">纪念日</h2>
    ${items ? `<ul class="anniv-list">${items}</ul>` : '<p class="empty">还没有纪念日，在下面添加一个吧。</p>'}
    <details class="anniv-add"${items ? '' : ' open'}>
      <summary>添加纪念日</summary>
      <form method="post" action="/moments/anniversaries">
        <input type="hidden" name="back" value="${escapeHtml(back)}" />
        <label for="anniv-name">名称</label>
        <input id="anniv-name" name="name" maxlength="${MAX_ANNIV_NAME}" placeholder="比如：恋爱纪念日" required />
        <label for="anniv-date">日期</label>
        <input id="anniv-date" name="date" type="date" required />
        <button type="submit">保存</button>
      </form>
    </details>
  </section>`;
}

function renderCalendar({ y, m, today, selected, marked }) {
  const prev = shiftMonth(y, m, -1);
  const next = shiftMonth(y, m, 1);
  const todayKey = ymd(today);
  const selectedKey = selected ? ymd(selected) : '';
  const cells = [];
  for (let i = 0; i < firstWeekday(y, m); i++) cells.push('<td></td>');
  const total = daysInMonth(y, m);
  for (let d = 1; d <= total; d++) {
    const key = `${y}-${pad(m)}-${pad(d)}`;
    const has = marked.has(d);
    const isToday = key === todayKey;
    const isSelected = key === selectedKey;
    const cls = ['day', has ? 'has' : '', isToday ? 'today' : '', isSelected ? 'selected' : '']
      .filter(Boolean)
      .join(' ');
    const label = `${m} 月 ${d} 日${isToday ? '，今天' : ''}${has ? '，有动态' : ''}`;
    cells.push(
      `<td><a class="${cls}" href="${pageUrl(y, m, key)}" aria-label="${label}"${isSelected ? ' aria-current="date"' : ''}><span aria-hidden="true">${d}</span>${has ? '<i class="dot" aria-hidden="true"></i>' : ''}</a></td>`
    );
  }
  while (cells.length % 7) cells.push('<td></td>');
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<tr>${cells.slice(i, i + 7).join('')}</tr>`);
  const onToday = selectedKey === todayKey;
  return `<section class="card" aria-labelledby="cal-title">
    <div class="cal-head">
      <a class="cal-nav" href="${pageUrl(prev.y, prev.m)}" aria-label="上个月">‹</a>
      <h2 id="cal-title" class="section-title">${y} 年 ${m} 月</h2>
      <a class="cal-nav" href="${pageUrl(next.y, next.m)}" aria-label="下个月">›</a>
    </div>
    <table class="cal">
      <thead><tr>${WEEKDAYS.map((w) => `<th scope="col">${w}</th>`).join('')}</tr></thead>
      <tbody>${rows.join('')}</tbody>
    </table>
    <div class="cal-foot">
      ${onToday ? '' : `<a href="${pageUrl(today.y, today.m, todayKey)}">看今天</a>`}
      ${selected ? '<a href="/moments">看最近的动态</a>' : ''}
    </div>
  </section>`;
}

// 留言框。replyTo 是要回复的那条留言；不传就是直接给动态留言
function commentForm(m, back, replyTo = null) {
  const inputId = replyTo ? `in-m${m.id}-r${replyTo.id}` : `in-m${m.id}`;
  const label = replyTo ? `回复${nameOf(replyTo.author)}的留言` : '给这条动态留言';
  const placeholder = replyTo ? `回复${nameOf(replyTo.author)}…` : '留言…';
  return `<form class="comment-form" method="post" action="/moments/${m.id}/comments">
    <input type="hidden" name="back" value="${escapeHtml(back)}" />
    ${replyTo ? `<input type="hidden" name="reply_to" value="${replyTo.id}" />` : ''}
    <label class="sr-only" for="${inputId}">${escapeHtml(label)}</label>
    <input id="${inputId}" name="content" maxlength="${MAX_COMMENT_CHARS}" placeholder="${escapeHtml(placeholder)}" required />
    <button type="submit">发送</button>
  </form>`;
}

// 把留言按"楼"分组：没有 reply_to 的是一楼，回复（包括回复的回复）都挂在它所在那一楼下面。
// 被回复的那条找不到了（理论上不会），就当它自己是一楼。
function buildThreads(comments) {
  const byId = new Map(comments.map((c) => [c.id, c]));
  const rootOf = (c) => {
    let cur = c;
    const seen = new Set();
    while (cur.reply_to && byId.has(cur.reply_to) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.reply_to);
    }
    return cur;
  };
  const threads = [];
  const threadOf = new Map();
  for (const c of comments) {
    const root = rootOf(c);
    if (root.id === c.id) {
      const t = { root: c, replies: [] };
      threads.push(t);
      threadOf.set(c.id, t);
    } else {
      threadOf.get(root.id)?.replies.push(c);
    }
  }
  return { threads, byId };
}

function renderComment(c, m, back, parent) {
  const mine = c.author === 'user';
  const to = parent ? `<span class="to">回复 ${escapeHtml(nameOf(parent.author))}</span>` : '';
  const unseen = mine && !c.handled ? ' · 还没看到' : '';
  return `<div class="comment ${mine ? 'mine' : 'theirs'}${parent ? ' reply' : ''}" id="cm${c.id}">
    <div class="comment-line"><span class="who">${escapeHtml(nameOf(c.author))}</span>${to}<span class="sep">：</span><span class="text">${escapeHtml(c.content)}</span></div>
    <div class="comment-meta">
      <span class="when">${escapeHtml(formatDateTime(c.ts))}${unseen}</span>
      <details class="reply-box"><summary aria-label="回复${escapeHtml(nameOf(c.author))}的这条留言"><span aria-hidden="true">↩️ 回复</span></summary>${commentForm(m, back, c)}</details>
    </div>
  </div>`;
}

function renderComments(m, back) {
  const { threads, byId } = buildThreads(listMomentComments(m.id));
  if (!threads.length) return '';
  const html = threads
    .map(
      (t) =>
        `<div class="thread">${renderComment(t.root, m, back, null)}${t.replies
          .map((r) => renderComment(r, m, back, byId.get(r.reply_to)))
          .join('')}</div>`
    )
    .join('');
  return `<div class="comments">${html}</div>`;
}

// 点赞：再点一次取消。旁边写上谁赞过
function renderLikeBar(m, back) {
  const likes = listLikes(m.id);
  const liked = likes.some((l) => l.author === 'user');
  const names = likes.map((l) => nameOf(l.author)).join('、');
  return `<div class="like-bar">
    <form method="post" action="/moments/${m.id}/like">
      <input type="hidden" name="back" value="${escapeHtml(back)}" />
      <button type="submit" class="like-btn${liked ? ' on' : ''}" aria-pressed="${liked}" aria-label="${liked ? '取消点赞' : '点赞'}"><span aria-hidden="true">${liked ? '♥' : '♡'}</span></button>
    </form>
    ${names ? `<span class="like-names">${escapeHtml(names)} 赞了</span>` : ''}
  </div>`;
}

function renderMoment(m, back, showDate) {
  const commentsHtml = renderComments(m, back);
  const likeBar = renderLikeBar(m, back);

  // 行为提示卡：暖黄底、白字。正文第一行是时间，第二行是做了什么；有详情的点开能看；留言框收起来
  if (m.kind === 'activity') {
    const body = `<span class="content">${escapeHtml(m.content)}</span>`;
    const main = m.detail
      ? `<details class="activity-detail">
          <summary>${body}<span class="expand-hint" aria-hidden="true">点开看详情 ▾</span><span class="sr-only">，展开行动详情</span></summary>
          <div class="detail">${escapeHtml(m.detail)}</div>
        </details>`
      : body;
    return `<article class="moment activity" id="m${m.id}" aria-label="行为提示">
      ${main}
      ${likeBar}
      ${commentsHtml}
      <details class="activity-reply"><summary>留言</summary>${commentForm(m, back)}</details>
    </article>`;
  }

  const img = safeMediaUrl(m.image_url);
  const audio = safeMediaUrl(m.audio_url);
  const time = formatDateTime(m.ts);
  return `<article class="moment" id="m${m.id}">
    <div class="ts">${escapeHtml(showDate ? time : time.slice(11))}</div>
    <div class="content">${escapeHtml(m.content)}</div>
    ${img ? `<img src="${img}" alt="动态配图" loading="lazy" />` : ''}
    ${audio ? `<audio controls preload="none" src="${audio}"></audio>` : ''}
    ${likeBar}
    ${commentsHtml}
    ${commentForm(m, back)}
  </article>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --activity: #E6B652; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 14px 0 24px; }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif; font-size: 42px;
    font-weight: 700; letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .mood-line { margin: 12px auto 0; max-width: 90%; font-size: 13px; line-height: 1.5; color: var(--muted); word-break: break-word; }
  .mood-line .mood-label { color: var(--accent); margin-right: 4px; }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .section-title { font-size: 15px; margin: 0 0 10px; color: var(--accent); letter-spacing: 0.1em; }
  .anniv-list { list-style: none; margin: 0; padding: 0; }
  .anniv-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); }
  .anniv-item:last-child { border-bottom: none; }
  .anniv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .anniv-name { font-weight: 600; }
  .anniv-date { font-size: 12px; color: var(--muted); }
  .anniv-count { font-size: 14px; color: var(--muted); white-space: nowrap; }
  .anniv-count b { font-family: Georgia, "Times New Roman", serif; font-size: 28px; color: var(--accent); margin-right: 2px; }
  .anniv-count b.today-mark { font-family: inherit; font-size: 16px; }
  .anniv-del button { background: none; border: none; color: var(--muted); font-size: 20px; min-width: 44px; min-height: 44px; padding: 0; }
  .anniv-add summary { cursor: pointer; color: var(--accent); font-size: 14px; margin-top: 8px; padding: 6px 0; }
  .anniv-add form { display: grid; gap: 6px; margin-top: 8px; }
  .anniv-add label { font-size: 13px; color: var(--muted); }
  input { padding: 9px 10px; border: 1px solid #cbbfc9; border-radius: 10px; font-size: 16px; background: #fff; color: var(--ink); }
  button { padding: 9px 14px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: 15px; }
  .cal-head { display: flex; align-items: center; justify-content: space-between; }
  .cal-head .section-title { margin: 0; }
  .cal-nav { display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; font-size: 26px;
    color: var(--accent); text-decoration: none; border-radius: 50%; }
  .cal { width: 100%; border-collapse: collapse; table-layout: fixed; margin-top: 4px; }
  .cal th { font-size: 12px; color: var(--muted); font-weight: 500; padding: 6px 0; }
  .cal td { text-align: center; padding: 2px; }
  .day { position: relative; display: flex; align-items: center; justify-content: center; height: 42px; border-radius: 12px;
    color: var(--ink); text-decoration: none; font-size: 15px; }
  .day.today { box-shadow: inset 0 0 0 1.5px var(--accent); font-weight: 700; }
  .day.selected { background: var(--accent); color: #fff; }
  .dot { position: absolute; bottom: 5px; left: 50%; width: 5px; height: 5px; margin-left: -2.5px; border-radius: 50%; background: var(--gold); }
  .day.selected .dot { background: #fff; }
  .cal-foot { display: flex; gap: 18px; justify-content: center; margin-top: 8px; font-size: 14px; }
  .cal-foot a { color: var(--accent); padding: 6px 0; }
  .list-title { font-size: 15px; color: var(--accent); margin: 22px 4px 10px; letter-spacing: 0.1em; }
  .moment { background: var(--card); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .moment .ts { color: var(--muted); font-size: 12px; margin-bottom: 6px; }
  .moment .content { display: block; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .moment img { max-width: 100%; border-radius: 8px; margin-top: 10px; display: block; }
  .moment audio { width: 100%; margin-top: 10px; }
  /* 行为提示卡：暖黄底白字。白字在这个黄上对比度偏低，加一点深色投影帮助辨认 */
  .moment.activity { background: var(--activity); color: #fff; border: none; padding: 12px 16px;
    box-shadow: 0 1px 3px rgba(120, 80, 20, 0.18); }
  .moment.activity .content { font-size: 15px; line-height: 1.55; font-weight: 600; color: #fff;
    text-shadow: 0 1px 2px rgba(90, 55, 10, 0.45); }
  .moment.activity .content::first-line { font-size: 12px; font-weight: 500; letter-spacing: 0.05em; }
  .activity-detail > summary { cursor: pointer; list-style: none; }
  .activity-detail > summary::-webkit-details-marker { display: none; }
  .expand-hint { display: block; margin-top: 4px; font-size: 12px; font-weight: 500; color: #fff;
    text-shadow: 0 1px 2px rgba(90, 55, 10, 0.45); }
  .activity-detail[open] .expand-hint { display: none; }
  .activity-detail .detail { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: rgba(255, 253, 251, 0.94);
    color: var(--ink); font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    max-height: 360px; overflow-y: auto; }
  .activity-reply summary { cursor: pointer; font-size: 13px; color: #fff; margin-top: 6px; padding: 4px 0;
    text-shadow: 0 1px 2px rgba(90, 55, 10, 0.45); }
  .moment.activity .comments { background: rgba(255, 253, 251, 0.94); color: var(--ink); }
  .moment.activity a:focus-visible, .moment.activity summary:focus-visible, .moment.activity button:focus-visible { outline-color: #fff; }
  .like-bar { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
  .like-btn { background: none; color: var(--accent); font-size: 22px; line-height: 1; min-width: 44px; min-height: 44px;
    padding: 0; margin-left: -10px; }
  .like-names { font-size: 13px; color: var(--muted); }
  .moment.activity .like-btn, .moment.activity .like-names { color: #fff; text-shadow: 0 1px 2px rgba(90, 55, 10, 0.45); }
  .comments { margin-top: 8px; background: #f3eef2; border-radius: 8px; padding: 8px 10px; }
  .thread + .thread { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 4px; }
  .comment { font-size: 14px; line-height: 1.5; padding: 3px 0; }
  .comment-line { word-break: break-word; }
  .who { font-weight: 600; }
  .theirs .who { color: var(--accent); }
  .to { margin-left: 4px; font-size: 12px; color: var(--muted); }
  .comment-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 0 10px; }
  .when { color: var(--muted); font-size: 11px; }
  .reply-box > summary { cursor: pointer; list-style: none; font-size: 12px; color: var(--muted); padding: 6px 0; }
  .reply-box > summary::-webkit-details-marker { display: none; }
  .reply-box[open] { flex-basis: 100%; }
  .reply-box .comment-form { margin-top: 2px; }
  /* 回复：缩进、小一号、灰一点 */
  .comment.reply { margin-left: 12px; padding-left: 8px; border-left: 2px solid var(--line); font-size: 13px; color: var(--muted); }
  .comment.reply .who { color: var(--muted); }
  .comment-form { display: flex; gap: 8px; margin-top: 10px; }
  .comment-form input { flex: 1; min-width: 0; }
  .empty { color: var(--muted); font-size: 14px; }
  a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function renderPage({ today, month, selected, anniversaries, marked, moments, back, mood }) {
  const listTitle = selected ? `${selected.m} 月 ${selected.d} 日的动态` : '最近的动态';
  const empty = selected ? '这一天还没有动态。' : '还没有动态。';
  const items = moments.map((m) => renderMoment(m, back, !selected)).join('');
  const moodLine = mood
    ? `<p class="mood-line"><span class="mood-label">${escapeHtml(AI_NAME)}此刻：</span>${escapeHtml(mood)}</p>`
    : '';
  return layout(
    '晨暮星',
    `<header class="hero">
      <h1 class="title">晨暮星</h1>
      <p class="subtitle" lang="en">Vesper<span aria-hidden="true">✨</span><span class="sr-only"> </span>Phosphor</p>
      ${moodLine}
    </header>
    ${renderAnniversaries(anniversaries, today, back)}
    ${renderCalendar({ y: month.y, m: month.m, today, selected, marked })}
    <section aria-labelledby="list-title">
      <h2 id="list-title" class="list-title">${listTitle}</h2>
      ${items || `<p class="empty">${empty}</p>`}
    </section>`
  );
}

function errorPage(message, back) {
  return layout('出错了', `<div class="card"><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">返回</a></p></div>`);
}

// 你的留言。replyTo 可选：要回复的那条留言 id，必须在同一条动态下
function createUserComment(momentId, content, replyTo) {
  const text = String(content ?? '').trim();
  if (!text) return { error: '留言不能为空' };
  if (text.length > MAX_COMMENT_CHARS) return { error: `留言最多 ${MAX_COMMENT_CHARS} 字` };
  if (!getMoment(momentId)) return { error: '找不到这条动态' };
  let replyToId = null;
  if (replyTo !== undefined && replyTo !== null && replyTo !== '') {
    const parent = getComment(Number(replyTo));
    if (!parent || parent.moment_id !== momentId) return { error: '要回复的那条留言找不到了' };
    replyToId = parent.id;
  }
  return { id: addMomentComment({ momentId, author: 'user', content: text, replyTo: replyToId }) };
}

export function registerMomentRoutes(app, { requireBasicAuth, requireApiKey }) {
  // ---- 程序化访问（快捷指令、以后的前端）----
  app.get('/wake/moments', requireApiKey, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    res.json(listMoments(limit).map((m) => ({ ...m, comments: listMomentComments(m.id), likes: listLikes(m.id) })));
  });

  app.post('/wake/moments/:id/comments', requireApiKey, (req, res) => {
    const r = createUserComment(Number(req.params.id), req.body?.content, req.body?.reply_to);
    if (r.error) return res.status(400).json({ error: r.error });
    res.json({ ok: true, id: r.id });
  });

  app.post('/wake/moments/:id/like', requireApiKey, (req, res) => {
    const id = Number(req.params.id);
    if (!getMoment(id)) return res.status(404).json({ error: '找不到这条动态' });
    res.json({ ok: true, liked: toggleLike(id, 'user') });
  });

  app.get('/wake/anniversaries', requireApiKey, (req, res) => res.json(listAnniversaries()));

  // ---- 网页 ----
  app.get('/moments', requireBasicAuth, (req, res) => {
    const now = wallParts();
    const today = { y: now.y, m: now.m, d: now.d };
    const selected = parseDate(req.query.day);
    const month =
      parseMonth(req.query.month) ?? (selected ? { y: selected.y, m: selected.m } : { y: today.y, m: today.m });

    const monthStart = wallMidnight(month.y, month.m, 1);
    const monthEnd = wallMidnight(month.y, month.m + 1, 1);
    const marked = new Set(listMomentTimestampsBetween(monthStart, monthEnd).map((r) => wallParts(r.ts).d));

    const moments = selected
      ? listMomentsBetween(wallMidnight(selected.y, selected.m, selected.d), wallMidnight(selected.y, selected.m, selected.d + 1))
      : listMoments(RECENT_LIMIT);

    const back = selected
      ? pageUrl(month.y, month.m, ymd(selected))
      : req.query.month
        ? pageUrl(month.y, month.m)
        : '/moments';

    res.send(
      renderPage({ today, month, selected, anniversaries: listAnniversaries(), marked, moments, back, mood: currentMood() })
    );
  });

  app.post('/moments/anniversaries', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    const name = String(req.body?.name ?? '').trim();
    const date = parseDate(req.body?.date);
    if (!name || name.length > MAX_ANNIV_NAME) {
      return res.status(400).send(errorPage(`名称不能为空，最多 ${MAX_ANNIV_NAME} 个字`, back));
    }
    if (!date) return res.status(400).send(errorPage('日期不对，请重新选择', back));
    addAnniversary(name, ymd(date));
    res.redirect(303, back);
  });

  app.post('/moments/anniversaries/:id/delete', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    const id = Number(req.params.id);
    if (Number.isInteger(id)) deleteAnniversary(id);
    res.redirect(303, back);
  });

  app.post('/moments/:id/comments', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    const id = Number(req.params.id);
    const r = createUserComment(id, req.body?.content, req.body?.reply_to);
    if (r.error) return res.status(400).send(errorPage(r.error, back));
    res.redirect(303, `${back}#m${id}`);
  });

  app.post('/moments/:id/like', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    const id = Number(req.params.id);
    if (!getMoment(id)) return res.status(404).send(errorPage('找不到这条动态', back));
    toggleLike(id, 'user');
    res.redirect(303, `${back}#m${id}`);
  });

  // 旧入口：日记已经换成动态
  app.get('/diary', (req, res) => res.redirect(301, '/moments'));
}
