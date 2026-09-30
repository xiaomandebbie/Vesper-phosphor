// 动态页 /moments：标题、此刻心情、纪念日、小日历、按天看动态、留言、回复、点赞、头像和名字。
// vesper.js 里挂载：registerMomentRoutes(app, { requireBasicAuth, requireApiKey })
// 页面是服务端渲染，没有 JavaScript 也能看、能留言。JavaScript 只做锦上添花的事：
//   语音条点击播放（没有 JS 时退回浏览器自带的播放器）；
//   同一时间的几张动作卡片叠成一摞，左右箭头轮换（没有 JS 时一张张排开）；
//   设置页上传头像前在浏览器里裁成正方形。
import fs from 'fs';
import path from 'path';
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
  PROFILE_WHO,
  defaultName,
  getProfile,
  saveProfileName,
  saveProfileAvatar,
  resetProfileAvatar,
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
import { getTopDrives } from './drives.js';
import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MAX_COMMENT_CHARS = 1000;
const MAX_ANNIV_NAME = 30;
const MAX_MOOD_CHARS = 60;
const MAX_NAME_CHARS = 20;
const RECENT_LIMIT = 20;
// 语音是 ElevenLabs 默认的 128kbps mp3，先按文件大小估时长；浏览器读到真实时长后再校正
const AUDIO_BYTES_PER_SEC = 128000 / 8;
// 动作卡片和同一摞里最新那张相差不超过这么久、中间没夹着别的动态，就叠在一起。
// 一次醒来逛论坛连走几步，前后一般就一两分钟
const STACK_WINDOW_MS = 5 * 60 * 1000;
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

// 显示用的名字：设置页填过就用填的，没填用 .env 的称呼
const nameOf = (author) => getProfile(author === 'user' ? 'user' : 'assistant').name;

// 只放行本项目自己生成的媒体路径
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio|avatars)\/[\w.-]+$/.test(url) ? url : null;
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

// 头像：设置过就用图片，没设置就是名字第一个字。旁边总会写名字，所以头像本身不再给读屏读一遍
function avatarHtml(who, size = 'md') {
  const p = getProfile(who);
  const cls = `avatar avatar-${size} avatar-${p.who === 'user' ? 'user' : 'ta'}`;
  const url = safeMediaUrl(p.avatarUrl);
  if (url) return `<img class="${cls}" src="${url}" alt="" loading="lazy" />`;
  const first = Array.from(p.name.trim())[0] || '?';
  return `<span class="${cls}" aria-hidden="true">${escapeHtml(first)}</span>`;
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

// 标题下那一行"TA此刻"。接了 Drivesoid 就显示此刻最明显的三项情绪（和 decide 醒来时看到的是同一份），
// 读不到就退回 TA 上次醒来写下的心情。整行始终可以点，进心绪页 /drives。
function renderMoodLine(mood, top) {
  const aiName = nameOf('assistant');
  const label = `<span class="mood-label">${escapeHtml(aiName)}此刻：</span>`;
  let inner;
  if (top?.length) {
    inner =
      label +
      top
        .map((t) => `${escapeHtml(t.label)} <b class="mood-num">${t.value}</b>`)
        .join('<span class="mood-sep" aria-hidden="true"> · </span><span class="sr-only">，</span>');
  } else if (mood) {
    inner = label + escapeHtml(mood);
  } else {
    inner = `看看${escapeHtml(aiName)}此刻的心绪`;
  }
  return `<p class="mood-line"><a class="mood-link" href="/drives">${inner}<span class="mood-more" aria-hidden="true">✦ 心绪 ›</span><span class="sr-only">，点开看心绪</span></a></p>`;
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
    ${avatarHtml(mine ? 'user' : 'assistant', 'sm')}
    <div class="comment-body">
      <div class="comment-line"><span class="who">${escapeHtml(nameOf(c.author))}</span>${to}<span class="sep">：</span><span class="text">${escapeHtml(c.content)}</span></div>
      <div class="comment-meta">
        <span class="when">${escapeHtml(formatDateTime(c.ts))}${unseen}</span>
        <details class="reply-box"><summary aria-label="回复${escapeHtml(nameOf(c.author))}的这条留言"><span aria-hidden="true">↩️ 回复</span></summary>${commentForm(m, back, c)}</details>
      </div>
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

// ---------- 语音条 ----------
// 样子参考微信：淡粉色气泡，左边一个小尖角，声波图标，时长写在气泡外面，越长越宽。
// 点一下播放，再点暂停；同时只放一条。没有 JavaScript 时显示浏览器自带的播放器。

const VOICE_ICON = `<svg class="voice-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
  <circle class="w0" cx="7" cy="12" r="2" fill="currentColor"/>
  <path class="w1" d="M11 8a5.5 5.5 0 0 1 0 8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  <path class="w2" d="M15 4.5a10.5 10.5 0 0 1 0 15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
</svg>`;

// 按文件大小估一个时长（秒）。文件已经被按天清理掉了就返回 null
function audioSeconds(url) {
  const name = url.split('/').pop();
  try {
    const { size } = fs.statSync(path.join(MEDIA_DIR, 'audio', name));
    return Math.max(1, Math.round(size / AUDIO_BYTES_PER_SEC));
  } catch {
    return null;
  }
}

const formatSeconds = (s) => (s < 60 ? `${s}″` : `${Math.floor(s / 60)}′${s % 60}″`);
// 1 秒 96px，60 秒及以上 240px，和微信一样越长越宽
const voiceWidth = (s) => Math.round(Math.min(96 + Math.min(s, 60) * 2.4, 240));

function renderVoice(url) {
  const sec = audioSeconds(url);
  if (sec == null) return '<div class="voice"><span class="voice-gone">语音已过期</span></div>';
  return `<div class="voice">
      <button type="button" class="voice-bar" style="width:${voiceWidth(sec)}px" aria-pressed="false" aria-label="播放语音，约 ${sec} 秒">${VOICE_ICON}</button>
      <span class="voice-dur" aria-hidden="true">${formatSeconds(sec)}</span>
      <audio class="voice-audio" controls preload="metadata" src="${url}"></audio>
    </div>`;
}

// 浏览器里跑的：点语音条播放 / 暂停，读到真实时长后校正宽度和秒数。算宽度的公式和 voiceWidth 一样
const VOICE_SCRIPT = `(function () {
  var current = null;
  function fmt(s) { return s < 60 ? s + '″' : Math.floor(s / 60) + '′' + (s % 60) + '″'; }
  document.querySelectorAll('.voice').forEach(function (box) {
    var audio = box.querySelector('audio');
    var btn = box.querySelector('.voice-bar');
    var dur = box.querySelector('.voice-dur');
    if (!audio || !btn) return;
    function exact() {
      var d = audio.duration;
      if (!isFinite(d) || d <= 0) return;
      var s = Math.max(1, Math.round(d));
      btn.style.width = Math.round(Math.min(96 + Math.min(s, 60) * 2.4, 240)) + 'px';
      if (dur) dur.textContent = fmt(s);
      btn.setAttribute('aria-label', '播放语音，' + s + ' 秒');
    }
    function stopped() { btn.classList.remove('playing'); btn.setAttribute('aria-pressed', 'false'); }
    audio.addEventListener('loadedmetadata', exact);
    audio.addEventListener('durationchange', exact);
    audio.addEventListener('play', function () { btn.classList.add('playing'); btn.setAttribute('aria-pressed', 'true'); });
    audio.addEventListener('pause', stopped);
    audio.addEventListener('ended', function () { stopped(); audio.currentTime = 0; if (current === audio) current = null; });
    btn.addEventListener('click', function () {
      if (!audio.paused) { audio.pause(); return; }
      if (current && current !== audio) { current.pause(); current.currentTime = 0; }
      current = audio;
      var p = audio.play();
      if (p && p.catch) p.catch(stopped);
    });
  });
})();`;

// ---------- 动作卡片 ----------

// 卡片里的"在哪做的"用黄色加粗：Lutopia 论坛、OB 记忆库，以及别的 MCP 服务名。
// 传进来的是已经转义过的 HTML
function highlightPlaces(html) {
  return html
    .replace(/(Lutopia 论坛|OB 记忆库)/g, '<b class="act-place">$1</b>')
    .replace(/用了 (\S+?) 的 /g, '用了 <b class="act-place">$1</b> 的 ');
}

// 一张动作卡片：白底黄框，只留时间、做了什么，有详情的点开能看；不放头像、点赞和留言。
// 不显示命令原文：老卡片里存着的命令，在这里整理掉；回帖、发帖显示回了什么、发了什么
function renderActivityCard(m, inStack = false) {
  const content = tidyActivityContent(m.content);
  const detail = tidyActivityDetail(m.detail);
  const body = `<span class="content">${highlightPlaces(escapeHtml(content))}</span>`;
  const main = detail
    ? `<details class="activity-detail">
        <summary>${body}<span class="expand-hint" aria-hidden="true">点开看详情 <i class="hint-arrow">▾</i></span><span class="sr-only">，展开行动详情</span></summary>
        <div class="detail">${escapeHtml(detail)}</div>
      </details>`
    : body;
  return `<article class="moment activity${inStack ? ' stack-item' : ''}" id="m${m.id}" aria-label="行为提示">
    ${main}
  </article>`;
}

// 列表是新的在前。连着的动作卡片，和这一摞里最新那张相差不超过 STACK_WINDOW_MS 的，归成一摞；
// 中间夹着 TA 发的动态就断开
function groupForDisplay(moments) {
  const out = [];
  for (const m of moments) {
    const last = out[out.length - 1];
    if (m.kind === 'activity' && last?.type === 'stack' && Math.abs(last.items[0].ts - m.ts) <= STACK_WINDOW_MS) {
      last.items.push(m);
      continue;
    }
    out.push(m.kind === 'activity' ? { type: 'stack', items: [m] } : { type: 'post', m });
  }
  return out;
}

// 一摞卡片。只有一张就照常显示。
// 摞里从早到晚排，‹ 往前、› 往后，一开始停在最新那张。没有 JavaScript 时一张张排开
function renderStack(items) {
  if (items.length === 1) return renderActivityCard(items[0]);
  const ordered = [...items].reverse();
  const n = ordered.length;
  const dots = ordered.map((_, k) => `<i class="stack-dot${k === n - 1 ? ' on' : ''}"></i>`).join('');
  return `<section class="act-stack" data-stack aria-label="同一时间的 ${n} 个行动">
    <div class="stack-row">
      <button type="button" class="stack-arrow" data-stack-prev aria-label="上一个行动"><span aria-hidden="true">‹</span></button>
      <div class="stack-viewport">${ordered.map((m) => renderActivityCard(m, true)).join('')}</div>
      <button type="button" class="stack-arrow" data-stack-next aria-label="下一个行动"><span aria-hidden="true">›</span></button>
    </div>
    <div class="stack-dots" aria-hidden="true">${dots}</div>
    <p class="sr-only" aria-live="polite" data-stack-live></p>
  </section>`;
}

// 浏览器里跑的：一摞卡片只露出一张，左右箭头 / 左右滑动 / 键盘左右键轮换，到头了从另一头接上
const STACK_SCRIPT = `(function () {
  document.querySelectorAll('[data-stack]').forEach(function (stack) {
    var items = [].slice.call(stack.querySelectorAll('.stack-item'));
    if (items.length < 2) return;
    stack.classList.add('ready');
    var dots = [].slice.call(stack.querySelectorAll('.stack-dot'));
    var live = stack.querySelector('[data-stack-live]');
    var vp = stack.querySelector('.stack-viewport');
    var i = items.length - 1;
    function show(n, dir) {
      n = (n + items.length) % items.length;
      items.forEach(function (el, k) {
        el.hidden = k !== n;
        el.classList.remove('in-next', 'in-prev');
      });
      var el = items[n];
      if (dir) {
        void el.offsetWidth;
        el.classList.add(dir > 0 ? 'in-next' : 'in-prev');
        if (live) live.textContent = '第 ' + (n + 1) + ' 个，共 ' + items.length + ' 个';
      }
      dots.forEach(function (d, k) { d.classList.toggle('on', k === n); });
      i = n;
    }
    stack.querySelector('[data-stack-prev]').addEventListener('click', function () { show(i - 1, -1); });
    stack.querySelector('[data-stack-next]').addEventListener('click', function () { show(i + 1, 1); });
    stack.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowLeft') { e.preventDefault(); show(i - 1, -1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); show(i + 1, 1); }
    });
    var x0 = null, y0 = null, swiped = false;
    vp.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      x0 = t.clientX;
      y0 = t.clientY;
    }, { passive: true });
    vp.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = y0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        swiped = true;
        show(i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
      }
    });
    vp.addEventListener('click', function (e) {
      if (swiped) { e.preventDefault(); e.stopPropagation(); swiped = false; }
    }, true);
    show(i, 0);
  });
})();`;

function renderMoment(m, back, showDate) {
  if (m.kind === 'activity') return renderActivityCard(m);

  const commentsHtml = renderComments(m, back);
  const likeBar = renderLikeBar(m, back);
  const img = safeMediaUrl(m.image_url);
  const audio = safeMediaUrl(m.audio_url);
  const time = formatDateTime(m.ts);
  return `<article class="moment post" id="m${m.id}">
    ${avatarHtml('assistant')}
    <div class="moment-main">
      <div class="moment-head"><span class="moment-name">${escapeHtml(nameOf('assistant'))}</span><span class="ts">${escapeHtml(showDate ? time : time.slice(11))}</span></div>
      <div class="content">${escapeHtml(m.content)}</div>
      ${img ? `<img class="moment-img" src="${img}" alt="动态配图" loading="lazy" />` : ''}
      ${audio ? renderVoice(audio) : ''}
      ${likeBar}
      ${commentsHtml}
      ${commentForm(m, back)}
    </div>
  </article>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --activity: #E6B652; --activity-ink: #8a5a14; --place: #9a6412; --voice: #f8d7e3; --voice-press: #f1c1d3; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 14px 0 24px; }
  .hero-sm { margin: 6px 0 8px; }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", "Source Han Serif SC", serif; font-size: 42px;
    font-weight: 700; letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  .title.title-sm { font-size: 28px; letter-spacing: 0.2em; padding-left: 0.2em; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .mood-line { margin: 12px auto 0; max-width: 90%; font-size: 13px; line-height: 1.5; color: var(--muted); word-break: break-word; }
  .mood-line .mood-label { color: var(--accent); margin-right: 4px; }
  /* 可以点的"TA此刻"：看起来还是那行字，末尾多一个小入口，点击区域撑到 44px 高 */
  .mood-link { display: inline-block; min-height: 44px; padding: 12px 10px; margin: -12px 0; color: inherit; text-decoration: none;
    border-radius: 12px; }
  .mood-link:active { background: rgba(122, 62, 93, 0.06); }
  .mood-num { font-family: Georgia, "Times New Roman", serif; font-size: 15px; color: var(--accent); }
  .mood-sep { color: var(--gold); }
  .mood-more { margin-left: 6px; color: var(--gold); font-size: 12px; white-space: nowrap; }
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
  .list-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin: 22px 4px 10px; }
  .list-title { font-size: 15px; color: var(--accent); margin: 0; letter-spacing: 0.1em; }
  .list-link, .back-link { display: inline-flex; align-items: center; min-height: 44px; font-size: 13px; color: var(--accent); }
  .back-link { font-size: 14px; }
  /* 头像：设置过就是图片，没设置是名字首字，TA 粉色、我黄色 */
  .avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;
    object-fit: cover; border-radius: 10px; color: #fff; font-weight: 600; line-height: 1; }
  .avatar-md { width: 44px; height: 44px; font-size: 18px; }
  .avatar-sm { width: 26px; height: 26px; border-radius: 7px; font-size: 12px; margin-top: 1px; }
  .avatar-lg { width: 72px; height: 72px; border-radius: 14px; font-size: 28px; }
  .avatar-ta { background: linear-gradient(135deg, #d77aa2, #b35a83); }
  .avatar-user { background: linear-gradient(135deg, #e0a646, #c0801f); }
  img.avatar { background: #f3e9ef; }
  .moment { background: var(--card); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  /* TA 发的动态：左边头像，右边名字、时间、正文，和朋友圈一样 */
  .moment.post { display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 12px; align-items: start; }
  .moment-main { min-width: 0; }
  .moment-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; margin-bottom: 4px; }
  .moment-name { font-size: 15px; font-weight: 600; color: var(--accent); }
  .moment .ts { color: var(--muted); font-size: 12px; }
  .moment .content { display: block; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .moment .moment-img { max-width: 100%; border-radius: 8px; margin-top: 10px; display: block; }
  /* 语音条：淡粉色气泡，左边小尖角，时长在气泡外面。没有 JavaScript 时只显示浏览器自带的播放器 */
  .voice { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .voice-bar, .voice-dur { display: none; }
  .js .voice-bar { display: inline-flex; }
  .js .voice-dur { display: inline; }
  .js .voice-audio { display: none; }
  .voice-audio { width: 100%; }
  .voice-bar { position: relative; align-items: center; max-width: calc(100% - 52px); min-height: 40px; margin-left: 6px;
    padding: 0 12px; border-radius: 6px; background: var(--voice); color: var(--accent); }
  .voice-bar::before { content: ''; position: absolute; left: -6px; top: 50%; margin-top: -6px; width: 0; height: 0;
    border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right: 6px solid var(--voice); }
  .voice-bar:active { background: var(--voice-press); }
  .voice-bar:active::before { border-right-color: var(--voice-press); }
  .voice-dur { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .voice-gone { display: inline-block; font-size: 13px; color: var(--muted); padding: 8px 12px; border-radius: 6px; background: #f3eef2; }
  .playing .w1 { animation: voice-w1 1.2s steps(1) infinite; }
  .playing .w2 { animation: voice-w2 1.2s steps(1) infinite; }
  @keyframes voice-w1 { 0% { opacity: 0; } 33% { opacity: 1; } }
  @keyframes voice-w2 { 0% { opacity: 0; } 66% { opacity: 1; } }
  /* 动作卡片：白底，边框还是原来那个暖黄。第一行是时间，第二行是做了什么 */
  .moment.activity { background: #fff; color: var(--ink); border: 1.5px solid var(--activity); padding: 12px 16px; }
  .moment.activity .content { font-size: 15px; line-height: 1.55; font-weight: 600; color: var(--ink); }
  .moment.activity .content::first-line { font-size: 12px; font-weight: 500; letter-spacing: 0.05em; color: var(--muted); }
  /* "在哪做的"：黄色加粗，下面垫一道浅黄荧光笔。纯黄字在白底上看不清，字用深一点的金黄 */
  .act-place { color: var(--place); font-weight: 800; padding: 0 1px; border-radius: 2px;
    background: linear-gradient(transparent 60%, rgba(230, 182, 82, 0.38) 60%); }
  .activity-detail > summary { cursor: pointer; list-style: none; }
  .activity-detail > summary::-webkit-details-marker { display: none; }
  .expand-hint { display: block; margin-top: 4px; font-size: 12px; font-weight: 500; color: var(--activity-ink); }
  .hint-arrow { display: inline-block; font-style: normal; transition: transform 0.2s ease; }
  .activity-detail > summary:hover .hint-arrow { transform: translateY(2px); }
  .activity-detail[open] .expand-hint { display: none; }
  .activity-detail .detail { margin-top: 10px; padding: 10px 12px; border-radius: 8px; background: #fdf6e6;
    color: var(--ink); font-size: 13px; line-height: 1.55; white-space: pre-wrap; word-break: break-word;
    max-height: 360px; overflow-y: auto; }
  .activity-detail[open] .detail { animation: detail-in 0.26s ease-out; transform-origin: top center; }
  @keyframes detail-in { from { opacity: 0; transform: translateY(-6px) scaleY(0.96); } to { opacity: 1; transform: none; } }
  /* 一摞动作卡片。没有 JavaScript 时一张张排开；有 JavaScript 时只露最上面一张，后面露出两层卡边 */
  .act-stack { margin-bottom: 12px; }
  .stack-row { display: flex; align-items: center; gap: 2px; }
  .stack-viewport { position: relative; flex: 1; min-width: 0; display: grid; gap: 10px; }
  .stack-viewport .moment.activity { margin-bottom: 0; }
  .stack-item[hidden] { display: none; }
  .stack-arrow, .stack-dots { display: none; }
  .act-stack.ready .stack-arrow { display: inline-flex; }
  .act-stack.ready .stack-dots { display: flex; }
  .act-stack.ready .stack-viewport { padding-bottom: 10px; }
  .act-stack.ready .stack-viewport::before, .act-stack.ready .stack-viewport::after { content: ''; position: absolute; height: 24px;
    border: 1.5px solid var(--activity); border-top: none; border-radius: 0 0 12px 12px; background: #fff; }
  .act-stack.ready .stack-viewport::before { left: 8px; right: 8px; bottom: 4px; z-index: 1; }
  .act-stack.ready .stack-viewport::after { left: 16px; right: 16px; bottom: -2px; z-index: 0; opacity: 0.6; }
  .act-stack.ready .stack-item { position: relative; z-index: 2; }
  .stack-arrow { flex-shrink: 0; align-items: center; justify-content: center; width: 36px; min-height: 44px; padding: 0;
    background: none; color: var(--activity-ink); font-size: 26px; line-height: 1; border-radius: 10px;
    transition: transform 0.15s ease, background-color 0.15s ease; }
  .stack-arrow:hover { background: rgba(230, 182, 82, 0.14); }
  .stack-arrow:active { transform: scale(0.86); }
  .stack-dots { justify-content: center; gap: 6px; margin-top: 8px; }
  .stack-dot { width: 6px; height: 6px; border-radius: 3px; background: #efdcae; transition: width 0.25s ease, background-color 0.25s ease; }
  .stack-dot.on { width: 16px; background: var(--activity); }
  .stack-item.in-next { animation: card-in-next 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
  .stack-item.in-prev { animation: card-in-prev 0.32s cubic-bezier(0.2, 0.8, 0.2, 1); }
  @keyframes card-in-next { from { opacity: 0; transform: translateX(32px) rotate(1.5deg) scale(0.97); } to { opacity: 1; transform: none; } }
  @keyframes card-in-prev { from { opacity: 0; transform: translateX(-32px) rotate(-1.5deg) scale(0.97); } to { opacity: 1; transform: none; } }
  @media (prefers-reduced-motion: reduce) {
    .playing .w1, .playing .w2 { animation: none; }
    .voice-bar.playing { background: var(--voice-press); }
    .stack-item.in-next, .stack-item.in-prev, .activity-detail[open] .detail { animation: none; }
    .stack-dot, .stack-arrow, .hint-arrow { transition: none; }
  }
  .like-bar { display: flex; align-items: center; gap: 4px; margin-top: 8px; }
  .like-btn { background: none; color: var(--accent); font-size: 22px; line-height: 1; min-width: 44px; min-height: 44px;
    padding: 0; margin-left: -10px; }
  .like-names { font-size: 13px; color: var(--muted); }
  .comments { margin-top: 8px; background: #f3eef2; border-radius: 8px; padding: 8px 10px; }
  .thread + .thread { border-top: 1px solid var(--line); margin-top: 4px; padding-top: 4px; }
  .comment { display: flex; align-items: flex-start; gap: 8px; font-size: 14px; line-height: 1.5; padding: 4px 0; }
  .comment-body { flex: 1; min-width: 0; }
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
  /* 头像和名字设置页 */
  .profile-row { display: flex; align-items: flex-start; gap: 16px; }
  .profile-fields { flex: 1; min-width: 0; display: grid; gap: 6px; }
  .profile-fields label { font-size: 13px; color: var(--muted); }
  .profile-fields input[type="file"] { border: none; padding: 4px 0; background: none; font-size: 14px; max-width: 100%; }
  .hint { margin: 10px 0 0; font-size: 12px; line-height: 1.5; color: var(--muted); }
  .profile-status { margin: 8px 0 0; min-height: 1.2em; font-size: 13px; color: var(--accent); }
  .profile-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  button.ghost { background: none; color: var(--accent); box-shadow: inset 0 0 0 1px var(--line); }
  a:focus-visible, button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
`;

// head 里那一小段给 html 加上 js 标记：有 JavaScript 才显示语音条，不然留着浏览器自带的播放器
function layout(title, body, script = '') {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script>document.documentElement.className += ' js';</script>
<style>${STYLE}</style>
</head>
<body><main>${body}</main>${script ? `<script>${script}</script>` : ''}</body>
</html>`;
}

function renderPage({ today, month, selected, anniversaries, marked, moments, back, mood, top }) {
  const listTitle = selected ? `${selected.m} 月 ${selected.d} 日的动态` : '最近的动态';
  const empty = selected ? '这一天还没有动态。' : '还没有动态。';
  const items = groupForDisplay(moments)
    .map((g) => (g.type === 'stack' ? renderStack(g.items) : renderMoment(g.m, back, !selected)))
    .join('');
  return layout(
    '晨暮星',
    `<header class="hero">
      <h1 class="title">晨暮星</h1>
      <p class="subtitle" lang="en">Vesper<span aria-hidden="true">✨</span><span class="sr-only"> </span>Phosphor</p>
      ${renderMoodLine(mood, top)}
    </header>
    ${renderAnniversaries(anniversaries, today, back)}
    ${renderCalendar({ y: month.y, m: month.m, today, selected, marked })}
    <section aria-labelledby="list-title">
      <div class="list-head">
        <h2 id="list-title" class="list-title">${listTitle}</h2>
        <a class="list-link" href="/moments/profile">头像和名字 ›</a>
      </div>
      ${items || `<p class="empty">${empty}</p>`}
    </section>`,
    VOICE_SCRIPT + STACK_SCRIPT
  );
}

// ---------- 头像和名字设置页 /moments/profile ----------

// 选了图片就在浏览器里裁成 256×256 的 JPEG，塞进隐藏的 avatar_data 一起提交，不用另外装上传组件
const AVATAR_SCRIPT = `(function () {
  var SIZE = 256;
  document.querySelectorAll('[data-avatar-form]').forEach(function (form) {
    var file = form.querySelector('[data-avatar-file]');
    var data = form.querySelector('[data-avatar-data]');
    var preview = form.querySelector('[data-avatar-preview]');
    var status = form.querySelector('[data-avatar-status]');
    if (!file || !data) return;
    file.addEventListener('change', function () {
      var f = file.files && file.files[0];
      data.value = '';
      if (!f) return;
      var url = URL.createObjectURL(f);
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(w, h);
        var c = document.createElement('canvas');
        c.width = SIZE;
        c.height = SIZE;
        var ctx = c.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.drawImage(img, (w - s) / 2, (h - s) / 2, s, s, 0, 0, SIZE, SIZE);
        data.value = c.toDataURL('image/jpeg', 0.86);
        URL.revokeObjectURL(url);
        if (preview) {
          preview.innerHTML = '';
          var el = new Image();
          el.className = 'avatar avatar-lg';
          el.alt = '';
          el.src = data.value;
          preview.appendChild(el);
        }
        if (status) status.textContent = '新头像选好了，点保存才会生效';
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        file.value = '';
        if (status) status.textContent = '这张图读不了，换一张试试';
      };
      img.src = url;
    });
  });
})();`;

function renderProfileCard(who, saved) {
  const p = getProfile(who);
  const label = who === 'user' ? '我' : 'TA';
  const id = `pf-${who}`;
  const fallback = escapeHtml(defaultName(who));
  return `<section class="card" aria-labelledby="${id}-title">
    <h2 id="${id}-title" class="section-title">${label}的头像和名字</h2>
    <form method="post" action="/moments/profile/${who}" data-avatar-form>
      <div class="profile-row">
        <span class="profile-preview" data-avatar-preview>${avatarHtml(who, 'lg')}</span>
        <div class="profile-fields">
          <label for="${id}-name">名字</label>
          <input id="${id}-name" name="name" maxlength="${MAX_NAME_CHARS}" value="${escapeHtml(p.customName)}" placeholder="${fallback}" autocomplete="off" />
          <label for="${id}-file">换头像</label>
          <input id="${id}-file" type="file" accept="image/*" data-avatar-file />
          <input type="hidden" name="avatar_data" data-avatar-data />
        </div>
      </div>
      <p class="hint">名字留空就用默认的「${fallback}」，最多 ${MAX_NAME_CHARS} 个字。头像会自动裁成正方形。</p>
      <p class="profile-status" role="status" data-avatar-status>${saved ? '已保存' : ''}</p>
      <div class="profile-actions">
        <button type="submit">保存</button>
        ${p.avatarUrl ? '<button type="submit" name="reset_avatar" value="1" class="ghost">恢复默认头像</button>' : ''}
      </div>
    </form>
  </section>`;
}

function renderProfilePage(saved) {
  return layout(
    '头像和名字 · 晨暮星',
    `<header class="hero hero-sm"><h1 class="title title-sm">头像和名字</h1></header>
    <p><a class="back-link" href="/moments">‹ 回动态</a></p>
    ${PROFILE_WHO.map((w) => renderProfileCard(w, saved === w)).join('')}`,
    AVATAR_SCRIPT
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
  // async：要等 Drivesoid 给出此刻最明显的三项。只读现成快照，不触发分类，Drivesoid 没开时立刻返回 null。
  app.get('/moments', requireBasicAuth, async (req, res) => {
    try {
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

      const top = await getTopDrives();

      res.send(
        renderPage({
          today,
          month,
          selected,
          anniversaries: listAnniversaries(),
          marked,
          moments,
          back,
          mood: currentMood(),
          top,
        })
      );
    } catch (err) {
      console.error('moments page: 渲染失败', err);
      res.status(500).send(errorPage('动态页出错了，看一下 vesper 的日志。', '/moments'));
    }
  });

  app.get('/moments/profile', requireBasicAuth, (req, res) => {
    const saved = PROFILE_WHO.includes(req.query.saved) ? req.query.saved : null;
    res.send(renderProfilePage(saved));
  });

  app.post('/moments/profile/:who', requireBasicAuth, (req, res) => {
    const back = '/moments/profile';
    if (!sameOrigin(req)) return res.status(403).send(errorPage('请求来源不对', back));
    const who = String(req.params.who);
    if (!PROFILE_WHO.includes(who)) return res.status(404).send(errorPage('没有这个人', back));
    const name = String(req.body?.name ?? '').replace(/\s+/g, ' ').trim();
    if (Array.from(name).length > MAX_NAME_CHARS) {
      return res.status(400).send(errorPage(`名字最多 ${MAX_NAME_CHARS} 个字`, back));
    }
    try {
      if (req.body?.reset_avatar) {
        resetProfileAvatar(who);
      } else if (req.body?.avatar_data) {
        const r = saveProfileAvatar(who, req.body.avatar_data);
        if (r.error) return res.status(400).send(errorPage(r.error, back));
      }
      saveProfileName(who, name);
    } catch (err) {
      console.error('moments profile: 保存失败', err);
      return res.status(500).send(errorPage('保存失败了，看一下 vesper 的日志。', back));
    }
    res.redirect(303, `/moments/profile?saved=${who}`);
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
