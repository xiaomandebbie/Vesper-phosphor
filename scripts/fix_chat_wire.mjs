#!/usr/bin/env node
// 修 chat_bubbles.mjs 留下的两个洞。
//
// 1. echo-relay.js:102 报 RELAY_URL is not defined——上一版那个 splice
//    把 const RELAY_URL 整段切掉了，但 SSE 路由里还留着一处在用它。
//    此刻 vesper 起不来，整个网页都打不开。
//    这次整个文件重写，不再做正则替换——文件就两百行，打补丁省的
//    那点事不值得再冒这个险。
//
// 2. gateway.js 的 injectPendingChat 用了 formatDateTime，而那个文件没 import
//    它。它在函数里，所以启动不炸——他下次唤醒读攒着的话那一轮才炸。
//    这种坑比立刻报错更难找，顺手补上。
//
// 重跑安全。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;

// ════ 1. echo-relay.js 整个重写 ════
const ECHO = `// 聊天真的通了：晨暮星这边代到 Tidal_Echo 的 relay。
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
} from './chat-queue.js';

export function registerEchoRelay(app, { requireBasicAuth }) {
  if (!relaySecret()) {
    console.log('echo: 读不到 RELAY_SECRET，聊天没接上');
    return { enabled: false };
  }

  app.get('/chat/api/history', requireBasicAuth, async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 60, 200);
    try {
      const r = await relayFetch('/app/history?limit=' + limit);
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
`;

const echoPath = resolve(root, 'src/echo-relay.js');
if (existsSync(echoPath) && readFileSync(echoPath, 'utf8') === ECHO) {
  console.log('· src/echo-relay.js：已经是这样了');
} else {
  writeFileSync(echoPath, ECHO, 'utf8');
  console.log('✓ src/echo-relay.js 重写完了（RELAY_URL 那个错没了）');
}

// ════ 2. gateway.js 补 formatDateTime ════
const gwPath = resolve(root, 'src/gateway.js');
if (!existsSync(gwPath)) {
  console.error('✗ src/gateway.js 不在');
  failed++;
} else {
  let t = readFileSync(gwPath, 'utf8');
  const before = t;

  if (!t.includes('injectPendingChat')) {
    console.log('· src/gateway.js：没有 injectPendingChat，先跑 chat_bubbles.mjs');
  } else if (/from '\.\/wall-time\.js'/.test(t)) {
    console.log('· src/gateway.js · formatDateTime：已经 import 了');
  } else {
    const anchor = "import { repairMessages } from './message-repair.js';";
    if (t.includes(anchor)) {
      t = t.replace(
        anchor,
        anchor + "\n// 攒着的话前面要标一个「MM-DD HH:mm」（见 injectPendingChat）。\n" +
          "// 这个 import 上一版漏了：它在函数里，启动不炸，他下次唤醒读攒着的话那一轮才炸。\n" +
          "import { formatDateTime } from './wall-time.js';"
      );
      console.log('✓ src/gateway.js · 补上 formatDateTime');
    } else {
      console.error('✗ src/gateway.js：找不到 message-repair 那行 import');
      failed++;
    }
  }

  if (t !== before) writeFileSync(gwPath, t, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper vesper-gateway --update-env');
  console.log('启动日志里应该有一行：echo: 聊天接上 relay（…），密钥留在服务端；发出去先攒着');
}
