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

import { getRecentConversation, countRecentConversation } from './state.js';
import { isSharedTimelineEnabled, readSharedConversation, formatWallTime } from './timeline.js';
import { clipText, toWellFormed } from './text.js';

const EVENT_SPEAKER = '（事件）';
const MAX_EVENTS = 8;
const MAX_CHARS = 500;

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

// 最近 limit 条聊天（所有窗口），加上这段时间里最近几条事件，按时间正序。
// 事件最多 MAX_EVENTS 条，免得 heartbeat 每 10 分钟一条的"未推送"把聊天挤掉。
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
  return [...chat, ...events].sort((a, b) => a.ts - b.ts);
}

// 最近 windowMs 内的聊天条数（不算事件）
export function countRecentChat(windowMs) {
  return countRecentConversation(windowMs);
}

// 给模型看的文本版本。heartbeat-wake 会把它原样塞进请求，所以再清一遍半个字符
export function formatContextText(entries) {
  return toWellFormed(
    entries.map((e) => `[${formatWallTime(new Date(e.ts))}] ${e.speaker}: ${e.content}`).join('\n\n')
  );
}
