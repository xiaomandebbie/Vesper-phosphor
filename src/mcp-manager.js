import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const clients = {};
// 每个服务怎么重新连接。远端会话过期（Session not found）时用它重连。
const connectors = {};
// 正在重连的服务，避免同时发起两次重连
const reconnecting = {};

// TA 自己醒来时不能用的工具，按服务名列。
// 点歌台的 song_share 会把歌递进播放器：mode=now 立刻开播，mode=queue 在播放器闲着时也会直接开播。
// 醒来突然出声会打扰对方，所以整个挡掉：不出现在工具列表里，硬调也会被拒。
const BLOCKED_TOOLS = {
  music: new Set(['song_share']),
};
const isBlocked = (server, tool) => Boolean(BLOCKED_TOOLS[server]?.has(tool));

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
  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));
}

// phosphor 启动时调用一次，把用到的 MCP 都连上。
// 没配或连不上的只打一行警告，不会让整个进程崩掉。
// 连上的 MCP，TA 醒来时都可以自己决定用（BLOCKED_TOOLS 里的除外）。
export async function connectAll() {
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

  // 网易云点歌台（https://github.com/Anko3o/Music-Mcp-Netease 的 mcp/music_mcp.py），Streamable HTTP。
  // 和晨暮星跑在同一台机器上，只听本机，不用鉴权。MUSIC_MCP_URL 形如 http://127.0.0.1:18012/mcp
  // 名字固定叫 music：decide.js 的 prompt、动态页的行为卡片、上面的 BLOCKED_TOOLS 都按这个名字认。
  if (process.env.MUSIC_MCP_URL) {
    try {
      await connectMcpHttp('music', process.env.MUSIC_MCP_URL);
      console.log('connected MCP: music');
    } catch (err) {
      console.error('could not connect MCP "music":', err.message);
    }
  }
}
