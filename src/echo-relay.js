// 聊天真的通了：晨暮星这边代到 Tidal_Echo 的 relay。
//
// 小满 2026-10-30：「这里的功能不能和晨暮星整合吗 好麻烦好重复…」
//
// 所以不再开第二个聊天页。Tidal_Echo 里真正缺的是后端：relay（落库 + SSE
// 扇出）和 api_loop（允朔的身体、接 MCP、人格热加载）。那个 PWA 壳子不要了。
//
// ── 密钥为什么不进浏览器 ──
//
// Tidal_Echo 原来的壳子把 RELAY_SECRET 存在 localStorage 里，每个请求自己带。
// 晨暮星是服务端渲染、已经有 Basic Auth，所以这里反过来：
// 浏览器只打 /chat/api/*（走晨暮星自己的登录），服务端再带着 Bearer 转给 relay。
// 密钥留在服务器上，一个字也不发给前端。
//
// ── 三条 ──
//   GET  /chat/api/history?limit=  → relay /app/history
//   GET  /chat/api/stream (SSE)    → relay /app/stream
//   POST /chat/api/send            → relay /app/send
//
// 读不到 RELAY_SECRET 就整个不挂，/chat 页退回原来的样子（输入框发不出去）。
import fs from 'fs';
import { Readable } from 'stream';

const RELAY_URL = String(process.env.ECHO_RELAY_URL || 'http://127.0.0.1:3011').replace(/\/+$/, '');
const ENV_FILE = process.env.ECHO_RELAY_ENV || '/root/companion-relay/relay.env';

function readSecret() {
  const direct = String(process.env.ECHO_RELAY_SECRET || '').trim();
  if (direct) return direct;
  try {
    const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^RELAY_SECRET=(.*)$/m);
    const v = m ? m[1].trim() : '';
    return v || null;
  } catch {
    return null;
  }
}

export function registerEchoRelay(app, { requireBasicAuth }) {
  const secret = readSecret();
  if (!secret) {
    console.log('echo: 读不到 RELAY_SECRET（' + ENV_FILE + '），聊天没接上');
    return { enabled: false };
  }
  const auth = { Authorization: 'Bearer ' + secret };

  app.get('/chat/api/history', requireBasicAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    try {
      const r = await fetch(RELAY_URL + '/app/history?limit=' + limit, { headers: auth });
      const text = await r.text();
      res.status(r.status).set('content-type', 'application/json; charset=utf-8').send(text);
    } catch (err) {
      console.error('echo: 取历史失败', err.message);
      res.status(502).json({ error: 'relay unreachable' });
    }
  });

  app.post('/chat/api/send', requireBasicAuth, async (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    try {
      const r = await fetch(RELAY_URL + '/app/send', {
        method: 'POST',
        headers: { ...auth, 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const body = await r.text();
      res.status(r.status).set('content-type', 'application/json; charset=utf-8').send(body);
    } catch (err) {
      console.error('echo: 发消息失败', err.message);
      res.status(502).json({ error: 'relay unreachable' });
    }
  });

  // SSE：原样转发、不缓冲。浏览器那边断了要把上游也断掉，否则连接会一直攒着。
  app.get('/chat/api/stream', requireBasicAuth, async (req, res) => {
    let upstream;
    try {
      upstream = await fetch(RELAY_URL + '/app/stream', { headers: auth });
    } catch (err) {
      console.error('echo: SSE 连不上', err.message);
      return res.status(502).end();
    }
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
    res.status(200);
    res.set('content-type', 'text/event-stream; charset=utf-8');
    res.set('cache-control', 'no-cache, no-transform');
    res.set('connection', 'keep-alive');
    res.set('x-accel-buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();
    const body = Readable.fromWeb(upstream.body);
    body.on('error', () => res.end());
    body.pipe(res);
    req.on('close', () => body.destroy());
  });

  console.log('echo: 聊天接上 relay（' + RELAY_URL + '），密钥留在服务端');
  return { enabled: true };
}
