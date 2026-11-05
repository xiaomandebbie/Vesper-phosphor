// 聊天自己回话：不再经过别人的 relay。
//
// 小满 2026-11-05：「把 relay 什么的去掉」「他怎么没思考链了」「那你做吧」
//
// ── 为什么打自己的网关 ──
//
// 网关上那条 chat / aru-chat 线路（source: 'client'）已经把最鲁的部分做完了：
// 把双方的话记进 conversation_log、注入小酒馆状态、注入「她正在做的事」。
// 更要紧的是：走网关 = 网页聊天和 Aru 里那个 aru-chat 走同一条线路。
//
// ── 思考链丢在哪里（2026-11-05）──
//
// 上一版解 SSE 时只取了 delta.content，没取 delta.reasoning_content——
// 所以他的思考整段被丢掉了。不同上游字段名不一样，所以下面几个都试。
//
// ── 工具循环 ──
//
// 她说「你可以试试跳对话查看呀」，他写了 <aru-tool name="breath_search">，
// 但没人接这段 XML——于是它原样流进了气泡里。他不是没记，
// 是伸手的地方没有东西（见 memory-tools.js）。
//
// 现在：收到正文里有标签就停下来执行，把结果回灌再问一轮。
//
// 工具结果用 role='system' 回灌，不用 role='tool'：
//   message-repair.js 会把孤立的 tool 消息修掉（没 tool_call_id 上游会 400）；
//   而 role='user' 会被网关记进 conversation_log 当成小满说的话。
//   system 两头都不踩。
//
// 最多转三轮：再多就是他卡在查评里出不来，而她在等一句话。
//
// ── SSE 帧 ──
//
//   { type: 'typing', active }
//   { type: 'thinking', stream_id, text }                 …边想边推
//   { type: 'tool', id, label, detail }                   …头像旁边那张小卡片
//   { type: 'reply_delta', stream_id, text }
//   { type: 'reply_delta', stream_id, done, final_text }

import fs from 'node:fs';
import { getRecentConversation } from './state.js';
import { listWindows, listWindowMessages } from './chat-windows.js';
import { formatDateTime } from './wall-time.js';
import { buildMessages as buildWithMemory } from './memory-inject.js';
import { toolPrompt, parseCall, stripCall, runTool, callLabel } from './memory-tools.js';

const GATEWAY = String(process.env.VESPER_GATEWAY_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
const ROUTE = String(process.env.CHAT_ROUTE_NAME || 'aru-chat');
const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';
const HISTORY_TURNS = (() => {
  const n = Number(String(process.env.CHAT_HISTORY_TURNS ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 30;
})();
// 工具最多转几轮
const MAX_HOPS = (() => {
  const n = Number(String(process.env.CHAT_TOOL_HOPS ?? '').trim());
  return Number.isInteger(n) && n >= 0 ? n : 3;
})();

export function gatewayKey() {
  return String(process.env.GATEWAY_API_KEY || '').trim() || null;
}

// ── 订阅者名单 ──

const clients = new Set();

export function addClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

export function clientCount() {
  return clients.size;
}

export function emit(frame) {
  if (!clients.size) return;
  const line = `data: ${JSON.stringify(frame)}\n\n`;
  for (const res of [...clients]) {
    try {
      res.write(line);
    } catch {
      clients.delete(res);
    }
  }
}

// ── 底：指令空着时用这段 ──

let personaCache = null;
let personaAt = 0;

function persona() {
  const now = Date.now();
  if (personaCache !== null && now - personaAt < 60000) return personaCache;
  personaAt = now;

  const inline = String(process.env.CHAT_PERSONA || '').trim();
  if (inline) {
    personaCache = inline;
    return personaCache;
  }

  const file = String(process.env.CHAT_PERSONA_FILE || '').trim();
  if (file) {
    try {
      const text = String(fs.readFileSync(file, 'utf8')).trim();
      if (text) {
        personaCache = text;
        return personaCache;
      }
    } catch (err) {
      console.error('chat: 读不到人格文件', file, err.message);
    }
  }

  personaCache =
    `你是${AI_NAME}，正在和${USER_NAME}聊天。` +
    `这是你们自己的屋子，不是客服窗口：像平常说话那样回，不用开场客套，` +
    `不要把每句话都堆成列表。下面会给你最近的对话记录，` +
    `那就是你自己记得的事。`;
  return personaCache;
}

// ── 前文：上下文范围就是最新那个窗 ──

function history() {
  try {
    const wins = listWindows();
    if (wins.length) {
      const msgs = listWindowMessages(wins[0].id, HISTORY_TURNS * 2) || [];
      return msgs
        .slice(-HISTORY_TURNS)
        .map((m) => ({ role: m.from === 'human' ? 'user' : 'assistant', content: m.text }))
        .filter((m) => m.content);
    }
    const rows = getRecentConversation(HISTORY_TURNS);
    const out = [];
    for (const r of rows) {
      const content = String(r.content ?? '').trim();
      if (!content) continue;
      out.push({ role: r.speaker === USER_NAME ? 'user' : 'assistant', content });
    }
    return out;
  } catch (err) {
    console.error('chat: 读不到前文，这轮只带当前这句', err.message);
    return [];
  }
}

// ── 请求一轮 ──
//
// 边收边推，收完返回 { text, reasoning }。
// 思考链的字段名各家不同：DeepSeek 是 reasoning_content，
// 别家有用 reasoning 的。都试一遍，哪个有算哪个。
async function once(messages, streamId, key) {
  let res;
  try {
    res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: ROUTE, messages, stream: true }),
      signal: AbortSignal.timeout(300000),
    });
  } catch (err) {
    throw new Error(`连不上网关：${err.message}`);
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`上游 ${res.status}：${detail.slice(0, 200)}`);
  }

  let text = '';
  let reasoning = '';
  let buffer = '';
  const decoder = new TextDecoder();

  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let d;
      try {
        d = JSON.parse(payload)?.choices?.[0]?.delta;
      } catch {
        continue;
      }
      if (!d) continue;

      const think = d.reasoning_content ?? d.reasoning ?? d.thinking;
      if (typeof think === 'string' && think) {
        reasoning += think;
        emit({ type: 'thinking', stream_id: streamId, text: reasoning });
      }

      if (typeof d.content === 'string' && d.content) {
        text += d.content;
        // 标签开头了就停手：别把 <aru-tool 这几个字推到气泡里
        const cut = text.indexOf('<aru-tool');
        emit({
          type: 'reply_delta',
          stream_id: streamId,
          text: cut >= 0 ? text.slice(0, cut).trim() : text,
        });
      }
    }
  }

  return { text, reasoning };
}

// ── 问上游（带工具循环）──
//
// 正文落库是网关干的，所以这边不再写一遗。
export async function askUpstream(text, { streamId = String(Date.now()) } = {}) {
  const key = gatewayKey();
  if (!key) return { ok: false, error: '读不到 GATEWAY_API_KEY' };

  let messages;
  try {
    messages = buildWithMemory({ history: history(), text, fallbackSystem: persona() });
    // 工具说明摆在最后一句话前面——和召回一个位置，不破坏前面的缓存
    const last = messages.pop();
    messages.push({ role: 'system', content: toolPrompt() }, last);
  } catch (err) {
    console.error('chat: 记忆这层出错，这轮只带前文', err.message);
    messages = [
      { role: 'system', content: persona() },
      ...history(),
      { role: 'user', content: String(text ?? '').trim() },
    ];
  }

  emit({ type: 'typing', active: true });

  let finalText = '';
  let lastReasoning = '';

  try {
    for (let hop = 0; hop <= MAX_HOPS; hop++) {
      const r = await once(messages, streamId, key);
      if (r.reasoning) lastReasoning = r.reasoning;

      const call = parseCall(r.text);
      const spoken = stripCall(r.text);

      if (!call) {
        finalText = spoken || r.text.trim();
        break;
      }

      // 最后一轮还要调工具：停下，把已经说的那部分给她
      if (hop === MAX_HOPS) {
        console.warn(`chat: 工具转了 ${MAX_HOPS} 轮还要接着查，停了`);
        finalText = spoken || '这个我得再查一下，稍等。';
        break;
      }

      const out = await runTool(call);
      emit({
        type: 'tool',
        id: `${streamId}-${hop}`,
        label: callLabel(call),
        detail: out,
      });
      console.log(`chat: 他用了 ${call.name}`);

      // 把这一轮的输出和工具结果接回去。
      // 工具结果用 system：role='tool' 会被 message-repair 修掉，
      // role='user' 会被网关当成小满说的话记进库。
      messages.push({ role: 'assistant', content: r.text });
      messages.push({
        role: 'system',
        content: `<tool_result name="${call.name}">\n${out}\n</tool_result>`,
      });
    }
  } catch (err) {
    emit({ type: 'typing', active: false });
    console.error('chat:', err.message);
    return { ok: false, error: err.message };
  }

  const done = finalText.trim();
  emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: done });
  emit({ type: 'typing', active: false });

  if (!done) {
    // 只有思考没有正文——网关那边会当成断片记一笔
    return { ok: false, error: '上游这轮没说出正文' };
  }
  return { ok: true, text: done, reasoning: lastReasoning };
}

// 把几句攒着的话合成一条递上去。
//
// 为何合成一条：她点「让他回复」的意思是「这几句一起读」。
// 每句前面标时间：她可能上午存一句、晚上才点。
export function joinPending(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  if (rows.length === 1) return String(rows[0].text ?? '').trim();
  return rows
    .map((r) => {
      const when = formatDateTime(r.created_at).slice(5, 16);
      return `【${when}】${String(r.text ?? '').trim()}`;
    })
    .join('\n');
}
