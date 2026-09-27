import 'dotenv/config';
import express from 'express';
import { Readable } from 'stream';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.GATEWAY_PORT || 3002;
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

// ---- 路由分流表 ----
// key 是客户端请求体里的 model 字段。以后加新的上游（自建 Ollama、Claude、别的 API），
// 只需要在这里加一条，Aru 和 decide.js 都不用改代码。
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

// 给 Aru "拉取模型" 那个按钮用的，OpenAI 兼容的模型列表接口。
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

    // 原样透传响应体——不管是普通 JSON 还是 stream:true 的 SSE，都不在这里解析，
    // 只做转发，这样 Aru 那边不管用什么模式请求都能正常工作。
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
