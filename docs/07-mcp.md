# 07 · 接入更多 MCP

MCP（Model Context Protocol）是 TA 的"手脚"。唤醒时决定要做的事，除了内置的推送和写日记，其余都靠 MCP 完成：翻长期记忆、逛论坛、查天气、记日程……接一个就多一样能力。

这一篇讲清楚：已经内置的怎么工作，以及以后想加新的该怎么加。

## 已经内置的两个

| server 名 | 连接方式 | 干什么 |
|---|---|---|
| `ombre-brain` | Streamable HTTP | 长期记忆。见下文 |
| `lutopia` | Streamable HTTP | 论坛。发帖、回帖、看别人的帖子 |

两个都是**可选**的：变量留空就不连，其余功能照常跑，不会崩。

## 两种连接方式

`src/mcp-manager.js` 里有两个函数，对应 MCP 的两种传输：

```js
// 远程 server：给一个 URL，可选带鉴权头
connectMcpHttp(name, url, headers)

// 本地进程：给一个命令和参数，Aru 会把它当子进程拉起来
connectMcpStdio(name, command, args)
```

Ombre Brain 和 Lutopia 都是前者（远程 HTTP）。如果你的 server 是个本地命令行程序，用后者。

## 加一个新的：三步

假设要接一个叫 `weather` 的天气 server。

### 1. `.env` 里加变量

```
WEATHER_MCP_URL=https://example.com/mcp
WEATHER_MCP_TOKEN=
```

用 stdio 的话就不需要 URL，改成命令和参数：

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

`connectAll()` 里每一段都包了 `try / catch`，这是故意的：某个 server 连不上只打一行错误，不影响其余连接，也不影响唤醒循环启动。

### 3. 重启

```bash
pm2 restart phosphor
```

只有 phosphor 需要重启——MCP 是在它的主循环里连的。

## 连上之后，TA 怎么知道能用它

唤醒时 phosphor 会做两件事：

1. `listAllTools()` 把所有已连 server 的工具名收集起来，放进决策上下文 `context.availableTools`
2. `decide.js` 把这份清单写进 prompt，同时告诉模型有个 `mcp_call` 动作

模型想用，就返回：

```json
{
  "action": "mcp_call",
  "action_detail": "{\"server\":\"weather\",\"tool\":\"get_forecast\",\"args\":{\"city\":\"长沙\"}}"
}
```

`src/actions/mcp-action.js` 负责分发到对应的 server。

**server 名要和 `connectMcpHttp` 的第一个参数一致**，工具名要和 server 自己报的一致。写错会直接报 `MCP server "xxx" is not connected` 或工具不存在。

## 三个要注意的地方

### 工具名会全量进 prompt

`listAllTools()` 返回的是**所有**已连 server 的所有工具名，整份塞进 prompt。工具多的 server 会吃掉不少 token——比如一个有一百七十多个工具的 server，光名字就是一大段。

所以只连真正要用的。不用的把 `.env` 里那个变量清空重启就行，不用改代码。

### 写操作的 server 要慎重

有些 server 能对外的世界产生影响：发帖、发文章、下单、发消息。这类建议**不要**放进 TA 的自主行动列表——它每次醒来都可能自己决定要用。

项目里的做法是：小红的 MCP 特意不写进 `connectAll()`，需要时由人手动要求、并且先商量好内容。接新 server 时可以照这个思路判断：

- 只读（查资料、翻记忆、看帖子）→ 可以自主
- 会对外说话、会花钱、会改别人能看到的东西 → 留给人来触发

### 连不上不会崩

`connectAll()` 里任何一段失败都只 `console.error`，然后继续。所以排查时看日志有没有 `connected MCP: xxx` 这一行就够了——没出现就是没连上。

## 排错

```bash
pm2 logs phosphor --lines 40 --nostream
```

| 现象 | 原因 |
|---|---|
| 日志里没有 `connected MCP: xxx` | 变量没填，或 URL / token 不对 |
| `MCP server "xxx" is not connected` | 决策里写的 server 名和 `connectMcpHttp` 的第一个参数对不上 |
| 工具调用报不存在 | 工具名写错，或者那个 server 换了版本 |
| 唤醒变慢、prompt 很长 | 连了工具特别多的 server，考虑断开不用的 |

## Ombre Brain 的特殊之处

它不只是"又一个 MCP"——它是这个项目的长期记忆，用法在 [01](01-how-it-works.md) 里也提过，这里集中说一下。

**连接**：Docker 容器跑的 Streamable HTTP server。

```
OMBRE_BRAIN_URL=http://localhost:18001/mcp
OMBRE_MCP_TOKEN=去 Dashboard 生成
```

端口看 `docker ps` 里映射到宿主机的那个，容器内固定 8000。

**它解决什么问题**：phosphor 每次醒来都是一个新进程状态，不记得上次做过什么、为什么这么做。只靠 `wake_log` 只能知道"做过什么"，不知道"当时怎么想的"。Ombre Brain 补的就是这一段。

**醒来时怎么用**：phosphor 会并行调两次，结果都拼进决策 prompt。

| 调用 | 作用 |
|---|---|
| `breath()` | 0 参数、0 次 LLM 调用，纯读库。让重要且还没闭环的事重新浮上来 |
| `feel(query)` | 翻感受类记忆——"我现在感觉怎么样" |

**决策侧自己还能选**：`ombre_brain` 动作有四种模式。

| mode | 什么时候用 |
|---|---|
| `breath` | 醒来先看看自己记得什么 |
| `search` | 想不起某件事，按语义找 |
| `feel` | 想翻一段感受 |
| `hold` | 明确认为某件事值得长期记住 |

`hold` 是**写**操作，prompt 里特意写了"只有明确认为值得长期记住时才用"——不然每醒一次就写一条，记忆会被垃圾填满。

**没连上会怎样**：决策 prompt 里两段记忆都显示"暂无"，`ombre_brain` 动作直接跳过。其余功能不受影响。
