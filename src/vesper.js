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
} from './state.js';
import { registerMomentRoutes } from './moments-page.js';

const app = express();
app.use(express.json());
// 动态页的留言、纪念日表单是普通 form 提交
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.VESPER_PORT || 3001;
const API_KEY = process.env.REPORT_STATUS_API_KEY;
const BASIC_USER = process.env.VESPER_BASIC_USER;
const BASIC_PASS = process.env.VESPER_BASIC_PASS;
const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MEDIA_MAX_AGE_DAYS = Number(process.env.MEDIA_MAX_AGE_DAYS || 30);

fs.mkdirSync(path.join(MEDIA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'audio'), { recursive: true });

// decision / result 存的是模型返回的原始文本，坏的就当 null，不让路由 500。
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

// 给网页浏览的路由（/moments、/health、/media）加 Basic Auth。
function requireBasicAuth(req, res, next) {
  if (!BASIC_USER || !BASIC_PASS) return next();
  const auth = req.headers.authorization;
  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = Buffer.from(encoded, 'base64').toString();
      const idx = decoded.indexOf(':');
      if (idx > 0 && decoded.slice(0, idx) === BASIC_USER && decoded.slice(idx + 1) === BASIC_PASS) {
        return next();
      }
    }
  }
  res.set('WWW-Authenticate', 'Basic realm="vesper"');
  return res.status(401).send('需要登录');
}

// 给程序化访问（手机快捷指令、以后的前端）用的 x-api-key 校验。
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
  // 人工/前端侧的开关，silent 也放行。
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

app.post('/wake/conversation', requireApiKey, (req, res) => {
  const { speaker, content, messages } = req.body;
  if (Array.isArray(messages)) {
    for (const m of messages) addConversationMessage(m.speaker, m.content);
    return res.json({ ok: true, count: messages.length });
  }
  if (!content) return res.status(400).json({ error: 'content required' });
  addConversationMessage(speaker, content);
  res.json({ ok: true });
});

app.get('/wake/conversation', requireApiKey, (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  res.json(getRecentConversation(limit));
});

// 动态页 /moments（标题、纪念日、日历、按天看动态、留言）以及对应接口，见 moments-page.js
registerMomentRoutes(app, { requireBasicAuth, requireApiKey });

app.get('/health', requireBasicAuth, (req, res) => res.json({ ok: true, service: 'vesper' }));

app.listen(PORT, () => console.log(`vesper listening on ${PORT}`));
