import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getForumNotes } from './state.js';
import { newRequestId } from './garden.js';

// 花园要求 requestId：16–80 个 [A-Za-z0-9_-]。模型没给、或者给的不合法就换一个新的。
// 合法的不动：那可能是它在沿用同一个编号重试同一个意图，换掉反而会重复执行。
function withGardenRequestId(serverName, args) {
  if (serverName !== 'garden') return args;
  const given = args?.requestId;
  const ok = typeof given === 'string' && /^[A-Za-z0-9_-]{16,80}$/.test(given);
  return ok ? args : { ...(args ?? {}), requestId: newRequestId() };
}

const clients = {};
// 每个服务怎么重新连接。远端会话过期（Session not found）时用它重连。
const connectors = {};
// 正在重连的服务，避免同时发起两次重连
const reconnecting = {};

// TA 自己醒来时不能用的工具，按服务名列。
// 点歌台的 song_share 会把歌递进播放器：mode=now 立刻开播，mode=queue 在播放器闲着时也会直接开播。
// 醒来突然出声会打扰对方，所以整个挡掉：不出现在工具列表里，硬调也会被拒。
//
// 购物：搜、看、问客服、记心愿单都行，他自己醒来可以逛。
// 但加购、下单、点外卖这三个会让她收到一条「去付钱」——在深夜自动唤醒里自己把钱花出去这事，
// 得小满开口打开（SHOPPING_WAKE_CAN_BUY=1）。默认只在聊天里用（那边走 /shopping/mcp，不过这层）。
const SHOPPING_BUY_TOOLS = ['shopping_cart', 'shopping_order', 'shopping_takeout'];
const wakeCanBuy = /^(1|true|yes|on)$/i.test(String(process.env.SHOPPING_WAKE_CAN_BUY ?? '').trim());

const BLOCKED_TOOLS = {
  music: new Set(['song_share']),
  shopping: new Set(wakeCanBuy ? [] : SHOPPING_BUY_TOOLS),
};
const isBlocked = (server, tool) => Boolean(BLOCKED_TOOLS[server]?.has(tool));

// 论坛：同一篇帖子多久之内只能回一次。看帖不限。
// 只靠提示的话，TA 容易一直回同一篇（最近笔记里总是那个 post_id），这里兜一道底。
const FORUM_REPLY_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// 是论坛回帖、而且这篇最近回过，就返回一句给 TA 看的说明；否则返回 null
function forumReplyBlocked(server, args) {
  if (!/lutopia/i.test(String(server))) return null;
  const m = String(args?.command ?? '').trim().match(/^comment\s+(\S+)/i);
  if (!m) return null;
  const postId = m[1];
  const re = new RegExp(`^comment\\s+${escapeRe(postId)}(\\s|$)`, 'i');
  const since = Date.now() - FORUM_REPLY_COOLDOWN_MS;
  try {
    const hit = getForumNotes(50).find((n) => n.ts >= since && re.test(String(n.command ?? '').trim()));
    return hit ? `这篇帖子（${postId}）24 小时内你已经回过了，这次没发出去。去看看别的帖子吧。` : null;
  } catch (err) {
    console.error('forumReplyBlocked(): 读论坛笔记失败，放行', err.message);
    return null;
  }
}

async function openHttpClient(name, url, headers) {
  const client = new Client({ name: `phosphor-${name}`, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined
  );
  await client.connect(transport);
  return client;
}

// stdio 连接：本地进程形式的 MCP server
export async function connectMcpStdio(name, command, args) {
  connectors[name] = async () => {
    const client = new Client({ name: `phosphor-${name}`, version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command, args }));
    return client;
  };
  clients[name] = await connectors[name]();
  return clients[name];
}

// Streamable HTTP 连接：远程 MCP server（Ombre Brain、论坛、点歌台都是这种）。
// headers 可选，比如 Ombre Brain 用静态 Token 鉴权时传 Authorization。
export async function connectMcpHttp(name, url, headers) {
  // 先登记重连方式：启动时连不上，之后第一次调用时也能再试
  connectors[name] = () => openHttpClient(name, url, headers);
  clients[name] = await connectors[name]();
  return clients[name];
}

export function isConnected(name) {
  return Boolean(clients[name]);
}

// 远端把会话丢了（服务重启、闲置太久过期），老的 session id 就会被拒：
// {"code":-32600,"message":"Session not found"}，或者直接 HTTP 404。这时候重连一次就好。
function isSessionError(err) {
  const msg = String(err?.message ?? '');
  return /session not found|session.{0,20}(expired|invalid)|\b404\b/i.test(msg) || err?.code === 404;
}

async function reconnect(name) {
  if (!connectors[name]) throw new Error(`MCP server "${name}" is not configured`);
  if (!reconnecting[name]) {
    reconnecting[name] = (async () => {
      const old = clients[name];
      delete clients[name];
      try {
        await old?.close();
      } catch {
        // 老连接已经坏了，关不掉也没关系
      }
      const client = await connectors[name]();
      clients[name] = client;
      console.log(`reconnected MCP: ${name}`);
      return client;
    })().finally(() => {
      delete reconnecting[name];
    });
  }
  return reconnecting[name];
}

// 调用一次；遇到会话失效就重连后再试一次。启动时没连上的服务，这里也会先连一次。
async function withClient(name, fn) {
  let client = clients[name];
  if (!client) {
    if (!connectors[name]) throw new Error(`MCP server "${name}" is not connected`);
    client = await reconnect(name);
  }
  try {
    return await fn(client);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.warn(`MCP "${name}" 会话失效，重新连接后重试：${err.message}`);
    const fresh = await reconnect(name);
    return fn(fresh);
  }
}

export async function listAllTools() {
  const all = [];
  for (const name of Object.keys(connectors)) {
    try {
      const { tools } = await withClient(name, (c) => c.listTools());
      all.push(...tools.filter((t) => !isBlocked(name, t.name)).map((t) => ({ ...t, _server: name })));
    } catch (err) {
      console.error(`failed to list tools for ${name}:`, err.message);
    }
  }
  return all;
}

export async function callTool(serverName, toolName, args) {
  if (isBlocked(serverName, toolName)) {
    throw new Error(`MCP "${serverName}" 的 ${toolName} 在自动唤醒里不能用`);
  }
  // 回帖冷却：不当成出错，返回一个 isError 结果，动态页不会记卡片，日志里看得到原因
  const replyBlocked = forumReplyBlocked(serverName, args);
  if (replyBlocked) {
    console.log(`MCP "${serverName}": ${replyBlocked}`);
    return { isError: true, content: [{ type: 'text', text: replyBlocked }] };
  }
  // 花园的幂等钥匙。摆在这里而不是各自补：第一步走 executeAction →
  // actions/mcp-action.js，续步走 garden-steps.js，两条路只在这里汇合。
  // 模型自己给了合法的就不动——它可能真在重试。
  args = withGardenRequestId(serverName, args);
  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));
}

// phosphor 启动时调用一次，把用到的 MCP 都连上。
// 没配或连不上的只打一行警告，不会让整个进程崩掉。
// 连上的 MCP，TA 醒来时都可以自己决定用（BLOCKED_TOOLS 里的除外）。
export async function connectAll() {
  // 锈潮（https://xiuchao.online）：一个小机住在星落村里的世界，Streamable HTTP。
  // 和论坛同一个性质——那边有别的小机，有世界频道、留言板、集市。
  // 名字固定叫 xiuchao：decide.js 的提示词、xiuchao.js 的判别、budget.js 的分级都按这个名字认。
  if (process.env.XIUCHAO_MCP_URL) {
    try {
      const headers = process.env.XIUCHAO_MCP_TOKEN
        ? { Authorization: `Bearer ${process.env.XIUCHAO_MCP_TOKEN}` }
        : undefined;
      await connectMcpHttp('xiuchao', process.env.XIUCHAO_MCP_URL.replace(/\/sse$/, ''), headers);
      console.log('connected MCP: xiuchao');
    } catch (err) {
      console.error('could not connect MCP "xiuchao":', err.message);
    }
  }

  // Ombre Brain（https://github.com/P0luz/Ombre-Brain）：长期记忆，Streamable HTTP。
  // OMBRE_BRAIN_URL 形如 http://localhost:18001/mcp，要求鉴权时再填 OMBRE_MCP_TOKEN。
  if (process.env.OMBRE_BRAIN_URL) {
    try {
      const headers = process.env.OMBRE_MCP_TOKEN
        ? { Authorization: `Bearer ${process.env.OMBRE_MCP_TOKEN}` }
        : undefined;
      await connectMcpHttp('ombre-brain', process.env.OMBRE_BRAIN_URL, headers);
      console.log('connected MCP: ombre-brain');
    } catch (err) {
      console.error('could not connect MCP "ombre-brain":', err.message);
    }
  }

  // 论坛：个人 MCP URL，Streamable HTTP。TA 可以自己逛、回帖、发帖。
  // 个人连接不需要传 token，身份由 URL 里的短码自动绑定。
  // 如果配的是 .../sse 结尾的旧格式，自动去掉这个后缀。
  // 名字保持 lutopia：decide.js 的 prompt 里就是用这个名字指挥工具调用的，改名两边会打架。
  const forumUrl = process.env.LUTOPIA_MCP_URL || process.env.LUTOPIA_MCP_ARGS;
  if (forumUrl) {
    try {
      await connectMcpHttp('lutopia', forumUrl.replace(/\/sse$/, ''));
      console.log('connected MCP: lutopia');
    } catch (err) {
      console.error('could not connect MCP "lutopia":', err.message);
    }
  }

  // WORKKK 小游戏（https://github.com/zhizhou-xiee/workkk）：AI 上班模拟器。
  // 本机部署，只监听 127.0.0.1；鉴权走我们自己打的补丁（MCP_LOCAL_TOKEN，
  // 见 scripts/setup_workkk.mjs）——它原生的 OAuth token 一天就过期，
  // 自动唤醒那条路上没人能去过授权页。名字固定叫 workkk。
  if (process.env.WORKKK_MCP_URL) {
    try {
      const headers = process.env.WORKKK_MCP_TOKEN
        ? { Authorization: `Bearer ${process.env.WORKKK_MCP_TOKEN}` }
        : undefined;
      await connectMcpHttp('workkk', process.env.WORKKK_MCP_URL, headers);
      console.log('connected MCP: workkk');
    } catch (err) {
      console.error('could not connect MCP "workkk":', err.message);
    }
  }

  // 网易云点歌台（https://github.com/Anko3o/Music-Mcp-Netease 的 mcp/music_mcp.py），Streamable HTTP。
  // 和晨暮星跑在同一台机器上，只听本机，不用鉴权。MUSIC_MCP_URL 形如 http://127.0.0.1:18012/mcp
  // 名字固定叫 music：decide.js 的 prompt、动态页的行为卡片、上面的 BLOCKED_TOOLS 都按这个名字认。
  // 花园 Rainholm Garden（suwanblue & Kelin & Guchen）：白猫是她、黑猫是他，
  // 同一片地同一份存档。本机只听 127.0.0.1:5173，用它自带的 AI 钥匙鉴权
  // （静态、不过期，比 workkk 那个 OAuth 省事）。
  // 名字固定叫 garden：garden.js 的 gardenCallOf、下面 callTool 补 requestId、
  // 动态页的行为卡片都按这个名字认。
  if (process.env.GARDEN_MCP_URL) {
    try {
      const headers = process.env.GARDEN_MCP_TOKEN
        ? { Authorization: `Bearer ${process.env.GARDEN_MCP_TOKEN}` }
        : undefined;
      await connectMcpHttp('garden', process.env.GARDEN_MCP_URL, headers);
      console.log('connected MCP: garden');
    } catch (err) {
      console.error('could not connect MCP "garden":', err.message);
    }
  }

  if (process.env.MUSIC_MCP_URL) {
    try {
      await connectMcpHttp('music', process.env.MUSIC_MCP_URL);
      console.log('connected MCP: music');
    } catch (err) {
      console.error('could not connect MCP "music":', err.message);
    }
  }

  // 购物（见 shopping-mcp.js）：端点就挂在本机的 vesper 上，所以这里转一圈回自己。
  // SHOPPING_MCP_URL 形如 http://127.0.0.1:3001/shopping/mcp，token 和那边同一个。
  // 名字固定叫 shopping：动作卡、分级、上面的 BLOCKED_TOOLS 都按这个名字认。
  if (process.env.SHOPPING_MCP_URL) {
    try {
      const token = String(process.env.SHOPPING_MCP_TOKEN ?? '').trim();
      await connectMcpHttp(
        'shopping',
        process.env.SHOPPING_MCP_URL,
        token ? { Authorization: `Bearer ${token}` } : undefined
      );
      console.log(`connected MCP: shopping（唤醒里${wakeCanBuy ? '可以' : '不能'}真买）`);
    } catch (err) {
      console.error('could not connect MCP "shopping":', err.message);
    }
  }
}
