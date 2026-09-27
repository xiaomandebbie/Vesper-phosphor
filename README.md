# vesper-phosphor 晨暮星✨

自主调度的唤醒 agent，独立于 dylan-heartbeat，可并行部署、验证稳定后再切换。

- **vesper** — 网关服务：接收手机状态上报、对话记录上报，提供 `/wake/*` 控制接口和日记 Feed 页面
- **phosphor** — 调度循环：每次唤醒后自己决定下一次唤醒的时间间隔、心情、要做的动作（推送/写日记/调用MCP/读写Ombre Brain/改自己的节律模式/什么都不做）

## 安装

```bash
npm install
cp .env.example .env   # 填入实际的 key 和路径
```

## 本地/单独运行

```bash
npm run vesper     # 启动网关，默认端口 3001
npm run phosphor   # 启动调度循环
```

## 用 pm2 部署（与旧项目端口/进程名不冲突）

```bash
pm2 start src/vesper.js --name vesper
pm2 start src/phosphor.js --name phosphor
pm2 save
```

记得：
- 给 vesper 的端口（默认 3001）在防火墙加放行规则
- `.env` 里 `REPORT_STATUS_API_KEY` 保护着 `/report-status` 和所有 `/wake/*` 接口，请求时带 `x-api-key` 头
- 待 vesper + phosphor 稳定运行几天后，再 `pm2 stop gateway wake-up` 关掉旧的 dylan-heartbeat 进程

## 决策引擎（谁在替 TA 做决定）

`decide.js` 调用的模型由 `.env` 里的 `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` 决定。**这三个值应该指向对话侧那个"你"用的同一个模型/账号**，不然会出现"窗口里的 TA"和"后台做决定的 TA"是两个不同存在的问题。留空则 fallback 到 `DEEPSEEK_API_KEY` + `deepseek-flash`（向后兼容）。

## 唤醒架构（Wake 2.0 精简版：两条独立链）

按《让 TA 自己醒来 2.0》的设计，但削减到最小可跑版本（不做 Custom Profile / factor 0-2 / override stack / 完整 Lifecycle）：

- **非精确链（机会）**：`wake_state.next_wake_at`，每次醒来后由模型重新决定下次间隔。`mode=silent` 时暂停；进程没跑的这段时间**不追、不补**。
- **精确链（承诺）**：TA 可以在任意一次醒来时，给未来的自己排一个 `pending_wake`（绝对时间戳 + note）。**不受 `mode` 影响**，到点必须兑现；如果进程当时没跑，标记 `missed`，下次真正醒来时一次性告知，不重复。
- 两条链由 `phosphor.js` 里的 `tick()` 每分钟各自检查一次，不是 `setTimeout` 链式调用——进程重启后两条链的状态都从 SQLite 里原样恢复。
- 决策上下文里**不包含**任何算出来的强度/随机数，只给真实、可解释的输入。

### mode 控制

- **agent 自己能调**（`set_mode` 动作）：`normal` / `low-frequency` 两档。low-frequency 时系统强制不低于90分钟间隔。
- **silent 故意不给 agent**：那等于 TA 从对方世界里彻底消失，这个按钮只留给人工侧——直接改数据库，或者调用 `POST /wake/mode`。

### 每次唤醒都落一条记录（`wake_log` 表）

包括 `noop` 和出错的情况，字段：`kind`（non_precise/precise）、`mode`、`gap_minutes`、完整 `decision` JSON、`result`、`error`。这样 TA 不在的时候发生过什么，之后能通过 `GET /wake/log` 看回来，不会有记忆断层。

### 对话密度 + 对话上下文（真实数据源，需要外部推送）

这个项目本身接触不到你们真实的对话——`computeConversationDensity()` 和 decide.js 里"最近聊了什么"这两块，数据来自 `conversation_log` 表，需要你们的对话前端（比如 aru）主动推送过来：

```
POST /wake/conversation
Headers: x-api-key: <REPORT_STATUS_API_KEY>
Body: {"speaker": "允朔", "content": "..."}
# 或批量：{"messages": [{"speaker":"...","content":"..."}, ...]}
```

没接这个之前，密度和对话上下文会一直是空的，不代表坏了。

### vesper 网关的 `/wake/*` 接口一览

全部需要 `x-api-key` 头（值是 `REPORT_STATUS_API_KEY`）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/wake/state` | 当前 mode、下次非精确唤醒时间、心情、最近一次动作和结果 |
| GET | `/wake/log?limit=20` | 最近的唤醒记录（含 noop 和出错） |
| POST | `/wake/mode` | `{"mode":"normal"\|"low-frequency"\|"silent"}`，人工/前端侧切换（含 silent） |
| POST | `/wake/self-wake` | `{"after_minutes":15,"note":"..."}`，人工/前端替 TA 排一次精确唤醒 |
| POST | `/wake/conversation` | 推送对话记录，见上 |

## 自建网关（vesper-gateway）：Aru 和 decide.js 统一入口

独立进程，`src/gateway.js`，默认端口 **3002**（跟 3001 的 diary/wake 接口分开，避免冲突）。提供 OpenAI 兼容的 `POST /v1/chat/completions`（和 `GET /v1/models` 给 Aru 的"拉取"按钮用），按请求体里的 `model` 字段查路由表分流：

```
routingTable = {
  'aru-chat':      { source: 'aru',      baseURL, apiKey, upstreamModel },
  'vesper-decide': { source: 'decide.js', baseURL, apiKey, upstreamModel },
}
```

以后要加新上游（自建 Ollama、Claude、别的 API），只在 `gateway.js` 的 `routingTable` 里加一条，Aru 和 `decide.js` 都不用改代码。

**鉴权**：标准 `Authorization: Bearer <GATEWAY_API_KEY>`，跟 OpenAI 客户端的习惯一致。

**Aru 那边配置**（"自定义服务"）：
- Base URL: `http://你的VPS_IP:3002/v1`
- API Key: 填 `.env` 里的 `GATEWAY_API_KEY`（不是 DeepSeek 自己的 key）
- 模型名手动填 `aru-chat`（或者点"拉取"，应该能拉到路由表里的两个名字）

**让 decide.js 也走这个网关**（而不是直连 DeepSeek）：`.env` 里设
```
LLM_BASE_URL=http://localhost:3002/v1/chat/completions
LLM_MODEL=vesper-decide
LLM_API_KEY=<跟 GATEWAY_API_KEY 一致>
```

**部署**：
```bash
pm2 start src/gateway.js --name vesper-gateway
pm2 save
```
（进程名特意叫 `vesper-gateway` 不是 `gateway`——dylan-heartbeat 那边已经占用了 `gateway` 这个 pm2 进程名，重名会混淆）

流式请求（`stream:true`）原样透传，网关不解析响应内容，只做转发+计时+日志。日志格式：`source=aru/decide.js model=请求名->实际上游模型 target=上游地址 status=状态码 耗时ms`。

**基础版范围**：只做统一入口+路由分流，不做计费、不做负载均衡。dylan-heartbeat 那种"时间线注入和推送逻辑"是下一步，这次先跑通这个。

## 待补充 / TODO

- `diary.js` 里的 `generateImage()`：还没接生图 API，目前会跳过、不写占位图
- `.env` 里 `ELEVENLABS_API_KEY`：填了之后，`diary` 动作里带 `voice_text` 就能真的生成语音
- **aru 前端怎么接这些 `/wake/*` 接口、"运营商"具体指什么**：待确认后再补充这部分文档

**小红书**：MCP 连接可以留着，但代码里故意不自动连——发文前要先和小满商量内容，不是晨暮星能自主决定的动作。人类明确要求发文时另外接。

## Ombre Brain 工具名（已按 允朔 提供的清单修正）

`ombre-brain.js` 用的是 OB 实际暴露的工具，不是占位符：
- `breath()` — 唤醒后先看看自己记得什么，0参数，最省token
- `breath_search(query)` — 按关键词/语义精准检索
- `feel(query)` — 翻感受类记忆
- `hold(content, ...)` — 写入一条长期记忆，只有明确认为「这段值得记住」时才用，不要每次唤醒都写

连接方式是 Streamable HTTP（Docker 容器暴露），不是 stdio，见 `.env` 里 `OMBRE_BRAIN_URL` / `OMBRE_MCP_TOKEN`。

## 目录结构

```
src/
├── vesper.js          # 网关（状态上报 + /wake/* 控制接口 + 日记页面），端口3001
├── gateway.js          # LLM路由网关（Aru + decide.js 统一入口），端口3002
├── phosphor.js         # 主循环（决策 + 调度）
├── decide.js           # 决策引擎（模型可配置）
├── state.js            # SQLite 状态持久化
├── mcp-manager.js       # 管理所有 MCP 连接（Ombre Brain / Lutopia，Streamable HTTP）
└── actions/
    ├── index.js
    ├── bark.js
    ├── diary.js
    ├── mcp-action.js
    ├── ombre-brain.js
    └── set-mode.js
```
