#!/usr/bin/env bash
# Latent 第一步：拉下来、自检、把真实的 CLI 吐出来。
#
# 小满 2026-10-30 21:49：「开始弄记忆吧 我想把 latent 搭了」
#
# ── 这一步不初始化 ──
#
# 初始化流程是 inspect → extract → choose-sections → preview → route → ship，
# 每步的参数我不猜——让 memory_init.py 自己说。今天已经因为猜参数、
# 猜字段名、猜进程名赔过好几次时间了。
#
# ── 为什么代码和产出分开放 ──
#
# README 里的警告：产出目录别建在 clone 里面。它的 .gitignore 会忽略
# memory/、人格文件和 mcp-config.json（本意是防私人记忆误进公开仓库），
# 放进去的话这些文件会被静默排除。
#   代码  /root/latent
#   产出  /root/latent-data
#
# ── 端口 3030 ──
#
# 已占：3001 vesper、3002 gateway、3003 台灯、3011 relay、3020 api_loop、
# 5173 花园、8000 workkk、8787 aru、8890 lamp、9090 播放器、18001 ombre、18012 点歌台。
#
# 重跑安全。
set -euo pipefail

SRC=/root/latent
DATA=/root/latent-data
PROXY=https://gh-proxy.com/https://github.com/xiaomandebbie/Latent-memory.git

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要 root"

# ── 1. Python 版本 ──
say "1/5  Python"
command -v python3 >/dev/null || die "没有 python3"
PV=$(python3 -c 'import sys;print("%d.%d"%sys.version_info[:2])')
ok "python3 $PV"
python3 -c 'import sys;sys.exit(0 if sys.version_info[:2]>=(3,10) else 1)' \
  || die "Latent 要 3.10+，这台是 $PV。装个新的或用 pyenv。"

# ── 2. 端口 ──
say "2/5  端口 3030"
if ss -ltn 2>/dev/null | grep -q ':3030 '; then
  warn "3030 被占：$(ss -ltnp 2>/dev/null | grep ':3030 ' | head -1)"
  warn "后面起服务时换个号"
else
  ok "3030 空着"
fi

# ── 3. 拉代码 ──
say "3/5  拉 Latent"
if [ -d "$SRC/.git" ]; then
  git -C "$SRC" pull --ff-only "$PROXY" main >/dev/null 2>&1 \
    && ok "更新了 $SRC" || warn "pull 没成，用本地已有的"
else
  git clone --depth 1 "$PROXY" "$SRC" >/dev/null 2>&1 || die "clone 失败"
  ok "拉到 $SRC"
fi
mkdir -p "$DATA"
chmod 700 "$DATA"
ok "产出目录 $DATA（700，和 clone 分开）"

# ── 4. 自检 ──
say "4/5  自检（每个 .py 自带 --selftest）"
cd "$SRC"
if python3 src/mcp_server.py --selftest >/tmp/latent-self.log 2>&1; then
  ok "mcp_server 自检过了"
else
  warn "mcp_server 自检没过，尾巴："
  tail -6 /tmp/latent-self.log | sed 's/^/    /'
fi
if python3 src/memory_retrieval.py --selftest >/tmp/latent-self2.log 2>&1; then
  ok "memory_retrieval 自检过了"
else
  warn "memory_retrieval 自检没过，尾巴："
  tail -6 /tmp/latent-self2.log | sed 's/^/    /'
fi

# ── 5. 把真实 CLI 吐出来 ──
say "5/5  它自己的参数（这是这一步的重点）"
echo
echo '── memory_init.py ──'
python3 src/memory_init.py --help 2>&1 | head -60 | sed 's/^/  /'
echo
echo '── mcp_server.py ──'
python3 src/mcp_server.py --help 2>&1 | head -40 | sed 's/^/  /'

cat <<EOF

  下一步要定两件事，不是命令是选择：

  ── 一、检索走哪条 ──

  零依赖（默认）  语料不出本机。记得原话时好用，换个说法就差。
  本地 embedding  要 pip install fastembed（几百 MB 模型）。换说法也找得到。
  云端 embedding  查询和被检索的内容会发给第三方。

  你那台 VPS 内存 57%，fastembed 跑得动。我倾向本地 embedding——
  允朔的记忆里很多是「大意」而不是原话，零依赖那条会找不到。
  但这是你的语料，你定。

  ── 二、和 Ombre 怎么分工 ──

  这件比命令要紧。两套都想当「记忆正文的家」的话，同一段事会有两个版本，
  他按最后读到的那份说话，而且全程不报错。

  我的建议按职责分，不按内容分：
    Ombre   继续当记忆正文的唯一家。里面已经有你们的东西，别动。
    Latent  只用它独有的三层：人格文件（常驻）、未解决清单、会话线索。
            即 latent_session_start / latent_unresolved / latent_thread_close，
            不开 latent_append 写正文。

  那三层正好是 Ombre 没有的，而且是他最缺的——换窗之后接不上前文。

  这两件定了我就写第二步。把上面 --help 的输出发我。

EOF
