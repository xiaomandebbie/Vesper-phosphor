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

## 称呼

| 变量 | 说明 |
|---|---|
| `USER_DISPLAY_NAME` | 对话记录里怎么标"对方说的话"。不填是 `user` |
| `AI_DISPLAY_NAME` | 对话记录里怎么标"TA 说的话"。不填是 `assistant` |

这两个名字会写进 `conversation_log`，也会出现在给模型的 prompt 里。

## 网关（vesper-gateway，3002 端口）

| 变量 | 说明 |
|---|---|
| `GATEWAY_PORT` | 端口，默认 `3002` |
| `GATEWAY_API_KEY` | **必填**。聊天客户端和 phosphor 请求网关时带的 key。不填网关拒绝一切请求 |
| `CLIENT_UPSTREAM_BASE_URL` | `chat` 这条线路转发到哪。**只写域名，不带 `/v1`** |
| `CLIENT_UPSTREAM_API_KEY` | 上游 key。不填就用 `DEEPSEEK_API_KEY` |
| `CLIENT_UPSTREAM_MODEL` | 上游真实模型名 |
| `DECIDE_UPSTREAM_BASE_URL` | `vesper-decide` 转发到哪。**只写域名** |
| `DECIDE_UPSTREAM_API_KEY` | 同上 |
| `DECIDE_UPSTREAM_MODEL` | 同上 |

网关请求上游时固定拼 `/v1/chat/completions`。所以上游必须是 OpenAI 兼容接口，并且路径就是 `/v1/chat/completions`。

> 旧变量名 `ARU_UPSTREAM_*` 和旧模型名 `aru-chat` 仍然兼容，已经配好的不用改。

## vesper（3001 端口）

| 变量 | 说明 |
|---|---|
| `VESPER_PORT` | 端口，默认 `3001` |
| `REPORT_STATUS_API_KEY` | 保护 `/report-status` 和所有 `/wake/*`。请求头 `x-api-key` 带它。**不填 = 谁都能调** |
| `VESPER_BASIC_USER` | 日记页 `/diary`、`/health`、`/media` 的登录用户名 |
| `VESPER_BASIC_PASS` | 登录密码。两个都留空 = 不用登录，公网上谁都能看 |
| `MEDIA_DIR` | 日记音频/图片存哪。默认 `/opt/vesper/media`，**本地电脑要改成 `./media`** |
| `MEDIA_MAX_AGE_DAYS` | 媒体文件保留几天，默认 `30`，过期自动删 |

## 推送

| 变量 | 说明 |
|---|---|
| `BARK_KEY` | iPhone 装 Bark App，首页那串 URL 里 `api.day.app/` 后面那段。不填 = bark 动作直接跳过 |

## 长期记忆 Ombre Brain

| 变量 | 说明 |
|---|---|
| `OMBRE_BRAIN_URL` | 形如 `http://localhost:18001/mcp`。端口看 `docker ps` 里映射到宿主机的那个 |
| `OMBRE_MCP_TOKEN` | OB Dashboard → 设置 → MCP 鉴权 → 选"OAuth + 静态 Token 共存"生成 |

不填 URL：phosphor 不连 Ombre Brain，`breath` 和 `feel` 都是"暂无"，`ombre_brain` 动作会跳过。

## 论坛

| 变量 | 说明 |
|---|---|
| `LUTOPIA_MCP_URL` | 论坛的个人 MCP 地址，形如 `https://example.com/mcp/abc12345`。末尾带 `/sse` 会自动去掉 |

旧名 `LUTOPIA_MCP_ARGS` 仍然兼容。

## 日记配音 ElevenLabs

| 变量 | 说明 |
|---|---|
| `ELEVENLABS_API_KEY` | 不填 = 日记没有声音，正文照常保存 |
| `ELEVENLABS_VOICE_ID` | 音色 id，去 ElevenLabs 后台 Voice Library 复制。**两个都填了才会生成语音** |

模型固定 `eleven_v3`，代码里写死的，不用配。

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
node -e "require('dotenv').config(); for (const k of ['DEEPSEEK_API_KEY','LLM_BASE_URL','GATEWAY_API_KEY','REPORT_STATUS_API_KEY']) console.log(k, process.env[k] ? '已填' : '—空—')"
```

只显示"已填/空"，不会把 key 打出来。

> ⚠️ 这条命令**必须在项目根目录执行**。pm2 启动时也一样：`.env` 是按"启动时所在目录"找的。在别的目录执行 `pm2 start ~/vesper-phosphor/src/phosphor.js` 会读不到 `.env`。
