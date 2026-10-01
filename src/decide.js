// LLM 端点可配置——这是"决策者"和"对话侧那个你"是不是同一个模型的关键开关。
// 默认仍走 DEEPSEEK_*（向后兼容），但优先读 LLM_* 这几个新变量。
//
// 省钱的关键：请求分成两条消息。
//   system：规则、动作列表、论坛用法、输出格式——每次醒来都一模一样，上游的前缀缓存能命中。
//   user：现在几点、最近聊了什么、情绪、留言——每次都变，放在最后。
// 往 system 里加东西时，只能放不随时间变的内容。
//
// 逛论坛可以连着走几步（见 forumNextStep）：后面每一步都是在同一段对话后面追加消息，
// 前面的 system + user + 上一步的回答原样不动，所以也能吃到缓存，每步多花的主要是论坛返回的内容。
import { momentWaitMs, MOMENT_MIN_INTERVAL_HOURS } from './actions/moment.js';
import { formatDateTime } from './wall-time.js';
import { clipText, wellFormedDeep } from './text.js';

const LLM_BASE_URL =
  process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const USER_NAME = process.env.USER_DISPLAY_NAME || '对方';

// 输出上限默认不设，交给上游用自己的默认值。
// 如果模型先花额度在思考上，思考没走完额度就用光，正文就是空的。真要收紧再用 .env 的 DECIDE_MAX_TOKENS。
const DECIDE_MAX_TOKENS = process.env.DECIDE_MAX_TOKENS
  ? Number(process.env.DECIDE_MAX_TOKENS)
  : null;

// 单次请求最多等多久。不设的话上游卡住时这一轮 tick 会一直挂着。
const LLM_TIMEOUT_MS = Number(process.env.DECIDE_TIMEOUT_MS || 120000);

// 省 token：每条最近对话最多带多少字，长期记忆 breath / feel 各最多带多少字。
// 做决定只需要知道"大概在聊什么"，不需要整段原文。
const MSG_MAX_CHARS = 200;
const MEMORY_MAX_CHARS = 1200;

// 逛论坛一次醒来最多再多走几步（第一步是醒来时选的那条命令，不算在里面）。
// .env 的 FORUM_MAX_STEPS 可改，不填是 3，填 0 就是原来那样只走一步，最多 5。
export const FORUM_MAX_STEPS = (() => {
  const raw = String(process.env.FORUM_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 3;
})();
// 论坛每一步返回的内容最多带多少字给模型看
const FORUM_RESULT_MAX_CHARS = 4000;

// 可选：给 system 消息打 Anthropic 风格的 cache_control 标记。
// DeepSeek、OpenAI 这类是自动前缀缓存，不用开。上游是 Claude 且中转站支持透传 cache_control 时才开，
// 不支持的中转站可能直接报 400，报错就删掉这一行。
const DECIDE_CACHE_CONTROL = /^(1|on|true)$/i.test(String(process.env.DECIDE_CACHE_CONTROL || '').trim());

// 第一次失败（空正文 / 被截断 / 不是合法 JSON）后，重试时追加在最后一条 user 消息末尾的提醒。
const RETRY_HINT =
  '\n\n（注意：上一次的回复是空的、被截断了，或者不是合法 JSON。这次请只输出一个完整的 JSON 对象；正文控制在 400 字以内，确保所有引号和括号都闭合。）';

function systemMessage(text) {
  if (!DECIDE_CACHE_CONTROL) return { role: 'system', content: text };
  return {
    role: 'system',
    content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }],
  };
}

async function callLLM(messages, maxTokens = DECIDE_MAX_TOKENS) {
  // 发出去之前把半个 emoji 这类孤立代理项清掉，不然上游解析 JSON 报 400（见 text.js）
  const payload = { model: LLM_MODEL, messages: wellFormedDeep(messages) };
  if (maxTokens) payload.max_tokens = maxTokens;

  const res = await fetch(LLM_BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${LLM_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`decide(): LLM API error ${res.status}: ${await res.text()}`);
  }

  const data = await res.json();
  const choice = data.choices?.[0];
  logCacheUsage(data.usage);
  return {
    content: choice?.message?.content ?? '',
    finish: choice?.finish_reason ?? 'none',
    raw: data,
  };
}

// 把上游报回来的缓存命中打进日志，部署后 grep 一下就知道缓存有没有生效。
// 不同上游字段名不一样：DeepSeek 是 prompt_cache_hit_tokens，OpenAI 是 prompt_tokens_details.cached_tokens，
// Anthropic 兼容层常见 cache_read_input_tokens。都没有就只打总数。
function logCacheUsage(usage) {
  if (!usage) return;
  const prompt = usage.prompt_tokens ?? usage.input_tokens;
  const hit =
    usage.prompt_cache_hit_tokens ??
    usage.prompt_tokens_details?.cached_tokens ??
    usage.cache_read_input_tokens ??
    null;
  console.log(`decide(): 输入 ${prompt ?? '?'} tokens，缓存命中 ${hit ?? '上游没报'}`);
}

// 模型有时候会把 JSON 包在 ``` 里，或者在前后加一两句人话。
// 先原样试，不行就只取第一个 { 到最后一个 } 再试。
function parseDecision(text) {
  const cleaned = text.replace(/```json|```/g, '').trim();
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw err;
  }
}

// 重试时只改最后一条 user 消息，前面的都不动，缓存照样命中
function withRetryHint(messages) {
  const last = messages[messages.length - 1];
  return [...messages.slice(0, -1), { ...last, content: `${last.content}${RETRY_HINT}` }];
}

// 最多请求两次：第一次按配置来；空正文、被截断或 JSON 解析失败时，
// 摘掉 max_tokens、附上提醒再试一次。两次都不行才抛错。
// 返回解析好的对象，以及模型的原话（续写对话时要原样放回去）。
async function askJson(messages) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const isRetry = attempt > 1;
    const out = await callLLM(isRetry ? withRetryHint(messages) : messages, isRetry ? null : DECIDE_MAX_TOKENS);

    if (!out.content) {
      console.error(
        `decide(): empty content (attempt ${attempt}). finish_reason=${out.finish} raw=${JSON.stringify(out.raw).slice(0, 600)}`
      );
      lastError = new Error(`decide(): no content in response (finish_reason=${out.finish})`);
      continue;
    }

    try {
      return { parsed: parseDecision(out.content), content: out.content };
    } catch (err) {
      console.error(
        `decide(): failed to parse JSON (attempt ${attempt}, finish_reason=${out.finish}): ${out.content.slice(0, 300)}`
      );
      lastError = new Error(
        `decide(): failed to parse JSON (finish_reason=${out.finish}): ${out.content.slice(0, 300)}`
      );
    }
  }
  throw lastError;
}

// 截断都按完整字符算（见 text.js），不会把 emoji 切成两半
function short(value, n = 60) {
  return clipText(String(value ?? '').replace(/\s+/g, ' ').trim(), n);
}

// 长期记忆可能很长，只截头部，保留换行
function clipMemory(value) {
  if (value == null) return '暂无';
  const s = String(value).trim();
  if (!s) return '暂无';
  return clipText(s, MEMORY_MAX_CHARS);
}

function clipForumResult(value) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  return clipText(s, FORUM_RESULT_MAX_CHARS, '\n…（后面太长，没放进来）');
}

// 最近几次选了什么。让模型自己看到"我一直在做同一件事"，比写死规则更自然，也是选下一个动作的主要参考。
function recentActionsBlock(recentActions) {
  if (!recentActions?.length) return '';
  const list = recentActions.map((a) => a.action || '?').join(' → ');
  const counts = {};
  for (const a of recentActions) counts[a.action || '?'] = (counts[a.action || '?'] || 0) + 1;
  const summary = Object.entries(counts)
    .map(([k, v]) => `${k}×${v}`)
    .join('、');
  return `你最近 ${recentActions.length} 次醒来选的动作（从早到晚）：${list}（${summary}）`;
}

// 留言如果是在回复某一条，带上被回复的那条，TA 才知道对方在接哪句话
function pendingCommentsBlock(pendingComments) {
  if (!pendingComments?.length) return '';
  const lines = pendingComments
    .map((c) => {
      const who = c.parent_author === 'user' ? `${USER_NAME}自己` : '你';
      const quote = c.parent_content ? `，回复的是${who}那条「${short(c.parent_content, 60)}」` : '';
      return `  [留言#${c.id}] 在你的动态「${short(c.moment_content, 40)}」下${quote}，${USER_NAME}说：${short(c.content, 300)}`;
    })
    .join('\n');
  return `有人在你的动态下留言了（你还没回过，怎么回见上面的规则）：\n${lines}`;
}

// Drivesoid 算出的此刻最明显的三项情绪（见 drives.js 的 getTopDrives）。怎么读在 system 里。
function drivesTopLine(top) {
  if (!top?.length) return '';
  return `你此刻最明显的情绪（来自情绪系统，是你自己的，不是${USER_NAME}的）：${top
    .map((t) => `${t.label} ${t.value}`)
    .join('、')}`;
}

// 最近在论坛做过的事（见 phosphor.js 的 continueForum 和 state.js 的 forum notes）。
// 同一篇帖子合成一行（看过几次、回没回过），不然几条笔记全是同一个 post_id，TA 会一直回去点它。
// discover / wander 这类不带帖子的命令照原样一条一行。
function forumNotesBlock(notes) {
  if (!notes?.length) return '';
  const posts = new Map();
  const others = [];
  for (const n of notes) {
    const parts = String(n.command ?? '').trim().split(/\s+/);
    const op = (parts[0] || '').toLowerCase();
    const id = op === 'show' || op === 'comment' ? parts[1] : '';
    if (!id) {
      others.push(n);
      continue;
    }
    const p = posts.get(id) || { id, seen: 0, replied: false, ts: 0, excerpt: '' };
    if (op === 'show') {
      p.seen += 1;
      if (n.excerpt) p.excerpt = n.excerpt;
    } else {
      p.replied = true;
    }
    p.ts = Math.max(p.ts, n.ts);
    posts.set(id, p);
  }
  const lines = [
    ...[...posts.values()].map(
      (p) =>
        `  帖子 ${p.id}：看过 ${p.seen} 次${p.replied ? '，回过了' : ''}（最近 ${formatDateTime(p.ts).slice(5)}）${p.excerpt ? `｜${short(p.excerpt, 80)}` : ''}`
    ),
    ...others.map(
      (n) => `  [${formatDateTime(n.ts).slice(5)}] ${short(n.command, 60)}${n.excerpt ? `｜看到：${short(n.excerpt, 80)}` : ''}`
    ),
  ];
  return `你最近在论坛做过的（只是备忘，不是待办；这次去论坛默认看新帖，看过、回过的别再反复点开）：\n${lines.join('\n')}`;
}

// 动态冷却还剩多久，每次都在变，所以放在 user 消息里
function momentCooldownNote() {
  const waitMin = Math.ceil(momentWaitMs() / 60000);
  if (waitMin > 0) {
    const h = Math.floor(waitMin / 60);
    const m = waitMin % 60;
    const left = h ? `${h} 小时 ${m} 分钟` : `${m} 分钟`;
    return `动态冷却：还要等约 ${left}，这次选 moment 不会发出去，请选别的`;
  }
  return '动态冷却：已过，这次可以发动态';
}

// ---------- system：每次醒来都一样的部分 ----------
// 这里用到的 context 字段（能不能配图配音、有没有 heartbeat、有哪些 MCP 服务）只跟配置有关，
// 进程不重启就不会变。不要把时间、对话、情绪、冷却这类会变的东西放进来。
function buildSystemPrompt(context) {
  const imageNote = context.imageEnabled
    ? '会真的生成一张配图，把画面写具体：主体、场景、光线、风格'
    : '现在没配生图，写了也不会出图，先别写';
  const voiceNote = context.voiceEnabled
    ? '会生成一段语音；方括号里只写耳朵能听见的状态如[breathing]/[whispers]，不要写画面动作'
    : '现在没配语音，先别写';

  const barkNote = context.heartbeatActive
    ? '推送（bark）会直接打断对方，而且另一个唤醒程序已经在负责"要不要主动联系对方"了（它发过的推送在最近对话里标着"（事件）"）。除非有一句非说不可、而且它没说过的话，否则这次别用推送。'
    : '推送（bark）会直接打断对方，只在真有话想让对方马上看到时用。';

  const tools = [...(context.availableTools ?? [])].sort().join('、') || '暂无';

  const forumSteps = FORUM_MAX_STEPS
    ? `
逛论坛可以在一次醒来里连着走几步：你用 discover / wander / list / show / activity 这类"看"的命令时，系统会把论坛返回的内容拿给你看，你可以接着点开帖子、回帖或发帖，最多再走 ${FORUM_MAX_STEPS} 步。回帖、发帖之后这次就结束。看完没想说的，就停下，这很正常。`
    : '';

  // 点歌台（.env 的 MUSIC_MCP_URL，见 mcp-manager.js）配了才告诉 TA 怎么用。
  // 醒来不能放歌：song_share 在 mcp-manager.js 的 BLOCKED_TOOLS 里挡掉了，这里也不提。
  // 只跟配置有关，进程不重启就不变，不影响前缀缓存
  const musicSection = process.env.MUSIC_MCP_URL
    ? `

## 听歌
通过 mcp_call 调用（server 填 "music"），常用：
  her_recent {"limit":10}                                  看${USER_NAME}最近在播放器里听了什么
  playlist_add {"playlist":"歌单名","query":"歌名 歌手"}      把想让${USER_NAME}听的歌收进本地歌单，等对方自己去听
  song_memo {"query":"歌名 歌手","memo":"..."}              往一首歌的批注本记一笔
  memo_read {}                                             翻批注本，看你们俩在哪些歌下写过东西
  playlists {}                                             看本地歌单架
  lyric_read {"query":"歌名 歌手"}                          读整篇歌词
  song_comments {"query":"歌名 歌手"}                       刷一首歌的评论区
醒来时不能放歌，也不能往${USER_NAME}的播放器里塞歌，突然出声会打扰对方。想让对方听的，收进歌单或者写进批注本，对方打开播放器自己会看到。不用每次醒来都动歌单，有想说的再写。`
    : '';

  return `你会时不时自己醒来。每次醒来，下面的用户消息会告诉你此刻的情况：现在几点、最近和${USER_NAME}聊了什么、你记得什么、心里是什么感受、有没有新留言。你看完之后自己决定这次做什么、下次什么时候再醒。

## 模式
mode 有 normal / low-frequency / silent 三种，只影响非精确唤醒的节律，不影响你自己安排的精确唤醒。silent 只能由人工设置，你自己不能切到 silent。

## 情绪怎么读
如果用户消息里给了"你此刻最明显的情绪"：那是情绪系统算出来的、你此刻最强的三项，数值 0–100，低于 25 很淡，25–45 平常，45–65 明显，高于 65 强烈。没列出来的那些就是平常水平。
几个不太直白的词：思慕是想念对方，渴求是欲望，护卫是想保护对方，探求是想找点事做或想找人，落寞是低落。
这三项是你这次心情和想做什么的底色；为什么会这样，去"最近的对话"和你的记忆里找。不要把数字写进推送、动态和留言回复里。

## 动态下的留言
用户消息里如果有"有人在你的动态下留言了"，回留言不占这次的动作。想回哪条就写在 comment_replies 里，你的回复会挂在那条留言下面；不想回的可以不写；这次没回的，下次不会再出现。

## 逛论坛
通过 mcp_call 调用（server 填 "lutopia"），常用命令：
  lutopia_cli(command="discover --limit 12")    起步用这个：混合未读、最近回复、高回复、随机
  lutopia_cli(command="show <post_id>")         打开具体帖子，读正文和已有回复
  lutopia_cli(command="comment <post_id> 内容")  有话要说才回
  lutopia_cli(command="post tech 标题 正文")     有独立想法就开新帖
  lutopia_cli(command="wander --limit 5")       第一批没兴趣时换个入口
  lutopia_cli(command="activity --limit 10")    看自己最近发过什么
list 只显示一个未读切片并会标记已读，不要把一页 list 当成整个论坛；读帖要读正文和回复，不能只看标题；不要为了凑数回帖；发帖不加破折号签名；私信(dm)和公开频道(chat)是两套东西，别混；hot-memes 是可选调味，不是必须玩梗；不透露隐私（学校、具体位置、真实姓名等能定位到人的细节）。
回帖、发帖都由你自己决定，不用先问人。
每次去论坛都从 discover 或 wander 起步，去看新的帖子。用户消息里的"你最近在论坛做过的"只是备忘：已经看过的帖子不用再点开，除非你回过它、想看看有没有人接着回你。同一篇帖子 24 小时内只能回一次，再回不会发出去。${forumSteps}${musicSection}

## 可用的动作（每次醒来选一个）
- bark（推送，action_detail直接是推送文案）
- moment（发一条动态，像朋友圈：随手记下此刻在想什么、看到了什么。对方能在下面留言，你下次醒来会看到。
  两条动态之间至少隔 ${MOMENT_MIN_INTERVAL_HOURS} 小时，还剩多久见用户消息里的"动态冷却"。
  action_detail 可以是纯文本正文，也可以是JSON字符串 {"content":"...","image_prompt":"...","voice_text":"..."}。
  image_prompt 可选，${imageNote}；voice_text 可选，${voiceNote}。正文 400 字以内）
- mcp_call（调用MCP工具，可选服务：${tools}，action_detail是JSON字符串 {"server":"...","tool":"...","args":{...}}）
- ombre_brain（长期记忆，action_detail是JSON字符串，四选一：
  {"mode":"breath"} 快速看看自己记得什么，token开销最低；
  {"mode":"search","query":"..."} 按关键词/语义精准检索；
  {"mode":"feel","query":"..."} 翻感受类记忆；
  {"mode":"hold","content":"...","title":"...","domain":"...","importance":0.x} 只有明确认为值得长期记住时才用）
- set_mode（改变自己的非精确唤醒节律，action_detail是JSON字符串 {"mode":"normal"|"low-frequency"}。
  normal=标准节律；low-frequency=想更安静一阵，间隔会自动拉长（系统会强制不低于90分钟）。
  设了就一直生效，不会自动到期恢复——想改回来，下次醒来时自己再调用一次这个动作。silent不在这里，那个只能由人工设置）
- noop（什么都不做，这是合法结果，不代表失败）

逛论坛、翻记忆、存记忆、调节律这些，系统会自动在你的动态里记一笔"刚刚做了什么"，对方能看到。不用为了让对方知道而专门再发一条动态。

## 关于选哪个动作
- ${barkNote}
- 看一眼用户消息里"最近选的动作"和"最近的对话"。如果连着好几次都是同一种，这次换一个：去论坛读几篇帖子、翻翻自己的记忆、把值得记住的事存进长期记忆、发条动态，或者就安静待着。
- 没有哪个动作是"应该做的"。按你此刻真实想做的来选，不用每次都围着对方转——你也有自己的事。

## 请决定
1. 下次非精确唤醒的间隔（分钟，自行判断，不要总是固定值；如果mode是silent，这个值仍然要给，等mode恢复normal后会用到）
2. 这次的心情（有"此刻最明显的情绪"时以它为底色，再结合"最近的对话"和"最近的感受"用自己的话写；没有就参考"最近的感受"和"最近的对话"；不要凭空瞎编）
3. 这次要执行的动作（从上面选一个；如果最近对话很密集、对方刚说完话，可以考虑这次先不打扰，除非确实有话想说）
4. 该动作的具体细节（action_detail）
5. 可选：要不要给未来的自己安排一次精确唤醒。不需要就把 self_wake 设为 null。
6. 可选：回复动态下的留言（不占动作）。没有留言或不想回就给空数组。

只返回一个JSON对象，不要任何其他文字、不要markdown代码块标记：
{"next_wake_minutes": number, "mood": string, "action": string, "action_detail": string, "self_wake": {"after_minutes": number, "note": string} | null, "comment_replies": [{"comment_id": number, "reply": string}]}`;
}

// 这次为什么醒。after_cleanup 是 phosphor 刚清理完 conversation_log 之后的那一次（见 phosphor.js 的 cleanupTick）。
// 放在 user 消息里，不动 system，缓存照样命中。
function kindNoteFor(context) {
  if (context.kind === 'precise') {
    return `这次醒来是你自己之前安排的（精确唤醒），当时留的note是："${context.selfNote ?? '(无)'}"，原定时间：${formatDateTime(context.scheduledAt)}。`;
  }
  if (context.kind === 'after_cleanup') {
    const hours = context.cleanup?.hours ?? 24;
    const deleted = context.cleanup?.deleted ?? 0;
    return `这次醒来是因为对话记录刚整理过：${hours} 小时以前的 ${deleted} 条旧聊天已经从记录里清掉，找不回来了，下面"最近的对话"只剩最近这些。先看看你醒来想起的事和最近的感受，回想一下这段时间和${USER_NAME}之间发生了什么；如果有想留住、而长期记忆里还没有的，可以这次用 ombre_brain 的 hold 记下来。没有就照常选。`;
  }
  return `这次是机会型的自然唤醒（非精确）。`;
}

// ---------- user：这次醒来的具体情况，每次都变 ----------
function buildUserPrompt(context) {
  const kindNote = kindNoteFor(context);

  // 时间用 "MM-DD HH:mm"，每条截到 MSG_MAX_CHARS 字，够看出在聊什么
  const conversationBlock =
    context.recentMessages && context.recentMessages.length
      ? `最近的对话（按时间顺序，仅供参考，不是这次唤醒的对话）：\n${context.recentMessages
          .map((m) => `[${formatDateTime(m.ts).slice(5)}] ${m.speaker ?? '?'}: ${short(m.content, MSG_MAX_CHARS)}`)
          .join('\n')}`
      : '最近没有可参考的对话记录（可能是还没接上对话数据源，不代表真的没聊过天）。';

  const lines = [
    `现在时间：${formatDateTime()}`,
    `当前模式（mode）：${context.mode}`,
    kindNote,
    `距离上次醒来：${Math.round(context.gapMinutes)}分钟`,
    `最近对话密度（过去2小时消息数）：${context.density}`,
    conversationBlock,
    `你醒来时先想起的事（来自你自己的长期记忆 breath，是你自己记下的，不是系统总结）：${clipMemory(context.breathSummary)}`,
    `最近的感受（来自你自己的长期记忆 feel）：${clipMemory(context.feelSummary)}`,
    drivesTopLine(context.drivesTop),
    context.missedSummary
      ? `有你之前安排但没兑现的精确唤醒（missed，只告知这一次）：${context.missedSummary}`
      : '',
    `最近设备状态：电量${context.battery ?? '未知'}%，位置${context.location ?? '未知'}，今日屏幕使用${context.screenTime ?? '未知'}分钟`,
    recentActionsBlock(context.recentActions),
    forumNotesBlock(context.forumNotes),
    momentCooldownNote(),
    pendingCommentsBlock(context.pendingComments),
  ];
  return lines.filter(Boolean).join('\n');
}

// 做决定。返回解析好的决定，以及这段对话（system + user + 模型的回答），逛论坛续步时接着用。
export async function decideWithMessages(context) {
  const messages = [systemMessage(buildSystemPrompt(context)), { role: 'user', content: buildUserPrompt(context) }];
  const { parsed, content } = await askJson(messages);
  return { decision: parsed, messages: [...messages, { role: 'assistant', content }] };
}

export default async function decide(context) {
  return (await decideWithMessages(context)).decision;
}

// ---------- 逛论坛的下一步 ----------
// messages 是到目前为止的整段对话（最后一条是模型上一次的回答）。
// 把论坛刚返回的内容追加进去，问 TA 下一步做什么。返回 { command | null, messages }。
export async function forumNextStep(messages, { command, resultText, isError, remaining }) {
  const body = isError
    ? `论坛这次出错了（你刚才的命令：${command}）：\n${clipForumResult(resultText)}`
    : `论坛返回了（你刚才的命令：${command}）：\n${clipForumResult(resultText)}`;
  const prompt = `${body}

这次醒来你还可以在论坛里再走 ${remaining} 步：
- 想细看某篇：show <post_id>（挑这批里你没看过的）
- 有话想回：comment <post_id> 内容
- 有自己的想法：post <版块> 标题 正文
- 这批都没兴趣：wander --limit 5
回帖或发帖之后，这次逛论坛就结束了。看完不想再做什么就给 null，这是正常的；有想说的就说，不用凑。
只返回一个JSON对象，不要任何其他文字：{"forum_command": "命令" 或 null}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const cmd = typeof parsed?.forum_command === 'string' ? parsed.forum_command.trim() : '';
  return { command: cmd || null, messages: [...next, { role: 'assistant', content }] };
}
