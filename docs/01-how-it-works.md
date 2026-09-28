# 01 · 它是怎么工作的

这一篇不教部署，只讲清楚"每个零件在干嘛"。看懂这篇，后面出问题时你就知道该去看哪一块。

## 一句话版本

晨暮星是一个**会自己醒来的 TA**。每隔一段时间，phosphor 会把"现在的情况"整理好交给模型，模型决定这次醒来要做什么（推送、写日记、逛论坛、翻记忆……或者什么都不做），以及下次什么时候再醒。

## 三个进程

项目里有三个独立运行的程序，用 pm2 分别管理：

| pm2 进程名 | 文件 | 端口 | 干什么 |
|---|---|---|---|
| `phosphor` | `src/phosphor.js` | 无 | 心脏。每分钟看一眼"该不该醒"，该醒就做决定、执行动作 |
| `vesper` | `src/vesper.js` | 3001 | 接收手机上报、提供 `/wake/*` 控制接口、日记网页 |
| `vesper-gateway` | `src/gateway.js` | 3002 | 模型网关。Aru 和 phosphor 都从这里调模型，顺便记录对话 |

三个进程**共用同一个数据库** `data/state.db`（SQLite 文件）。它们之间不直接通信，全靠读写这个数据库交换信息。

```
  手机/快捷指令 ──POST /report-status──▶ vesper ──┐
                                                │
  Aru ──/v1/chat/completions──▶ vesper-gateway ─┼──▶ data/state.db ◀── phosphor
                                   │            │                        │
                                   ▼            │                        ▼
                              上游模型 API       │              decide.js → 模型
                                                │              actions/  → Bark / 日记 / MCP
  浏览器 ──/diary──▶ vesper ─────────────────────┘
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

1. **收集情况**：当前 mode、距上次醒来多久、手机最近上报的电量/位置/屏幕时间、过去 2 小时对话条数（对话密度）、最近 15 条对话、Ombre Brain 里的"最近感受"、有没有 missed 的精确唤醒、现在能用哪些 MCP 工具
2. **做决定**：`decide.js` 把这些写成一段 prompt 发给模型，要求只返回一个 JSON：
   ```json
   {"next_wake_minutes": 96, "mood": "...", "action": "diary", "action_detail": "...", "self_wake": null}
   ```
3. **兜底检查**：`normalizeDecision()` 把模型漏写、写错的字段补成安全值（见下文）
4. **执行动作**：`actions/index.js` 按 `action` 分派
5. **记账**：不管成功、失败还是 noop，都往 `wake_log` 表写一条
6. **更新状态**：保存心情、安排下次醒来、登记 self_wake

### 决定失败时

- 模型返回空内容、JSON 被截断或解析失败：**自动重试一次**。重试时去掉 `max_tokens`，并提醒模型"只输出完整 JSON，正文 400 字以内"
- 两次都失败：这次醒来记为出错，`next_wake_at` 往后推 **10 分钟**再试，不会原地狂刷
- 单次请求最多等 **120 秒**（`.env` 里 `DECIDE_TIMEOUT_MS` 可改）
- 上一轮还没跑完时，下一轮 tick 会直接跳过，同一次醒来不会被执行两遍

### 兜底规则（normalizeDecision）

| 模型给的 | 实际使用 |
|---|---|
| 没给 `next_wake_minutes` 或不是数字 | 60 分钟 |
| 小于 5 或大于 1440 | 截到 5～1440 分钟 |
| 没给 `mood` | 沿用上一次的心情 |
| 没给 `action` | `noop` |
| `action_detail` 是对象 | 自动转成 JSON 字符串 |
| `self_wake` 格式不对 | 忽略 |

## 可用的动作

| action | 做什么 | 需要的配置 |
|---|---|---|
| `bark` | 给你手机推送一条通知 | `BARK_KEY` |
| `diary` | 写一篇日记，可选配音 | 配音需要 `ELEVENLABS_API_KEY` |
| `mcp_call` | 调任意已连接的 MCP 工具（比如逛 Lutopia） | 对应 MCP 已连上 |
| `ombre_brain` | 读/写长期记忆 | `OMBRE_BRAIN_URL` |
| `set_mode` | 自己切 normal / low-frequency | 无 |
| `noop` | 什么都不做（合法结果，不是失败） | 无 |

补充说明：

- **diary 配图还没接**，`image_prompt` 目前会被跳过，不会生成占位图
- **diary 配音**固定用 ElevenLabs `eleven_v3` 模型。只有它认 `[breathing]`、`[whispers]` 这类标签，换模型会把标签原样念出来
- **silent 故意不给 TA 自己切**。那等于从你的世界里消失，这个开关只留给人：`POST /wake/mode`
- **小红书故意不自动连接**。发文前要先和小满商量

## 对话记录是怎么来的

phosphor 本身看不到你们的聊天。"最近聊了什么"和"对话密度"都来自 `conversation_log` 表，这张表的数据有两个来源：

1. **自动**：Aru 使用 `vesper-gateway` 的 `aru-chat` 模型时，网关在转发前记下用户最后一条消息（标为"小满"），在回复流结束时记下助手回复（标为"允朔"）。记录前会剥掉 Aru 注入的 `<environment>` 块和 `<sent_at>` 时间戳
2. **手动**：`POST /wake/conversation`（见接口篇）

没接上之前这张表一直是空的，只代表没有数据，不代表程序坏了。

## 数据库里有什么

文件：`data/state.db`。**不在 git 里**，删了就真没了。

| 表 | 内容 |
|---|---|
| `wake_state` | 只有一行：mode、下次醒来时间、当前心情 |
| `pending_wake` | 精确唤醒：时间、note、状态（pending / triggered / missed） |
| `wake_log` | 每次醒来的完整记录：决定、结果、错误 |
| `device_reports` | 手机上报的电量、位置、屏幕时间 |
| `diary` | 日记正文、图片/音频地址 |
| `conversation_log` | 对话记录 |

所有时间戳都是**毫秒**（13 位数字），不是秒。

## 文件地图

```
src/
├── phosphor.js      主循环：两条唤醒链、兜底、退出时关库
├── decide.js        拼 prompt、调模型、重试、解析 JSON
├── state.js         所有数据库读写；启动时自动建 data/ 目录
├── vesper.js        3001 端口：上报、/wake/*、日记页
├── gateway.js       3002 端口：模型路由 + 对话记录
├── mcp-manager.js   连接 Ombre Brain / Lutopia
└── actions/         每个动作一个文件
```
