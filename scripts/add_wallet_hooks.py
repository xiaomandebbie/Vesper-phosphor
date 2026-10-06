#!/usr/bin/env python3
"""把钱包挂进 vesper.js、decide.js、actions/index.js、phosphor.js、page-chrome.js 和 .env.example。

src/wallet.js、src/actions/wallet.js、src/wallet-steps.js 是新文件，`git pull` 就有了；
这个脚本只负责那几处很小的接线，免得为了加几行去重写几个大文件。

改之前每个文件存一份 .bak-wallet（已经存过就不覆盖，留着最早那份）。
打过一次之后再跑会说「已经打过了」，不会打第二遍。
已经打过早先版本的库也能直接再跑：已打的跳过，只补新增的那几处，
并把早先那行「把余额塞进每次醒来提示」改成现在这套主动动作。

⚠️ 跑完脚本再重启。先 pull 就重启的话，decide.js 里还引着已经没有的 walletBlock，
vesper 和 phosphor 会在启动时报导入错误。稳当的写法是串起来：
    git pull && python3 scripts/add_wallet_hooks.py && pm2 restart vesper phosphor --update-env

用法：
    python3 scripts/add_wallet_hooks.py --check   # 只看每处能不能对上，不写
    python3 scripts/add_wallet_hooks.py           # 真打
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

WALLET_ACTIONS_PROMPT = """
- wallet_balance（打开小钱包：看一眼现在有多少钱、跟卡里对不对得上。不需要 action_detail）
- wallet_ledger（翻账本：最近几笔、某一天的、或者最近的批注。action_detail 见上面「小钱包」那节）
- wallet_note（给账本里某一笔记一句批注。action_detail 是JSON字符串 {"entry_id":12,"note":"..."}）"""

PHOSPHOR_WALLET_BLOCK = """  // 钱包：看完余额、翻完账可以接着翻某一天的、读批注，最后给某笔记一句。
  // 和论坛、听歌一样：出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      await continueWallet(decision, result, messages);
    } catch (err) {
      console.error(`[${kind}] continueWallet failed:`, err);
    }
  }

"""

# kind: insert 在锚点后面插入 / replace 整句替换 / drop 删掉锚点
# optional: 锚点不在就静静跳过，不当出错（用于「早先版本打过才有」的那几处）
# marker: 这段已经在了就不再动；drop 没有 marker，锚点不在就算做过了
OPS = [
    # ---------- vesper.js：挂路由 ----------
    dict(path="src/vesper.js", label="引入钱包", kind="insert",
         anchor="import { renderLoginPage } from './login-page.js';",
         text="\nimport { registerWalletRoutes } from './wallet.js';",
         marker="registerWalletRoutes } from './wallet.js'"),
    dict(path="src/vesper.js", label="挂钱包路由", kind="insert",
         anchor="registerDrivesRoutes(app, { requireBasicAuth });",
         text="\n// 电子小钱包 /wallet：余额、按日历分组的账单、每笔的批注，见 wallet.js\n"
              "const wallet = registerWalletRoutes(app, { requireBasicAuth, requireApiKey });",
         marker="registerWalletRoutes(app"),
    dict(path="src/vesper.js", label="启动日志带上钱包", kind="replace",
         anchor="；星星罐：/moments/star-jar`",
         text="；星星罐：/moments/star-jar；钱包：/wallet${wallet.spendEnabled ? '' : '（没配 WALLET_SPEND_SECRET，扣款通知接口没开）'}`",
         marker="；钱包：/wallet"),

    # ---------- page-chrome.js：菜单 ----------
    dict(path="src/page-chrome.js", label="菜单里加小钱包", kind="insert",
         anchor="    { href: '/drives', label: '心绪' },",
         text="\n    { href: '/wallet', label: '小钱包' },",
         marker="label: '小钱包'"),

    # ---------- decide.js：拆掉被动那行，换成主动动作 ----------
    # 早先版本把余额塞进每次醒来的 user 消息里。先把那两处改掉：
    # 注意顺序——这条（改旧引入）必须在下面「引入 walletSection」之前，
    # 否则旧库会先被插入一行新的，变成重复引入。
    dict(path="src/decide.js", label="旧的被动引入改成 walletSection", kind="replace", optional=True,
         anchor="import { walletBlock } from './wallet.js';",
         text="import { walletSection } from './wallet.js';",
         marker="walletSection } from './wallet.js'"),
    dict(path="src/decide.js", label="拆掉被动的那一行", kind="drop",
         anchor="\n    walletBlock(),"),
    # 从没打过补丁的库：直接插入引入（上面那条已经被 replace 成 walletSection 的话，
    # marker 会命中，这条自动跳过）
    dict(path="src/decide.js", label="引入 walletSection", kind="insert",
         anchor="import { fromHerBlock } from './from-her.js';",
         text="\nimport { walletSection } from './wallet.js';",
         marker="walletSection } from './wallet.js'"),
    # 续步要用到带重试和 JSON 容错的请求（见 wallet-steps.js）
    dict(path="src/decide.js", label="把 askJson 导出给续步用", kind="replace",
         anchor="async function askJson(messages) {",
         text="export async function askJson(messages) {",
         marker="export async function askJson"),
    # 系统提示里加「小钱包」那节（只跟配置有关，不影响前缀缓存）
    dict(path="src/decide.js", label="系统提示里加小钱包那节", kind="replace",
         anchor="${forumSteps}${musicSection}",
         text="${forumSteps}${musicSection}${walletSection()}",
         marker="${walletSection()}"),
    dict(path="src/decide.js", label="动作列表里加三个钱包动作", kind="insert",
         anchor="- noop（什么都不做，这是合法结果，不代表失败）",
         text=WALLET_ACTIONS_PROMPT,
         marker="- wallet_balance（"),

    # ---------- actions/index.js：注册三个动作 ----------
    dict(path="src/actions/index.js", label="引入钱包动作", kind="insert",
         anchor="import readMemo from './read-memo.js';",
         text="\nimport { walletBalance, walletLedger, walletNote } from './wallet.js';",
         marker="walletBalance, walletLedger, walletNote"),
    dict(path="src/actions/index.js", label="注册钱包动作", kind="insert",
         anchor="  read_memo: readMemo,",
         text="\n  wallet_balance: walletBalance,\n  wallet_ledger: walletLedger,\n  wallet_note: walletNote,",
         marker="wallet_balance: walletBalance"),

    # ---------- phosphor.js：续步 ----------
    dict(path="src/phosphor.js", label="引入钱包续步", kind="insert",
         anchor="import { collectFromHer, handleFromHer } from './from-her.js';",
         text="\nimport { continueWallet } from './wallet-steps.js';",
         marker="continueWallet } from './wallet-steps.js'"),
    dict(path="src/phosphor.js", label="唤醒里接上钱包续步", kind="replace",
         anchor="  logWake({",
         text=PHOSPHOR_WALLET_BLOCK + "  logWake({",
         marker="continueWallet(decision, result, messages)"),
]

ENV_BLOCK = """
# ---------- 电子小钱包（见 docs/10-wallet.md）----------
# 银行短信打进来的通知要带的口令。不填 /api/wallet/spend-notify 不会开——
# 那是个能改钱的写接口，端口一旦暴露在公网，不设口令等于谁都能往账上记账。
# 生成一个：openssl rand -hex 24
WALLET_SPEND_SECRET=
# 单笔上限（元）。短信正则偶尔会抓错数字，上限挡一道。默认 500
WALLET_MAX_SINGLE_YUAN=500
# 银行报的可用余额上限（元）。它比单笔大得多，单独一个阀值。默认 100000
WALLET_MAX_BANK_BALANCE_YUAN=100000
# 银行余额和账本差多少算对不上（元）。默认 0.01
WALLET_RECONCILE_TOLERANCE_YUAN=0.01
# 钱包一次醒来最多再走几步。默认 3，填 0 就是只走一步，最多 5
WALLET_MAX_STEPS=3
# 记账后要不要在动态页记一张卡片，填 off 关掉。默认开
WALLET_MOMENT=on
"""


# 按顺序在内存里模拟一遍再落盘。
# 不这样做的话，旧库里 decide.js 那两条引入补丁会同时命中：
# 「改旧引入」把 walletBlock 换成 walletSection，「引入 walletSection」又再插一行，
# 结果重复引入。模拟一遍就能看见前一步的结果。
def plan():
    """返回 (statuses, texts)。statuses 和 OPS 一一对应；texts 是 {path: 模拟完的正文}。"""
    texts = {}
    statuses = []
    for op in OPS:
        path = op["path"]
        fp = ROOT / path
        if path not in texts:
            if not fp.exists():
                texts[path] = None
            else:
                texts[path] = fp.read_text(encoding="utf-8")
        text = texts[path]
        if text is None:
            statuses.append(("missing", f"✗ {path} 不在"))
            continue

        anchor = op["anchor"]
        label = op["label"]

        if op["kind"] == "drop":
            n = text.count(anchor)
            if n == 0:
                statuses.append(("done", f"· {path} {label}：已经打过了"))
                continue
            if n > 1:
                statuses.append(("ambiguous", f"✗ {path} {label}：锚点出现了 {n} 次，不敢动"))
                continue
            texts[path] = text.replace(anchor, "", 1)
            statuses.append(("ok", f"✓ {path} {label}：能对上"))
            continue

        if op["marker"] in text:
            statuses.append(("done", f"· {path} {label}：已经打过了"))
            continue
        n = text.count(anchor)
        if n == 0:
            if op.get("optional"):
                statuses.append(("skip", f"· {path} {label}：用不上（这库没打过早先的补丁）"))
            else:
                statuses.append(("nomatch", f"✗ {path} {label}：对不上原文"))
            continue
        if n > 1:
            statuses.append(("ambiguous", f"✗ {path} {label}：锚点出现了 {n} 次，不敢动"))
            continue

        new = anchor + op["text"] if op["kind"] == "insert" else op["text"]
        texts[path] = text.replace(anchor, new, 1)
        statuses.append(("ok", f"✓ {path} {label}：能对上"))

    return statuses, texts


def main():
    check_only = "--check" in sys.argv
    statuses, texts = plan()
    for _, msg in statuses:
        print(msg)

    if [m for s, m in statuses if s in ("missing", "nomatch", "ambiguous")]:
        print("\n有对不上的地方，什么都没改。先确认仓库是最新的 main（git pull）。")
        return 1

    changed = sorted({op["path"] for op, (s, _) in zip(OPS, statuses) if s == "ok"})
    if not changed:
        print("\n每一处都已经打过了，不用再动。")
    if check_only:
        print("\n--check 模式，没有写任何文件。")
        return 0

    for path in changed:
        fp = ROOT / path
        bak = fp.with_suffix(fp.suffix + ".bak-wallet")
        if not bak.exists():
            shutil.copy2(fp, bak)
        fp.write_text(texts[path], encoding="utf-8")
        print(f"打好了：{path}")

    env = ROOT / ".env.example"
    if env.exists():
        text = env.read_text(encoding="utf-8")
        if "WALLET_SPEND_SECRET" in text:
            missing = [k for k in ("WALLET_MAX_STEPS", "WALLET_MAX_BANK_BALANCE_YUAN",
                                   "WALLET_RECONCILE_TOLERANCE_YUAN") if k not in text]
            if missing:
                extra = "\n# 钱包后来加的几项（见 docs/10-wallet.md）\n" + "".join(
                    {
                        "WALLET_MAX_STEPS": "# 钱包一次醒来最多再走几步。默认 3，填 0 就是只走一步，最多 5\nWALLET_MAX_STEPS=3\n",
                        "WALLET_MAX_BANK_BALANCE_YUAN": "# 银行报的可用余额上限（元）。默认 100000\nWALLET_MAX_BANK_BALANCE_YUAN=100000\n",
                        "WALLET_RECONCILE_TOLERANCE_YUAN": "# 银行余额和账本差多少算对不上（元）。默认 0.01\nWALLET_RECONCILE_TOLERANCE_YUAN=0.01\n",
                    }[k]
                    for k in missing
                )
                env.write_text(text.rstrip() + "\n" + extra, encoding="utf-8")
                print(f"打好了：.env.example 补上 {'、'.join(missing)}")
            else:
                print("· .env.example：已经有钱包那几项了")
        else:
            env.write_text(text.rstrip() + "\n" + ENV_BLOCK, encoding="utf-8")
            print("打好了：.env.example 加上钱包配置")

    print("\n接下来：pm2 restart vesper phosphor --update-env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
