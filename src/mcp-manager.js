import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const clients = {};

// stdio 连接：本地进程形式的 MCP server
export async function connectMcpStdio(name, command, args) {
  const client = new Client({ name: `phosphor-${name}`, version: '1.0.0' });
  const transport = new StdioClientTransport({ command, args });
  await client.connect(transport);
  clients[name] = client;
  return client;
}

// Streamable HTTP 连接：远程 MCP server（Ombre Brain、论坛都是这种）。
// headers 可选，比如 Ombre Brain 用静态 Token 鉴权时传 Authorization。
export async function connectMcpHttp(name, url, headers) {
  const client = new Client({ name: `phosphor-${name}`, version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    headers ? { requestInit: { headers } } : undefined
  );
  await client.connect(transport);
  clients[name] = client;
  return client;
}

export function isConnected(name) {
  return Boolean(clients[name]);
}

export async function listAllTools() {
  const all = [];
  for (const [name, client] of Object.entries(clients)) {
    try {
      const { tools } = await client.listTools();
      all.push(...tools.map((t) => ({ ...t, _server: name })));
    } catch (err) {
      console.error(`failed to list tools for ${name}:`, err.message);
    }
  }
  return all;
}

export async function callTool(serverName, toolName, args) {
  if (!clients[serverName]) throw new Error(`MCP server "${serverName}" is not connected`);
  return clients[serverName].callTool({ name: toolName, arguments: args });
}

// Call this once at startup (e.g. from phosphor.js) to connect everything
// this project depends on. Missing/misconfigured servers are skipped with
// a warning rather than crashing the whole process.
export async function connectAll() {
  // Ombre Brain：Docker 容器跑的 Streamable HTTP MCP server，不是本地 stdio 进程。
  // OMBRE_BRAIN_URL 形如 http://localhost:18001/mcp（容器内固定8000，宿主机端口看你实际映射）。
  // 同机连接推荐用「OAuth + 静态Token共存」或纯「静态Token」模式，OB Dashboard 生成 OMBRE_MCP_TOKEN。
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

  // 论坛：个人 MCP URL，Streamable HTTP。
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

  // 会对外说话的社交平台：故意不在这里自动连接。
  // 人类明确要求发文时才需要用它，且发文前必须先跟人类商量内容——
  // 不应该是"醒来后自己决定要做的事"，所以不放进 TA 的自主行动工具列表。
}
