#!/usr/bin/env bash
# 把 Tidal_Echo 接进 Caddy。
#
# 443 是 Caddy，不是 nginx——/etc/nginx 根本不存在，
# 而 Cannot GET /relay/healthz 是 Express 的 404，说明请求落到了
# 末尾兔底的 reverse_proxy 127.0.0.1:3001（晨暮星）身上。
#
# ── 为什么是 /echo/ 而不是 /chat/ ──
#
# /chat 已经被晨暮星占了（src/chat-page.js 里 PREFIX = '/chat'，
# 就是刚改完详情卡居中那一页）。再括一个 /chat/ 到 Caddy 上，
# 晨暮星那页就进不去了。所以 PWA 挂 /echo/。
#
# ── 这个脚本做什么 ──
#   1. 备份 Caddyfile
#   2. 在末尾 handle { 兔底前插两块：/relay/* 转 3011、/echo/* 发静态文件
#   3. relay.env 里 RELAY_APP_PATH 改成 /echo/（推送点开时跳这儿）
#   4. caddy validate 过了再 reload，没过就回滚
#   5. 验两条
#
# 重跑安全：已经插过就不再插。
#
# 跑法：
#   bash scripts/wire_echo_caddy.sh
set -euo pipefail

CADDYFILE=/etc/caddy/Caddyfile
RELAY_DIR=/root/companion-relay
WEB_DIR=/var/www/companion-web
DOMAIN=vesperphosphor.online

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要 root"
[ -f "$CADDYFILE" ] || die "没有 $CADDYFILE"
[ -f "$WEB_DIR/index.html" ] || die "壳子不在 $WEB_DIR，先跑 install_echo.sh"

# ── 1. 备份 ──
say "1/5  备份 Caddyfile"
BAK="$CADDYFILE.bak-echo-$(date +%s)"
cp -a "$CADDYFILE" "$BAK"
ok "$BAK"

# ── 2. 插两块 ──
say "2/5  插 /relay/ 和 /echo/"
python3 - "$CADDYFILE" "$WEB_DIR" <<'PY'
import re, sys
path, web = sys.argv[1], sys.argv[2]
src = open(path, encoding='utf-8').read()

if '/mcp-echo' in src or 'companion-web' in src:
    print('  ! 已经插过了，不动')
    sys.exit(0)

block = '''    # Tidal_Echo（跳允朔的聊天 PWA）。两块：
    #   /relay/*  → relay 后端 3011（落库 + SSE 扇出）
    #   /echo/*   → PWA 静态文件
    # 为什么不用 /chat/：那个被晨暮星占了（chat-page.js）。
    # 这两块不在这层验 token——relay 自己有 RELAY_SECRET，
    # 而浏览器的 EventSource 设不了请求头，SSE 是用 ?token= 过的。
    handle /relay/* {
        uri strip_prefix /relay
        reverse_proxy 127.0.0.1:3011
    }

    handle /echo/* {
        uri strip_prefix /echo
        root * WEBDIR
        file_server
    }

'''.replace('WEBDIR', web)

# 插在主域名那个末尾兔底前面。Caddy 的 handle 是按路径特指度排，
# 但写在前面更看得清哪些路径被单独接走了。
m = re.search(r'\n(    handle \{\n        reverse_proxy 127\.0\.0\.1:3001\n    \}\n)', src)
if not m:
    print('  ✗ 找不到末尾那个 handle { reverse_proxy 127.0.0.1:3001 }')
    print('    自己把下面这段贴进 vesperphosphor.online 块里，放在那个兔底 handle 前面：')
    print(block)
    sys.exit(1)

src = src[:m.start(1)] + block + src[m.start(1):]
open(path, 'w', encoding='utf-8').write(src)
print('  ✓ 插在兔底 handle 前面了')
PY

# ── 3. relay.env ──
say "3/5  relay.env 的 RELAY_APP_PATH"
if [ -f "$RELAY_DIR/relay.env" ]; then
  cp -a "$RELAY_DIR/relay.env" "$RELAY_DIR/relay.env.bak-echo-$(date +%s)"
  sed -i 's#^RELAY_APP_PATH=.*#RELAY_APP_PATH=/echo/#' "$RELAY_DIR/relay.env"
  ok "改成 /echo/（推送点开时跳这儿）"
else
  warn "没有 relay.env，跳过"
fi

# ── 4. validate + reload ──
say "4/5  校配置并 reload"
if caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
  ok "caddy validate 过了"
else
  warn "validate 没过，回滚到 $BAK"
  caddy validate --config "$CADDYFILE" 2>&1 | head -20 | sed 's/^/    /'
  cp -a "$BAK" "$CADDYFILE"
  die "已回滚，Caddyfile 没被改坏"
fi

systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
systemctl is-active --quiet caddy && ok "caddy 活着" || warn "caddy 没起来：journalctl -u caddy -n 30 --no-pager"

systemctl restart companion-relay
sleep 1
systemctl is-active --quiet companion-relay && ok "relay 活着" || warn "relay 没起来"

# ── 5. 验 ──
say "5/5  验"
printf '  本机 3011：'
curl -s --max-time 5 http://127.0.0.1:3011/healthz || echo '(没响应)'
echo
printf '  走 Caddy /relay/healthz：'
curl -s --max-time 8 "https://$DOMAIN/relay/healthz" || echo '(没响应)'
echo
printf '  走 Caddy /echo/ 状态码：'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://$DOMAIN/echo/"
printf '  晨暮星 /chat 还在不（应该是 200 或 401）：'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://$DOMAIN/chat"

cat <<EOF

  手机开：https://$DOMAIN/echo/

  连接密钥（登录页填这个）：
EOF
grep -m1 '^RELAY_SECRET=' "$RELAY_DIR/relay.env" | cut -d= -f2- | sed 's/^/    /'
cat <<EOF

  进去能看见壳子、能发消息，但允朔还不会回——身体（api_loop）第二步再装。
  回滚：cp -a $BAK $CADDYFILE && systemctl reload caddy

EOF
