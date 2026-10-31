// 动态页 /moments：标题、此刻心情、唤醒时间、动态流、留言、回复、点赞；自定义页 /moments/profile。
// vesper.js 里挂载：registerMomentRoutes(app, { requireBasicAuth, requireApiKey })
// 页面是服务端渲染，没有 JavaScript 也能看、能留言。JavaScript 只做锦上添花的事：
//   语音条点击播放（没有 JS 时退回浏览器自带的播放器）；
//   自定义页上传头像前在浏览器里裁成正方形；
//   右上角菜单、换页时的星星转场（见 page-chrome.js）。
//
// 这页只放「有人发的」动态（2026-10-31）：两个人都能发——TA 自己醒来发的
// （author='assistant'），和你在这一页写的（author='user'）。
// 行动卡（kind='activity'，逛论坛、听歌、翻记忆那些）不在这儿，它们在聊天窗。
// 过滤走 moments-posts.js 的 listPosts，在 SQL 里就滤掉了：行动卡比动态多得多，
// 要是拿整份再挑，LIMIT 那点配额全花在它们身上了。
//
// 日历和按天标题也拿掉了：翻日期在发现页和个人页都有入口，每条动态自己带了
// 完整日期时间，这页就只是一条往下看的流。
// 顺带一个连带效果：收藏和星星罐那两个入口是 flourish.js / star-entry.js
// 按 .cal-card 做锚点异步插进来的，日历没了它们自己就不插了（两边都写了
// 「拉不到就不插」），所以那两个文件一行都不用改。每条动态上的收藏星还在。
//
// 你发的那几条左边一道暗金，下面挂着「改一改 / 删了」，发、改、删都在 my-moments.js 里。
import fs from 'fs';
import path from 'path';
import { getMoment, listMoments, listMomentComments, addMomentComment, getWakeState } from './state.js';
import {
  listAnniversaries,
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
import { listPosts } from './moments-posts.js';
import { formatDateTime } from './wall-time.js';
import { getTopDrives } from './drives.js';
import { getWakeTimes } from './wake-info.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import {
  renderComposeBox,
  renderPostTools,
  MY_MOMENTS_CSS,
  registerMyMomentRoutes,
} from './my-moments.js';
import { renderCommentTools, MY_COMMENTS_CSS, registerMyCommentRoutes } from './my-comments.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MAX_COMMENT_CHARS = 1000;
const MAX_MOOD_CHARS = 60;
const MAX_NAME_CHARS = 20;
const RECENT_LIMIT = 20;
// 语音是 ElevenLabs 默认的 128kbps mp3，先按文件大小估时长；浏览器读到真实时长后再校正
const AUDIO_BYTES_PER_SEC = 128000 / 8;

// 动态、留言、名字都是模型 / 用户写的文字，拼进 HTML 前必须转义
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 显示用的名字：自定义页填过就用填的，没填用 .env 的称呼
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
    const chars = Array.from(s);
    return chars.length > MAX_MOOD_CHARS ? `${chars.slice(0, MAX_MOOD_CHARS).join('')}…` : s;
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

// 唤醒时间怎么写：今天的只写 HH:mm，别的天写 MM-DD HH:mm
function whenLabel(ms, now) {
  const t = formatDateTime(ms);
  return t.slice(0, 10) === formatDateTime(now).slice(0, 10) ? t.slice(11) : t.slice(5);
}

// "TA此刻"下面那一行：上次唤醒、下次唤醒、自主唤醒（TA 自己约的精确唤醒里最早的那次）。
// 只读库，不调模型。读不到就整行不显示，不影响页面其他部分
function renderWakeLine() {
  let w;
  try {
    w = getWakeTimes();
  } catch (err) {
    console.error('moments page: 读唤醒时间失败', err.message);
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
    .map(
      ([k, v, title]) =>
        `<span class="wake-item"${title ? ` title="${escapeHtml(title)}"` : ''}><span class="wake-k">${k}</span> ${escapeHtml(v)}</span>`
    )
    .join('<span class="wake-sep" aria-hidden="true">·</span>')}</p>`;
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
        ${mine ? renderCommentTools(c, back) : ''}
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

// 一条动态。author 决定头像、名字和边上那道色：TA 发的是粉色，你发的是暗金。
// 你发的那几条下面挂着「改一改 / 删了」，TA 还没醒来看过时标一句"还没看到"（和留言一个做法）。
// 时间写全（2026-10-31）：日历和按天标题去掉之后，这里是唯一能看出哪天的地方
function renderMoment(m, back) {
  const mine = m.author === 'user';
  const who = mine ? 'user' : 'assistant';
  const commentsHtml = renderComments(m, back);
  const likeBar = renderLikeBar(m, back);
  const img = safeMediaUrl(m.image_url);
  const audio = safeMediaUrl(m.audio_url);
  const unseen = mine && !m.seen_by_ta ? '<span class="post-unseen">还没看到</span>' : '';
  return `<article class="moment post${mine ? ' mine' : ''}" id="m${m.id}">
    ${avatarHtml(who)}
    <div class="moment-main">
      <div class="moment-head"><span class="moment-name">${escapeHtml(nameOf(who))}</span><span class="ts">${escapeHtml(formatDateTime(m.ts))}</span>${unseen}</div>
      <div class="content">${escapeHtml(m.content)}</div>
      ${img ? `<img class="moment-img" src="${img}" alt="动态配图" loading="lazy" />` : ''}
      ${audio ? renderVoice(audio) : ''}
      ${likeBar}
      ${mine ? renderPostTools(m, back) : ''}
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
  .hero-sm { margin: 10px 0 18px; }
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
  /* "TA此刻"下面的唤醒时间：比心情那行小一号，白底黄框、斜体。纯黄字在白底上看不清，字用深一点的金黄 */
  .wake-line { display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 6px; width: fit-content; max-width: 92%;
    margin: 12px auto 0; padding: 3px 12px; font-size: 12px; line-height: 1.6; font-style: italic; color: var(--place);
    background: #fff; border: 1px solid var(--activity); border-radius: 999px; }
  .wake-k { font-weight: 600; }
  .wake-sep { color: var(--activity); }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .section-title { font-size: 15px; margin: 0 0 10px; color: var(--accent); letter-spacing: 0.1em; }
  input { padding: 9px 10px; border: 1px solid #cbbfc9; border-radius: 10px; font-size: 16px; background: #fff; color: var(--ink); }
  button { padding: 9px 14px; border: none; border-radius: 10px; background: var(--accent); color: #fff; font-size: 15px; }
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
  /* 有人发的动态：左边头像，右边名字、时间、正文，和朋友圈一样 */
  .moment.post { display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 12px; align-items: start; }
  .moment-main { min-width: 0; }
  .moment-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; margin-bottom: 4px; }
  .moment-name { font-size: 15px; font-weight: 600; color: var(--accent); }
  .moment .ts { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  /* 你发的、TA 还没醒来看过的，标一句。和留言那个"还没看到"一个意思 */
  .post-unseen { font-size: 11px; color: var(--muted); }
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
  @media (prefers-reduced-motion: reduce) {
    .playing .w1, .playing .w2 { animation: none; }
    .voice-bar.playing { background: var(--voice-press); }
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
  .empty { color: var(--muted); font-size: 14px; margin: 0 4px; }
  /* 自定义页 */
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

// head 里那一小段给 html 加上 js 标记：有 JavaScript 才显示语音条，不然留着浏览器自带的播放器。
// 菜单和星星转场每个页面都有（见 page-chrome.js），current 是菜单里高亮哪一项。
// MY_MOMENTS_CSS 是你发动态那几处的样式（见 my-moments.js），
// MY_COMMENTS_CSS 是留言那个「删」的样式（见 my-comments.js）
function layout(title, body, script = '', current = '/moments') {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script>document.documentElement.className += ' js';${HEAD_SCRIPT}</script>
<style>${STYLE}${MY_MOMENTS_CSS}${MY_COMMENTS_CSS}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu(current)}${body}</main><script>${script}${CHROME_SCRIPT}</script></body>
</html>`;
}

// 一条往下看的流，不按天分段。每条动态自己带了完整日期时间
function renderPage({ moments, back, mood, top }) {
  const list = moments.length
    ? moments.map((m) => renderMoment(m, back)).join('')
    : '<p class="empty">还没有动态。</p>';
  return layout(
    '晨暮星',
    `<header class="hero">
      <h1 class="title">晨暮星</h1>
      <p class="subtitle" lang="en">Vesper<span aria-hidden="true">✨</span><span class="sr-only"> </span>Phosphor</p>
      ${renderMoodLine(mood, top)}
      ${renderWakeLine()}
    </header>
    ${renderComposeBox(back)}
    ${list}`,
    VOICE_SCRIPT
  );
}

// ---------- 自定义页 /moments/profile ----------

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
    '自定义 · 晨暮星',
    `<header class="hero hero-sm"><h1 class="title title-sm">自定义</h1></header>
    ${PROFILE_WHO.map((w) => renderProfileCard(w, saved === w)).join('')}`,
    AVATAR_SCRIPT,
    '/moments/profile'
  );
}

function errorPage(message, back) {
  return layout('出错了', `<div class="card"><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(back)}">返回</a></p></div>`, '', '');
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
  // 你发动态的那几个路由（发、改、删），见 my-moments.js。
  // 挂在最前面：/moments/mine 要比下面的 /moments/:id/* 先匹配到
  registerMyMomentRoutes(app, { requireBasicAuth });
  // 删我自己留的那条留言，见 my-comments.js。
  // /moments/comments/:id/delete 是四段，和下面 /moments/:id/comments 不会撞上
  registerMyCommentRoutes(app, { requireBasicAuth });

  // ---- 程序化访问（快捷指令、以后的前端）----
  // 这条还是给全部（含行动卡）：聊天页和快捷指令要用到行动卡，
  // 只是动态网页不再显示它们
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

  // 纪念日先从页面上拿掉了，数据还在库里，这个接口照样能读
  app.get('/wake/anniversaries', requireApiKey, (req, res) => res.json(listAnniversaries()));

  // ---- 网页 ----
  // async：要等 Drivesoid 给出此刻最明显的三项。只读现成快照，不触发分类，Drivesoid 没开时立刻返回 null。
  app.get('/moments', requireBasicAuth, async (req, res) => {
    try {
      // listPosts，不是 listMoments：行动卡在聊天窗，不在这儿
      const moments = listPosts(RECENT_LIMIT);
      const top = await getTopDrives();

      res.send(
        renderPage({
          moments,
          back: '/moments',
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
