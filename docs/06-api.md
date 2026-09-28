# 06 · 接口说明

想从外面"伸手进来"看看 TA 的状态、改模式、替 TA 约一次醒来，都通过这些接口。

下面例子里的 `服务器` 换成你的地址：VPS 上用 `localhost`，从外面访问用服务器公网 IP。

---

## vesper（3001 端口）

### 鉴权

`/report-status` 和所有 `/wake/*`：请求头带 `x-api-key`，值是 `.env` 里的 `REPORT_STATUS_API_KEY`。

`/diary`、`/health`、`/media`：浏览器会弹登录框，填 `VESPER_BASIC_USER` / `VESPER_BASIC_PASS`。

> ⚠️ `REPORT_STATUS_API_KEY` 留空时**不校验**，任何人都能调这些接口。开放公网前一定要填。

### 一览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/wake/state` | 当前 mode、下次醒来时间、心情、最近一次动作和结果 |
| GET | `/wake/log?limit=20` | 最近的唤醒记录，含 noop 和出错（最多 200） |
| GET | `/wake/conversation?limit=50` | 最近记录的对话（最多 500） |
| POST | `/wake/mode` | 切换 mode，**可以切 silent** |
| POST | `/wake/self-wake` | 替 TA 约一次精确唤醒 |
| POST | `/wake/conversation` | 手动推对话记录 |
| POST | `/report-status` | 手机上报电量、位置、屏幕时间 |
| GET | `/diary` | 日记网页（最近 50 篇） |
| GET | `/health` | 活着没 |

### 常用例子

看 TA 现在怎么样：

```bash
curl -s 服务器:3001/wake/state -H "x-api-key: 你的REPORT_STATUS_API_KEY"
```

`next_wake_at` 是毫秒时间戳，转成人能看的时间：

```bash
node -e "console.log(new Date(1759000000000).toLocaleString())"
```

看最近 5 次醒来都干了啥：

```bash
curl -s "服务器:3001/wake/log?limit=5" -H "x-api-key: 你的key"
```

让 TA 安静一阵 / 恢复：

```bash
curl -s -X POST 服务器:3001/wake/mode \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"mode":"silent"}'

# 改回来："normal" 或 "low-frequency"
```

> silent 只暂停"非精确链"。已经约好的精确唤醒**照样会醒**。

替 TA 约 15 分钟后醒一次：

```bash
curl -s -X POST 服务器:3001/wake/self-wake \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"after_minutes":15,"note":"说下班了"}'
```

`note` 会原样告诉醒来的 TA。

手动推一条对话：

```bash
curl -s -X POST 服务器:3001/wake/conversation \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"speaker":"user","content":"我到家了"}'

# 批量
# -d '{"messages":[{"speaker":"user","content":"..."},{"speaker":"assistant","content":"..."}]}'
```

`speaker` 填什么就显示成什么。走网关自动记录时，用的是 `.env` 里的 `USER_DISPLAY_NAME` / `AI_DISPLAY_NAME`。

手机上报状态（适合做成 iOS 快捷指令定时跑）：

```bash
curl -s -X POST 服务器:3001/report-status \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"battery":78,"location":"家","screen_time_min":120}'
```

三个字段都可以不传，不传就记为空。`location` 写一个模糊的地名就够了，会被放进给模型的 prompt 里。

### iOS 快捷指令怎么配上报

1. 新建快捷指令，加"获取电池电量"
2. 加"获取 URL 内容"：URL 填 `http://服务器IP:3001/report-status`，方法 `POST`
3. 头部加 `x-api-key` = 你的 key；请求体选 JSON，加字段 `battery` = 电池电量
4. 自动化 → 按时间或"打开某 App 时"运行

---

## vesper-gateway（3002 端口）

### 鉴权

请求头 `Authorization: Bearer 你的GATEWAY_API_KEY`。

### 一览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/v1/models` | 列出可用模型名（客户端"拉取"按钮用） |
| POST | `/v1/chat/completions` | OpenAI 兼容对话接口，按 `model` 分流 |

### 路由表

| 请求里的 model | 转发到 | 会记录对话吗 |
|---|---|---|
| `chat` | `CLIENT_UPSTREAM_*` | **会** |
| `vesper-decide` | `DECIDE_UPSTREAM_*` | 不会 |
| `heartbeat-wake` | `DECIDE_UPSTREAM_*` | 不会，但会注入跨窗口的共享上下文 |

转发时会把 `model` 换成上游的真实模型名，其余请求内容原样透传，流式也照常边收边发。

> 旧名 `aru-chat` 仍指向 `chat` 同一条上游，已经配好的不用改。

### 测试

```bash
curl -s 服务器:3002/v1/chat/completions \
  -H "Authorization: Bearer 你的GATEWAY_API_KEY" -H "content-type: application/json" \
  -d '{"model":"vesper-decide","messages":[{"role":"user","content":"说一个字"}]}'
```

用 `vesper-decide` 测试不会往对话记录里写东西，用 `chat` 会。

### 网关日志怎么看

```
gateway: source=client model=chat->deepseek-flash target=https://api.deepseek.com status=200 1834ms
```

- `status` 是**上游**返回的状态码
- 耗时特别短（一两百毫秒）但 phosphor 报空内容：多半是上游返回了没有正文的 200，见 [05](05-pitfalls.md)

---

## Ombre Brain 工具（phosphor 通过 MCP 调用）

| 工具 | 作用 | 什么时候用 |
|---|---|---|
| `breath()` | 看看自己现在记得什么 | 最省 token，每次醒来自动调一次 |
| `breath_search(query)` | 按关键词/语义检索 | 想找具体的事 |
| `feel(query)` | 翻感受类记忆 | 每次醒来 phosphor 也会自动调一次 |
| `hold(content, ...)` | 写一条长期记忆 | **只在真觉得值得记住时**，不要每次醒来都写 |
