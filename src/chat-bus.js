// 聊天自己回话：不再经过别人的 relay。
//
// 小满 2026-11-05：「把 relay 什么的去掉，不用人家那一套了」
// 「我可以把这个线路直接接到聊天模型吗」
//
// ── 为什么打自己的网关，而不是直接打 DeepSeek ──
//
// 因为网关上那条 chat / aru-chat 线路（source: 'client'）已经把最鲁的那部分
// 做完了：自动把双方的话记进 conversation_log、注入小酒馆状态、注入「她正在
// 做的事」、把空正文用思考兜底。自己再写一遗就是两份代码干同一件事。
//
// 更要紧的是：走网关 = 网页聊天和 Aru 里那个 aru-chat 走同一条线路。
// 她在「模型 · 连接 · 通知」里改「聊天」那一组，两边一起换——
// 这正是她要的「只要他们共用上游」。
//
// 所以这一层只管三件事：拼 messages、解 SSE、把字推给浏览器。
//
// ── 认证 ──
//
// 打自己的网关要带 GATEWAY_API_KEY。它就在本机 .env 里，和网关读的是同一个。
// 读不到就不挂聊天（见 echo-relay.js），不装作能用。
//
// ── SSE 怎么回到页面上 ──
//
// 原来是 relay 落库再扇出。现在回话就在本进程里，所以自己留一份订阅者名单，
// 边收边推。帧的形状沿用前端已经认的那两种（chat-page.js 的 onFrame）：
//   { type: 'typing', active: true|false }
//   { type: 'reply_delta', stream_id, text }        …边生边推
//   { type: 'reply_delta', stream_id, done: true, final_text }
// 前端一个字不用改。
//
// 多个标签页同时开着就都收得到；没人开着也不影响回话，
// 因为正文是网关落库的，不靠这条 SSE。

import fs from 'node:fs';
import { getRecentConversation } from './state.js';
import { formatDateTime } from './wall-time.js';

const GATEWAY = String(process.env.VESPER_GATEWAY_URL || 'http://127.0.0.1:3002').replace(/\/+$/, '');
// 网关上的线路名。aru-chat 和 chat 指向同一组上游（见 gateway.js 的 routingTable）。
const ROUTE = String(process.env.CHAT_ROUTE_NAME || 'aru-chat');
const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';
// 带多少条前文。网关那边不再替聊天跟上上文，所以这边自己拼。
const HISTORY_TURNS = (() => {
  const n = Number(String(process.env.CHAT_HISTORY_TURNS ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 30;
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

// 推一帧。写不进去的（浏览器已经走了）直接从名单里去掉，
// 不能让一个死连接把整次回话拖崩。
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

// ── 人格 ──
//
// .env 里 CHAT_PERSONA 直接写正文，CHAT_PERSONA_FILE 指一个文件。
// 两个都没有就用下面这段最小的——没有人格文件也能先聊起来，
// 别为了等一份设定把整个聊天卡在门外。
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
      // 同步读：这文件就几 KB，而且每分钟最多读一次。
      // fs 必须是顶层 import：这个项目是 ESM，require 在这里是未定义的。
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

// ── 拼 messages ──
//
// 前文从 conversation_log 读：那是网关每轮追写的同一本账，
// Aru 里说的话和网页上说的话都在里面——所以两边看到的是同一段关系。
//
// 注意：不把本次要说的话先写进库再读，否则它会在 messages 里出现两次。
// 写库由网关做（recordUserMessage）。
function buildMessages(text) {
  const out = [{ role: 'system', content: persona() }];

  let rows = [];
  try {
    rows = getRecentConversation(HISTORY_TURNS);
  } catch (err) {
    console.error('chat: 读不到前文，这轮只带当前这句', err.message);
  }

  for (const r of rows) {
    const content = String(r.content ?? '').trim();
    if (!content) continue;
    out.push({
      role: r.speaker === USER_NAME ? 'user' : 'assistant',
      content,
    });
  }

  out.push({ role: 'user', content: String(text ?? '').trim() });
  return out;
}

// ── 问上游 ──
//
// 边收边推；收完返回整段正文。
// 正文落库是网关干的，所以这边不再写一遗（写两遗就是双份）。
export async function askUpstream(text, { streamId = String(Date.now()) } = {}) {
  const key = gatewayKey();
  if (!key) return { ok: false, error: '读不到 GATEWAY_API_KEY' };

  const body = {
    model: ROUTE,
    messages: buildMessages(text),
    stream: true,
  };

  emit({ type: 'typing', active: true });

  let res;
  try {
    res = await fetch(`${GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(300000),
    });
  } catch (err) {
    emit({ type: 'typing', active: false });
    console.error('chat: 连不上网关', err.message);
    return { ok: false, error: `连不上网关：${err.message}` };
  }

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    emit({ type: 'typing', active: false });
    console.error('chat: 网关返回', res.status, detail.slice(0, 300));
    return { ok: false, status: res.status, error: `上游 ${res.status}：${detail.slice(0, 200)}` };
  }

  // SSE：按行收，每行 data: {...}。最后一行可能是半条，留到下一块再拼。
  let acc = '';
  let buffer = '';
  const decoder = new TextDecoder();

  try {
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let delta;
        try {
          delta = JSON.parse(payload)?.choices?.[0]?.delta?.content;
        } catch {
          continue;
        }
        if (typeof delta !== 'string' || !delta) continue;
        acc += delta;
        emit({ type: 'reply_delta', stream_id: streamId, text: acc });
      }
    }
  } catch (err) {
    console.error('chat: 收到一半断了', err.message);
  }

  const final = acc.trim();
  emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: final });
  emit({ type: 'typing', active: false });

  if (!final) {
    // 网关那边会把「只有思考没有正文」当成断片记一笔，这边只用告诉调用方
    return { ok: false, error: '上游这轮没说出正文' };
  }
  return { ok: true, text: final };
}

// 把几句攒着的话合成一条递上去。
//
// 为何合成一条：她点「让他回复」的意思是「这几句一起读」，
// 一条一条递上去他会回好几次，而且前面几句的回复看不到后面几句。
// 每句前面标时间：她可能上午存一句、晚上才点，那两句不是同一时刻说的。
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
