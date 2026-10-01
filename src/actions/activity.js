// 发推送、发动态、回留言以外的行动，自动在动态页里记一张提示卡，比如"TA 刚刚存入了一条记忆"。
// 由 actions/index.js 在动作执行成功后调用；这里负责把这次做的事写成一句话，以及点开后看到的详情。
// 称呼用 .env 的 AI_DISPLAY_NAME。
//
// 卡片上那一句只写做了什么：不放命令原文（discover --limit 12 这种），也不放回帖内容，太长；
// 回了什么、发了什么都在点开后的详情里。发帖只在卡片上带一个短标题。
// 以前存下来的老卡片里还带着命令或回帖内容，动态页显示前用 tidyActivityContent / tidyActivityDetail 整理一遍。
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 详情最多记这么多字。论坛列表、记忆检索结果可能很长，全存会把动态页撑得很大
const MAX_DETAIL_CHARS = 3000;
// 卡片上发帖标题最多多少字
const CARD_TITLE_CHARS = 30;

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

// 点歌台（server 叫 music，见 mcp-manager.js）的工具 → 给人看的说法。动态页是给对方看的，所以用"你"
const MUSIC_OPS = {
  her_recent: '看了看你最近在听什么',
  song_search: '搜了搜歌',
  song_share: '给你点了一首歌',
  lyric_read: '读了一首歌的歌词',
  lyric_share: '挑了一句歌词',
  song_memo: '在一首歌的批注本里写了一笔',
  memo_read: '翻了翻你们的批注本',
  song_comments: '刷了刷一首歌的评论区',
  song_listen: '认真听了一首歌',
  playlists: '翻了翻歌单',
  playlist_add: '往歌单里收了一首歌',
  her_netease: '看了看你的网易云',
};
// 这几个工具在卡片上带一下歌名
const MUSIC_WITH_SONG = new Set(['song_share', 'song_memo', 'playlist_add', 'lyric_read', 'lyric_share', 'song_listen']);

function short(value, n = 80) {
  const chars = Array.from(String(value ?? '').replace(/\s+/g, ' ').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
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
  const chars = Array.from(s);
  return chars.length > MAX_DETAIL_CHARS
    ? `${chars.slice(0, MAX_DETAIL_CHARS).join('')}\n…（后面还有，太长没记下来）`
    : s;
}

// ---------- 点歌台 → 给人看的话 ----------

function musicSummary(tool, args) {
  const label = MUSIC_OPS[tool] || `用了点歌台的 ${tool}`;
  const song = String(args?.query ?? args?.name ?? '').trim();
  return song && MUSIC_WITH_SONG.has(tool) ? `${label}「${short(song, CARD_TITLE_CHARS)}」` : label;
}

// 详情里放 TA 写下的话（批注、配文），返回的内容在"返回"里
function musicWritingDetail(args) {
  const parts = [];
  if (args?.memo) parts.push(`批注：${args.memo}`);
  if (args?.note) parts.push(`配文：${args.note}`);
  return parts.join('\n') || null;
}

// ---------- 论坛命令 → 给人看的话 ----------

// 按空格拆参数，引号包起来的算一个（"..."、'...'、“...”）
function splitArgs(command) {
  const out = [];
  const re = /"([^"]*)"|'([^']*)'|“([^”]*)”|(\S+)/g;
  let m;
  while ((m = re.exec(String(command ?? '')))) out.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  return out;
}

const forumOp = (command) => (splitArgs(command)[0] || '').toLowerCase();

// comment <post_id> 内容 → { op, text }；post <版块> 标题 正文 → { op, title, text }；别的命令 null
function forumWriting(command) {
  const t = splitArgs(command);
  const op = (t[0] || '').toLowerCase();
  if (op === 'comment') return { op, text: t.slice(2).join(' ').trim() };
  if (op === 'post') return { op, title: (t[2] || '').trim(), text: t.slice(3).join(' ').trim() };
  return null;
}

// 卡片上那一句：只写做了什么。发帖带一个短标题，回帖内容不放
function forumSummary(command) {
  const label = LUTOPIA_OPS[forumOp(command)] || '逛了逛';
  const w = forumWriting(command);
  if (w?.op === 'post' && w.title) return `${label}「${short(w.title, CARD_TITLE_CHARS)}」`;
  return label;
}

// 详情里的完整内容：回帖写全文，发帖写标题和全文；看帖不写（返回的帖子内容在"返回"里）
function forumWritingDetail(command) {
  const w = forumWriting(command);
  if (!w) return null;
  if (w.op === 'comment') return w.text ? `回复的内容：\n${w.text}` : null;
  const parts = [];
  if (w.title) parts.push(`标题：${w.title}`);
  if (w.text) parts.push(`正文：\n${w.text}`);
  return parts.join('\n') || null;
}

// ---------- 新卡片 ----------

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
        return `${AI_NAME}刚刚逛了 Lutopia 论坛，${forumSummary(cmd)}`;
      }
      if (j.server === 'music') return `${AI_NAME}刚刚${musicSummary(j.tool, j.args)}`;
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

// 点开提示卡看到的详情：当时的心情、回了什么 / 发了什么、工具返回了什么。命令原文和调用参数不放。
// 和 describeActivity 用同一套条件，那边返回 null 的这里也返回 null。
export function describeActivityDetail(decision, result) {
  if (!describeActivity(decision, result)) return null;
  const detail = decision.action_detail || '';
  const parts = [];
  if (decision.mood) parts.push(`当时的心情：${decision.mood}`);

  switch (decision.action) {
    case 'mcp_call': {
      const j = tryJson(detail) ?? {};
      if (/lutopia/i.test(String(j.server ?? ''))) {
        const writing = forumWritingDetail(String(j.args?.command ?? ''));
        if (writing) parts.push(writing);
      } else if (j.server === 'music') {
        const writing = musicWritingDetail(j.args);
        if (writing) parts.push(writing);
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

// ---------- 老卡片 ----------
// 数据库不改，动态页显示前整理成新样子。新卡片过一遍也不会变。
//   更早的卡片："TA刚刚逛了 Lutopia 论坛，随便逛了逛（discover --limit 12）"，详情里有"命令：…""调用：…"
//   前一版的卡片："…回了一条帖子：「回帖内容」"、"…发了一篇新帖「标题」：正文开头"

const OLD_FORUM_LINE = /^(.*?Lutopia 论坛，)[^（\n]*（(.*)）\s*$/;
const COMMENT_LINE = /^(.*?Lutopia 论坛，回了一条帖子)：.*$/;
const POST_LINE = /^(.*?Lutopia 论坛，发了一篇新帖(?:「[^」]*」)?)：.*$/;

export function tidyActivityContent(content) {
  return String(content ?? '')
    .split('\n')
    .map((line) => {
      const old = OLD_FORUM_LINE.exec(line);
      if (old) return `${old[1]}${forumSummary(old[2])}`;
      const c = COMMENT_LINE.exec(line);
      if (c) return c[1];
      const p = POST_LINE.exec(line);
      if (p) return p[1];
      return line;
    })
    .join('\n');
}

export function tidyActivityDetail(detail) {
  if (!detail) return detail || null;
  const kept = String(detail)
    .split('\n\n')
    .map((seg) => {
      if (seg.startsWith('命令：')) return forumWritingDetail(seg.slice(3)) ?? '';
      if (seg.startsWith('调用：')) return '';
      return seg;
    })
    .filter((seg) => seg.trim());
  return kept.length ? kept.join('\n\n') : null;
}
