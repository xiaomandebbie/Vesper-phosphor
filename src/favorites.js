// 收藏：把 TA 发的某条动态收起来，以后在「我的收藏」里翻。
// 入口在日历卡片下面，每条动态的点赞旁边一颗星（那两处是脚本插的，见 flourish.js）。
//
// 自己一张表、自己一个文件，不动 state.js 和 moments-store.js —— 收藏是后加的东西，
// 坏了不应该把动态页拖下水。和 state.js 共用同一个数据库连接。
//
// 只收 TA 发的动态（kind='post'）。行为提示卡片没有点赞条，也不让收。
//
// 正文、图片、语音都保留。语音条是从动态页搬过来的一份（renderVoice 和 VOICE_SCRIPT
// 在 moments-page.js 里没导出，也不值得为了这个去改那个 50KB 的文件）。
// 两边要是不一致了，以这边为准重写一遍就行。

import fs from 'fs';
import path from 'path';
import db from './state.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { getProfile } from './moments-store.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
// 语音是 ElevenLabs 默认的 128kbps mp3，先按文件大小估时长；浏览器读到真实时长后再校正
const AUDIO_BYTES_PER_SEC = 128000 / 8;

db.exec(`
CREATE TABLE IF NOT EXISTS moment_favorites (
  moment_id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL
);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 收藏 / 取消。返回点完之后是不是收着的状态
export function toggleFavorite(momentId) {
  const removed = stmt('DELETE FROM moment_favorites WHERE moment_id = ?').run(momentId).changes;
  if (removed) return false;
  stmt('INSERT INTO moment_favorites (moment_id, ts) VALUES (?, ?)').run(momentId, Date.now());
  return true;
}

// 所有收藏的动态 id。动态被删了的不算，所以走 JOIN
export function listFavoriteIds() {
  return stmt(
    'SELECT f.moment_id AS id FROM moment_favorites f JOIN moments m ON m.id = f.moment_id ORDER BY f.ts DESC'
  )
    .all()
    .map((r) => r.id);
}

// 收藏的动态正文，按收起来的时间倒序
export function listFavoriteMoments() {
  return stmt(
    `SELECT m.*, f.ts AS fav_ts FROM moment_favorites f
     JOIN moments m ON m.id = f.moment_id
     ORDER BY f.ts DESC`
  ).all();
}

// 动态被删了，收藏里的那条也跟着清掉，不留死条目
export function pruneFavorites() {
  return stmt('DELETE FROM moment_favorites WHERE moment_id NOT IN (SELECT id FROM moments)').run().changes;
}

// ── 收藏页 ────────────────────────────────────────────────────────────
// 自己渲染一份简版列表，moments-page.js 里的 renderMoment 没导出，也不值得为了这个去改它。
// 颜色跟着早晚两张脸走（CHROME_CSS 里带着），:root 留一份当做没 JavaScript 时的底。

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 只放行自己存的那两个目录里的文件名，不让路径跑出去
function safeMediaUrl(url, kind) {
  const re = kind === 'audio' ? /^\/media\/audio\/[\w.-]+$/ : /^\/media\/images\/[\w.-]+$/;
  const v = String(url ?? '');
  return re.test(v) ? v : '';
}

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
// 1 秒 96px，60 秒及以上 240px，和动态页一样越长越宽
const voiceWidth = (s) => Math.round(Math.min(96 + Math.min(s, 60) * 2.4, 240));

function renderVoice(url) {
  const sec = audioSeconds(url);
  if (sec == null) return '<div class="voice"><span class="voice-gone">语音已过期</span></div>';
  return `<div class="voice">
      <button type="button" class="voice-bar" style="width:${voiceWidth(sec)}px" aria-pressed="false" aria-label="播放语音，约 ${sec} 秒">${VOICE_ICON}</button>
      <span class="voice-dur" aria-hidden="true">${formatSeconds(sec)}</span>
      <audio class="voice-audio" controls preload="metadata" src="${escapeHtml(url)}"></audio>
    </div>`;
}

// 点语音条播放 / 暂停，读到真实时长后校正宽度和秒数。同时只放一条
const VOICE_SCRIPT = `(function () {
  var current = null;
  function fmt(s) { return s < 60 ? s + '\u2033' : Math.floor(s / 60) + '\u2032' + (s % 60) + '\u2033'; }
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

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --bg1: #efe7f4; --bg2: #f9f0ee; --bg3: #fdf8f2;
    --t1: #463a7c; --t2: #9b4a7a; --t3: #c4832f;
    --voice: #f8d7e3; --voice-press: #f1c1d3; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%); }
  main { max-width: 600px; margin: 0 auto; padding: 28px 16px 48px; }
  .hero { text-align: center; margin: 10px 0 20px; }
  .title { margin: 0; font-size: 28px; font-weight: 700; letter-spacing: 0.2em; padding-left: 0.2em; color: #5b2e52; }
  .subtitle { margin: 6px 0 0; font-size: 13px; letter-spacing: 0.16em; color: var(--muted); }
  .back-link { display: inline-flex; align-items: center; gap: 4px; min-height: 44px;
    color: var(--accent); text-decoration: none; font-size: 14px; }
  .moment { background: var(--card); border-radius: 12px; padding: 14px 16px; margin-bottom: 12px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08);
    display: grid; grid-template-columns: 44px minmax(0, 1fr); column-gap: 12px; align-items: start; }
  .avatar { display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; overflow: hidden;
    width: 44px; height: 44px; font-size: 18px; object-fit: cover; border-radius: 10px;
    color: #fff; font-weight: 600; line-height: 1;
    background: linear-gradient(135deg, #d77aa2, #b35a83); }
  img.avatar { background: #f3e9ef; }
  .moment-main { min-width: 0; }
  .moment-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 2px 8px; margin-bottom: 4px; }
  .moment-name { font-size: 15px; font-weight: 600; color: var(--accent); }
  .ts { color: var(--muted); font-size: 12px; }
  .content { display: block; font-size: 15px; line-height: 1.6; white-space: pre-wrap; word-break: break-word; }
  .moment-img { max-width: 100%; border-radius: 8px; margin-top: 10px; display: block; }

  /* 语音条：和动态页一样的淡粉色气泡，左边小尖角，时长在气泡外面。
     没有 JavaScript 时只显示浏览器自带的播放器 */
  .voice { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .voice-bar, .voice-dur { display: none; }
  .js .voice-bar { display: inline-flex; }
  .js .voice-dur { display: inline; }
  .js .voice-audio { display: none; }
  .voice-audio { width: 100%; }
  .voice-bar { position: relative; align-items: center; max-width: calc(100% - 52px); min-height: 40px; margin-left: 6px;
    padding: 0 12px; border-radius: 6px; background: var(--voice); color: var(--accent); border: 0; cursor: pointer; }
  .voice-bar::before { content: ''; position: absolute; left: -6px; top: 50%; margin-top: -6px; width: 0; height: 0;
    border-top: 6px solid transparent; border-bottom: 6px solid transparent; border-right: 6px solid var(--voice); }
  .voice-bar:active { background: var(--voice-press); }
  .voice-bar:active::before { border-right-color: var(--voice-press); }
  .voice-dur { font-size: 13px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .voice-gone { display: inline-block; font-size: 13px; color: var(--muted); padding: 8px 12px; border-radius: 6px;
    background: var(--card-soft, #f3eef2); }
  .voice-bar.playing { background: var(--voice-press); }
  .playing .w1 { animation: voice-w1 1.2s steps(1) infinite; }
  .playing .w2 { animation: voice-w2 1.2s steps(1) infinite; }
  @keyframes voice-w1 { 0% { opacity: 0; } 33% { opacity: 1; } }
  @keyframes voice-w2 { 0% { opacity: 0; } 66% { opacity: 1; } }

  .fav-when { margin-top: 8px; font-size: 11.5px; color: var(--muted); font-style: italic; }
  .unfav { background: none; border: 0; padding: 0; margin-top: 6px; min-height: 44px;
    color: var(--gold); font-size: 13px; cursor: pointer; }
  .empty { color: var(--muted); font-size: 14px; margin: 24px 4px; line-height: 1.7; text-align: center; }
  .empty b { color: var(--gold); font-weight: 400; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

  /* 深底时语音条的文字要跟着浅下来，不然淡粉气泡上的深玕红图标认不出来 */
  html[data-dark] .voice-bar { color: #7a3e5d; }
  html[data-dark] .unfav { color: var(--fav, var(--gold)); }
`;

function renderFavMoment(m, taName, taAvatar) {
  const avatar = taAvatar
    ? `<img class="avatar" src="${escapeHtml(taAvatar)}" alt="" />`
    : `<span class="avatar" aria-hidden="true">${escapeHtml(Array.from(taName)[0] || 'T')}</span>`;
  const imgUrl = safeMediaUrl(m.image_url, 'image');
  const img = imgUrl ? `<img class="moment-img" src="${escapeHtml(imgUrl)}" alt="" loading="lazy" />` : '';
  const audioUrl = safeMediaUrl(m.audio_url, 'audio');
  const voice = audioUrl ? renderVoice(audioUrl) : '';
  return `<article class="moment" id="m${m.id}">
    ${avatar}
    <div class="moment-main">
      <div class="moment-head">
        <span class="moment-name">${escapeHtml(taName)}</span>
        <span class="ts">${escapeHtml(formatDateTime(m.ts))}</span>
      </div>
      <span class="content">${escapeHtml(m.content)}</span>
      ${img}
      ${voice}
      <div class="fav-when">收于 ${escapeHtml(formatDateTime(m.fav_ts))}</div>
      <form method="post" action="/moments/${m.id}/favorite">
        <input type="hidden" name="from" value="page" />
        <button type="submit" class="unfav">★ 从收藏里拿出来</button>
      </form>
    </div>
  </article>`;
}

function renderFavoritesPage() {
  pruneFavorites();
  const rows = listFavoriteMoments();
  const ta = getProfile('assistant');
  const list = rows.length
    ? rows.map((m) => renderFavMoment(m, ta.name, ta.avatarUrl)).join('')
    : `<p class="empty">还没收过东西。<br>在动态下面点那颗 <b>☆</b>，就收到这里。</p>`;
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>我的收藏 · 晨暮星</title>
<script>document.documentElement.className += ' js';${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu('/moments')}
  <header class="hero">
    <h1 class="title title-sm">我的收藏</h1>
    <p class="subtitle">${rows.length ? `${rows.length} 条` : 'Collected'}</p>
  </header>
  <a class="back-link" href="/moments">‹ 回到动态</a>
  ${list}
</main><script>${VOICE_SCRIPT}${CHROME_SCRIPT}</script></body>
</html>`;
}

// ── 路由 ─────────────────────────────────────────────────────────────
// 挂在 moments 路由之前：/moments/favorites 要比 /moments/:id 先匹配到，不然会被当成 id。

export function registerFavoriteRoutes(app, { requireBasicAuth }) {
  // 哪些收起来了。页面是服务端渲染的，HTML 里没这个信息，所以脚本开场拉一次
  app.get('/moments/favorites.json', requireBasicAuth, (req, res) => {
    try {
      const ids = listFavoriteIds();
      res.json({ ok: true, count: ids.length, ids });
    } catch (err) {
      console.error('favorites: 读取失败', err);
      res.status(500).json({ ok: false });
    }
  });

  app.get('/moments/favorites', requireBasicAuth, (req, res) => {
    try {
      res.send(renderFavoritesPage());
    } catch (err) {
      console.error('favorites: 渲染失败', err);
      res.status(500).send('收藏页出错了，看一下 vesper 的日志。');
    }
  });

  // 收藏 / 取消。脚本调用时返回 JSON；收藏页上那个按钮是表单提交，返回重定向
  app.post('/moments/:id/favorite', requireBasicAuth, (req, res) => {
    const fromPage = req.body?.from === 'page';
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return fromPage ? res.redirect(303, '/moments/favorites') : res.status(400).json({ ok: false });
    }
    try {
      // 只收 TA 发的动态
      const row = db.prepare("SELECT id FROM moments WHERE id = ? AND kind = 'post'").get(id);
      if (!row) {
        return fromPage ? res.redirect(303, '/moments/favorites') : res.status(404).json({ ok: false });
      }
      const on = toggleFavorite(id);
      if (fromPage) return res.redirect(303, '/moments/favorites');
      res.json({ ok: true, on });
    } catch (err) {
      console.error('favorites: 保存失败', err);
      if (fromPage) return res.redirect(303, '/moments/favorites');
      res.status(500).json({ ok: false });
    }
  });
}
