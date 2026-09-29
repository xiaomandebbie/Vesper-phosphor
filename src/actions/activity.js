// 发推送、发动态以外的行动，自动在动态里记一笔，比如"TA刚刚逛了 Lutopia 论坛"。
// 由 actions/index.js 在动作执行成功后调用；这里只负责把这次做的事写成一句话。
// 称呼用 .env 的 AI_DISPLAY_NAME。
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

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

// 返回一句话，或者 null（不需要记：推送、发动态、noop、没做成的）
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
      // 和 ombre-brain.js 的解析保持一致：空的当 breath，不是 JSON 的当 hold
      const j = detail ? (tryJson(detail) ?? { mode: 'hold', content: detail }) : { mode: 'breath' };
      switch (j.mode) {
        case 'search':
          return `${AI_NAME}刚刚在浏览 OB 记忆库${j.query ? `，搜了「${short(j.query, 40)}」` : ''}`;
        case 'feel':
          return `${AI_NAME}刚刚在浏览 OB 记忆库${j.query ? `，翻了翻关于「${short(j.query, 40)}」的感受` : ''}`;
        case 'hold':
          return `${AI_NAME}刚刚往 OB 记忆库里存了一条记忆${j.title || j.content ? `：${short(j.title || j.content)}` : ''}`;
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
