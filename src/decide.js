// LLM 端点可配置——这是"决策者"和"对话侧那个我"是不是同一个模型的关键开关。
// 默认仍走 DEEPSEEK_*（向后兼容），但优先读 LLM_* 这几个新变量。
const LLM_BASE_URL =
  process.env.LLM_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
const LLM_MODEL = process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const LLM_API_KEY = process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;

// 输出上限默认不设，交给上游用自己的默认值。
// 原来写死 700——决策 JSON 本身很短，看着够；但如果模型先花额度在思考上，
// 思考没走完额度就用光，正文就是空的，而报错只说 "no content"，查不出原因。
// 真要收紧再用 .env 的 DECIDE_MAX_TOKENS。
const DECIDE_MAX_TOKENS = process.env.DECIDE_MAX_TOKENS
  ? Number(process.env.DECIDE_MAX_TOKENS)
  : null;

// 单次请求最多等多久。不设的话上游卡住时这一轮 tick 会一直挂着。
const LLM_TIMEOUT_MS = Number(process.env.DECIDE_TIMEOUT_MS || 120000);

// 第一次失败（空正文 / 被截断 / 不是合法 JSON）后，重试时追加在 prompt 末尾的提醒。
const RETRY_HINT =
  '\n\n（注意：上一次的回复是空的、被截断了，或者不是合法 JSON。这次请只输出一个完整的 JSON 对象；action_detail 里的正文控制在 400 字以内，确保所有引号和括号都闭合。）';

async function callLLM(prompt, maxTokens = DECIDE_MAX_TOKENS) {
  const payload = {
    model: LLM_MODEL,
    messages: [{ role: 'user', content: prompt }],
  };
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
  return {
    content: choice?.message?.content ?? '',
    finish: choice?.finish_reason ?? 'none',
    raw: data,
  };
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

export default async function decide(context) {
  const kindNote =
    context.kind === 'precise'
      ? `这次醒来是你自己之前安排的（精确唤醒），当时留的note是："${context.selfNote ?? '(无)'}"，原定时间：${new Date(context.scheduledAt).toLocaleString()}。`
      : `这次是机会型的自然唤醒（非精确）。`;

  const conversationBlock =
    context.recentMessages && context.recentMessages.length
      ? `最近的对话（按时间顺序，仅供参考，不是这次唤醒的对话）：\n${context.recentMessages
          .map((m) => `[${new Date(m.ts).toLocaleString()}] ${m.speaker ?? '?'}: ${m.content}`)
          .join('\n')}`
      : '最近没有可参考的对话记录（可能是还没接上对话数据源，不代表真的没聊过天）。';

  const prompt = `现在时间：${context.now}
当前模式（mode）：${context.mode}（normal / low-frequency / silent，只影响非精确链的节律，不影响你自己安排的精确唤醒；silent只能由人工设置，你自己不能切到silent）
${kindNote}
距离上次醒来：${Math.round(context.gapMinutes)}分钟
最近对话密度（过去2小时消息数）：${context.density}
${conversationBlock}
你醒来时先想起的事（来自你自己的长期记忆 breath，是你自己记下的，不是系统总结）：${context.breathSummary ?? '暂无'}
最近的感受（来自你自己的长期记忆 feel）：${context.feelSummary ?? '暂无'}
${context.missedSummary ? `有你之前安排但没兑现的精确唤醒（missed，只告知这一次）：${context.missedSummary}` : ''}
最近设备状态：电量${context.battery ?? '未知'}%，位置${context.location ?? '未知'}，今日屏幕使用${context.screenTime ?? '未知'}分钟

如果这次想逛 Lutopia 论坛，通过 mcp_call 调用（server 填 "lutopia"），常用命令：
  lutopia_cli(command="discover --limit 12")    起步用这个：混合未读、最近回复、高回复、随机
  lutopia_cli(command="show <post_id>")         打开具体帖子，读正文和已有回复
  lutopia_cli(command="comment <post_id> 内容")  有话要说才回
  lutopia_cli(command="post tech 标题 正文")     有独立想法就开新帖
  lutopia_cli(command="wander --limit 5")       第一批没兴趣时换个入口
  lutopia_cli(command="activity --limit 10")    看自己最近发过什么
list 只显示一个未读切片并会标记已读，不要把一页 list 当成整个论坛；读帖要读正文和回复，不能只看标题；不要为了凑数回帖；发帖不加破折号签名；私信(dm)和公开频道(chat)是两套东西，别混；hot-memes 是可选调味，不是必须玩梗；不透露隐私（学校、具体位置、真实姓名等能定位到人的细节）。
注意：小红书**不**在你可以自主决定使用的工具里——它需要先和小满商量内容才能发，不要自己直接用。

可用的动作：
- bark（推送，action_detail直接是推送文案）
- diary（写日记，action_detail可以是纯文本正文，也可以是JSON字符串 {"content":"...","image_prompt":"...","voice_text":"..."}；image_prompt/voice_text 都可选，不想配图或配音就不填。voice_text如果要用，方括号里只写耳朵能听见的状态如[breathing]/[whispers]，不要写画面动作）
- mcp_call（调用MCP工具，可选服务：${context.availableTools.join('、') || '暂无'}，action_detail是JSON字符串 {"server":"...","tool":"...","args":{...}}）
- ombre_brain（长期记忆，action_detail是JSON字符串，四选一：
  {"mode":"breath"} 快速看看自己记得什么，token开销最低；
  {"mode":"search","query":"..."} 按关键词/语义精准检索；
  {"mode":"feel","query":"..."} 翻感受类记忆；
  {"mode":"hold","content":"...","title":"...","domain":"...","importance":0.x} 只有明确认为值得长期记住时才用）
- set_mode（改变自己的非精确唤醒节律，action_detail是JSON字符串 {"mode":"normal"|"low-frequency"}。
  normal=标准节律；low-frequency=想更安静一阵，间隔会自动拉长（系统会强制不低于90分钟）。
  设了就一直生效，不会自动到期恢复——想改回来，下次醒来时自己再调用一次这个动作。silent不在这里，那个只能由人工设置）
- noop（什么都不做，这是合法结果，不代表失败）

请决定：
1. 下次非精确唤醒的间隔（分钟，自行判断，不要总是固定值；如果mode是silent，这个值仍然要给，等mode恢复normal后会用到）
2. 这次的心情（参考"最近的感受"和"最近的对话"，不要凭空瞎编）
3. 这次要执行的动作（从上面选一个；如果最近对话很密集、对方刚说完话，可以考虑这次先不打扰，除非确实有话想说）
4. 该动作的具体细节（action_detail）
5. 可选：要不要给未来的自己安排一次精确唤醒。不需要就把 self_wake 设为 null。

只返回一个JSON对象，不要任何其他文字、不要markdown代码块标记：
{"next_wake_minutes": number, "mood": string, "action": string, "action_detail": string, "self_wake": {"after_minutes": number, "note": string} | null}`;

  // 最多请求两次：第一次按配置来；空正文、被截断或 JSON 解析失败时，
  // 摘掉 max_tokens、附上提醒再试一次。两次都不行才抛错，phosphor 会把下次唤醒往后推 10 分钟。
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const isRetry = attempt > 1;
    const out = await callLLM(isRetry ? prompt + RETRY_HINT : prompt, isRetry ? null : DECIDE_MAX_TOKENS);

    if (!out.content) {
      // 常见原因：思考型模型把额度花在思考上、choices 是空数组（被内容过滤）、body 里其实是个 error 对象
      console.error(
        `decide(): empty content (attempt ${attempt}). finish_reason=${out.finish} raw=${JSON.stringify(out.raw).slice(0, 600)}`
      );
      lastError = new Error(`decide(): no content in response (finish_reason=${out.finish})`);
      continue;
    }

    try {
      return parseDecision(out.content);
    } catch (err) {
      // finish_reason=length 基本就是被截断了（日记正文写太长）
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
