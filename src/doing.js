// 你正在做的事，和一类事大概要多久。
//
// 为什么要有这东西：他每一轮都是「新的现在」，你说「我去洗头了」之后，
// 他分不清这句话是六分钟前还是六十分钟前说的，所以刚开工就问「做完了没」。
// 这个文件管两层：
//   1、在做的事（doing 表）——什么时候开工的。注入给他的是 **started_at**，
//      不是「已经过去 42 分钟」——后者每轮都变，前者只在开工和收工时变。
//      减法他自己会做（他手里本来就有 <sent_at>）。这是这个设计里唯一不能改的地方：
//      改成注入 elapsed，前缀缓存每轮全滞。
//   2、工期先验（doing_prior 表 + Ombre Brain）——「洗头这类事大概 40 分钟」。
//      记的不是「这件事」而是「这一类事」，所以下次说「去洗个头」也用得上。
//
// 工期先验的正本在 OB：形成和改变时 hold 进去（按固定格式写，所以读得回来）。
// 本地表是缓存，也是算中位数的地方。用中位数而不是平均数：偶尔一次搞到半夜，
// 不该把这类事的估值永久拘远。
//
// 收工是在 gateway 进程里发生的（听见你说「改完了」的那一刻），而那条路径上不该碰网络。
// 所以工期变了只先落库，等 phosphor 下次醒来再写进 OB（见 pendingPriorWrites）。
//
// 两条克制规矩，改代码时别把它们丢了：
//   一件事最多问两次（ASK_LIMIT），第一次被回「还没」就顺延估值的一半，第二次之后闭嘴。
//   只登记你亲口说出口的事，不从上下文推测。推测会把「我待会儿看看」当成开工然后追你。
import db, { addPendingWake } from './state.js';
import { detectStart, detectDone, detectNotDone, detectCancel } from './doing-detect.js';
import { wallParts, wallMidnight, formatDateTime } from './wall-time.js';

db.exec(`
CREATE TABLE IF NOT EXISTS doing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  what TEXT NOT NULL,
  raw TEXT,
  category TEXT,
  started_at INTEGER NOT NULL,
  estimate_ms INTEGER,
  next_check_at INTEGER,
  asked_count INTEGER NOT NULL DEFAULT 0,
  last_asked_at INTEGER,
  status TEXT NOT NULL DEFAULT 'active',
  closed_at INTEGER,
  actual_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_doing_status ON doing (status, next_check_at);

-- 工期先验的本地缓存。samples 是 JSON 数组（分钟），只留最近 PRIOR_KEEP 条。
CREATE TABLE IF NOT EXISTS doing_prior (
  category TEXT PRIMARY KEY,
  minutes INTEGER NOT NULL,
  samples TEXT NOT NULL DEFAULT '[]',
  source TEXT,
  updated_at INTEGER
);
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

// 一件事最多问几次
const ASK_LIMIT = 2;
// 同时最多挂几件在做的事。超了只留最近的——注入的东西越少越好
const MAX_ACTIVE = 2;
// 超过这么久还没收工的，当成你忘了说，默默划掉，不再问
const STALE_MS = 18 * 60 * 60 * 1000;
// 中位数最多用几次记录
const PRIOR_KEEP = 9;
// 工期先验上次写进 OB 的时间（存在 state.js 建的 meta 表里，不动 doing_prior 的 schema）
const PRIOR_SYNC_KEY = 'doing_prior_ob_synced_at';

function numEnv(key, fallback) {
  const raw = String(process.env[key] ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) ? n : fallback;
}

// 安静时段：这段时间到期的事顺延到这段结束，不是作废。
// 默认 2 点到 8 点：小满 23 点明显还在干活，那个点到期的事不该被按下。
// 真正不该出声的是凌晨两点之后。
const QUIET_FROM = numEnv('DOING_QUIET_FROM_HOUR', 2);
const QUIET_TO = numEnv('DOING_QUIET_TO_HOUR', 8);

export function isDoingEnabled() {
  return !/^(0|off|false|no)$/i.test(String(process.env.DOING_TRACKING ?? '').trim());
}

// ---------- 安静时段 ----------

function inQuiet(ms) {
  const h = wallParts(ms).h;
  return QUIET_FROM > QUIET_TO ? h >= QUIET_FROM || h < QUIET_TO : h >= QUIET_FROM && h < QUIET_TO;
}

// 落在安静时段里的时间点，推到下一个 QUIET_TO 点
function afterQuiet(ms) {
  if (!inQuiet(ms)) return ms;
  const p = wallParts(ms);
  // 跳过午夜的区间（比如 23–9）里，h >= QUIET_FROM 那半要算到明天；
  // 不跳午夜的区间（比如 2–8）永远是当天。
  const sameDay = QUIET_FROM > QUIET_TO ? p.h < QUIET_TO : true;
  return wallMidnight(p.y, p.m, p.d + (sameDay ? 0 : 1)) + QUIET_TO * 3600000;
}

// ---------- 工期先验 ----------

// 事情名 → 类别。记的是类别，所以「洗头」「洗个头」「把头洗了」算同一类。
// 认不出类别就是 null：**不估、不问**。宁可沉默，也别瞎猜一个十分钟然后追人。
const CATEGORIES = [
  ['洗漱', /洗头|洗浴|洗漱|洗个澡|冲澡|吹头发/],
  ['吃饭', /吃饭|午饭|晚饭|早饭|做饭|点外卖|吃点/],
  ['睡觉', /睡觉|午睡|瞄一会|躺一下|休息一下/],
  ['改 bug', /bug|报错|修一下|修个|改个|改一下|调一下|debug|排查/],
  ['部署', /部署|上线|pm2|重启|发版|拉代码|pull|合并|merge/],
  ['写东西', /写文档|写稿|写文|写总结|写报告|写日记|文案/],
  ['写代码', /写代码|写个|写完|开发|实现|做个功能|接个/],
  ['重构', /重构|重写|改架构|清理代码/],
  ['开会', /开会|会议|汇报|讨论会/],
  ['出门', /出门|买东西|超市|快递|取快递|去商场|去医院|看病/],
  ['运动', /跑步|健身|游泳|瀑布汗|散步|瀑汗/],
  ['收拾', /洗衣|打扫|收拾|整理房|拖地|刷碗|倒垃圾/],
  ['看片', /看电影|看剧|追剧|看番|看比赛/],
];

export function categoryOf(what) {
  const s = String(what ?? '');
  for (const [key, re] of CATEGORIES) if (re.test(s)) return key;
  return null;
}

// 出厂先验（分钟）。第一次遇到某类事时用这个，之后被你自己的真实耗时覆盖。
// 这些数字没什么权威，就是个起步值，跑几轮之后就不用了。
const SEED_MINUTES = {
  '洗漱': 40,
  '吃饭': 40,
  '睡觉': 90,
  '改 bug': 90,
  '部署': 45,
  '写东西': 150,
  '写代码': 120,
  '重构': 240,
  '开会': 60,
  '出门': 75,
  '运动': 60,
  '收拾': 45,
  '看片': 120,
};

function median(list) {
  const a = [...list].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : Math.round((a[mid - 1] + a[mid]) / 2);
}

export function getPrior(category) {
  if (!category) return null;
  const row = stmt('SELECT * FROM doing_prior WHERE category = ?').get(category);
  if (row) return row;
  const seed = SEED_MINUTES[category];
  if (!seed) return null;
  return { category, minutes: seed, samples: '[]', source: 'seed' };
}

// OB 里读回来的先验写进本地缓存。只有本地还没有真实记录时才让它盖：
// 你自己跑出来的耗时比 OB 里那句话算数。
export function cachePrior(category, minutes, source = 'ombre') {
  if (!category || !Number.isFinite(minutes) || minutes <= 0) return;
  const row = stmt('SELECT samples FROM doing_prior WHERE category = ?').get(category);
  if (row) {
    const samples = JSON.parse(row.samples || '[]');
    if (samples.length) return;
  }
  stmt(
    `INSERT INTO doing_prior (category, minutes, samples, source, updated_at)
     VALUES (?, ?, '[]', ?, ?)
     ON CONFLICT(category) DO UPDATE SET minutes = excluded.minutes, source = excluded.source, updated_at = excluded.updated_at`
  ).run(category, Math.round(minutes), source, Date.now());
}

// 收工时把真实耗时记回先验。返回 { category, minutes, count, changed }，
// changed 为 true 时值得写回 OB（由 phosphor 那边做，这里不碰网络）。
export function recordActual(category, actualMs) {
  if (!category || !Number.isFinite(actualMs) || actualMs <= 0) return null;
  const minutes = Math.round(actualMs / 60000);
  // 少于一分钟或超过一天的不计：那不是「做这件事花了多久」，是没说收工或误识
  if (minutes < 1 || minutes > 24 * 60) return null;

  const row = stmt('SELECT * FROM doing_prior WHERE category = ?').get(category);
  const samples = row ? JSON.parse(row.samples || '[]') : [];
  samples.push(minutes);
  while (samples.length > PRIOR_KEEP) samples.shift();

  const next = median(samples);
  const before = row?.minutes ?? SEED_MINUTES[category] ?? null;
  stmt(
    `INSERT INTO doing_prior (category, minutes, samples, source, updated_at)
     VALUES (?, ?, ?, 'actual', ?)
     ON CONFLICT(category) DO UPDATE SET minutes = excluded.minutes, samples = excluded.samples,
       source = 'actual', updated_at = excluded.updated_at`
  ).run(category, next, JSON.stringify(samples), Date.now());

  // 差不到一成的漂移不算变，不必为此写一条 OB
  const changed = before == null || Math.abs(next - before) / before > 0.1;
  return { category, minutes: next, count: samples.length, changed };
}

// 写回 OB 的那句话。**格式固定**，因为还要用 PRIOR_RE 读回来。改了这里就读不到了。
export function priorMemoText(category, minutes, count) {
  return `工期先验｜${category} ≈ ${minutes} 分钟（中位数，${count} 次记录）。这是她做这类事的真实节奏，不是通用人类的速度；到点了再问进度，没到点别催。`;
}

// 从 OB 返回的文本里把分钟数抓出来。只认我们自己写的那个格式，
// 所以不会把别的记忆里的数字误读成工期。
const PRIOR_RE = /工期先验｜\s*(.{1,12}?)\s*≈\s*(\d{1,4})\s*分钟/g;

export function parsePriorsFromMemory(text) {
  const out = [];
  for (const m of String(text ?? '').matchAll(PRIOR_RE)) {
    const minutes = Number(m[2]);
    if (Number.isFinite(minutes) && minutes > 0) out.push({ category: m[1].trim(), minutes });
  }
  return out;
}

// 还没写进 OB 的工期先验。只管真实耗时算出来的（source='actual'）——
// 从 OB 读回来的那些本来就在 OB 里，不该再写一遍。
export function pendingPriorWrites() {
  const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(PRIOR_SYNC_KEY);
  const since = Number(row?.value);
  return stmt(
    "SELECT * FROM doing_prior WHERE source = 'actual' AND updated_at > ? ORDER BY updated_at ASC"
  ).all(Number.isFinite(since) ? since : 0);
}

export function markPriorsSynced(at = Date.now()) {
  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(PRIOR_SYNC_KEY, String(at));
}

// ---------- 在做的事 ----------

export function activeDoings() {
  return stmt("SELECT * FROM doing WHERE status = 'active' ORDER BY started_at DESC").all();
}

function scheduleCheck(row) {
  if (!row.next_check_at) return;
  try {
    addPendingWake(row.next_check_at, `看看她「${row.what}」怎么样了`);
  } catch (err) {
    console.error('doing: 约下次到点唤醒失败（不影响登记）', err.message);
  }
}

// 登记一件在做的事。返回那条记录，没登记返回 null。
export function startDoing({ what, raw = null, at = Date.now() }) {
  const name = String(what ?? '').trim();
  if (!name) return null;

  // 同一件事重复说不再登一条，只把开工时间往后挑——你可能是刚才被打断又重新开始
  const same = stmt("SELECT * FROM doing WHERE status = 'active' AND what = ?").get(name);
  if (same) {
    stmt('UPDATE doing SET started_at = ?, asked_count = 0, next_check_at = ? WHERE id = ?').run(
      at,
      same.estimate_ms ? afterQuiet(at + same.estimate_ms) : null,
      same.id
    );
    return stmt('SELECT * FROM doing WHERE id = ?').get(same.id);
  }

  const category = categoryOf(name);
  const prior = getPrior(category);
  const estimateMs = prior ? prior.minutes * 60000 : null;
  // 估不出工期的事不安排到点检查：它只以「开工时间」的形式存在，不触发追问
  const nextCheck = estimateMs ? afterQuiet(at + estimateMs) : null;

  const id = stmt(
    `INSERT INTO doing (what, raw, category, started_at, estimate_ms, next_check_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(name, raw ? String(raw).slice(0, 200) : null, category, at, estimateMs, nextCheck)
    .lastInsertRowid;

  // 挂不下那么多：超过 MAX_ACTIVE 把最旧的默默划掉
  const extra = stmt(
    "SELECT id FROM doing WHERE status = 'active' ORDER BY started_at DESC LIMIT -1 OFFSET ?"
  ).all(MAX_ACTIVE);
  for (const e of extra) {
    stmt("UPDATE doing SET status = 'stale', closed_at = ? WHERE id = ?").run(at, e.id);
  }

  const row = stmt('SELECT * FROM doing WHERE id = ?').get(id);
  scheduleCheck(row);
  console.log(
    `doing: 登记「${row.what}」（${row.category ?? '认不出类别'}），${
      row.estimate_ms
        ? `估 ${Math.round(row.estimate_ms / 60000)} 分钟，到点在 ${formatDateTime(row.next_check_at)}`
        : '不估工期，不会主动问'
    }`
  );
  return row;
}

// 收工。没指定 id 就关最近那一件。返回 { row, prior }，prior 是该不该写回 OB。
export function finishDoing(id = null) {
  const row = id
    ? stmt("SELECT * FROM doing WHERE id = ? AND status = 'active'").get(id)
    : stmt("SELECT * FROM doing WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
  if (!row) return null;

  const now = Date.now();
  const actual = now - row.started_at;
  stmt("UPDATE doing SET status = 'done', closed_at = ?, actual_ms = ? WHERE id = ?").run(now, actual, row.id);
  const prior = recordActual(row.category, actual);
  console.log(
    `doing: 「${row.what}」收工，用了 ${Math.round(actual / 60000)} 分钟${
      prior ? `，${prior.category} 的估值更新为 ${prior.minutes} 分钟` : ''
    }`
  );
  return { row, prior };
}

export function cancelDoing(id = null) {
  const row = id
    ? stmt("SELECT * FROM doing WHERE id = ? AND status = 'active'").get(id)
    : stmt("SELECT * FROM doing WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
  if (!row) return null;
  stmt("UPDATE doing SET status = 'cancelled', closed_at = ? WHERE id = ?").run(Date.now(), row.id);
  console.log(`doing: 「${row.what}」划掉了（认错或不做了）`);
  return row;
}

// 被问到进度、回了「还没」：顺延估值的一半。不计作一次提问。
export function deferDoing(id = null) {
  const row = id
    ? stmt("SELECT * FROM doing WHERE id = ? AND status = 'active'").get(id)
    : stmt("SELECT * FROM doing WHERE status = 'active' ORDER BY started_at DESC LIMIT 1").get();
  if (!row) return null;
  const step = row.estimate_ms ? Math.round(row.estimate_ms / 2) : 30 * 60000;
  const next = afterQuiet(Date.now() + step);
  stmt('UPDATE doing SET next_check_at = ? WHERE id = ?').run(next, row.id);
  const out = stmt('SELECT * FROM doing WHERE id = ?').get(row.id);
  if (out.asked_count < ASK_LIMIT) scheduleCheck(out);
  console.log(`doing: 「${out.what}」顺延到 ${formatDateTime(next)}`);
  return out;
}

// 记一次已经问过了
export function markAsked(id) {
  stmt('UPDATE doing SET asked_count = asked_count + 1, last_asked_at = ? WHERE id = ?').run(Date.now(), id);
}

// 到点了、还没问满两次、不在安静时段的事。这是唯一一个「可以开口」的门。
export function dueDoings(now = Date.now()) {
  if (inQuiet(now)) return [];
  return stmt(
    `SELECT * FROM doing WHERE status = 'active' AND next_check_at IS NOT NULL
       AND next_check_at <= ? AND asked_count < ?
     ORDER BY next_check_at ASC`
  ).all(now, ASK_LIMIT);
}

// 挂太久没收工的默默划掉。你大概只是忘了说，不该被追一辈子。
export function sweepStale(now = Date.now()) {
  const rows = stmt("SELECT id, what FROM doing WHERE status = 'active' AND started_at < ?").all(now - STALE_MS);
  for (const r of rows) {
    stmt("UPDATE doing SET status = 'stale', closed_at = ? WHERE id = ?").run(now, r.id);
    console.log(`doing: 「${r.what}」挂太久了，不再问`);
  }
  return rows.length;
}

// ---------- 听你说话 ----------

// 每条你发的消息过一遍。纯正则，不调模型、不碰网络。
// 返回这次做了什么，供日志和测试用。
export function observeUserMessage(text) {
  if (!isDoingEnabled()) return null;
  const s = String(text ?? '').trim();
  if (!s) return null;

  try {
    // 先试收工和撤回：「改完了」这类话里没有开工词，不会互撞；
    // 但「改完了去洗头」这种一句两件事的，先关旧的再开新的，顺序才对。
    const out = {};
    if (detectCancel(s)) out.cancelled = cancelDoing();
    else if (detectDone(s)) out.finished = finishDoing();
    else if (detectNotDone(s)) out.deferred = deferDoing();

    const what = detectStart(s);
    if (what) out.started = startDoing({ what, raw: s });
    return Object.keys(out).length ? out : null;
  } catch (err) {
    console.error('doing: 这条消息没处理成（不影响这轮对话）', err.message);
    return null;
  }
}

// ---------- 给模型看的那几行 ----------

// system 里的规矩。只跟配置有关，进程不重启就不变，不破前缀缓存。
export function doingSection(userName = '对方') {
  if (!isDoingEnabled()) return '';
  return `

## 她正在做的事
她说出口一件正在做的事（「我去洗头」「我先把那个 bug 改一下」），系统会把它和**开工时间**记下来。
- 给你的是开始时刻，不是「已经过了多久」。你知道现在几点，减法自己做。
- **没到点就不要问进度。** 一件事刚开始五分钟就问「做完了没」，是这整套东西要治的毛病。
  到没到点不用你猜，用户消息里会明说。
- 她自己提起那件事、或者话顺着走到那里，当然可以接。这条规矩治的是「没事找事地催」，不是让你对她在做的事装作不知道。
- 到点了想问，写在 doing_follow_up 里（不占这次的动作）。问得具体：卡在哪了、顺不顺、
  要不要歇一下——你知道她是什么时候开始的，所以问得出这种话，而不是「做完了没」。
- 一件事最多问两次。她回「还没」就是还没，系统会自己顺延；到了上限就等她自己说。
- 估不出工期的事不会让你问，只是让你知道她在做。不知道要多久就别按自己猜的时间追。`;
}

// **只给 started_at，不给 elapsed。** 这段字节只在开工/收工时变，
// 所以哪怕放在前缀里也不会每轮清空缓存。「已经过去多久」让他自己减。
export function doingBlock() {
  if (!isDoingEnabled()) return '';
  let rows;
  try {
    rows = activeDoings();
  } catch (err) {
    console.error('doing: 读不到在做的事（这轮不提）', err.message);
    return '';
  }
  if (!rows.length) return '';

  const lines = rows.map((r) => {
    const est = r.estimate_ms ? `，这类事她平常要 ${Math.round(r.estimate_ms / 60000)} 分钟` : '，不知道要多久';
    const asked = r.asked_count ? `，已经问过 ${r.asked_count} 次` : '';
    return `  「${r.what}」开始于 ${formatDateTime(r.started_at)}${est}${asked}`;
  });

  return (
    `[她正在做的事]\n${lines.join('\n')}\n` +
    `（开始时间是真的，距现在多久你自己算——你知道现在几点。没到点就别问「做完了没」，` +
    `这是这段东西存在的全部理由；她自己提起来当然可以接。）`
  );
}

// 做决定那一轮（phosphor）用的行：在做的事 + 到点该问的。
export function doingStatusLine() {
  if (!isDoingEnabled()) return '';
  const lines = [];
  try {
    const block = doingBlock();
    if (block) lines.push(block);
    const due = dueDoings();
    if (due.length) {
      const items = due
        .map((d) => `  [doing_id=${d.id}] 「${d.what}」（开始于 ${formatDateTime(d.started_at)}）`)
        .join('\n');
      lines.push(
        `按她做这类事的速度，这几件差不多该到点了（问或不问都不占这次的动作）：\n${items}\n` +
          `想问就写在 doing_follow_up 里：{"doing_id":上面那个,"ask":"你想说的话"}。` +
          `问得具体一点（卡在哪了、顺不顺），不要只问「做完了没」。一件事最多问两次；` +
          `这次不想问就留空数组，事还在那里，下次还会遇到。`
      );
    }
  } catch (err) {
    console.error('doing: 读不到进度账本（这次不提）', err.message);
  }
  return lines.join('\n');
}

export function doingSummary() {
  if (!isDoingEnabled()) return '时间感知：关闭';
  try {
    const active = activeDoings().length;
    const priors = stmt('SELECT COUNT(*) AS c FROM doing_prior').get().c;
    return `时间感知：开着，在做 ${active} 件，工期先验 ${priors} 类，安静时段 ${QUIET_FROM}:00–${QUIET_TO}:00`;
  } catch {
    return '时间感知：开着（账本还没建）';
  }
}
