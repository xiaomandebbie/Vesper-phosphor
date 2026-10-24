// 共读书架的 MCP 端点：挂在 vesper 这个 Express 上，路径 /books/mcp。
//
// 为什么要有这个（小满 2026-10-19）：
//   「允朔前端没有读书的记忆」
//
// read_book 那个动作只接在唤醒流程里（phosphor），聊天这边够不到书架。
// 所以她在 Aru 里跟他说话时，他看不见书、也看不见她写在书上的话。
//
// ── 为什么不往 OB 记忆库写进度 ──
//
// 她问过要不要「每次读完更新记忆」。不该。
//
// 读到第几段是**状态**，不是值得长期记住的事。每读完几段 hold 一条，
// 记忆库很快被「我读到第 40 段了」塞满，而真正该留下的（哪句话打动了他）
// 反而被埋在噪音里。而且 hold 是 3 级动作（见 budget.js），为了同步进度
// 花掉一次会惊动她的行动额度，不值。
//
// 更关键的：进度已经在数据库里了（book_progress）。那是事实，不需要靠
// 「记忆」保存。记忆该放感受和判断——他真被某句话打动时，自己 hold 一条，
// 那是他的判断，不是机械同步。
//
// ── 做法 ──
//
// 和小酒馆（bar-mcp.js）、钱包（wallet-mcp.js）、约定（wake-mcp.js）同一个路子：
// 低层 Server 配原始 JSON Schema（不走 McpServer.tool()，那要 zod，而 zod 没在
// package.json 里声明）；无状态模式，一请求一对 server + transport，用完关。
//
// 进度记在 who='assistant' 那一行，和她在网页上读到哪里（who='user'）分开存。
// 各读各的速度，批注共享——这是它最像「共读」的一点。

import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  listBooks,
  paragraphCount,
  progressOf,
  setProgress,
  annotationsIn,
  repliesOf,
  addAnnotation,
  addReply,
  resolveBook,
  chapterAt,
  readOn,
  renderReading,
  unseenFromUser,
  markSeen,
  BOOKS_CHUNK,
  recapOf,
  myMarks,
} from './books.js';
import db from './state.js';

// 和小酒馆、钱包那两个端点同一个规矩：没配口令就不开。
const MCP_TOKEN = process.env.BOOKS_MCP_TOKEN || '';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 一次最多读几段。聊天里比唤醒宽松一点（她就在对面，可以跟着说），
// 但也不能太多——段落全进上下文。.env 的 BOOKS_MCP_CHUNK 可改，上限 30。
const CHUNK = (() => {
  const raw = String(process.env.BOOKS_MCP_CHUNK ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 50) : Math.max(BOOKS_CHUNK, 8);
})();

const TOOLS = [
  {
    name: 'book_shelf',
    description:
      `看一眼共读书架：有哪几本、哪本在读、你和${USER_NAME}各自读到哪了。` +
      `每本带一个 id，往下读、写批注要用它（也可以直接写书名）。只读。`,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'book_recap',
    description:
      `看一本书读到哪里了、前面的故事是什么，以及你在这本书上划过的句子和当时写的话。\n` +
      `想起这本书、跟${USER_NAME}聊到它的时候用这个——不要凭印象说读没读过。\n` +
      `往下读不在聊天里做：读书是醒来时自己坐下来读的，读完会把前情更新到这里。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: '书名或 book_shelf 里的 id' },
        from: { type: 'integer', minimum: 0, description: '可选：从第几段读起（跳回去重读用）' },
        count: { type: 'integer', minimum: 1, description: `可选：读几段，默认 ${CHUNK}` },
      },
      required: ['book'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_note',
    description:
      `在某一段旁边写一笔。para 用正文里方括号里那个数字，quote 照抄打动你的那句原文。\n` +
      `写下的话${USER_NAME}在网页上看得见，她能回你。真被那句话打到了再写，不必凑。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: '书名或 id' },
        para: { type: 'integer', minimum: 0, description: '段落编号（正文里 [12] 那个数字）' },
        quote: { type: 'string', description: '可选：打动你的那句原文，照抄' },
        note: { type: 'string', description: '你想说的' },
        color: {
          type: 'string',
          enum: ['yellow', 'pink', 'green', 'blue'],
          description: '可选高亮颜色，默认 yellow',
        },
      },
      required: ['book', 'para', 'note'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_notes',
    description:
      `读一本书里的批注——你写的和${USER_NAME}写的都在，带回复。` +
      `每条前面那个 #号是回复要用的 id。`,
    inputSchema: {
      type: 'object',
      properties: {
        book: { type: 'string', description: '书名或 id' },
        limit: { type: 'integer', minimum: 1, description: '可选，最多几条，默认 20' },
      },
      required: ['book'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_reply',
    description:
      `回${USER_NAME}写在书上的某一条。id 用 book_notes 或正文里带出来的 #号。` +
      `你的回复挂在那条批注下面，她在网页上看得见。`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '批注的 #号' },
        reply: { type: 'string', description: '回复正文' },
      },
      required: ['id', 'reply'],
      additionalProperties: false,
    },
  },
  {
    name: 'book_from_her',
    description:
      `看${USER_NAME}在书上写了什么、你还没回过的。系统不会替她转达，` +
      `不回到那一页就看不见——所以想知道她说了什么就用这个。` +
      `读过的不再重复出现；想回哪条用 book_reply。`,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, description: '可选，最多几条，默认 5' },
      },
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });

const short = (v, n) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : s;
};

function shelfText() {
  const all = listBooks();
  if (!all.length) return `书架还是空的。等${USER_NAME}导几本书进来再说。`;
  const lines = all.map((b) => {
    const total = paragraphCount(b.id);
    const mine = progressOf(b.id, 'assistant');
    const hers = progressOf(b.id, 'user');
    const pct = (p) => (total ? Math.round((Math.min(p.para_idx, total) / total) * 100) : 0);
    const where = chapterAt(b.id, mine.para_idx);
    return (
      `  《${b.title}》${b.author ? ` · ${b.author}` : ''}${b.status === 'finished' ? '（读完了）' : ''}\n` +
      `      你读到 ${pct(mine)}%（第 ${mine.para_idx} 段${where ? `，${where}` : ''}），` +
      `${USER_NAME} ${pct(hers)}%，全书 ${total} 段\n` +
      `      id：${b.id}`
    );
  });
  return `书架上有 ${all.length} 本：\n${lines.join('\n')}`;
}

async function callBooksTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};

  if (name === 'book_shelf') return text(shelfText());

  if (name === 'book_recap') {
    const book = resolveBook(a.book);
    if (!book) return fail(`书架上找不到「${a.book ?? ''}」。先用 book_shelf 看一眼有哪几本。`);
    const total = paragraphCount(book.id);
    const mine = progressOf(book.id, 'assistant');
    const at = Math.min(mine.para_idx, total);
    const pct = total ? Math.round((at / total) * 100) : 0;
    const lines = [
      `《${book.title}》${book.author ? ` · ${book.author}` : ''}`,
      `你读到 ${pct}%（第 ${at} 段，全书 ${total} 段）。`,
      '',
    ];
    const r = recapOf(book.id);
    if (r?.recap) {
      lines.push(`前面的故事（到第 ${r.through_idx + 1} 段）：`, r.recap, '');
      if (at > r.through_idx + 1) {
        lines.push(`（这份前情只写到第 ${r.through_idx + 1} 段，后面那几段还没记下来。）`, '');
      }
    } else if (at > 0) {
      lines.push('这本还没有前情——下次醒来读完一次就会有了。', '');
    } else {
      lines.push('这本你还没开始读。', '');
    }
    const marks = myMarks(book.id, 8);
    if (marks.length) {
      lines.push('你在这本书上划过的句子：');
      for (const m of marks) {
        const q = m.quote ? `「${short(m.quote, 70)}」` : `第 ${m.para_idx} 段`;
        lines.push(`  ${q}`, `      你当时写：${m.note}`);
      }
    } else {
      lines.push('（你还没在这本书上写过什么。）');
    }
    return text(lines.join('\n'));
  }

  // 聊天里不再往下读（2026-10-19）。理由在 mcp-patches.txt 开头：
  // 这条路没有收尾钩子，读了不写前情，只把进度往前推——于是下次醒来
  // 前情就缺一段，而他自己也不知道读过。
  if (name === 'book_read') {
    return fail(
      '往下读不在聊天里做。读书是醒来时自己坐下来读的，' +
        '那边读完会把前情记下来。\n' +
        '想起这本书用 book_recap：读到哪里、前面的故事、你划过的句子都在里面。'
    );
  }

  if (name === 'book_read_disabled') {
    const book = resolveBook(a.book);
    if (!book) return fail(`书架上找不到「${a.book ?? ''}」。先用 book_shelf 看一眼有哪几本。`);
    const count = Number.isInteger(Number(a.count)) ? Math.min(Number(a.count), 50) : CHUNK;
    // 传了 from 就先把进度挪过去（跳回去重读），readOn 再从那儿往下读
    if (Number.isInteger(Number(a.from))) {
      const total = paragraphCount(book.id);
      const from = Math.max(0, Math.min(Number(a.from), Math.max(0, total - 1)));
      setProgress(book.id, 'assistant', from, 0);
    }
    const out = readOn(book.id, count, 'assistant');
    if (out.error) return fail(out.error);
    const body = renderReading(out);
    const tail = out.done
      ? '\n\n（这本读到尾了。）'
      : '\n\n（进度已经推到这里，下次 book_read 从后面接。被哪句话打到了就用 book_note 写在旁边。）';
    return text(body + tail);
  }

  if (name === 'book_note') {
    const book = resolveBook(a.book);
    if (!book) return fail(`书架上找不到「${a.book ?? ''}」。`);
    const para = Number(a.para);
    if (!Number.isInteger(para) || para < 0) return fail('para 要是段落编号（正文里方括号里那个数字）。');
    const total = paragraphCount(book.id);
    if (para >= total) return fail(`《${book.title}》只有 ${total} 段，没有第 ${para} 段。`);
    const note = String(a.note ?? '').trim();
    if (!note) return fail('note 是空的。没话要写就不必写。');
    const id = addAnnotation({
      bookId: book.id,
      paraIdx: para,
      quote: a.quote ?? null,
      note,
      color: a.color ?? null,
      author: 'assistant',
    });
    console.log(`books-mcp: 在《${book.title}》第 ${para} 段旁边写了一笔（#${id}）`);
    return text(
      `写在了《${book.title}》第 ${para} 段旁边（批注#${id}）：\n${note}\n\n` +
        `（${USER_NAME}在网页上看得见这条，她能回你。）`
    );
  }

  if (name === 'book_notes') {
    const book = resolveBook(a.book);
    if (!book) return fail(`书架上找不到「${a.book ?? ''}」。`);
    const total = paragraphCount(book.id);
    const limit = Number.isInteger(Number(a.limit)) ? Number(a.limit) : 20;
    const anns = annotationsIn(book.id, 0, Math.max(0, total - 1)).slice(-limit);
    if (!anns.length) return text(`《${book.title}》里还没有批注。`);
    const lines = anns.map((x) => {
      const who = x.author === 'user' ? USER_NAME : '你';
      const head = `  #${x.id} 第 ${x.para_idx} 段${x.quote ? `「${short(x.quote, 40)}」` : ''} —— ${who}：${x.note ?? '（只划了线）'}`;
      const rs = repliesOf(x.id).map(
        (r) => `      ↳ ${r.author === 'user' ? USER_NAME : '你'}：${r.content}`
      );
      return [head, ...rs].join('\n');
    });
    return text(`《${book.title}》里的批注（${anns.length} 条）：\n${lines.join('\n')}`);
  }

  if (name === 'book_reply') {
    const id = Number(a.id);
    if (!Number.isInteger(id)) return fail('id 要是批注前面那个 #号。');
    const row = db
      .prepare(
        'SELECT a.id, a.note, a.author, b.title FROM book_annotations a JOIN books b ON b.id = a.book_id WHERE a.id = ?'
      )
      .get(id);
    if (!row) return fail(`没有批注#${id}。用 book_notes 或 book_from_her 看一眼有哪几条。`);
    const reply = String(a.reply ?? '').trim();
    if (!reply) return fail('reply 是空的。');
    addReply({ annotationId: id, author: 'assistant', content: reply });
    console.log(`books-mcp: 回了《${row.title}》里的批注 #${id}`);
    return text(`回了《${row.title}》里那条批注（#${id}）：\n${reply}`);
  }

  if (name === 'book_from_her') {
    const limit = Number.isInteger(Number(a.limit)) ? Number(a.limit) : 5;
    const { notes, replies } = unseenFromUser(limit);
    if (!notes.length && !replies.length) {
      return text(`${USER_NAME}没有新写在书上的话。`);
    }
    const lines = [];
    for (const n of notes) {
      lines.push(
        `  [批注#${n.id}] 《${n.title}》第 ${n.para_idx} 段${n.quote ? `「${short(n.quote, 40)}」` : ''}\n` +
          `      ${USER_NAME}写：${n.note ?? '（只划了线）'}`
      );
    }
    for (const r of replies) {
      lines.push(
        `  [回复在批注#${r.annotation_id}] 《${r.title}》第 ${r.para_idx} 段，你当时写的「${short(r.parent_note, 60)}」\n` +
          `      ${USER_NAME}回：${r.content}`
      );
    }
    // 带过一次就算告知过，和星星罐的回音同一个规矩
    try {
      markSeen({ noteIds: notes.map((n) => n.id), replyIds: replies.map((r) => r.id) });
    } catch (err) {
      console.error('books-mcp: 标记已读失败（不影响这次）', err.message);
    }
    return text(
      `${USER_NAME}在书上写了这些（只告知这一次）：\n${lines.join('\n')}\n\n` +
        `（想回哪条用 book_reply，id 就是上面那个 #号。）`
    );
  }

  return fail(`共读书架没有这个工具：${name}`);
}

// 定长比较，和 bar-mcp / wallet-mcp 同一个理由
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
  return req.headers['x-books-mcp-token'];
}

function newServer() {
  const server = new Server({ name: 'vesper-books', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return await callBooksTool(name, args);
    } catch (err) {
      console.error(`books-mcp: ${name} 出错`, err.message);
      return fail(`这次没成：${err.message}`);
    }
  });
  return server;
}

export function registerBooksMcp(app) {
  if (!MCP_TOKEN) {
    console.log('books-mcp: 没配 BOOKS_MCP_TOKEN，/books/mcp 没开');
    return { enabled: false };
  }

  app.post('/books/mcp', async (req, res) => {
    if (!tokenOk(presentedToken(req))) {
      console.error('books-mcp: token 不对，已拒绍');
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
      console.error('books-mcp: 请求没处理成', err.message);
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
  app.get('/books/mcp', notAllowed);
  app.delete('/books/mcp', notAllowed);

  return { enabled: true, chunk: CHUNK };
}
