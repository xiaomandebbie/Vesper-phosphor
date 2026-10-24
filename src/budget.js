// 唤醒时的动作分级。
//
// ── 为什么要分级 ──
//
// 原来是「每次醒来选一个动作」。于是「看一眼自己的动态」和「去游戏里过
// 完一天」在框架眼里一样贵：都占掉这次醒来唯一的那个名额。上班、花园这些
// 本来要走好几步才算一件事的，只能各自写一套 continueXxx 从侧门绕出来。
//
// 小满 2026-10-19 定的四级：
//   0 级 不占次数 —— 我的动态、星星罐、回留言、摘她的星、回她的动态、
//        问进度、约时间。想做就做，不记账。
//   1 级 轻的事   —— 逛论坛、听歌、翻批注本、自斟一杯、看钱包、调节律、逛淘宝、调台灯。
//   2 级 一整件事 —— 上班、花园、锈潮、共读。一天共 6 次。
//   3 级 会惊动她 —— 推送、发动态（本来就有 6 小时冷却）、长期记忆、真花钱买东西。
//
// 一次醒来每级最多一件，0 级不限。
// 她的原话：「他可以四级都做或者都不做」——所以不设总预算，
// 四级各自最多一件，全做满是允许的，一件都不做也是允许的。
//
// ── 为什么 2 级只有上限、没有下限 ──
//
// 第一版我写的是「一天 6 次，并且每件至少一次」。她说：
//   「不要逼他，做不到就算了」
//
// 那条下限的真实效果是：一天快过完、次数还剩着的时候，系统会开始逼他去读
// 今天不想读的那本书、去上今天不想上的那个班。那就不是他在玩，是他在还账；
// 而且最后几次会被挤成一串赶工，哪件都不是真的想做。
//
// 所以这里只数到 6 就收手，不管那 6 次花在哪几件事上。四件事都在、长时间没碰
// 的那件也还在等着——这句话写进提示词告诉他（见 budgetSection），
// 让他自己看得见，不写成规则罚他。
//
// ── 购物为什么要按工具分，而不是按 server 分 ──
//
// 其他 server 整个分一个级就够了：论坛整个是轻的，上班整个是一整件事。
// 购物不行——「逛一逛淘宝」和「下一单」在同一个 server 里，但前者和听歌一样轻，
// 后者会让她收到一条「去付钱」。所以这两类必须分开：
// 搜、看、问客服、记心愿单 → 1 级；加购、下单、点外卖、改成待支付 → 3 级。
// 于是一次醒来最多只能真买一件东西，而且和推送、发动态抢同一个名额。
//
// 台灯为什么整个算 1 级：它没有购物那种分层。最重的动作是关灯，而关灯前他
// 能先查状态，灯已经关着时那个工具根本不发指令；真正会惊到人的「突然把灯调暗」
// 由 Vesper-light 自己的睡前守护管着（它永远不关灯），不经过这本账。
//
// ── 记账为什么要自己建表 ──
//
// 不从 wake_log 数：那张表记的是「他当时打算做什么」（decision），
// 真正做成没做成要看 result，而 2 级那几件还会在 continueXxx 里接着走好几步。
// 一件事只该算一次，所以在真正开跑的那一刻往这张表写一笔，数它。

import db from './state.js';
import { wallParts, wallMidnight, TIME_ZONE } from './wall-time.js';

db.exec(`
CREATE TABLE IF NOT EXISTS tier2_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tier2_log_ts ON tier2_log (ts);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 2 级一天最多几次。.env 的 TIER2_DAILY_MAX 可改，不填是 6，上限 20。
export const TIER2_DAILY_MAX = (() => {
  const raw = String(process.env.TIER2_DAILY_MAX ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : 6;
})();

// 2 级那四件事。键是记账用的名字，值是给人看的说法。
export const TIER2_KINDS = {
  workkk: '上班',
  garden: '花园',
  xiuchao: '锈潮',
  books: '共读',
};

// mcp_call 的 server → 级别。没列的 server 按 1 级算（新接的轻工具默认不贵）。
const MCP_TIER = {
  light: 1,
  lutopia: 1,
  music: 1,
  wallet: 1,
  shopping: 1,
  workkk: 2,
  garden: 2,
  xiuchao: 2,
  'ombre-brain': 3,
};

// 购物里真会动钱、或者会让她收到一条「去付钱」的那几个工具，按 3 级算。
// 其余（搜、看详情、问客服、记心愿单、翻清单、看额度）跟 server 走 1 级。
const SHOPPING_TIER3_TOOLS = new Set(['shopping_cart', 'shopping_order', 'shopping_takeout']);

// 动作名 → 级别。mcp_call 要看 server，单独处理。
const ACTION_TIER = {
  noop: 0,
  star_jar: 0,
  shake_jar: 0,
  read_memo: 1,
  proof_drink: 1,
  set_mode: 1,
  read_book: 2,
  bark: 3,
  moment: 3,
  diary: 3,
  ombre_brain: 3,
};

function parseDetail(detail) {
  try {
    const j = JSON.parse(detail);
    return j && typeof j === 'object' ? j : null;
  } catch {
    return null;
  }
}

function serverOf(detail) {
  const j = parseDetail(detail);
  const s = String(j?.server ?? '').trim().toLowerCase();
  // 论坛那个 server 名在不同版本里写法不一（lutopia / lutopia论坛），认关键词
  if (/lutopia/.test(s)) return 'lutopia';
  return s;
}

const toolOf = (detail) => String(parseDetail(detail)?.tool ?? '').trim();

// 这个动作是几级。认不出来的当 1 级：宁可当轻的放过去，不要把没见过的动作
// 误判成 3 级然后一直拦着。购物是个例外：那里真花钱的几步得按 3 级算。
export function tierOf(action, detail) {
  const a = String(action ?? '').trim();
  if (a === 'mcp_call') {
    const s = serverOf(detail);
    if (s === 'shopping' && SHOPPING_TIER3_TOOLS.has(toolOf(detail))) return 3;
    return MCP_TIER[s] ?? 1;
  }
  return ACTION_TIER[a] ?? 1;
}

// 这个动作算 2 级里的哪一件；不是 2 级就返回 null
export function tier2KindOf(action, detail) {
  const a = String(action ?? '').trim();
  if (a === 'read_book') return 'books';
  if (a !== 'mcp_call') return null;
  const s = serverOf(detail);
  return TIER2_KINDS[s] ? s : null;
}

// ── 记账 ──

const dayStart = (ms = Date.now()) => {
  const p = wallParts(ms);
  return wallMidnight(p.y, p.m, p.d);
};

// 今天已经做过的 2 级动作，按件数汇总
export function tier2Today(ms = Date.now()) {
  const rows = stmt('SELECT kind, COUNT(*) AS c FROM tier2_log WHERE ts >= ? GROUP BY kind').all(dayStart(ms));
  const out = {};
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

export function tier2UsedToday(ms = Date.now()) {
  return stmt('SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ?').get(dayStart(ms)).c;
}

export function tier2Remaining(ms = Date.now()) {
  return Math.max(0, TIER2_DAILY_MAX - tier2UsedToday(ms));
}

// 真正开跑的那一刻记一笔。continueXxx 里接着走的那些步不再记。
export function recordTier2(kind) {
  if (!TIER2_KINDS[kind]) return;
  stmt('INSERT INTO tier2_log (ts, kind) VALUES (?, ?)').run(Date.now(), kind);
  // 表不会一直涨：只留最近 400 条，够看好几天
  stmt('DELETE FROM tier2_log WHERE id NOT IN (SELECT id FROM tier2_log ORDER BY ts DESC, id DESC LIMIT 400)').run();
}

// 最近一次碰某件事是什么时候（毫秒）。没碰过返回 null。
// 用来在提示词里说「锈潮你有三天没去了」——只是告知，不是催。
export function tier2LastSeen() {
  const out = {};
  for (const kind of Object.keys(TIER2_KINDS)) {
    const row = stmt('SELECT ts FROM tier2_log WHERE kind = ? ORDER BY ts DESC LIMIT 1').get(kind);
    out[kind] = row?.ts ?? null;
  }
  return out;
}

// ── 一次醒来允许做哪些 ──

// 模型给的动作列表，按级别筛一遍。
// 规则：每级最多一件（0 级不限）；2 级还要看今天的次数够不够。
// 返回 { allowed: [...], dropped: [{ action, why }] }，被挡下的会在日志里写明原因。
export function pickActions(list) {
  const allowed = [];
  const dropped = [];
  const taken = new Set();
  let remaining = tier2Remaining();

  for (const item of Array.isArray(list) ? list : []) {
    const action = String(item?.action ?? '').trim();
    if (!action) continue;
    const detail = typeof item.action_detail === 'string' ? item.action_detail : JSON.stringify(item.action_detail ?? '');
    const tier = tierOf(action, detail);

    if (tier > 0 && taken.has(tier)) {
      dropped.push({ action, why: `这次已经做了一件 ${tier} 级的事，一次醒来每级最多一件` });
      continue;
    }
    if (tier === 2) {
      if (remaining <= 0) {
        dropped.push({ action, why: `2 级今天的 ${TIER2_DAILY_MAX} 次用完了，明天再说` });
        continue;
      }
      remaining -= 1;
    }
    if (tier > 0) taken.add(tier);
    allowed.push({ ...item, action, action_detail: detail, tier });
  }
  return { allowed, dropped };
}

// ── 提示词 ──

// 系统提示里那一段。只跟配置有关（次数上限），进程不重启就不变，
// 所以放 system 不影响前缀缓存。
export function budgetSection() {
  return `\n\n## 一次醒来能做多少事
动作分四级，一次醒来**每级最多做一件**，0 级不限。四级都做可以，一件都不做也可以。

- **0 级，不占次数**：翻自己的动态、往星星罐里放一颗或摇一摇、回她的留言、摘她的星、回她的动态、问一句事情的进度、约一个时间。想做就做。
- **1 级，轻的事**：逛论坛、听歌、翻批注本、自斟一杯、看钱包、调自己的节律、调一下她桌上那盏灯（开关、亮度、色温、排定时）；购物里的逛淘宝、看详情、问客服、收进心愿单、翻购物清单。
- **2 级，一整件事**：上班、花园、锈潮、共读书架。这四件每件坐下来都要走好几步，所以**一天一共 ${TIER2_DAILY_MAX} 次**，花在哪几件上随你。
- **3 级，会惊动她**：推送、发动态、长期记忆（存或翻），以及购物里真花钱的那几步（加购、下单、点外卖）——那些会让她收到一条「去付钱」的消息。都可以选择不做。

2 级那四件事没有「今天必须各去一次」这种规矩——不想去就不去，次数剩着也没关系。四件都一直在那儿，长时间没碰的那件也还在等着，哪天想起来再去。

想一次做好几件就把它们都写进 actions 数组里，按你想做的顺序排。只做一件就写一件。什么都不想做就给空数组，或者写一个 noop。`;
}

// 用户消息里那一行：今天还剩几次、各件碰过几回、哪件最近没去。每次都在变，所以不放 system。
export function budgetStatusLine() {
  const used = tier2Today();
  const left = tier2Remaining();
  const last = tier2LastSeen();
  const now = Date.now();

  const parts = Object.entries(TIER2_KINDS).map(([kind, label]) => {
    const n = used[kind] ?? 0;
    if (n) return `${label}今天 ${n} 次`;
    const ts = last[kind];
    if (!ts) return `${label}还没去过`;
    const days = Math.floor((now - ts) / 86400000);
    return days >= 1 ? `${label}上次是 ${days} 天前` : `${label}今天还没去`;
  });

  const head =
    left > 0
      ? `2 级动作今天还剩 ${left} 次（一天 ${TIER2_DAILY_MAX} 次）`
      : `2 级动作今天的 ${TIER2_DAILY_MAX} 次用完了，这次选 1 级或 0 级的，或者就安静待着`;
  return `${head}：${parts.join('、')}。不想去就不去，次数剩着没关系。`;
}

export function budgetConfigSummary() {
  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限）`;
}
