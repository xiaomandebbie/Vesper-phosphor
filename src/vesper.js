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
import { registerDrivesRoutes } from './drives-page.js';
import { registerDiaryRoutes } from './diary-page.js';
import { registerMemoryProxy } from './memory-proxy.js';
import { registerMusicProxy } from './music-proxy.js';
import { registerShellRoutes } from './shell.js';
import { registerSparkles } from './sparkles.js';
import { registerAppIconRoutes } from './app-icon.js';

const app = express();
// 点击星星（见 sparkles.js）：最先挂，转发来的记忆库、音乐页面和我们自己的页面都能加上
registerSparkles(app);
// 记忆库 /memory/ 是把 Ombre Brain 的管理页转发过来（见 memory-proxy.js），要原样拿到请求体，
// 所以必须挂在下面的 body 解析之前。音乐 /music/ 同理（见 music-proxy.js）
const memoryProxy = registerMemoryProxy(app, { requireBasicAuth });
const musicProxy = registerMusicProxy(app, { requireBasicAuth });
app.use(express.json());
// 动态页的留言、头像表单是普通 form 提交。
// 头像在浏览器里裁好后以 base64 一起提交，一般几十 KB，上限放到 1mb（默认 100kb 偶尔不够）
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
// 主屏幕图标（见 app-icon.js）：要挂在各个页面路由之前，它会往页面 <head> 里加图标信息、往「自定义」页加图标卡片
registerAppIconRoutes(app, { requireBasicAuth });
// 外壳页 /app（见 shell.js）：配了音乐才开。要挂在动态、日记、心绪页之前，直接打开它们时先带回外壳
if (musicProxy) registerShellRoutes(app, { requireBasicAuth });

const PORT = process.env.VESPER_PORT || 3001;
const API_KEY = process.env.REPORT_STATUS_API_KEY;
const BASIC_USER = process.env.VESPER_BASIC_USER;
const BASIC_PASS = process.env.VESPER_BASIC_PASS;
const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const MEDIA_MAX_AGE_DAYS = Number(process.env.MEDIA_MAX_AGE_DAYS || 30);

fs.mkdirSync(path.join(MEDIA_DIR, 'images'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'audio'), { recursive: true });
fs.mkdirSync(path.join(MEDIA_DIR, 'avatars'), { recursive: true });

// decision / result 存的是模型返回的原始文本，坏的就当 null，不让路由 500。
function safeParse(s) {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// 只清动态的图片和语音。头像（avatars）和主屏幕图标（app-icon）不在这里，不会过期被删
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

// 给网页浏览的路由（/moments、/drives、/diary、/memory、/music、/app、/health、/media）加 Basic Auth。
// 函数声明会提升，上面挂记忆库、音乐时就能用；它读的那几个常量要到请求进来时才用到，那时已经有值了
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

// 日记页 /diary（heartbeat 写的日记），见 diary-page.js。
// 要挂在动态页之前：动态页里留着一个 /diary → /moments 的旧跳转，日记页没配时才轮到它
const diaryPage = registerDiaryRoutes(app, { requireBasicAuth });
// 动态页 /moments（标题、日历、按天看动态、留言、自定义）以及对应接口，见 moments-page.js
registerMomentRoutes(app, { requireBasicAuth, requireApiKey });
// 心绪页 /drives（Drivesoid 的情绪状态），见 drives-page.js
registerDrivesRoutes(app, { requireBasicAuth });

app.get('/health', requireBasicAuth, (req, res) => res.json({ ok: true, service: 'vesper' }));

// 根路径：配了音乐就进外壳（换页不断歌），没配就直接去动态页
app.get('/', (req, res) => res.redirect(302, musicProxy ? '/app' : '/moments'));

app.listen(PORT, () =>
  console.log(
    `vesper listening on ${PORT}；日记页：${diaryPage ? '已开启' : '未配置'}；记忆库：${memoryProxy ? `转发 ${memoryProxy}` : '未配置'}；音乐：${musicProxy ? `转发 ${musicProxy}，外壳 /app` : '未配置'}`
  )
);
