import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  saveDeviceReport,
  getWakeState,
  updateWakeState,
  addPendingWake,
  getRecentWakeLog,
  addConversationMessage,
  getRecentConversation,
  listMoments,
  getMoment,
  listMomentComments,
  addMomentComment,
} from './state.js';

const app = express();
app.use(express.json());
// 动态页的留言表单是普通 form 提交
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.VESPER_PORT || 3001;
const API_KEY = process.env.REPORT_STATUS_API_KEY;
const BASIC_USER = process.env.VESPER_BASIC_USER;
const BASIC_PASS = process.env.VESPER_BASIC_PASS;
const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MEDIA_MAX_AGE_DAYS = Number(process.env.MEDIA_MAX_AGE_DAYS || 30);
const USER_NAME = process.env.USER_DISPLAY_NAME || '我';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Shanghai';
const MAX_COMMENT_CHARS = 1000;

fs.mkdirSync(path.join(MEDIA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'audio'), { recursive: true });

// 数据库里 decision / result 存的是模型返回的原始文本，
// 只要有一次不是干净 JSON，直接 JSON.parse 就会把整个路由打成 500。
// 统一包一层：坏的就当 null，不影响其它字段照常返回。
function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 动态和留言都是模型 / 用户写的文字，拼进 HTML 前必须转义
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 只放行本项目自己生成的媒体路径，防止异常数据拼出奇怪的 src
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio)\/[\w.-]+$/.test(url) ? url : null;
}

function formatTime(ms) {
  return new Date(ms).toLocaleString('zh-CN', { timeZone: TIME_ZONE, hour12: false });
}

function pruneOldMedia() {
  const cutoff = Date.now() - MEDIA_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  for (const sub of ['images', 'audio']) {
    const dir = path.join(MEDIA_DIR, sub);
    for (const file of fs.readdirSync(dir)) {
      const fp = path.join(dir, file);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) fs.unlinkSync(fp);
      } catch (err) {
        console.error('pruneOldMedia() failed for', fp, err.message);
      }
    }
  }
}
pruneOldMedia();
setInterval(pruneOldMedia, 24 * 60 * 60 * 1000);

// 给网页浏览的路由（/health、/moments、/media）加 Basic Auth。
function requireBasicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const auth = req.headers.authorization;
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const idx = decoded.indexOf(':');
      const user = decoded.slice(0, idx);
      const pass = decoded.slice(idx + 1);
      if (idx > 0 && user === BASIC_USER && pass === BASIC_PASS) return next();
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="vesper"');
  return res.status(401).send('需要登录');
}

// 给程序化访问（手机快捷指令、以后的前端）用的 x-api-key 校验，跟 /report-status 一套。
function requireApiKey(req, res, next) {
  if (API_KEY && req.headers['x-api-key'] !== API_KEY) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

app.use('/media', requireBasicAuth, express.static(MEDIA_DIR));

app.post('/report-status', requireApiKey, (req, res) => {
  const { battery, location, screen_time_min } = req.body;
  saveDeviceReport({
    ts: new Date().toISOString(),
    battery: battery ?? null,
    location: location ?? null,
    screen_time_min: screen_time_min ?? null,
  });
  res.json({ ok: true });
});

// ---- Wake control：给对话侧的"你"或者以后的前端（比如聊天客户端）伸手进来的地方 ----

app.get('/wake/state', requireApiKey, (req, res) => {
  const state = getWakeState();
  const [lastLog] = getRecentWakeLog(1);
  res.json({
    mode: state.mode,
    next_wake_at: state.next_wake_at,
    mood: state.mood,
    last_wake_at: lastLog?.fired_at ?? null,
    last_action: safeParse(lastLog?.decision)?.action ?? null,
    last_result: safeParse(lastLog?.result),
  });
});

app.get('/wake/log', requireApiKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  const rows = getRecentWakeLog(limit).map((r) => ({
    at: r.fired_at,
    kind: r.kind,
    mode: r.mode,
    gap_minutes: r.gap_minutes,
    decision: safeParse(r.decision),
    result: safeParse(r.result),
    error: r.error,
  }));
  res.json(rows);
});

app.post('/wake/mode', requireApiKey, (req, res) => {
  const { mode } = req.body;
  // 跟 agent 自己能调的 set_mode 不同：这里是人工/前端侧的开关，silent 也放行。
  if (!['normal', 'low-frequency', 'silent'].includes(mode)) {
    return res.status(400).json({ error: 'invalid mode' });
  }
  updateWakeState({ mode });
  res.json({ ok: true, mode });
});

app.post('/wake/self-wake', requireApiKey, (req, res) => {
  const { after_minutes, note } = req.body;
  if (!after_minutes || after_minutes <= 0) {
    return res.status(400).json({ error: 'after_minutes must be a positive number' });
  }
  const wakeAt = Date.now() + after_minutes * 60000;
  const id = addPendingWake(wakeAt, note ?? null);
  res.json({ ok: true, id, wake_at: wakeAt });
});

// 对话记录上报：把真实对话推进来，phosphor 才有真的密度和"最近聊了什么"可看。
app.post('/wake/conversation', requireApiKey, (req, res) => {
  const { speaker, content, messages } = req.body;
  if (Array.isArray(messages)) {
    for (const m of messages) {
      addConversationMessage(m.speaker, m.content);
    }
    return res.json({ ok: true, count: messages.length });
  }
  if (!content) return res.status(400).json({ error: 'content required' });
  addConversationMessage(speaker, content);
  res.json({ ok: true });
});

// 只读一眼最近上报进来的对话，方便自查方向对不对、内容有没有落上。
app.get('/wake/conversation', requireApiKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(getRecentConversation(limit));
});

// ---- 动态 ----

function momentsWithComments(limit) {
  return listMoments(limit).map((m) => ({ ...m, comments: listMomentComments(m.id) }));
}

// 留言：网页表单和程序化调用共用。返回错误文案或 null。
function createUserComment(momentId, content) {
  const text = String(content ?? '').trim();
  if (!text) return { error: '留言不能为空' };
  if (text.length > MAX_COMMENT_CHARS) return { error: `留言最多 ${MAX_COMMENT_CHARS} 字` };
  if (!getMoment(momentId)) return { error: '找不到这条动态' };
  const id = addMomentComment({ momentId, author: 'user', content: text });
  return { id };
}

// 程序化访问（快捷指令、以后的前端）
app.get('/wake/moments', requireApiKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  res.json(momentsWithComments(limit));
});

app.post('/wake/moments/:id/comments', requireApiKey, (req, res) => {
  const r = createUserComment(Number(req.params.id), req.body?.content);
  if (r.error) return res.status(400).json({ error: r.error });
  res.json({ ok: true, id: r.id });
});

// 网页：浏览动态、留言
app.post('/moments/:id/comments', requireBasicAuth, (req, res) => {
  const id = Number(req.params.id);
  const r = createUserComment(id, req.body?.content);
  if (r.error) return res.status(400).send(`${escapeHtml(r.error)}。<a href="/moments">返回</a>`);
  res.redirect(303, `/moments#m${id}`);
});

app.get('/moments', requireBasicAuth, (req, res) => {
  const moments = momentsWithComments(50);
  const items = moments
    .map((m) => {
      const img = safeMediaUrl(m.image_url);
      const audio = safeMediaUrl(m.audio_url);
      const comments = m.comments
        .map((c) => {
          const mine = c.author === 'user';
          return `<div class="comment ${mine ? 'mine' : 'theirs'}">
            <span class="who">${escapeHtml(mine ? USER_NAME : AI_NAME)}</span>
            <span class="text">${escapeHtml(c.content)}</span>
            <span class="when">${escapeHtml(formatTime(c.ts))}${mine && !c.handled ? ' · 还没看到' : ''}</span>
          </div>`;
        })
        .join('');
      return `<article class="moment" id="m${m.id}">
        <div class="ts">${escapeHtml(formatTime(m.ts))}</div>
        <div class="content">${escapeHtml(m.content)}</div>
        ${img ? `<img src="${img}" alt="配图" loading="lazy" />` : ''}
        ${audio ? `<audio controls preload="none" src="${audio}"></audio>` : ''}
        ${comments ? `<div class="comments">${comments}</div>` : ''}
        <form method="post" action="/moments/${m.id}/comments">
          <label class="sr-only" for="c${m.id}">给这条动态留言</label>
          <input id="c${m.id}" name="content" maxlength="${MAX_COMMENT_CHARS}" placeholder="留言…" required />
          <button type="submit">发送</button>
        </form>
      </article>`;
    })
    .join('');

  res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>动态</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 16px; background: #f7f7f7; color: #222; }
  h1 { font-size: 20px; }
  .moment { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .ts { color: #666; font-size: 12px; margin-bottom: 6px; }
  .content { font-size: 15px; line-height: 1.6; white-space: pre-wrap; }
  img { max-width: 100%; border-radius: 8px; margin-top: 10px; display: block; }
  audio { width: 100%; margin-top: 10px; }
  .comments { margin-top: 12px; background: #f3f3f3; border-radius: 8px; padding: 8px 10px; }
  .comment { font-size: 14px; line-height: 1.5; padding: 3px 0; }
  .who { font-weight: 600; margin-right: 4px; }
  .theirs .who { color: #7a3e4d; }
  .when { color: #666; font-size: 11px; margin-left: 6px; }
  form { display: flex; gap: 8px; margin-top: 10px; }
  input { flex: 1; padding: 8px 10px; border: 1px solid #ccc; border-radius: 8px; font-size: 14px; }
  button { padding: 8px 14px; border: none; border-radius: 8px; background: #7a3e4d; color: #fff; font-size: 14px; }
  button:focus-visible, input:focus-visible { outline: 2px solid #7a3e4d; outline-offset: 2px; }
  .empty { color: #666; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
</style>
</head>
<body>
  <h1>动态</h1>
  ${items || '<p class="empty">还没有动态。</p>'}
</body>
</html>`);
});

// 旧入口：日记已经换成动态
app.get('/diary', (req, res) => res.redirect(301, '/moments'));

app.get('/health', requireBasicAuth, (req, res) => res.json({ ok: true, service: 'vesper' }));

app.listen(PORT, () => console.log(`vesper listening on ${PORT}`));
