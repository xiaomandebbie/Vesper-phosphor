# 11 · 钱包 MCP

把钱包包成 MCP，让 Aru（或者别的 MCP 客户端）也能读账、写批注。
允朔在晨暮星里醒来自己看账是两回事（见 10-wallet.md）——这边是给 Aru 这条路开的门。

## 它挂在 vesper 上，不是单独进程

账在 `data/state.db` 里，那库已经被三个进程共用。再起一个就是第四个连接，
而 `vesper` 本来就是 Express——所以 MCP 端点直接挂在它身上，路径 `/wallet/mcp`。
不多进程、不多数据库连接、不用单独管 pm2。

协议是 Streamable HTTP，**无状态**：每个请求新建一对 server + transport，用完关掉。
这个端点每次就是读几行账、写一句批注，没有跟踪上下文的必要。

## 三个工具

| 工具 | 参数 | 干什么 |
|---|---|---|
| `wallet_balance` | 无 | 余额、进账花销总数、跟卡里对不对得上 |
| `wallet_ledger` | `date` / `notes` / `limit`，都可选 | 翻账本：最近几笔、某一天的、或最近的批注 |
| `wallet_note` | `entry_id`、`note` | 给某一笔记一句批注 |

`entry_id` 是翻账本时每笔前面那个 `#号`。编了不存在的号会被拒，返回一句说明而不是报错。

### 没有 wallet_earn，也没有 adjust

这两个故意不给 MCP：

- **进账**是她验收工单才打的钱，不该让他自己给自己发工资
- **对账**（adjust）谁都能改的话，对账这件事就没意义了

这两个留在 `POST /api/wallet/earn`，要 `x-api-key`（就是 `REPORT_STATUS_API_KEY`）。

## 装

`src/wallet-mcp.js` 是新文件，`git pull` 就有了。`vesper.js` 里那两行用脚本打：

```bash
cd ~/vesper-phosphor
git pull
python3 scripts/add_wallet_mcp.py --check   # 先看能不能对上
python3 scripts/add_wallet_mcp.py
```

这个脚本要求**已经跑过 `add_wallet_hooks.py`**（钱包本体的接线），否则锚点对不上。
幂等，带 `.bak-wallet-mcp` 备份。

然后生成 token，重启：

```bash
cd ~/vesper-phosphor
sed -i '/^WALLET_MCP_TOKEN=/d' .env
echo "WALLET_MCP_TOKEN=$(openssl rand -hex 24)" >> .env
pm2 restart vesper --update-env
grep WALLET_MCP_TOKEN .env
```

只需重启 `vesper`，`phosphor` 不涉及。启动日志里会多一段：

```
钱包 MCP：/wallet/mcp（批注算 assistant）
```

没配 token 的话日志里是 `wallet-mcp: 没配 WALLET_MCP_TOKEN，/wallet/mcp 没开`，
端点根本不注册。和 `spend-notify` 同一个规矩——这是个能写账本的端点。

## 接进 Aru

Aru 这边添一个 MCP server：

| | |
|---|---|
| URL | `http://你的服务器IP:3001/wallet/mcp` |
| transport | Streamable HTTP |
| 鉴权 | Header `Authorization: Bearer 你的 WALLET_MCP_TOKEN` |

`x-wallet-mcp-token` 这个头也认，哪个方便用哪个。

套了 HTTPS 反代就用域名。**没套的话 token 走 HTTP 是明文的**，
和 `WALLET_SPEND_SECRET` 一样的问题：要么前面套一层 HTTPS，要么 3001 只开给你家的出口 IP。

先用 curl 试一下连得上连不上：

```bash
source .env
curl -s -X POST http://127.0.0.1:3001/wallet/mcp \
  -H "Authorization: Bearer $WALLET_MCP_TOKEN" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

返回里应该能看见三个工具名。`accept` 那一行别漏——Streamable HTTP 要求
同时接受 `application/json` 和 `text/event-stream`，不带会被拒。

## 批注算谁写的

`WALLET_MCP_SIGN_AS` 决定，默认 `assistant`——因为这是他的手。
填 `user` 就算你写的（比如你用 Aru 替自己记账的时候）。

两边写的进同一张 `wallet_notes` 表，和网页上写的、他醒来写的不分家。
页面上她的标紫色、他的标暖黄。

## 这个端点和别的路不一样

| | 走什么鉴权 | 能做什么 |
|---|---|---|
| `/wallet` 页面 | Basic Auth | 看余额账单、写批注 |
| `/wallet/mcp` | Bearer token | 读账、写批注 |
| `GET /api/wallet` | `x-api-key` | 读账（JSON）|
| `POST /api/wallet/earn` | `x-api-key` | 打工资、对账 |
| `POST /api/wallet/spend-notify` | `WALLET_SPEND_SECRET` | 银行短信记账 |

四把钥匙各管一条路，不混用。哪一把泄了只丢那一条路的权限。

## 排错

| 现象 | 怎么回事 |
|---|---|
| 启动日志没有「钱包 MCP」 | `WALLET_MCP_TOKEN` 没填，或脚本没跑 |
| 401 unauthorized | token 不对。日志只记「拒绝了」，不回显收到的 token |
| 405 use POST | 客户端发了 GET。无状态模式不支持 SSE 长连接 |
| 406 Not Acceptable | `accept` 头没带 `text/event-stream` |
| 工具调用说账本里没有那笔 | `entry_id` 编错了，先 `wallet_ledger` 翻一下看真实编号 |
