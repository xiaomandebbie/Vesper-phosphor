#!/usr/bin/env bash
# 看一眼 extract 生成的《人格候选输入清单.json》——多大、几个来源、锟怎么切的。
#
# 为什么要先看：候选里的 source_anchor 必须是清单里真存在的锟号，
# evidence 还要逐字落在那条锟的区间里。锟表编不出来，必须读真的。
# 但清单里带着全部语料（语料 1.4M），整份贴不现实，先量一下规模。
#
# 只读，不改任何东西。
set -euo pipefail

DIR=/root/latent-data/persona-extraction

die() { printf '\n\033[31m\u2717 %s\033[0m\n' "$*" >&2; exit 1; }

M=""
for cand in "$DIR/人格候选输入清单.json" "$DIR"/*输入清单*.json; do
  [ -f "$cand" ] && { M="$cand"; break; }
done
[ -n "$M" ] || die "没找到输入清单；先跑 memory_init.py --step extract"
command -v python3 >/dev/null || die "没有 python3"

python3 - "$M" <<'PY'
import json, os, sys

path = sys.argv[1]
print('文件：%s' % path)
print('大小：%.2f MB' % (os.path.getsize(path) / 1048576))

with open(path, encoding='utf-8') as f:
    d = json.load(f)

print('顶层：%s' % type(d).__name__, end='')
if isinstance(d, dict):
    print('  键：' + ', '.join(d.keys()))
else:
    print('  长度 %d' % len(d))

# 找出所有带 anchors 的对象，不假设层级名字
def walk(o, p=''):
    if isinstance(o, dict):
        if isinstance(o.get('anchors'), list):
            yield p, o
        for k, v in o.items():
            yield from walk(v, p + '/' + k)
    elif isinstance(o, list):
        for i, v in enumerate(o):
            yield from walk(v, '%s[%d]' % (p, i))

found = list(walk(d))
print('\n带锟表的来源：%d 个' % len(found))

TEXT_KEYS = ('text', 'content', 'body', 'corpus', 'raw')
total_anchors = 0
total_chars = 0

for p, o in found:
    ref = None
    for k in ('source_ref', 'ref', 'path', 'id', 'name'):
        if isinstance(o.get(k), str):
            ref = o[k]
            break
    txt = None
    for k in TEXT_KEYS:
        if isinstance(o.get(k), str):
            txt = o[k]
            break
    n = len(o['anchors'])
    total_anchors += n
    total_chars += len(txt) if txt else 0
    print('  %-46s 锟 %4d 条  正文 %6s 字'
          % (ref or ('(无 ref) ' + p), n, len(txt) if txt else '?'))

print('\n锟总数：%d' % total_anchors)
print('正文总字数：%d' % total_chars)

# 锟长什么样
if found:
    first = found[0][1]['anchors']
    if first:
        print('\n第一条锟的原样：')
        print('  ' + json.dumps(first[0], ensure_ascii=False))
        heads = [len(a.get('head', '')) for a in first if isinstance(a, dict)]
        if heads:
            print('  head 长度：最短 %d、最长 %d、平均 %d'
                  % (min(heads), max(heads), sum(heads) // len(heads)))
        spans = [a.get('end', 0) - a.get('start', 0) for a in first
                 if isinstance(a, dict) and isinstance(a.get('start'), int)]
        if spans:
            print('  锟区间字数：最小 %d、最大 %d、平均 %d'
                  % (min(spans), max(spans), sum(spans) // len(spans)))

# 全部锟的 head 加起来有多少字——決定能不能整张锟表贴给模型
head_chars = 0
for _, o in found:
    for a in o['anchors']:
        if isinstance(a, dict):
            head_chars += len(a.get('head', '')) + 24
print('\n全部锟表（只算 anchor+start+end+head）约 %d 字' % head_chars)
PY
