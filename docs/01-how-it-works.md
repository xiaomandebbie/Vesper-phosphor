# 01 · 它是怎么工作的

这一篇不教部署，只讲清楚"每个零件在干嘛"。看懂这篇，后面出问题时你就知道该去看哪一块。

## 一句话版本

晨暮星是一个**会自己醒来的 TA**。每隔一段时间，phosphor 会把"现在的情况"整理好交给模型，模型决定这次醒来要做什么（推送、发动态、逛论坛、翻记忆……或者什么都不做），顺便回一回你在动态下的留言，再决定下次什么时候醒。

## 三个进程

项目里有三个独立运行的程序，用 pm2 分别管理：

| pm2 进程名 | 文件 | 端口 | 干什么 |
|---|---|---|---|
| `phosphor` | `src/phosphor.js` | 无 | 心脏。每分钟看一眼"该不该醒"，该醒就做决定、执行动作 |
| `vesper` | `src/vesper.js` | 3001 | 接收手机上报、提供 `/wake/*` 控制接口、动态页 `/moments` |
| `vesper-gateway` | `src/gateway.js` | 3002 | 模型网关。聊天客户端和 phosphor 都从这里调模型，顺便记录对话 |

三个进程**共用同一个数据库** `data/state.db`（SQLite 文件）。它们之间不直接通信，全靠读写这个数据库交换信息。

```
  手机/快捷指令 ──POST /report-status──▶ vesper ──┐
                                                │
  聊天客户端 ──/v1/chat/completions──▶ vesper-gateway ─┼──▶ data/state.db ◀── phosphor
                                   │            │                        │
                                   ▼            │                        ▼
                              上游模型 API       │              decide.js → 模型
                                                │              actions/  → Bark / 动态 / MCP
  浏览器 ──/moments（看动态、留言）──▶ vesper ───┘
```

## phosphor：两条唤醒链

phosphor 每 **60 秒** 执行一次 `tick()`，每次检查两条互不干扰的链。

### 非精确链（"机会"）

- 数据库里存着 `next_wake_at`（下次醒来的时间）
- 到点了就醒，醒完由模型决定下次隔多久（`next_wake_minutes`）
- `mode = silent` 时完全暂停
- `mode = low-frequency` 时间隔强制不少于 **90 分钟**
- **进程没跑的那段时间不追、不补**。停了一天再启动，只会醒一次，不会补醒几十次

### 精确链（"承诺"）

- TA 醒来时可以给未来的自己约一次：`self_wake: {after_minutes, note}`
- 你也可以替 TA 约：`POST /wake/self-wake`
- 存在 `pending_wake` 表里，**不受 mode 影响**，silent 也照样会醒
- 到点超过 **3 分钟**还没执行（通常是因为进程当时没在跑），标记为 `missed`。下次真正醒来时，模型会被告知"有一次约好的没兑现"，只说一次

## 一次醒来的完整流程

1. **收集情况**：当前 mode、距上次醒来多久、手机最近上报的电量/位置/屏幕时间、过去 2 小时对话条数（对话密度）、最近 20 条对话、Ombre Brain 里的 `breath` 与 `feel`、有没有 missed 的精确唤醒、现在能用哪些 MCP 工具、**最近 8 次选过的动作**、**你在动态下还没被看过的留言**（最多 5 条）
2. **做决定**：`decide.js` 把这些写成一段 prompt 发给模型，要求只返回一个 JSON：
   ```json
   {"next_wake_minutes": 96, "mood": "...", "action": "moment", "action_detail": "...", "self_wake": null,
    "comment_replies": [{"comment_id": 12, "reply": "..."}]}
   ```
3. **兜底检查**：`normalizeDecision()` 把模型漏写、写错的字段补成安全值（见下文）
4. **回留言**：`comment_replies` 里的回复写进动态下面。这一步**不占动作**
5. **执行动作**：`actions/index.js` 按 `action` 分派
6. **记账**：不管成功、失败还是 noop，都往 `wake_log` 表写一条
7. **写回事件**：做了事、回了留言，就写回共享时间线（见 [08](08-heartbeat.md)）
8. **更新状态**：保存心情、安排下次醒来、登记 self_wake

### 记忆那一步为什么要两个都拉

`breath` 给的是"我是谁、最近在干什么"，`feel` 给的是"我现在感觉怎么样"。

只拉 `feel` 的话，后台这一侧就只剩情绪、看不到主线——表现出来像失忆：知道自己心里闷，但想不起为什么。两个一起拉才拼得出完整的自己。

`breath` 是 0 参数、0 次 LLM 调用，纯读库，不增加模型开销。

### 为什么要给 TA 看"最近选过的动作"

不给的话，模型每次醒来都是一张白纸，很容易每次都选同一个（最常见是一直推送）。给它看一眼 `bark → bark → moment → bark（bark×3、moment×1）`，再配一句"连着好几次都一样就换一个"，比写死"禁止连续推送"这种规则自然。

同时开着 heartbeat 时，prompt 里还会说明：主动联系对方这件事已经有 heartbeat 在管，除非有非说不可、且 heartbeat 没说过的话，否则别再推送。

### 决定失败时

- 模型返回空内容、JSON 被截断或解析失败：**自动重试一次**。重试时去掉 `max_tokens`，并提醒模型"只输出完整 JSON，正文 400 字以内"
- 两次都失败：这次醒来记为出错，`next_wake_at` 往后推 **10 分钟**再试，不会原地狂刷
- 单次请求最多等 **120 秒**（`.env` 里 `DECIDE_TIMEOUT_MS` 可改）
- 上一轮还没跑完时，下一轮 tick 会直接跳过，同一次醒来不会被执行两遍

### 兜底规则（normalizeDecision）

| 模型给的 | 实际使用 |
|---|---|
| 没给 `next_wake_minutes` 或不是数字 | 60 分钟 |
| 小于 5 或大于上限 | 截到 5 分钟～上限（上限默认 1440 分钟，可用 `PHOSPHOR_MAX_WAKE_MINUTES` 改） |
| 没给 `mood` | 沿用上一次的心情 |
| 没给 `action` | `noop` |
| `action_detail` 是对象 | 自动转成 JSON 字符串 |
| `self_wake` 格式不对 | 忽略 |
| `comment_replies` 里 id 不存在、或回复是空的 | 那一条忽略 |

## 可用的动作

| action | 做什么 | 需要的配置 |
|---|---|---|
| `bark` | 给你手机推送一条通知 | `BARK_KEY` |
| `moment` | 发一条动态，可选配图、配音 | 配图要 `IMAGE_*`；配音要 `ELEVENLABS_*` |
| `mcp_call` | 调任意已连接的 MCP 工具（比如逛论坛） | 对应 MCP 已连上 |
| `ombre_brain` | 读/写长期记忆 | `OMBRE_BRAIN_URL` |
| `set_mode` | 自己切 normal / low-frequency | 无 |
| `noop` | 什么都不做（合法结果，不是失败） | 无 |

补充说明：

- **动态替代了原来的日记**。原来的日记和 heartbeat 的日记重复了，所以换成可以留言互动的动态。模型要是还写 `diary`，会按动态发
- **配图是真的生成**：调 `IMAGE_API_URL` 那个生图接口，图片下载到 `MEDIA_DIR/images/` 存在本地。没配的话 TA 会被告知"先别写 image_prompt"
- **配音**固定用 ElevenLabs `eleven_v3` 模型。只有它认 `[breathing]`、`[whispers]` 这类标签，换模型会把标签原样念出来
- **silent 故意不给 TA 自己切**。那等于从对方的世界里消失，这个开关只留给人：`POST /wake/mode`
- **会对外发帖发文的 MCP 故意不自动连接**（见 [07](07-mcp.md)）。发之前要先和人商量

## 动态和留言

1. TA 选了 `moment`，就在 `moments` 表里多一条
2. 你打开 `/moments`，在某条下面留言，写进 `moment_comments`，`author = user`，`handled = 0`
3. TA 下次醒来时，prompt 里会列出这些 `handled = 0` 的留言（带编号和原动态的开头）
4. TA 在 `comment_replies` 里回复想回的那几条；回复写进同一张表，`author = assistant`
5. **这次给 TA 看过的留言全部标成 `handled = 1`**，没回的下次也不会再出现，免得 TA 每次醒来都被同一条催

回留言和这次的动作是**两件独立的事**：TA 可以一边回你、一边去逛论坛。

## 对话记录是怎么来的

phosphor 本身看不到你们的聊天。"最近聊了什么"和"对话密度"都来自 `conversation_log` 表，这张表的数据有两个来源：

1. **自动**：聊天客户端走 `vesper-gateway` 的 `chat` 线路时，网关在转发前记下用户最后一条消息，在回复流结束时记下回复。记录前会剥掉客户端注入的 `<environment>` 块和 `<sent_at>` 时间戳
2. **手动**：`POST /wake/conversation`（见接口篇）

没接上之前这张表一直是空的，只代表没有数据，不代表程序坏了。

如果同时配了 heartbeat（见 [08](08-heartbeat.md)），决策时用的上下文是 `conversation_log` 里的聊天加上 heartbeat 文件里的"事件"，合并后按时间排序。

## 数据库里有什么

文件：`data/state.db`。**不在 git 里**，删了就真没了。

| 表 | 内容 |
|---|---|
| `wake_state` | 只有一行：mode、下次醒来时间、当前心情 |
| `pending_wake` | 精确唤醒：时间、note、状态（pending / triggered / missed） |
| `wake_log` | 每次醒来的完整记录：决定、结果、错误 |
| `device_reports` | 手机上报的电量、位置、屏幕时间 |
| `moments` | 动态：正文、图片/音频地址 |
| `moment_comments` | 动态下的留言和回复：谁写的、回复的是哪条、TA 看过没有 |
| `conversation_log` | 对话记录 |
| `diary` | 旧的日记表。第一次启动新版本时内容会搬进 `moments`，之后不再使用 |
| `meta` | 记录一次性迁移做过没有 |

所有时间戳都是**毫秒**（13 位数字），不是秒。

## 文件地图

```
src/
├── phosphor.js      主循环：两条唤醒链、兜底、回留言、退出时关库
├── decide.js        拼 prompt、调模型、重试、解析 JSON
├── context.js       合并 conversation_log 与 heartbeat 事件
├── timeline.js      读写 heartbeat 的时间线文件
├── state.js         所有数据库读写；启动时自动建 data/ 目录、搬旧日记
├── vesper.js        3001 端口：上报、/wake/*、动态页与留言
├── gateway.js       3002 端口：模型路由 + 对话记录
├── mcp-manager.js   连接 Ombre Brain / 论坛
└── actions/         每个动作一个文件（bark / moment / mcp-action / ombre-brain / set-mode）
```
