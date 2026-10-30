#!/usr/bin/env bash
# 修第一版 install_echo.sh 留下的坑，并查「没有登录页面」到底卡在哪。
#
# 小满 2026-10-30 14:49 的截图里：
#   curl -s https://https://vesperphosphor.online/relay/healthz
# 域名传成了带 https:// 的形式，脚本又拼了一次，于是打到一个不存在的主机上。
# 同一个值还被写进了 relay.env 的 RELAY_ALLOW_ORIGINS —— 那个会让浏览器
# 的请求被 CORS 挡掉，是真问题，不只是显示难看。
#
# 这个脚本：
#   1. 把 relay.env 里的 https://https:// 收成 https://
#   2. 把 RELAY_ALLOW_ORIGINS 校正成 https://<域名>
#   3. 重启 relay
#   4. 逐项查登录页打不开的原因（文件在不在、nginx 贴没贴、本机通不通）
#
# 跑法（域名带不带 https:// 都认）：
#   bash scripts/fix_echo_domain.sh vesperphosphor.online
set -euo pipefail

RELAY_DIR=/root/companion-relay
WEB_DIR=/var/www/companion-web

DOMAIN="${1:-vesperphosphor.online}"
# 容错：去掉 scheme 和结尾斜杠。第一版就是少了这三行。
DOMAIN="${DOMAIN#http://}"
DOMAIN="${DOMAIN#https://}"
DOMAIN="${DOMAIN%%/*}"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }

[ "$(id -u)" = 0 ] || { echo "要 root"; exit 1; }
ok "域名认成：$DOMAIN"

# ── 1. 修 relay.env ──
say "1/4  修 relay.env"
if [ ! -f "$RELAY_DIR/relay.env" ]; then
  warn "没有 $RELAY_DIR/relay.env —— 先跑 install_echo.sh"
  exit 1
fi
cp -a "$RELAY_DIR/relay.env" "$RELAY_DIR/relay.env.bak.$(date +%s)"

if grep -q 'https://https://' "$RELAY_DIR/relay.env"; then
  sed -i 's#https://https://#https://#g' "$RELAY_DIR/relay.env"
  ok "收掉了重复的 https://"
else
  ok "没有重复的 https://"
fi

if grep -q "^RELAY_ALLOW_ORIGINS=https://${DOMAIN}$" "$RELAY_DIR/relay.env"; then
  ok "RELAY_ALLOW_ORIGINS 已经对了"
else
  sed -i "s#^RELAY_ALLOW_ORIGINS=.*#RELAY_ALLOW_ORIGINS=https://${DOMAIN}#" "$RELAY_DIR/relay.env"
  ok "RELAY_ALLOW_ORIGINS 改成 https://${DOMAIN}"
fi
chmod 600 "$RELAY_DIR/relay.env"
grep -E '^(RELAY_ALLOW_ORIGINS|RELAY_APP_PATH|RELAY_PUBLIC_PREFIX|VAPID_SUBJECT)=' \
  "$RELAY_DIR/relay.env" | sed 's/^/    /'

# ── 2. 重启 ──
say "2/4  重启 relay"
systemctl restart companion-relay
sleep 2
systemctl is-active --quiet companion-relay \
  && ok "relay 活着" \
  || warn "relay 没起来：journalctl -u companion-relay -n 30 --no-pager"

curl -fsS --max-time 5 http://127.0.0.1:3011/healthz >/dev/null 2>&1 \
  && ok "本机 3011 healthz 通" \
  || warn "本机 3011 healthz 不通"

# ── 3. 登录页为何打不开 ──
say "3/4  查登录页"
if [ -f "$WEB_DIR/index.html" ]; then
  ok "壳子文件在：$WEB_DIR/index.html"
  grep -oE '(APP_NAME|AI_NAME|HUMAN_NAME|SINCE):\s*"[^"]*"' "$WEB_DIR/index.html" \
    | head -4 | sed 's/^/    /'
else
  warn "$WEB_DIR/index.html 不存在 —— 第 4 步发壳子那次炸了，重跑 install_echo.sh"
fi

NGINX_HIT=$(grep -rl 'companion-web' /etc/nginx 2>/dev/null | head -1 || true)
if [ -n "$NGINX_HIT" ]; then
  ok "nginx 里已经有 /chat/ 那段：$NGINX_HIT"
else
  warn "nginx 里没找到 companion-web —— 登录页打不开就是因为这段还没贴"
  CONF=$(grep -rl "$DOMAIN" /etc/nginx 2>/dev/null | head -1 || true)
  [ -n "$CONF" ] && warn "你的站配置大概在：$CONF"
fi

# ── 4. 正确的验证命令 ──
say "4/4  用这两条验（域名已经是对的了）"
cat <<EOF
    curl -s https://${DOMAIN}/relay/healthz
    手机开 https://${DOMAIN}/chat/

EOF
printf '  本机直连 relay 的结果：'
curl -s --max-time 5 http://127.0.0.1:3011/healthz || echo '(没响应)'
echo
printf '  走 nginx 的结果：'
curl -s --max-time 8 "https://${DOMAIN}/relay/healthz" || echo '(没响应 —— nginx 那段没贴或没 reload)'
echo

echo
echo "  连接密钥："
grep -m1 '^RELAY_SECRET=' "$RELAY_DIR/relay.env" | cut -d= -f2- | sed 's/^/    /'
echo
