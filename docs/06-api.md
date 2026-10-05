# 06 · 接口说明

想从外面"伸手进来"看看 TA 的状态、改模式、替 TA 约一次醒来、给动态留言，都通过这些接口。

下面例子里的 `服务器` 换成你的地址：VPS 上用 `localhost`，从外面访问用服务器公网 IP。

---

## vesper（3001 端口）

### 鉴权

`/report-status` 和所有 `/wake/*`：请求头带 `x-api-key`，值是 `.env` 里的 `REPORT_STATUS_API_KEY`。

`/moments`、`/health`、`/media`：浏览器会弹登录框，填 `VESPER_BASIC_USER` / `VESPER_BASIC_PASS`。

> ⚠️ `REPORT_STATUS_API_KEY` 留空时**不校验**，任何人都能调这些接口。`VESPER_BASIC_USER/PASS` 留空时动态页谁都能进、谁都能留言。开放公网前一定要填。

### 一览

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/wake/state` | 当前 mode、下次醒来时间、心情、最近一次动作和结果 |
| GET | `/wake/log?limit=20` | 最近的唤醒记录，含 noop 和出错（最多 200） |
| GET | `/wake/conversation?limit=50` | 最近记录的对话（最多 500） |
| POST | `/wake/mode` | 切换 mode，**可以切 silent** |
| POST | `/wake/self-wake` | 替 TA 约一次精确唤醒 |
| POST | `/wake/conversation` | 手动推对话记录 |
| GET | `/wake/moments?limit=20` | 最近的动态，每条带留言、回复和点赞（最多 100） |
| POST | `/wake/moments/:id/comments` | 给某条动态留言，或回复某条留言 |
| POST | `/wake/moments/:id/like` | 点赞 / 取消点赞 |
| GET | `/wake/anniversaries` | 纪念日列表 |
| POST | `/report-status` | 手机上报电量、位置、屏幕时间 |
| GET | `/moments` | 动态网页：心情、纪念日、日历、最近 20 条动态 |
| GET | `/diary` | 旧入口，会跳到 `/moments` |
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

三个字段都可以不传，不传就记为空。`location` 写一个模糊的地名就够了，会被放进给模型的提示里。

### 动态、留言、回复、点赞

平时直接用浏览器打开 `http://服务器IP:3001/moments` 就行。下面几个接口是给快捷指令、以后的前端用的。

看最近 5 条动态：

```bash
curl -s "服务器:3001/wake/moments?limit=5" -H "x-api-key: 你的key"
```

返回里每条动态有：

- `id`、`content`、`image_url`、`audio_url`
- `kind`：`post` 是 TA 发的动态，`activity` 是黄卡（行为记录）
- `detail`：黄卡的详情，没有就是 `null`
- `comments`：留言数组。`author` 是 `user`（你）或 `assistant`（TA）；`reply_to` 是回复的那条留言的 id，直接给动态留言时是 `null`；`handled` 是 0 表示 TA 还没看到
- `likes`：谁赞过，`[{"author":"user","ts":...}]`

给 id 为 3 的动态留言：

```bash
curl -s -X POST 服务器:3001/wake/moments/3/comments \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"content":"这张图好好看"}'
```

回复这条动态下 id 为 12 的留言，加一个 `reply_to`：

```bash
curl -s -X POST 服务器:3001/wake/moments/3/comments \
  -H "x-api-key: 你的key" -H "content-type: application/json" \
  -d '{"content":"真的吗","reply_to":12}'
```

被回复的留言必须在同一条动态下，不然返回 400。留言最多 1000 字。TA 下次醒来会看到，还会知道你回的是哪一条。

点赞 / 取消点赞（再调一次就取消）：

```bash
curl -s -X POST 服务器:3001/wake/moments/3/like -H "x-api-key: 你的key"
# {"ok":true,"liked":true}
```

### iOS 快捷指令怎么配上报

上报的是电量、位置、屏幕时间这三样，TA 醒来时会看到。三个字段都可以不传。

#### 先找到 key

在服务器上执行：

```bash
grep REPORT_STATUS_API_KEY ~/vesper-phosphor/.env
```

等号后面那一串就是。如果这行是空的（当初没填），现在生成一个：

```bash
openssl rand -hex 16
```

把结果写进 `.env` 那一行，然后重启：

```bash
pm2 restart vesper --update-env
```

> ⚠️ 这个 key 不要截图、不要贴进聊天。它保护着 `/report-status` 和所有 `/wake/*`，拿到它的人能替你切 silent、能读你们最近的对话记录。

#### 开始配

1. **新建快捷指令**，加「获取电池电量」
2. **加「获取 URL 内容」**，展开「显示更多」：
   - URL：`http://你的服务器IP:3001/report-status`
   - 方法：**POST**
   - 头部：加一行，键 `x-api-key`，值填上面查到的 key
   - 请求体：选 **JSON**，加字段 `battery`，值选「电池电量」
3. **末尾加「快速查看」**，手动跑一次
4. 返回 `{"ok":true}` 就是通了

> 「获取电池电量」返回的本来就是 0～100 的百分数（比如 78），**不用再乘 100**。要是看到报上去是 `0.78`，那是取到了小数，检查一下变量选的是不是「电池电量」这个动作的结果。

#### 加位置（可选）

在「获取 URL 内容」**前面**插两步：

1. 「获取当前位置」
2. 「获取位置的详细信息」→ 从里面取「名称」（或「街道」）

然后回到请求体，加一个字段 `location`，值选刚取到的那个。

第一次跑会弹定位授权，允许就行。「名称」给的是「××区××路」这种文字，够用了——服务器只是把它拼进 TA 醒来时看的那句话，越模糊越好，不用精确到门牌。

> 想连坐标一起报也行（`location` 里写经纬度），但接口走的是 http 明文。介意的话就只报「名称」。

#### 屏幕时间：iOS 读不到

`screen_time_min` 这个字段**没法用快捷指令填**。屏幕使用时间的数据锁在「设置」里，快捷指令没有对应的读取动作——在动作库里搜「屏幕」就能确认，搜不出能读到使用时长的东西。

不传这个字段就行，TA 醒来看到的是「今日屏幕使用未知」，不影响别的。

#### 挂自动化

快捷指令 App →「自动化」→ 新建个人自动化 → 选「特定时间」（比如每小时）或「打开某 App 时」→ 关掉「运行前询问」→ 选中刚才那个快捷指令。

#### 两个容易卡住的地方

- **云服务器的防火墙（安全组）要放行 3001 端口**。不放的话快捷指令会一直转圈，最后超时。腾讯云 / 阿里云在控制台的「安全组」里加一条入站规则：协议 TCP、端口 3001、来源填你的手机出口 IP（不确定就先填 `0.0.0.0/0`）
- 服务器上如果开了 firewalld，也要放：

```bash
firewall-cmd --add-port=3001/tcp --permanent && firewall-cmd --reload
```

> ⚠️ 这个接口走的是 http 明文，key 在请求头里裸传。别把 3001 直接开到公网上给人扫，能挂 nginx 反代加 https 最好。

#### 验证上报进来了没

先看设备状态：

```bash
cd ~/vesper-phosphor
node -e "const D=require('better-sqlite3');const db=new D('data/state.db');console.log(db.prepare('SELECT * FROM device_reports ORDER BY ts DESC LIMIT 5').all());"
```

能看到刚上报的那一行、`battery` 是 0～100 之间的整数就对了。

再看 TA 那边读到的：

```bash
curl -s 服务器:3001/wake/state -H "x-api-key: 你的key"
```

设备状态本身不进 `/wake/state`，它是每次醒来时拼进决策提示里的（`最近设备状态：电量…%`），想看那一段就翻唤醒日志：

```bash
pm2 logs phosphor --lines 100 --nostream | grep 电量
```

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
| `chat` | `CLIENT_UPSTREAM_*` | **会**；接了 Drivesoid 时还会上报给它 |
| `vesper-decide` | `DECIDE_UPSTREAM_*` | 不会 |
| `heartbeat-wake` | `DECIDE_UPSTREAM_*` | 不会，但会注入跨窗口的共享上下文（见 [08](08-heartbeat.md)） |

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
