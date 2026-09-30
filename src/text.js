// 截断文本时按完整字符算，不把 emoji 这类占两个 UTF-16 单元的字符切成两半。
//
// String.prototype.slice 按 UTF-16 单元切，正好切在 emoji 中间时会留下半个字符（孤立代理项）。
// JSON.stringify 会把它写成 "\ud83d" 这样的转义，DeepSeek 等上游解析请求体时直接报 400：
//   Failed to parse the request body as JSON: messages[1].content: unexpected end of hex escape
// 所以：截断一律走 clipText；发给模型之前再用 wellFormedDeep 把漏网的半个字符清掉。

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

// 去掉孤立代理项（成对的正常 emoji 不受影响）
export function toWellFormed(value) {
  return String(value ?? '').replace(LONE_SURROGATE, '');
}

// 最多 n 个字符（按完整字符算），超出时在末尾加 suffix
export function clipText(value, n, suffix = '…') {
  const s = toWellFormed(value);
  if (s.length <= n) return s;
  const chars = Array.from(s);
  if (chars.length <= n) return s;
  return `${chars.slice(0, n).join('')}${suffix}`;
}

// 把对象、数组里所有字符串的孤立代理项去掉。发请求前对 messages 用一遍
export function wellFormedDeep(value) {
  if (typeof value === 'string') return toWellFormed(value);
  if (Array.isArray(value)) return value.map(wellFormedDeep);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = wellFormedDeep(v);
    return out;
  }
  return value;
}
