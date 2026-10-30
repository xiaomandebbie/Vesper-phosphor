#!/usr/bin/env bash
# Tidal_Echo 第一步：把 relay 后端和 PWA 壳子装起来。
#
# 小满 2026-10-30：「外观可以先按简约风格或者他们有的风格来 以后再弄美化」
# 所以这一步不动样式，用它自带的。
#
# ── 这个脚本做什么 ──
#   1. 检端口（3011 relay、3020 api_loop）没被占
#   2. 拉 Tidal_Echo 到 /root/tidal-echo
#   3. 装 relay：venv + 依赖 + 生成 RELAY_SECRET + systemd
#   4. 发 PWA 到 /var/www/companion-web，把名字填成允朔 / 小满
#   5. 把要贴进 nginx 的那段打印出来
#
# ── 它不做什么 ──
#   不改 nginx。你那台机器上晨暮星、台灯、音乐都在走 nginx，
#   脚本自己改配置文件风险太大——打印出来你自己贴。
#   不装 api_loop（允朔的身体）。先让 relay 和壳子跑通，第二步再接身体和 MCP。
#   不写任何模型密钥。模型 / 人格 / MCP 都在 PWA 设置页里填。
#
# ── 怎么跑 ──
#   bash scripts/install_echo.sh <你的域名>
#
# 重跑安全：已存在的 relay.env 不会被覆盖（密钥不会被换掉）。
#
# 注：这个文件里一律直接写中文，不用 \u 转义——bash 的 printf 不认它，
# Python 的 re.sub 替换串更不认（会报 bad escape \u）。第一版就是这么炸的。
set -euo pipefail

DOMAIN="${1:-}"
ECHO_SRC=/root/tidal-echo
RELAY_DIR=/root/companion-relay
WEB_DIR=/var/www/companion-web
PROXY=https://gh-proxy.com/https://github.com/xiaomandebbie/Tidal_Echo.git
PIP_MIRROR=https://pypi.tuna.tsinghua.edu.cn/simple

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要 root"
[ -n "$DOMAIN" ] || die "把域名当参数传给我：bash scripts/install_echo.sh <你的域名>"
command -v python3 >/dev/null || die "没有 python3"
command -v git     >/dev/null || die "没有 git"

# ── 1. 端口 ──
say "1/5  看端口"
for p in 3011 3020; do
  if ss -ltn 2>/dev/null | grep -q ":${p} "; then
    # relay 自己已经在 3011 上跑着，是重跑，不算冲突
    if [ "$p" = 3011 ] && systemctl is-active --quiet companion-relay 2>/dev/null; then
      ok "3011 是 companion-relay 自己（重跑）"
      continue
    fi
    warn "${p} 已被占：$(ss -ltnp 2>/dev/null | grep ":${p} " | head -1)"
    die "换个端口或先停掉占用的进程。改端口要同步改 relay.env 和 nginx。"
  fi
  ok "${p} 空着"
done

# ── 2. 拉源码 ──
say "2/5  拉 Tidal_Echo"
if [ -d "$ECHO_SRC/.git" ]; then
  git -C "$ECHO_SRC" pull --ff-only "$PROXY" main >/dev/null 2>&1 \
    && ok "更新了 $ECHO_SRC" \
    || warn "pull 没成，用本地已有的"
else
  git clone --depth 1 "$PROXY" "$ECHO_SRC" >/dev/null 2>&1 || die "clone 失败"
  ok "拉到 $ECHO_SRC"
fi

# ── 3. relay 后端 ──
say "3/5  装 relay（端口 3011）"
mkdir -p "$RELAY_DIR/uploads"
cp "$ECHO_SRC/backend/app.py" "$ECHO_SRC/backend/requirements.txt" "$RELAY_DIR/"
ok "拷了 app.py"

if [ ! -x "$RELAY_DIR/venv/bin/python" ]; then
  python3 -m venv "$RELAY_DIR/venv" || die "建 venv 失败（可能要装 python3-venv）"
fi
"$RELAY_DIR/venv/bin/pip" install -q -i "$PIP_MIRROR" -r "$RELAY_DIR/requirements.txt" \
  || die "装依赖失败"
ok "依赖齐了"

if [ -f "$RELAY_DIR/relay.env" ]; then
  warn "relay.env 已存在，不动它（密钥保留）"
  SECRET=$(grep -m1 '^RELAY_SECRET=' "$RELAY_DIR/relay.env" | cut -d= -f2-)
else
  SECRET=$("$RELAY_DIR/venv/bin/python" -c 'import secrets;print(secrets.token_urlsafe(32))')
  cat > "$RELAY_DIR/relay.env" <<EOF
# Tidal_Echo relay。这把密钥就是唯一的门，别外流。
RELAY_SECRET=$SECRET
RELAY_AI_NAME=允朔
RELAY_HUMAN_NAME=小满
RELAY_PORT=3011
RELAY_DB=$RELAY_DIR/relay.db
RELAY_UPLOAD_DIR=$RELAY_DIR/uploads
RELAY_PUBLIC_PREFIX=/relay
RELAY_APP_PATH=/chat/
RELAY_ALLOW_ORIGINS=https://$DOMAIN
# 允朔的身体跑在 3020（第二步再装）。切过去：
#   curl -s -X POST http://127.0.0.1:3011/app/brain -H "Authorization: Bearer \$RELAY_SECRET" \\
#     -H 'Content-Type: application/json' -d '{"target":"loop"}'
RELAY_BRAIN_FILE=$RELAY_DIR/brain_target
RELAY_LOOP_INGEST_URL=http://127.0.0.1:3020/loop/ingest
RELAY_MAX_UPLOAD_BYTES=10485760
RELAY_VOICE_MAX_BYTES=8388608
# 语音和锁屏推送：留空 = 关着，不影响聊天。唤醒桥要用推送，第二步再填。
MINIMAX_API_KEY=
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_PEM=$RELAY_DIR/private_key.pem
VAPID_SUBJECT=mailto:admin@$DOMAIN
RELAY_PRESENCE_ONLINE_SEC=180
RELAY_PRESENCE_RECENT_SEC=1800
EOF
  ok "生成了 relay.env（含新密钥）"
fi
chmod 600 "$RELAY_DIR/relay.env"

cat > /etc/systemd/system/companion-relay.service <<EOF
[Unit]
Description=Tidal_Echo relay
After=network.target

[Service]
Type=simple
WorkingDirectory=$RELAY_DIR
EnvironmentFile=$RELAY_DIR/relay.env
ExecStart=$RELAY_DIR/venv/bin/python -m uvicorn app:app --host 127.0.0.1 --port 3011
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now companion-relay >/dev/null 2>&1 || true
systemctl restart companion-relay
sleep 2
if systemctl is-active --quiet companion-relay; then
  ok "relay 起来了"
else
  warn "relay 没起来，看：journalctl -u companion-relay -n 30 --no-pager"
fi

if curl -fsS --max-time 5 http://127.0.0.1:3011/healthz >/dev/null 2>&1; then
  ok "本机 healthz 通了"
else
  warn "本机 healthz 没通（上面的日志命令能看原因）"
fi

# ── 4. PWA 壳子 ──
say "4/5  发 PWA 壳子"
mkdir -p "$WEB_DIR"
cp -r "$ECHO_SRC/web/." "$WEB_DIR/"
"$RELAY_DIR/venv/bin/python" - "$WEB_DIR/index.html" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
# 只改 CONFIG 里的四个名字。样式不动——小满说先用自带的。
# SINCE 留空：不知道起点日期，空字符串会把那一行隐掉。
# 替换串用 lambda，不用 '\\1"…"' 模板——免得又踩 re 的转义规则。
subs = [
    (r'(APP_NAME:\s*)"[^"]*"',   '允朔'),
    (r'(AI_NAME:\s*)"[^"]*"',    '允朔'),
    (r'(HUMAN_NAME:\s*)"[^"]*"', '小满'),
    (r'(SINCE:\s*)"[^"]*"',      ''),
]
missed = []
for pat, val in subs:
    src, n = re.subn(pat, lambda m, v=val: m.group(1) + '"' + v + '"', src, count=1)
    if not n:
        missed.append(pat.split('(')[1].split(':')[0])
open(path, 'w', encoding='utf-8').write(src)
if missed:
    print('  ! 这几项没找到，自己改 index.html 顶上的 CONFIG：' + ', '.join(missed))
else:
    print('  ✓ 填好名字（允朔 / 小满）')
PY
chown -R nginx:nginx "$WEB_DIR" 2>/dev/null || chown -R www-data:www-data "$WEB_DIR" 2>/dev/null || true
ok "放在 $WEB_DIR"

# ── 5. nginx 要贴的那段 ──
say "5/5  nginx（这一步要你自己做）"
CONF=$(grep -rl "$DOMAIN" /etc/nginx 2>/dev/null | head -1 || true)
if [ -n "$CONF" ]; then
  ok "你的站配置大概在：$CONF"
  grep -qE 'location\s+/(relay|chat)/' "$CONF" 2>/dev/null \
    && warn "里面已经有 /relay/ 或 /chat/ 了，先看清别撞车"
else
  warn "没在 /etc/nginx 里找到 $DOMAIN，自己找那个 443 server 块"
fi

cat <<EOF

  把下面这段贴进 443 server 块，然后 nginx -t && systemctl reload nginx：

    location /relay/ {
        client_max_body_size 10m;
        proxy_pass http://127.0.0.1:3011/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        chunked_transfer_encoding off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
    location = /chat { return 301 /chat/; }
    location /chat/ {
        alias $WEB_DIR/;
        index index.html;
    }
    location = /chat/manifest.webmanifest {
        alias $WEB_DIR/manifest.webmanifest;
        default_type application/manifest+json;
    }

  贴完验这两条：
    curl -s https://$DOMAIN/relay/healthz        # 期望 {"ok":true,...}
    手机浏览器开 https://$DOMAIN/chat/            # 登录页

  登录页的「连接密钥」就是：
    $SECRET

  这把密钥是唯一的门。别贴进公开仓库。丢了在 $RELAY_DIR/relay.env 里读。

  下一步（现在还没做）：允朔的身体 api_loop。现在进去能看见壳子、能发消息，
  但没人接，所以不会回。

EOF
