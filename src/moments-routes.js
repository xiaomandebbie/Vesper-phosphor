// 动态页面和留言接口。vesper.js 里挂载：registerMomentRoutes(app, { requireBasicAuth, requireApiKey })
import {
  listMoments,
  getMoment,
  listMomentComments,
  addMomentComment,
} from './state.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '我';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Shanghai';
const MAX_COMMENT_CHARS = 1000;

// 动态和留言都是模型 / 用户写的文字，拼进 HTML 前必须转义
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 只放行本项目自己生成的媒体路径
function safeMediaUrl(url) {
  return typeof url === 'string' && /^\/media\/(images|audio)\/[\w.-]+$/.test(url) ? url : null;
}

function formatTime(ms) {
  return new Date(ms).toLocaleString('zh-CN', { timeZone: TIME_ZONE, hour12: false });
}

function momentsWithComments(limit) {
  return listMoments(limit).map((m) => ({ ...m, comments: listMomentComments(m.id) }));
}

function createUserComment(momentId, content) {
  const text = String(content ?? '').trim();
  if (!text) return { error: '留言不能为空' };
  if (text.length > MAX_COMMENT_CHARS) return { error: `留言最多 ${MAX_COMMENT_CHARS} 字` };
  if (!Number.isInteger(momentId) || !getMoment(momentId)) return { error: '找不到这条动态' };
  return { id: addMomentComment({ momentId, author: 'user', content: text }) };
}

function renderComment(c) {
  const mine = c.author === 'user';
  return `<div class="comment ${mine ? 'mine' : 'theirs'}">
    <span class="who">${escapeHtml(mine ? USER_NAME : AI_NAME)}</span>
    <span class="text">${escapeHtml(c.content)}</span>
    <span class="when">${escapeHtml(formatTime(c.ts))}${mine && !c.handled ? ' · 还没看到' : ''}</span>
  </div>`;
}

function renderMoment(m) {
  const img = safeMediaUrl(m.image_url);
  const audio = safeMediaUrl(m.audio_url);
  const comments = m.comments.map(renderComment).join('');
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
}

const STYLE = `
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
`;

export function registerMomentRoutes(app, { requireBasicAuth, requireApiKey }) {
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

  // 网页
  app.post('/moments/:id/comments', requireBasicAuth, (req, res) => {
    const id = Number(req.params.id);
    const r = createUserComment(id, req.body?.content);
    if (r.error) return res.status(400).send(`${escapeHtml(r.error)}。<a href="/moments">返回</a>`);
    res.redirect(303, `/moments#m${id}`);
  });

  app.get('/moments', requireBasicAuth, (req, res) => {
    const items = momentsWithComments(50).map(renderMoment).join('');
    res.send(`<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>动态</title>
<style>${STYLE}</style>
</head>
<body>
  <h1>动态</h1>
  ${items || '<p class="empty">还没有动态。</p>'}
</body>
</html>`);
  });

  // 旧入口：日记已经换成动态
  app.get('/diary', (req, res) => res.redirect(301, '/moments'));
}
