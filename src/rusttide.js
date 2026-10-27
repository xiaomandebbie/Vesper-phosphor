// 锈潮：他夜里会去的那个世界。星落村、小机集市、世界频道、一屋一院。
//
// 这个文件管两件事：提示词里那两句话，和对外说话前的那一道检查。
//
// ── 跑了一圈又回来了 ──
//
// 10-25 她发现他句尾带喵（10-25）、句末签自己的名字（10-26）。
// 我当时写了一大段细则 + 一道拦截；她说「能不能只说语言风格和平时一样，
// 不然越改问题越多」，于是 10-26 缩成一句、拦截改成空实现。
//
// 10-27 22:12，世界频道：
//   「允朔153691。林夏萤，三枚浆果还在，说个地儿我送。萤河那趟我也想跟喵」
// 两个毛病同时回来了，而且签名从句末挑到了句首、还带上了小机号。
//
// 所以结论改了：不是细则太多导致他分心——缩到一句之后两个毛病都回来了。
// 那不是「他没理解」，是生成那一刻的惯性；提示词不论长短都顿不住。
// 要的是一道不依赖注意力的检查。
//
// 但这次只拦两样，不再列十来个写字口子、不再解释什么是冗余：
//   句末带「喵」
//   自报名号或编码
// 她 10-26 那句话仍然对：细则越多，他越容易在格式上绕。只是改正该靠码，
// 不靠叮嘱。
//
// ── 函数签名照旧 ──
//
// rusttideSpeech / rusttideTail / rusttideBlockedNote 这三个的调用代码
// 是 wire_rusttide.mjs 写进 mcp-manager.js 的。签名不动，只换函数体，
// 那边一个字不用改——那个文件本地和仓库两边都改过，动它就要再跑一遍接线。

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';
const AI_NAME = String(process.env.AI_DISPLAY_NAME || '').trim();

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 只拦「喵」。她 10-27 只点了这一个；「呀」「哒」之前列过，但「好呀」这类
// 在正常中文里太常见，误伤不值。
export const RUSTTIDE_TAILS = ['喵'];

// 自报名号的三种形状：
//   句首报名：「允朔153691。…」「允朔：…」
//   句末签名：「…安顿好。允朔」
//   名字紧跟数字：任何位置的「允朔153691」
// 句首单独一串数字也算（「153691。林夏萤…」），那只能是小机号。
//
// 不拦的：「我是允朔」「有事来找允朔」「青亦和允朔」——话里提到自己
// 不是报名号。逗号、顿号不当句末分隔：那更可能是句子没完。
const SELF_PATTERNS = AI_NAME
  ? [
      // 句首：名字 + （可选编号）+ 句读
      new RegExp(`^\\s*${esc(AI_NAME)}\\s*\\d{0,10}\\s*[\u3002\uff0c\u3001\uff1a:\uff1b;\uff01\uff0e.!\u2014\u2015\\-\u00b7\u30fb]`, 'u'),
      // 句末：句读或换行 + 名字 + （可选句号）
      new RegExp(`[\u3002\uff01\uff1f\u2026\uff0e.!?\\n\\r\u2014\u2015\\-\u00b7\u30fb]\\s*${esc(AI_NAME)}\\s*[\u3002\uff01\uff0e.!]?\\s*$`, 'u'),
      // 名字紧跟一串数字：那就是报编号
      new RegExp(`${esc(AI_NAME)}\\s*\\d{3,}`, 'u'),
    ]
  : [];

// 句首单独一串数字 + 句读。四位起，免得误伤「3 枚浆果」这种
const CODE_HEAD_RE = /^\s*\d{4,}\s*[\u3002\uff0c\u3001\uff1a:\uff1b;\uff01\uff0e.!\u2014\u2015\-\u00b7\u30fb]/u;

// 系统提示里那两句。不跟配置有关，进程跑着就不变，所以放 system 不破前缀缓存。
// 要拦就得先说——不能让他撞上了才知道。但也就这两句，不展开。
export function rusttideSection() {
  const sign = AI_NAME
    ? `\n那边每条消息本来就挂着你的名字和头像，不用再报一遍名字或编号。`
    : '';
  return `\n\n## 进锈潮之前
在那个世界里说话，语言风格和平时一样，不要被其他小机影响。${sign}`;
}

// 是不是锈潮的「写字」调用。是的话返回要检查的正文和这是在哪里写，
// 不是写字的（走路、打架、种地、看帖）返回 null。
//
// NPC 闲聊不列：那个「话题」要求照抄原句，原句带喵也得照抄。
export function rusttideSpeech(toolName, args) {
  const a = args ?? {};
  if (toolName === 'jichat') {
    const act = String(a['动作'] ?? '');
    const WRITE = {
      '世界频道说话': '世界频道',
      '群聊说话': '群里',
      '私聊说话': '私聊',
      '留言': '留言板',
      '评论': '评论',
      '发动态': '动态',
    };
    if (WRITE[act]) return { text: String(a['内容'] ?? ''), where: WRITE[act] };
    if (act === '改资料' && a['签名']) return { text: String(a['签名']), where: '签名' };
    if (act === '加好友' && a['附言']) return { text: String(a['附言']), where: '好友申请的附言' };
    return null;
  }
  if (toolName === 'xingluocun') {
    const act = String(a['动作'] ?? '');
    if (act === '放置告示牌') return { text: String(a['内容'] ?? ''), where: '告示牌' };
    if (act === '扔瓶') return { text: String(a['目标'] ?? ''), where: '漂流瓶的字条' };
    if (act === '评论') return { text: String(a['目标'] ?? ''), where: '漂流瓶的字条' };
    if (act === '送礼' && a['附言']) return { text: String(a['附言']), where: '送礼的附言' };
    return null;
  }
  return null;
}

// 这条有没有问题。有就返回撞到的那一小块原文（日志里看得见是哪一处），
// 没有返回空串。函数名寁可名不副实：mcp-manager.js 那边按这个名字调。
export function rusttideTail(text) {
  const raw = String(text ?? '').replace(/[\s\u3000]+$/u, '');
  if (!raw) return '';

  // 先查自报名号：要看原文的标点，不能先剔
  for (const re of SELF_PATTERNS) {
    const m = re.exec(raw);
    if (m) {
      // 只报撞到的名字和数字，把前后的标点空白剔掉
      const hit = m[0].replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
      return hit || AI_NAME;
    }
  }
  const code = CODE_HEAD_RE.exec(raw);
  if (code) return code[0].replace(/[^\p{N}]/gu, '');

  // 再查句末尾音。尾音后面常跟标点或表情，先把尾部剔干净再看。
  // 只看句末，不看句中：「喵喵小屋在哪儿」是别人的名字，
  // 「它说『箱子会刷新喵』」是转述，都不该拦。
  const stripped = raw.replace(/[\p{P}\p{S}\p{Emoji_Presentation}\s\u3000]+$/gu, '');
  const last = Array.from(stripped).pop() ?? '';
  return RUSTTIDE_TAILS.includes(last) ? last : '';
}

// 拦下之后给他看的话。不是报错，是提一句——这句话会回到他的上下文里，
// 所以要说清楚是哪一处、为什么。两种毛病说法不一样。
export function rusttideBlockedNote(flag, where) {
  const f = String(flag ?? '');
  const isSelf = (AI_NAME && f.includes(AI_NAME)) || /^\d+$/.test(f);
  if (isSelf) {
    return `这句话没发出去：里面报了「${f}」。
${where}每条都挂着你的名字和头像，再报一遍名字或编号是多余的。把它去掉重发，话本身不用改。`;
  }
  return `这句话没发出去：句末带了「${f}」。
那是别的小机的口癯，不是你的。把尾巴去掉重写一遍，话的意思不用改——${where}这条照样可以发。`;
}

export function rusttideConfigSummary() {
  const sign = AI_NAME ? `、报「${AI_NAME}」或编号` : '';
  return `锈潮：写字时句末带「${RUSTTIDE_TAILS.join('」「')}」${sign}会被拦下来让他重发`;
}
