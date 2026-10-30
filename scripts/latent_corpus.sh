#!/usr/bin/env bash
# 把晨暮星的跨窗口聊天记录导成 Latent 的语料。
#
# ── 为什么要语料 ──
#
# 十二节里八节只有 leave_empty 一个版本，因为节内容只认两个来源：
# 语料提取和原人格文件编译。问卷答案不是其中之一。
#
# ── 语料从哪来 ──
#
# Ombre 是 MCP，没有导出接口。但 gateway 一直在记 conversation_log：
# 每条消息追加一行、不分窗口。整理时旧记录搬进 conversation_archive。
# 两张表一起导。
#
# ── 两张表的说话人字段不一样（实测）──
#
# 归档表记 user / assistant，活跃表记 user / 允朔。不归一的话
# extract 会把「允朔」和「assistant」当成两个人。统一成 小满 / 允朔。
#
# ── 注入要滤掉 ──
#
# recordUserMessage 把「[Aru 内部 · 不会展示给对方]」这类系统注入
# 也当成小满的话记了下来。那是写给允朔的指令，不是她说的；留着的话
# 「对方是谁」那节会从这些指令里长出她的形象。
# 允朔对注入写的那段内心状态保留——那确实是他自己的话。
#
# ── 时间范围要两张表一起算 ──
#
# 只数 conversation_log 的 min(ts) 会报成 10-29，而语料实际从 10-09 开始。
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

HAS_ARCHIVE=0
if sqlite3 "$DB" "select 1 from conversation_archive limit 1;" >/dev/null 2>&1; then
  HAS_ARCHIVE=1
fi

say "1/4  库里有多少"
sqlite3 "$DB" "select '活跃表 ' || count(*) from conversation_log;" | sed 's/^/  /'
if [ "$HAS_ARCHIVE" = 1 ]; then
  sqlite3 "$DB" "select '归档表 ' || count(*) from conversation_archive;" | sed 's/^/  /'
  sqlite3 "$DB" "select '最早 ' || datetime(min(ts)/1000,'unixepoch','+8 hours') from (select ts from conversation_log union all select ts from conversation_archive);" | sed 's/^/  /'
  sqlite3 "$DB" "select '最新 ' || datetime(max(ts)/1000,'unixepoch','+8 hours') from (select ts from conversation_log union all select ts from conversation_archive);" | sed 's/^/  /'
else
  warn "没有归档表（没整理过，正常）"
  sqlite3 "$DB" "select '最早 ' || datetime(min(ts)/1000,'unixepoch','+8 hours') from conversation_log;" | sed 's/^/  /'
  sqlite3 "$DB" "select '最新 ' || datetime(max(ts)/1000,'unixepoch','+8 hours') from conversation_log;" | sed 's/^/  /'
fi

say "2/4  按天导成 txt"
rm -rf "$CORPUS"
mkdir -p "$CORPUS"

TSV=/tmp/latent-corpus.tsv
sqlite3 -separator $'\t' "$DB" \
  "select ts, ifnull(speaker,'?'), replace(replace(ifnull(content,''), char(10), ' '), char(13), ' ') from conversation_log order by ts asc;" > "$TSV"

if [ "$HAS_ARCHIVE" = 1 ]; then
  sqlite3 -separator $'\t' "$DB" \
    "select ts, ifnull(speaker,'?'), replace(replace(ifnull(content,''), char(10), ' '), char(13), ' ') from conversation_archive order by ts asc;" >> "$TSV"
  ok "归档表也导了"
fi

python3 - "$TSV" "$CORPUS" <<'PY'
import sys, os, datetime, collections

tsv, out = sys.argv[1], sys.argv[2]

WHO = {
    'user': '小满', '小满': '小满',
    'assistant': '允朔', '允朔': '允朔',
}

def is_injection(text):
    head = text[:60]
    return ('[Aru 内部' in head) or ('不会展示给对方' in head)

rows = []
dropped = 0
unknown = collections.Counter()

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
        if is_injection(text):
            dropped += 1
            continue
        if who not in WHO:
            unknown[who] += 1
        rows.append((ts, WHO.get(who, who), text))

rows.sort(key=lambda r: r[0])

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
tally = collections.Counter()
for ts, who, text in uniq:
    d = datetime.datetime.fromtimestamp(ts / 1000, TZ)
    byday.setdefault(d.strftime('%Y-%m-%d'), []).append((d, who, text))
    tally[who] += 1

for day, items in sorted(byday.items()):
    with open(os.path.join(out, day + '.txt'), 'w', encoding='utf-8') as f:
        for d, who, text in items:
            f.write('[%s] %s: %s\n' % (d.strftime('%Y-%m-%d %H:%M'), who, text))

print('  \u2713 %d 条消息，%d 天，去重掉 %d 条' % (len(uniq), len(byday), len(rows) - len(uniq)))
print('  \u2713 滤掉 %d 条系统注入（本来被当成她说的话）' % dropped)
print('  \u2713 说话人：' + '、'.join('%s %d' % (w, c) for w, c in tally.most_common()))
if unknown:
    print('  ! 还有没归一的说话人：' + '、'.join('%s %d' % (w, c) for w, c in unknown.most_common()))
PY

rm -f "$TSV"
chmod 700 "$CORPUS"
ok "语料在 $CORPUS"

say "3/4  看一眼导出来的东西"
echo "  文件数：$(ls -1 "$CORPUS" | wc -l)"
echo "  总大小：$(du -sh "$CORPUS" | cut -f1)"
echo
echo '  最早那天的开头：'
head -4 "$(ls "$CORPUS"/*.txt | head -1)" | sed 's/^/    /'
echo
echo '  最近那天的结尾：'
tail -4 "$(ls "$CORPUS"/*.txt | tail -1)" | sed 's/^/    /'

say "4/4  语料里的说话人（从导出成品数，不是只数活跃表）"
cat "$CORPUS"/*.txt | sed -n 's/^\[[0-9-]* [0-9:]*\] \([^:]*\):.*/\1/p' | sort | uniq -c | sort -rn | sed 's/^/  /'

cat <<'EOF'

  ── 下一步 ──

  extract 的任务包已经生成了，把提示和 schema 贴给小克：

    cat /root/latent-data/persona-extraction/人格候选提取提示.md
    cat /root/latent-data/persona-extraction/人格候选结果.schema.json

EOF
