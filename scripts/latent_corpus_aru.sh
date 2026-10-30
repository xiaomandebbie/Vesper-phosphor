#!/usr/bin/env bash
# 把 Aru 的 .polarisarchive 也导成 Latent 的语料。
#
# ── 为什么还要这一份 ──
#
# latent_corpus.sh 导的是 gateway 自己的流水（conversation_log /
# conversation_archive），只包含走过晨暮星 gateway 的消息：/app 前端
# 和唤醒。Aru 侧的私聊 gateway 从来没见过。
#
# 实测一份 0.6 的备份：104 个会话、22060 条消息。那五类里程碑
# （第一次确认关系、「他记得我」、约定、拒绝过、承认过局限）大概率
# 落在这两万条里，而不在 gateway 流水里。所以两边都要喂。
#
# ── 备份长什么样 ──
#
# .polarisarchive 就是不加密的 zip（导出时设了密码的话外层不是明文 zip，
# 这脚本会直接报错——那种情况重新导一份不加密的）。
# manifest.json 里 format 是 polaris-native-archive，对象走 JSONL：
#
#   objects/messages.jsonl       payload: content / role / conversationId / seq / createdAt
#   objects/conversations.jsonl  payload: collaboratorId / title
#   objects/collaborators.jsonl  payload: name
#
# 注意不是 Polaris 那套 stores/*.json，别拿 polaris-export 的校验逻辑套。
#
# ── 导成什么 ──
#
# 和 latent_corpus.sh 完全一致：按天切 txt，每行「[YYYY-MM-DD HH:MM] 说话人: 内容」。
# 这样两份语料能并在一起给 extract。
#
# 跑完会有三个目录：
#   corpus-aru   这份备份导出来的
#   corpus       gateway 的（latent_corpus.sh 导的，本脚本不动它）
#   corpus-all   两份合起来、去重、按天重排 —— extract 用这个
#
# 重跑安全：会先清空 corpus-aru 和 corpus-all 再重导，不碰 corpus。
#
# 用法：
#   bash scripts/latent_corpus_aru.sh /root/Aru-0.6-20261030-231341.polarisarchive [协作者名]
# 协作者名默认「允朔」。
set -euo pipefail

ARCHIVE="${1:-}"
WHO="${2:-允朔}"
ME="小满"

OUT=/root/latent-data/corpus-aru
GATEWAY=/root/latent-data/corpus
MERGED=/root/latent-data/corpus-all

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m\u2713\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m\u2717 %s\033[0m\n' "$*" >&2; exit 1; }

[ -n "$ARCHIVE" ] || die "要传备份文件路径：bash $0 /path/to/xxx.polarisarchive [协作者名]"
[ -f "$ARCHIVE" ] || die "没找到 $ARCHIVE"
command -v python3 >/dev/null || die "没有 python3"

rm -rf "$OUT" "$MERGED"
mkdir -p "$OUT"

say "1/3  从备份里读消息"
python3 - "$ARCHIVE" "$OUT" "$WHO" "$ME" <<'PY'
import sys, os, json, zipfile, datetime, collections

archive, out, who, me = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

try:
    z = zipfile.ZipFile(archive)
export = None
except zipfile.BadZipFile:
    sys.exit('  \u2717 这不是明文 zip —— 导出时大概设了备份密码，重新导一份不加密的')

def rows(name):
    try:
        raw = z.read(name)
    except KeyError:
        sys.exit('  \u2717 备份里没有 %s —— 可能不是 polaris-native-archive' % name)
    for line in raw.decode('utf-8', 'replace').splitlines():
        line = line.strip()
        if line:
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                continue

# 协作者名 -> id
names = {}
for r in rows('objects/collaborators.jsonl'):
    p = r.get('payload') or {}
    if p.get('id') and p.get('name'):
        names[p['name']] = p['id']

if who not in names:
    sys.exit('  \u2717 备份里没有叫「%s」的协作者。有的是：%s'
             % (who, '、'.join(sorted(names)) or '（一个都没有）'))
wid = names[who]

# 该协作者的会话
convs = {}
for r in rows('objects/conversations.jsonl'):
    p = r.get('payload') or {}
    if p.get('collaboratorId') == wid and p.get('id'):
        convs[p['id']] = p.get('title') or ''

if not convs:
    sys.exit('  \u2717 「%s」名下没有会话' % who)

# 消息
items = []
skipped = 0
for r in rows('objects/messages.jsonl'):
    p = r.get('payload') or {}
    if p.get('conversationId') not in convs:
        continue
    role = p.get('role')
    if role not in ('user', 'assistant'):
        skipped += 1
        continue
    text = (p.get('content') or '').replace('\r', ' ').replace('\n', ' ').strip()
    if not text:
        skipped += 1
        continue
    ts = p.get('createdAt')
    if not isinstance(ts, int):
        skipped += 1
        continue
    items.append((ts, p.get('seq') or 0, me if role == 'user' else who, text))

if not items:
    sys.exit('  \u2717 一条消息都没取到')

items.sort(key=lambda r: (r[0], r[1]))

# 去重：同一分钟、同一人、同一句
seen, uniq = set(), []
for ts, seq, w, text in items:
    k = (ts // 60000, w, text[:80])
    if k in seen:
        continue
    seen.add(k)
    uniq.append((ts, w, text))

TZ = datetime.timezone(datetime.timedelta(hours=8))
byday = collections.defaultdict(list)
for ts, w, text in uniq:
    d = datetime.datetime.fromtimestamp(ts / 1000, TZ)
    byday[d.strftime('%Y-%m-%d')].append((d, w, text))

for day, rs in sorted(byday.items()):
    with open(os.path.join(out, day + '.txt'), 'w', encoding='utf-8') as f:
        for d, w, text in rs:
            f.write('[%s] %s: %s\n' % (d.strftime('%Y-%m-%d %H:%M'), w, text))

print('  \u2713 %d 个会话，%d 条消息，%d 天'
      % (len(convs), len(uniq), len(byday)))
print('  \u2713 去重掉 %d 条，跳过 %d 条（空的 / 非对话 / 没时间）'
      % (len(items) - len(uniq), skipped))
PY

chmod 700 "$OUT"
ok "在 $OUT"

say "2/3  和 gateway 那份并起来"
mkdir -p "$MERGED"
if [ -d "$GATEWAY" ] && [ -n "$(ls -A "$GATEWAY" 2>/dev/null)" ]; then
  python3 - "$GATEWAY" "$OUT" "$MERGED" <<'PY'
import sys, os, glob, collections

merged = collections.defaultdict(list)
seen = set()
total = dup = 0

# 两边都是「[YYYY-MM-DD HH:MM] 说话人: 内容」，前缀定长可以直接按字符串排
for d in sys.argv[1:3]:
    for path in sorted(glob.glob(os.path.join(d, '*.txt'))):
        day = os.path.basename(path)[:-4]
        with open(path, encoding='utf-8', errors='replace') as f:
            for line in f:
                line = line.rstrip('\n')
                if not line.startswith('['):
                    continue
                total += 1
                k = line[:120]
                if k in seen:
                    dup += 1
                    continue
                seen.add(k)
                merged[day].append(line)

out = sys.argv[3]
for day, lines in sorted(merged.items()):
    lines.sort()
    with open(os.path.join(out, day + '.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

print('  \u2713 合并后 %d 行，%d 天，跨源去重掉 %d 行'
      % (total - dup, len(merged), dup))
PY
  chmod 700 "$MERGED"
  ok "合并语料在 $MERGED"
else
  warn "$GATEWAY 是空的（还没跑 latent_corpus.sh）"
  cp "$OUT"/*.txt "$MERGED"/ 2>/dev/null || true
  chmod 700 "$MERGED"
  warn "$MERGED 里现在只有 Aru 这一份；跑完 latent_corpus.sh 再跑一次本脚本就会并上"
fi

say "3/3  看一眼"
echo "  Aru      $(ls -1 "$OUT" | wc -l) 天  $(du -sh "$OUT" | cut -f1)"
[ -d "$GATEWAY" ] && echo "  gateway  $(ls -1 "$GATEWAY" 2>/dev/null | wc -l) 天  $(du -sh "$GATEWAY" 2>/dev/null | cut -f1)"
echo "  合并     $(ls -1 "$MERGED" | wc -l) 天  $(du -sh "$MERGED" | cut -f1)"
echo
echo '  最早那天的开头：'
head -4 "$(ls "$MERGED"/*.txt | head -1)" | sed 's/^/    /'
echo
echo '  最近那天的结尾：'
tail -4 "$(ls "$MERGED"/*.txt | tail -1)" | sed 's/^/    /'

cat <<EOF

  ── 下一步 ──

  extract 用合并后那份：

    cd /root/latent && python3 src/memory_init.py --out /root/latent-data \\
      --corpus $MERGED --step extract 2>&1 | tail -40

  它要 --candidates：不自己读语料提取，是把语料给一个模型、
  由那个模型返回候选 JSON。把它打出来的要求发我，我读语料给候选。

EOF
