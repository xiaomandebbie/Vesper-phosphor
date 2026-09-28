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

// 只记 Aru 那条线路的对话，方向按上游协议来：
// messages 里 role=user 是小满说的，role=assistant 是允朔说的。
// assistant 那条不在这里记——由响应侧统一补，免得同一句话落两遍。
function recordUserMessage(messages) {
  if (!Array.isArray(messages) || !messages.length) return;
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'user') return;
  if (typeof last.content !== 'string' || !last.content.trim()) return;
  try {
    addConversationMessage('小满', last.content);
  } catch (err) {
    console.error('gateway: addConversationMessage(user) failed:', err.message);
  }
}

// 上游回的是 SSE，允朔说的话散在 delta 里。
// 这个 Transform 一边把数据放行给前端，一边把文本捞出来，流结束时交回去。
function makeAssistantCapture(onComplete) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  let text = '';

  const feedLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let parsed;
    try {
      parsed = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = parsed?.choices?.[0]?.delta?.content;
    if (typeof delta === 'string') text += delta;
  };

  return new Transform({
    transform(chunk, enc, cb) {
      buffer += decoder.write(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) feedLine(line);
      cb(null, chunk);
    },
    flush(cb) {
      buffer += decoder.end();
      if (buffer) feedLine(buffer);
      // 万一上游不是流式，整段就是一个 JSON
      if (!text) {
        try {
          const parsed = JSON.parse(buffer || '{}');
          const content = parsed?.choices?.[0]?.message?.content;
          if (typeof content === 'string') text = content;
        } catch {
          // 不是 JSON 就算了，不记
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

    if (!recordConversation) {
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
