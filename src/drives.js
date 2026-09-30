// 接 Drivesoid（情绪驱动系统，单独部署的旁路服务，默认 http://127.0.0.1:24601）。
//
// 这里做三件事：
//   1. 上报：gateway 每记一条聊天，就报给 Drivesoid（msg_user / msg_assistant）。
//      Drivesoid 用自己的分类模型给消息打情绪标签，再更新情绪状态。
//   2. 读取：phosphor 每次醒来先读当前情绪块（/api/drives/context），放进 decide 的 prompt。
//   3. 提炼：把最近的对话压成一句话，一起交给 decide。
//
// DRIVES_URL 不填时上报和读取都不做，phosphor 和 gateway 的行为跟原来一样。
// Drivesoid 的上报接口只接受本机请求，所以它要和 vesper 装在同一台机器上。

import { formatContextText } from './context.js';

const DRIVES_URL = (process.env.DRIVES_URL || '').trim().replace(/\/+$/, '');
const REPORT_TIMEOUT_MS = 3000;
const READ_TIMEOUT_MS = 3000;
// 读情绪前先让 Drivesoid 跑一轮 tick，把刚上报、还没处理的消息分类掉（它自己每 2.5 分钟才跑一次）。
// 分类要调一次模型，所以给宽一点；超时就直接读它现有的快照。
const REFRESH_TIMEOUT_MS = 15000;

const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';
const EVENT_SPEAKER = '（事件）';

// 一句话提炼默认跟着 DRIVES_URL 走；RECENT_SUMMARY=on / off 可以单独开关。
const SUMMARY_SWITCH = (process.env.RECENT_SUMMARY || '').trim().toLowerCase();
const SUMMARY_ON = SUMMARY_SWITCH ? SUMMARY_SWITCH === 'on' : Boolean(DRIVES_URL);
// 提炼用的模型。不单独配就用 decide 的 LLM_*（和 decide.js 一样，BASE_URL 是带 /chat/completions 的完整地址）。
const SUMMARY_BASE_URL =
  process.env.RECENT_SUMMARY_BASE_URL ||
  process.env.LLM_BASE_URL ||
  'https://api.deepseek.com/v1/chat/completions';
const SUMMARY_MODEL =
  process.env.RECENT_SUMMARY_MODEL || process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const SUMMARY_API_KEY =
  process.env.RECENT_SUMMARY_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const SUMMARY_TIMEOUT_MS = Number(process.env.RECENT_SUMMARY_TIMEOUT_MS || 60000);
const SUMMARY_MAX_CHARS = 120;

export function isDrivesEnabled() {
  return Boolean(DRIVES_URL);
}

export function isSummaryEnabled() {
  return SUMMARY_ON;
}

// ---------- 上报 ----------

async function postEvent(body) {
  try {
    const res = await fetch(`${DRIVES_URL}/internal/drives/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`drives: 上报 ${body.type} 失败 HTTP ${res.status}`);
  } catch (err) {
    console.error(`drives: 上报 ${body.type} 失败（Drivesoid 在运行吗？）:`, err.message);
  }
}

// 不 await：上报失败或变慢都不能拖住聊天请求。postEvent 自己吞掉错误。
export function reportUserMessage(text, context = []) {
  if (!DRIVES_URL || !text) return;
  const payload = { text };
  if (context.length) payload.context = context;
  void postEvent({ type: 'msg_user', payload });
}

export function reportAssistantMessage() {
  if (!DRIVES_URL) return;
  void postEvent({ type: 'msg_assistant', payload: {} });
}

// ---------- 读取情绪 ----------

async function refreshSnapshot() {
  try {
    await fetch(`${DRIVES_URL}/internal/drives/session-start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('drives: 刷新情绪快照失败，读现有快照:', err.message);
  }
}

// 返回 Drivesoid 的 [drives] 文本块；没接、没开、快照过期都返回 null。
export async function getDrivesBlock() {
  if (!DRIVES_URL) return null;
  await refreshSnapshot();
  try {
    const res = await fetch(`${DRIVES_URL}/api/drives/context`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 503 = 快照超过 5 分钟没更新（刚启动，或者 worker 卡住了）
      console.warn(`drives: 读情绪失败 HTTP ${res.status}，这次不带情绪`);
      return null;
    }
    const text = (await res.text()).trim();
    return text || null;
  } catch (err) {
    console.error('drives: 读情绪失败（Drivesoid 在运行吗？）:', err.message);
    return null;
  }
}

// ---------- 最近对话一句话 ----------

// 上一次提炼的结果。醒来时没有新消息，就直接用这句，不再调模型。
let summaryCache = { key: null, text: null };

function cleanSummary(raw) {
  const line =
    String(raw ?? '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean) ?? '';
  const s = line.replace(/^["'“”「」『』]+|["'“”「」『』]+$/g, '').trim();
  return s.length > SUMMARY_MAX_CHARS ? `${s.slice(0, SUMMARY_MAX_CHARS)}…` : s;
}

// entries 是 getSharedContext() 的结果。失败返回 null，不缓存失败，下次醒来会再试。
export async function summarizeRecent(entries) {
  if (!SUMMARY_ON || !Array.isArray(entries) || !entries.length) return null;
  if (!entries.some((e) => e.speaker !== EVENT_SPEAKER)) return null;

  const last = entries[entries.length - 1];
  const key = `${entries.length}|${last.ts}|${last.content?.length ?? 0}`;
  if (summaryCache.key === key) return summaryCache.text;

  const prompt = `下面是${USER_NAME}和${AI_NAME}最近的聊天记录（可能来自多个聊天窗口；标着"${EVENT_SPEAKER}"的是自动唤醒做过的事）。

用一句话（60 字以内）提炼：最近在聊什么、${USER_NAME}此刻大概是什么状态、有没有还没接上的话。
只输出这一句，不要引号、不要解释、不要分点。

${formatContextText(entries)}`;

  try {
    const res = await fetch(SUMMARY_BASE_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUMMARY_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: SUMMARY_MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(SUMMARY_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`drives: 一句话提炼失败 HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return null;
    }
    const data = await res.json();
    const text = cleanSummary(data.choices?.[0]?.message?.content);
    if (!text) {
      console.warn('drives: 一句话提炼返回空正文');
      return null;
    }
    summaryCache = { key, text };
    return text;
  } catch (err) {
    console.error('drives: 一句话提炼失败:', err.message);
    return null;
  }
}
