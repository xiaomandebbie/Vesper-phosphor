# 01 · 它是怎么工作的

这一篇不教部署，只讲清楚"每个零件在干嘛"。看懂这篇，后面出问题时你就知道该去看哪一块。

## 一句话版本

晨暮星是一个**会自己醒来的 TA**。每隔一段时间，phosphor 会把"现在的情况"整理好交给模型，模型决定这次醒来要做什么（推送、发动态、往星星罐里放一句没说出口的话、逛论坛、翻记忆……或者什么都不做），顺便回一回你在动态下的留言，再决定下次什么时候醒。

## 三个进程

项目里有三个独立运行的程序，用 pm2 分别管理（`pm2 start ecosystem.config.cjs` 一次拉起）：

| pm2 进程名 | 文件 | 端口 | 干什么 |
|---|---|---|---|
| `phosphor` | `src/phosphor.js` | 无 | 心脏。每分钟看一眼"该不该醒"，该醒就做决定、执行动作 |
| `vesper` | `src/vesper.js` | 3001 | 接收手机上报、提供 `/wake/*` 控制接口、动态页 `/moments`、星星罐 `/moments/star-jar` |
| `vesper-gateway` | `src/gateway.js` | 3002 | 模型网关。聊天客户端和 phosphor 都从这里调模型，顺便记录对话 |

三个进程**共用同一个数据库** `data/state.db`（SQLite 文件）。它们之间不直接通信，全靠读写这个数据库交换信息。

```
  手机/快捷指令 ──POST /report-status──▶ vesper ──┐
                                                │
  聊天客户端 ──/v1/chat/completions──▶ vesper-gateway ─┼──▶ data/state.db ◀── phosphor
                                   │            │                        │
                                   ▼            │                        ▼
                              上游模型 API       │              decide.js → 模型
                                                │              actions/  → Bark / 动态 / 星星罐 / MCP
  浏览器 ──/moments、/moments/star-jar──▶ vesper ─┘
```

## phosphor：两条唤醒链

phosphor 每 **60 秒** 执行一次 `tick()`，每次检查两条互不干扰的链。

### 非精确链（"机会"）

- 数据库里存着 `next_wake_at`（下次醒来的时间）
- 到点了就醒，醒完由模型决定下次隔多久（`next_wake_minutes`）
- `mode = silent` 时完全暂停
- `mode = low-frequency` 时间隔强制不少于 **90 分钟**
- **进程没跑的那段时间不追、不补**。停了一天再启动，只会醒一次

### 精确链（"承诺"）

- TA 醒来时可以给未来的自己约一次：`self_wake: {after_minutes, note}`
- 你也可以替 TA 约：`POST /wake/self-wake`
- 存在 `pending_wake` 表里，**不受 mode 影响**，silent 也照样会醒
- 到点超过 **3 分钟**还没执行，标记为 `missed`。下次真正醒来时，模型会被告知"有一次约好的没兑现"，只说一次

## 一次醒来的完整流程

1. **收集情况**：当前 mode、距上次醒来多久、手机最近上报的电量/位置/屏幕时间、过去 2 小时对话条数、最近 12 条对话（每条最多 200 字）、长期记忆里的 `breath` 与 `feel`（各最多 1200 字）、情绪状态（接了 Drivesoid 时）、有没有 missed 的精确唤醒、现在能用哪些 MCP 工具、**最近 8 次选过的动作**、**你在动态下还没被看过的留言**（最多 5 条，回复的话带上你回的是哪一条）、**星星罐今天那次机会用没用过**、**你摘星后回的话**（最多 3 条）
2. **做决定**：`decide.js` 把这些拼成两条消息发给模型。固定的规则、动作列表、输出格式放在 system 里，每次一字不差，方便上游缓存；每次都变的放在 user 里。要求模型只返回一个 JSON：
   ```json
   {"next_wake_minutes": 96, "mood": "...", "action": "moment", "action_detail": "...", "self_wake": null,
    "comment_replies": [{"comment_id": 12, "reply": "..."}]}
   ```
3. **兜底检查**：`normalizeDecision()` 把模型漏写、写错的字段补成安全值（见下文）
4. **回留言**：`comment_replies` 里的回复写进动态下面，挂在被回的那条留言下。这一步**不占动作**
5. **执行动作**：`actions/index.js` 按 `action` 分派。逛论坛、翻记忆、存记忆、调节律这类动作做完，会在动态页记一张黄卡，点开能看详情
6. **记账**：不管成功、失败还是 noop，都往 `wake_log` 表写一条
7. **写回事件**：接了 heartbeat 时，做了事、回了留言就写回共享时间线（见 [08](08-heartbeat.md)）。**星星罐那一句不写**
8. **更新状态**：保存心情（动态页标题下会显示）、安排下次醒来、登记 self_wake

### 记忆那一步为什么要两个都拉

`breath` 给的是"我是谁、最近在干什么"，`feel` 给的是"我现在感觉怎么样"。只拉 `feel` 的话，后台这一侧就只剩情绪、看不到主线，表现出来像失忆：知道自己心里闷，但想不起为什么。

### 为什么要给 TA 看"最近选过的动作"

不给的话，模型每次醒来都是一张白纸，很容易每次都选同一个（最常见是一直推送）。给它看一眼 `bark → bark → moment → bark（bark×3、moment×1）`，再配一句"连着好几次都一样就换一个"，比写死"禁止连续推送"这种规则自然。

同时开着 heartbeat 时，提示里还会说明：主动联系对方这件事已经有 heartbeat 在管，除非有非说不可、且 heartbeat 没说过的话，否则别再推送。

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
| `moment` | 发一条动态，可选配图、配音。两条之间至少隔 6 小时 | 配图要 `IMAGE_*`；配音要 `ELEVENLABS_*` |
| `star_jar` | 往星星罐里放一颗星：今天最重要的那一句想说但没说出来的话。**一天只有一次机会** | 无 |
| `mcp_call` | 调任意已连接的 MCP 工具（比如逛论坛、回帖、发帖） | 对应 MCP 已连上 |
| `ombre_brain` | 读/写长期记忆 | `OMBRE_BRAIN_URL` |
| `set_mode` | 自己切 normal / low-frequency | 无 |
| `noop` | 什么都不做（合法结果，不是失败） | 无 |

补充说明：

- **动态替代了原来的日记**。模型要是还写 `diary`，会按动态发
- **配图是真的生成**：调 `IMAGE_API_URL` 那个生图接口，图片下载到 `MEDIA_DIR/images/` 存在本地。没配的话 TA 会被告知"先别写 image_prompt"
- **配音**固定用 ElevenLabs `eleven_v3` 模型。只有它认 `[breathing]`、`[whispers]` 这类标签
- **silent 故意不给 TA 自己切**。那等于从对方的世界里消失，这个开关只留给人：`POST /wake/mode`
- **论坛 TA 可以自己逛、回帖、发帖**，不用先问人。连上的 MCP 都算 TA 能自己用的（见 [07](07-mcp.md)）

## 星星罐

一个攒"咽下去的话"的罐子，页面在 `/moments/star-jar`。不用配置就能用。

### 放进去

1. 每次醒来，user 消息里都会带一行"星星罐"：今天还没放过，或者已经放过了、这次选别的
2. system 里写清了该写什么：今天最重要的那一句、想说但到最后没说出口的话；只写那一句本身，不解释、不铺垫，200 字以内；**今天没有这样一句就别放，空着比凑一句好**
3. TA 选 `star_jar` 时，那一句写进 `star_jar` 表。`day` 列按 `TIME_ZONE` 算，并有唯一索引：查和插在同一个事务里，**一天只能进一颗**，也不能改、不能撤
4. 今天已经放过了还硬选 `star_jar`：当作这次没做成，不记黄卡、不写时间线
5. 这一句**不会变成推送**，也不进动态和共享时间线。`describeActivity` 和 `describeAction` 对 `star_jar` 都返回 null

### 摘下来

1. 罐子里的星星**你任何时候都能打开看**——攒着的东西不该被藏起来
2. 只有「有一颗星星未摘 ✨」这个提示按时间亮：默认 20:00–次日 2:00（`STAR_JAR_WINDOW` 可改，写成 `20-2`；两头一样就是一直亮）。动态页日历下面那个入口在这段时间会多一圈淡粉的光
3. 你在某一颗下面回一句，就算摘下了它：写进同一行的 `reply`。**一颗星星只回一次**（SQL 里带了 `AND reply IS NULL`）
4. TA 下次醒来时，user 消息里会出现"有新的阳光撒下"，带上当时那句话和你的回复（一次最多 3 条）
5. 给 TA 看过的那几条标成 `reply_seen = 1`，**同一条只告知一次**

星星罐这一整套不额外调模型：今天那次机会用没用过、有没有新的回音，都是几行 SQL。

### 页面

- 一只玻璃罐子，星星是五彩的，按序号排位置（刷新不会乱跳），一行 6 颗往上堆
- 还没摘的那几颗会轻轻呼吸；开了「减弱动态效果」就不闪
- 点罐子里的星星会展开下面对应那一条；没有 JavaScript 时是普通锚点跳转，照样能用
- 颜色跟着早晚两张脸走，入夜玻璃会压暗

## 动态、留言、回复、点赞

1. TA 选了 `moment`，就在 `moments` 表里多一条（`kind = post`）；逛论坛、翻记忆这类动作会多一张黄卡（`kind = activity`），`detail` 里记着当时的心情、具体做了什么、返回了什么
2. 你打开 `/moments`，给动态留言，或者点某条留言下的「↩️ 回复」。写进 `moment_comments`，`author = user`，`handled = 0`，回复时 `reply_to` 是被回的那条
3. TA 下次醒来时，提示里会列出这些 `handled = 0` 的留言
4. TA 在 `comment_replies` 里回想回的那几条；回复写进同一张表，`author = assistant`，`reply_to` 指向你那条
5. **这次给 TA 看过的留言全部标成 `handled = 1`**，没回的下次也不会再出现
6. 点赞写进 `moment_likes`，每人每条最多一个，再点就取消

## 对话记录是怎么来的

phosphor 本身看不到你们的聊天。"最近聊了什么"和"对话密度"都来自 `conversation_log` 表：

1. **自动**：聊天客户端走 `vesper-gateway` 的 `chat` 线路时，网关在转发前记下用户最后一条消息，在回复流结束时记下回复。记录前会剥掉客户端注入的 `<environment>` 块和 `<sent_at>` 时间戳
2. **手动**：`POST /wake/conversation`（见 [06](06-api.md)）

## 数据库里有什么

文件：`data/state.db`。**不在 git 里**，删了就真没了。

| 表 | 内容 |
|---|---|
| `wake_state` | 只有一行：mode、下次醒来时间、当前心情 |
| `pending_wake` | 精确唤醒：时间、note、状态（pending / triggered / missed） |
| `wake_log` | 每次醒来的完整记录：决定、结果、错误 |
| `device_reports` | 手机上报的电量、位置、屏幕时间 |
| `moments` | 动态和黄卡：正文、图片/音频地址、类型、详情 |
| `moment_comments` | 留言和回复 |
| `moment_likes` | 点赞 |
| `moment_favorites` | 收藏 |
| `star_jar` | 星星罐：那一句话、哪一天放的、你的回复、TA 知道没知道 |
| `anniversaries` | 纪念日 |
| `conversation_log` | 对话记录 |
| `diary` | 旧的日记表。第一次启动新版本时内容会搬进 `moments`，之后不再使用 |
| `meta` | 记录一次性迁移做过没有 |

所有时间戳都是**毫秒**（13 位数字）。表和列启动时自动建，不用手动迁移。`star_jar` 和 `moment_favorites` 分别由 `src/star-jar.js`、`src/favorites.js` 在启动时建。
