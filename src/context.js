// 跨窗口的共享上下文。
//
// heartbeat 的时间线文件每收到一次聊天请求，就被那次请求带来的历史整个替换掉：
// 换一个聊天窗口，之前窗口的聊天就没了；别的请求（比如后台整理日记）也会把它盖掉。
// 所以聊天记录不从那个文件读，而是读 vesper-gateway 自己记的 conversation_log：
// 它是每条消息追加一行，不分窗口、不会被覆盖。
// heartbeat 文件里只拿"事件"（推送、未推送、phosphor 写回去的动作），
// 这些 heartbeat 换窗口时也会保留。
//
// phosphor 做决定、heartbeat 醒来（走 heartbeat-wake 线路）都用这里的结果，两边看到的内容一样。
//
// 关于"跨天不断层"：整理 conversation_log 时旧记录会搬进 conversation_archive（见 state.js），
// 于是"最近 N 条"只覆盖最近一段。这里在窗口之前再补几条稀疏的锚点（默认每 6 小时一条），
// 让更早那几天也留个印象，不至于昨天聊过什么完全看不见。

import { getRecentConversation, countRecentConversation, getConversationAnchors } from './state.js';
import { isSharedTimelineEnabled, readSharedConversation, formatWallTime } from './timeline.js';
import { clipText, toWellFormed } from './text.js';

const EVENT_SPEAKER = '（事件）';
const MAX_EVENTS = 8;
const MAX_CHARS = 500;

// 窗口之前补几条锚点。.env 的 HEARTBEAT_CONTEXT_ANCHORS 可改，不填是 4，填 0 关闭。
const ANCHOR_COUNT = (() => {
  const raw = String(process.env.HEARTBEAT_CONTEXT_ANCHORS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : 4;
})();

// 锚点之间隔几小时取一条。不填是 6，最小 1。
const ANCHOR_BUCKET_HOURS = (() => {
  const raw = String(process.env.HEARTBEAT_CONTEXT_ANCHOR_HOURS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 1 ? n : 6;
})();

// 锚点最多往回看几天。不填是 7。
const ANCHOR_MAX_DAYS = (() => {
  const raw = String(process.env.HEARTBEAT_CONTEXT_ANCHOR_DAYS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 1 ? n : 7;
})();

// 按完整字符截断，不会把 emoji 切成两半（见 text.js）
function clip(text) {
  return clipText(String(text ?? '').trim(), MAX_CHARS);
}

function heartbeatEvents() {
  if (!isSharedTimelineEnabled()) return [];
  const entries = readSharedConversation(200);
  if (!entries) return [];
  return entries.filter((e) => e.speaker === EVENT_SPEAKER && e.ts);
}

// 窗口之前的稀疏锚点：每 ANCHOR_BUCKET_HOURS 小时留一条，最多 ANCHOR_COUNT 条。
// conversation_log 和归档一起查，所以记录被整理过之后，更早的事也还看得见。
function earlierAnchors(before) {
  if (!ANCHOR_COUNT) return [];
  try {
    const rows = getConversationAnchors({
      before,
      since: before - ANCHOR_MAX_DAYS * 24 * 60 * 60 * 1000,
      bucketMs: ANCHOR_BUCKET_HOURS * 60 * 60 * 1000,
      limit: ANCHOR_COUNT,
    });
    return rows.map((m) => ({
      ts: m.ts,
      speaker: m.speaker ?? '?',
      content: clip(m.content),
      anchor: true,
    }));
  } catch (err) {
    console.error('context: 取更早的锚点失败（不影响这次）', err.message);
    return [];
  }
}

// 最近 limit 条聊天（所有窗口），加上这段时间里最近几条事件，按时间正序。
// 事件最多 MAX_EVENTS 条，免得 heartbeat 每 10 分钟一条的"未推送"把聊天挤掉。
// 这批之前再补几条更早的锚点（anchor: true），让跨天不断层。
export function getSharedContext(limit = 20) {
  const chat = getRecentConversation(limit).map((m) => ({
    ts: m.ts,
    speaker: m.speaker ?? '?',
    content: clip(m.content),
  }));
  const since = chat.length ? chat[0].ts : 0;
  const events = heartbeatEvents()
    .filter((e) => e.ts >= since)
    .slice(-MAX_EVENTS)
    .map((e) => ({ ...e, content: clip(e.content) }));
  const anchors = chat.length ? earlierAnchors(since) : [];
  return [...anchors, ...chat, ...events].sort((a, b) => a.ts - b.ts);
}

// 最近 windowMs 内的聊天条数（不算事件）
export function countRecentChat(windowMs) {
  return countRecentConversation(windowMs);
}

// 给模型看的文本版本。heartbeat-wake 会把它原样塞进请求，所以再清一遍半个字符。
// 锚点前面插一句说明：那几条是隔几小时挑一条的，中间大段没带上。
export function formatContextText(entries) {
  const lines = [];
  let anchorNoteDone = false;
  for (const e of entries) {
    if (e.anchor && !anchorNoteDone) {
      lines.push('（下面开头几条是更早的，中间大段没带上，只是让你知道那几天大概在聊什么）');
      anchorNoteDone = true;
    }
    lines.push(`[${formatWallTime(new Date(e.ts))}] ${e.speaker}: ${e.content}`);
  }
  return toWellFormed(lines.join('\n\n'));
}
