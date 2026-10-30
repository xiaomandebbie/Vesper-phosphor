#!/usr/bin/env bash
# /echo（不带结尾斜杠）补一条重定向。
#
# 小满 15:23 的截图：Cannot GET /echo。那是晨暮星（3001）的 Express 404：
# Caddy 里写的是 handle /echo/*，它不匹配光秃秃的 /echo，
# 于是请求落到末尾兔底的 reverse_proxy 127.0.0.1:3001 身上。
#
# Caddyfile 里晨暮星自己那几块用的是 /mcp-xxx/* 这种形式，没踩到这个坑，
# 是因为没人会在地址栈里手敲 MCP 端点。页面就不一样了。
#
# 跑法：
#   bash scripts/echo_slash_redir.sh
set -euo pipefail

CADDYFILE=/etc/caddy/Caddyfile
DOMAIN=vesperphosphor.online

ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "要 root"
[ -f "$CADDYFILE" ] || die "没有 $CADDYFILE"
grep -q 'handle /echo/\*' "$CADDYFILE" || die "Caddyfile 里没有 /echo/ 那块，先跑 wire_echo_caddy.sh"

BAK="$CADDYFILE.bak-slash-$(date +%s)"
cp -a "$CADDYFILE" "$BAK"
ok "备份 $BAK"

python3 - "$CADDYFILE" <<'PY'
import sys
path = sys.argv[1]
src = open(path, encoding='utf-8').read()

if 'redir /echo /echo/' in src:
    print('  ! 已经有这条重定向了，不动')
    sys.exit(0)

needle = '    handle /relay/* {'
if needle not in src:
    print('  ✗ 找不到 handle /relay/* 那块')
    sys.exit(1)

# 放在两块前面。redir 是立即返回 302，不会影响后面的 handle。
redir = ('    # 地址栈里敲 /echo 不带斜杠时，先跳到 /echo/。\n'
         '    # 不补这条就会落到末尾兔底的 3001（晨暮星）上，给个 Cannot GET /echo。\n'
         '    redir /echo /echo/\n\n')
src = src.replace(needle, redir + needle, 1)
open(path, 'w', encoding='utf-8').write(src)
print('  ✓ 插好了')
PY

if caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
  ok "validate 过了"
else
  warn "validate 没过，回滚"
  caddy validate --config "$CADDYFILE" 2>&1 | head -20 | sed 's/^/    /'
  cp -a "$BAK" "$CADDYFILE"
  die "已回滚"
fi

systemctl reload caddy 2>/dev/null || systemctl restart caddy
sleep 2
ok "caddy reload 了"

echo
printf '  /echo  状态码（期望 302）：'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://$DOMAIN/echo"
printf '  /echo/ 状态码（期望 200）：'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://$DOMAIN/echo/"
printf '  /relay/healthz：'
curl -s --max-time 8 "https://$DOMAIN/relay/healthz" || echo '(没响应)'
echo
printf '  晨暮星 /chat（期望 200 或 401）：'
curl -s -o /dev/null -w '%{http_code}\n' --max-time 8 "https://$DOMAIN/chat"
echo
echo "  回滚：cp -a $BAK $CADDYFILE && systemctl reload caddy"
echo
