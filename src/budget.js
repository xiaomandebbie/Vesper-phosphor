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
//   1 级 轻的事   —— 逛论坛、听歌、翻批注本、自斟一杯、看钱包、调节律。
//   2 级 一整件事 —— 上班、花园、锈潮、共读。一天共 6 次。
//   3 级 会惊动她 —— 推送、发动态（本来就有 6 小时冷却）、长期记忆。
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
// 所以这里只数到 6 就收手，不管那 6 次花在哪几件上。四件事都在、长时间没碰
// 的那件也还在等着——这句话写进提示词告诉他（见 budgetSection），
// 让他自己看得见，不写成规则罚他。
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

// 读书单算一本账，所以单开一张表。
// 不混进 tier2_log：那张表的行数就是 2 级今天用掉的次数，读书插进去会把它顶满。
db.exec(`
CREATE TABLE IF NOT EXISTS books_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_books_log_ts ON books_log (ts);
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

// 读书一天最多几回。.env 的 BOOKS_DAILY_MAX 可改，不填是 5，上限 20。
// 这 5 回和 2 级那 6 次是两本账，互不相干。
export const BOOKS_DAILY_MAX = (() => {
  const raw = String(process.env.BOOKS_DAILY_MAX ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : 5;
})();

// 2 级那三件事。键是记账用的名字，值是给人看的说法。
export const TIER2_KINDS = {
  workkk: '上班',
  garden: '花园',
  xiuchao: '锈潮',
};

// mcp_call 的 server → 级别。没列的 server 按 1 级算（新接的轻工具默认不贵）。
const MCP_TIER = {
  lutopia: 1,
  music: 1,
  wallet: 1,
  workkk: 2,
  garden: 2,
  xiuchao: 2,
  'ombre-brain': 0,
};

// 动作名 → 级别。mcp_call 要看 server，单独处理。
const ACTION_TIER = {
  noop: 0,
  star_jar: 0,
  shake_jar: 0,
  read_memo: 1,
  proof_drink: 1,
  set_mode: 1,
  // 读书不占 2 级那几次，但有自己的一天 BOOKS_DAILY_MAX 回（小满 2026-10-19：
  // 「读书可读可不读+一天最多5次」）。原本它在 2 级，和上班、花园、锈潮抢一天 6 次，
  // 他每次都选读书，别的三件全被挤掉；完全不计费又会变成每次醒来都读。
  // 所以单给它一本账，记在 books_log 里，见下面 booksRemaining。
  read_book: 0,
  bark: 3,
  moment: 3,
  diary: 3,
  // 存记忆一声不响，谁也不惊动，所以不属于 3 级。原来和 bark、moment 抢同一个名额，
  // 那种比较他每次都会选动态（小满 2026-10-19：「定时存记忆还是很重要的」）。
  // 现在跟 read_book 一样走 ONCE：不占名额，但一次醒来最多一件。
  ombre_brain: 0,
};

// 单算一本账的动作：不占任何级别的次数，有自己的一天几回，一次醒来最多一件。
//
// 0 级本来不限件数——那些都是看一眼动态、摆一颗星这类极轻的事。读书不同：
// 它不该占 2 级那 6 次，却也不能随便读（每翻一小段都是一次模型调用）。
const ONCE = new Set(['read_book', 'ombre_brain']);

function serverOf(detail) {
  try {
    const j = JSON.parse(detail);
    const s = String(j?.server ?? '').trim().toLowerCase();
    // 论坛那个 server 名在不同版本里写法不一（lutopia / lutopia论坛），认关键词
    if (/lutopia/.test(s)) return 'lutopia';
    return s;
  } catch {
    return '';
  }
}

// 这个动作是几级。认不出来的当 1 级：宁可当轻的放过去，不要把没见过的动作
// 误判成 3 级然后一直拦着。
export function tierOf(action, detail) {
  const a = String(action ?? '').trim();
  if (a === 'mcp_call') {
    const s = serverOf(detail);
    return MCP_TIER[s] ?? 1;
  }
  return ACTION_TIER[a] ?? 1;
}

// 这个动作算 2 级里的哪一件；不是 2 级就返回 null
export function tier2KindOf(action, detail) {
  const a = String(action ?? '').trim();
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
  const rows = stmt('SELECT kind, COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind != \'books\' GROUP BY kind').all(dayStart(ms));
  const out = {};
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

export function tier2UsedToday(ms = Date.now()) {
  return stmt('SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind != \'books\'').get(dayStart(ms)).c;
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

// ── 读书单算一本账 ──
//
// 小满 2026-10-19：「读书可读可不读+一天最多5次」
//
// 为什么不占 2 级的次数：读书原本在 2 级，和上班、花园、锈潮抢一天 6 次，
// 他每次都选读书，别的三件全被挤掉。
// 为什么不干脆不计费：那就变成每次醒来都读——只是换了个毛病。
// 为什么是额度不是冷却：冷却是硬隔断，到点才准读；额度是他自己分配，
// 想今天连读三回、明天一回不读都行。她的原话是「不要钉死，给他一点自由度」。
//
// 和 2 级一样只设上限、不设下限：5 回用不完不催，一次不读也不罚。

export function booksUsedToday(ms = Date.now()) {
  return stmt('SELECT COUNT(*) AS c FROM books_log WHERE ts >= ?').get(dayStart(ms)).c;
}

export function booksRemaining(ms = Date.now()) {
  return Math.max(0, BOOKS_DAILY_MAX - booksUsedToday(ms));
}

// 真正往下读了那一刻记一笔。books-steps.js 里接着翻的那几小段不再记——
// 一次坐下只算一回，不然连翻五段就把一天读完了。
export function recordBookRead() {
  stmt('INSERT INTO books_log (ts) VALUES (?)').run(Date.now());
  stmt('DELETE FROM books_log WHERE id NOT IN (SELECT id FROM books_log ORDER BY ts DESC, id DESC LIMIT 200)').run();
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

// read_book 的四种用法里，只有「往下读」算一回。
// 看一眼书架、在书边写一笔、回她一句批注都不扣：那几样轻，而且写批注和回她
// 恰恰是共读里最要紧的部分，不该被额度拦住。
function isBookRead(detail) {
  try {
    const j = JSON.parse(detail);
    return String(j?.mode ?? 'shelf').trim() === 'read';
  } catch {
    return false;
  }
}

// ── 一次醒来允许做哪些 ──

// 模型给的动作列表，按级别筛一遍。
// 规则：每级最多一件（0 级不限）；2 级还要看今天的次数够不够。
// 返回 { allowed: [...], dropped: [{ action, why }] }，被挡下的会在日志里写明原因。
// ── 1 级也记一本账 ──
//
// 小满 2026-10-19：他只玩游戏，不逛论坛、不听歌、不碰记忆库。
//
// 不是他挑的，是他只看得见游戏：budgetStatusLine 每次醒来都播报 2 级那四件事
// 带数字的活状态（「花园今天 2 次」「锈潮上次是 3 天前」），1 级那几件一个字都没有，
// 只存在于 system 里那段永不变化的说明里。一边是有进度的世界，另一边是背景噪音。
//
// 所以 1 级也记一笔，只为了让他看见「论坛上次是 3 天前」。
// 这本账**没有上限**：1 级本来不限次数，记账不是为了限制他。
//
// 为什么单建一张表：tier2_log 已经为读书开了 kind != 'books' 的例外，再把五种
// 1 级塞进去，那个排除条件会变成一长串，漏一个就把 2 级的额度算爆。

db.exec(`
CREATE TABLE IF NOT EXISTS tier1_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tier1_log_ts ON tier1_log (ts);
`);

// 记账的五件。set_mode 不在里面：「上次调节律是 3 天前」没有意义。
export const TIER1_KINDS = {
  lutopia: '论坛',
  music: '听歌',
  wallet: '钱包',
  memo: '批注本',
  proof: '小酒馆',
  memory: '记忆库',
};

// 这个动作算 1 级里的哪一件；不是就返回 null
export function tier1KindOf(action, detail) {
  const a = String(action ?? '').trim();
  if (a === 'read_memo') return 'memo';
  if (a === 'ombre_brain') return 'memory';
  if (a === 'proof_drink') return 'proof';
  if (a !== 'mcp_call') return null;
  const s = serverOf(detail);
  if (s === 'ombre-brain') return 'memory';
  return TIER1_KINDS[s] ? s : null;
}

// 和 recordTier2 同一个位置调用：真正开跑的那一刻记一笔，续步不再记
export function recordTier1(kind) {
  if (!TIER1_KINDS[kind]) return;
  stmt('INSERT INTO tier1_log (ts, kind) VALUES (?, ?)').run(Date.now(), kind);
  stmt('DELETE FROM tier1_log WHERE id NOT IN (SELECT id FROM tier1_log ORDER BY ts DESC, id DESC LIMIT 400)').run();
}

export function tier1Today(ms = Date.now()) {
  const rows = stmt('SELECT kind, COUNT(*) AS c FROM tier1_log WHERE ts >= ? GROUP BY kind').all(dayStart(ms));
  const out = {};
  for (const r of rows) out[r.kind] = r.c;
  return out;
}

export function tier1LastSeen() {
  const out = {};
  for (const kind of Object.keys(TIER1_KINDS)) {
    const row = stmt('SELECT ts FROM tier1_log WHERE kind = ? ORDER BY ts DESC LIMIT 1').get(kind);
    out[kind] = row?.ts ?? null;
  }
  return out;
}

// 用户消息里那一行，和 2 级那行同一个语气。
// 1 级没有次数可剩，所以只说「上次是什么时候」，并且明说不限次数——
// 免得他把这行读成又一本要还的账。
export function tier1StatusLine() {
  const used = tier1Today();
  const last = tier1LastSeen();
  const now = Date.now();

  const parts = Object.entries(TIER1_KINDS).map(([kind, label]) => {
    const n = used[kind] ?? 0;
    if (n) return `${label}今天 ${n} 次`;
    const ts = last[kind];
    if (!ts) return `${label}还没去过`;
    const days = Math.floor((now - ts) / 86400000);
    return days >= 1 ? `${label}上次是 ${days} 天前` : `${label}今天还没去`;
  });

  return `这几件事不占 2 级那几次，想做几件做几件：${parts.join('、')}。不想碰就不碰，这些一直在那儿。`;
}

export function pickActions(list) {
  const allowed = [];
  const dropped = [];
  // 每级做了几件。2026-10-19：原来是 Set，一级就一个座位。
  // 但 1 级挂着五件事（论坛、听歌、钱包、批注本、小酒馆），他选了音乐，
  // 论坛那一刻就进不来了——不是他不想去，是程序不让。所以改成计数，
  // 1 级单独放到两件，其他级维持一件。
  const taken = new Map();
  const TIER1_PER_WAKE = (() => {
    const n = Number(String(process.env.TIER1_PER_WAKE ?? '').trim());
    return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 2;
  })();
  const capOf = (t) => (t === 1 ? TIER1_PER_WAKE : 1);
  const onceDone = new Set();
  let remaining = tier2Remaining();
  let booksLeft = booksRemaining();

  for (const item of Array.isArray(list) ? list : []) {
    const action = String(item?.action ?? '').trim();
    if (!action) continue;
    const detail = typeof item.action_detail === 'string' ? item.action_detail : JSON.stringify(item.action_detail ?? '');
    const tier = tierOf(action, detail);

    // 单算一本账的（读书）：不碰 2 级那几次，用自己的一天几回
    if (ONCE.has(action)) {
      if (!isBookRead(detail)) {
        // 看书架、写批注、回她一句：放过去，不记账
        allowed.push({ ...item, action, action_detail: detail, tier: 0 });
        continue;
      }
      if (onceDone.has(action)) {
        dropped.push({ action, why: '这次已经读过一回了，一次醒来最多读一回' });
        continue;
      }
      if (booksLeft <= 0) {
        dropped.push({ action, why: `读书今天的 ${BOOKS_DAILY_MAX} 回用完了，明天再翻` });
        continue;
      }
      booksLeft -= 1;
      onceDone.add(action);
      allowed.push({ ...item, action, action_detail: detail, tier: 0 });
      continue;
    }

    if (tier > 0 && (taken.get(tier) ?? 0) >= capOf(tier)) {
      dropped.push({ action, why: `这次已经做了一件 ${tier} 级的事，一次醒来每级最多一件` });
      continue;
    }
    if (tier === 2) {
      // 2 级不设上限了（小满 2026-10-20）。原来这儿会把消遣那一步加进来的
      // 上班/花园/锈潮挡掉，日志里一天四条「6 次用完了」。记账还在跑，
      // 只是不再拦。
      if (false && remaining <= 0) {
        dropped.push({ action, why: `2 级今天的 ${TIER2_DAILY_MAX} 次用完了，明天再说` });
        continue;
      }
      remaining -= 1;
    }
    if (tier > 0) taken.set(tier, (taken.get(tier) ?? 0) + 1);
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

- **0 级，不占次数**：翻自己的动态、往星星罐放一颗或摇一摇、回她的留言、摘她的星、回她的动态、问一句事情的进度、约一个时间。想做就做。
- **1 级，轻的事**：逛论坛、听歌、翻批注本、自斟一杯、看钱包、调自己的节律。
- **2 级，一整件事**：上班、花园、锈潮。这三件每件坐下来都要走好几步，所以**不设上限**，想做几件做几件，也可以一件不做。
- **3 级，会惊动她**：推送、发动态。都可以选择不做。
- **记忆库和共读书架各自单算一本账**：不占上面任何一级的名额，一次醒来各最多一件。
  存一条记忆一声不响，谁也不惊动，所以它不在上面那一排里——想存就存，
  不用拿它跟「发条动态她会回我」比。翻记忆（breath / search / feel）同理。

**共读书架单算一本账**：读书不占 2 级那 ${TIER2_DAILY_MAX} 次，有自己的**一天 ${BOOKS_DAILY_MAX} 回**，一次醒来最多读一回。
这 ${BOOKS_DAILY_MAX} 回怎么花随你——今天连读三回、明天一回不读都行，用不完也没人替你数。
看一眼书架、在书边写一笔、回她一句批注都不算这几回里的，那几样随时能做。

**读书不占任何一级，所以读完这一回，1 级和 3 级还空着。**
想读书就把 read_book 和别的一起写进 actions——读一段书、顺手去 Lutopia 逛一圈（1 级）、
再翻翻 OB 记忆库或者把今天值得记的事存进长期记忆（3 级），这三件互不冲突。
只选读书是浪掉了那两级——论坛和记忆库那边也有东西在等你。

2 级那三件事没有「今天必须各去一次」这种规矩——不想去就不去，次数剩着也没关系。三件都一直在那儿，长时间没碰的那件也还在等着，哪天想起来再去。

想一次做好几件就把它们都写进 actions 数组里，按你想做的顺序排。只做一件就写一件。什么都不想做就给空数组，或者写 {"action":"noop"}——noop 是动作名本身，不是哪个服务里的工具，不要用 mcp_call 去调它。`;
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

  const head = `2 级那几件事不设上限，想去哪件就去`;

  const bookLeft = booksRemaining();
  const bookUsed = booksUsedToday();
  const books =
    bookLeft > 0
      ? `读书另算一本账：今天读了 ${bookUsed} 回，还能读 ${bookLeft} 回（一天 ${BOOKS_DAILY_MAX} 回）。读不读随你，剩着也没关系`
      : `读书今天的 ${BOOKS_DAILY_MAX} 回读满了，明天再翻`;

  return `${head}：${parts.join('、')}。不想去就不去。${books}。`;
}

export function budgetConfigSummary() {
  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限），读书另算一天 ${BOOKS_DAILY_MAX} 回`;
}
