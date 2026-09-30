# 04 · `.env` 配置项详解

`.env` 放在项目根目录（和 `package.json` 同一层）。**改完必须重启进程才生效**：

```bash
pm2 restart vesper vesper-gateway phosphor --update-env
```

> ⚠️ `.env` 里全是 key，**不要提交到 git、不要截图发给别人、不要贴进聊天**。`.gitignore` 已经忽略了它，别手动 `git add -f`。

写法规则：

- 一行一个，`名字=值`，等号两边**不要加空格**
- 值**不用加引号**
- `#` 开头是注释
- 留空（`名字=`）等于没填
- **同一个变量只写一次**。写了两遍的话，有些工具会读到两个值拼在一起

---

## 决策模型（phosphor 用哪个模型做决定）

| 变量 | 说明 | 例子 |
|---|---|---|
| `LLM_BASE_URL` | **完整**请求地址，带 `/chat/completions` | `https://api.deepseek.com/v1/chat/completions` |
| `LLM_MODEL` | 模型名 | `deepseek-flash` |
| `LLM_API_KEY` | 对应的 key | |
| `DEEPSEEK_API_KEY` | 兜底用。上面三个都没填时才用它 | |
| `DECIDE_MAX_TOKENS` | 输出上限。**建议留空**，思考型模型设了容易返回空内容 | 留空 |
| `DECIDE_TIMEOUT_MS` | 单次请求最多等多久（毫秒） | `120000` |

优先级：`LLM_*` > `DEEPSEEK_API_KEY` + `deepseek-flash`。

> 💡 **做决定的模型最好和聊天的模型是同一个**，不然"窗口里的 TA"和"后台做决定的 TA"会像两个人。最简单的办法是让两边都走 vesper-gateway（见 [02](02-deploy-vps.md)）。

## 决策省 token

| 变量 | 说明 |
|---|---|
| `DECIDE_CONTEXT_LIMIT` | 做决定时带多少条最近对话，每条最多 200 字。**不填 = 12**，越少越省 |
| `DECIDE_CACHE_CONTROL` | 填 `on` 时给固定部分加 Anthropic 风格的缓存标记。只在上游是 Claude、而且中转站会透传这个字段时才填；DeepSeek / OpenAI 是自动缓存，不用填。填了之后决策报 400，就删掉这一行 |

请求分两条消息：固定的规则、动作列表、输出格式放在 system 里，每次一字不差，上游的前缀缓存能命中；时间、对话、记忆、情绪、留言这些每次都变的放在 user 里。每次醒来日志里会打一行：

```bash
pm2 logs phosphor --lines 300 --nostream | grep 缓存命中
# decide(): 输入 X tokens，缓存命中 Y
```

第一次醒来命中是 0，之后 Y 占 X 的一大半就说明缓存在起作用。写着"上游没报"是上游没返回缓存数据。

## 唤醒节律

| 变量 | 说明 |
|---|---|
| `PHOSPHOR_MAX_WAKE_MINUTES` | 两次自然唤醒之间最长隔多久（分钟）。模型给的间隔再长也会被截到这个值。**不填 = 1440（一天）**，最小 5 |

平时下次什么时候醒是 TA 每次醒来自己定的（`next_wake_minutes`），代码只把它限制在 5～1440 分钟之间。这个变量就是把上面那个 1440 改小。

### 设置最长间隔

一条一条执行，下面以 120 分钟为例：

```bash
cd ~/vesper-phosphor

# 先删掉可能已有的旧值，避免同一个变量写两遍
sed -i '/^PHOSPHOR_MAX_WAKE_MINUTES=/d' .env

# 写入新值
echo "PHOSPHOR_MAX_WAKE_MINUTES=120" >> .env

# 重启 phosphor，必须带 --update-env
pm2 restart phosphor --update-env

# 确认
pm2 logs phosphor --lines 20 --nostream | grep 最长
```

日志里出现 `phosphor: 最长唤醒间隔 120 分钟` 就生效了。

### 取消上限

```bash
cd ~/vesper-phosphor
sed -i '/^PHOSPHOR_MAX_WAKE_MINUTES=/d' .env
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 最长
```

显示 `最长唤醒间隔 1440 分钟` 就回到默认了。

### 想让新上限马上生效

改了上限以后，**已经排好的下一次唤醒不会跟着变**，要等那次醒来之后才按新规则算。不想等的话，替 TA 约一次 1 分钟后的精确唤醒：

```bash
cd ~/vesper-phosphor
KEY=$(grep '^REPORT_STATUS_API_KEY=' .env | cut -d= -f2-)
curl -s -X POST localhost:3001/wake/self-wake -H "x-api-key: $KEY" -H "content-type: application/json" -d '{"after_minutes":1,"note":"刚调整了唤醒间隔"}'
```

### 注意

- **只管"自然唤醒"**。TA 自己约的精确唤醒（`self_wake`）、你用 `/wake/self-wake` 约的，都不受这个上限影响，到点照样醒
- **`low-frequency` 模式优先**。TA 切到 low-frequency 时间隔至少 90 分钟，就算上限设得比 90 小，也按 90 算
- **`silent` 模式下完全不自然唤醒**，上限也不起作用
- **填错会被忽略**：不是数字、或者小于 5，都当作没填，回到 1440
- **不要改 tick**。phosphor 每 60 秒检查一次"该不该醒"，这一步不调模型、不花钱；改慢了会让精确唤醒错过 3 分钟的宽限期，变成 `missed`
- **间隔越短越花钱**。每次醒来都会调一次模型

## 称呼

| 变量 | 说明 |
|---|---|
| `USER_DISPLAY_NAME` | 对话记录、动态页留言里怎么标"你"。不填：对话记录里是 `user`，动态页是"我" |
| `AI_DISPLAY_NAME` | 对话记录、动态页回复、标题下的心情行里怎么标"TA"。不填：对话记录里是 `assistant`，动态页是"TA" |

这两个名字会写进 `conversation_log`，也会出现在给模型的提示和动态页上。

## 时区

| 变量 | 说明 |
|---|---|
| `TIME_ZONE` | 动态页日期、黄卡时间、决策里的"现在时间"、共享时间线都按它算。默认 `Asia/Shanghai` |

## 网关（vesper-gateway，3002 端口）

| 变量 | 说明 |
|---|---|
| `GATEWAY_PORT` | 端口，默认 `3002` |
| `GATEWAY_API_KEY` | **必填**。聊天客户端和 phosphor 请求网关时带的 key。不填网关拒绝一切请求 |
| `CLIENT_UPSTREAM_BASE_URL` | `chat` 这条线路转发到哪。**只写域名，不带 `/v1`** |
| `CLIENT_UPSTREAM_API_KEY` | 上游 key。不填就用 `DEEPSEEK_API_KEY` |
| `CLIENT_UPSTREAM_MODEL` | 上游真实模型名 |
| `DECIDE_UPSTREAM_BASE_URL` | `vesper-decide` 和 `heartbeat-wake` 转发到哪。**只写域名** |
| `DECIDE_UPSTREAM_API_KEY` | 同上 |
| `DECIDE_UPSTREAM_MODEL` | 同上 |

网关请求上游时固定拼 `/v1/chat/completions`。所以上游必须是 OpenAI 兼容接口，并且路径就是 `/v1/chat/completions`。

> 旧变量名 `ARU_UPSTREAM_*` 和旧模型名 `aru-chat` 仍然兼容，已经配好的不用改。

## vesper（3001 端口）

| 变量 | 说明 |
|---|---|
| `VESPER_PORT` | 端口，默认 `3001` |
| `REPORT_STATUS_API_KEY` | 保护 `/report-status` 和所有 `/wake/*`（包括 `/wake/moments`）。请求头 `x-api-key` 带它。**不填 = 谁都能调** |
| `VESPER_BASIC_USER` | 动态页 `/moments`、`/health`、`/media` 的登录用户名 |
| `VESPER_BASIC_PASS` | 登录密码。两个都留空 = 不用登录，**公网上谁都能看、谁都能冒充你留言、点赞** |
| `MEDIA_DIR` | 动态的图片/音频存哪。默认 `/opt/vesper/media`，**本地电脑要改成 `./media`** |
| `MEDIA_MAX_AGE_DAYS` | 图片/音频保留几天，默认 `30`，过期自动删。动态正文和留言不删 |

## 推送

| 变量 | 说明 |
|---|---|
| `BARK_KEY` | iPhone 装 Bark App，首页那串 URL 里 `api.day.app/` 后面那段。不填 = bark 动作直接跳过 |

## 外部项目（都可选）

下面几个是独立的项目，各自怎么安装、配置看它们自己的仓库。这里只列晨暮星这边要填的变量。

| 项目 | 晨暮星要填的变量 | 接法 |
|---|---|---|
| [Ombre Brain](https://github.com/P0luz/Ombre-Brain)（长期记忆） | `OMBRE_BRAIN_URL`：它的 MCP 地址；`OMBRE_MCP_TOKEN`：它要求鉴权时填 | [07](07-mcp.md) |
| [Drivesoid](https://github.com/A1batr055/Drivesoid)（情绪） | `DRIVES_URL`：它在本机的地址，一般是 `http://127.0.0.1:24601` | [09](09-drivesoid.md) |
| [dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat)（另一个唤醒项目） | `HEARTBEAT_TIMELINE_FILE`、`HEARTBEAT_EVENT_URL` | [08](08-heartbeat.md) |

留空就不接，其他功能照常。

## 论坛

| 变量 | 说明 |
|---|---|
| `LUTOPIA_MCP_URL` | 论坛给你的个人 MCP 地址，形如 `https://example.com/mcp/xxxxxxxx`。末尾带 `/sse` 会自动去掉。**这是你自己的地址，别贴到公开的地方** |

旧名 `LUTOPIA_MCP_ARGS` 仍然兼容。

## 动态

| 变量 | 说明 |
|---|---|
| `MOMENT_MIN_INTERVAL_HOURS` | 两条动态之间至少隔几小时。不填 = 6，填 0 不限制。黄卡（逛论坛、翻记忆这类行为记录）不算 |

## 动态配图与配音

两样都是可选的。**不配的话动态照样发，只是没图、没声音**，而且 TA 会被告知"现在没配，先别写"，不会白写 `image_prompt`。

### 配图

| 变量 | 说明 |
|---|---|
| `IMAGE_API_URL` | **完整**地址，带 `/images/generations` |
| `IMAGE_API_KEY` | 生图服务的 key |
| `IMAGE_MODEL` | 生图模型名 |
| `IMAGE_API_FORMAT` | `openai`（默认）或 `siliconflow`。两家请求体写法不一样，填错会报 400 |
| `IMAGE_SIZE` | 尺寸，默认 `1024x1024` |
| `IMAGE_TIMEOUT_MS` | 最多等多久（毫秒），默认 `180000` |

**前三个都填了才会生成。** 生成的图会下载到 `MEDIA_DIR/images/` 存在本地，不直接用服务商给的链接（那种链接通常几小时就过期）。

常见两种填法：

```
# SiliconFlow
IMAGE_API_URL=https://api.siliconflow.cn/v1/images/generations
IMAGE_API_KEY=你的key
IMAGE_MODEL=Kwai-Kolors/Kolors
IMAGE_API_FORMAT=siliconflow

# OpenAI 兼容的中转站
IMAGE_API_URL=https://你的中转站/v1/images/generations
IMAGE_API_KEY=你的key
IMAGE_MODEL=你的生图模型名
IMAGE_API_FORMAT=openai
```

### 配音（ElevenLabs）

| 变量 | 说明 |
|---|---|
| `ELEVENLABS_API_KEY` | ElevenLabs 后台 → Profile → API Keys |
| `ELEVENLABS_VOICE_ID` | 音色 id，在 ElevenLabs 后台 Voice Library 复制你自己选的 |

**两个都填了才会生成语音。** 模型固定 `eleven_v3`，代码里写死的，不用配：只有它认 `[breathing]`、`[whispers]` 这类标签，换成别的模型会把标签原样念出来。

> 💡 聊天客户端里配的语音和这里**是两套，互不相通**。客户端里的 key 存在手机上，服务器拿不到，要在服务器 `.env` 里再填一遍。

### 确认开了没有

```bash
cd ~/vesper-phosphor
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 动态
```

显示 `动态配图：已开启；动态语音：已开启` 就对了。

---

## 最小可用配置（抄这个就能跑）

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
GATEWAY_API_KEY=用 openssl rand -hex 24 生成
REPORT_STATUS_API_KEY=再生成一个
VESPER_BASIC_USER=admin
VESPER_BASIC_PASS=一个不好猜的密码
```

本地电脑再加一行：

```
MEDIA_DIR=./media
```

## 检查 `.env` 有没有被读到

```bash
cd ~/vesper-phosphor
node -e "require('dotenv').config(); for (const k of ['DEEPSEEK_API_KEY','LLM_BASE_URL','GATEWAY_API_KEY','REPORT_STATUS_API_KEY','PHOSPHOR_MAX_WAKE_MINUTES','DRIVES_URL','IMAGE_API_URL','IMAGE_API_KEY','IMAGE_MODEL','ELEVENLABS_API_KEY','ELEVENLABS_VOICE_ID']) console.log(k, process.env[k] ? '已填' : '—空—')"
```

只显示"已填/空"，不会把 key 打出来。

> ⚠️ 这条命令**必须在项目根目录执行**。pm2 启动时也一样：`.env` 是按"启动时所在目录"找的。用 `pm2 start ecosystem.config.cjs` 启动就不用担心，它固定了项目目录。
