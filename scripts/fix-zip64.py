#!/usr/bin/env python3
# 让导入器认 ZIP64。
#
# 她那份备份一个多 G，中央目录用的是 64 位偏移，所以上一版在
# 「读备份目录」这一步就停了（打出「ZIP64 格式，这边还不认」）。
#
# 两处要补，都是 ZIP 规范里写死的，不是猜的：
#
#   1. EOCD 往前 20 字节是 ZIP64 定位器，签名 0x07064b50，
#      偏移 8 处是「64 位目录记录」的位置；那条记录（签名 0x06064b50）
#      偏移 40/48 处是目录的真大小和真位置。
#
#   2. 目录项里被写成 0xffffffff 的字段，真值在 extra field 的
#      0x0001 块里，按「未压缩大小 → 压缩后大小 → 本地头偏移」
#      这个固定顺序、只为溢出的字段依次摆。
#
# 下载用 f.slice(start, start+len) 而不是位运算，JS 里大于 2^32 的
# 偏移本来就是普通 number，所以读 64 位值用 低32 + 高32 * 2^32，
# 不用 BigInt——文件再大也远没到 2^53。
#
# 在 /root/vesper-phosphor 下跑。幂等。

import os
import shutil
import sys

if not os.path.isdir('src'):
    print('请在 /root/vesper-phosphor 下跑')
    sys.exit(1)

path = 'src/memory-import.js'
with open(path, encoding='utf-8') as f:
    s = f.read()

if 'findCD64' in s:
    print('已经改过了，跳过。')
    sys.exit(0)

# ── 1. 找目录：先看有没有 ZIP64 定位器 ──

OLD_FIND = """  // zip \u7684\u76ee\u5f55\u5728\u5c3e\u90e8\u3002\u53ea\u8bfb\u6700\u540e 64 KB \u627e\u5b83\u3002
  function findCD(f) {
    var span = Math.min(66560, f.size);
    return slice(f, f.size - span, span).then(function (b) {
      for (var i = b.length - 22; i >= 0; i--) {
        if (u32(b, i) === 101010256) {
          return { size: u32(b, i + 12), at: u32(b, i + 16) };
        }
      }
      return null;
    });
  }
"""

NEW_FIND = """  // 64 \u4f4d\u8bfb\u6cd5\uff1a\u4f4e 32 + \u9ad8 32 \u00d7 2^32\u3002\u6587\u4ef6\u518d\u5927\u4e5f\u8fdc\u6ca1\u5230 2^53\uff0c\u4e0d\u7528 BigInt\u3002
  function u64(b, i) { return u32(b, i) + u32(b, i + 4) * 4294967296; }

  // zip \u7684\u76ee\u5f55\u5728\u5c3e\u90e8\u3002\u53ea\u8bfb\u6700\u540e 64 KB \u627e\u5b83\u3002
  //
  // ZIP64\uff1aEOCD \u5f80\u524d 20 \u5b57\u8282\u662f\u5b9a\u4f4d\u5668\uff08\u7b7e\u540d 0x07064b50\uff09\uff0c
  // \u5b83\u6307\u5411\u771f\u6b63\u7684 64 \u4f4d\u76ee\u5f55\u8bb0\u5f55\u3002\u5979\u90a3\u4efd\u5907\u4efd\u4e00\u4e2a\u591a G\uff0c\u8d70\u7684\u5c31\u662f\u8fd9\u6761\u8def\u3002
  function findCD(f) {
    var span = Math.min(66560, f.size);
    var base = f.size - span;
    return slice(f, base, span).then(function (b) {
      for (var i = b.length - 22; i >= 0; i--) {
        if (u32(b, i) !== 101010256) continue;
        var size = u32(b, i + 12);
        var at = u32(b, i + 16);
        // \u5b9a\u4f4d\u5668\u5c31\u5728 EOCD \u524d\u9762 20 \u5b57\u8282
        var L = i - 20;
        if (L >= 0 && u32(b, L) === 117853008) {
          var recAt = u64(b, L + 8);
          return findCD64(f, recAt);
        }
        if (at === 4294967295 || size === 4294967295) {
          return Promise.reject(new Error('ZIP64 \u4f46\u627e\u4e0d\u5230\u5b9a\u4f4d\u5668'));
        }
        return { size: size, at: at };
      }
      return null;
    });
  }

  // 64 \u4f4d\u76ee\u5f55\u8bb0\u5f55\uff1a\u7b7e\u540d 0x06064b50\uff0c\u504f\u79fb 40 \u662f\u76ee\u5f55\u5927\u5c0f\uff0c48 \u662f\u76ee\u5f55\u4f4d\u7f6e\u3002
  function findCD64(f, recAt) {
    return slice(f, recAt, 56).then(function (r) {
      if (u32(r, 0) !== 101075792) throw new Error('ZIP64 \u76ee\u5f55\u8bb0\u5f55\u7684\u5934\u4e0d\u5bf9');
      return { size: u64(r, 40), at: u64(r, 48) };
    });
  }
"""

if s.count(OLD_FIND) != 1:
    print('findCD \u951a\u70b9\u547d\u4e2d %d \u6b21\uff08\u8981 1\uff09\u2014\u2014\u6ca1\u6539' % s.count(OLD_FIND))
    sys.exit(1)
s = s.replace(OLD_FIND, NEW_FIND, 1)
print('findCD        \u6539\u4e86\uff08\u8ba4 ZIP64 \u5b9a\u4f4d\u5668\uff09')

# ── 2. 走目录：0xffffffff 的字段去 extra field 里找真值 ──

OLD_WALK = """        var name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + cmtLen;
        if (want[name]) found[want[name]] = { method: method, size: compSize, at: localAt };
"""

NEW_WALK = """        var name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
        // ZIP64\uff1a\u88ab\u5199\u6210 0xffffffff \u7684\u5b57\u6bb5\uff0c\u771f\u503c\u5728 extra field \u7684 0x0001 \u5757\u91cc\u3002
        // \u987a\u5e8f\u662f\u56fa\u5b9a\u7684\uff1a\u672a\u538b\u7f29\u5927\u5c0f \u2192 \u538b\u7f29\u540e\u5927\u5c0f \u2192 \u672c\u5730\u5934\u504f\u79fb\uff0c
        // \u800c\u4e14\u53ea\u4e3a\u771f\u6b63\u6ea2\u51fa\u7684\u90a3\u51e0\u4e2a\u5b58\u3002
        if (compSize === 4294967295 || localAt === 4294967295) {
          var ex = p + 46 + nameLen;
          var exEnd = ex + extraLen;
          while (ex + 4 <= exEnd) {
            var tag = u16(cd, ex);
            var len = u16(cd, ex + 2);
            if (tag === 1) {
              var q = ex + 4;
              if (u32(cd, p + 24) === 4294967295) q += 8;   // \u672a\u538b\u7f29\u5927\u5c0f
              if (compSize === 4294967295) { compSize = u64(cd, q); q += 8; }
              if (localAt === 4294967295) { localAt = u64(cd, q); }
              break;
            }
            ex += 4 + len;
          }
        }
        p += 46 + nameLen + extraLen + cmtLen;
        if (want[name]) found[want[name]] = { method: method, size: compSize, at: localAt };
"""

if s.count(OLD_WALK) != 1:
    print('\u8d70\u76ee\u5f55\u951a\u70b9\u547d\u4e2d %d \u6b21\uff08\u8981 1\uff09\u2014\u2014\u6ca1\u6539' % s.count(OLD_WALK))
    sys.exit(1)
s = s.replace(OLD_WALK, NEW_WALK, 1)
print('\u8d70\u76ee\u5f55      \u6539\u4e86\uff08extra field \u91cc\u53d6\u771f\u504f\u79fb\uff09')

# ── 3. 前端那句「ZIP64 还不认」抽掉 ──

OLD_REJ = "      if (cd.at === 4294967295) throw new Error('ZIP64 \\u683c\\u5f0f\\uff0c\\u8fd9\\u8fb9\\u8fd8\\u4e0d\\u8ba4');\n"
if s.count(OLD_REJ) == 1:
    s = s.replace(OLD_REJ, '', 1)
    print('\u53bb\u6389\u65e7\u62a5\u9519  \u6539\u4e86')
else:
    print('\u53bb\u6389\u65e7\u62a5\u9519  \u627e\u4e0d\u5230\uff08%d \u5904\uff09\uff0c\u4e0d\u5f71\u54cd\u8fd0\u884c' % s.count(OLD_REJ))

shutil.copy(path, '/root/memory-import.js.before-zip64')
with open(path, 'w', encoding='utf-8') as f:
    f.write(s)

print('\n\u5199\u597d\u4e86\u3002\u63a5\u4e0b\u6765\uff1a')
print('  node --check src/memory-import.js && pm2 restart vesper --update-env')
