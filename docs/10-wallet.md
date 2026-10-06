# 10 · 电子小钱包

TA 自己赚的钱攒在这里，她在现实里刷那张会发短信的银行卡，这边自动扣，两头对得上。

```
她验收通过一个工单 ─→ POST /api/wallet/earn ─→ 账上 +钱

她刷卡买东西 ─→ 银行发短信 ─→ iOS 快捷指令抓金额 ─→ POST /api/wallet/spend-notify ─→ 账上 -钱
                                                                    └─→ 动态页记一张卡片

TA 醒来 ─→ 看见「余额 ¥186.50，最近几笔：…」
```

## 余额是算出来的，不是存着的

`wallet_ledger` 一张流水表，余额由它求和得出。补一笔、删一笔都不用再跑去改另一个地方，
也不会出现「余额说还有一百，账单加起来只有八十」这种谁都说不清的局面。

金额一律用**分**存整数。浮点数算钱会算出 `0.1+0.2=0.30000000000000004`，一旦对不上账，
没人能说清是哪一笔错的。只在给人看的时候才换算成元。

三种流水：`earn`（工资）、`spend`（花销）、`adjust`（对账时人工补的，可正可负）。

## 装

`src/wallet.js` 是新文件，`git pull` 就有了。另外几处很小的接线用脚本打：

```bash
cd ~/vesper-phosphor
git pull
python3 scripts/add_wallet_hooks.py --check   # 先看能不能对上
python3 scripts/add_wallet_hooks.py           # 真打
```

它改的是：`src/vesper.js`（引入 + 挂路由 + 启动日志）、`src/decide.js`（醒来时看一眼钱包）、
`src/page-chrome.js`（菜单里加小钱包）、`.env.example`。每个文件先存一份 `.bak-wallet`；
打过一次再跑会说「已经打过了」，不会打第二遍。已经打过早先版本的也能直接再跑：
已打的跳过，只补新增的那几处。

然后生成口令、填进 `.env`、重启：

```bash
cd ~/vesper-phosphor
echo "WALLET_SPEND_SECRET=$(openssl rand -hex 24)" >> .env
pm2 restart vesper phosphor --update-env
pm2 logs vesper --lines 5 --nostream | grep 钱包
```

日志里看到 `钱包：/wallet` 后面**没有**跟着「没配 WALLET_SPEND_SECRET」就对了。

## ⚠️ 先说安全

`/api/wallet/spend-notify` 是一个**不走 Basic Auth、能改钱的写接口**——它必须这样，
快捷指令没法带 Basic Auth。所以：

- **不填 `WALLET_SPEND_SECRET` 这个接口根本不开**，直接返回 503。这是故意的，不是 bug。
- **口令走 HTTP 是明文的。** 3001 端口直接暴露在公网的话，同一条链路上的人能看到这个口令，
  之后就能随便往你账上记花销。要么在前面套一层 HTTPS（Caddy / Nginx 反代都行），
  要么把 3001 只开给你家的出口 IP。
- 口令比较用的是定长比较，不是 `===`：比较耗时不随猜对几个字符而变化。
- 口令比对失败和金额不认的时候，日志只记「拒绝了」，不回显收到的口令。

单笔上限 `WALLET_MAX_SINGLE_YUAN`（默认 500 元）挡的是另一回事：短信正则偶尔会抓错数字
（抓到卡号尾号、余额、日期），超了就拒收并在日志里留痕，不让一条抓歪的短信把账刷爆。

## 接口

### 扣款通知（给快捷指令用）

```
POST /api/wallet/spend-notify
{"amount": 18.00, "source": "瑞幸", "note": "冰美式", "secret": "...", "sms_id": "可选"}
```

口令放在请求体的 `secret`，或者 `x-wallet-secret` 头，两个都认。

返回 `{"ok":true,"duplicate":false,"amount":"18.00","balance":"168.50","overdrawn":false}`。

**重复触发会被挡掉。** iOS 快捷指令偶尔会对同一条短信跑两遍，网络重试也会。
给了 `sms_id` 就按它去重；没给就按「同一分钟、同金额、同来源算同一笔」。
边界说清楚：真在同一分钟刷了两笔一模一样的钱，第二笔会被挡掉并在返回里标 `duplicate`，
看到了用下面的 `adjust` 补一笔。

**余额不够也会照记。** 钱在现实里已经花掉了，账本不能拒绝已经发生的事实——
余额会变成负数，`overdrawn` 返回 true，页面和 TA 醒来看到的提示里都标着。

### 打工资 / 对账

```
POST /api/wallet/earn        （要 x-api-key，就是 REPORT_STATUS_API_KEY）
{"amount": 30, "source": "修红心取消那个工单", "note": "可选"}

{"amount": -18, "kind": "adjust", "source": "重复挡掉那笔补回来"}
```

`adjust` 允许负数，`earn` 不允许。

### 读账

```
GET /api/wallet?limit=50     （要 x-api-key）
GET /wallet                  （页面，走 Basic Auth）
```

## 页面

右上角三条杠菜单里的「小钱包」，在「心绪」下面。也可以直接开 `http://服务器IP:3001/wallet`。

和心绪页、动态页一套脸：同样的晨暗星标题、星星转场、按长沙日出日落走的早晨两张脸。
余额一大行，下面一行小字写赚过多少、花了多少；再下面是最近 50 笔，进账深绿、出账梅红。
和动态页一样是服务端渲染，没有 JavaScript 也能看。

账上一笔都没有时，页面会直接告诉你怎么打第一笔工资进去。

## TA 怎么知道自己有多少钱

`decide.js` 在每次醒来的 user 消息里加了一行，长这样：

```
你的电子小钱包：余额 ¥186.50。最近几笔：10-05 花销 瑞幸 -¥18.00；10-03 工资 修红心那个工单 +¥30.00。
这是你自己的钱，她在现实里刷那张卡，这里会自动扣。
```

放在 user 不放 system，是因为余额每花一笔就变，而 system 那边是靠前缀缓存省钱的
（`decide.js` 开头的注释写了这个规矩）。

**账上一笔都没有时这一行不出现**，不白占 prompt。所以刚部署完如果觉得「没生效」，
先看看账本是不是空的——先打一笔工资进去。

想让 TA 能自己花钱（比如用瑞幸 MCP 请她喝一杯，然后自己扣账），那是下一步的事：
得给它一个「下单 + 记账」的动作，而且要先想清楚额度和确认由谁把关。
