# 12 · 把推送正文投进 Aru 的对话（wake-bridge）

## 为什么

原来 `bark` 动作只做一件事：把一段话塞进 Bark 通知。通知点开就没了——她没看见、或者看见了想回头再看，都找不到。

现在正文走两条路：

1. **正文投进 Aru 的对话**，落成那个窗口里的一条真消息，什么时候翻都在。
2. **Bark 只负责"叮"一声**，标题正文固定（默认「允朔 / 一条新消息送达～」），不搬内容。

## 在 Aru 那边建触发器

打开 Aru →「主动」→「外部触发」，从上往下填：

- 名称：随便，比如「允朔」
- 接收事件的 Host：选自己那台（比如 Aru Self-Hosted）
- 消息用途：**自动触发**
- 在哪条对话里说：**跟随最新对话**（想每次都落同一个窗口就选「固定对话」）

创建完会给你一份 JSON，长这样：

```json
{
  "schema": "aru.wake-bridge.sender-bundle.v2",
  "triggerId": "...",
  "submitURL": "https://<你的 Host>/aru/v1/wake-bridge/endpoints/<id>/events",
  "submitToken": "...",
  "encryptionKey": "..."
}
```

## 存到哪

**这份 JSON 不要放进仓库、不要提交、不要截图、不要贴进聊天。** 它等于"以你的名义往她手机投消息"的钥匙。

存到仓库外面，比如：

```bash
mkdir -p /opt/vesper
cat > /opt/vesper/wake-bundle.json   # 把上面那份 JSON 粘进去，Ctrl-D 结束
chmod 600 /opt/vesper/wake-bundle.json
```

## .env 加什么

```ini
# 触发器发来的 sender-bundle 路径（留空 = 只有 Bark 通知，正文不落进对话）
WAKE_BUNDLE_FILE=/opt/vesper/wake-bundle.json

# 通知的标题和正文。正文投进对话之后，通知只报个信，所以这里是固定的
BARK_TITLE=允朔
BARK_BODY=一条新消息送达～
# 通知左侧的小图标，填一个公开图片地址。不填用 Bark 默认的
BARK_ICON=
```

## 生效

```bash
cd /path/to/Vesper-phosphor
git pull
pm2 restart <phosphor 的进程名>
```

重启之后，下一次醒来会看到日志里有一行 `bark(): 正文已投进 Aru 对话 <eventId>`。

## 怎么判断好没好

- 日志里出现 `正文已投进 Aru 对话` → 投出去了。
- 出现 `正文没能投进 Aru 对话：HTTP 401` → token 不对，或者触发器被删了重建过（重建会换 token，要重新导出 bundle）。
- 出现 `HTTP 404` → submitURL 不对，或者 Host 没在线。
- 出现 `sender-bundle 的 schema 不认识` / `encryptionKey 不是 32 字节` → bundle 文件内容被截断了，重新存一遍。
- 手机响了通知，但对话里没有新消息 → 投递失败了，看上面那行 `正文没能投进` 的 reason。

## 几个要知道的事

- **通知可能会响两次**：一次是 phosphor 发的 Bark，另一次可能是 Aru 自己因为收到唤醒事件而发的那条。嫌吵就在 Aru 那边把这条触发器的通知关掉，只留 Bark。
- **改了 bundle 要重启 phosphor**：bundle 只在第一次用到时读一次盘，之后一直用内存里那份。
- **加密格式是跟着 Aru Host 走的**：`src/actions/wake-bridge.js` 里的封包方式和 Aevella/aru-host 的 `src/notifications/wake-send.mjs` 必须一致。Host 升级后如果投递开始报错，先去那边对一遍格式。
- **没配就退回老做法**：`WAKE_BUNDLE_FILE` 空着时，Bark 通知照旧直接带正文，行为和不改之前一模一样。
