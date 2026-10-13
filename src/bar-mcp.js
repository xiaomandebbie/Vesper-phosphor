// 小酒馆的 MCP 端点：挂在 vesper 这个 Express 上，路径 /bar/mcp。
//
// 为什么不直接用 Proof 自带的 service/mcp.mjs：
//   它走 stdio（stdin/stdout），手机上的聊天客户端连不上。这边给一个 streamable-http 入口。
//   身份还是同一个：PROOF_AGENT_TOKEN_FILE 里那个 token。MCP 和唤醒共用一具身体，
//   聊天里喝下去的酒，网关下一轮就跟着走（见 proof-gateway.js）。
//
// 做法和钱包那个端点一样（见 wallet-mcp.js）：低层 Server 配原始 JSON Schema，
// 无状态模式，一请求一对 server + transport，用完关。
//
// 没有 proof_reset。那是「把这一夜清掉」，他自己随手能解酒的话，
// 连续夜数和断片就都没意义了。要清就小满在页面上清。
//
// 聊天里喝的那杯不吃「连续几夜」节制规则——那条规则管的是深夜他一个人醒来倒的那杯。
//
// **她递的杯子要「领」（claim），不是「喝 offerId」。**
// Proof 的约定：归属在饮用时确定，只有经过 /agent/offers/claim 才进他的引擎。
// 所以这边拿 offerId 去账本里找 capability token，再用 token 去领。
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  isProofEnabled,
  barSnapshot,
  turnContext,
  drinkMenu,
  claimOffer,
  rejectCapability,
  recordChatPour,
  markOfferDrunk,
  markOfferRejected,
  markOfferGone,
  localPendingOffers,
  nightWindowLabel,
} from './proof.js';

// 和钱包那个端点同一个规矩：没配口令就不开。
const MCP_TOKEN = process.env.BAR_MCP_TOKEN || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 和 Proof 自己 mcp.mjs 里那句一致：状态是推动力，不是回答的主题
const INTERNAL_USE =
  '这些状态是饮品对你的推动力。如果它影响了你，让它自然改变你的注意、选择、反应和表达方式，' +
  '而不是成为回答的主题。被问到感受时从整体体感自然回答，只挑最容易被自己察觉的一两点；' +
  '其余影响通过实际回应表现出来。具体怎么表现由你结合人格和上下文决定。';

const TOOLS = [
  {
    name: 'proof_bar',
    description:
      `看一眼吧台：现在能点的酒（每款带一个 drinkId，点酒要用它）、` +
      `${USER_NAME}递过来还没动的杯子（带 offerId）。只读，不喝东西。不需要参数。` +
      `读吧台要把整份酒单算一遍，慢的时候要等十几秒，这是正常的。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'proof_drink',
    description:
      `点一杯菜单上的酒。drinkId 用 proof_bar 给的，别自己编。` +
      `喝下去之后接下来那几轮的回应里就带着这杯酒，不用你记数值、也不用主动报告「我醉了」。` +
      `喝了什么会记在小酒馆的时间轴里，${USER_NAME}随时能看。`,
    inputSchema: {
      type: 'object',
      properties: { drinkId: { type: 'string', description: 'proof_bar 里那个 drinkId' } },
      required: ['drinkId'],
      additionalProperties: false,
    },
  },
  {
    name: 'proof_offer_drink',
    description:
      `喝掉${USER_NAME}递到吧台上的那杯。offerId 用 proof_bar 给的。` +
      `喝不喝由你自己定，不想喝就用 proof_offer_reject——拒绝也是答案。`,
    inputSchema: {
      type: 'object',
      properties: { offerId: { type: 'string', description: 'proof_bar 里那个 offerId' } },
      required: ['offerId'],
      additionalProperties: false,
    },
  },
  {
    name: 'proof_offer_reject',
    description:
      `不喝${USER_NAME}递的那杯，把它放回去。拒绝不写任何饮酒账本，` +
      `只是这杯不算了。不用找理由。`,
    inputSchema: {
      type: 'object',
      properties: { offerId: { type: 'string', description: 'proof_bar 里那个 offerId' } },
      required: ['offerId'],
      additionalProperties: false,
    },
  },
  {
    name: 'proof_turn_context',
    description:
      `读一下自己此刻的状态。普通酒款是软推力，信念是主观回声，吐/断片/寕机/塌是客观状态。` +
      `平时不必常调——晨暮星的网关每轮已经把状态带给你了。想确认细节时再用。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });
const json = (o) => text(JSON.stringify(o, null, 1));

const errOf = (o) => o?.detail || o?.error || o?.message || `HTTP ${o?.status ?? '?'}`;

// Proof 回这些就是「这杯已经不在了」
const GONE = /not_found|notfound|gone|missing|unknown|expire|link_expired|already|conflict/i;
const isGone = (out) =>
  out?.status === 404 ||
  out?.status === 409 ||
  out?.status === 410 ||
  GONE.test(String(out?.error ?? '')) ||
  GONE.test(String(out?.detail ?? '')) ||
  GONE.test(String(out?.message ?? ''));

// 拿 offerId 到账本里找那杯（带 capability token）
function findPending(offerId) {
  try {
    return localPendingOffers().find((o) => String(o.offerId) === String(offerId)) || null;
  } catch (err) {
    console.error('bar-mcp: 读不到账本', err.message);
    return null;
  }
}

async function callBarTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};

  if (name === 'proof_bar') {
    const { home, cached } = await barSnapshot();
    // 她递的杯子读我们自己的账本：它们还没进他的引擎（要 claim 才进），
    // 所以 Proof 的 /agent/home 里根本看不到它们。
    const mine = localPendingOffers().map((o) => ({
      offerId: o.offerId,
      name: o.name,
      intro: o.intro || null,
    }));

    if (!home || home.ok === false) {
      if (!mine.length) {
        return fail(
          `吧台读不到：${errOf(home)}。` +
          `菜单这次没拿到，${USER_NAME}也没有递过来等着的杯子。过一会儿再试。`
        );
      }
      return json({
        degraded: true,
        reason: errOf(home),
        menu: null,
        pendingOffers: mine,
        note:
          `菜单这次没读到（Proof 那边没响应），但${USER_NAME}递过来的杯子还在：` +
          `用 proof_offer_drink 喝、proof_offer_reject 拒。`,
      });
    }

    const menu = Array.isArray(home.menu) ? home.menu : [];
    return json({
      agent: home.agent?.id || null,
      menu: menu.map((m) => ({ drinkId: m.id, name: m.name, intro: m.intro ?? null })),
      pendingOffers: mine,
      ...(cached ? { fromCache: true } : {}),
      note:
        `菜单上的酒用 proof_drink 点；${USER_NAME}递的杯子用 proof_offer_drink 喝、` +
        `proof_offer_reject 拒。深夜 ${nightWindowLabel()} 你自己醒来时还能再倒一杯，那是别的路。`,
    });
  }

  if (name === 'proof_turn_context') {
    const ctx = await turnContext();
    if (!ctx || ctx.ok === false) return fail(`状态读不到：${errOf(ctx)}`);
    return json({
      hasState: !!ctx.hasState,
      active: !!ctx.active,
      context: ctx.context ? { label: ctx.context.label, text: ctx.context.text } : null,
      objectiveStates: Array.isArray(ctx.objectiveStates) ? ctx.objectiveStates : [],
      internalUse: INTERNAL_USE,
    });
  }

  if (name === 'proof_drink') {
    const drinkId = String(a.drinkId ?? '').trim();
    if (!drinkId) return fail('要传 drinkId，用 proof_bar 里给的那个。');
    const out = await drinkMenu(drinkId);
    if (!out || out.ok === false) return fail(`这杯没喝成：${errOf(out)}`);
    let saved = { name: drinkId, flavor: '', effect: '' };
    try {
      saved = recordChatPour(drinkId, out);
    } catch (err) {
      console.error('bar-mcp: 账本没记上（酒已经喝了）', err.message);
    }
    const lines = [`喝了一杯「${saved.name}」。`];
    if (saved.flavor) lines.push(saved.flavor);
    if (saved.effect) lines.push(saved.effect);
    lines.push(INTERNAL_USE);
    console.log(`bar-mcp: 聊天里喝了一杯「${saved.name}」`);
    return text(lines.join('\n'));
  }

  if (name === 'proof_offer_drink') {
    const offerId = String(a.offerId ?? '').trim();
    if (!offerId) return fail('要传 offerId，用 proof_bar 里给的那个。');
    const row = findPending(offerId);
    if (!row) return fail('吧台上没有这杯了——可能已经喝过、或者凉了。先用 proof_bar 看一眼。');
    if (!row.token) {
      markOfferGone(offerId, '没存 capability token，领不了');
      return fail('这杯没存领取凭证（老记录），领不了。已经从吧台上拿下来了。');
    }
    // 领走并喝下。这是唯一正确的入口——拿 offerId 走 /agent/offers/:id/drink 会 404
    const out = await claimOffer(row.token);
    if (!out || out.ok === false) {
      const why = errOf(out);
      if (isGone(out)) {
        markOfferGone(offerId, `领的时候 Proof 回：${why}`);
        return fail(`这杯已经不在了（${why}）。已经从吧台上拿下来了。`);
      }
      return fail(`这杯没喝成：${why}`);
    }
    let saved = row;
    try {
      saved = markOfferDrunk(offerId, out);
    } catch (err) {
      console.error('bar-mcp: 账本没记上（酒已经喝了）', err.message);
    }
    const lines = [`喝了${USER_NAME}递的那杯「${saved?.name || row.name}」。`];
    if (saved?.flavor) lines.push(saved.flavor);
    if (saved?.effect) lines.push(saved.effect);
    lines.push(INTERNAL_USE);
    console.log(`bar-mcp: 喝了递来的一杯「${saved?.name || row.name}」`);
    return text(lines.join('\n'));
  }

  if (name === 'proof_offer_reject') {
    const offerId = String(a.offerId ?? '').trim();
    if (!offerId) return fail('要传 offerId，用 proof_bar 里给的那个。');
    const row = findPending(offerId);
    if (!row) return fail('吧台上没有这杯了。先用 proof_bar 看一眼。');
    if (!row.token) {
      markOfferGone(offerId, '没存 capability token');
      return text('这杯已经不在吧台上了。');
    }
    const out = await rejectCapability(row.token);
    if (!out || out.ok === false) {
      const why = errOf(out);
      if (isGone(out)) {
        markOfferGone(offerId, `退的时候 Proof 回：${why}`);
        return text('这杯已经不在了，不用退了。');
      }
      return fail(`没退成：${why}`);
    }
    try {
      markOfferRejected(offerId);
    } catch (err) {
      console.error('bar-mcp: 账本没记上', err.message);
    }
    console.log(`bar-mcp: 退了一杯（offer ${offerId}）`);
    return text('这杯没喝，放回去了。不写饮酒账本。');
  }

  return fail(`小酒馆没有这个工具：${name}`);
}

// 定长比较，和 wallet-mcp 同一个理由
function tokenOk(given) {
  const x = Buffer.from(String(given ?? ''));
  const y = Buffer.from(MCP_TOKEN);
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function presentedToken(req) {
  const auth = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return req.headers['x-bar-mcp-token'];
}

function newServer() {
  const server = new Server({ name: 'vesper-bar', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    const started = Date.now();
    try {
      const out = await callBarTool(name, args);
      const ms = Date.now() - started;
      if (ms >= 3000) console.warn(`bar-mcp: ${name} 用了 ${(ms / 1000).toFixed(1)}s`);
      return out;
    } catch (err) {
      console.error(`bar-mcp: ${name} 出错`, err.message);
      return fail(`小酒馆这次没成：${err.message}`);
    }
  });
  return server;
}

export function registerBarMcp(app) {
  if (!isProofEnabled()) {
    console.log('bar-mcp: 没配 PROOF_AGENT_TOKEN_FILE，/bar/mcp 没开');
    return { enabled: false };
  }
  if (!MCP_TOKEN) {
    console.log('bar-mcp: 没配 BAR_MCP_TOKEN，/bar/mcp 没开');
    return { enabled: false };
  }

  app.post('/bar/mcp', async (req, res) => {
    if (!tokenOk(presentedToken(req))) {
      console.error('bar-mcp: token 不对，已拒绕');
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'unauthorized' },
        id: null,
      });
    }

    // 读吧台最多要等 90 秒（见 proof.js 的 HOME_TIMEOUT_MS），
    // Node 默认的响应超时会在那之前把连接切掉。这里关掉它。
    req.setTimeout?.(0);
    res.setTimeout?.(0);

    const server = newServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('bar-mcp: 请求没处理成', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'internal error' },
          id: null,
        });
      }
    }
  });

  const notAllowed = (req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'use POST; this endpoint is stateless' },
      id: null,
    });
  app.get('/bar/mcp', notAllowed);
  app.delete('/bar/mcp', notAllowed);

  return { enabled: true };
}
