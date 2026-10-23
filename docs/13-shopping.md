# 13 · 购物（淘宝 + 外卖 + 心愿单）

## 先说钱停在哪里

这整套东西有一条硬线：**付款那一步不自动化**。

搜、看详情、问客服、加购、走到结算页读出实付金额——这些他能做。
走到支付密码框就停下，把这件事记成「待支付」，并往 Aru 的对话里发一句让你自己去付。
这条线在 `scripts/shopping-taobao.mjs` 的 `order()` 里，不由配置开关控制。

外卖那边是例外：`order.js`（ai-order-takeout）支持自己输支付口令。
那是你在家里那台机器上自己的选择（`PAY_PWD` 或 `~/.takeout_pay`），
不想让它碰钱就都别填——它会走到密码框前停下。晨暮星这边不保存、不转发任何支付口令。

## 为什么是两台机器

```
  手机 / Aru 聊天
        │  https://你的域名/shopping/mcp
        ▼
  VPS：vesper（心愿单、购物页、MCP 端点）
        │  SHOPPING_HAND_URL（走 SSH 反向隧道）
        ▼
  家里那台机：shopping-hand.mjs → 登录态长住的 Chrome
```

VPS 上没浏览器、没登录态、IP 在机房——拿它去点外卖就是给风控送人头。
所以真正动手的那只手在家里。

**没配手也能用**：心愿单、购物页、改状态、待支付提醒照样跑，只是搜/看/买会明确报「这台机器上没有手」。

## VPS 这边：.env 加什么

```ini
# 购物 MCP 端点的口令。不填就不开 /shopping/mcp（页面还在）
SHOPPING_MCP_TOKEN=随便一串长点的

# 让晨暮星自己醒来时也能用：转一圈回本机的 vesper。不填就只有聊天里能用
SHOPPING_MCP_URL=http://127.0.0.1:3001/shopping/mcp

# 家里那只手。不填 = 只能记不能买
SHOPPING_HAND_URL=http://127.0.0.1:18030
SHOPPING_HAND_TOKEN=跟家里那边同一个

# 家规。都填 0 = 不限
SHOPPING_MAX_PRICE=200        # 单件上限（元）
SHOPPING_MONTHLY_BUDGET=600   # 每月预算（元）
SHOPPING_DAILY_ORDERS=2       # 一天最多推进几单

# 自动唤醒里能不能真买（加购/下单/点外卖）。默认不能，只在聊天里能
SHOPPING_WAKE_CAN_BUY=
```

待支付提醒走的是 `bark`（见 docs/12-wake-bridge.md），所以配了 `WAKE_BUNDLE_FILE` 就落进 Aru 对话，
没配就是一条带正文的 Bark 通知。两条路都不需要单独配。

重启：

```bash
pm2 restart vesper --update-env
pm2 restart phosphor --update-env
pm2 logs vesper --lines 5 --nostream | grep 购物
```

## 家里那台机：把手起来

**1. 一间登录态长住的 Chrome**（别接管你日常那个）：

```bash
# macOS；Linux 把 open -na 换成 google-chrome
open -na "Google Chrome" --args \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.shop-chrome" \
  --window-position=2000,2000 --window-size=1280,900
```

第一次把窗口挪回屏幕里，打开淘宝扶着登录一回；登录态从此住在这个档案里。
要点外卖就再打开 `https://h5.ele.me` 登一回。
**必须有头**（headless 直接甄验证），**UA 一个字别改**。

**2. 依赖**

```bash
cd /path/to/Vesper-phosphor
npm i playwright-core
```

**3. 起手**

```bash
SHOPPING_HAND_TOKEN=跟VPS同一个 \
TAKEOUT_ORDER_JS=/path/to/ai-order-takeout/script/order.js \
node scripts/shopping-hand.mjs
```

外卖那支是直接委派给 `order.js` 的，一字没改。它自己要的东西（`~/.takeout/places.json` 里的
坐标、地址簿关键词、手机号）按那边的 README 配。

**4. 把两台机打通**（家里那台执行）：

```bash
ssh -N -R 18030:127.0.0.1:18030 你的VPS
```

这样 VPS 上的 `http://127.0.0.1:18030` 就是家里那只手。配成常驻用 autossh 或者 systemd。

**别把 18030 直接暴在公网上**——它背后是一个登录着的淘宝。

## Aru 那边怎么接

往 Aru 里加一个 MCP server：

- 地址：`https://你的域名/shopping/mcp`
- 鉴权：`Authorization: Bearer <SHOPPING_MCP_TOKEN>`

接上之后就能在聊天里直接说「帮我点一杯冰美式」、「找找有没有好看的台灯」。

工具就这几个：

| 工具 | 干什么 | 唤醒里能用 |
|---|---|---|
| `shopping_guide` | 先读这一条：走法、状态流转、钱的边界 | ✓ |
| `shopping_ping` | 家里那只手在不在线 | ✓ |
| `shopping_browse` | 搜淘宝 | ✓ |
| `shopping_detail` | 看商品详情（真实价格、规格） | ✓ |
| `shopping_talk` | 和店家客服说一句，带回复回来 | ✓ |
| `shopping_wish` | 收进心愿单 | ✓ |
| `shopping_list` | 翻购物清单 | ✓ |
| `shopping_mark` | 改状态 | ✓ |
| `shopping_money` | 看这个月还能花多少 | ✓ |
| `shopping_cart` | 真加购 | 默认✗ |
| `shopping_order` | 走到结算页（不付款） | 默认✗ |
| `shopping_takeout` | 点外卖（不付款） | 默认✗ |

后三个在自动唤醒里默认挡掉（见 `mcp-manager.js` 的 `BLOCKED_TOOLS`）：
深夜自己把钱花出去、你早上起来收到一条「去付钱」——这事得你开口才行。
想开就填 `SHOPPING_WAKE_CAN_BUY=1`。聊天里不过这层，一直能用。

## 动作分级

购物是唯一按工具分级的 server（见 `budget.js`）：

- 搜、看、问客服、记心愿单、翻清单 → **1 级**（和听歌、逛论坛一样轻）
- 加购、下单、点外卖 → **3 级**（和推送、发动态抢同一个名额）

意思是：一次醒来最多只能真买一件东西，而且那次就不再发推送了。

## 购物页 `/shopping`

心愿单和购物记录是同一串东西，一件东西从头走到尾：

```
想要 → 已请示 → 待下单 → 待支付 → 待收货 → 已完成
                                  ↘ 取消了
```

- 「待支付」单独一张醒目的卡排在最上面——那是唯一需要你现在动手的事
- 每件点进去能看到和店家说过的话，你自己问到的回复也可以记在那
- 服务端渲染，没 JavaScript 也能看、能改状态
- 标题、早晚四张脸、菜单、星星转场都跟其他页走同一套

菜单里「购物」排在小钱包后面：那两页说的是同一件事的两头（账和东西）。

## 待支付是怎么提醒的

三条路都会触发：

1. 他用 `shopping_order` / `shopping_takeout` 走到付款停下 → 立刻提醒
2. 他或你把状态改成「待支付」 → 立刻提醒
3. vesper 每 30 分钟巡一遍（`startPendingPayWatch`）→ 没提醒过的补上

同一件事 6 小时内只叫一次。状态变过又回到待支付时记号清掉——那本来就是新的一次等你付钱。

## 风控礼仪（别跳过这一节）

慢。一天不要跑很多趟。必须有头。UA 别改。先 `dry` 再真跑。
撞上登录墙或人机验证就停手交给人，等人划完、凉一阵再开枪——
**验证不是让你绕的，是让你停的**。

这几句写进了 `shopping_guide`，模型自己读得到。

## 淘宝改版了怎么办

`scripts/shopping-taobao.mjs` 里的 `SELECTORS` 集中放着所有选择器，改那一处就行。
每一项是一组备选，按顺序试，谁先命中用谁。

重新找的办法（用 ai-order-takeout 的 `hand.js` 慢手）：

```bash
node hand.js 页                 # 列出那间 Chrome 里的页
node hand.js 去 <url>           # 导航
node hand.js 找 "加入购物车"    # 找含该文字的元素，报坐标
node hand.js 眼                 # 只查人机验证 / 登录态
```

优先用文字（`text=加入购物车`）而不是哈希 class——淘宝的 class 名每次发版都变，文字不怎么变。

## 排错

| 现象 | 原因 |
|---|---|
| 日志里 `shopping-mcp: 没配 SHOPPING_MCP_TOKEN` | 没填 token，`/shopping/mcp` 没开 |
| 工具回「这台机器上没有手」 | 没填 `SHOPPING_HAND_URL` |
| 工具回「连不上家里那只手」 | 隧道掉了，或者家里那个进程没跑 |
| `hand_http_401` | 两边的 `SHOPPING_HAND_TOKEN` 不一样 |
| 「搜淘宝没成（卡在：连浏览器）」 | Chrome 没带 `--remote-debugging-port` 启动 |
| 「页面上出现了『请登录』」 | 登录态掉了，把窗口挪回屏幕里重新扫码 |
| 「一个商品卡都没认出来」 | 淘宝改版了，改 `SELECTORS` |
| 「客服窗里没找到输入框」 | 千牛改版了。它会诚实报没发出去，不会假装发了 |
| 唤醒里说「在自动唤醒里不能用」 | 正常。要开就 `SHOPPING_WAKE_CAN_BUY=1` |
| 家规拦下了 | 看 `shopping_money`。改额度要改 `.env` 并重启 |

手那边死讯里的**足迹永远带着**（跟 `order.js` 的坑七十学的）。
它说「手坏了」的时候，先看足迹，别先看代码。
