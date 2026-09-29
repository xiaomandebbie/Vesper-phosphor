// 和另一个唤醒项目（heartbeat）共用上下文。
//
// heartbeat 把聊天记录和它自己的唤醒事件都存在一个 JSON 文件里（enhanced_messages.json）。
// 这里做两件事：
//   1. 读：从这个文件里取"事件"（推送、未推送等），和 conversation_log 合并成共享上下文（见 context.js）。
//   2. 写：phosphor 做了事（推送、发动态、逛论坛……）之后，通过 heartbeat 的 /internal/wake-event
//      写回它的时间线。heartbeat 下次醒来、以及聊天前端下次聊天时都能看到。
//
// 两个环境变量都不填时，这个文件什么都不做。

import fs from 'fs';

export const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Shanghai';
const TIMELINE_FILE = (process.env.HEARTBEAT_TIMELINE_FILE || '').trim();
const EVENT_URL = (process.env.HEARTBEAT_EVENT_URL || '').trim();
const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';
const EVENT_SPEAKER = '（事件）';
const MAX_CHARS_PER_MESSAGE = 500;

// 和 heartbeat 的 special_events.js 保持一致。
// heartbeat 只认这种开头的消息是"唤醒事件"：会保留在时间线里，也会注入到之后的聊天上下文。
// 不符合这个格式的事件，下一次有人聊天时就会被 heartbeat 丢掉。
// 注意中间那段称呼用通配符：两边各自怎么叫对方不一样，写死了就对不上了。
const SPECIAL_EVENT_PREFIX =
  /^\s*[（(]\s*\d{4}[/-]\d{1,2}[/-]\d{1,2}(?:[ T]?)\d{1,2}[:：]\d{2}(?::\d{2})?\s+(?:自动唤醒：本次未发送(?:\s*(?:Bark|推送))?|刚刚发送了推送|刚刚给[^：:｜|）)\s]{0,24}发了\s*(?:Bark|ntfy)?\s*推送|刚刚给[^：:｜|）)\s]{0,24}发了\s*Bark)(?:[：:｜|）)]|\s|$)/i;
const TIMESTAMP = /(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]?)(\d{1,2})[:：](\d{2})/;

// ---------- 时间 ----------

function wallParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}

// 按 TIME_ZONE 显示成 "2026-09-28 20:50"（heartbeat 用的也是这种格式）
export function formatWallTime(date = new Date()) {
  const p = wallParts(date);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}`;
}

// 把 TIME_ZONE 下的"墙上时间"转成毫秒时间戳
function wallTimeToMs(year, month, day, hour, minute) {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const p = wallParts(new Date(guess));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return guess - (asUtc - guess);
}

// ---------- 读 heartbeat 时间线 ----------

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        if (part && (part.image_url || String(part.type || '').includes('image'))) return '[图片]';
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function toEntry(msg) {
  let text = contentToText(msg.content);

  // 聊天前端的消息末尾可能带 <sent_at 2026-09-28 20:50>，优先用它当时间
  const sentAt = [...text.matchAll(/<sent_at\s+([^>]*)>/g)].pop();
  text = text
    .replace(/<environment>[\s\S]*?<\/environment>/g, '')
    .replace(/<sent_at[^>]*>/g, '')
    .trim();

  let ts = null;
  const m = (sentAt ? sentAt[1] : text).match(TIMESTAMP);
  if (m) ts = wallTimeToMs(+m[1], +m[2], +m[3], +m[4], +m[5]);

  const isEvent = msg.role === 'assistant' && SPECIAL_EVENT_PREFIX.test(text);
  const speaker = isEvent ? EVENT_SPEAKER : msg.role === 'user' ? USER_NAME : AI_NAME;
  if (text.length > MAX_CHARS_PER_MESSAGE) text = `${text.slice(0, MAX_CHARS_PER_MESSAGE)}…`;
  return { ts, speaker, content: text };
}

function loadEntries() {
  try {
    const raw = JSON.parse(fs.readFileSync(TIMELINE_FILE, 'utf-8'));
    if (!Array.isArray(raw)) {
      console.error(`timeline: ${TIMELINE_FILE} 顶层不是数组`);
      return null;
    }
    return raw
      .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && !m.tool_calls)
      .map(toEntry)
      .filter((e) => e.content);
  } catch (err) {
    console.error(`timeline: 读取 ${TIMELINE_FILE} 失败:`, err.message);
    return null;
  }
}

export function isSharedTimelineEnabled() {
  return Boolean(TIMELINE_FILE);
}

// 最近 limit 条（时间正序）。读不到返回 null，调用方自己回退。
export function readSharedConversation(limit = 20) {
  const entries = loadEntries();
  return entries ? entries.slice(-limit) : null;
}

// 最近 windowMs 内真人对话条数（不算事件）。读不到返回 null。
export function countSharedConversation(windowMs) {
  const entries = loadEntries();
  if (!entries) return null;
  const since = Date.now() - windowMs;
  return entries.filter((e) => e.speaker !== EVENT_SPEAKER && e.ts && e.ts >= since).length;
}

// ---------- 写回 heartbeat 时间线 ----------

function short(value, n = 60) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function tryJson(value) {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// 把这次醒来做的事写成一句 heartbeat 认得的事件。没做成、或不值得记的返回 null。
// executeAction() 失败时返回 null；MCP 工具报错时返回 { isError: true }。两种都当作没做成，
// 不然工具明明报错了，时间线上还会写"记下了一条长期记忆"。
// 措辞要和 heartbeat 的 special_events.js 对得上，改之前先确认那边也认。
export function describeAction(decision, result) {
  if (!decision || result == null || result?.isError) return null;
  const detail = decision.action_detail || '';
  switch (decision.action) {
    case 'bark':
      return result?.ok ? `刚刚给用户发了Bark推送：${short(result.message, 200)}` : null;
    case 'moment':
    case 'diary': {
      if (!result?.ok) return null;
      const extras = [result.has_image ? '配了图' : '', result.has_audio ? '配了语音' : '']
        .filter(Boolean)
        .join('、');
      return `自动唤醒：本次未发送推送｜发了一条动态${extras ? `（${extras}）` : ''}：${short(result.content)}`;
    }
    case 'mcp_call': {
      const j = tryJson(detail);
      if (!j?.server || !j?.tool) return null;
      const cmd = j.args?.command ? ` ${short(j.args.command, 40)}` : '';
      return `自动唤醒：本次未发送推送｜用了 ${j.server}/${j.tool}${cmd}`;
    }
    case 'ombre_brain': {
      const j = tryJson(detail);
      return j?.mode === 'hold'
        ? `自动唤醒：本次未发送推送｜记下了一条长期记忆：${short(j.title || j.content)}`
        : null;
    }
    case 'set_mode':
      return result?.ok ? `自动唤醒：本次未发送推送｜把节律调成了 ${result.mode}` : null;
    default:
      // noop 和翻记忆（breath/search/feel）不写，免得时间线被刷满
      return null;
  }
}

export async function postSharedEvent(summary) {
  if (!EVENT_URL || !summary) return;
  const content = `（${formatWallTime()} ${summary}）`;
  try {
    const res = await fetch(EVENT_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`timeline: 写入 heartbeat 事件失败 HTTP ${res.status}`);
      return;
    }
    console.log('timeline: 已写入 heartbeat 时间线');
  } catch (err) {
    console.error('timeline: 写入 heartbeat 事件失败（heartbeat gateway 在运行吗？）:', err.message);
  }
}
