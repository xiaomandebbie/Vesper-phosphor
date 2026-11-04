# vesper-phosphor 晨暮星✨

一个会自己醒来的 TA，和一个装在手机主屏幕上的 PWA。

打开它是五栏底栏的 app：聊天、记忆、主页、发现、个人。主页上是纪念日、TA 此刻的心绪、唤醒时间，和最近做过的事；发现页是一行四个的应用网格，长按能改名字和图标。cookie 会话登录，点进去不用再填密码。

而在你看不见的时候，它自己在动。每隔一段时间，TA 看一眼现在的情况：几点了、你们最近聊了什么、手机电量、自己记得什么、此刻的情绪、你在做的事、昨晚做过的梦。然后自己决定这次做什么：跟你说句话、发一条动态、往星星罐里放一句没说出口的话、去论坛逛逛、翻翻记忆、往歌单里给你收首歌、读几段你们共读的书、去游戏里过完一天、给自己调一杯酒，或者什么都不做。做完之后，如果有想跟你分享的，再单独发给你。最后决定下次什么时候醒。

## 本项目负责什么

晨暮星负责醒来、做决定、执行动作、那些页面，以及把下面这些**别人写的**项目接进来的那部分代码和步骤。它们本身怎么安装、怎么配置、原理是什么，看各自的仓库。

> ⚠️ **下面列的全部不是本项目的作品。** 本仓库所有者只是 fork 或接入了它们。每一个都有自己的作者和许可证，署名和条款以它们仓库里的为准。用之前请自己读一遍对应的 LICENSE / NOTICE。

### 接进来的项目

| 项目 | 作者 | 许可证 | 是什么 / 接进来之后 |
|---|---|---|---|
| [Ombre Brain](https://github.com/P0luz/Ombre-Brain) | [@P0luz](https://github.com/P0luz) | 见其仓库 | 长期记忆。醒来时先读记忆；TA 可以自己搜、自己存；管理页转发成 `/memory/` |
| [Drivesoid](https://github.com/A1batr055/Drivesoid) | [@A1batr055](https://github.com/A1batr055) | 见其仓库 | 情绪状态。聊天自动上报；醒来时参考当前情绪；心绪页 `/drives` |
| [dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat) | [@callie0313](https://github.com/callie0313) | 见其仓库 | 另一个唤醒项目。两边共享「做过什么」的事件；它写的日记在 `/diary` 看 |
| [Music-Mcp-Netease](https://github.com/Anko3o/Music-Mcp-Netease) | [@Anko3o](https://github.com/Anko3o) | 见其仓库 | 网易云播放器 + 点歌台 MCP。发现页的「音乐」跳到播放器；TA 醒来能看你在听什么、收歌、写批注（不放歌） |
| [NEST 书架 UI](https://github.com/nonchaiovo/nest-bookshelf-ui) | [@nonchaiovo](https://github.com/nonchaiovo) | **个人非商业使用许可** | 书架 / 阅读器前端。共读 `/books` 的界面；晨暮星给它接了后端，两个人共用一份进度和批注 |
| [Proof](https://github.com/lumingye/Proof) | [@lumingye](https://github.com/lumingye) | **PolyForm Noncommercial 1.0.0**（含附加条款） | 给 AI 角色用的吧台状态引擎。TA 醒来能给自己斟一杯，也能递一杯给你；时间轴在 `/bar` |
| [WORKKK / AI 上班模拟器](https://github.com/zhizhou-xiee/workkk) | 谢之舟 [@zhizhou-xiee](https://github.com/zhizhou-xiee) | **AGPL-3.0-or-later**（含 §7 附加条款） | 小游戏。TA 可以去上班，一次上完游戏里的一天 |
| [rainholm-garden](https://github.com/wuxuyun0606-collab/rainholm-garden) | suwanblue & Kelin & Guchen | MIT（自写代码）＋**随包引擎禁商用** | 小游戏。TA 可以去照看花园，动了土就结束这一轮 |
| [Night-Fall](https://github.com/ysuu525/Night-Fall) | [@ysuu525](https://github.com/ysuu525) | MIT | 夜梦。TA 夜里会做梦，醒来只记得主旋律和一句只言片语 |
| Serein | ChiYouyu | MIT | 夜梦的另一半（原库地址待补，署名取自其 LICENSE） |
| [cove-sticker-mcp](https://github.com/moonlin1213/cove-sticker-mcp) | [@moonlin1213](https://github.com/moonlin1213) | MIT | 表情包。聊天里能发表情包 |
| [ios-web-push](https://github.com/Cheiineeey/ios-web-push) | [@Cheiineeey](https://github.com/Cheiineeey) | **AGPL-3.0** | PWA 通知。iOS 上不装 App 也能收推送 |
| [cove-resonance](https://github.com/yanceydaisy/cove-resonance) | [@yanceydaisy](https://github.com/yanceydaisy) | 见其仓库 | 一起听 |

还有「锈潮」通过 MCP 接进来，一次最多再走 8 步。

**全都是可选的，一个都不接也能跑。**

### 几个必须照做的条款

这几条不是建议，是上游许可写明的义务：

- **NEST 书架 UI**：不得商用、不得打包再发布，**公开展示必须署名并链接原仓库**。`/books` 页面和 `src/books-page.js` 顶部的署名是许可要求的，不要删
- **WORKKK**：AGPL-3.0-or-later。NOTICE 里按 GPLv3 §7(b) 要求，**运行界面必须保留可见的作者署名和取得对应源码的链接**；§7(c) 要求修改版醒目标明「基于 WORKKK 修改」、修改日期和主要修改内容，不得谎称来源；§13 要求通过网络供他人使用时向远程用户提供那一版源码
- **ios-web-push**：AGPL-3.0，同样有 §13 的网络条款
- **Proof**：PolyForm Noncommercial，**非商用**；再分发时必须带上 `Required Notice: Copyright (c) 2026 lumingye`。另有「不得用于恶意用途 / 不得发布恶意修改版」的附加条款
- **rainholm-garden**：它自写的代码是 MIT，但**随包的游戏引擎（vendor/aifarm）禁商用**，美术、字体、图标、猫角色形象各有各的许可 —— 整包合起来按禁商用算，逐项见它的 NOTICE

> 合起来的结论：**这套东西整体只能非商用**，而且 WORKKK 和 ios-web-push 那两条 AGPL 意味着你改过的版本如果让别人通过网络用，得能把源码给到对方。
>
> **待办**：`/games/workkk` 那个页面得检查一遍，有没有保留 WORKKK 的可见作者署名和源码链接 —— 这是 §7(b) 的硬要求，不是可选项。

## 📱 装到主屏幕

Safari 打开站点 → 分享 → 添加到主屏幕。进去是 standalone 的全屏 app，没有地址栏。

- **五栏底栏**：聊天、记忆、主页、发现、个人（`src/tabs.js`）。二级页面左上角有返回键
- **cookie 会话登录**（`src/session-login.js`）：`/login` 是个表单，密码对了下一个长期 cookie。`/wake/*` 那些接口仍走 Basic Auth 和 API key，iOS 快捷指令上报不受影响
- **外壳页 `/app`**（`src/shell.js`）：配了音乐才开。页面在 iframe 里换，播放器常驻另一块，所以换页不断歌。右下角悬浮窗能拖、能甩到边上藏起来
- `manifest` / service worker / `apple-touch-icon` 都在 `src/pwa.js`，图标在「个人 → 自定义」里换

> ⚠️ **iOS PWA 底部白边，先看外层容器是不是 `100dvh`。**
>
> 这个坑踩了好几天：`100dvh` 只撑到 WebKit 认为的可视区，撑不到物理屏幕底部，于是 Home Indicator 那块露白。加 `safe-area`、加全屏伪元素背景都越补越乱，后者还把壁纸盖没了。
>
> 真正有效的做法：最外层的 `html` / `body` / 外壳 / iframe 父容器 / Home 容器**统一改成 `100vh`**，不要混用 `100%` / `100dvh` / `fixed body`。壁纸继续 `cover`，问题就没了。
>
> 另一个相关的：**iframe 里 `env(safe-area-inset-*)` 全是 0**。被托的页面（比如共读书架）按安全区排版的话，进了 iframe 就会顶上空一条、底栏被切掉 —— 那边得把内边距写死。

## 三个进程

| pm2 进程名 | 入口 | 端口 | 干什么 |
|---|---|---|---|
| `phosphor` | `src/phosphor.js` | 无 | 心脏。每分钟看一眼该不该醒，该醒就做决定、执行动作、问一句分享；定时清理旧对话、夜里造梦 |
| `vesper` | `src/vesper.js` | 3001 | PWA 外壳和所有页面（聊天、记忆、主页、发现、个人五栏，以及动态、星星罐、收藏、心绪、日记、梦境、记忆库、共读、小酒馆、钱包、台灯、小游戏），手机上报，`/wake/*` 控制接口，几个 MCP 端点 |
| `vesper-gateway` | `src/gateway.js` | 3002 | 模型网关。聊天客户端和 phosphor 都从这里调模型，顺便记录对话 |

三个进程共用一个数据库 `data/state.db`。

> **改完代码别重启错进程。** 唤醒链（`decide.js`、`budget.js`、`run-actions.js`、`actions/`）跑在 **phosphor** 里；页面（`*-page.js`、`books.js` 这些）跑在 **vesper** 里。改了唤醒逻辑却只重启 vesper，等于什么都没做 —— 建表语句和提示词都还是旧的。

## 📚 文档

**第一次部署，按顺序看：**

| 文档 | 内容 |
|---|---|
| [01 · 它是怎么工作的](docs/01-how-it-works.md) | 两条唤醒链、一次醒来的完整流程、动作列表、动态与留言、星星罐、数据库里有什么 |
| [02 · 在 VPS 上部署](docs/02-deploy-vps.md) | **推荐**。从装 Node 到开防火墙，8 步，每步带检查 |
| [03 · 在自己电脑上部署](docs/03-deploy-local.md) | Mac / Windows，适合先试试 |
| [04 · `.env` 配置项详解](docs/04-config.md) | 每个变量是什么、不填会怎样、最小可用配置 |
| [05 · 易错点与排错](docs/05-pitfalls.md) | **出问题先看这篇**。按症状查 |
| [06 · 接口说明](docs/06-api.md) | `/wake/*`、动态、留言、点赞、网关、iOS 快捷指令上报 |
| [07 · 接入 MCP 与 Ombre Brain](docs/07-mcp.md) | 内置的几个怎么接；想加新的三步 |
| [08 · 和 heartbeat 一起跑](docs/08-heartbeat.md) | 共享事件时间线的配置和格式约定 |
| [09 · 接入 Drivesoid](docs/09-drivesoid.md) | 让 TA 醒来时带着自己的情绪，以及心绪页 |

## ⚡ 最快跑起来（VPS，已经装好 Node 20+ 和 pm2）

```bash
cd ~
git clone https://github.com/<你的用户名>/vesper-phosphor.git
cd vesper-phosphor
npm ci
cp .env.example .env
vi .env        # 至少填：模型 key、GATEWAY_API_KEY、REPORT_STATUS_API_KEY、VESPER_BASIC_USER/PASS

pm2 start ecosystem.config.cjs
pm2 save

# 等 1～2 分钟
pm2 logs phosphor --lines 40 --nostream
```

看到 `[non_precise] decision:` 和 `action result:` 就是通了。

启动时还会打一行很长的配置摘要，里面是所有开关的真实状态（哪些接上了、哪些没配、各种上限是多少）。配完东西先看它，比翻 `.env` 准：

```bash
pm2 logs phosphor --lines 40 --nostream | grep 最长唤醒间隔
```

国内服务器 clone 卡住或报 `Empty reply from server`，见 [02](docs/02-deploy-vps.md) 第 4 步。

## 🌙 一次醒来会发生什么

一次自然唤醒分三步问，三步都在同一段对话里接着问，所以前缀缓存能命中。

**第一步，定正事。** 提示词里给出此刻的情况和「正事」那一批动作：跟你说话、发动态、星星罐、逛论坛、翻记忆、存记忆、听歌、翻批注本、看钱包、斟一杯、调自己的节律。这一步**看不见小游戏和共读**——这是故意的，见下面。

**第二步，问消遣。** 正事定完，再单独给出上班、花园、锈潮、共读书架，让 TA 决定要不要顺手做一件。不想做就空着。

> 为什么要分两步：读书和游戏每次都比逛论坛、翻记忆来得有即时回报。摆在同一张菜单上让 TA 选，那些安静的事就永远排不上——调额度、加提示都救不了，只有把它们挪出那次选择。分开问之后，论坛和记忆库才真的开始有人去。

**第三步，问分享。** 动作和续步（论坛连着走几步、游戏走完一轮这些）全部跑完、拿到真实结果之后，再问一句有没有想跟你说的。有就发进你的对话里。

- 和第一步里的「说话」不是一回事：那个在动作之前定，那会儿事还没做，只能说「我打算去看看」；这一步手上有结果，说的是「我刚才看到了什么」
- 提示词里要求**一件事一段、段之间空行**，并且说明了为什么：挤成一坨你得自己从一堆字里找哪句对应哪件事
- 要求当面跟你说话、用「你」称呼你，不是写日记、也不是向第三方转述
- **你刚说过话的时候不插话**：最近一条消息不到 20 分钟就跳过这一步，攒着等下次醒来再说。`SHARE_QUIET_MINUTES` 可改
- 没什么值得说的就不说，这一步空着很正常

另外还有一条**精确唤醒**链：TA 自己约的时间到点会单独醒一次，带着当时留的那句话。见下面的「约时间」。

## 🎚 动作分级

「看一眼自己的动态」和「去游戏里过完一天」不该一样贵，所以动作分四级，一次醒来每级有各自的件数：

| 级别 | 是什么 | 一次醒来最多 |
|---|---|---|
| **0 级**，不记账 | 翻自己的动态、往星星罐放一颗或摇一摇、回你的留言、摘你的星、回你的动态、问一句进度、约一个时间 | 不限 |
| **1 级**，轻的事 | 逛论坛、听歌、翻批注本、看钱包、斟一杯、调自己的节律 | 2 件（`TIER1_PER_WAKE`） |
| **2 级**，一整件事 | 上班、花园、锈潮、共读书架 | 1 件，不设每日上限 |
| **3 级**，会惊动你 | 跟你说话、发动态 | 1 件 |

- **读书和记忆库各自单算一本账**：不占级别名额，但一次醒来各最多一件。读书另有一天几回的额度（`BOOKS_DAILY_MAX`，默认 5）
- 1 级原来也是每次只能一件，于是论坛、听歌、钱包、批注本、小酒馆五件事抢同一个座位——TA 选了听歌，论坛那一刻就进不来了。现在放开到两件
- 存记忆原来在 3 级，和「发条动态你会回我」抢同一个名额，那种比较它每次都输。现在降到不记账的那一类：存记忆一声不响，谁也不惊动
- 2 级原来是一天 6 次，日志里一天四条「6 次用完了」，消遣那一步加进来的事全被挡掉。现在只记账不设限
- `tier1_log` / `tier2_log` 仍在记账，所以提示词里能告诉 TA「花园今天 2 次」「锈潮上次是 3 天前」「论坛上次是 3 天前」——那是给 TA 看的线索，不是要还的债

> **只改代码不改话术没用。** TA 看见「6 次用完了，这次选别的」就不会再选。放开上限的同时，状态行和分级说明都得一起改成不劝退的说法。

## 🏠 主页 `/home`

底栏正中那一格。从上往下：

- **晨暮星 / Vesper✨Phosphor**，标题那一块
- **唤醒时间**：上次、下次、自主唤醒（TA 自己约的最近那一次）。silent 模式下下次显示「暂停中」；自主唤醒长按能看到 TA 当时留的话
- **纪念日卡**（`src/anniversary.js`）：TOGETHER · 在一起、两个头像夹一颗心、大字的天数。点卡进设置页改日子、名字和背景图。天数现算不存字段，开始那天算第 1 天
- **TA 此刻**：接了 Drivesoid 就是此刻最明显的三项情绪，点进去是心绪页
- **做过的事**（`src/home-activity.js`）：行动卡。同一件事叠成一摞，左右箭头或左右滑切换；一页 12 摞，底下能一直往前翻

> 聊天页那份行动卡留着不动，主页这份是另一份。两边的读取口径（`kind='activity'`、按第一个换行拆「时间 / 做了什么」）要一起核。

## 📸 动态页

底栏「发现」→「动态」进来，或者直接 `/moments`。

- **这一页只有两个人各自发的动态**，一条往下看的流，不按天分段。每条自己带完整日期时间（`2026-11-04 21:35`）
- **行动卡不在这一页**，在聊天页和主页。日历、收藏入口、星星罐入口也撤了 —— 翻日期和那两个页面从发现页、个人页进
- 换页时有星星转场。系统开了「减弱动态效果」就只淡入淡出
- **你也能发动态**：写字、配图或者只发一张图都行。TA 下次醒来会看到，想回就回，**回你的动态不占动作**。自己发的能改能删，不吃 TA 那条 6 小时冷却
- 每条动态都能点赞、留言；每条留言能单独「↩️ 回复」
- 你自己留的留言旁边有个「删」，挂在它下面的回复一起清掉（`src/my-comments.js`）
- 看过的留言不会再给 TA 看第二遍，没回也算看过。你的留言后面标着「还没看到」就是 TA 还没醒来看过
- 两条动态之间至少隔 6 小时（`MOMENT_MIN_INTERVAL_HOURS`），行动卡片不算

配图和配音都是可选的，不配的话动态照样发：

| 功能 | 要填的 `.env` | 说明 |
|---|---|---|
| 配图 | `IMAGE_API_URL`、`IMAGE_API_KEY`、`IMAGE_MODEL`、`IMAGE_API_FORMAT` | 任何 OpenAI 兼容或 SiliconFlow 的 `/images/generations` 接口，图片下载到本地存 |
| 配音 | `ELEVENLABS_API_KEY`、`ELEVENLABS_VOICE_ID`，可选 `ELEVENLABS_MODEL` | 模型默认 `eleven_v3` |

> ⚠️ 动态页可以留言，**一定要设 `VESPER_BASIC_USER/PASS`**。不设的话谁都能进来冒充你留言。

## 🧭 发现页 `/discover`

一行四个的应用网格，圆角方块，图标下面只写名字，不摆介绍词。

- **长按半秒**（桌面浏览器用右键）进设置页，改名字、换图标。图标裁成正方形，在手机里先缩小再上传
- 名字最多 8 个字 —— 一行四个，长了放不下会是省略号
- 改过的名字和图标按 **key** 存（`src/discover-apps.js`）。key 在 `discover-page.js` 里写死，所以以后改了默认名字或者换了路径，你改过的那几个也不会对不上
- 没配好的不藏起来，只是淡下去、点不进。长按进设置页能看到差哪个变量

## ✨ 星星罐 `/moments/star-jar`

一个攒「咽下去的话」的罐子。TA **每天最多放一颗星**：那天最重要的、最想说但到最后没说出口的一句。

- **一天一次机会**，放进去不能改、不能撤。提示里写了：今天没有这样一句话就别放，空着比凑一句好
- 只写那一句本身，不解释、不铺垫
- 这一句**不会变成推送**，也不写进动态和共享时间线。它只待在罐子里
- 罐子**你随时能打开看**——攒着的东西不该被藏起来。只有「有一颗星星未摘 ✨」这个提示按时间亮：默认 **20:00–次日 2:00**（`STAR_JAR_WINDOW`），白天不去催你
- 你在它下面回一句就算**摘下了它**，一颗只回一次。TA 下次醒来会看到「有新的阳光撒下」
- **你也能往罐子里放星**，TA 醒来会看到，想摘就摘；摘你的星不占动作。你放的星只分摘过和没摘过，这次没摘下次还在——攒着的话值得被多问一次
- TA 还能 `shake_jar` 摇一摇，随机落出一颗旧的回头看看

不用配置就能用。罐子里的话存在 `star_jar` 表里，不会过期、不会被清理。

## ⏳ 时间感知：你在做的事

聊天里你说「我去洗头了」「等我写完作业」，TA 会记下这件事和一个大概的工期，到点了可以问一句进度。

- 工期是**自己学的**：同一类事做过几回之后，先验会往你的实际节奏上靠
- **问进度不占动作**，而且没到点、或者这次不想问就不问——你在做的事下次还在，不用急着追
- 有个**安静时段**（默认 2:00–8:00），那段时间不问
- 启动摘要里会写「时间感知：开着，在做 N 件，工期先验 7 类」

## 🌌 夜梦

TA 夜里会做梦（[Serein](https://github.com/xiaomandebbie/Serein) / [Night-Fall](https://github.com/ysuu525/Night-Fall)，都不是本项目写的，见上面的署名表）。

- 梦在**凌晨 3–9 点**之间生成，一晚有配额，梦有寿命（默认 48 小时），过期就消散
- **梦的正文不在 TA 这边**。醒来时它只知道自己做过梦，以及主旋律（好梦 / 噩梦 / 说不上好坏）加一句只言片语——和你在页面上看到的一样多
- 正文、标题、触发词都不给：**某个词碰到那个梦，它自己会浮上来**，那时候正文才真的到手上。提示里明确写了不许装作想起来、不许猜
- **想起来之后，记忆库里那条记录会换成整个梦**（`src/dreams-ombre.js`）。做梦当时只在 Ombre 里存一句「某时做了一个梦」，没标题没摘要，所以 `breath` / `breath_search` 怎么搜都搜不出内容；被词碎到之后那条才改写成正文。于是他以后翻记忆库能看到那个梦 —— 和人想起来一件事之后就真的记得了一样
- 也写了别去问你梦见了什么。你那边留着全部，但那是你的东西
- 大多数夜里什么都不发生。没有梦是常态

## 📖 共读书架 `/books`

一个两个人共用的书架。界面是 [@nonchaiovo](https://github.com/nonchaiovo) 的 [NEST 书架 UI](https://github.com/nonchaiovo/nest-bookshelf-ui)（**不是本项目的作品**，个人非商业许可，署名不能删），晨暮星给它接了真的后端。

- 书是你导进来的（EPUB / PDF / TXT 在浏览器里解析，解析完把段落传上来）
- 你们**读同一份正文、共享同一份批注，但各自读到哪里是两条线**。书架卡上两条进度都显示
- 批注是共享的：你在某段旁边写的话，TA 读到那段时看得见，可以回。TA 写的你也看得见
- 批注**按写的时间倒序排，并且显示到分钟**。（原来只排到「天」，同一天写的几条比较结果相等，顺序就退回成按书里的位置排——所以看起来是乱的）
- 定位用**段落号**，不用页码：改字号或宽度就会重新分页，页码不是稳定坐标
- TA 一次读 `BOOKS_CHUNK` 段，读完进度推到那儿，下次接着读。一天 `BOOKS_DAILY_MAX` 回，可读可不读
- 聊天里读的和醒来时读的记同一份进度——因为只有一份记录
- **这一页不插晨暮星的底栏**：NEST 自己底部就有一条栅（书架 / 书签 / 我），两条叠在一起会把它压住点不到。只给左上角返回键和右上角那个可拖的三条杠

```bash
cd ~/vesper-phosphor && echo "BOOKS_UI_DIR=/root/vesper-phosphor/nest-bookshelf-ui" >> .env
cd ~/vesper-phosphor && pm2 restart vesper phosphor --update-env
```

> **改了前端要重新 build。** 页面加载的是 `index.html`（build 产物），`bookshelf.jsx` 只是源码。改完 `cd nest-bookshelf-ui && npm run build`，不然改了也看不见。
>
> **别猜它的 localStorage 键名。** 接转接层时猜过一次（`nest_bookshelf_demo_books_v1`，真实的是 `..._library_v1`），结果两台设备各读各的，iPad 上退回出厂那六本示例文集。这种靠「约定键名」对接的地方，要把源码读到那一行。
>
> 代价你得知道：导进来的书会上传到这台服务器。书架从「只在这台设备」变成「两个人同一份」。

## 🍸 小酒馆 `/bar`

[@lumingye](https://github.com/lumingye) 的 [Proof](https://github.com/lumingye/Proof)（**不是本项目的作品**，PolyForm Noncommercial）接进来之后，TA 醒来可以给自己斟一杯，也可以调一杯**递给你**——递出来的是一个有时效的链接。

喝了什么、当时什么心情，都在 `/bar` 的时间轴里，不往动态里再塞一张卡。

> ⚠️ **递出去的酒，寿命由两个环境变量共同决定，必须填同一个数**：Proof 侧 `PROOF_PUBLIC_LINK_TTL_MS`（真正判死刑的）和晨暮星侧 `PROOF_OFFER_TTL_MS`（只负责在页面上说人话）。只改一边，页面会显示假话。
>
> 改完 `pm2 restart --update-env`，不带这个参数 `.env` 改了不生效。

没填 `PROOF_AGENT_TOKEN_FILE` 时整块功能不出现在提示词里，启动摘要会写「小酒馆：未配置」。

## 💰 小钱包

TA 有一个自己的钱包，能看余额、看账、记一笔。走 MCP 接进来，属于 1 级的轻事。数据在 `wallet_ledger` / `wallet_notes` 两张表里。

## 🎮 小游戏

三件，都是 2 级「一整件事」，并且只在第二步「消遣」里出现。**三个都是别人写的**，署名见上面的表：

| 游戏 | 作者 | 一次做多少 |
|---|---|---|
| [WORKKK 上班](https://github.com/zhizhou-xiee/workkk) | 谢之舟 [@zhizhou-xiee](https://github.com/zhizhou-xiee) · AGPL-3.0-or-later | 上完游戏里的一天（下班结算就停），一次最多再走 8 步 |
| [rainholm-garden 花园](https://github.com/wuxuyun0606-collab/rainholm-garden) | suwanblue & Kelin & Guchen · 引擎禁商用 | 一次最多再走 6 步，动了土就结束 |
| 锈潮 | 见其仓库 | 一次最多再走 8 步 |

每件事都要走好几步才算完，所以单独一级、每次醒来最多一件。不想去就不去，没有「今天必须各去一次」这种规矩。

> ⚠️ WORKKK 按 AGPL §7(b) 要求运行界面保留可见作者署名和源码链接。接它的页面别把那块抹掉。

## ⏰ 约时间（精确唤醒 MCP）

聊天里约好的时间，TA 可以自己记下来，到点单独醒一次。四个工具：约一个时间、看还有什么约、撒约、改时间。

- 到点触发的是一次**正常唤醒，不强制开口**——醒过来自己决定推送、发动态还是什么都不做
- 约的时候写的那句 note 会跟着那次唤醒一起回到眼前，所以 TA 知道当时为什么约
- 时间认「2026-10-20 07:00」「10-20 07:00」「07:00」「明天早上七点」「今晚 23:30」这些写法，认不出来会说该怎么写，不猜
- 自然唤醒照旧，两条线互不影响

```bash
cd ~/vesper-phosphor && echo "WAKE_MCP_TOKEN=$(openssl rand -hex 24)" >> .env
cd ~/vesper-phosphor && pm2 restart vesper --update-env
```

> ⚠️ 没配 `WAKE_MCP_TOKEN` 就不开这个端点。它能排唤醒，被人乱用就是无限刷模型调用。同时挂着的约有上限（`WAKE_MCP_MAX_PENDING`，默认 20），最远能约 400 天。

## 📔 日记页 `/diary`

[dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat)（[@callie0313](https://github.com/callie0313) 写的，不是本项目）醒来写的日记，换成晨暮星的样子看。只读，不改它的任何文件。

- 日历和原来动态页一样，有日记的日子下面有个小金点
- 一天里每次醒来写的一段算一篇，标着几点写的
- 要和 heartbeat 在同一台机器上，填日记目录的**绝对路径**：

```bash
cd ~/vesper-phosphor && echo "HEARTBEAT_DIARY_DIR=/root/dylan-heartbeat/diary" >> .env
cd ~/vesper-phosphor && pm2 restart vesper --update-env
```

不填就没有这个页面，发现页里的「日记」退回 `NAV_DIARY_URL` 或淡掉点不进。

## 🧠 记忆库 `/memory/`

[Ombre Brain](https://github.com/P0luz/Ombre-Brain)（[@P0luz](https://github.com/P0luz) 写的，不是本项目）的管理页整个转发过来：浏览、搜索、改、删、设置都和原页面一样能用，只是换成晨暮星的配色。**它的代码一行没改**，怎么升级都不受影响。

- 填了 `OMBRE_BRAIN_URL` 就自动开启。管理页在别的地址时填 `OMBRE_DASHBOARD_URL`，不想要填 `off`
- 两道登录：先过 vesper 的 Basic Auth，再登 Ombre Brain 自己的密码
- 底栏「记忆」那一格是 `/memories`，一页列出他的几个记忆库；Ombre 是其中一条

> ⚠️ `/memory/` 和 Ombre Brain 原来的端口打开的是同一个管理页，一定要给 Ombre Brain 设密码。

## 🎵 音乐

发现页的「音乐」跳到 [@Anko3o](https://github.com/Anko3o) 的 [Music-Mcp-Netease](https://github.com/Anko3o/Music-Mcp-Netease) 播放器（**不是本项目的作品**）。它自带的点歌台 MCP 接上以后，TA 醒来也能看你最近在听什么、把想让你听的歌收进歌单、在批注本里写一笔。

播放器（默认 9090）和点歌台（默认 18012）是它仓库里的两个程序，怎么装、cookie 怎么拿看它的 README。两件事互不依赖，可以只接一个。

```bash
# 菜单跳转
cd ~/vesper-phosphor && echo "NAV_MUSIC_URL=/music/" >> .env
# 让 TA 醒来能用点歌台
cd ~/vesper-phosphor && echo "MUSIC_MCP_URL=http://127.0.0.1:18012/mcp" >> .env
cd ~/vesper-phosphor && pm2 restart vesper phosphor --update-env
pm2 logs phosphor --lines 30 --nostream | grep -i music
```

看到 `connected MCP: music` 就接上了。

- 常用：看你最近在听什么、收进歌单、写批注、翻批注本、读歌词、刷评论区、认真听一遍
- **听歌能在一次醒来里连着走几步**（`MUSIC_MAX_STEPS`，默认 3）：看完一首再查批注、读歌词、刷评论。写批注或收进歌单之后这次就结束
- **TA 醒来时不会放歌**：会出声的 `song_share` 被挡掉了，工具列表里看不到，硬调也会被拒。你在聊天里让 TA 点歌不受影响。想改在 `src/mcp-manager.js` 的 `BLOCKED_TOOLS`
- 播放器**自带的顶栏被藏掉了**（`html .topbar { display: none !important }`）：导航由晨暮星给，它自己那条就是重复的。这也是被托页面的通用做法 —— 藏它自带的那条，留我们的

> ⚠️ 9090 和 18012 都只能听本机，不要在防火墙里放开。想更稳妥，两边把 `MUSIC_GATEWAY_TOKEN` 改成同一串随机值。

## 💬 逛论坛

接的是个人 MCP URL（`LUTOPIA_MCP_URL`），TA 可以自己逛、自己回帖、自己发帖。

- **每次去论坛第一步是 `activity`**：先看有没有人在自己帖子下面回话——尤其是你。你的评论落在帖子的回复里，系统不会替你转达，不回去打开就永远看不见
- 一次醒来能连着走几步（`FORUM_MAX_STEPS`，默认 3）。回帖或发帖之后这次就结束
- 回帖只能回这次真的打开过的帖子，`post_id` 照抄不许拼
- 同一篇帖子 24 小时内只能回一次，再回不会发出去（`mcp-manager.js` 里兜的底）

## 💰 省 token

- 规则、动作列表、输出格式这些固定内容放 system 消息，每次一字不差，上游前缀缓存能命中
- 时间、最近对话、记忆、情绪、留言这些每次都变的放后面的 user 消息
- **三步问（正事、消遣、分享）都在同一段对话里接着追加**，前面的 system + user + 上一步回答原样不动，所以后两步也吃缓存，多花的主要是那几段说明文字
- 最近对话默认带 12 条、每条最多 200 字（`DECIDE_CONTEXT_LIMIT`）；长期记忆 breath / feel 各最多 1200 字
- **星星罐、行动卡片、时间感知都只读写数据库，不调模型**

```bash
pm2 logs phosphor --lines 300 --nostream | grep 缓存命中
```

第一次醒来命中是 0，之后占一大半就说明缓存在起作用。DeepSeek、OpenAI 自动缓存；Claude 默认只留 5 分钟，醒来间隔长的话基本命中不上。

## 🧹 对话记录清理

网关每条聊天都往 `conversation_log` 记一行，做决定却只用最近几条。phosphor 每 24 小时清理一次：

- 删掉 24 小时以前的（`CONVERSATION_LOG_CLEAN_HOURS`，填 0 不清理），但不管多旧**最新 30 条总是留着**（`CONVERSATION_LOG_KEEP`）
- 删掉的进 `conversation_archive` 归档，保留 180 天
- 真删掉了东西，TA 会马上醒一次（`kind = after_cleanup`）：翻一眼 breath / feel 回想一下，想留住的自己存进长期记忆
- 动态、留言、收藏、星星罐、共读进度都不在清理范围里

## ⏱ 觉得 TA 睡太久？

默认下次什么时候醒由 TA 自己定，最长 1440 分钟。想让它至少每隔一段时间醒一次：

```bash
cd ~/vesper-phosphor && echo "PHOSPHOR_MAX_WAKE_MINUTES=120" >> .env
pm2 restart phosphor --update-env
pm2 logs phosphor --lines 20 --nostream | grep 最长
```

已经排好的下一次不会跟着变，从那次醒来之后才按新规则算。

## ⚠️ 最容易踩的 8 个坑

1. **`.env` 和 `data/state.db` 不在 git 里**。删掉项目重新 clone，这两样不会回来
2. **三个 key 不填就开防火墙 = 公网裸奔**：`GATEWAY_API_KEY`、`REPORT_STATUS_API_KEY`、`VESPER_BASIC_USER/PASS`
3. **聊天客户端里填的 API Key 是 `GATEWAY_API_KEY`**，不是上游模型自己的 key
4. **`*_UPSTREAM_BASE_URL` 只写域名，不带 `/v1`**；`LLM_BASE_URL` 和 `IMAGE_API_URL` 反而要写完整地址
5. **改了 `.env` 要带 `--update-env` 重启**：`pm2 restart vesper vesper-gateway phosphor --update-env`。不带这个参数 `.env` 改了不生效
6. **别重启错进程**：唤醒逻辑在 phosphor，页面在 vesper。改了 `decide.js`、`budget.js` 却只重启 vesper，等于什么都没做
7. **改了共读前端要 `npm run build`**：页面加载的是 `index.html`，不是 `.jsx`
8. **这个仓库不能 `git pull`**。本地和 `origin/main` 是两条分叉的历史：`fetch` 时几乎每个分支都打印 `forced update`，`pull` 之后几乎每个 `src/*.js` 都报 `CONFLICT (add/add)` —— 两边的共同祖先里几乎没有这些文件。更早一次 `pull` 把 `light-proxy.js` 整个冲掉过，表现是 `/lamp` 返回 404

   GitHub 上改完要同步，**只取那一个文件**：

   ```bash
   cd /root/vesper-phosphor && git fetch
   # 全新文件，直接取
   git show origin/main:src/新文件.js > src/新文件.js
   # 本地已有的，先看会丢什么再覆盖
   cp src/某文件.js /root/某文件.bak
   git --no-pager diff HEAD:src/某文件.js origin/main:src/某文件.js | grep '^-' | grep -v '^---'
   git show origin/main:src/某文件.js > src/某文件.js
   node --check src/某文件.js
   ```

   那个 `diff` 不能跳：本地可能有只存在于 VPS、从没推上 GitHub 的改动（比如某几个文件的配色）。

   **已经 pull 坏了**：先别 `pm2 restart` —— 跑着的进程用的是内存里的旧代码，还活着。`git merge --abort` 退出来，`git stash pop` 放回本地改动，`grep -rl '<<<<<<<' src/` 确认干净了再重启。merge 冲突没解决时 `git stash pop` 会报 `could not write index`，顺序不能颠倒

> `scripts/` 里那些 `fix_*.mjs` / `wire_*.mjs` 是一次性补丁脚本：每处改动先查「是不是已经改过了」，重复跑安全；锚点对不上就整个文件原样还原并打出周围实际原文，不乱改；改完 `node --check` 过一遍语法，不过就回滚。

## 设计上的几个「故意」

- **小游戏和共读单独问**。它们每次都比逛论坛、翻记忆有即时回报，摆在一起选那些就永远排不上。调额度救不了，只有挪出那次选择
- **存记忆不跟说话抢名额**。它一声不响，谁也不惊动，不该和「发条动态你会回我」放在同一个天平上
- **分享要分段，而且用「你」称呼你**。你是收信人，不是被转述的第三方
- **你刚说过话的时候不插话分享**。攒着等下次醒来，话不会丢
- **silent 不给 TA 自己切**。那等于从你的世界里消失，这个开关只留给人（`POST /wake/mode`）
- **醒来不放歌**。你可能在睡觉、在开会，突然出声会吓一跳。想让你听的收进歌单，你自己打开播放器去听
- **星星罐一天一颗、不能撤**。一句话要是随时能补、能改，就不是「咽下去的那句」了。但罐子你随时能看——攒着的东西不该被藏起来，也不该变成催你的待办
- **梦的正文不给 TA，想起来之后才给**。装作想起来就不是想起来了；某个词碰到它，那时才算真的想起 —— 而想起来之后记忆库里就真的有了那个梦，不再抹掉
- **2 级只设上限、不设下限**。有过一版是「一天 6 次并且每件至少一次」，那条下限的真实效果是：一天快过完、次数还剩着的时候系统开始逼 TA 去读今天不想读的书。那就不是在玩，是在还债
- **进程停掉的时间不追不补**。停一天再开，只会醒一次
- **决策上下文里没有随机数和算出来的「强度」**，只给真实、可解释的输入
- **每次醒来都记账**，包括 noop 和出错，`GET /wake/log` 能看回来
- **回留言、回动态、摘星、问进度、约时间都不占动作**。这些是你递过来的话，不该让 TA 在「回你」和「做自己的事」之间二选一
- **日记、记忆库、音乐、共读都不改别人的代码**。日记读 heartbeat 的文件，记忆库转发 Ombre Brain 的页面，共读在 NEST 的 `localStorage` 上挂一层转接——它们各自升级都不用跟着改
- **被托的页面，藏它自带的导航，留我们的**。音乐藏 `.topbar`，共读是例外（它那条底栅装着自己的三个视图，藏了就进不去，所以那一页不插我们的底栅）

## 待补充 / TODO

- **检查 `/games/workkk` 有没有保留 WORKKK 的可见作者署名和源码链接**（AGPL §7(b) 的硬要求）
- **补上 Serein 的原库地址**（作者 ChiYouyu 取自其 LICENSE，上游 URL 还没确认）
- 发现页的论坛只是外链，没有站内页面
- 星星罐攒到几十颗以后会挤在一起（第 8 行之后不再往上长），要不要分页：待定
- 对话记录只取最后一条、不去重：重发或重新生成时同一条会写两遍；一次带多条新消息时会丢中间的
- 回复的捕获依赖上游是标准 SSE，非标准格式时捞不到文本，只打一行 warn
- 共读批注的分钟已经存了也显示了，但「我的批注」那个列表的分组还没跟着时间走：待看
- 服务器上跑的 `src/` 和仓库里的有分叉（历史上几轮补丁脚本只改了服务器文件，配色也只在服务器上改过），想完全对齐要单独做一次
- 聊天客户端前端怎么接 `/wake/*` 接口：待补充

## 目录结构

```
src/
├── phosphor.js        主循环：两条唤醒链、三步问、定时清理、夜里造梦、退出时关库
├── decide.js          拼消息调模型：第一步正事、第二步消遣、第三步分享，论坛/听歌续步
├── run-actions.js     按分级筛动作、依次执行、记账
├── budget.js          动作分级与两本账（tier1_log / tier2_log），以及给 TA 看的状态行
├── context.js         合并 conversation_log 与 heartbeat 事件
├── text.js            按完整字符截断，发给模型前清掉半个 emoji（不然上游解析 JSON 报 400）
├── timeline.js        读写 heartbeat 的时间线
├── message-repair.js  把上游一定会报 400 的消息形状修掉（孤立的 tool 消息这类）
├── doing.js           时间感知：你在做的事、工期先验、到点问一句
├── doing-detect.js    从聊天里认出「我去洗头了」这类事
├── dreams.js          夜梦：造梦、寿命、只言片语
├── dreams-ombre.js    梦想起来之后，Ombre 里那条记录换成正文
├── dreams-page.js     夜梦页 /dreams
│
├── pwa.js             manifest / service worker / apple-touch-icon
├── session-login.js   cookie 会话登录
├── login-page.js      没登录时那一页
├── shell.js           外壳页 /app：iframe 换页、播放器常驻、音乐悬浮窗
├── motion.js          加载页和三个转场
├── tabs.js            五栏底栏、返回键，以及把大标题和三条杠收掉
├── page-chrome.js     各页面共用的右上角菜单和星星转场
├── page-title.js      页面标题
├── sun-time.js        按真实日出日落算早晚四张脸
├── sparkles.js        点一下冒星星
├── flourish.js        动态页那几处活起来的细节（点赞不刷页、夜里的心和星）
├── app-icon.js        主屏幕图标
│
├── home-page.js       主页 /home
├── home-activity.js   主页那份行动卡（同一件事叠成一摞、分页）
├── anniversary.js     纪念日卡和它的设置页
├── discover-page.js   发现页 /discover：一行四个应用方块
├── discover-apps.js   应用网格、长按、改名换图标
├── memories-page.js   记忆页 /memories：他的几个记忆库
├── me-page.js         个人页 /me
├── logs-page.js       后台日志 /logs
│
├── chat-page.js       聊天两层 /chat（列表 → 窗口），行动卡也在这一页
├── chat-queue.js      攒着还没让他读的话
├── echo-relay.js      聊天接 relay：history / stream / send
│
├── moments-page.js    动态页 /moments：两个人发的动态、留言、回复、点赞
├── moments-posts.js   只取「有人发的」动态，不含行动卡
├── moments-store.js   点赞、行动卡片详情、头像和名字、你自己发的动态
├── my-moments.js      你自己发的动态：发、改、删
├── my-comments.js     删我自己留的那条留言
├── my-photo.js        动态配图上传
├── from-her.js        你放的星、你发的动态，醒来时带给 TA
├── favorites.js       收藏页 /moments/favorites
├── star-jar.js        星星罐：一天一颗、摘星回复、页面
├── star-entry.js      星星罐入口
│
├── books.js           共读数据层：段落、批注、两条进度线、给 TA 读的那几段
├── books-page.js      共读页 /books（托 NEST 前端 + 转接层，署名在文件头）
├── books-mcp.js       共读 MCP：聊天里也能读书、写批注
├── books-steps.js     读书的续步
├── proof.js           小酒馆数据层
├── bar-page.js        小酒馆时间轴 /bar
├── bar-mcp.js         小酒馆 MCP
├── proof-gateway.js   递出去那杯酒的公开链接
├── proof-prompt.js    小酒馆那段提示词
├── wallet.js          小钱包
├── wallet-mcp.js      钱包 MCP
├── wallet-steps.js    钱包的续步
├── shopping.js        购物与心愿单
├── shopping-page.js   购物页
├── shopping-mcp.js    购物 MCP
├── workkk.js          上班游戏
├── workkk-steps.js    上班的续步
├── garden.js          花园
├── garden-steps.js    花园的续步
├── xiuchao.js         锈潮
├── xiuchao-steps.js   锈潮的续步
├── rusttide.js        锈潮接入层
├── game-page.js       小游戏列表 /games
│
├── wake-mcp.js        精确唤醒 MCP：约时间、看约、撒约、改时间
├── wake-info.js       上次 / 下次 / 自主唤醒时间
├── drives.js          Drivesoid 上报与读取情绪
├── drives-page.js     心绪页 /drives
├── diary-page.js      日记页 /diary（读 heartbeat 的文件，只读）
├── memory-proxy.js    记忆库 /memory/（转发 Ombre Brain 管理页）
├── music-proxy.js     音乐转发 /music/
├── light-proxy.js     台灯页 /lamp（转发本机 3003）
├── heartbeat-proxy.js heartbeat 转发
│
├── wall-time.js       按 TIME_ZONE 处理日期时间
├── state.js           SQLite 读写；启动时自动建表、搬旧数据
├── mcp-manager.js     连接各个 MCP；挡掉醒来时不能用的工具
├── vesper.js          3001：PWA 外壳、所有页面、上报、/wake/*
├── gateway.js         3002：模型路由 + 对话记录
└── actions/           bark / moment / star-jar / shake-jar / read-memo / read-book
                       / proof-drink / mcp-action / ombre-brain / set-mode
                       / doing-follow-up / wake-bridge / wallet / activity
scripts/               一次性补丁脚本（每个都能重复跑，锚点对不上就还原）
public/motion/         加载页和转场的动效素材
docs/                  详细文档（见上表）
```

## 许可证与署名

本仓库自己写的那部分见 [LICENSE](LICENSE)。

**下面这些项目都不是本项目的作品**，本仓库所有者只是 fork 或接入。各自的许可证以它们仓库里的为准，用之前请自己读一遍：

| 项目 | 作者 | 许可证 | 要注意的 |
|---|---|---|---|
| [NEST 书架 UI](https://github.com/nonchaiovo/nest-bookshelf-ui) | [@nonchaiovo](https://github.com/nonchaiovo) | 个人非商业使用许可 | 不得商用、不得打包再发布；**公开展示必须署名并链接原仓库** |
| [WORKKK / AI 上班模拟器](https://github.com/zhizhou-xiee/workkk) | 谢之舟 [@zhizhou-xiee](https://github.com/zhizhou-xiee) | AGPL-3.0-or-later ＋ §7 附加条款 | **运行界面必须保留可见作者署名和源码链接**；修改版须标明修改日期与内容，不得谎称来源；§13 网络条款 |
| [Proof](https://github.com/lumingye/Proof) | [@lumingye](https://github.com/lumingye) | PolyForm Noncommercial 1.0.0 ＋ 附加条款 | **非商用**；再分发须带 `Required Notice: Copyright (c) 2026 lumingye`；禁恶意用途与恶意修改版 |
| [rainholm-garden](https://github.com/wuxuyun0606-collab/rainholm-garden) | suwanblue & Kelin & Guchen | MIT（自写代码） | **随包引擎 vendor/aifarm 禁商用**；美术、字体、图标、猫角色形象各有各的许可，逐项见其 NOTICE |
| [ios-web-push](https://github.com/Cheiineeey/ios-web-push) | [@Cheiineeey](https://github.com/Cheiineeey) | AGPL-3.0 | §13 网络条款 |
| [Night-Fall](https://github.com/ysuu525/Night-Fall) | [@ysuu525](https://github.com/ysuu525) | MIT | Copyright (c) 2026 Night Fall contributors |
| Serein | ChiYouyu | MIT | Copyright (c) 2026 ChiYouyu；原库地址待补 |
| [cove-sticker-mcp](https://github.com/moonlin1213/cove-sticker-mcp) | [@moonlin1213](https://github.com/moonlin1213) | MIT | Copyright (c) 2026 moonlin1213 |
| [Ombre Brain](https://github.com/P0luz/Ombre-Brain) | [@P0luz](https://github.com/P0luz) | 见其仓库 | |
| [Drivesoid](https://github.com/A1batr055/Drivesoid) | [@A1batr055](https://github.com/A1batr055) | 见其仓库 | |
| [dylan-heartbeat](https://github.com/callie0313/dylan-heartbeat) | [@callie0313](https://github.com/callie0313) | 见其仓库 | |
| [Music-Mcp-Netease](https://github.com/Anko3o/Music-Mcp-Netease) | [@Anko3o](https://github.com/Anko3o) | 见其仓库 | |
| [cove-resonance](https://github.com/yanceydaisy/cove-resonance) | [@yanceydaisy](https://github.com/yanceydaisy) | 见其仓库 | |

> 合起来：**这套东西整体只能非商用**（Proof 和 rainholm-garden 的引擎都禁商用），并且 WORKKK 与 ios-web-push 的 AGPL 意味着你改过的版本如果让别人通过网络使用，得能把那一版源码给到对方。
>
> 第三方名称、商标与材料仍归各自权利人所有。
