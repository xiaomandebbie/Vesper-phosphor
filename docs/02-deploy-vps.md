# 02 · 在 VPS 上部署（推荐）

以腾讯云轻量服务器（OpenCloudOS / CentOS 系）为例。Ubuntu 的差别会单独标出来。

整个过程分 8 步，**按顺序做，每步做完看一眼"检查"再往下走**。

---

## 第 1 步：装 Node.js（需要 20 或更高）

```bash
node -v
```

- 显示 `v20.x` 或更高：跳到第 2 步
- 显示 `v18.x` 或更低、或者 `command not found`：装一个新的

```bash
# 用 nvm 装（不会和系统自带的冲突）
curl -o- https://gitee.com/mirrors/nvm/raw/master/install.sh | bash
source ~/.bashrc
nvm install 22
nvm alias default 22
node -v
```

**检查**：`node -v` 显示 `v22.x`。

> 为什么要 20+：依赖里的 `@modelcontextprotocol/sdk` 会带进 `@hono/node-server`，它要求 Node ≥ 20。

## 第 2 步：装编译工具

`better-sqlite3` 是"原生模块"（C++ 写的），下载不到现成的二进制时要在本机编译。先装上工具，省得后面报一屏看不懂的错。

```bash
# OpenCloudOS / CentOS
dnf install -y gcc gcc-c++ make python3 git

# Ubuntu / Debian
apt update && apt install -y build-essential python3 git
```

## 第 3 步：装 pm2

```bash
npm install -g pm2
pm2 -v
```

## 第 4 步：拉代码

```bash
cd /root
git clone https://github.com/xiaomandebbie/Vesper-phosphor.git vesper-phosphor
cd vesper-phosphor
```

**国内服务器连 GitHub 经常超时**（报 `Empty reply from server` 或卡住不动），换镜像：

```bash
git clone https://gh-proxy.com/https://github.com/xiaomandebbie/Vesper-phosphor.git vesper-phosphor
cd vesper-phosphor
git remote set-url origin https://github.com/xiaomandebbie/Vesper-phosphor.git
```

最后一行把远程地址改回正常的 GitHub，以后 `git pull` 失败再临时用镜像拉。

> ⚠️ **不要把 GitHub token 写进 remote 地址**（`https://用户名:token@github.com/...`）。仓库是公开的，只拉代码不需要 token；写进去后换 key 就会莫名其妙拉不下来。

## 第 5 步：装依赖

```bash
npm ci
```

`npm ci` 会严格按 `package-lock.json` 装，比 `npm install` 更可靠。

**检查**：

```bash
node -e "require('better-sqlite3')(':memory:'); console.log('sqlite ok')"
```

显示 `sqlite ok` 就对了。报错的话执行：

```bash
npm rebuild better-sqlite3 --build-from-source
```

## 第 6 步：填 `.env`

```bash
cp .env.example .env
vi .env        # 不会用 vi 就用 nano .env
```

**最少要填这几项才能跑起来**：

| 变量 | 填什么 | 不填会怎样 |
|---|---|---|
| `DEEPSEEK_API_KEY` 或 `LLM_*` 三件套 | 做决定用的模型 key | phosphor 每次醒来都失败 |
| `GATEWAY_API_KEY` | 自己编一串长随机字符 | **网关拒绝所有请求**（401） |
| `REPORT_STATUS_API_KEY` | 再编一串长随机字符 | **`/wake/*` 所有人都能访问** |
| `VESPER_BASIC_USER` / `VESPER_BASIC_PASS` | 看日记页的账号密码 | **日记页所有人都能看** |

生成随机字符串：

```bash
openssl rand -hex 24
```

其余变量（Bark、Ombre Brain、Lutopia、ElevenLabs）按需填，不填对应功能会自动跳过，不会崩。

每个变量的详细含义见 [04 · 配置项详解](04-config.md)。

## 第 7 步：启动

```bash
cd /root/vesper-phosphor
pm2 start src/vesper.js   --name vesper
pm2 start src/gateway.js  --name vesper-gateway
pm2 start src/phosphor.js --name phosphor
pm2 save

# 服务器重启后自动拉起（会打印一行命令，复制它再执行一遍）
pm2 startup
```

**检查**：

```bash
pm2 ls
```

三个都是 `online`，而且过一分钟再看 `↺`（重启次数）**没有往上涨**。在涨说明在反复崩溃，去看日志：

```bash
pm2 logs phosphor --err --lines 50 --nostream
```

再确认两个网页服务活着：

```bash
curl -s localhost:3001/health -u 你的BASIC_USER:你的BASIC_PASS
# {"ok":true,"service":"vesper"}

curl -s localhost:3002/v1/models -H "Authorization: Bearer 你的GATEWAY_API_KEY"
# 能看到 aru-chat 和 vesper-decide
```

等 1～2 分钟看 phosphor 第一次醒来：

```bash
pm2 logs phosphor --lines 40 --nostream
```

出现 `[non_precise] decision:` 和 `action result:` 就是全通了。

## 第 8 步：开防火墙端口

腾讯云轻量：控制台 → 服务器 → 防火墙 → 添加规则，TCP `3001` 和 `3002`。

只需要从外面访问的才开：

- 手机要上报状态、浏览器要看日记 → 开 3001
- Aru 要走网关 → 开 3002

> ⚠️ 开端口前**务必确认第 6 步三个 key 都填了**。开了端口 + 没填 key = 公网裸奔。

---

## 让 Aru 走这个网关

Aru → 模型设置 → 自定义服务：

| 项 | 填 |
|---|---|
| Base URL | `http://你的服务器IP:3002/v1` |
| API Key | `.env` 里的 `GATEWAY_API_KEY`（**不是** DeepSeek 的 key） |
| 模型 | `aru-chat`（或点"拉取"） |

再在 `.env` 里填上 `aru-chat` 实际转发到哪：

```
ARU_UPSTREAM_BASE_URL=https://api.deepseek.com
ARU_UPSTREAM_API_KEY=你的上游key
ARU_UPSTREAM_MODEL=deepseek-flash
```

> ⚠️ `ARU_UPSTREAM_BASE_URL` **不要带 `/v1`**，网关会自己拼上 `/v1/chat/completions`。写成 `https://api.deepseek.com/v1` 会变成 `/v1/v1/...`，上游返回 404。

## 让 phosphor 也走网关（可选）

这样"聊天的 TA"和"做决定的 TA"用的是同一条线：

```
LLM_BASE_URL=http://localhost:3002/v1/chat/completions
LLM_MODEL=vesper-decide
LLM_API_KEY=跟GATEWAY_API_KEY一样

DECIDE_UPSTREAM_BASE_URL=https://api.deepseek.com
DECIDE_UPSTREAM_API_KEY=你的上游key
DECIDE_UPSTREAM_MODEL=deepseek-flash
```

> ⚠️ 注意两种写法不一样：`LLM_BASE_URL` 要写**完整地址**（带 `/v1/chat/completions`），`*_UPSTREAM_BASE_URL` **只写域名**。

改完 `.env` 必须重启才生效：

```bash
pm2 restart vesper vesper-gateway phosphor --update-env
```

---

## 以后更新代码

```bash
cd /root/vesper-phosphor
git status                 # 先看有没有本地改动，有的话先别 pull
git pull || git pull https://gh-proxy.com/https://github.com/xiaomandebbie/Vesper-phosphor.git main
npm ci                     # package.json 有变化时才需要
pm2 restart vesper vesper-gateway phosphor
```

> 💡 **不要直接在服务器上改代码**。改了之后 `git pull` 会冲突，而且 GitHub 上的版本会和服务器上跑的不一样，排查问题时会被误导。要改就在 GitHub 上改，服务器只负责 pull。

## 备份

这两样**不在 git 里，重新 clone 不会回来**：

```bash
cp /root/vesper-phosphor/.env          ~/backup-vesper.env
cp /root/vesper-phosphor/data/state.db ~/backup-state-$(date +%F).db
```

备份数据库前最好先 `pm2 stop phosphor vesper vesper-gateway`，备份完再 `pm2 start` 回来。
