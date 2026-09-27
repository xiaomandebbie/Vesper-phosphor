import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';
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

  const upstreamBody = { ...req.body, model: route.upstreamModel };

  if (route.source === 'aru' && Array.isArray(req.body.messages) && req.body.messages.length) {
    const last = req.body.messages[req.body.messages.length - 1];
    if (last && typeof last.content === 'string' && (last.role === 'user' || last.role === 'assistant')) {
      try {
        addConversationMessage(last.role === 'user' ? '允朔' : 'AI', last.content);
      } catch (err) {
        console.error('gateway: addConversationMessage failed:', err.message);
      }
    }
  }

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

    if (upstreamRes.body) {
      Readable.fromWeb(upstreamRes.body).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`gateway: source=${route.source} model=${model} failed after ${ms}ms:`, err.message);
    res.status(502).json({ error: { message: 'upstream request failed', detail: err.message } });
  }
});

app.listen(PORT, () => console.log(`vesper-gateway listening on ${PORT}`));
