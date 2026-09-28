import 'dotenv/config';
import express from 'express';
import { Readable, Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { addConversationMessage } from './state.js';
import { getSharedContext, formatContextText } from './context.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.GATEWAY_PORT || 3002;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

// 记录对话时用的两个称呼。默认是中性的，
// 想显示成自己的叫法，在 .env 里设 USER_DISPLAY_NAME / AI_DISPLAY_NAME。
const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';

const decideUpstream = {
  baseURL: process.env.DECIDE_UPSTREAM_BASE_URL || 'https://api.deepseek.com',
  apiKey: process.env.DECIDE_UPSTREAM_API_KEY || process.env.DEEPSEEK_API_KEY,
  upstreamModel: process.env.DECIDE_UPSTREAM_MODEL || 'deepseek-flash',
};

const clientUpstream = {
  source: 'client',
  baseURL:
    process.env.CLIENT_UPSTREAM_BASE_URL || process.env.ARU_UPSTREAM_BASE_URL || 'https://api.deepseek.com',
  apiKey:
    process.env.CLIENT_UPSTREAM_API_KEY || process.env.ARU_UPSTREAM_API_KEY || process.env.DEEPSEEK_API_KEY,
  upstreamModel: process.env.CLIENT_UPSTREAM_MODEL || process.env.ARU_UPSTREAM_MODEL || 'deepseek-flash',
};

const routingTable = {
  // 聊天前端走这条，对话会被记录
  chat: clientUpstream,
  vesper-decide: { source: 'decide.js', ...decideUpstream },
  // 另一个唤醒项目（heartbeat）自己醒来时用这条（它的 .env 里 MODEL_NAME=heartbeat-wake）。
  // 上游和 vesper-decide 一样，区别是会把请求里的"最近记录"换成跨窗口的共享上下文，
  // 这样两边看到的是同一份，换了聊天窗口也不会丢。
  'heartbeat-wake': { source: 'heartbeat', injectSharedContext: true, ...decideUpstream },
};

// 旧名字兼容：以前这个路由叫 aru-chat。已经配好的客户端不用改。
routingTable['aru-chat'] = clientUpstream;

function requireGatewayAuth(req, res, next) {
  const auth = req.headers['authorization'];
  const key = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!GATEWAY_API_KEY || key !== GATEWAY_API_KEY) {
    return res.status(401).json({ error: { message: 'invalid api key' } });
  }
  next();
}

// OpenAI 格式里 content 有两种写法：纯字符串，或者带图片时的数组
// [{type:'text', text:'...'}, {type:'image_url', ...}]。数组只取文字部分。
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

// 聊天前端会把 <environment> 环境块和 <sent_at> 时间戳拼进用户消息里。
// 这些是给对话侧看的上下文，不是对方本人说的话；原样记进 conversation_log 的话，
// decide.js 拿到的"最近对话"会全是环境噪音，真正说了什么反而被挤掉。
function stripInjectedBlocks(content) {
  return contentToText(content)
    .replace(/<environment>[\s\S]*?<\/environment>/g, '')
    .replace(/<sent_at[^>]*>/g, '')
    .trim();
}

// 只记聊天那条线路的对话，方向按上游协议来：
// messages 里 role=user 是对方说的，role=assistant 是这一侧说的。
// assistant 那条不在这里记——由响应侧统一补，免得同一句话落两遍。
// 工具循环里最后一条是 role=tool，这里会直接跳过，不会把工具结果当成对方说的话。
function recordUserMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return;
  const cleaned = stripInjectedBlocks(last.content);
  if (!cleaned) return;
  try {
    addConversationMessage(USER_NAME, cleaned);
  } catch (err) {
    console.error('gateway: addConversationMessage(user) failed:', err.message);
  }
}

// heartbeat 醒来时发的 user 消息里有一段"最近记录："，后面是它从自己时间线文件里拼的聊天。
// 那个文件只有当前窗口的内容，换窗口就丢。这里把标记后面的内容换成跨窗口的共享上下文，
// 和 phosphor 做决定时读的是同一份。找不到标记或共享上下文是空的，就原样转发。
const HISTORY_MARKER = '最近记录：';
const HEARTBEAT_CONTEXT_LIMIT = Number(process.env.HEARTBEAT_CONTEXT_LIMIT) || 30;

function injectSharedContext(messages) {
  if (!Array.isArray(messages)) return messages;
  let entries;
  try {
    entries = getSharedContext(HEARTBEAT_CONTEXT_LIMIT);
  } catch (err) {
    console.error('gateway: 读取共享上下文失败，原样转发:', err.message);
    return messages;
  }
  if (!entries.length) {
    console.warn('gateway: heartbeat-wake 共享上下文是空的，原样转发');
    return messages;
  }
  const text = formatContextText(entries);
  let replaced = false;
  const out = messages.map((m) => {
    if (replaced || m.role !== 'user' || typeof m.content !== 'string') return m;
    const idx = m.content.indexOf(HISTORY_MARKER);
    if (idx === -1) return m;
    replaced = true;
    return {
      ...m,
      content:
        `${m.content.slice(0, idx + HISTORY_MARKER.length)}\n\n` +
        `（以下是所有聊天窗口里最近的记录，以及自动唤醒事件，按时间先后排列）\n\n${text}`,
    };
  });
  if (replaced) {
    console.log(`gateway: heartbeat-wake 已注入共享上下文 ${entries.length} 条`);
  } else {
    console.warn('gateway: heartbeat-wake 没找到"最近记录："，原样转发');
  }
  return out;
}

// 非流式响应最多缓存这么大，防止异常大的 body 撑爆内存
const MAX_RAW_BYTES = 2 * 1024 * 1024;

// 上游回的是 SSE，回复文本散在 delta 里。
// 这个 Transform 一边把数据放行给前端，一边把文本捞出来，流结束时交回去。
function makeAssistantCapture(onComplete) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let text = '';
  let raw = ''; // 非流式时的完整 body
  let sawSSE = false;
  let sawToolCalls = false;
  let sawReasoning = false;

  const inspectMessage = (m) => {
    if (!m) return;
    if (typeof m.content === 'string') text += m.content;
    if (Array.isArray(m.tool_calls) && m.tool_calls.length) sawToolCalls = true;
    if (m.reasoning_content) sawReasoning = true;
  };

  const feedLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    sawSSE = true;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    inspectMessage(parsed?.choices?.[0]?.delta);
  };

  return new Transform({
    transform(chunk, enc, cb) {
      const str = decoder.write(chunk);
      if (!sawSSE && raw.length < MAX_RAW_BYTES) raw += str;
      buffer += str;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) feedLine(line);
      cb(null, chunk);
    },
    flush(cb) {
      const rest = decoder.end();
      if (!sawSSE && raw.length < MAX_RAW_BYTES) raw += rest;
      buffer += rest;
      if (buffer) feedLine(buffer);

      // 不是流式：整段 body 就是一个 JSON（可能跨多行，所以用 raw 而不是最后一行）
      if (!sawSSE) {
        try {
          inspectMessage(JSON.parse(raw || '{}')?.choices?.[0]?.message);
        } catch {
          // 不是 JSON 就算了，不记
        }
      }

      // 没捞到正文时区分原因。
      // 工具调用轮本来就没有正文，是正常情况，不出声。
      if (!text.trim() && !sawToolCalls) {
        if (sawReasoning) {
          console.warn('gateway: assistant reply had reasoning but no content — nothing to record');
        } else {
          console.warn('gateway: assistant capture got empty text — upstream may not be standard SSE');
        }
      }
      onComplete(text);
      cb();
    },
  });
}

app.get('/v1/models', requireGatewayAuth, (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(routingTable).map((id) => ({
      id,
      object: 'model',
      owned_by: 'vesper-gateway',
    })),
  });
});

app.post('/v1/chat/completions', requireGatewayAuth, async (req, res) => {
  const start = Date.now();
  const { model } = req.body;
  const route = routingTable[model];

  if (!route) {
    console.error(`gateway: unknown model "${model}", not in routing table`);
    return res.status(400).json({ error: { message: `Unknown model "${model}"` } });
  }

  const recordConversation = route.source === 'client';
  if (recordConversation) recordUserMessage(req.body.messages);

  const messages = route.injectSharedContext
    ? injectSharedContext(req.body.messages)
    : req.body.messages;
  const upstreamBody = { ...req.body, messages, model: route.upstreamModel };

  try {
    const upstreamRes = await fetch(`${route.baseURL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${route.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(upstreamBody),
    });

    const ms = Date.now() - start;
    console.log(
      `gateway: source=${route.source} model=${model}->${route.upstreamModel} target=${route.baseURL} status=${upstreamRes.status} ${ms}ms`
    );

    res.status(upstreamRes.status);
    const contentType = upstreamRes.headers.get('content-type');
    if (contentType) res.setHeader('content-type', contentType);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    const source = Readable.fromWeb(upstreamRes.body);

    // 上游报错（非 2xx）时原样透传，不当成正常回复记录
    if (!recordConversation || !upstreamRes.ok) {
      source.pipe(res);
      return;
    }

    source
      .pipe(
        makeAssistantCapture((text) => {
          const trimmed = text.trim();
          if (!trimmed) return;
          try {
            addConversationMessage(AI_NAME, trimmed);
          } catch (err) {
            console.error('gateway: addConversationMessage(assistant) failed:', err.message);
          }
        })
      )
      .pipe(res);
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`gateway: source=${route.source} model=${model} failed after ${ms}ms:`, err.message);
    res.status(502).json({ error: { message: 'upstream request failed', detail: err.message } });
  }
});

app.listen(PORT, () => console.log(`vesper-gateway listening on ${PORT}`));
