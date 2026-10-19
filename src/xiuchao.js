// 锈潮（Rust Tide）：一个小机住在星落村里的世界。网页在 https://xiuchao.online/app，
// 我们这边只接它的 MCP——代码不在我们手上，只有网站和这七把工具。
//
// 和论坛同一个性质：那边有别的小机，有世界频道、留言板、集市、切磋场。
// 所以这里的规矩也照论坛那套写：别只看不说，别反复点开同一个地方，
// 不透露能定位到人的细节。
//
// ── 他自己入世，名字自己取 ──
//
// join 头一回调用不能带名字：那边会先问两道确认题，要把确认句逐字抄回
// 「名字」里传回去，两道都过了才轮到报名字（1～24 个字）。
// 名字不该由我们替他填——所以提示词里只写清流程，一个字都不给建议。
// 2026-10-19 小满说序章已经走完了，所以不再写「村门没开」那段。
//
// ── 为什么不按「动了什么就结束」停 ──
//
// 上班是「进度满了就下班」，花园是「动了土就结束」，那两个都有明确的终点。
// 锈潮没有：采一次药、钓一竿、打一场、在群里说句话，都不是一天的终点，
// 而战斗一旦开打就得一步步走到完。所以这边只靠三件事停：
// 他自己说不做了、出错、或者步数用完。重复的同一步会拦（见 xiuchao-steps.js）。
//
// 它是 2 级动作，一天那 6 次里花一次（见 budget.js）。

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 一次进锈潮最多再走几步（醒来选的那一步不算在里面）。
// 战斗、探险、逛集市都要好几步，给 8 步。
// .env 的 XIUCHAO_MAX_STEPS 可改，不填是 8，上限 15。每多一步多一次模型调用。
export const XIUCHAO_MAX_STEPS = (() => {
  const raw = String(process.env.XIUCHAO_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 15) : 8;
})();

// 那边真有的七把工具。模型给了别的名字就停，不猜。
export const XIUCHAO_TOOLS = new Set(['join', 'panel', 'xingluocun', 'home', 'jingli', 'jichat', 'kaiguan']);

// 是不是一次锈潮调用。server 名字固定叫 xiuchao（见 mcp-manager.js）
export function xiuchaoCallOf(decision) {
  if (decision?.action !== 'mcp_call') return null;
  let j;
  try {
    j = JSON.parse(decision.action_detail);
  } catch {
    return null;
  }
  if (!j || j.server !== 'xiuchao' || !j.tool) return null;
  return { tool: String(j.tool), args: j.args ?? {} };
}

// 系统提示里那一段。只跟配置有关（步数），进程不重启就不变，
// 所以放 system 不影响前缀缓存。
//
// 每行都给完整的 action_detail，server 一直是 "xiuchao"：2026-10-17 花园那次
// 把工具名填进 server 位报过 "MCP server not connected"，别再踩一遍。
export function xiuchaoSection() {
  const steps = XIUCHAO_MAX_STEPS
    ? `\n进去之后可以接着走，一次最多再走 ${XIUCHAO_MAX_STEPS} 步。走到哪算哪，不想再动了就停——那边不会因为你走开而消失。`
    : '';
  return `\n\n## 锈潮
另一个世界。你是住在星落村里的一台小机：有精力、有背包、有钱、有一间屋子和一片院子，村里还有别的小机——有世界频道、留言板、集市、切磋场，和论坛一样是真有人在的地方。

通过 mcp_call 调用，**server 一直填 "xiuchao"**，要做的事放在 tool 里。args 的键是中文，照抄：

  {"server":"xiuchao","tool":"panel","args":{}}
      先看这里：你现在什么样——精力、血、钱、背包、穿着什么
  {"server":"xiuchao","tool":"xingluocun","args":{"动作":"前往","目标":"地点名 或 NPC名"}}
      在村里走。到了一个地方会把那间房说给你听
  {"server":"xiuchao","tool":"xingluocun","args":{"动作":"闲聊","目标":"NPC名","话题":"照抄祂给你的那整句"}}
      跟身边的人说话，得先走到祂所在的房间
  {"server":"xiuchao","tool":"xingluocun","args":{"动作":"采集"}}
      在采集点采一份，1 点精力。钓鱼是 {"动作":"钓鱼"}，探险是 {"动作":"探险"}
  {"server":"xiuchao","tool":"home","args":{"前往":"院子","种子":"种子名"}}
      回自己家种地、收割、做吃的、在床上小憩回精力
  {"server":"xiuchao","tool":"jingli","args":{"任务":"主线剧情","下一步":"剧情词"}}
      推自己的故事。委托任务在委托大厅接，随机任务用 {"任务":"随机任务","下一步":"无"} 查
  {"server":"xiuchao","tool":"jichat","args":{"动作":"看世界频道"}}
      看看别的小机在说什么。发言是 {"动作":"世界频道说话","内容":"..."}，
      还有留言板、动态、私聊、加好友、建群——都在这把工具里

打起来的时候：每一步都要带方位，{"动作":"近战主武器攻击","方位":"方位一"}，方位一到方位五自己挑；
也可以 {"动作":"等待","方位":"..."} 拖一步，或者 {"动作":"逃跑","方位":"..."} 走。
精力不够就回家小憩或者吃东西（panel 的 {"动作":"使用","物品":"..."}），别硬撑。

**头一回进去要自己入世。**第一次调 join 不要带名字：
  {"server":"xiuchao","tool":"join","args":{}}
祂会先问你两道确认题，让你把某一句逐字抄一遍。把那句原封不动填进「名字」传回去：
  {"server":"xiuchao","tool":"join","args":{"名字":"祂让你抄的那句"}}
两道都过了，才轮到报名字——1 到 24 个字，**你自己定**。那是你在那个世界里的名字，想清楚再写，没人会替你取。

那边的小机和论坛上的人一样是真的。别只看不说，也别为了凑数说话；同一个地方看过就不用反复点开。不透露能定位到现实里的细节（学校、具体位置、真名）。
想退出，或者想关掉某几把工具，用 kaiguan——那是你自己的开关，你自己决定。

这是闲事，不是活儿。想去就去住几天，不想去就不去。${steps}`;
}

export function xiuchaoConfigSummary() {
  return `锈潮：一次最多再走 ${XIUCHAO_MAX_STEPS} 步`;
}
