// 聊天的后端：现在是晨暮星自己。
//
// 小满 2026-11-05：「把 relay 什么的去掉，不用人家那一套了」
// 「我可以把这个线路直接接到聊天模型吗 之前的聊天其他全部不要，
// 只要他们共用上游」
//
// ── 换成了什么 ──
//
// 以前：浏览器 → 晨暮星 → Tidal_Echo 的 relay → api_loop（他的身体在那边）
// 现在：浏览器 → 晨暮星 → 自己的网关 aru-chat 线路 → 供应商
//
// 所以网页聊天和 Aru 里那个 aru-chat 走的是同一条线路：她在
// 「模型 · 连接 · 通知」里改「聊天」那一组，两边一起换。
// 回话怎么问上游见 chat-bus.js。
//
// ── 历史从哪里来 ──
//
// 不再问别人的库，读 conversation_log——网关每轮追写的那本账。
// Aru 里说的话和网页上说的话都在里面，所以两边看到的是同一段关系。
// 这也是她要的「让他们读取的上下文一样」。
//
// 前端一个字没改：路由名、返回形状、SSE 帧的字段名全沿用原来那套
// （chat-page.js 的 onFrame 认 reply_delta / typing，msgTs 认 ts）。
//
// ── 路由 ──
//   GET  /chat/api/history         ← conversation_log
//   GET  /chat/api/stream (SSE)    ← 本进程自己推
//   POST /chat/api/send            → 落本地队列（不立刻惊动他）
//   POST /chat/api/flush           → 合成一条递给网关（点「让他读」）
//   GET  /chat/api/pending         → 还攒着几条
//   POST /chat/api/pending/:id/edit | drop
//
// 读不到 GATEWAY_API_KEY 就整个不挂，/chat 页退回原来的样子（输入框发不出去）。
// 不装作能用：那把 key 就在本机 .env 里，和网关读的是同一个。
import { getRecentConversation } from './state.js';
import {
  gatewayKey,
  addClient,
  clientCount,
  askUpstream,
  emit,
} from './chat-bus.js';
import {
  addPending,
  listPending,
  pendingCount,
  flushPending,
  dropPending,
  editPending,
} from './chat-queue.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';

// 往回给前端多少条。前端自己只画最后 80 条，
// 但 seen 要标全部，所以这边给得比 80 多。
const HISTORY_LIMIT = 200;

// conversation_log 的一行 → 前端认的消息形状。
//
// from: 'human' 是她说的，其余算他说的（见 chat-page.js 的 paint）。
// id 只用于前端去重，所以用 ts 加下标拼一个稳定的——
// 不依赖 conversation_log 有没有自增主键，那个我没核过。
function toMessage(row, i) {
  const content = String(row.content ?? '').trim();
  return {
    id: `log-${row.ts}-${i}`,
    from: row.speaker === USER_NAME ? 'human' : 'ai',
    text: content,
    ts: row.ts,
    kind: 'reply',
  };
}

export function registerEchoRelay(app, { requireBasicAuth }) {
  if (!gatewayKey()) {
    console.log('chat: 读不到 GATEWAY_API_KEY，聊天没接上');
    return { enabled: false };
  }

  // 历史：从早到晚，和前端的期待一致（它自己截最后几条）。
  app.get('/chat/api/history', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      const rows = getRecentConversation(HISTORY_LIMIT);
      const messages = rows.map(toMessage).filter((m) => m.text);
      res.json({ messages });
    } catch (err) {
      console.error('chat: 取历史失败', err.message);
      res.status(500).json({ error: 'history failed' });
    }
  });

  // 发出去的话先落本地队列，不立刻惊动他（见 chat-queue.js）。
  // 小满要的是「可以逐条发，发完再点一次让允朔读；也可以不点，
  // 等他下次醒来读」。
  app.post('/chat/api/send', requireBasicAuth, (req, res) => {
    const text = String(req.body?.text ?? '').trim();
    if (!text) return res.status(400).json({ error: 'text required' });
    const wid = Number(req.body?.window_id);
    try {
      const id = addPending(text, Number.isInteger(wid) ? wid : null);
      return res.json({ id, pending: pendingCount() });
    } catch (err) {
      console.error('chat: 存不下这条话', err.message);
      return res.status(500).json({ error: 'queue failed' });
    }
  });

  // 点「让他读」：合成一条递给网关，他当场回。
  // 正文通过 SSE 边生边推（chat-bus 那边 emit），所以这里只回计数。
  app.post('/chat/api/flush', requireBasicAuth, async (req, res) => {
    try {
      const r = await flushPending();
      // reply 不必回给前端：它已经从 SSE 收到了，再给一份会画两遍
      const { reply, ...rest } = r;
      res.json(rest);
    } catch (err) {
      console.error('chat: 递攒着的话失败', err.message);
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

  // SSE：以前是转发 relay 的流，现在回话就在本进程里，自己推。
  //
  // 注意正文落库不靠这条连接：那是网关干的。所以没人开着页面也不丢话，
  // 多个标签页同时开着就都收得到。
  app.get('/chat/api/stream', requireBasicAuth, (req, res) => {
    res.status(200);
    res.set('content-type', 'text/event-stream; charset=utf-8');
    res.set('cache-control', 'no-cache, no-transform');
    res.set('connection', 'keep-alive');
    res.set('x-accel-buffering', 'no');
    if (res.flushHeaders) res.flushHeaders();

    // 先发一帧，打通代理和浏览器之间的缓冲
    res.write('data: {"type":"ping"}\n\n');

    const remove = addClient(res);

    // 间歇心跳：不发的话 nginx 默认 60 秒就把这条连接切了
    const beat = setInterval(() => {
      try {
        res.write('data: {"type":"ping"}\n\n');
      } catch {
        clearInterval(beat);
        remove();
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(beat);
      remove();
    });
  });

  console.log('chat: 接自己的网关（线路 ' + (process.env.CHAT_ROUTE_NAME || 'aru-chat') + '），发出去先攒着');
  return { enabled: true, clients: clientCount };
}

// 唤醒时回一句。这条会出现在网页聊天里，和他当场回的那种一模一样。
//
// 小满 10-30：「唤醒是晨暮星吧，应该改法和动态我的留言一样」。
// 以前走 relay 的 /channel/out，现在直接推给打开着的页面。
//
// 注意：这句话是 phosphor 自己想好的（他做决定那一轮的输出），
// 不再经过一次模型，所以不走 askUpstream。它已经被 decide 那边记过库了。
export async function replyToChat(text) {
  const t = String(text ?? '').trim();
  if (!t) return { ok: false, status: 0, body: 'empty' };
  try {
    const streamId = `wake-${Date.now()}`;
    emit({ type: 'reply_delta', stream_id: streamId, text: t });
    emit({ type: 'reply_delta', stream_id: streamId, done: true, final_text: t });
    return { ok: true, status: 200, body: 'pushed' };
  } catch (err) {
    return { ok: false, status: 0, body: err.message };
  }
}

export { askUpstream };
