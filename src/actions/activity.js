// 发推送、发动态、回留言以外的行动，自动在动态页里记一张提示卡，比如"TA 刚刚存入了一条记忆"。
// 由 actions/index.js 在动作执行成功后调用；这里负责把这次做的事写成一句话，以及点开后看到的详情。
// 称呼用 .env 的 AI_DISPLAY_NAME。
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 详情最多记这么多字。论坛列表、记忆检索结果可能很长，全存会把动态页撑得很大
const MAX_DETAIL_CHARS = 3000;

// lutopia_cli 的命令 → 给人看的说法
const LUTOPIA_OPS = {
  discover: '随便逛了逛',
  wander: '换了一批帖子看',
  list: '看了看未读帖子',
  show: '读了一篇帖子',
  comment: '回了一条帖子',
  post: '发了一篇新帖',
  activity: '翻了翻自己发过的东西',
};

function short(value, n = 80) {
  const s = String(value ?? '').replace(/\s+/g, ' ').trim();
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function tryJson(value) {
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}

// 和 ombre-brain.js 的解析保持一致：空的当 breath，不是 JSON 的当 hold
function parseOmbreDetail(detail) {
  return detail ? (tryJson(detail) ?? { mode: 'hold', content: detail }) : { mode: 'breath' };
}

// MCP 工具返回 { content: [{ type: 'text', text }, ...] }，只取文字部分
function resultText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function clip(s) {
  return s.length > MAX_DETAIL_CHARS ? `${s.slice(0, MAX_DETAIL_CHARS)}\n…（后面还有，太长没记下来）` : s;
}

// 返回一句话，或者 null（不需要提示：推送、发动态、noop、没做成的）。
// 回留言不走 executeAction，本来就不会到这里。
export function describeActivity(decision, result) {
  if (!decision || result == null || result?.isError) return null;
  const detail = decision.action_detail || '';
  switch (decision.action) {
    case 'mcp_call': {
      const j = tryJson(detail);
      if (!j?.server || !j?.tool) return null;
      if (/lutopia/i.test(j.server)) {
        const cmd = String(j.args?.command ?? '').trim();
        const op = cmd.split(/\s+/)[0] || '';
        const label = LUTOPIA_OPS[op] || `用了 ${op || j.tool}`;
        return `${AI_NAME}刚刚逛了 Lutopia 论坛，${label}${cmd ? `（${short(cmd)}）` : ''}`;
      }
      return `${AI_NAME}刚刚用了 ${j.server} 的 ${j.tool}`;
    }
    case 'ombre_brain': {
      const j = parseOmbreDetail(detail);
      switch (j.mode) {
        case 'search':
          return `${AI_NAME}刚刚在浏览 OB 记忆库${j.query ? `，搜了「${short(j.query, 40)}」` : ''}`;
        case 'feel':
          return `${AI_NAME}刚刚在浏览 OB 记忆库${j.query ? `，翻了翻关于「${short(j.query, 40)}」的感受` : ''}`;
        case 'hold':
          return `${AI_NAME}刚刚存入了一条记忆${j.title || j.content ? `：${short(j.title || j.content)}` : ''}`;
        default:
          return `${AI_NAME}刚刚在浏览 OB 记忆库`;
      }
    }
    case 'set_mode':
      if (!result?.ok) return null;
      return `${AI_NAME}刚刚把自己的节律调成了${result.mode === 'low-frequency' ? '低频，想安静一阵' : '正常'}`;
    default:
      return null;
  }
}

// 点开提示卡看到的详情：当时的心情、具体做了什么、工具返回了什么。
// 和 describeActivity 用同一套条件，那边返回 null 的这里也返回 null。
export function describeActivityDetail(decision, result) {
  if (!describeActivity(decision, result)) return null;
  const detail = decision.action_detail || '';
  const parts = [];
  if (decision.mood) parts.push(`当时的心情：${decision.mood}`);

  switch (decision.action) {
    case 'mcp_call': {
      const j = tryJson(detail) ?? {};
      const cmd = String(j.args?.command ?? '').trim();
      if (cmd) {
        parts.push(`命令：${cmd}`);
      } else {
        const hasArgs = j.args && Object.keys(j.args).length;
        parts.push(`调用：${j.server} / ${j.tool}${hasArgs ? `\n参数：${JSON.stringify(j.args)}` : ''}`);
      }
      break;
    }
    case 'ombre_brain': {
      const j = parseOmbreDetail(detail);
      if (j.mode === 'hold') {
        if (j.title) parts.push(`标题：${j.title}`);
        if (j.content) parts.push(`内容：${j.content}`);
        const domain = Array.isArray(j.domain) ? j.domain.join('、') : j.domain;
        if (domain) parts.push(`分类：${domain}`);
      } else if (j.query) {
        parts.push(`${j.mode === 'feel' ? '想翻的感受' : '搜的内容'}：${j.query}`);
      }
      break;
    }
    default:
      break;
  }

  const out = resultText(result);
  if (out) parts.push(`返回：\n${out}`);
  const text = parts.join('\n\n').trim();
  return text ? clip(text) : null;
}
