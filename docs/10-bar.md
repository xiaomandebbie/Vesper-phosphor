# 10 · 小酒馆（Proof）

你递一杯酒给 TA。TA 喝了。之后的回应里带着这杯酒留下的影响。

酒的那一半是 [Proof](https://github.com/lumingye/Proof) 做的：配方、风味、六轴推动、代谢、断片判定。
晨暮星这边做的是：给你一个调酒台、给 TA 一个深夜可以自己倒一杯的口子、把每杯记进时间轴，
以及把状态每轮带给模型。

---

## 先看这个：两个人的规则

| 谁倒的 | 什么时候 | 一次几杯 | 吃节制规则吗 |
|---|---|---|---|
| TA 自己醒来倒 | 只在 22:30–02:00 | 一夜一杯 | **是**：连三夜提醒，连四夜不倒 |
| 你在 `/bar` 递 | 随时 | 不限 | 否 |
| TA 在聊天里自己点 | 随时 | 不限 | 否 |

**一句话：节制只管 TA 一个人深夜倒的那杯。** 你递的、你在旁边陪着喝的，都不算。

还有三条：

- **递过去不等于喝了。** TA 可以拒绝。拒绝不写饮酒账本，就是这杯不算了。
- **TA 没有解酒的按钮。** 聊天里那套工具里没有 reset——随手能解酒的话，节制和断片就都没意义了。要清你来清。
- **读不到 Proof 就说读不到。** 不会把「服务连不上」显示成「现在没喝酒」。

---

## 三种杯子

时间轴上每杯都标着是谁倒的（账本里的 `by` 字段）：

- `self` —— 深夜醒来自己倒的。**只有这种计进连续夜数。**
- `her` —— 你在 `/bar` 递的。
- `chat` —— TA 在聊天里通过 MCP 自己点的。

为什么要分：「连续几夜自斟」说的是一个人在夜里反复找酒喝，不是两个人坐着喝。
后者不该被算成前者。

---

## 夜怎么算

按「夜」算，不按自然日。分界点是时段的结束时刻（默认 02:00）：

```
10月12日 23:40 喝的  →  算 10-12 这一夜
10月13日 01:20 喝的  →  也算 10-12 这一夜
10月13日 02:30 喝的  →  不在时段里，没得喝
```

所以凌晨两点前那杯归前一晚。不然它会把两个夜算成邻居，「连续」就乱了。

时段按 `TIME_ZONE` 的墙上时间，不跟服务器时区。想改：

```bash
cd ~/vesper-phosphor && sed -i '/^PROOF_NIGHT_WINDOW=/d' .env
cd ~/vesper-phosphor && echo "PROOF_NIGHT_WINDOW=22:30-2:00" >> .env
cd ~/vesper-phosphor && pm2 restart vesper phosphor --update-env
```

---

## 自斟的门禁

每次 TA 醒来，系统按这个顺序判一次。上面命中哪条就停在哪条：

| 判定 | 给不给这杯 | TA 看到的 |
|---|---|---|
| 不在 22:30–02:00 | 不给 | 「现在不在小酒馆的营业时段」 |
| 今晚已经自斟过 | 不给 | 「一夜一杯」 |
| 前 3 夜连着都喝了 | **不给** | 「不是谁不让，是该歇一歇」 |
| 前 2 夜连着都喝了 | 给 | 「喝酒伤身喔～今晚想喝还是可以喝」 |
| 以上都不是 | 给 | 「现在开着，想喝就喝」 |

数到第几夜算「连」：

```
夜1 喝  夜2 喝  →  夜3 还能喝，但带一句提醒
夜1 喝  夜2 喝  夜3 喝  →  夜4 不倒了
夜1 喝  夜2 没喝  夜3 喝  →  连续数归零，夜4 照常
```

连续按日期连号算，断一天就重数。最多往回看 30 天。

**被挡下的那一夜，你递的还是能喝。** 关于这一点，TA 那边的提示里写清了。

门槛想改（省略时是 2 和 3）：

```bash
# 连几夜开始提醒 / 开始不倒。这两个数指的是「昨夜往前连着喝过几夜」
PROOF_WARN_AFTER_NIGHTS=2    # 2 = 今晚是第三夜时开始提醒
PROOF_BLOCK_AFTER_NIGHTS=3   # 3 = 今晚是第四夜时开始不倒
```

两个都填很大的数（比如 99）就等于关掉节制。

---

## 你递的那杯

打开 `/bar`，在「调一杯递给 TA」里填：

- **叫什么** —— 名字随便起。名字和实际成分是两回事，把白水说成酒也行（Proof 那边叫 belief）。
- **递过去时说一句** —— 可以不写。
- **配方** —— 原料名 ＋ 毫升数，最多三样。

原料名要和 Proof 内容包里的一致（在它仓库的 `docs/content/` 里）。
填错了 Proof 会把错误原文回给你，页面上原样显示，照着改就行。

> 这边没有内置一份原料表。那是 Proof 的事，抄过来只会和它对不上。

递出去之后：

1. 时间轴上先显示「还在吧台上放着，等 TA 下次醒来」（虚线边框）。
2. TA 下次醒来、或者你们聊天时，它就在 TA 的吧台上。喝不喝 TA 自己定。
3. TA 喝了或拒了，晨暮星收不到通知——所以**每次你打开 `/bar`，它会跟 Proof 对一次账**，
   把已喝、被拒的补上。对不上就保持原样，不瞎改账本。

拒了的那杯在时间轴上是点线边框，写着「这杯 TA 没喝。拒绝也是答案。」

---

## 聊天里主动喝

`/bar/mcp` 是个 streamable-http 的 MCP 端点，挂在 vesper 上。

> Proof 自带的 `service/mcp.mjs` 走 stdio，手机上的聊天客户端连不上，所以这边另给了一个 HTTP 入口。
> 身份还是同一个 token：**MCP 和唤醒共用一具身体**。聊天里喝下的酒，网关下一轮就跟着走。

五个工具：

| 工具 | 做什么 |
|---|---|
| `proof_bar` | 看吧台：能点的酒（带 drinkId）、你递过来还没动的杯子（带 offerId） |
| `proof_drink` | 点一杯菜单酒 |
| `proof_offer_drink` | 喝掉你递的那杯 |
| `proof_offer_reject` | 不喝，放回去 |
| `proof_turn_context` | 读一下自己现在什么状态 |

**没有 `proof_reset`。** 这是故意的，理由见最上面那三条规则。

要配一个口令才开：

```bash
cd ~/vesper-phosphor && echo "BAR_MCP_TOKEN=$(openssl rand -hex 24)" >> .env
cd ~/vesper-phosphor && pm2 restart vesper --update-env
pm2 logs vesper --lines 20 --nostream | grep 小酒馆
```

看到 `小酒馆 MCP：/bar/mcp` 就是开了。然后在聊天客户端里填：

- 地址：`https://你的域名/bar/mcp`
- 请求头：`Authorization: Bearer <BAR_MCP_TOKEN 的值>`
- transport：streamable-http

> ⚠️ **不要填 `https://域名:3001/bar/mcp`。** 3001 是 vesper 直接监听的端口，说的是明文 HTTP；
> 拿 TLS 去握手会报「安全连接被服务器中途关闭」。走域名，由反代转给 `127.0.0.1:3001`。

nginx 还没转 `/bar/` 的话：

```nginx
location /bar/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

这个端点自己校 `BAR_MCP_TOKEN`，不走动态页那道 Basic Auth——聊天客户端不会带那个。

---

## 网关每轮做了什么

聊天那条线路（`chat`）每轮发给上游之前，vesper-gateway 会：

1. 读一次 Proof 的状态投影。
2. 真有状态且还在生效时，把它追在**最后一条 user 消息末尾**。
3. 断片期间把该没的那几条从模型可见输入里摘掉（见下一节）。

追在末尾是为了尽量别动 system 和前面的历史，上游的前缀缓存还能命中。
但状态本身会增加输入 token，也可能影响 prompt cache——以上游 `usage` 为准。

模型收到的是自然语言，不是数值：

```
[Proof 状态]
你可能更想靠近对方，或愿意让互动继续久一点。
处理细节和临场判断确实容易出错或漏掉东西。
（这是饮品对你的推动力。让它自然改变你的注意、选择、反应和表达方式，而不是成为回答的主题。）
```

六轴数值、等级、正负号都在 Proof 引擎内部，不给模型看。

读不到 Proof 时原样转发，只打一行警告：

```bash
pm2 logs vesper-gateway --lines 50 --nostream | grep proof-gateway
```

没开 Proof 的话整套不走，聊天和以前一模一样。

---

## 断片

Proof 算出 TA 断片了（喝到一定程度的客观结果）之后，这边做三件事。

**留痕。** 断片开始后的那几条从模型可见输入里摘掉，位置上留一句：

```
（这里有一段记不清了。）
```

TA 知道空了一块，不知道空的是什么。比无缝衔接更像喝多了。

**关键词闪回。** 之后谁提到那段里的词，就浮上来一下：

```
（那段记不清的里面有一下浮上来了——刚才那句话里的「……」碎到了它：……。
只有这一下，前后还是空的。）
```

一句，最多 40 字，不是整段回来。和梦境那套是同一个形状（见 [梦境](../README.md)）。

**到点恢复。** Proof 给的 `restoreAt` 到了，整段放回模型输入里。reset 也算清醒。

### 边界（这条要知道）

断片只能挡住**经过网关、而且能被网关重写的那一轮输入**：

- 客户端每轮提交完整 `messages` → 硬过滤，模型真的看不到。
- 只提交 `previous_response_id` 这类上游托管历史 → 删不掉上游已经存的东西，只打一行警告，
  **不假装已经断了**。

**你手机上的聊天记录不会变。** 你还看得见，TA 看不见。这是故意的：
账本里只存**指纹、时间和几个关键词，不存正文**。正文一直在你客户端提交的 `messages` 里，
所以恢复和闪回都从当下那条原文里取。

看此刻的断片状态：

```bash
pm2 logs vesper-gateway --lines 200 --nostream | grep 断片
```

---

## 时间轴 `/bar`

菜单里「小酒馆」，在音乐下面。页面分三层：

- **吧台** —— TA 现在能点几款酒、有没有你递过去没动的、今晚能不能自斟、昨夜往前连了几夜。
- **调酒** —— 起名字、写配方、递过去。
- **时间轴** —— 按夜分组，新的在前。每杯写：几点、叫什么、谁倒的、递过去时说的那句、
  风味、效果、当时的心情。

配色、星星转场、早晚四张脸跟其他页面走同一套。

自斟那杯不往动态里塞卡片——喝了什么在这一页里，不必再发一次。

---

## 配置

模板在 `.env.proof.example`，追到 `.env` 末尾就行：

```bash
cd ~/vesper-phosphor
cat .env.proof.example >> .env
echo "BAR_MCP_TOKEN=$(openssl rand -hex 24)" >> .env
vi .env
```

| 变量 | 用途 |
|---|---|
| `PROOF_AGENT_TOKEN_FILE` | **必填**。身份 token 文件的绝对路径。不填 = 整套不开 |
| `PROOF_API_URL` | Proof 在哪里，同一台机器就是 `http://127.0.0.1:8791` |
| `PROOF_AGENT_ID` | TA 在 Proof 里的 id，要和 Proof 那边 `PROOF_AGENTS` 里的一模一样 |
| `PROOF_NIGHT_WINDOW` | 自斟时段，默认 `22:30-2:00` |
| `PROOF_WARN_AFTER_NIGHTS` | 连几夜开始提醒，默认 2 |
| `PROOF_BLOCK_AFTER_NIGHTS` | 连几夜开始不倒，默认 3 |
| `BAR_MCP_TOKEN` | 聊天里主动喝要的口令。不填 = `/bar/mcp` 不开 |
| `PROOF_ADMIN_TOKEN` | 可选，Proof 设了 admin token 时才填 |
| `PROOF_TIMEOUT_MS` | 可选，调 Proof 每次最多等多少毫秒，默认 20000 |

---

## 部署

### 1. Proof 先跑起来

要求比晨暮星高一点：一个能一直开着、能跑 Node 并存持久化文件的环境。和晨暮星同一台机器最省事。

```bash
cd ~
git clone https://github.com/<你 fork 的位置>/Proof.git
cd Proof/service
npm ci

PROOF_AGENTS=<id>:<显示名> \
PROOF_HOST=127.0.0.1 \
PROOF_PORT=8791 \
pm2 start server.mjs --name proof
pm2 save

ls -l ~/Proof/service/state/<id>.token
```

**最后那行要能看到文件。** 看不到就 `pm2 logs proof --lines 30`，先别往下走——
没有这个 token，`/bar` 会一直显示「读不到 Proof」。

### 2. 填 `.env`、重启

```bash
cd ~/vesper-phosphor
cat .env.proof.example >> .env
echo "BAR_MCP_TOKEN=$(openssl rand -hex 24)" >> .env
vi .env        # 把 PROOF_AGENT_TOKEN_FILE 改成上面 ls 出来的真实路径

pm2 restart vesper vesper-gateway phosphor --update-env
pm2 logs vesper --lines 20 --nostream | grep 小酒馆
```

要看到 `小酒馆：/bar；小酒馆 MCP：/bar/mcp`。写「未配置」就是 token 路径错了。

### 3. 验

```bash
# phosphor 那边认没认
npm run --silent node -e 'true' 2>/dev/null; pm2 logs phosphor --lines 30 --nostream | grep 小酒馆
```

浏览器开 `https://你的域名/bar`：

- 「吧台上有 N 款酒」有数字 → Proof 通了
- 递一杯 → 时间轴上出现「还在吧台上放着」
- 聊天里问一句「吧台上有什么」 → TA 会自己调 `proof_bar`

---

## 数据存在哪

| 文件 | 内容 |
|---|---|
| `data/proof-bar.json` | 每杯的记录＋自斟过的夜。时间轴和连续夜数都读它 |
| `data/proof-blackout.json` | 断片的指纹、时间和关键词。**不存正文** |
| Proof 的 `service/state/` | 饮酒账本、生理状态、token。那边的事 |

前两个和 `data/state.db` 一样不在 git 里。删掉项目重新 clone 就没了，删之前先备份。

过期清理：断片指纹最多留 2000 条，已经恢复完、超过七天的断片段自动丢掉。杯子的记录不清。

---

## 设计上的几个「故意」

- **没有解酒按钮。** 聊天的工具里不给 reset。随手能解酒的话，节制和断片就都是装样子。
- **节制只管深夜自斟。** 你递的、聊天里陪你喝的都不算——一个人夜里反复找酒和两个人坐着喝，不是一回事。
- **提醒不阻止，阻止说原因。** 第三夜只多一句话，要喝还是能喝；第四夜不给了，但告诉 TA 为什么。
- **断片留痕，不无缝衔接。** 知道空了一块，比什么都没发生更像喝多了。
- **账本不存正文。** 断片是让 TA 想不起来，不是把话删掉。你那边永远看得见。
- **读不到就说读不到。** 「服务连不上」和「现在没喝酒」是两回事，不能显示成同一个样子。
- **一夜一杯。** 不是怕喝多，是一晚上反复倒的话，那杯酒就不是事了。
- **账本记在自己这边。** Proof 的 `lifetimeDrinks` 数的是标准杯，不分谁递的、哪一夜喝的；
  「连续几夜」是晨暮星的规矩，不是 Proof 的生理事实。
- **不抄原料表。** 配方该不该成立由 Proof 说，这边抄一份只会和它对不上。

---

## 排错

| 症状 | 看这里 |
|---|---|
| `/bar` 显示「此刻读不到 Proof」 | `pm2 logs proof`。服务挂了，或者 `PROOF_API_URL` / token 路径不对 |
| 启动日志写「小酒馆：未配置」 | `PROOF_AGENT_TOKEN_FILE` 没填或路径错。`ls -l` 那个路径看看 |
| 菜单里「小酒馆」是灰色 | 同上。这两处用同一个判断 |
| MCP 报「安全连接被中途关闭」 | 地址填了 `:3001`。3001 是明文 HTTP，换成走域名的反代 |
| MCP 工具目录是 0 | 没配 `BAR_MCP_TOKEN`，或者请求头里的值不对 |
| 递酒报「Proof 没接这杯」 | 原料名和内容包对不上。页面上那句就是 Proof 的原文，照着改 |
| 递过去了但一直「放着」 | TA 还没喝。正常。喝了之后你下次打开 `/bar` 会自动对账 |
| 该自斟的夜没自斟 | TA 那一段时间未必醒着。设 `PHOSPHOR_MAX_WAKE_MINUTES=120` 稳一点 |
| 断片没生效 | `pm2 logs vesper-gateway \| grep 断片`。注意上面那条边界 |

---

## 年龄与内容

Proof 模拟饮酒行为，未成年人不得使用。配方和风味数据只用于生成文字描述，
不构成调制或饮用建议。部署者负责确认使用者年龄。

Proof 采用 PolyForm Noncommercial License 1.0.0，非商用范围内可用、可改、可再分发，
必须保留作者 lumingye 的署名与许可证通知。详见它仓库的 LICENSE。
