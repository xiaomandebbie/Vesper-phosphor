import 'dotenv/config';
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
  saveDeviceReport,
  listDiary,
  getWakeState,
  updateWakeState,
  addPendingWake,
  getRecentWakeLog,
  addConversationMessage,
  getRecentConversation,
} from './state.js';

const app = express();
app.use(express.json());

const PORT = process.env.VESPER_PORT || 3001;
const API_KEY = process.env.REPORT_STATUS_API_KEY;
const BASIC_USER = process.env.VESPER_BASIC_USER;
const BASIC_PASS = process.env.VESPER_BASIC_PASS;
const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MEDIA_MAX_AGE_DAYS = Number(process.env.MEDIA_MAX_AGE_DAYS || 30);

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

// 给网页浏览的路由（/health、/diary、/media）加 Basic Auth。
function requireBasicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const auth = req.headers.authorization;
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic') {
      const [user, pass] = Buffer.from(encoded, 'base64').toString().split(':');
      if (user === BASIC_USER && pass === BASIC_PASS) return next();
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

// ---- Wake control：给对话侧的"你"或者以后的前端（比如 aru）伸手进来的地方 ----
// 之前 set_mode 只有唤醒时的 agent 自己能调，对话窗口里够不着；这几个端点补上这个缺口。

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

// 对话记录上报：把真实对话推进来，phosphor 才有真的密度和"最近聊了什么"可看，
// 不然 decide.js 里那些字段永远是空的。谁来推、怎么推，看你们对话前端（比如 aru）怎么接。
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

app.get('/diary', requireBasicAuth, (req, res) => {
  const entries = listDiary(50);
  const html = `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>日记</title>
<style>
  body { font-family: -apple-system, sans-serif; max-width: 600px; margin: 0 auto; padding: 16px; background: #f7f7f7; }
  .entry { background: #fff; border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); }
  .ts { color: #888; font-size: 12px; margin-bottom: 6px; }
  .content { font-size: 15px; line-height: 1.5; white-space: pre-wrap; }
  img { max-width: 100%; border-radius: 8px; margin-top: 8px; }
  audio { width: 100%; margin-top: 8px; }
</style>
</head>
<body>
  <h2>日记</h2>
  ${entries
    .map(
      (e) => `
    <div class="entry">
      <div class="ts">${e.ts}</div>
      <div class="content">${e.content ?? ''}</div>
      ${e.image_url ? `<img src="${e.image_url}" />` : ''}
      ${e.audio_url ? `<audio controls src="${e.audio_url}"></audio>` : ''}
    </div>`
    )
    .join('')}
</body>
</html>`;
  res.send(html);
});

app.get('/health', requireBasicAuth, (req, res) => res.json({ ok: true, service: 'vesper' }));

app.listen(PORT, () => console.log(`vesper listening on ${PORT}`));
