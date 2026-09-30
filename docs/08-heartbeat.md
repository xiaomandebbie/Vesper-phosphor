# 08 · 和 heartbeat 一起跑

[dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat) 是另一个让 TA 自己醒来的项目。它怎么安装、怎么工作，看它自己的仓库。晨暮星可以和它同时跑，也可以只跑一个。

这一篇只讲晨暮星这边怎么和它接。

## 接上之后会发生什么

- **读事件**：晨暮星做决定时，除了自己记的聊天（`conversation_log`），还会从 heartbeat 的时间线文件里读"事件"（推送、未推送、做过的事），合并后按时间排序。事件最多取最近 8 条，免得把聊天挤掉
- **写事件**：晨暮星做了事，会通过 heartbeat 的内部事件接口写回一条，heartbeat 那边醒来时也能看到
- **推送让给 heartbeat**：接上之后，决策提示里会告诉 TA"主动联系对方有另一个程序在管"，除非有非说不可、而且它没说过的话，否则这次别推送
- **`heartbeat-wake` 线路**：heartbeat 醒来时如果走晨暮星网关的这条线路，网关会把请求里"最近记录："后面的内容换成跨窗口的共享上下文，两边看到的是同一份

聊天记录只从 `conversation_log` 读，不从 heartbeat 的时间线文件读。那个文件会随聊天请求整个替换，换窗口就丢；`conversation_log` 是每条消息追加一行，不分窗口。

## 配置

`.env` 里：

```
HEARTBEAT_TIMELINE_FILE=/path/to/enhanced_messages.json
HEARTBEAT_EVENT_URL=http://localhost:3000/internal/wake-event
TIME_ZONE=Asia/Shanghai
```

- `HEARTBEAT_TIMELINE_FILE`：heartbeat 时间线文件的完整路径。留空 = 不读事件，也不会提示 TA 把推送让出去
- `HEARTBEAT_EVENT_URL`：heartbeat 的内部事件接口。只接受本机请求，所以两个项目要在同一台机器上
- `TIME_ZONE`：解析和写入事件时间用的时区

改完重启：

```bash
pm2 restart vesper-gateway phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 共享时间线
```

看到 `共享时间线：已开启` 就好了。

### 让 heartbeat 走 `heartbeat-wake` 线路（可选）

在 heartbeat 那边把模型地址指向晨暮星网关：

| 项 | 填 |
|---|---|
| 地址 | `http://localhost:3002/v1` |
| key | 晨暮星 `.env` 里的 `GATEWAY_API_KEY` |
| 模型名 | `heartbeat-wake` |

具体填在 heartbeat 的哪个配置项，看它的说明。这条线路的上游和 `vesper-decide` 一样，用 `DECIDE_UPSTREAM_*`。

## 写回的事件格式

heartbeat 只认固定开头的事件，其余的会被它丢掉。晨暮星按下面的格式写，代码在 `src/timeline.js` 的 `describeAction()`：

| 做了什么 | 写成 |
|---|---|
| 推送 | `刚刚给用户发了Bark推送：…` |
| 发动态 | `自动唤醒：本次未发送推送｜发了一条动态（配了图）：…` |
| 调了 MCP | `自动唤醒：本次未发送推送｜用了 xxx/yyy …` |
| 存了长期记忆 | `自动唤醒：本次未发送推送｜记下了一条长期记忆：…` |
| 调了节律 | `自动唤醒：本次未发送推送｜把节律调成了 xxx` |
| 回了留言 | `自动唤醒：本次未发送推送｜回复了动态下的 N 条留言` |
| 什么都没做、只翻了记忆 | 不写，免得刷满时间线 |

每条前面会自动加上 `（2026-09-28 20:50 ` 这样的时间，结尾补 `）`。

读事件时用来识别的正则 `SPECIAL_EVENT_PREFIX` 也在 `src/timeline.js`。heartbeat 那边改了事件格式，这里要跟着改。

## 并存和切换

- **并存**：两边的存储不一样，不冲突。想先观察晨暮星稳不稳，就两边都跑
- **只跑晨暮星**：把 `HEARTBEAT_TIMELINE_FILE` 和 `HEARTBEAT_EVENT_URL` 留空，重启。停掉 heartbeat 之前，先备份它的时间线文件和晨暮星的 `data/state.db`

## 排错

| 现象 | 原因 |
|---|---|
| `timeline: 读取 … 失败` | 路径写错、文件不存在，或者 JSON 格式坏了 |
| `timeline: 写入 heartbeat 事件失败` | heartbeat 没在跑，或者不在同一台机器 |
| 事件里全是"未推送" | heartbeat 醒得比晨暮星勤，正常；这边只取最近 8 条 |
| 决策时看不到事件 | `HEARTBEAT_TIMELINE_FILE` 没填 |
| `gateway: heartbeat-wake 没找到"最近记录："，原样转发` | heartbeat 的请求里没有这个标记，共享上下文没注入；看它那边的请求格式有没有变 |
