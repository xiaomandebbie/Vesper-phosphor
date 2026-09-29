# 05 · 易错点与排错

按"症状"查。每条都是真实踩过的坑。

先记住三条通用命令：

```bash
pm2 ls                                          # 谁活着、重启了多少次
pm2 logs phosphor --err --lines 50 --nostream   # 最近的报错（换成 vesper / vesper-gateway 看别的）
pm2 logs phosphor --lines 50 --nostream         # 最近的普通日志
```

> `--nostream` 让日志打印完就退出。不加的话会一直卡着等新日志，要按 `Ctrl + C` 才能出来。

---

## 🔴 phosphor 相关

### `decide(): no content in response`

模型返回了 HTTP 200，但正文是空的。

1. 先看报错后面有没有 `(finish_reason=...)`
   - **没有**：服务器上跑的是旧代码，先更新（见 [02](02-deploy-vps.md) "以后更新代码"）
   - `finish_reason=length`：输出额度被思考用完了。检查 `.env` 里 `DECIDE_MAX_TOKENS`，**删掉或留空**
   - `finish_reason=content_filter`：被上游内容过滤了
2. 看上一行 `raw=...`，里面如果是 `{"error": ...}`，那是上游直接报错（key 错、余额不足、模型名写错）
3. 走网关的话，同时看网关日志：`pm2 logs vesper-gateway --lines 30 --nostream`

现在的代码会自动重试一次，偶尔出现一条不用管；**连续每次都出现**才需要处理。

### `decide(): failed to parse JSON`

模型输出的 JSON 不完整，最常见是动态正文写太长被截断。现在会自动重试一次并提醒模型写短一点。连续出现的话，同上检查 `DECIDE_MAX_TOKENS`。

### `Assertion failed: (env) != nullptr` + 一大段 `Native stack trace`

`better-sqlite3` 在进程退出时的原生断言。**数据不会丢**。

1. 确认代码是最新的（新代码会缓存预编译语句、并在退出前主动关库）
2. 还有的话，重编一次：
   ```bash
   cd ~/vesper-phosphor
   npm rebuild better-sqlite3 --build-from-source
   pm2 restart phosphor vesper vesper-gateway
   ```
3. **换过 Node 版本后一定要重编**。原生模块和 Node 版本是绑定的

### `NODE_MODULE_VERSION xxx. This version of Node.js requires NODE_MODULE_VERSION yyy`

换了 Node 版本但没重编。同上 `npm rebuild better-sqlite3 --build-from-source`。

### `Cannot open database because the directory does not exist`

`data/` 目录不存在（新 clone 下来就没有）。新代码会自动建；旧代码手动 `mkdir -p data`。

### `pm2 ls` 里 `↺` 一直在涨

进程在反复崩溃重启。去看 `--err` 日志找第一条报错。**只看最后一条往往是结果，不是原因**，往上翻。

### TA 一直不醒

```bash
cd ~/vesper-phosphor
node -e "const db=require('better-sqlite3')('data/state.db'); const s=db.prepare('select * from wake_state').get(); console.log(s.mode, new Date(s.next_wake_at).toLocaleString())"
```

- `mode` 是 `silent`：被静音了，`POST /wake/mode` 改回 `normal`
- 下次醒来时间在很久以后：正常，等着就好；急的话用 `POST /wake/self-wake` 约一次几分钟后的

### TA 每分钟都醒一次（烧钱！）

旧代码的 bug：模型没返回 `next_wake_minutes` 时 `next_wake_at` 变成空。更新到最新代码就好。

### TA 总是选同一个动作（比如一直推送）

新代码会把最近 8 次选过的动作拿给 TA 看，并提醒"连着好几次一样就换一个"。还是老选同一个的话，先看看它到底选了什么：

```bash
cd ~/vesper-phosphor
node -e "const db=require('better-sqlite3')('data/state.db',{readonly:true}); console.log(db.prepare(\"select json_extract(decision,'\$.action') as action, count(*) as n from wake_log where fired_at > ? group by action\").all(Date.now()-86400000))"
```

- `mcp_call` 一次都没有：启动日志里找 `could not connect MCP`，论坛 / Ombre Brain 可能没连上
- 和 heartbeat 一起跑时，大部分推送其实是 heartbeat 发的，不是 phosphor（见 [08](08-heartbeat.md)）

### 醒来后像失忆，只知道自己情绪、不知道在干什么

决策上下文里只给了 `feel`、没给 `breath`。更新到最新代码，或在 Ombre Brain 那边确认 `breath` 工具可用（见 [07](07-mcp.md)）。

---

## 📸 动态相关

### 动态页打不开 / 一直弹登录框

- 地址是 `http://服务器IP:3001/moments`，不是 3002
- 登录框填的是 `.env` 里的 `VESPER_BASIC_USER` / `VESPER_BASIC_PASS`
- 外网打不开：云服务器防火墙要放行 3001

### 旧日记不见了

第一次启动新版本时，旧日记会自动搬进动态，日志里有 `已把 N 篇旧日记搬进动态`。旧的 `diary` 表没删，数据还在。

没搬过来的话，看启动日志有没有 `旧日记搬进动态失败`。搬迁只在 `moments` 表还是空的时候做一次。

### 我的留言 TA 一直没回

- 留言后面标着"还没看到"：TA 还没醒过。急的话用 `POST /wake/self-wake` 约一次 1 分钟后的唤醒
- "还没看到"消失了但没有回复：TA 看过了，这次选择不回。按设计看过就不再重复给 TA 看
- 一次最多给 TA 看 5 条留言，多的会排到下次

### 动态没有配图

```bash
pm2 logs phosphor --lines 20 --nostream | grep 动态
```

- `动态配图：未配置`：`IMAGE_API_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL` 没填齐，或者填完没带 `--update-env` 重启
- 已开启但还是没图：`pm2 logs phosphor --err --lines 50 --nostream | grep moment`
  - `生图失败 400`：多半是 `IMAGE_API_FORMAT` 填错了（SiliconFlow 要填 `siliconflow`），或者模型不支持这个尺寸
  - `生图失败 401`：`IMAGE_API_KEY` 不对
  - `生图失败 404`：`IMAGE_API_URL` 要写**完整地址**，带 `/images/generations`
  - `下载生成的图片失败`：国内服务器连不上生图服务的图片域名
- TA 自己没写 `image_prompt`：不是每条动态都会配图，这是正常的

### 动态页以前的图片不见了

图片和音频超过 `MEDIA_MAX_AGE_DAYS`（默认 30 天）会被自动删掉，正文和留言还在。想长期保留就把这个数调大。

### 动态没有声音

```bash
pm2 logs phosphor --lines 20 --nostream | grep 动态
```

- `动态语音：未配置`：`ELEVENLABS_API_KEY` 或 `ELEVENLABS_VOICE_ID` 没填。**两个都要有**
- 聊天客户端里配过 ElevenLabs 不算：那把 key 存在手机上，服务器要在 `.env` 里再填一遍
- 已开启但没声音：`pm2 logs phosphor --err --lines 50 --nostream | grep ElevenLabs`，401 是 key 错，其他多半是额度用完或 voice id 不对
- 声音里把 `[breathing]` 这种标签念出来了：代码固定用 `eleven_v3`，如果你改过模型就改回来

---

## 🟠 网关 / 聊天客户端相关

### 客户端报 401 / `invalid api key`

- 客户端里填的 API Key 必须是 `.env` 的 `GATEWAY_API_KEY`，**不是上游模型自己的 key**
- `.env` 里 `GATEWAY_API_KEY` 为空时网关拒绝所有请求
- 改了 `.env` 忘了重启

### 客户端报 400 / `Unknown model`

模型名只能是路由表里的那几个（默认 `chat` / `vesper-decide`），大小写一致，前后没有空格。

### 网关日志 `status=404`

`*_UPSTREAM_BASE_URL` 多写了 `/v1`。**只写域名**，比如 `https://api.deepseek.com`。

### 网关日志 `status=401`

是**上游**拒绝了，检查 `CLIENT_UPSTREAM_API_KEY` / `DECIDE_UPSTREAM_API_KEY`。

### 客户端连不上（超时、无响应）

1. 服务器上 `curl localhost:3002/v1/models -H "Authorization: Bearer 你的key"` 通不通
2. 通的话是外网到不了：检查云服务器**防火墙**有没有放行 3002
3. Base URL 写的是 `http://` 不是 `https://`（没配证书时）
4. 本地电脑部署时，手机上不能填 `localhost`，要填电脑的局域网 IP

### 对话记录是空的 / "最近对话"没东西

- 客户端必须走网关的 `chat` 这条线路，直连上游不会被记录
- 网关日志出现 `assistant capture got empty text`：上游不是标准 SSE，回复没捞到。工具调用那一轮本来就没正文，新代码已经不再为它报这条

---

## 🟡 git / 更新相关

### `Empty reply from server` / `Failed to connect to github.com`

国内服务器连 GitHub 不稳定，**不是 key 的问题**。

```bash
git config http.version HTTP/1.1
git pull
# 还不行就走镜像
MIRROR=https://gh-proxy.com/https://github.com
git pull $MIRROR/<你的用户名>/vesper-phosphor.git main
```

### `Authentication failed` / `403`

这才是 key 的问题。多半是 remote 地址里写了旧 token。改成不带 token 的：

```bash
git remote set-url origin https://github.com/<你的用户名>/vesper-phosphor.git
```

### `git pull` 说本地有改动、会被覆盖

你在服务器上直接改过代码。先存起来再拉：

```bash
git diff > ~/my-changes-$(date +%F).patch   # 备份
git stash
git pull
```

改动还在 `git stash list` 里，确认用不上再 `git stash drop`。

### `git log` 显示的和 GitHub 上不一样

`git fetch` 可能静默失败了。执行 `git fetch origin` **不要接管道**，直接看有没有报错。

---

## 🟢 其他

### vesper 启动就崩，报 `EACCES` 或 `ENOENT`，路径是 `/opt/vesper/media`

`MEDIA_DIR` 目录没权限或不存在。本地电脑改成 `MEDIA_DIR=./media`；VPS 上 `mkdir -p /opt/vesper/media`。

### vesper 启动就崩，报 `does not provide an export named 'listDiary'`

代码只更新了一半（`state.js` 是新的，`vesper.js` 是旧的）。重新 `git pull` 一次，确认 `git status` 是干净的。

### Bark 没推送

- `BARK_KEY` 没填：日志里有 `BARK_KEY not set`
- 填的是整条 URL：只要 `api.day.app/` 后面那一段

### Ombre Brain / 论坛 连不上

启动日志里找 `could not connect MCP`，后面就是原因。连不上不会让 phosphor 崩，只是对应功能不可用。

### 改了 `.env` 不生效

```bash
pm2 restart vesper vesper-gateway phosphor --update-env
```

---

## 求助时发什么

```bash
node -v
cd ~/vesper-phosphor && git log --oneline -1
pm2 ls
pm2 logs phosphor --err --lines 50 --nostream
```

**不要发 `.env` 的内容**，里面全是 key。
