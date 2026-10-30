#!/usr/bin/env bash
# 装允朔的身体：api_loop.py 跑在 3020。
#
# 小满 2026-10-30：「接好」
#
# ── 为什么模型指晨暮星网关，不直连 DeepSeek ──
#
# gateway.js（3002）的 model="chat" 那条线路做四件事：
#   1. 把对话记进 conversation_log——decide.js 和 heartbeat 读的就是这份，
#      跳窗口也不丢。直连模型就会分出第二条记忆线，那正是「好重复」的根。
#   2. 注入小酒馆状态（见 proof-gateway.js）
#   3. 注入「正在做的事」（见 doing.js）
#   4. 注入攒着的聊天（见 injectPendingChat）——她发了没点「让他回复」的那几句
#
# 所以 api_loop 的 main_chain 指 http://127.0.0.1:3002/v1 + model "chat"。
# 上游谁家由网关的 CLIENT_UPSTREAM_* 决定。
#
# ── 这个脚本做什么 ──
#   1. 检端口 3020、检 relay 在跑
#   2. 拷 Tidal_Echo 的 examples/ 到 /root/companion-loop
#   3. 单独的 venv + 装依赖（不动 relay 的 venv）
#   4. 写 .env
#   5. 建 api_loop.config.json：网关当模型 + 从晨暮星 .env 里摸出 MCP 服务
#   6. 建 persona.md 占位（这一项要你自己填）
#   7. systemd + 把 relay 的 brain 切到 loop
#   8. 验
#
# 重跑安全：已有的 config.json 和 persona.md 不覆盖。
#
# 跑法：
#   bash scripts/install_loop.sh
set -euo pipefail

ECHO_SRC=/root/tidal-echo
LOOP_DIR=/root/companion-loop
RELAY_DIR=/root/companion-relay
VESPER_DIR=/root/vesper-phosphor
PIP_MIRROR=https://pypi.tuna.tsinghua.edu.cn/simple

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要 root"
[ -d "$ECHO_SRC/examples" ] || die "没有 $ECHO_SRC/examples，先跑 install_echo.sh"
[ -f "$RELAY_DIR/relay.env" ] || die "没有 relay.env，先跑 install_echo.sh"

SECRET=$(grep -m1 '^RELAY_SECRET=' "$RELAY_DIR/relay.env" | cut -d= -f2-)
[ -n "$SECRET" ] || die "relay.env 里没读到 RELAY_SECRET"

# ── 1. 端口和 relay ──
say "1/8  看端口和 relay"
if ss -ltn 2>/dev/null | grep -q ':3020 '; then
  if systemctl is-active --quiet companion-api-loop 2>/dev/null; then
    ok "3020 是 api_loop 自己（重跑）"
  else
    warn "3020 已被占：$(ss -ltnp 2>/dev/null | grep ':3020 ' | head -1)"
    die "先停掉它，或改 LOOP_PORT（要同步改 relay.env 的 RELAY_LOOP_INGEST_URL）"
  fi
else
  ok "3020 空着"
fi
systemctl is-active --quiet companion-relay \
  && ok "relay 活着" \
  || die "relay 没跑：systemctl start companion-relay"

# ── 2. 拷源码 ──
say "2/8  拷 examples/"
mkdir -p "$LOOP_DIR"
cp "$ECHO_SRC/examples/api_loop.py" "$ECHO_SRC/examples/requirements.txt" "$LOOP_DIR/"
cp "$ECHO_SRC/examples/mcp_demo_server.py" "$LOOP_DIR/" 2>/dev/null || true
ok "放在 $LOOP_DIR"

# ── 3. venv ──
say "3/8  装依赖（单独 venv，不动 relay 那个）"
if [ ! -x "$LOOP_DIR/venv/bin/python" ]; then
  python3 -m venv "$LOOP_DIR/venv" || die "建 venv 失败"
fi
"$LOOP_DIR/venv/bin/pip" install -q -i "$PIP_MIRROR" -r "$LOOP_DIR/requirements.txt" \
  || die "装依赖失败"
ok "fastapi / uvicorn / httpx / mcp 齐了"

# ── 4. .env ──
say "4/8  写 .env"
cat > "$LOOP_DIR/.env" <<EOF
# 允朔的身体。模型 / 人格 / MCP 都在 api_loop.config.json 里，这儿只放启动参数。
LOOP_PORT=3020
LOOP_HOST=127.0.0.1
RELAY_URL=http://127.0.0.1:3011
RELAY_SECRET=$SECRET
RELAY_DB=$RELAY_DIR/relay.db
RELAY_UPLOAD_DIR=$RELAY_DIR/uploads
LOOP_CONFIG=$LOOP_DIR/api_loop.config.json
LOOP_CACHE_DIR=$LOOP_DIR/loop_cache
LOOP_STREAM=1
LLM_MAX_TOKENS=2000
EOF
chmod 600 "$LOOP_DIR/.env"
ok "$LOOP_DIR/.env"

# ── 5. config.json：网关当模型 + 摸 MCP ──
say "5/8  建 api_loop.config.json"
"$LOOP_DIR/venv/bin/python" - "$LOOP_DIR" "$VESPER_DIR" <<'PY'
import json, os, re, sys

loop_dir, vesper_dir = sys.argv[1], sys.argv[2]
cfg_path = os.path.join(loop_dir, 'api_loop.config.json')

# 晨暮星的 .env：网关 key 和各个 MCP 地址都在这里，不用我猜
env = {}
try:
    with open(os.path.join(vesper_dir, '.env'), encoding='utf-8') as f:
        for line in f:
            m = re.match(r'^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$', line)
            if m:
                env[m.group(1)] = m.group(2).strip().strip('"').strip("'")
except OSError as e:
    print('  ! 读不到晨暮星 .env（%s）' % e)

# 先把 .env 里所有跟 MCP 有关的变量列出来——下面只挂我认得的那几个，
# 这张清单让我知道漏了哪些。不打印值：那里面带 token。
mcp_like = sorted(k for k in env if ('MCP' in k or 'BRAIN' in k) and env[k])
if mcp_like:
    print('  .env 里跟 MCP 有关的变量（只列名字）：')
    for k in mcp_like:
        print('    - ' + k)

if os.path.exists(cfg_path):
    print('  ! config.json 已存在，不覆盖（里面有 key）')
    raise SystemExit(0)

gw_key = env.get('GATEWAY_API_KEY', '')
gw_port = env.get('GATEWAY_PORT', '3002')

if gw_key:
    chain = [{'url': 'http://127.0.0.1:%s/v1' % gw_port, 'key': gw_key, 'model': 'chat'}]
    print('  ✓ 模型指晨暮星网关 127.0.0.1:%s（model=chat）' % gw_port)
    print('    → 对话进 conversation_log；小酒馆、正在做的事、攒着的聊天自动注入')
else:
    chain = []
    print('  ! 没有 GATEWAY_API_KEY，模型链留空了，他不会回话')

vp = 'http://127.0.0.1:' + env.get('VESPER_PORT', '3001')
mcp = []

def add(name, url, token=None, note=''):
    item = {'name': name, 'transport': 'http', 'url': url, 'enabled': True}
    if token:
        item['headers'] = {'Authorization': 'Bearer ' + token}
    mcp.append(item)
    print('  ✓ MCP %s%s' % (name, note))

# 记忆库排最前——它是允朔记忆的本体，其他那几个都不是。
# OMBRE_BRAIN_URL 本身就是完整的 MCP 地址（带 /mcp）。
ombre = env.get('OMBRE_BRAIN_URL', '')
if ombre:
    tok = env.get('OMBRE_BRAIN_TOKEN', '') or env.get('OMBRE_MCP_TOKEN', '')
    add('ombre', ombre, tok or None,
        '（记忆库）' if tok else '（记忆库，没找到 token，先不带）')
else:
    print('  ! MCP ombre 跳过（没有 OMBRE_BRAIN_URL）—— 记忆库没接上')

# 晨暮星自己挂的那几个：路径固定，token 各自一个。
# 没 token 的自动跳过——那说明那个功能本来没开。
for name, path, key in [
    ('bar',    '/bar/mcp',    'BAR_MCP_TOKEN'),
    ('books',  '/books/mcp',  'BOOKS_MCP_TOKEN'),
    ('wallet', '/wallet/mcp', 'WALLET_MCP_TOKEN'),
    ('wake',   '/wake/mcp',   'WAKE_MCP_TOKEN'),
]:
    tok = env.get(key, '')
    if tok:
        add(name, vp + path, tok)
    else:
        print('  · MCP %s 跳过（没有 %s）' % (name, key))

# 这几个在 .env 里就是完整 URL，鉴权各自在地址里或自己管
for name, key in [
    ('lamp',     'LIGHT_MCP_URL'),
    ('music',    'MUSIC_MCP_URL'),
    ('lutopia',  'LUTOPIA_MCP_URL'),
    ('garden',   'GARDEN_MCP_URL'),
    ('workkk',   'WORKKK_MCP_URL'),
    ('shopping', 'SHOPPING_MCP_URL'),
    ('xiuchao',  'XIUCHAO_MCP_URL'),
]:
    url = env.get(key, '')
    if url:
        add(name, url)
    else:
        print('  · MCP %s 跳过（没有 %s）' % (name, key))

cfg = {
    'main_chain': chain,
    'history_n': 24,
    'history_images': 2,
    'max_tool_steps': 8,
    'vision': 'auto',
    'persona_file': os.path.join(loop_dir, 'persona.md'),
    'attach_roots': [],
    'mcp_servers': mcp,
}
with open(cfg_path, 'w', encoding='utf-8') as f:
    json.dump(cfg, f, ensure_ascii=False, indent=2)
os.chmod(cfg_path, 0o600)
print('  ✓ %s（%d 个 MCP）' % (cfg_path, len(mcp)))
PY

# ── 6. persona ──
say "6/8  persona.md"
if [ -f "$LOOP_DIR/persona.md" ]; then
  warn "persona.md 已存在，不动"
else
  cat > "$LOOP_DIR/persona.md" <<'EOF'
# 允朔在网页这边的 system prompt

这一份还没填。没填之前他会回话，但不是他。

改完保存就生效，不用重启（api_loop 看 mtime）。

── 注意两件 ──

1. 允朔的记忆在 Ombre Brain 里，不在这个文件里。
   这儿写的是不变量：他是谁、怎么说话、和小满是什么关系。
   发生过的事靠检索拿回来。

2. 得写一句「提到过去先查记忆」。真机实测的结论是：
   光有检索工具，模型根本不会主动去查。工具挂上不等于他会用。
   记忆库的入口是 breath（睁眼看看记得什么）和 breath_search（按关键词找）。
EOF
  ok "建了占位：$LOOP_DIR/persona.md（这一项要你自己填）"
fi
mkdir -p "$LOOP_DIR/loop_cache"

# ── 7. systemd + 切 brain ──
say "7/8  起服务并切 brain"
cat > /etc/systemd/system/companion-api-loop.service <<EOF
[Unit]
Description=Vesper api_loop (companion body)
After=network.target companion-relay.service

[Service]
Type=simple
WorkingDirectory=$LOOP_DIR
EnvironmentFile=$LOOP_DIR/.env
ExecStart=$LOOP_DIR/venv/bin/python $LOOP_DIR/api_loop.py
Restart=always
RestartSec=3
TimeoutStopSec=10

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now companion-api-loop >/dev/null 2>&1 || true
systemctl restart companion-api-loop
sleep 3
systemctl is-active --quiet companion-api-loop \
  && ok "api_loop 起来了" \
  || warn "没起来：journalctl -u companion-api-loop -n 40 --no-pager"

# 单身体原则：relay 默认把消息投给 Claude Code channel，
# 而小满没有常开的电脑，那条路走不了。必须切到 loop。
BRAIN=$(curl -s --max-time 5 -X POST http://127.0.0.1:3011/app/brain \
  -H "Authorization: Bearer $SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"target":"loop"}' || echo '')
if echo "$BRAIN" | grep -q loop; then
  ok "brain 切到 loop（消息投给 api_loop）"
else
  warn "brain 没切成：${BRAIN:-没响应}"
fi

# ── 8. 验 ──
say "8/8  验"
printf '  api_loop healthz：'
curl -s --max-time 5 http://127.0.0.1:3020/healthz || echo '(没响应)'
echo
printf '  MCP 状态：'
curl -s --max-time 15 http://127.0.0.1:3020/loop/mcp \
  -H "Authorization: Bearer $SECRET" 2>/dev/null | head -c 700 || echo '(取不到)'
echo

cat <<EOF

  开晨暮星 /chat 里任意一个窗，输一句点发送，再点一下「让允朔回复」。

  ── 模型走的是晨暮星网关 ──

  api_loop → 127.0.0.1:3002 (gateway.js, model=chat) → 上游

  他在网页上说的话和在 Aru 里说的话落进同一本账。
  小酒馆状态、正在做的事、攒着的聊天都是网关自动注入的。

  ── 还差 persona ──

  $LOOP_DIR/persona.md 还是占位。没填之前他会回话，但不是他。
  改完保存即生效，不用重启。

  配置（有 key，权限 600）：$LOOP_DIR/api_loop.config.json
  改完：systemctl restart companion-api-loop
  看日志：journalctl -u companion-api-loop -f

EOF
