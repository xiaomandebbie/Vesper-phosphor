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

模型输出的 JSON 不完整，最常见是日记写太长被截断。现在会自动重试一次并提醒模型写短一点。连续出现的话，同上检查 `DECIDE_MAX_TOKENS`。

### `Assertion failed: (env) != nullptr` + 一大段 `Native stack trace`

`better-sqlite3` 在进程退出时的原生断言。**数据不会丢**。

1. 确认代码是最新的（新代码会在退出前主动关库）
2. 还有的话，重编一次：
   ```bash
   cd /root/vesper-phosphor
   npm rebuild better-sqlite3 --build-from-source
   pm2 restart phosphor
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
cd /root/vesper-phosphor
node -e "const db=require('better-sqlite3')('data/state.db'); const s=db.prepare('select * from wake_state').get(); console.log(s.mode, new Date(s.next_wake_at).toLocaleString())"
```

- `mode` 是 `silent`：被静音了，`POST /wake/mode` 改回 `normal`
- 下次醒来时间在很久以后：正常，等着就好；急的话用 `POST /wake/self-wake` 约一次几分钟后的

### TA 每分钟都醒一次（烧钱！）

旧代码的 bug：模型没返回 `next_wake_minutes` 时 `next_wake_at` 变成空。更新到最新代码就好。

---

## 🟠 网关 / Aru 相关

### Aru 报 401 / `invalid api key`

- Aru 里填的 API Key 必须是 `.env` 的 `GATEWAY_API_KEY`，**不是 DeepSeek 的 key**
- `.env` 里 `GATEWAY_API_KEY` 为空时网关拒绝所有请求
- 改了 `.env` 忘了重启

### Aru 报 400 / `Unknown model`

模型名只能是 `aru-chat` 或 `vesper-decide`，大小写一致，前后没有空格。

### 网关日志 `status=404`

`*_UPSTREAM_BASE_URL` 多写了 `/v1`。**只写域名**，比如 `https://api.deepseek.com`。

### 网关日志 `status=401`

是**上游**拒绝了，检查 `ARU_UPSTREAM_API_KEY` / `DECIDE_UPSTREAM_API_KEY`。

### Aru 连不上（超时、无响应）

1. 服务器上 `curl localhost:3002/v1/models -H "Authorization: Bearer 你的key"` 通不通
2. 通的话是外网到不了：检查云服务器**防火墙**有没有放行 3002
3. Base URL 写的是 `http://` 不是 `https://`（没配证书时）
4. 本地电脑部署时，手机上不能填 `localhost`，要填电脑的局域网 IP

### 对话记录是空的 / "最近对话"没东西

- Aru 必须用 `aru-chat` 这个模型走网关，直连 DeepSeek 不会被记录
- 网关日志出现 `assistant capture got empty text`：上游不是标准 SSE，助手回复没捞到

---

## 🟡 git / 更新相关

### `Empty reply from server` / `Failed to connect to github.com`

国内服务器连 GitHub 不稳定，**不是 key 的问题**。

```bash
git config http.version HTTP/1.1
git pull
# 还不行就走镜像
git pull https://gh-proxy.com/https://github.com/xiaomandebbie/Vesper-phosphor.git main
```

### `Authentication failed` / `403`

这才是 key 的问题。多半是 remote 地址里写了旧 token。仓库是公开的，改成不带 token 的：

```bash
git remote set-url origin https://github.com/xiaomandebbie/Vesper-phosphor.git
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

### 日记页图片不显示

旧版本 `vesper.js` 里写成了 `< img`（多一个空格）。更新代码。另外目前配图功能本来就没接，只有音频。

### Bark 没推送

- `BARK_KEY` 没填：日志里有 `BARK_KEY not set`
- 填的是整条 URL：只要 `api.day.app/` 后面那一段

### Ombre Brain / Lutopia 连不上

启动日志里找 `could not connect MCP`，后面就是原因。连不上不会让 phosphor 崩，只是对应功能不可用。

### 改了 `.env` 不生效

```bash
pm2 restart vesper vesper-gateway phosphor --update-env
```

---

## 求助时发什么

```bash
node -v
cd /root/vesper-phosphor && git log --oneline -1
pm2 ls
pm2 logs phosphor --err --lines 50 --nostream
```

**不要发 `.env` 的内容**，里面全是 key。
