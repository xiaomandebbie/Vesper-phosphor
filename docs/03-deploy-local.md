# 03 · 在自己电脑上部署（Mac / Windows）

适合：先试试看、改代码调试。

不适合长期用：**电脑合盖、睡眠、关机的时候 TA 就"睡死"了**，不会醒来；约好的精确唤醒也会变成 `missed`。长期用请上 VPS（见 [02](02-deploy-vps.md)）。

---

## 第 1 步：装 Node.js 22

去 https://nodejs.org 下载 **LTS** 版本（22.x）安装包，一路下一步。

打开终端（Mac：启动台搜"终端"；Windows：开始菜单搜 **PowerShell**），检查：

```bash
node -v    # v22.x
npm -v
```

> Windows 装的时候如果有一个勾选框 "Automatically install the necessary tools"（自动安装编译工具），**勾上**。`better-sqlite3` 万一要本地编译会用到。

## 第 2 步：装 git 和 pm2

- Mac：终端输入 `git --version`，没装会自动弹窗让你装
- Windows：去 https://git-scm.com 下载安装

```bash
npm install -g pm2
```

## 第 3 步：拉代码、装依赖

把 `<你的用户名>` 换成你自己的 GitHub 用户名。

```bash
cd ~
git clone https://github.com/<你的用户名>/vesper-phosphor.git
cd vesper-phosphor
npm ci
```

检查 sqlite 能不能用：

```bash
node -e "require('better-sqlite3')(':memory:'); console.log('sqlite ok')"
```

## 第 4 步：填 `.env`

```bash
# Mac
cp .env.example .env
open -e .env

# Windows PowerShell
copy .env.example .env
notepad .env
```

本地和 VPS 的填法基本一样，**但有一项必须改**：

```
MEDIA_DIR=./media
```

> ⚠️ 默认值是 `/opt/vesper/media`。Mac 上普通用户没权限写这个目录，Windows 上根本没有这个路径。不改的话 **vesper 一启动就崩**（报 `EACCES` 或 `ENOENT`）。

其他必填项同 VPS：模型 key、`GATEWAY_API_KEY`、`REPORT_STATUS_API_KEY`。

## 第 5 步：先前台跑一遍看看

第一次建议**不用 pm2**，开三个终端窗口分别跑，报错直接能看到：

```bash
npm run vesper
npm run gateway
npm run phosphor
```

看到这些就对了：

- `vesper listening on 3001`
- `vesper-gateway listening on 3002`
- phosphor 一两分钟后出现 `[non_precise] decision:`

按 `Ctrl + C` 停掉。

## 第 6 步：用 pm2 放到后台

```bash
pm2 start src/vesper.js   --name vesper
pm2 start src/gateway.js  --name vesper-gateway
pm2 start src/phosphor.js --name phosphor
pm2 save
pm2 ls
```

---

## 手机上的聊天客户端怎么连到电脑上的网关

`localhost` 指的是"本机"，手机上填 `localhost` 连的是手机自己，不是你的电脑。

1. 手机和电脑连**同一个 Wi-Fi**
2. 查电脑的局域网 IP
   - Mac：系统设置 → Wi-Fi → 详细信息 → IP 地址（形如 `192.168.1.23`）
   - Windows：PowerShell 输入 `ipconfig`，找"IPv4 地址"
3. 客户端里 Base URL 填 `http://192.168.1.23:3002/v1`
4. 第一次连接时电脑可能弹出"是否允许 node 接受传入连接"，点**允许**

出门离开这个 Wi-Fi 就连不上了，这也是长期用要上 VPS 的原因。

## Ombre Brain 在本地 Docker 里

如果 Ombre Brain 也跑在这台电脑的 Docker 里，`OMBRE_BRAIN_URL` 写宿主机映射出来的端口：

```
OMBRE_BRAIN_URL=http://localhost:18001/mcp
```

端口以 `docker ps` 里 `0.0.0.0:xxxxx->8000` 的 `xxxxx` 为准。

## 不想让电脑睡眠

- Mac：终端里跑着 `caffeinate -i`，不关这个窗口就不睡
- Windows：设置 → 系统 → 电源 → 屏幕和睡眠 → 睡眠设成"从不"
