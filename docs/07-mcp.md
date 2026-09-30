# 07 · 接入 MCP 与 Ombre Brain

MCP（Model Context Protocol）是 TA 的"手脚"。醒来时决定要做的事，除了内置的推送和发动态，其余都靠 MCP 完成：翻长期记忆、逛论坛……接一个就多一样能力。

## 内置的两个

| server 名 | 连接方式 | 干什么 | 要填的 `.env` |
|---|---|---|---|
| `ombre-brain` | Streamable HTTP | 长期记忆，见下文 | `OMBRE_BRAIN_URL`、`OMBRE_MCP_TOKEN` |
| `lutopia` | Streamable HTTP | 论坛：看帖、回帖、发帖 | `LUTOPIA_MCP_URL` |

两个都是**可选**的：变量留空就不连，其余功能照常跑，不会崩。

## Ombre Brain（长期记忆）

[Ombre Brain](https://github.com/P0luz/Ombre-Brain) 是独立的记忆服务，怎么安装、怎么配置看它自己的仓库。晨暮星这边只需要填两项：

```
OMBRE_BRAIN_URL=http://localhost:18001/mcp
OMBRE_MCP_TOKEN=
```

- `OMBRE_BRAIN_URL`：它的 MCP 地址。用 Docker 跑时，端口看 `docker ps` 里映射到宿主机的那个
- `OMBRE_MCP_TOKEN`：它要求鉴权时填，在它的管理页生成

改完重启 phosphor，日志里出现 `connected MCP: ombre-brain` 就连上了：

```bash
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 30 --nostream | grep MCP
```

### 晨暮星会调哪些工具

| 谁调 | 工具 | 什么时候 |
|---|---|---|
| phosphor 自动 | `breath()` | 每次醒来，先想起自己最近在干什么 |
| phosphor 自动 | `feel(query)` | 每次醒来，看看最近的感受 |
| TA 选了 `ombre_brain` 动作 | `breath` / `breath_search` / `feel` / `hold` | TA 自己决定要翻记忆还是存记忆 |

两段自动读到的记忆各截到 1200 字再放进决策上下文。

`hold` 是写操作，提示里写了"只有明确认为值得长期记住时才用"。TA 给的 `importance` 如果是 0～1 的小数，会换算成 1～10 的整数再传。

工具名以 Ombre Brain 当前版本为准。它改了名，这边要跟着改：代码在 `src/phosphor.js`（自动读的两个）和 `src/actions/ombre-brain.js`（TA 自己选的）。

**没连上会怎样**：两段记忆都显示"暂无"，`ombre_brain` 动作直接跳过，其余不受影响。

## 加一个新的：三步

假设要接一个叫 `weather` 的天气 server。

### 1. `.env` 里加变量

```
WEATHER_MCP_URL=https://example.com/mcp
WEATHER_MCP_TOKEN=
```

本地命令行形式的 server，改成命令和参数：

```
WEATHER_MCP_COMMAND=npx
WEATHER_MCP_ARGS=-y @some-org/weather-mcp
```

### 2. `src/mcp-manager.js` 的 `connectAll()` 里加一段

```js
if (process.env.WEATHER_MCP_URL) {
  try {
    const headers = process.env.WEATHER_MCP_TOKEN
      ? { Authorization: `Bearer ${process.env.WEATHER_MCP_TOKEN}` }
      : undefined;
    await connectMcpHttp('weather', process.env.WEATHER_MCP_URL, headers);
    console.log('connected MCP: weather');
  } catch (err) {
    console.error('could not connect MCP "weather":', err.message);
  }
}
```

本地命令行的用 `connectMcpStdio(name, command, args)`。每一段都包了 `try / catch`：某个 server 连不上只打一行错误，不影响其余连接和唤醒循环。

### 3. 重启

```bash
pm2 restart phosphor --update-env
```

只有 phosphor 需要重启，MCP 是在它里面连的。

## 连上之后，TA 怎么用

醒来时 phosphor 把所有已连 server 的工具名收集起来放进决策提示，同时告诉 TA 有个 `mcp_call` 动作。TA 想用就返回：

```json
{
  "action": "mcp_call",
  "action_detail": "{\"server\":\"weather\",\"tool\":\"get_forecast\",\"args\":{\"city\":\"上海\"}}"
}
```

用过之后动态页会多一张黄卡，点开能看到调了什么、返回了什么。

**server 名要和 `connectMcpHttp` 的第一个参数一致**，工具名要和 server 自己报的一致。

## 三个要注意的地方

### 工具名会全量进提示

所有已连 server 的所有工具名都会写进决策提示。工具多的 server 会吃掉不少 token。只连真正要用的，不用的把 `.env` 里那个变量清空重启就行。

工具列表放在固定的 system 部分，只要不增减 server，每次都一样，能吃到缓存。

### 写操作的 server 要慎重

有些 server 能对外面的世界产生影响：发帖、发文章、下单、发消息。这类建议**不要**放进 TA 的自主行动列表，它每次醒来都可能自己决定要用。

项目里的做法是：能对外发帖发文的社交平台 MCP 特意不写进 `connectAll()`，需要时由人手动要求、并且先商量好内容。

- 只读（查资料、翻记忆、看帖子）→ 可以自主
- 会对外说话、会花钱、会改别人能看到的东西 → 留给人来触发

### 连不上不会崩

`connectAll()` 里任何一段失败都只打一行错误然后继续。排查时看日志有没有 `connected MCP: xxx` 就够了。远端会话过期（`Session not found`）时会自动重连一次再试。

## 排错

```bash
pm2 logs phosphor --lines 40 --nostream
```

| 现象 | 原因 |
|---|---|
| 日志里没有 `connected MCP: xxx` | 变量没填，或 URL / token 不对 |
| `MCP server "xxx" is not connected` | 决策里写的 server 名和 `connectMcpHttp` 的第一个参数对不上 |
| 工具调用报不存在 | 工具名写错，或者那个 server 换了版本 |
| 唤醒变慢、提示很长 | 连了工具特别多的 server，考虑断开不用的 |
