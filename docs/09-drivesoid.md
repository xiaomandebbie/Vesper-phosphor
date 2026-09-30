# 09 · 接入 Drivesoid（情绪）

[Drivesoid](https://github.com/A1batr055/Drivesoid) 是一个独立的情绪服务。它怎么安装、怎么配置、情绪怎么算，都看它自己的仓库。

这一篇只讲晨暮星这边怎么接。

## 接上之后会发生什么

- **聊天时**：`vesper-gateway` 每记下一条你说的话，就把它连同最近约 600 字的前文报给 Drivesoid；TA 回完一句，再报一次。上报不等结果，Drivesoid 挂了也不会拖慢聊天
- **醒来时**：phosphor 先让 Drivesoid 刷新一次，再读它的情绪块，放进做决定的上下文。TA 这次的心情以它为底色，但不会把数值和英文维度名写进推送、动态和回复里
- **不接**：`DRIVES_URL` 留空，上面两件事都不做，其他照常

晨暮星这边不会因此多调模型。给消息打情绪标签是 Drivesoid 自己做的，用它自己配置的模型和 key，费用算在那边。

## 前提

- Drivesoid 和晨暮星装在**同一台机器**上。它的上报接口只接受本机请求
- 按 Drivesoid 仓库的说明装好，并让它常驻运行（比如用 pm2）
- 端口用它默认的 `24601`，别和晨暮星的 3001 / 3002 撞

确认它在跑：

```bash
curl -s http://127.0.0.1:24601/api/drives/status | head -c 300; echo
```

返回一段 JSON 就可以往下走。

## 接入：两步

**1. 在晨暮星的 `.env` 里加地址**

```bash
cd ~/vesper-phosphor
sed -i '/^DRIVES_URL=/d' .env
echo "DRIVES_URL=http://127.0.0.1:24601" >> .env
```

**2. 重启网关和 phosphor**

```bash
pm2 restart vesper-gateway phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep Drivesoid
```

看到 `情绪（Drivesoid）：已接入` 就好了。

想断开：删掉 `DRIVES_URL` 这一行，再执行一次第 2 步。

## 晨暮星用到的接口

只用这四个。Drivesoid 升级后如果它们变了，这边要跟着改，代码在 `src/drives.js`。

| 谁调 | 接口 | 什么时候 |
|---|---|---|
| gateway | `POST /internal/drives/event`，`{"type":"msg_user","payload":{"text":"…","context":[…]}}` | 记下你的一条消息后 |
| gateway | `POST /internal/drives/event`，`{"type":"msg_assistant","payload":{}}` | 记下 TA 的回复后 |
| phosphor | `POST /internal/drives/session-start` | 醒来读情绪之前，先刷新（最多等 15 秒） |
| phosphor | `GET /api/drives/context` | 读情绪块 |

只有走网关 `chat` 线路的聊天会被上报。直连上游的聊天，Drivesoid 收不到。

## 安全

- 防火墙**不要**开 24601。它只需要在本机被访问
- Drivesoid 的 key 存在它自己目录的配置里，和晨暮星的 `.env` 是两份，互不影响

## 排错

| 现象 | 原因 |
|---|---|
| 启动日志是 `情绪（Drivesoid）：未接入` | `DRIVES_URL` 没填，或者改完没带 `--update-env` 重启 |
| `drives: 上报 msg_user 失败（Drivesoid 在运行吗？）` | Drivesoid 没在跑，或者地址、端口不对 |
| `drives: 读情绪失败 HTTP 503` | Drivesoid 的快照过期了（刚启动，或者它那边卡住）。偶尔一次没关系，这次醒来不带情绪 |
| `drives: 刷新情绪快照失败，读现有快照` | 刷新超过 15 秒。会直接读现有快照，不影响这次醒来 |
| 情绪一直不怎么变 | 聊天没走网关的 `chat` 线路，Drivesoid 收不到上报 |

Drivesoid 自己的报错（比如分类失败、配置读不到），看它的日志和它仓库的说明。
