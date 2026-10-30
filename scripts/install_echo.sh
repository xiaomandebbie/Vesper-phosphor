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
#   不改 nginx。你那台机器上晨暮星、台灯、音乐都在跳 nginx，
#   脚本自己改配置文件风险太大——打印出来你自己贴。
#   不装 api_loop（允朔的身体）。先让 relay 和壳子跑通，第二步再接身体和 MCP。
#   不写任何模型密钥。模型 / 人格 / MCP 都在 PWA 设置页里填。
#
# ── 怎么跑 ──
#   bash scripts/install_echo.sh <你的域名>
#   例如：bash scripts/install_echo.sh vesper.example.com
#
# 重跑安全：已存在的 relay.env 不会被覆盖（密钥不会被换掉）。
set -euo pipefail

DOMAIN="${1:-}"
ECHO_SRC=/root/tidal-echo
RELAY_DIR=/root/companion-relay
WEB_DIR=/var/www/companion-web
PROXY=https://gh-proxy.com/https://github.com/xiaomandebbie/Tidal_Echo.git
PIP_MIRROR=https://pypi.tuna.tsinghua.edu.cn/simple

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m\u2713\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m\u2717 %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "\u8981 root"
[ -n "$DOMAIN" ] || die "\u628a\u57df\u540d\u5f53\u53c2\u6570\u4f20\u7ed9\u6211\uff1abash scripts/install_echo.sh <\u4f60\u7684\u57df\u540d>"
command -v python3 >/dev/null || die "\u6ca1\u6709 python3"
command -v git     >/dev/null || die "\u6ca1\u6709 git"

# ── 1. 端口 ──
say "1/5  \u770b\u7aef\u53e3"
for p in 3011 3020; do
  if ss -ltn 2>/dev/null | grep -q ":${p} "; then
    warn "${p} \u5df2\u88ab\u5360\uff1a$(ss -ltnp 2>/dev/null | grep ":${p} " | head -1)"
    die "\u6362\u4e2a\u7aef\u53e3\u6216\u5148\u505c\u6389\u5360\u7528\u7684\u8fdb\u7a0b\u3002\u6539\u7aef\u53e3\u8981\u540c\u6b65\u6539 relay.env \u548c nginx\u3002"
  fi
  ok "${p} \u7a7a\u7740"
done

# ── 2. 拉源码 ──
say "2/5  \u62c9 Tidal_Echo"
if [ -d "$ECHO_SRC/.git" ]; then
  git -C "$ECHO_SRC" pull --ff-only "$PROXY" main >/dev/null 2>&1 \
    && ok "\u66f4\u65b0\u4e86 $ECHO_SRC" \
    || warn "pull \u6ca1\u6210\uff0c\u7528\u672c\u5730\u5df2\u6709\u7684"
else
  git clone --depth 1 "$PROXY" "$ECHO_SRC" >/dev/null 2>&1 || die "clone \u5931\u8d25"
  ok "\u62c9\u5230 $ECHO_SRC"
fi

# ── 3. relay 后端 ──
say "3/5  \u88c5 relay\uff08\u7aef\u53e3 3011\uff09"
mkdir -p "$RELAY_DIR/uploads"
cp "$ECHO_SRC/backend/app.py" "$ECHO_SRC/backend/requirements.txt" "$RELAY_DIR/"
ok "\u62f7\u4e86 app.py"

if [ ! -x "$RELAY_DIR/venv/bin/python" ]; then
  python3 -m venv "$RELAY_DIR/venv" || die "\u5efa venv \u5931\u8d25\uff08\u53ef\u80fd\u8981\u88c5 python3-venv\uff09"
fi
"$RELAY_DIR/venv/bin/pip" install -q -i "$PIP_MIRROR" -r "$RELAY_DIR/requirements.txt" \
  || die "\u88c5\u4f9d\u8d56\u5931\u8d25"
ok "\u4f9d\u8d56\u9f50\u4e86"

if [ -f "$RELAY_DIR/relay.env" ]; then
  warn "relay.env \u5df2\u5b58\u5728\uff0c\u4e0d\u52a8\u5b83\uff08\u5bc6\u94a5\u4fdd\u7559\uff09"
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
  ok "\u751f\u6210\u4e86 relay.env\uff08\u542b\u65b0\u5bc6\u94a5\uff09"
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
  ok "relay \u8d77\u6765\u4e86"
else
  warn "relay \u6ca1\u8d77\u6765\uff0c\u770b\uff1ajournalctl -u companion-relay -n 30 --no-pager"
fi

if curl -fsS --max-time 5 http://127.0.0.1:3011/healthz >/dev/null 2>&1; then
  ok "\u672c\u673a healthz \u901a\u4e86"
else
  warn "\u672c\u673a healthz \u6ca1\u901a\uff08\u4e0a\u9762\u7684\u65e5\u5fd7\u547d\u4ee4\u80fd\u770b\u539f\u56e0\uff09"
fi

# ── 4. PWA 壳子 ──
say "4/5  \u53d1 PWA \u58f3\u5b50"
mkdir -p "$WEB_DIR"
cp -r "$ECHO_SRC/web/." "$WEB_DIR/"
"$RELAY_DIR/venv/bin/python" - "$WEB_DIR/index.html" <<'PY'
import re, sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()
# 只改 CONFIG 里的四个名字。样式不动——小满说先用自带的。
# SINCE 留空：不知道起点日期，空字串会把那一行隐掉。
subs = [
    (r'(APP_NAME:\s*)"[^"]*"',   r'\1"\u5141\u6714"'),
    (r'(AI_NAME:\s*)"[^"]*"',    r'\1"\u5141\u6714"'),
    (r'(HUMAN_NAME:\s*)"[^"]*"', r'\1"\u5c0f\u6ee1"'),
    (r'(SINCE:\s*)"[^"]*"',      r'\1""'),
]
missed = []
for pat, rep in subs:
    src, n = re.subn(pat, rep, src, count=1)
    if not n:
        missed.append(pat.split('(')[1].split(':')[0])
open(path, 'w', encoding='utf-8').write(src)
print('  \u2713 \u586b\u597d\u540d\u5b57\uff08\u5141\u6714 / \u5c0f\u6ee1\uff09' if not missed
      else '  ! \u8fd9\u51e0\u9879\u6ca1\u627e\u5230\uff0c\u81ea\u5df1\u6539 index.html \u9876\u4e0a\u7684 CONFIG\uff1a' + ', '.join(missed))
PY
chown -R nginx:nginx "$WEB_DIR" 2>/dev/null || chown -R www-data:www-data "$WEB_DIR" 2>/dev/null || true
ok "\u653e\u5728 $WEB_DIR"

# ── 5. nginx 要贴的那段 ──
say "5/5  nginx\uff08\u8fd9\u4e00\u6b65\u8981\u4f60\u81ea\u5df1\u505a\uff09"
CONF=$(grep -rl "$DOMAIN" /etc/nginx 2>/dev/null | head -1 || true)
if [ -n "$CONF" ]; then
  ok "\u4f60\u7684\u7ad9\u914d\u7f6e\u5927\u6982\u5728\uff1a$CONF"
  grep -qE 'location\s+/(relay|chat)/' "$CONF" 2>/dev/null \
    && warn "\u91cc\u9762\u5df2\u7ecf\u6709 /relay/ \u6216 /chat/ \u4e86\uff0c\u5148\u770b\u6e05\u522b\u649e\u8f66"
else
  warn "\u6ca1\u5728 /etc/nginx \u91cc\u627e\u5230 $DOMAIN\uff0c\u81ea\u5df1\u627e\u90a3\u4e2a 443 server \u5757"
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
    手机浏览器开 https://$DOMAIN/chat/        # 登录页

  登录页的「连接密钥」就是：
    $SECRET

  这把密钥是唯一的门。别贴进公开仓库。丢了在 $RELAY_DIR/relay.env 里读。

  下一步（现在还没做）：允朔的身体 api_loop。现在进去能看见壳子、能发消息，
  但没人接，所以不会回。

EOF
