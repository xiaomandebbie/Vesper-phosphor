#!/usr/bin/env python3
"""把钱包 MCP 端点挂进 vesper.js，并往 .env.example 里加那两项。

src/wallet-mcp.js 是新文件，`git pull` 就有了；这个脚本只负责 vesper.js 里那两行。
和 add_wallet_hooks.py 同一个做法：幂等、带 .bak-wallet-mcp 备份、--check 先看能不能对上。

用法：
    python3 scripts/add_wallet_mcp.py --check
    python3 scripts/add_wallet_mcp.py
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

OPS = [
    dict(path="src/vesper.js", label="引入钱包 MCP", kind="insert",
         anchor="import { registerWalletRoutes } from './wallet.js';",
         text="\nimport { registerWalletMcp } from './wallet-mcp.js';",
         marker="registerWalletMcp } from './wallet-mcp.js'"),
    # 挂在 registerWalletRoutes 后面。express.json() 已经在前面解好了 body，
    # wallet-mcp 里往 handleRequest 传的第三个参数就是它
    dict(path="src/vesper.js", label="挂钱包 MCP 端点", kind="insert",
         anchor="const wallet = registerWalletRoutes(app, { requireBasicAuth, requireApiKey });",
         text="\n// 钱包的 MCP 端点 /wallet/mcp：让 Aru 这边也能读账、写批注，见 wallet-mcp.js\n"
              "const walletMcp = registerWalletMcp(app);",
         marker="registerWalletMcp(app)"),
    dict(path="src/vesper.js", label="启动日志带上钱包 MCP", kind="replace",
         anchor="；钱包：/wallet${wallet.spendEnabled ? '' : '（没配 WALLET_SPEND_SECRET，扣款通知接口没开）'}`",
         text="；钱包：/wallet${wallet.spendEnabled ? '' : '（没配 WALLET_SPEND_SECRET，扣款通知接口没开）'}"
              "${walletMcp.enabled ? `；钱包 MCP：/wallet/mcp（批注算 ${walletMcp.signAs}）` : ''}`",
         marker="钱包 MCP：/wallet/mcp"),
]

ENV_BLOCK = """
# 钱包 MCP 端点 /wallet/mcp的 token。不填这个端点不开——
# 它能读账、能往账本里写批注。生成一个：openssl rand -hex 24
WALLET_MCP_TOKEN=
# 通过 MCP 写的批注算谁的。默认 assistant（算他写的），填 user 就算你写的
WALLET_MCP_SIGN_AS=assistant
"""


def plan():
    texts = {}
    statuses = []
    for op in OPS:
        path = op["path"]
        fp = ROOT / path
        if path not in texts:
            texts[path] = fp.read_text(encoding="utf-8") if fp.exists() else None
        text = texts[path]
        if text is None:
            statuses.append(("missing", f"✗ {path} 不在"))
            continue

        anchor, label = op["anchor"], op["label"]
        if op["marker"] in text:
            statuses.append(("done", f"· {path} {label}：已经打过了"))
            continue
        n = text.count(anchor)
        if n == 0:
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
        print("\n有对不上的地方，什么都没改。")
        print("这个脚本要求已经跑过 add_wallet_hooks.py（钱包本体的接线）。")
        return 1

    changed = sorted({op["path"] for op, (s, _) in zip(OPS, statuses) if s == "ok"})
    if not changed:
        print("\n每一处都已经打过了，不用再动。")
    if check_only:
        print("\n--check 模式，没有写任何文件。")
        return 0

    for path in changed:
        fp = ROOT / path
        bak = fp.with_suffix(fp.suffix + ".bak-wallet-mcp")
        if not bak.exists():
            shutil.copy2(fp, bak)
        fp.write_text(texts[path], encoding="utf-8")
        print(f"打好了：{path}")

    env = ROOT / ".env.example"
    if env.exists():
        text = env.read_text(encoding="utf-8")
        if "WALLET_MCP_TOKEN" in text:
            print("· .env.example：已经有钱包 MCP 那两项了")
        else:
            env.write_text(text.rstrip() + "\n" + ENV_BLOCK, encoding="utf-8")
            print("打好了：.env.example 加上钱包 MCP 配置")

    print("\n接下来：在 .env 里填 WALLET_MCP_TOKEN，然后 pm2 restart vesper --update-env")
    return 0


if __name__ == "__main__":
    sys.exit(main())
