// 笔记本的 MCP 端点：挂在 vesper 这个 Express 上，路径 /notes/mcp。
//
// 小满 2026-11-15：「我在 aru 用 mcp 该怎么更新笔记呢，这个要解决」
//
// 形状和 wallet-mcp.js 一模一样，理由也一样：笔记在 data/state.db 里，
// 那库已经被几个进程共用；再起一个就是多一个连接，而 vesper 本来就是 Express。
//
// SDK 用低层的 Server 配原始 JSON Schema，不走 McpServer.tool()：
// 后者要 zod，而 zod 只是 sdk 的间接依赖，没在 package.json 里声明。
//
// 无状态：一请求一对 server + transport，用完关。这个端点每次就是读一本、
// 写一本，没有跟踪上下文的必要。
import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BOOKS, SLUGS, isBook, titleOf, readNote, writeNote, listNotes, describeNote } from './notes.js';
import { formatDateTime } from './wall-time.js';

// 这个端点能整篇覆盖笔记，所以和钱包那个同一个规矩：没配口令就不开。
const MCP_TOKEN = process.env.NOTES_MCP_TOKEN || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 走这个端点写的算谁。默认 user：这是小满在 Aru 里动手，
// 和他自己收工时写的（走 run-actions，算 assistant）分开记。
// 想让它算他写的，.env 里填 NOTES_MCP_SIGN_AS=assistant
const SIGN_AS = process.env.NOTES_MCP_SIGN_AS === 'assistant' ? 'assistant' : 'user';

const bookList = SLUGS.map((s) => `${s}（${BOOKS[s].title}）`).join('、');

const TOOLS = [
  {
    name: 'notes_list',
    description:
      `看四本笔记本的目录：每本多少字、多久没更新、上次是谁写的。` +
      `不带正文，要正文用 notes_read。不需要参数。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'notes_read',
    description:
      `读一本笔记的全文。book 填：${bookList}。` +
      `一次只读一本——四本全读费劲也没用。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', enum: SLUGS, description: '哪一本' },
      },
      required: ['book'],
      additionalProperties: false,
    },
  },
  {
    name: 'notes_write',
    description:
      `把一本笔记**整篇重写**。book 填：${bookList}。\n` +
      `注意是整篇替换，不是往后面追加：你交的这一篇会把原来那篇整个换掉。` +
      `所以先用 notes_read 读一遍，把该留的拄过来、过时的丢掉，再一次性写回来。` +
      `不限字数，但只写下次真用得上的：规则、进度、下次从哪接。` +
      `旧的那篇会自动存进历史（留最近三份），写坏了能在网页上翻回来。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', enum: SLUGS, description: '哪一本' },
        content: { type: 'string', description: '整篇正文，会换掉原来那篇' },
      },
      required: ['book', 'content'],
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });

const whoName = (a) => (a === 'user' ? USER_NAME : AI_NAME);

function callNotesTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};

  switch (name) {
    case 'notes_list': {
      const lines = listNotes().map((n) => {
        if (n.empty) return `${n.slug}　《${n.title}》　还是空的　${n.what}`;
        const when = n.updatedAt ? formatDateTime(n.updatedAt).slice(5) : '不详';
        return `${n.slug}　《${n.title}》　${n.chars} 字　${whoName(n.updatedBy)} ${when} 写的`;
      });
      return text(['四本笔记（固定四本，不新建）：', '', ...lines].join('\n'));
    }

    case 'notes_read': {
      const book = String(a.book ?? '').trim();
      if (!isBook(book)) return fail(`没有「${book}」这本。固定四本：${SLUGS.join('、')}。`);
      return text(describeNote(book));
    }

    case 'notes_write': {
      const book = String(a.book ?? '').trim();
      if (!isBook(book)) return fail(`没有「${book}」这本。固定四本：${SLUGS.join('、')}。`);
      const content = String(a.content ?? '').trim();
      // 空内容不当整篇重写：整篇覆盖是毁灭性的，一不小心传了空串就把那本抹了。
      // 真要清空在网页上做，那边看得见自己在删什么。
      if (!content) {
        return fail(
          `没写内容。notes_write 是整篇替换，传空的就把《${titleOf(book)}》抹了——` +
          `所以这次没写。真要清空去网页上做。`
        );
      }

      const before = readNote(book);
      const r = writeNote(book, content, SIGN_AS);
      const lines = [`《${titleOf(book)}》写好了，${r.chars} 字（算 ${whoName(r.author)} 写的）。`];
      if (before?.content) {
        lines.push(
          '',
          `换掉的那篇 ${before.content.length} 字，已经存进历史了（网页上翻得到）。`
        );
      }
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
    { name: 'vesper-notes', version: '1.0.0' },
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

  return { enabled: true, signAs: SIGN_AS };
}
