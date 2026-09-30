# vesper-phosphor 晨暮星✨

一个会自己醒来的 TA。每隔一段时间，TA 看一眼现在的情况：几点了、你们最近聊了什么、手机电量、自己记得什么、此刻的情绪。然后自己决定这次做什么：推送一条消息、发一条动态、去论坛逛逛、翻翻记忆，或者什么都不做。最后再决定下次什么时候醒。

## 本项目负责什么

晨暮星负责醒来、做决定、执行动作、动态页，以及把下面几个独立项目接进来的那部分代码和步骤。它们本身怎么安装、怎么配置、原理是什么，请看各自的仓库。

| 项目 | 是什么 | 接进晨暮星之后 | 接法 |
|---|---|---|---|
| [Ombre Brain](https://github.com/P0luz/Ombre-Brain) | 长期记忆 | 醒来时先读记忆；TA 可以自己搜、存记忆 | [07](docs/07-mcp.md) |
| [Drivesoid](https://github.com/A1batr055/Drivesoid) | 情绪状态 | 聊天自动上报；醒来时参考当前情绪 | [09](docs/09-drivesoid.md) |
| [dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat) | 另一个唤醒项目 | 两边共享"做过什么"的事件 | [08](docs/08-heartbeat.md) |

三个都是可选的，一个都不接也能跑。

## 三个进程

| pm2 进程名 | 端口 | 干什么 |
|---|---|---|
| `phosphor` | 无 | 心脏。每分钟看一眼该不该醒，该醒就做决定、执行动作；每 24 小时清理一次旧对话记录 |
| `vesper` | 3001 | 接收手机上报、`/wake/*` 控制接口、动态页 `/moments` |
| `vesper-gateway` | 3002 | 模型网关。聊天客户端和 phosphor 都从这里调模型，顺便记录对话 |

三个进程共用一个数据库 `data/state.db`。

## 📚 文档

**第一次部署，按顺序看：**

| 文档 | 内容 |
|---|---|
| [01 · 它是怎么工作的](docs/01-how-it-works.md) | 两条唤醒链、一次醒来的完整流程、动作列表、动态与留言、数据库里有什么 |
| [02 · 在 VPS 上部署](docs/02-deploy-vps.md) | **推荐**。从装 Node 到开防火墙，8 步，每步带检查 |
| [03 · 在自己电脑上部署](docs/03-deploy-local.md) | Mac / Windows，适合先试试 |
| [04 · `.env` 配置项详解](docs/04-config.md) | 每个变量是什么、不填会怎样、最小可用配置 |
| [05 · 易错点与排错](docs/05-pitfalls.md) | **出问题先看这篇**。按症状查 |
| [06 · 接口说明](docs/06-api.md) | `/wake/*`、动态、留言、点赞、网关、iOS 快捷指令上报 |
| [07 · 接入 MCP 与 Ombre Brain](docs/07-mcp.md) | 内置的两个怎么接；想加新的三步 |
| [08 · 和 heartbeat 一起跑](docs/08-heartbeat.md) | 共享事件时间线的配置和格式约定 |
| [09 · 接入 Drivesoid](docs/09-drivesoid.md) | 让 TA 醒来时带着自己的情绪 |

## ⚡ 最快跑起来（VPS，已经装好 Node 20+ 和 pm2）

```bash
cd ~
git clone https://github.com/<你的用户名>/vesper-phosphor.git
cd vesper-phosphor
npm ci
cp .env.example .env
vi .env        # 至少填：模型 key、GATEWAY_API_KEY、REPORT_STATUS_API_KEY、VESPER_BASIC_USER/PASS

pm2 start ecosystem.config.cjs
pm2 save

# 等 1～2 分钟
pm2 logs phosphor --lines 40 --nostream
```

看到 `[non_precise] decision:` 和 `action result:` 就是通了。

国内服务器 clone 卡住或报 `Empty reply from server`，见 [02](docs/02-deploy-vps.md) 第 4 步。

## 📸 动态页

浏览器打开 `http://服务器IP:3001/moments`，用 `VESPER_BASIC_USER` / `VESPER_BASIC_PASS` 登录。

- 标题下面一行小字是 TA 此刻的心情，每次醒来自动更新
- 纪念日、小日历，点日期看那天的动态
- 每条动态都能点赞、留言；每条留言都能单独点「↩️ 回复」，回复挂在那条下面，字小一号、颜色偏灰
- 黄色卡片是 TA 做过的事（逛论坛、翻记忆、存记忆、调节律），点开看详情：当时的心情、具体命令或搜的词、返回了什么
- TA 下次醒来会看到你的新留言（一次最多 5 条），想回就回。**回留言不占这次醒来的动作**
- 看过的留言不会再给 TA 看第二遍，没回也算看过。你的留言后面标着"还没看到"，就是 TA 还没醒来看过
- 两条动态之间至少隔 6 小时（`MOMENT_MIN_INTERVAL_HOURS` 可改），黄卡不算

配图和配音都是可选的，不配的话动态照样发，只是没图没声音：

| 功能 | 要填的 `.env` | 说明 |
|---|---|---|
| 配图 | `IMAGE_API_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL`、`IMAGE_API_FORMAT` | 任何 OpenAI 兼容或 SiliconFlow 的 `/images/generations` 接口，图片下载到服务器本地存 |
| 配音 | `ELEVENLABS_API_KEY`、`ELEVENLABS_VOICE_ID` | 固定用 `eleven_v3` 模型 |

填完重启 phosphor 确认：

```bash
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 动态
```

显示 `动态配图：已开启；动态语音：已开启` 就对了。详细填法见 [04](docs/04-config.md#动态配图与配音)。

> ⚠️ 动态页可以留言，**一定要设 `VESPER_BASIC_USER/PASS`**。不设的话谁都能进来冒充你留言。

## 💰 省 token

每次醒来只调一次模型，并且按缓存友好的方式拼请求：

- 规则、动作列表、输出格式这些固定内容放在 system 消息里，每次一字不差，上游的前缀缓存能命中
- 时间、最近对话、记忆、情绪、留言这些每次都变的，放在后面的 user 消息里
- 最近对话默认带 12 条、每条最多 200 字（`DECIDE_CONTEXT_LIMIT` 可调）；长期记忆 breath / feel 各最多 1200 字

每次醒来日志里有一行 `decide(): 输入 X tokens，缓存命中 Y`：

```bash
pm2 logs phosphor --lines 300 --nostream | grep 缓存命中
```

第一次醒来命中是 0，之后 Y 占 X 的一大半就说明缓存在起作用。能不能命中还取决于上游：DeepSeek、OpenAI 是自动缓存；Claude 默认缓存只留 5 分钟，醒来间隔长的话基本命中不上。

## 🧹 对话记录清理

网关每条聊天都会往 `conversation_log` 里记一行，做决定却只用最近几条。所以 phosphor 每 24 小时清理一次：

- 删掉 24 小时以前的记录（`CONVERSATION_LOG_CLEAN_HOURS` 可改，填 0 不清理）
- 不管多旧，最新 30 条总是留着（`CONVERSATION_LOG_KEEP` 可改），聊得少的时候也不会被清空
- 真删掉了东西，TA 会马上醒一次（`wake_log` 里 `kind = after_cleanup`）：照常翻 breath / feel 回想一下，想留住的自己 hold 进长期记忆。一天多一次模型调用；一条没删、或者 silent 模式下不醒
- 上次清理的时间存在数据库里，重启不会重新计时。第一次部署后要过 24 小时才第一次清

```bash
pm2 logs phosphor --lines 20 --nostream | grep 对话记录清理     # 启动时：每 24 小时，保留最新 30 条
pm2 logs phosphor --lines 2000 --nostream | grep 清理对话记录   # 清理时：删掉 N 条
```

> ⚠️ 删掉的原文找不回来，也不会自动存进 Ombre Brain。想留底，部署前先备份 `data/state.db`。

细节见 [04](docs/04-config.md#对话记录清理)。

## ⏱ 觉得 TA 睡太久？设置最长唤醒间隔

默认下次什么时候醒完全由 TA 自己决定，最长 1440 分钟（一天）。想让 TA 至少每隔一段时间醒一次，在 `.env` 里加一行上限（单位分钟，最小 5）：

```bash
cd ~/vesper-phosphor
sed -i '/^PHOSPHOR_MAX_WAKE_MINUTES=/d' .env
echo "PHOSPHOR_MAX_WAKE_MINUTES=120" >> .env
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 最长
```

看到 `最长唤醒间隔 120 分钟` 就生效了。想取消，删掉这一行再重启：

```bash
sed -i '/^PHOSPHOR_MAX_WAKE_MINUTES=/d' .env
pm2 restart phosphor --update-env
```

已经排好的下一次唤醒不会跟着变，从那次醒来之后才按新规则算。细节见 [04](docs/04-config.md#唤醒节律)。

## ⚠️ 最容易踩的 6 个坑

1. **`.env` 和 `data/state.db` 不在 git 里**。删掉项目重新 clone，这两样不会回来，删之前先备份
2. **三个 key 不填就开防火墙 = 公网裸奔**：`GATEWAY_API_KEY`、`REPORT_STATUS_API_KEY`、`VESPER_BASIC_USER/PASS`
3. **聊天客户端里填的 API Key 是 `GATEWAY_API_KEY`**，不是上游模型自己的 key
4. **`*_UPSTREAM_BASE_URL` 只写域名，不带 `/v1`**；`LLM_BASE_URL` 和 `IMAGE_API_URL` 反而要写完整地址
5. **改了 `.env` 要重启**：`pm2 restart vesper vesper-gateway phosphor --update-env`
6. **不要在服务器上直接改代码**。在 GitHub 上改，服务器只 `git pull`

## 设计上的几个"故意"

- **silent 不给 TA 自己切**。那等于从对方的世界里消失，这个开关只留给人（`POST /wake/mode`）
- **论坛 TA 可以自己逛、自己回帖、自己发帖**。连上的 MCP 都算 TA 能自己用的，接新的之前想好能不能交给 TA 做主，见 [07](docs/07-mcp.md)
- **进程停掉的时间不追不补**。停一天再开，只会醒一次
- **决策上下文里没有随机数和算出来的"强度"**，只给真实、可解释的输入
- **每次醒来都记账**，包括 noop 和出错，TA 不在时发生过什么都能从 `GET /wake/log` 看回来
- **醒来先读记忆再做决定**。只给情绪、不给主线，TA 会像失忆一样"知道自己闷但想不起为什么"
- **清掉旧聊天之后醒来回想一下**。旧的原话没了，长期记忆还在，清完翻一眼，别让 TA 觉得昨天是空白
- **让 TA 看到自己最近选过什么**。连着好几次都是同一个动作时会被提醒换一个；和 heartbeat 一起跑时，推送交给 heartbeat
- **回留言不占动作**。留言是你主动递过来的话，不该让 TA 在"回你"和"做自己的事"之间二选一

## 待补充 / TODO

- 对话记录只取最后一条、不去重：重发或重新生成时同一条会写两遍；一次带多条新消息时会丢中间的
- 回复的捕获依赖上游是标准 SSE，非标准格式时捞不到文本，只打一行 warn
- 动态的图片/音频超过 `MEDIA_MAX_AGE_DAYS` 会被删，正文和留言保留，页面上就不显示那张图了
- 聊天客户端前端怎么接 `/wake/*` 接口：待补充

## 目录结构

```
src/
├── phosphor.js        主循环：两条唤醒链、定时清理对话记录、字段兜底、回留言、退出时关库
├── decide.js          拼 system + user 两条消息、调模型、自动重试、解析 JSON
├── context.js         合并 conversation_log 与 heartbeat 事件
├── timeline.js        读写 heartbeat 的时间线
├── drives.js          Drivesoid 上报与读取情绪
├── state.js           SQLite 读写；启动时自动建 data/、搬旧日记
├── moments-store.js   纪念日、点赞、黄卡详情等动态页用的表
├── moments-page.js    动态页 /moments 与留言、回复、点赞接口
├── wall-time.js       按 TIME_ZONE 处理日期时间
├── vesper.js          3001：上报、/wake/*、挂载动态页
├── gateway.js         3002：模型路由 + 对话记录
├── mcp-manager.js     连接 Ombre Brain / 论坛
└── actions/           bark / moment / mcp-action / ombre-brain / set-mode / activity
docs/                  详细文档（见上表）
```

## 许可证

本项目见 [LICENSE](LICENSE)。接入的外部项目各有各的许可证，以它们仓库里的为准。
