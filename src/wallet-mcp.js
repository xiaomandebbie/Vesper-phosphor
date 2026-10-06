// 钱包的 MCP 端点：挂在 vesper 这个 Express 上，路径 /wallet/mcp。
//
// 为什么不单起一个进程：账在 data/state.db 里，那库已经被三个进程共用。
// 再起一个就是第四个连接，而 vesper 本来就是 Express——挂上去最省。
//
// SDK 用低层的 Server 配原始 JSON Schema，不走 McpServer.tool()：
// 后者要 zod，而 zod 只是 @modelcontextprotocol/sdk 的间接依赖，没在 package.json 里声明。
// 从 types.js 导的那两个 Schema 是现成对象，只传不构造，不算直接用 zod。
//
// 无状态模式：每个请求新建一对 Server + Transport，用完就关。
// 好处是不用管 session——这个端点每次就是读几行账、写一句批注，没有跟踪上下文的必要。
// vesper.js 里 express.json() 已经把 body 解好了，所以往 handleRequest 传第三个参数。
//
// 没有 wallet_earn。进账是她验收工单才打的钱，不该让他自己给自己发工资；
// adjust 同理——谁都能改账本的话，对账就没意义了。这两个留在 HTTP 接口上，要 x-api-key。

import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  addNote,
  describeBalance,
  describeLedger,
  describeNotes,
  getEntry,
  listNotesFor,
  yuan,
  WAKE_LEDGER_LIMIT,
  MAX_NOTE_CHARS,
} from './wallet.js';
import { formatDateTime } from './wall-time.js';

// 这个端点能读账、能往账本里写批注，所以和 spend-notify 同一个规矩：
// 没配口令就不开，直接 503。
const MCP_TOKEN = process.env.WALLET_MCP_TOKEN || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 通过 MCP 写的批注算谁的。这是他的手，所以默认 assistant；
// 想让它算你写的，.env 里填 WALLET_MCP_SIGN_AS=user
const SIGN_AS = process.env.WALLET_MCP_SIGN_AS === 'user' ? 'user' : 'assistant';

const TOOLS = [
  {
    name: 'wallet_balance',
    description:
      `打开${AI_NAME}的小钱包：现在有多少钱、进账过多少花了多少、` +
      `银行报的卡里可用余额跟账本对不对得上。不需要参数。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'wallet_ledger',
    description:
      `翻账本。不填参数是最近 ${WAKE_LEDGER_LIMIT} 笔；填 date 看那一天的；` +
      `notes 填 true 看最近写过的批注（连着它记的那几笔账）。` +
      `每笔前面那个 #号就是写批注要用的 entry_id。`,
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '哪一天，写成 2026-10-06 这样。省略就是最近几笔' },
        notes: { type: 'boolean', description: 'true = 看最近的批注，而不是流水' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: '最近几笔的条数，默认 10' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wallet_note',
    description:
      `给账本里某一笔记一句批注（${MAX_NOTE_CHARS} 字以内）。` +
      `entry_id 用翻账本时每笔前面那个 #号，别自己编——编了不存在的号会被拒。` +
      `批注是两个人的，网页上写的和这边写的进同一张表。`,
    inputSchema: {
      type: 'object',
      properties: {
        entry_id: { type: 'integer', description: '那笔账的编号' },
        note: { type: 'string', description: '要记的那句话' },
      },
      required: ['entry_id', 'note'],
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });

function callWalletTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};

  switch (name) {
    case 'wallet_balance':
      return text(describeBalance());

    case 'wallet_ledger': {
      if (a.notes === true) return text(describeNotes(WAKE_LEDGER_LIMIT));
      const date = typeof a.date === 'string' && a.date.trim() ? a.date.trim() : null;
      const limit = Number.isInteger(a.limit) ? Math.min(Math.max(a.limit, 1), 50) : WAKE_LEDGER_LIMIT;
      return text(describeLedger({ date, limit }));
    }

    case 'wallet_note': {
      const entryId = Number(a.entry_id);
      const content = String(a.note ?? '').trim();
      if (!Number.isInteger(entryId)) return fail('entry_id 要是一个整数，用翻账本时每笔前面那个 #号。');
      if (!content) return fail('批注是空的，没写。');

      const entry = getEntry(entryId);
      if (!entry) return fail(`账本里没有 #${entryId} 这笔。先翻一下账本看看真实的编号。`);

      const id = addNote({ entryId, author: SIGN_AS, content });
      if (!id) return fail('批注没写上。');

      const amount = `${entry.amount_cents > 0 ? '+' : '−'}¥${yuan(Math.abs(entry.amount_cents))}`;
      const lines = [
        `记下了。#${entry.id} ${formatDateTime(entry.ts).slice(5)}${
          entry.source ? ` ${entry.source}` : ''
        } ${amount}`,
        '',
        content,
      ];
      // 这笔旁边别人写过的也带回去，知道自己接在谁后面
      const others = listNotesFor(entryId).filter((n) => n.id !== id);
      if (others.length) {
        lines.push('', '这笔旁边还有：');
        for (const n of others) {
          const who = n.author === 'user' ? process.env.USER_DISPLAY_NAME || '她' : AI_NAME;
          lines.push(`${who}（${formatDateTime(n.ts).slice(5)}）：${n.content}`);
        }
      }
      console.log(`wallet-mcp: 给 #${entryId} 记了一句（${content.length} 字，算 ${SIGN_AS}）`);
      return text(lines.join('\n'));
    }

    default:
      return fail(`钱包没有这个工具：${name}`);
  }
}

// 定长比较，和 wallet.js 的 secretOk 同一个理由
function tokenOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(MCP_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Authorization: Bearer xxx，或者 x-wallet-mcp-token 头
function presentedToken(req) {
  const auth = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return req.headers['x-wallet-mcp-token'];
}

function newServer() {
  const server = new Server(
    { name: 'vesper-wallet', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return callWalletTool(name, args);
    } catch (err) {
      // 读账失败不该把整个 MCP 连接弄挂，返回一个 isError 给对方看
      console.error(`wallet-mcp: ${name} 出错`, err.message);
      return fail(`钱包这次没读成：${err.message}`);
    }
  });

  return server;
}

export function registerWalletMcp(app) {
  if (!MCP_TOKEN) {
    console.log('wallet-mcp: 没配 WALLET_MCP_TOKEN，/wallet/mcp 没开');
    return { enabled: false };
  }

  app.post('/wallet/mcp', async (req, res) => {
    if (!tokenOk(presentedToken(req))) {
      // 不打印收到的 token，也不回显哪儿错了
      console.error('wallet-mcp: token 不对，已拒绝');
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'unauthorized' },
        id: null,
      });
    }

    // 无状态：一请求一对 server + transport，用完关掉。sessionIdGenerator 给 undefined 就是这个模式
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
      console.error('wallet-mcp: 请求没处理成', err.message);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          error: { code: -32603, message: 'internal error' },
          id: null,
        });
      }
    }
  });

  // GET/DELETE 是有状态模式的 SSE 和关会话，这边用不上。
  // 明确回 405 比让客户端干等强
  const notAllowed = (req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'use POST; this endpoint is stateless' },
      id: null,
    });
  app.get('/wallet/mcp', notAllowed);
  app.delete('/wallet/mcp', notAllowed);

  return { enabled: true, signAs: SIGN_AS };
}
