import { callTool, isConnected } from '../mcp-manager.js';

// Ombre Brain 暴露的工具：
//   breath()                -> 睁眼看看记得什么，0 参数
//   breath_search(query,..) -> 关键词/语义检索
//   feel(query)             -> 翻感受类记忆
//   hold(content, ...)      -> 写入一条长期记忆
//   plan(content, ...)      -> 登记一个还没闭环的承诺
//   letter_write(...)       -> 留一封信（不衰减、不合并）
//   dream(window_hours)     -> 读最近动过的桶，消化用
//
// `detail` 是 JSON 字符串，七选一：
//   {"mode":"breath"}
//   {"mode":"search","query":"..."}
//   {"mode":"feel","query":"..."}
//   {"mode":"hold","content":"...","title":"...","domain":"...","importance":8}
//   {"mode":"plan","content":"...","weight":0.6,"why_remembered":"..."}
//   {"mode":"letter","title":"...","content":"..."}
//   {"mode":"dream"}
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

// 只保留有值的字段，免得 OB 报“字段类型不对”
function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null));
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function str(value) {
  return typeof value === 'string' && value.trim() ? value : undefined;
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

    // 答应了、还没做完的事。登记下来，之后会在 dream 末尾的 active 段等着。
    // plan 不衰减、也不出现在普通 breath 里，所以不登记就等于忘了。
    case 'plan':
      return callTool(
        'ombre-brain',
        'plan',
        compact({
          content: parsed.content,
          status: str(parsed.status),
          weight: num(parsed.weight),
          related_bucket: str(parsed.related_bucket),
          why_remembered: str(parsed.why_remembered),
        })
      );

    // 想对她说、但不该做成一条推送的话；或者留给以后的自己。
    // author/ai_name 写死：OB 说了，写信时没记下关系名，以后就再也锁不上这封。
    case 'letter':
      return callTool(
        'ombre-brain',
        'letter_write',
        compact({
          author: 'ai',
          ai_name: str(process.env.AI_DISPLAY_NAME),
          user_name: str(process.env.USER_DISPLAY_NAME),
          title: str(parsed.title),
          content: parsed.content,
          lock_type: str(parsed.lock_type),
          unlock_date: str(parsed.unlock_date),
        })
      );

    // 读最近 window_hours（默认 48）内动过的桶，用来消化。
    // 提示词里不列它：白天跑是浪费一次醒来，只由凌晨那次约醒把它递过来。
    case 'dream':
      return callTool('ombre-brain', 'dream', compact({ window_hours: num(parsed.window_hours) }));

    case 'breath':
    default:
      return callTool('ombre-brain', 'breath', {});
  }
}
