#!/usr/bin/env bash
# 把晨暮星的跨窗口聊天记录导成 Latent 的语料。
#
# 小满 2026-10-30 22:45：选了第二条——先喂语料。
#
# ── 为什么要语料 ──
#
# 十二节里八节只有 leave_empty 一个版本，因为节内容只认两个来源：
# 语料提取和原人格文件编译。问卷答案不是其中之一——它们存在
# init_state.json 的 answers 里，但进不了节。所以没语料就是空壳。
#
# ── 语料从哪来 ──
#
# Ombre 是 MCP，没有导出接口，里面的记忆取不出来。
# 但晨暮星的 gateway 一直在记 conversation_log（见 context.js）：
# 每条消息追加一行、不分窗口、不被覆盖。整理时旧记录搬进
# conversation_archive，原话还在。两张表一起导——这是真语料。
#
# ── 导成什么格式 ──
#
# ship --import 认「ChatGPT/Claude json、聊天 txt、timeline md」。
# 聊天 txt 最稳：memory_import 认得出「[时间] 说话人: 内容」这种行。
# 按天分文件：那是 timeline 的形状，而且出问题时好定位是哪一天。
#
# ── 这一步不出货 ──
#
# 只导文件、数一下、把前几行打出来。extract 和 ship 下一步再跑——
# 先看清导出来的东西对不对。
#
# 重跑安全：会先清空语料目录再重导。
set -euo pipefail

DB=/root/vesper-phosphor/data/state.db
CORPUS=/root/latent-data/corpus

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m\u2713\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m\u2717 %s\033[0m\n' "$*" >&2; exit 1; }

[ -f "$DB" ] || die "没找到 $DB"
command -v sqlite3 >/dev/null || die "没有 sqlite3"

# ── 1. 先数数有多少 ──
say "1/4  库里有多少"
sqlite3 "$DB" "select '活跃表 ' || count(*) from conversation_log;" | sed 's/^/  /'
sqlite3 "$DB" "select '归档表 ' || count(*) from conversation_archive;" 2>/dev/null | sed 's/^/  /' \
  || warn "没有归档表（没整理过，正常）"
sqlite3 "$DB" "select '最早 ' || datetime(min(ts)/1000,'unixepoch','+8 hours') from conversation_log;" | sed 's/^/  /'
sqlite3 "$DB" "select '最新 ' || datetime(max(ts)/1000,'unixepoch','+8 hours') from conversation_log;" | sed 's/^/  /'

# ── 2. 导出 ──
say "2/4  按天导成 txt"
rm -rf "$CORPUS"
mkdir -p "$CORPUS"

# 两张表 union，按时间正序。注意：archive 表可能不存在，所以分两步。
TSV=/tmp/latent-corpus.tsv
sqlite3 -separator $'\t' "$DB" \
  "select ts, ifnull(speaker,'?'), replace(replace(ifnull(content,''), char(10), ' '), char(13), ' ')
   from conversation_log order by ts asc;" > "$TSV"

if sqlite3 "$DB" "select 1 from conversation_archive limit 1;" >/dev/null 2>&1; then
  sqlite3 -separator $'\t' "$DB" \
    "select ts, ifnull(speaker,'?'), replace(replace(ifnull(content,''), char(10), ' '), char(13), ' ')
     from conversation_archive order by ts asc;" >> "$TSV"
  ok "归档表也导了"
fi

# 按天切文件。排序用 sort -n：两张表追加之后顺序是乱的
python3 - "$TSV" "$CORPUS" <<'PY'
import sys, os, datetime

tsv, out = sys.argv[1], sys.argv[2]
rows = []
with open(tsv, encoding='utf-8', errors='replace') as f:
    for line in f:
        parts = line.rstrip('\n').split('\t')
        if len(parts) < 3:
            continue
        try:
            ts = int(parts[0])
        except ValueError:
            continue
        who, text = parts[1], '\t'.join(parts[2:]).strip()
        if not text:
            continue
        rows.append((ts, who, text))

rows.sort(key=lambda r: r[0])

# 去重：同一秒、同一人、同一句——两张表可能有重叠
seen = set()
uniq = []
for ts, who, text in rows:
    k = (ts // 1000, who, text[:80])
    if k in seen:
        continue
    seen.add(k)
    uniq.append((ts, who, text))

TZ = datetime.timezone(datetime.timedelta(hours=8))
byday = {}
for ts, who, text in uniq:
    d = datetime.datetime.fromtimestamp(ts / 1000, TZ)
    byday.setdefault(d.strftime('%Y-%m-%d'), []).append((d, who, text))

for day, items in sorted(byday.items()):
    path = os.path.join(out, day + '.txt')
    with open(path, 'w', encoding='utf-8') as f:
        for d, who, text in items:
            f.write('[%s] %s: %s\n' % (d.strftime('%Y-%m-%d %H:%M'), who, text))

print('  \u2713 %d 条消息，%d 天，去重掉 %d 条'
      % (len(uniq), len(byday), len(rows) - len(uniq)))
PY

rm -f "$TSV"
chmod 700 "$CORPUS"
ok "语料在 $CORPUS"

# ── 3. 看一眼 ──
say "3/4  看一眼导出来的东西"
echo "  文件数：$(ls -1 "$CORPUS" | wc -l)"
echo "  总大小：$(du -sh "$CORPUS" | cut -f1)"
echo
echo '  最早那天的开头：'
head -4 "$(ls "$CORPUS"/*.txt | head -1)" | sed 's/^/    /'
echo
echo '  最近那天的结尾：'
tail -4 "$(ls "$CORPUS"/*.txt | tail -1)" | sed 's/^/    /'

# ── 4. 说话人名字 ──
say "4/4  语料里的说话人"
sqlite3 "$DB" "select ifnull(speaker,'?') || '  ' || count(*) from conversation_log group by speaker order by count(*) desc;" | sed 's/^/  /'

cat <<EOF

  ── 下一步 ──

  语料有了，但 extract 要 --candidates——它不自己读语料然后提取，
  是把语料给一个模型、由那个模型返回候选 JSON。所以要先跑：

    cd /root/latent && python3 src/memory_init.py --out /root/latent-data \\
      --corpus $CORPUS --step extract 2>&1 | tail -40

  它会把要问模型的东西打出来（或者直接说候选该长什么样）。
  把那段发我，我读语料、按它要的格式给出候选——这一步本来就是
  该模型干的活，而我就是那个模型。

  导出来的语料里有你们真正的对话，所以那五类里程碑（第一次确认关系、
  「他记得我」、约定、拒绝过、承认过局限）能从里面长出来。

EOF
