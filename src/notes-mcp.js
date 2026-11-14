// 笔记本的 MCP 端点：挂在 vesper 这个 Express 上，路径 /notes/mcp。
//
// 小满 2026-11-15：「我在 aru 用 mcp 该怎么更新笔记呢，这个要解决」
//
// 形状和 wallet-mcp.js 一模一样，理由也一样：笔记在 data/state.db 里，
// 那库已经被几个进程共用；再起一个就是多一个连接，而 vesper 本来就是 Express。
//
// ── 为什么是三把而不是一把「整篇写」 ──
//
// 第一版只有 notes_write，整篇替换。小满：「会不会工程太大，只需要新增和修改呀」
// 改一句话要把没变的部分全抄一遍，慢、费 token、还容易抄丢。
//
// SDK 用低层的 Server 配原始 JSON Schema，不走 McpServer.tool()：
// 后者要 zod，而 zod 只是 sdk 的间接依赖，没在 package.json 里声明。
//
// 无状态：一请求一对 server + transport，用完关。
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  BOOKS,
  SLUGS,
  isBook,
  titleOf,
  listNotes,
  listEntries,
  describeNote,
  addEntry,
  editEntry,
  deleteEntry,
  getEntry,
  markRead,
  stampOf,
} from './notes.js';
import { formatDateTime } from './wall-time.js';

// 这个端点能改能删，所以和钱包那个同一个规矩：没配口令就不开。
const MCP_TOKEN = process.env.NOTES_MCP_TOKEN || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 走这个端点写的算谁。默认 user：这是小满在 Aru 里动手，
// 和他自己收工时写的（走 run-actions，算 assistant）分开记。
// 这个区分还决定未读：只有 assistant 写的才算新的。
const SIGN_AS = process.env.NOTES_MCP_SIGN_AS === 'assistant' ? 'assistant' : 'user';

const bookList = SLUGS.map((s) => `${s}（${BOOKS[s].title}）`).join('、');
const bookProp = { type: 'string', enum: SLUGS, description: '哪一本' };

const TOOLS = [
  {
    name: 'notes_list',
    description:
      `看四本笔记本的目录：每本几条、多久没暨、有没有新的。` +
      `最近改过的排最上面。不带正文，要正文用 notes_read。不需要参数。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'notes_read',
    description:
      `读一本笔记的全部条目，每条带编号和日期，最近改过的在最上面。` +
      `book 填：${bookList}。\n` +
      `要改、要删先读一遍——编号是从这里来的。一次只读一本。`,
    inputSchema: {
      type: 'object',
      properties: { book: bookProp },
      required: ['book'],
      additionalProperties: false,
    },
  },
  {
    name: 'notes_add',
    description:
      `往一本笔记里**添一条**（或几条）。book 填：${bookList}。\n` +
      `一条写一件事，别把三件塞在一条里——以后只改其中一件就难办了。` +
      `同一件事的进度别另开新条，用 notes_edit 改原来那条。不限字数。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: bookProp,
        entries: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '要添的条目，一个字符串一条',
        },
      },
      required: ['book', 'entries'],
      additionalProperties: false,
    },
  },
  {
    name: 'notes_edit',
    description:
      `**改一条**。id 用 notes_read 里每条前面那个 #号，别自己编。\n` +
      `交的 content 会把那一条换掉，其他条目一个字不动。` +
      `「这条记下的日期」不变，只更新「改过的日期」。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '那条的编号' },
        content: { type: 'string', description: '改后的全文' },
      },
      required: ['id', 'content'],
      additionalProperties: false,
    },
  },
  {
    name: 'notes_delete',
    description:
      `**删一条**（或几条）。id 用 notes_read 里那个 #号。\n` +
      `过时的、已经不对的就删——别留着旧的跟新的打架。删了不能恢复。`,
    inputSchema: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'integer' },
          minItems: 1,
          description: '要删的条目编号',
        },
      },
      required: ['ids'],
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });

const whoName = (a) => (a === 'user' ? USER_NAME : AI_NAME);
const noBook = (b) => fail(`没有「${b}」这本。固定四本：${SLUGS.join('、')}。`);

function callNotesTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};

  switch (name) {
    case 'notes_list': {
      const lines = listNotes().map((n) => {
        if (n.empty) return `${n.slug}　《${n.title}》　还是空的　${n.what}`;
        const when = n.lastAt ? formatDateTime(n.lastAt).slice(5) : '不详';
        const mark = n.unread ? `　新的 ${n.unread} 条` : '';
        return `${n.slug}　《${n.title}》　${n.count} 条　${whoName(n.lastBy)} ${when} 改过${mark}`;
      });
      return text(['四本笔记（固定四本，最近改过的在前）：', '', ...lines].join('\n'));
    }

    case 'notes_read': {
      const book = String(a.book ?? '').trim();
      if (!isBook(book)) return noBook(book);
      const out = describeNote(book);
      // 读了就算看过了，清这一本的未读。只在 SIGN_AS 是 user 时清——
      // 这张水位记的是小满看到哪了，他自己读不应该把她的红点消掉。
      if (SIGN_AS === 'user') markRead(book);
      return text(out);
    }

    case 'notes_add': {
      const book = String(a.book ?? '').trim();
      if (!isBook(book)) return noBook(book);
      const list = Array.isArray(a.entries) ? a.entries : [];
      const clean = list.map((s) => String(s ?? '').trim()).filter(Boolean);
      if (!clean.length) return fail('entries 是空的，没添。');

      const made = [];
      for (const c of clean) {
        try {
          made.push(addEntry(book, c, SIGN_AS));
        } catch (err) {
          return fail(`添到第 ${made.length + 1} 条时停了：${err.message}`);
        }
      }
      const total = listEntries(book).length;
      return text(
        [
          `《${titleOf(book)}》添了 ${made.length} 条，现在共 ${total} 条。`,
          '',
          ...made.map((m) => `#${m.id}（${m.chars} 字）`),
        ].join('\n')
      );
    }

    case 'notes_edit': {
      const id = Number(a.id);
      if (!Number.isInteger(id)) return fail('id 要是整数，用 notes_read 里那个 #号。');
      const content = String(a.content ?? '').trim();
      if (!content) return fail('content 是空的。要删用 notes_delete。');

      const before = getEntry(id);
      if (!before) return fail(`没有 #${id} 这条。先 notes_read 看一下真实的编号。`);

      let r;
      try {
        r = editEntry(id, content, SIGN_AS);
      } catch (err) {
        return fail(`没改上：${err.message}`);
      }
      return text(
        [
          `《${titleOf(r.slug)}》#${r.id} 改好了（${r.chars} 字）。`,
          '',
          `原来是：${before.content.length > 80 ? before.content.slice(0, 80) + '…' : before.content}`,
        ].join('\n')
      );
    }

    case 'notes_delete': {
      const ids = Array.isArray(a.ids) ? a.ids.map(Number).filter(Number.isInteger) : [];
      if (!ids.length) return fail('ids 是空的，没删。');

      const gone = [];
      const missing = [];
      for (const id of ids) {
        const e = deleteEntry(id);
        if (e) gone.push(e);
        else missing.push(id);
      }
      if (!gone.length) return fail(`这几条都不存在：${missing.join('、')}。先 notes_read 看一下。`);

      const lines = [`删了 ${gone.length} 条：`, ''];
      for (const e of gone) {
        const snip = e.content.length > 60 ? e.content.slice(0, 60) + '…' : e.content;
        lines.push(`《${titleOf(e.slug)}》#${e.id}　${snip}`);
      }
      if (missing.length) lines.push('', `这几个号没找到，跳过了：${missing.join('、')}`);
      return text(lines.join('\n'));
    }

    default:
      return fail(`笔记本没有这个工具：${name}`);
  }
}

// 定长比较，和 wallet-mcp 同一个理由
function tokenOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(MCP_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(req) {
  const auth = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return req.headers['x-notes-mcp-token'];
}

function newServer() {
  const server = new Server(
    { name: 'vesper-notes', version: '2.0.0' },
    { capabilities: { tools: {} } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return callNotesTool(name, args);
    } catch (err) {
      console.error(`notes-mcp: ${name} 出错`, err.message);
      return fail(`笔记这次没弄成：${err.message}`);
    }
  });
  return server;
}

export function registerNotesMcp(app) {
  if (!MCP_TOKEN) {
    console.log('notes-mcp: 没配 NOTES_MCP_TOKEN，/notes/mcp 没开');
    return { enabled: false };
  }

  app.post('/notes/mcp', async (req, res) => {
    if (!tokenOk(presentedToken(req))) {
      console.error('notes-mcp: token 不对，已拒绕');
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'unauthorized' },
        id: null,
      });
    }

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
      console.error('notes-mcp: 请求没处理成', err.message);
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
  app.get('/notes/mcp', notAllowed);
  app.delete('/notes/mcp', notAllowed);

  return { enabled: true, signAs: SIGN_AS, tools: TOOLS.length };
}
