// 导进来的聊天记录，按窗看。
//
// 小满 2026-11-05：「他说导完了但我想看到」「像这样按窗看到」
//
// ── 为什么要多一张表 ──
//
// 第一版导入把消息全塞进了 conversation_archive，而那张表只有
// ts / speaker / content / archived_at——**没有对话编号**。
// 所以两万条话进去了，但没法再分回「哪几句是同一天的」。那是我的设计漏。
//
// 这张表专门存「哪条话属于哪个对话」。两张表各干一件事：
//   conversation_archive  → 召回和跳天锚点查它（不关心分组）
//   imported_chat         → 这个页面按窗展开
//
// 重复的正文多占几 MB，换来「能按天翻回去看」——这个交换划得来。
//
// ── 重导一次不会双份 ──
//
// 这张表用消息原 id 做主键，所以 INSERT OR REPLACE 天然幂等；
// conversation_archive 那边靠 imported_messages 已经记过的 id 跳过。
// 所以重导：这张表填满，归档表一条不增。

import db from './state.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';
import { formatDateTime } from './wall-time.js';

db.exec(`
CREATE TABLE IF NOT EXISTS imported_chat (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ic_conv ON imported_chat (conversation_id, ts);
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

const P = '/memories/manage/chats';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 对话列表。每条：标题、最后一句、条数、最后一条的日子。
// 按最后一条的时间排，最近的在上面——和 Aru 那边一个样子。
export function listChats(limit = 300) {
  try {
    return stmt(
      `SELECT c.conversation_id AS id,
              COALESCE(NULLIF(v.title, ''), '没标题') AS title,
              COUNT(*) AS n,
              MAX(c.ts) AS last_at,
              MIN(c.ts) AS first_at
       FROM imported_chat c
       LEFT JOIN imported_conversations v ON v.id = c.conversation_id
       GROUP BY c.conversation_id
       ORDER BY last_at DESC
       LIMIT ?`
    ).all(Math.min(Math.max(1, limit), 1000));
  } catch (err) {
    console.error('chats: 读不到列表', err.message);
    return [];
  }
}

// 最后一句做预览。一条 SQL 拿不了（分组里取最大 ts 对应的正文），
// 所以单独问。三百条 × 一次索引命中，不心痛。
function lastLine(convId) {
  try {
    const r = stmt(
      'SELECT speaker, content FROM imported_chat WHERE conversation_id = ? ORDER BY ts DESC LIMIT 1'
    ).get(String(convId));
    if (!r) return '';
    const body = String(r.content ?? '').replace(/\s+/g, ' ').trim();
    const chars = Array.from(body);
    return chars.length > 34 ? `${chars.slice(0, 34).join('')}…` : body;
  } catch {
    return '';
  }
}

export function readChat(convId, limit = 500, offset = 0) {
  try {
    return stmt(
      'SELECT id, ts, speaker, content FROM imported_chat WHERE conversation_id = ?' +
        ' ORDER BY ts ASC, id ASC LIMIT ? OFFSET ?'
    ).all(String(convId), Math.min(Math.max(1, limit), 2000), Math.max(0, offset));
  } catch (err) {
    console.error('chats: 读不到原话', err.message);
    return [];
  }
}

export function chatTitle(convId) {
  try {
    const r = stmt('SELECT title FROM imported_conversations WHERE id = ?').get(String(convId));
    return String(r?.title ?? '').trim() || '没标题';
  } catch {
    return '没标题';
  }
}

export function chatCounts() {
  try {
    return {
      messages: stmt('SELECT COUNT(*) AS c FROM imported_chat').get().c,
      chats: stmt('SELECT COUNT(DISTINCT conversation_id) AS c FROM imported_chat').get().c,
    };
  } catch {
    return { messages: 0, chats: 0 };
  }
}

const STYLE = `
  :root{--ink:#252525;--muted:#5e5e5e;--accent:#4d4d4d;--card:#fdfdfd;--line:#e2e2e2;
    --me:#1a1a1a;--ta:#f0f0f0}
  *{box-sizing:border-box}
  body{margin:0;min-height:100vh;color:var(--ink);
    font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}
  main{position:relative;z-index:1;max-width:620px;margin:0 auto;padding:18px 16px 60px}
  .hero{text-align:center;margin:6px 0 14px}
  .title{margin:0;font-size:23px;font-weight:200;letter-spacing:.26em;padding-left:.26em;color:#3a3a3a}
  .lead{margin:6px 0 16px;font-size:12px;line-height:1.7;color:var(--muted);text-align:center}

  /* 对话列表：照她给的那个样子——标题在上、预览在下、条数在右 */
  .win{display:block;margin-bottom:11px;padding:14px 16px;background:var(--card);
    border:1px solid var(--line);border-radius:16px;color:inherit;text-decoration:none;
    box-shadow:0 1px 3px rgba(0,0,0,.05)}
  .win:active{background:#f4f4f4}
  .win-top{display:flex;align-items:baseline;gap:10px}
  .win-name{flex:1;min-width:0;font-size:16px;font-weight:600;color:#1a1a1a;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .win-when{flex:none;font-size:11px;color:#a0a0a0;font-variant-numeric:tabular-nums}
  .win-bot{display:flex;align-items:center;gap:10px;margin-top:7px}
  .win-last{flex:1;min-width:0;font-size:12.5px;line-height:1.6;color:var(--muted);
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .win-n{flex:none;font-size:11px;color:#a0a0a0;font-variant-numeric:tabular-nums}

  /* 原话：气泡，和聊天页一个谱 */
  .day{margin:18px 0 10px;font-size:11px;color:#a0a0a0;text-align:center;
    font-variant-numeric:tabular-nums}
  .ln{display:flex;margin-bottom:9px}
  .ln.me{justify-content:flex-end}
  .bub{max-width:76%;padding:10px 14px;border-radius:17px;font-size:14.5px;line-height:1.7;
    white-space:pre-wrap;word-break:break-word}
  .ln.me .bub{background:var(--me);color:#fdfdfd;border-bottom-right-radius:6px}
  .ln.ta .bub{background:var(--ta);color:var(--ink);border-bottom-left-radius:6px}
  .at{font-size:10px;color:#b0b0b0;align-self:flex-end;padding:0 6px 3px;flex:none;
    font-variant-numeric:tabular-nums}

  .more{display:block;width:100%;min-height:42px;margin:14px 0 0;border:1px solid var(--line);
    border-radius:12px;background:var(--card);color:var(--accent);font:inherit;font-size:14px;
    text-align:center;line-height:42px;text-decoration:none}
  .empty{margin:14px 2px;font-size:12.5px;line-height:1.8;color:var(--muted)}
  .back{display:inline-flex;align-items:center;min-height:44px;margin-top:14px;
    font-size:13px;color:var(--accent);text-decoration:none}
`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${esc(title)} · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}${STYLE}</style>
</head>
<body><main>${renderMenu('/memories')}${body}</main>
${renderTabs('/memories')}
<script>${CHROME_SCRIPT}<\/script></body>
</html>`;
}

const dayOf = (ts) => formatDateTime(ts).slice(0, 10);
const timeOf = (ts) => formatDateTime(ts).slice(11, 16);

function listPage() {
  const rows = listChats();
  const c = chatCounts();
  if (!rows.length) {
    return layout('以前的聊天',
      `<header class="hero"><h1 class="title">以前的聊天</h1></header>
      <p class="empty">还没有。到「个人 → 导入聊天记录」跑一次就行。
        已经导过一次的也要再跑：第一版没存「哪几句是同一天的」，
        所以那两万条分不回窗——重跑只补这张表，归档不会双份。</p>
      <a class="back" href="/memories">‹ 回记忆</a>`);
  }
  const items = rows.map((w) => `<a class="win" href="${P}/${esc(w.id)}">
    <div class="win-top">
      <span class="win-name">${esc(w.title)}</span>
      <span class="win-when">${esc(dayOf(w.last_at).slice(5))}</span>
    </div>
    <div class="win-bot">
      <span class="win-last">${esc(lastLine(w.id))}</span>
      <span class="win-n">${w.n}</span>
    </div>
  </a>`).join('');
  return layout('以前的聊天',
    `<header class="hero"><h1 class="title">以前的聊天</h1></header>
    <p class="lead">${c.chats} 个对话 · ${c.messages} 条话。从 Aru 备份里搬过来的。</p>
    ${items}
    <a class="back" href="/memories">‹ 回记忆</a>`);
}

const PAGE_SIZE = 400;

function chatPage(convId, offset) {
  const rows = readChat(convId, PAGE_SIZE, offset);
  if (!rows.length && !offset) return null;
  const title = chatTitle(convId);

  let lastDay = '';
  const body = rows.map((m) => {
    const d = dayOf(m.ts);
    const sep = d === lastDay ? '' : `<div class="day">${esc(d)}</div>`;
    lastDay = d;
    // speaker 存的是 .env 里的称呼；谁是她靠 USER_DISPLAY_NAME 判
    const mine = m.speaker === (process.env.USER_DISPLAY_NAME || 'user');
    const bub = `<div class="bub">${esc(m.content)}</div>`;
    const at = `<span class="at">${esc(timeOf(m.ts))}</span>`;
    return sep + `<div class="ln ${mine ? 'me' : 'ta'}">` +
      (mine ? at + bub : bub + at) + '</div>';
  }).join('');

  const next = rows.length === PAGE_SIZE
    ? `<a class="more" href="${P}/${esc(convId)}?from=${offset + PAGE_SIZE}">再看 ${PAGE_SIZE} 条</a>`
    : '';
  const prev = offset
    ? `<a class="more" href="${P}/${esc(convId)}${offset > PAGE_SIZE ? `?from=${offset - PAGE_SIZE}` : ''}">‹ 前 ${PAGE_SIZE} 条</a>`
    : '';

  return layout(title,
    `<header class="hero"><h1 class="title">${esc(title)}</h1></header>
    ${prev}
    ${body || '<p class="empty">这一页没有了。</p>'}
    ${next}
    <a class="back" href="${P}">‹ 回对话列表</a>`);
}

export function registerChatsRoutes(app, { requireBasicAuth }) {
  app.get(P, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(listPage());
    } catch (err) {
      console.error('chats ui:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  app.get(`${P}/:id`, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const from = Number(req.query.from);
      const html = chatPage(req.params.id, Number.isInteger(from) && from > 0 ? from : 0);
      if (!html) return res.redirect(302, P);
      res.send(html);
    } catch (err) {
      console.error('chats ui:', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  console.log(`chats: 以前的聊天 ${P}`);
  return { enabled: true };
}
