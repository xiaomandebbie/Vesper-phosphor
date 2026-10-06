#!/usr/bin/env python3
"""把钱包挂进 vesper.js、decide.js、page-chrome.js 和 .env.example。

src/wallet.js 是新文件，不用动；这个脚本只负责那几处很小的接线，
免得为了加几行去重写几个大文件。

改之前每个文件存一份 .bak-wallet；打过一次之后再跑会说「已经打过了」，
不会打第二遍，也不会弄坏什么。已经打过早先版本的也能直接再跑：
已打的跳过，只补新增的那几处。

用法：
    python3 scripts/add_wallet_hooks.py --check   # 只看每处能不能对上，不写
    python3 scripts/add_wallet_hooks.py           # 真打
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# (文件, 说明, 锚点原文, 插在锚点后面的内容, 判断已打过的标记)
PATCHES = [
    (
        "src/vesper.js",
        "引入钱包",
        "import { renderLoginPage } from './login-page.js';",
        "\nimport { registerWalletRoutes } from './wallet.js';",
        "from './wallet.js'",
    ),
    (
        "src/vesper.js",
        "挂钱包路由",
        "registerDrivesRoutes(app, { requireBasicAuth });",
        "\n// 电子小钱包 /wallet：余额、账单，以及银行短信打进来的扣款通知，见 wallet.js\n"
        "const wallet = registerWalletRoutes(app, { requireBasicAuth, requireApiKey });",
        "registerWalletRoutes(app",
    ),
    (
        "src/vesper.js",
        "启动日志带上钱包",
        "；星星罐：/moments/star-jar`",
        "",  # 这条是替换，见下面的 REPLACEMENTS
        "；钱包：/wallet",
    ),
    (
        "src/decide.js",
        "引入钱包那一行",
        "import { fromHerBlock } from './from-her.js';",
        "\nimport { walletBlock } from './wallet.js';",
        "from './wallet.js'",
    ),
    (
        "src/decide.js",
        "醒来时看一眼钱包",
        "    fromHerBlock(context.fromHer),",
        "\n    walletBlock(),",
        "walletBlock(),",
    ),
    (
        "src/page-chrome.js",
        "菜单里加小钱包",
        "    { href: '/drives', label: '心绪' },",
        "\n    { href: '/wallet', label: '小钱包' },",
        "label: '小钱包'",
    ),
]

# 需要整句替换而不是插入的那几处
REPLACEMENTS = [
    (
        "src/vesper.js",
        "；星星罐：/moments/star-jar`",
        "；星星罐：/moments/star-jar；钱包：/wallet${wallet.spendEnabled ? '' : '（没配 WALLET_SPEND_SECRET，扣款通知接口没开）'}`",
    ),
]

ENV_BLOCK = """
# ---------- 电子小钱包（见 docs/10-wallet.md）----------
# 银行短信打进来的扣款通知要带的口令。不填 /api/wallet/spend-notify 不会开——
# 那是个能改钱的写接口，端口一旦暴露在公网，不设口令等于谁都能往账上记花销。
# 生成一个：openssl rand -hex 24
WALLET_SPEND_SECRET=
# 单笔上限（元）。短信正则偶尔会抓错数字，上限挡一道。默认 500
WALLET_MAX_SINGLE_YUAN=500
# 扣款后要不要在动态页记一张卡片，填 off 关掉。默认开
WALLET_MOMENT=on
"""


def check_one(path, label, anchor, _addition, marker):
    fp = ROOT / path
    if not fp.exists():
        return "missing", f"✗ {path} 不在"
    text = fp.read_text(encoding="utf-8")
    if marker in text:
        return "done", f"· {path} {label}：已经打过了"
    if text.count(anchor) == 1:
        return "ok", f"✓ {path} {label}：能对上"
    if anchor not in text:
        return "nomatch", f"✗ {path} {label}：对不上原文"
    return "ambiguous", f"✗ {path} {label}：锚点出现了 {text.count(anchor)} 次，不敢动"


def main():
    check_only = "--check" in sys.argv
    results = [check_one(*p) for p in PATCHES]
    for _, msg in results:
        print(msg)

    bad = [m for s, m in results if s in ("missing", "nomatch", "ambiguous")]
    if bad:
        print("\n有对不上的地方，什么都没改。先确认仓库是最新的 main（git pull）。")
        return 1

    todo = [p for p, (s, _) in zip(PATCHES, results) if s == "ok"]
    if not todo:
        print("\n每一处都已经打过了，不用再动。")
    if check_only:
        print("\n--check 模式，没有写任何文件。")
        return 0

    backed_up = set()
    for path, label, anchor, addition, marker in todo:
        fp = ROOT / path
        if path not in backed_up:
            shutil.copy2(fp, fp.with_suffix(fp.suffix + ".bak-wallet"))
            backed_up.add(path)
        text = fp.read_text(encoding="utf-8")
        replacement = next(
            (new for p, old, new in REPLACEMENTS if p == path and old == anchor), None
        )
        text = text.replace(anchor, replacement if replacement else anchor + addition, 1)
        fp.write_text(text, encoding="utf-8")
        print(f"打好了：{path} {label}")

    env = ROOT / ".env.example"
    if env.exists():
        text = env.read_text(encoding="utf-8")
        if "WALLET_SPEND_SECRET" in text:
            print("· .env.example：已经有钱包那几项了")
        else:
            env.write_text(text.rstrip() + "\n" + ENV_BLOCK, encoding="utf-8")
            print("打好了：.env.example 加上钱包配置")

    print("\n接下来：在 .env 里填 WALLET_SPEND_SECRET，然后 pm2 restart vesper phosphor --update-env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
