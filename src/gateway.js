import 'dotenv/config';
import express from 'express';
import { Readable, Transform } from 'stream';
import { StringDecoder } from 'string_decoder';
import { addConversationMessage } from './state.js';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.GATEWAY_PORT || 3002;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

const routingTable = {
  'aru-chat': {
    source: 'aru',
    baseURL: process.env.ARU_UPSTREAM_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.ARU_UPSTREAM_API_KEY || process.env.DEEPSEEK_API_KEY,
    upstreamModel: process.env.ARU_UPSTREAM_MODEL || 'deepseek-flash',
  },
  'vesper-decide': {
    source: 'decide.js',
    baseURL: process.env.DECIDE_UPSTREAM_BASE_URL || 'https://api.deepseek.com',
    apiKey: process.env.DECIDE_UPSTREAM_API_KEY || process.env.DEEPSEEK_API_KEY,
    upstreamModel: process.env.DECIDE_UPSTREAM_MODEL || 'deepseek-flash',
  },
};

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

// Aru 会把 <environment> 环境块和 <sent_at> 时间戳拼进用户消息里。
// 这些是给对话侧看的上下文，不是小满本人说的话；原样记进 conversation_log 的话，
// decide.js 拿到的"最近对话"会全是环境噪音，真正说了什么反而被挤掉。
function stripInjectedBlocks(content) {
  return contentToText(content)
    .replace(/<environment>[\s\S]*?<\/environment>/g, '')
    .replace(/<sent_at[^>]*>/g, '')
    .trim();
}

// 只记 Aru 那条线路的对话，方向按上游协议来：
// messages 里 role=user 是小满说的，role=assistant 是允朔说的。
// assistant 那条不在这里记——由响应侧统一补，免得同一句话落两遍。
// 工具循环里最后一条是 role=tool，这里会直接跳过，不会把工具结果当成小满说的话。
function recordUserMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return;
  const cleaned = stripInjectedBlocks(last.content);
  if (!cleaned) return;
  try {
    addConversationMessage('小满', cleaned);
  } catch (err) {
    console.error('gateway: addConversationMessage(user) failed:', err.message);
  }
}

// 非流式响应最多缓存这么大，防止异常大的 body 撑爆内存
const MAX_RAW_BYTES = 2 * 1024 * 1024;

// 上游回的是 SSE，允朔说的话散在 delta 里。
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
      // 工具调用轮（Aru 让模型调工具时）本来就没有正文，是正常情况，不出声。
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

  const recordConversation = route.source === 'aru';
  if (recordConversation) recordUserMessage(req.body.messages);

  const upstreamBody = { ...req.body, model: route.upstreamModel };

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

    // 上游报错（非 2xx）时原样透传，不当成允朔的话记录
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
            addConversationMessage('允朔', trimmed);
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
