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
// 密钥留在服务器上，一个字也不发给前端。读密钥和打 relay 统一走
// chat-queue.js，这边不再自己留一份地址和密钥——上一版就是因为两边都有、
// 改一半漏了一半，vesper 直接起不来。
//
// ── 路由 ──
//   GET  /chat/api/history?limit=   → relay /app/history
//   GET  /chat/api/stream (SSE)     → relay /app/stream
//   POST /chat/api/send             → 落本地队列（不立刻惊动他）
//   POST /chat/api/flush            → 按顺序递给 relay（点「让他读」）
//   GET  /chat/api/pending          → 还攒着几条（刷页后要重新画出来）
//   POST /chat/api/pending/:id/drop → 收回还没递出去的那条
//
// 读不到 RELAY_SECRET 就整个不挂，/chat 页退回原来的样子（输入框发不出去）。
import { Readable } from 'stream';
import {
  relaySecret,
  relayBase,
  relayFetch,
  addPending,
  listPending,
  pendingCount,
  flushPending,
  dropPending,
  editPending,
} from './chat-queue.js';

export function registerEchoRelay(app, { requireBasicAuth }) {
  if (!relaySecret()) {
    console.log('echo: 读不到 RELAY_SECRET，聊天没接上');
    return { enabled: false };
  }

  // relay 的 /app/history?since=&limit= 是「从 since 往后取 limit 条」——
  // 从早往晚。传 limit=60 就是取最早的 60 条，消息一超过 60，
  // 新的全在窗口外——表现出来就是「我的消息被吞掉了」。
  // 所以这儿不带 limit，让它给全部，前端自己截最后几条。
  app.get('/chat/api/history', requireBasicAuth, async (req, res) => {
    try {
      const r = await relayFetch('/app/history');
      const text = await r.text();
      res.status(r.status).set('content-type', 'application/json; charset=utf-8').send(text);
    } catch (err) {
      console.error('echo: 取历史失败', err.message);
      res.status(502).json({ error: 'relay unreachable' });
    }
  });

  // 发出去的话先落本地队列，不立刻惊动他（见 chat-queue.js）。
  // 小满要的是「可以逐条发，发完再点一次让允朔读；也可以不点，等他下次醒来读」。
  app.post('/chat/api/send', requireBasicAuth, (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const wid = Number(req.body?.window_id);
    try {
      const id = addPending(text, Number.isInteger(wid) ? wid : null);
      return res.json({ id, pending: pendingCount() });
    } catch (err) {
      console.error('echo: 存不下这条话', err.message);
      return res.status(500).json({ error: 'queue failed' });
    }
  });

  // 点「让他读」：按顺序递给 relay，他当场回。
  app.post('/chat/api/flush', requireBasicAuth, async (req, res) => {
    try {
      res.json(await flushPending());
    } catch (err) {
      console.error('echo: 递攒着的话失败', err.message);
      res.status(502).json({ error: err.message });
    }
  });

  app.get('/chat/api/pending', requireBasicAuth, (req, res) => {
    res.json({ pending: listPending() });
  });

  // 攒着的还能改正文。已经递出去的改不了——chat-queue 那边带了 sent = 0。
  app.post('/chat/api/pending/:id/edit', requireBasicAuth, (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const ok = editPending(Number(req.params.id), text);
    res.json({ edited: ok });
  });

  app.post('/chat/api/pending/:id/drop', requireBasicAuth, (req, res) => {
    res.json({ dropped: dropPending(Number(req.params.id)), pending: pendingCount() });
  });

  // SSE：原样转发、不缓冲。浏览器那边断了要把上游也断掉，否则连接会一直攒着。
  app.get('/chat/api/stream', requireBasicAuth, async (req, res) => {
    let upstream;
    try {
      upstream = await relayFetch('/app/stream');
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

  console.log('echo: 聊天接上 relay（' + relayBase() + '），密钥留在服务端；发出去先攒着');
  return { enabled: true };
}
