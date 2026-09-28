# 08 · 和 heartbeat 的关系

这两个项目解决的是同一类问题：让 TA 在你不在的时候也能自己醒过来、做点事、留下痕迹。它们可以同时跑，也可以只跑一个。

这一篇讲清楚区别、怎么共存，以及 heartbeat 具体给本项目提供了什么。

## 一句话区别

| | heartbeat | 本项目（晨暮星） |
|---|---|---|
| 唤醒节律 | 固定间隔 | 每次醒来由模型自己决定下次隔多久 |
| 决定做什么 | 规则 / 脚本决定 | 模型自己决定（推送、写日记、逛论坛、翻记忆、什么都不做） |
| 状态存储 | JSON 文件（`enhanced_messages.json`） | SQLite（`data/state.db`） |
| 上下文来源 | 那个 JSON 文件，每次请求整个替换 | 追加式的 `conversation_log`，不分窗口 |
| 长期记忆 | 无 | Ombre Brain |
| 扩展新能力 | 改代码 | 接 MCP，不用改代码 |

简单说：heartbeat 是**定时器 + 规则**，晨暮星是**会自己拿主意的**。

## 那个 JSON 文件的问题

heartbeat 把聊天记录和它自己的唤醒事件都存在一个文件里（默认叫 `enhanced_messages.json`）。

问题在于：**这个文件每收到一次聊天请求，就被那次请求带来的历史整个替换掉。**

后果是：

- 换一个聊天窗口，之前窗口的聊天就没了
- 后台有别的请求（比如整理日记）经过时，也会把它盖掉
- "未找到用户时间"那类报错就是这么来的——文件被重写的那一瞬间，里面可能还是空的

`src/context.js` 里记了这段判断过程。结论是：**聊天记录不再从那个文件读**，改成读 `vesper-gateway` 自己记的 `conversation_log`——它是每条消息追加一行，不分窗口、不会被覆盖。

## 但 heartbeat 的文件里有一件东西值得留

那个文件里除了聊天，还有**事件**：推送记录、未推送的说明、写过的日记、逛过论坛。

这些事件**换窗口时会保留**（它们是 heartbeat 自己往里追加的，不是从聊天请求里来的）。而 `conversation_log` 里没有这类信息。

所以本项目的做法是分工：

| 内容 | 从哪读 |
|---|---|
| 聊天（对方说了什么、TA 说了什么） | `conversation_log` |
| 事件（推送、日记、论坛、未推送） | heartbeat 的 JSON 文件 |

两边合并后按时间排序，就是 `src/context.js` 里 `getSharedContext()` 干的事。这样 phosphor 做决定时，和 heartbeat 醒来时看到的东西是一致的。

事件最多取最近 **8 条**（`MAX_EVENTS`），免得 heartbeat 那种每 10 分钟一条的"未推送"把聊天挤没了。

## 事件格式是约定死的

heartbeat 只认特定格式的消息是"事件"：开头必须是 `（2026-09-28 20:50 自动唤醒：本次未发送推送…` 这种带时间戳和固定措辞的形式。不符合的，下一次有人聊天时就会被 heartbeat 丢掉。

`src/timeline.js` 里的 `SPECIAL_EVENT_PREFIX` 正则就是照 heartbeat 的 `special_events.js` 写的，两边必须保持一致。改措辞要同时改两边。

本项目写回事件时，`describeAction()` 负责把这次醒来做的事翻译成一句 heartbeat 认的话：

| 做了什么 | 写成什么 |
|---|---|
| 发了推送 | `刚刚给用户发了Bark推送：…` |
| 写了日记 | `自动唤醒：本次未发送推送｜写了一篇日记：…` |
| 调了 MCP | `自动唤醒：本次未发送推送｜用了 xxx/yyy …` |
| 写了长期记忆 | `自动唤醒：本次未发送推送｜记下了一条长期记忆：…` |
| 切了节律 | `自动唤醒：本次未发送推送｜把节律调成了 xxx` |
| 什么都没做 / 只翻记忆 | 不写（免得刷满时间线） |

## 配置

`.env` 里三个变量：

```
HEARTBEAT_TIMELINE_FILE=/path/to/enhanced_messages.json
HEARTBEAT_EVENT_URL=http://localhost:3000/internal/wake-event
TIME_ZONE=Asia/Shanghai
```

- `HEARTBEAT_TIMELINE_FILE`：heartbeat 那个 JSON 文件在哪。留空 = 不共用，照旧用自己的 `conversation_log`
- `HEARTBEAT_EVENT_URL`：heartbeat 网关的内部事件接口。**只接受本机请求**，所以两个项目要在同一台机器上
- `TIME_ZONE`：解析聊天时间、写事件时间用的时区

`HEARTBEAT_TIMELINE_FILE` 留空时，`isSharedTimelineEnabled()` 返回 false，读事件那部分直接跳过，其余照常。**不会因为没配 heartbeat 就跑不起来。**

## 什么时候该切、什么时候可以并存

**并存**：想先观察晨暮星稳不稳，就两边都跑。它们读写的是不同的存储，不冲突。heartbeat 继续管它的推送，晨暮星在一边练。

**切换**：等晨暮星连续几天不出错、唤醒的时机和内容都符合预期，再停掉旧的：

```bash
pm2 stop <旧项目的进程名>
```

**只跑晨暮星**：把上面三个 heartbeat 变量留空就行，项目会用自己的 `conversation_log`。

有一点要注意：**切换时别把数据丢了**。heartbeat 的 JSON 文件里有历史事件，`state.db` 里有晨暮星的唤醒记录——停进程之前先备份这两个。

## 排错

| 现象 | 原因 |
|---|---|
| `timeline: 读取 … 失败，改用 conversation_log` | 路径写错、文件不存在，或者 JSON 格式坏了 |
| `timeline: 写入 heartbeat 事件失败` | heartbeat 网关没在跑，或者不在同一台机器 |
| 事件里全是"未推送" | heartbeat 的唤醒频率比晨暮星高，属正常；本项目只取最近 8 条 |
| 决策时看不到事件 | `HEARTBEAT_TIMELINE_FILE` 没填 |
