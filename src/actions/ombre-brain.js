import { callTool, isConnected } from '../mcp-manager.js';

// Ombre Brain 暴露的工具：
//   breath()                -> 睁眼看看记得什么，0 参数
//   breath_search(query,..) -> 关键词/语义检索
//   feel(query)             -> 翻感受类记忆
//   hold(content, ...)      -> 写入一条长期记忆
//
// `detail` 是 JSON 字符串，四选一：
//   {"mode":"breath"}
//   {"mode":"search","query":"..."}
//   {"mode":"feel","query":"..."}
//   {"mode":"hold","content":"...","title":"...","domain":"...","importance":8}
//
// 没写或解析不了时默认 breath——最省 token。

// OB 的 importance 要求 1～10 的整数，传 0.8 这种小数会直接报 validation error。
// 模型习惯写 0~1 的小数，这里换算成 1～10；不是数字就不传，交给 OB 自己判断。
export function normalizeImportance(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  const scaled = n > 0 && n <= 1 ? n * 10 : n;
  return Math.min(10, Math.max(1, Math.round(scaled)));
}

// domain / tags 在 OB 里是逗号分隔的字符串，模型有时会给数组
function csv(value) {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean).join(',');
  if (typeof value === 'string') return value.trim() || undefined;
  return undefined;
}

// 只保留有值的字段，免得 OB 报"字段类型不对"
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

export default async function ombreBrain(detail) {
  if (!isConnected('ombre-brain')) {
    console.warn('ombreBrain(): ombre-brain MCP not connected, skipping');
    return;
  }

  let parsed;
  try {
    parsed = detail ? JSON.parse(detail) : { mode: 'breath' };
  } catch (err) {
    // 不是 JSON：只有 hold 接受纯文本，就当成要存的内容
    parsed = { mode: 'hold', content: detail };
  }

  switch (parsed.mode) {
    case 'search':
      return callTool('ombre-brain', 'breath_search', { query: parsed.query });

    case 'feel':
      return callTool('ombre-brain', 'feel', { query: parsed.query });

    case 'hold':
      // 只在决策引擎真的觉得值得长期记住时才调
      return callTool(
        'ombre-brain',
        'hold',
        compact({
          content: parsed.content,
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          domain: csv(parsed.domain),
          tags: csv(parsed.tags),
          importance: normalizeImportance(parsed.importance),
          feel: typeof parsed.feel === 'boolean' ? parsed.feel : undefined,
        })
      );

    case 'breath':
    default:
      return callTool('ombre-brain', 'breath', {});
  }
}
