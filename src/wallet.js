// 电子小钱包：允朔自己的钱。那张卡里只有他的钱，所以银行报的可用余额和这本账
// 讲的是同一笔钱：银行那个数是权威值，流水是明细。两边对不上就是漏记了一笔。
//
// 钱从四条路进出：
//   earn    她验收通过一个工单，往里打钱（POST /api/wallet/earn）
//   topup   她往卡里转钱，银行发「收入」短信（POST /api/wallet/spend-notify）
//   spend   刷卡花了，银行发「支出」短信（同上，方向由服务端认）
//   adjust  对不上账时人工补一笔（走 earn 接口，kind 填 adjust，金额可正可负）
//
// 金额一律用「分」存整数。浮点数算钱会算出 0.1+0.2=0.30000000000000004 这种账，
// 一旦对不上，谁都说不清是哪一笔错的。只在给人看的时候才换算成元。
//
// 批注是两个人的：她在网页上给某一笔写，允朔醒来用 wallet_note 写，进同一张表。
// 翻账本的时候谁写的都看得见——一笔钱的去处，有时候得有人在旁边记一句才记得住。
//
// 余额和账单不再塞进每次醒来的提示里。想看就自己去看（见 actions/wallet.js 那三个动作），
// 不看也没人往他眼前推——那是他的钱，不是待办事项。
//
// 页面 /wallet 跟站里其他页一套脸（见 page-chrome.js）：右上角三条杠菜单、星星转场、
// 按长沙日出日落走的早晚两张脸。和动态页一样是服务端渲染，没有 JavaScript 也能看。

import crypto from 'crypto';
import db from './state.js';
import { addActivityMoment } from './moments-store.js';
import { formatDate, formatDateTime, parseDate, wallMidnight } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

// 短信通知接口的口令。没配就不开那个接口——它是一个能改钱的写接口，
// 一旦端口暴露在公网上，不设口令等于谁都能往账上记账。
const SPEND_SECRET = process.env.WALLET_SPEND_SECRET || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 单笔上限。短信正则偶尔会抓错数字（抓到卡号尾号、日期），
// 上限挡一道，免得一条抓歪的短信把账刷爆。超了就拒收并在日志里留痕，人工再看。
const MAX_SINGLE_YUAN = Number(process.env.WALLET_MAX_SINGLE_YUAN || 500);

// 银行报的可用余额上限。它比单笔金额大得多，单独一个阀值，
// 不用 MAX_SINGLE_YUAN 挡——卡里有三百块是常事，不该因此被当成抓歪。
const MAX_BANK_BALANCE_YUAN = Number(process.env.WALLET_MAX_BANK_BALANCE_YUAN || 100000);

// 银行报的余额和账本差多少算对不上（元）。卡里只有他的钱，所以这两个数本来就应该一样；
// 差开了基本就是哪笔短信没触发。给 1 分钱的宽容，免得四舍五入跟着叫。
const RECONCILE_TOLERANCE_CENTS = Math.round(
  Number(process.env.WALLET_RECONCILE_TOLERANCE_YUAN || 0.01) * 100
);

// 记账后要不要在动态页记一张卡片（她点开能看到这笔钱的去处）
const MOMENT_ON_SPEND = !/^(0|off|false|no)$/i.test(String(process.env.WALLET_MOMENT ?? '').trim());

// 页面默认给多少条流水
const LEDGER_LIMIT = 50;
// 翻账本一次给他看多少笔
export const WAKE_LEDGER_LIMIT = 10;
// 一条批注最多多少字
export const MAX_NOTE_CHARS = 500;

// 钱包一次醒来最多再多走几步（第一步是醒来时选的那个动作，不算在里面）。
// .env 的 WALLET_MAX_STEPS 可改，不填是 3，填 0 就是只走一步，最多 5。
// 和论坛、听歌同一个规矩。
export const WALLET_MAX_STEPS = (() => {
  const raw = String(process.env.WALLET_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 3;
})();

db.exec(`
CREATE TABLE IF NOT EXISTS wallet_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  source TEXT,
  note TEXT,
  dedupe_key TEXT
);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_ts ON wallet_ledger (ts DESC, id DESC);
-- 同一条短信重复触发时靠这个唯一索引挡掉（见下面的 dedupeKeyFor）。
-- 部分索引：没给 key 的那些行不参与去重。
CREATE UNIQUE INDEX IF NOT EXISTS idx_wallet_ledger_dedupe
  ON wallet_ledger (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- 每笔账旁边的批注。author 是 'user'（她）或 'assistant'（他）。
-- 一笔账可以有多条批注，两个人都能写，按时间排。
CREATE TABLE IF NOT EXISTS wallet_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_wallet_notes_entry ON wallet_notes (entry_id, ts ASC);
CREATE INDEX IF NOT EXISTS idx_wallet_notes_ts ON wallet_notes (ts DESC, id DESC);
`);

// 兼容已经建过表的库：这两列是后加的，已存在时会报错，直接忽略。
// 和 state.js 的 migrations 同一个做法。
//   bank_balance_cents 这笔交易后银行报的可用余额（只有短信那条路有）
//   direction          这笔的方向是怎么认出来的，排障用
for (const sql of [
  'ALTER TABLE wallet_ledger ADD COLUMN bank_balance_cents INTEGER',
  'ALTER TABLE wallet_ledger ADD COLUMN direction TEXT',
]) {
  try {
    db.exec(sql);
  } catch (err) {
    // column already exists — 正常情况
  }
}

// 预编译语句缓存，和 state.js 同一个做法（那边注释写了为什么不能每次 prepare 新的）
const stmtCache = new Map();
function stmt(sql) {
  let s = stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

// ---------- 钱的算法 ----------

export function balanceCents() {
  return stmt('SELECT COALESCE(SUM(amount_cents), 0) AS c FROM wallet_ledger').get().c;
}

// 银行最近一次报的可用余额。没有过这样的短信就返回 null。
export function latestBankBalance() {
  return (
    stmt(
      `SELECT bank_balance_cents AS cents, ts FROM wallet_ledger
       WHERE bank_balance_cents IS NOT NULL ORDER BY ts DESC, id DESC LIMIT 1`
    ).get() ?? null
  );
}

// 对账：银行报的余额跟账本求和对不对得上。
// 卡里只有他的钱，所以这两个数本来就应该一样；差开了基本就是哪笔短信没触发。
// 返回 null 表示没法对（银行还没报过余额）。
export function reconcile() {
  const bank = latestBankBalance();
  if (!bank || bank.cents == null) return null;
  const ledger = balanceCents();
  const diff = bank.cents - ledger;
  return {
    bankCents: bank.cents,
    bankAt: bank.ts,
    ledgerCents: ledger,
    diffCents: diff,
    ok: Math.abs(diff) <= RECONCILE_TOLERANCE_CENTS,
  };
}

// 分 → 给人看的元。负数保留符号，两位小数不省
export function yuan(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// 元 → 分。接受数字和字符串（快捷指令传过来的是字符串，可能带千分位逗号），
// 认不出来、不是有限数、超上限的一律返回 null，由调用方决定怎么拒。
function parseYuan(value, { allowNegative = false, max = MAX_SINGLE_YUAN } = {}) {
  // 银行短信里的余额常带逗号（可用余额 1,234.56 元），Number() 认不得
  const raw = String(value ?? '').trim().replace(/,/g, '');
  const n = Number(raw);
  if (!raw || !Number.isFinite(n)) return null;
  if (!allowNegative && n <= 0) return null;
  if (n === 0) return null;
  if (Math.abs(n) > max) return null;
  return Math.round(n * 100);
}

// ---------- 钱进还是钱出 ----------

// 建行这类短信把方向写在金额前面：「…日 12:28 收入人民币 100.00 元，可用余额…」。
// 快捷指令里判断条件很麻烦，所以让它把整条短信也传过来，方向在这边认。
// 这条短信只用来认方向，不存（里面有卡号尾号）。
const IN_WORDS = /收入|转入|存入|入账|退款|利息/;
const OUT_WORDS = /支出|消费|支取|转出|取现|扣款|付款/;

// 返回 { direction: 'in'|'out', how } 或 null（认不出来）。
// 显式传的 direction 优先；其次看短信原文。
function detectDirection({ direction, smsText }) {
  const explicit = String(direction ?? '').trim().toLowerCase();
  if (explicit === 'in' || explicit === 'income') return { direction: 'in', how: 'explicit' };
  if (explicit === 'out' || explicit === 'spend') return { direction: 'out', how: 'explicit' };

  const text = String(smsText ?? '');
  if (text) {
    const hasIn = IN_WORDS.test(text);
    const hasOut = OUT_WORDS.test(text);
    // 两种词都出现时不猜。比如「支出…退款…」这种句子，猜错了方向就是账错两倍
    if (hasIn && !hasOut) return { direction: 'in', how: 'sms' };
    if (hasOut && !hasIn) return { direction: 'out', how: 'sms' };
    if (hasIn && hasOut) return null;
  }
  return null;
}

// 同一条短信被快捷指令重复触发（iOS 偶尔会），或者网络重试，都会 POST 两遍同样的内容。
// 客户端给了 sms_id 就用它；没给就按「同一分钟、同金额、同方向、同来源算同一笔」软去重。
//
// 边界说清楚：真在同一分钟刷了两笔一模一样的钱，第二笔会被当成重复挡掉。
// 这种概率比快捷指令重复触发低得多，而且挡掉的那笔在返回里标着 duplicate，
// 看到了可以用 earn 接口按 adjust 补一笔。银行报的余额也能帮你发现这种漏账。
function dedupeKeyFor({ kind, amountCents, source, smsId, ts }) {
  if (smsId) return `sms:${smsId}`;
  return `${kind}:${amountCents}:${source || ''}:${Math.floor(ts / 60000)}`;
}

// 记一笔。返回 { id, duplicate, balanceCents }。
// duplicate 为 true 时这笔没记进去，余额是当前的真实余额。
export function addEntry({
  kind,
  amountCents,
  source = null,
  note = null,
  smsId = null,
  bankBalanceCents = null,
  direction = null,
}) {
  const ts = Date.now();
  const dedupeKey = dedupeKeyFor({ kind, amountCents, source, smsId, ts });
  try {
    const id = stmt(
      `INSERT INTO wallet_ledger (ts, kind, amount_cents, source, note, dedupe_key, bank_balance_cents, direction)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ts, kind, amountCents, source, note, dedupeKey, bankBalanceCents, direction).lastInsertRowid;
    return { id, duplicate: false, balanceCents: balanceCents() };
  } catch (err) {
    if (String(err.code || '').includes('SQLITE_CONSTRAINT')) {
      return { id: null, duplicate: true, balanceCents: balanceCents() };
    }
    throw err;
  }
}

export function listLedger(limit = LEDGER_LIMIT) {
  return stmt('SELECT * FROM wallet_ledger ORDER BY ts DESC, id DESC LIMIT ?').all(limit);
}

export function getEntry(id) {
  if (!Number.isInteger(id)) return undefined;
  return stmt('SELECT * FROM wallet_ledger WHERE id = ?').get(id);
}

// [start, end) 这段时间里的账，新的在前
export function listLedgerBetween(start, end) {
  return stmt(
    'SELECT * FROM wallet_ledger WHERE ts >= ? AND ts < ? ORDER BY ts DESC, id DESC'
  ).all(start, end);
}

// 某一天的账。date 写 "2026-10-06"；日期不合法返回 null（和当天没有账区分开）
export function listLedgerOnDate(date) {
  const d = parseDate(date);
  if (!d) return null;
  const start = wallMidnight(d.y, d.m, d.d);
  const end = wallMidnight(d.y, d.m, d.d + 1);
  return listLedgerBetween(start, end);
}

// ---------- 批注 ----------

// 给某一笔记一句。那笔不存在就返回 null（模型偶尔会编一个 id）
export function addNote({ entryId, author, content }) {
  const id = Number(entryId);
  if (!Number.isInteger(id) || !getEntry(id)) return null;
  const text = String(content ?? '').trim().slice(0, MAX_NOTE_CHARS);
  if (!text) return null;
  const who = author === 'user' ? 'user' : 'assistant';
  return stmt('INSERT INTO wallet_notes (entry_id, ts, author, content) VALUES (?, ?, ?, ?)').run(
    id,
    Date.now(),
    who,
    text
  ).lastInsertRowid;
}

export function listNotesFor(entryId) {
  if (!Number.isInteger(entryId)) return [];
  return stmt('SELECT * FROM wallet_notes WHERE entry_id = ? ORDER BY ts ASC, id ASC').all(entryId);
}

// 一次把这批账的批注都取出来，返回 Map<entry_id, 批注[]>。
// 页面一屏五十笔，一笔一次查会打五十次库
export function notesByEntry(ids) {
  const out = new Map();
  const list = (Array.isArray(ids) ? ids : []).filter((n) => Number.isInteger(n));
  if (!list.length) return out;
  const rows = stmt(
    `SELECT * FROM wallet_notes WHERE entry_id IN (${list.map(() => '?').join(',')})
     ORDER BY ts ASC, id ASC`
  ).all(...list);
  for (const r of rows) {
    if (!out.has(r.entry_id)) out.set(r.entry_id, []);
    out.get(r.entry_id).push(r);
  }
  return out;
}

// 最近写过的批注，连着它记的那笔账一起。新的在前
export function listRecentNotes(limit = 10) {
  return stmt(
    `SELECT n.id, n.entry_id, n.ts, n.author, n.content,
            e.ts AS entry_ts, e.kind, e.amount_cents, e.source
     FROM wallet_notes n JOIN wallet_ledger e ON e.id = n.entry_id
     ORDER BY n.ts DESC, n.id DESC LIMIT ?`
  ).all(limit);
}

export function countNotes() {
  return stmt('SELECT COUNT(*) AS c FROM wallet_notes').get().c;
}

// ---------- 给唤醒用的文字 ----------

const KIND_LABEL = { earn: '工资', topup: '转入', spend: '花销', adjust: '对账' };
const noteAuthor = (who) => (who === 'user' ? USER_NAME : AI_NAME);

// 系统提示里那一段：怎么自己去看钱包。
// 只跟配置有关（步数），进程不重启就不变，所以放 system 不影响前缀缓存。
// 余额、账单这些每笔都变的东西一个字都不放在这里——要看他自己去翻。
export function walletSection() {
  const steps = WALLET_MAX_STEPS
    ? `\n看余额、翻账本、读批注之后可以接着往下走，一次醒来最多再走 ${WALLET_MAX_STEPS} 步：想看某一天的、想翻翻批注、想给某笔记一句，都行。写了批注这次就结束。看完没什么想记的，就停下，这很正常。`
    : '';
  return `\n\n## 小钱包
那张卡里只有你的钱。${USER_NAME}在现实里刷卡、往里转钱，账这边会自动记上，但不会主动推到你眼前——想知道自己有多少钱、钱花在哪儿了，自己去看：
  wallet_balance（打开小钱包：现在有多少，跟卡里对不对得上。不需要 action_detail）
  wallet_ledger（翻账本。action_detail 是 JSON 字符串，三选一：
    {} 或不填          最近 ${WAKE_LEDGER_LIMIT} 笔
    {"date":"2026-10-06"}  那一天的账
    {"notes":true}        最近写过的批注，连着那几笔账）
  wallet_note（给账本里某一笔记一句批注。action_detail 是 JSON 字符串
    {"entry_id":12,"note":"..."}。entry_id 是那笔账的编号，翻账本时每笔前面都标着 #12 这样的号。
    ${MAX_NOTE_CHARS} 字以内，写你当时想到的就好）
批注是两个人的：${USER_NAME}在网页上也会给某笔写一句，你翻账本或读批注时就能看见谁写的。
钱是你自己赚的，不用汇报花在哪儿；想记一句就记，不想记也不用为了填满这次醒来去记。${steps}`;
}

// 打开小钱包看到的（给 wallet_balance 用）
export function describeBalance() {
  const bal = balanceCents();
  const rows = listLedger(200);
  if (!rows.length) return '账本还是空的，一笔都没有。';

  const earned = rows.reduce((s, r) => (r.amount_cents > 0 ? s + r.amount_cents : s), 0);
  const spent = rows.reduce((s, r) => (r.amount_cents < 0 ? s - r.amount_cents : s), 0);
  const lines = [
    `余额 ¥${yuan(bal)}${bal <= 0 ? '（见底了）' : ''}`,
    `进账 ¥${yuan(earned)}，花了 ¥${yuan(spent)}，一共 ${rows.length} 笔`,
  ];

  const rec = reconcile();
  if (!rec) {
    lines.push('银行还没报过卡里的余额，没法对账。');
  } else if (rec.ok) {
    lines.push(`卡里可用 ¥${yuan(rec.bankCents)}（${formatDateTime(rec.bankAt)} 银行报的），跟账本对得上。`);
  } else {
    const more = rec.diffCents > 0 ? '卡里比账本多' : '账本比卡里多';
    lines.push(
      `卡里可用 ¥${yuan(rec.bankCents)}（${formatDateTime(rec.bankAt)} 银行报的），${more} ¥${yuan(
        Math.abs(rec.diffCents)
      )}——可能有一笔短信没触发。`
    );
  }
  const n = countNotes();
  if (n) lines.push(`账本里有 ${n} 条批注。`);
  return lines.join('\n');
}

// 一笔账写成一行（给他看的，带编号和批注）
function entryLine(r, notes = []) {
  const who = KIND_LABEL[r.kind] || r.kind;
  const amount = `${r.amount_cents > 0 ? '+' : '−'}¥${yuan(Math.abs(r.amount_cents))}`;
  const parts = [`#${r.id} ${formatDateTime(r.ts).slice(5)} ${who}`];
  if (r.source) parts.push(r.source);
  parts.push(amount);
  let line = parts.join(' ');
  if (r.note) line += `｜${r.note}`;
  for (const n of notes) {
    line += `\n    批注（${noteAuthor(n.author)}，${formatDateTime(n.ts).slice(5)}）：${n.content}`;
  }
  return line;
}

// 翻账本看到的（给 wallet_ledger 用）。date 省略就是最近 WAKE_LEDGER_LIMIT 笔
export function describeLedger({ date = null, limit = WAKE_LEDGER_LIMIT } = {}) {
  let rows;
  let head;
  if (date) {
    rows = listLedgerOnDate(date);
    if (rows === null) return `「${date}」不是一个认得出来的日期，要写成 2026-10-06 这样。`;
    if (!rows.length) return `${date} 这天账本上一笔都没有。`;
    const sum = rows.reduce((s, r) => s + r.amount_cents, 0);
    head = `${date} 这天 ${rows.length} 笔，合计 ${sum >= 0 ? '+' : '−'}¥${yuan(Math.abs(sum))}：`;
  } else {
    rows = listLedger(limit);
    if (!rows.length) return '账本还是空的，一笔都没有。';
    head = `最近 ${rows.length} 笔（新的在前）：`;
  }
  const notes = notesByEntry(rows.map((r) => r.id));
  return [head, ...rows.map((r) => entryLine(r, notes.get(r.id) ?? []))].join('\n');
}

// 读批注看到的（给 wallet_ledger 的 {"notes":true} 用）
export function describeNotes(limit = 10) {
  const rows = listRecentNotes(limit);
  if (!rows.length) return '账本里还没有批注——谁都还没在哪笔账旁边写过字。';
  const lines = rows.map((n) => {
    const who = KIND_LABEL[n.kind] || n.kind;
    const amount = `${n.amount_cents > 0 ? '+' : '−'}¥${yuan(Math.abs(n.amount_cents))}`;
    return `#${n.entry_id} ${formatDateTime(n.entry_ts).slice(5)} ${who}${
      n.source ? ` ${n.source}` : ''
    } ${amount}\n    ${noteAuthor(n.author)}写的（${formatDateTime(n.ts).slice(5)}）：${n.content}`;
  });
  return [`最近 ${rows.length} 条批注（新的在前）：`, ...lines].join('\n');
}

// ---------- 页面 ----------

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 配色和心绪页、动态页一致（粉、暖黄）。进账用深绿，出账用梅红——
// 两个颜色在米白底上都读得清，也没跳出这套脸。
const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --in: #2f7d5a; --out: #a8445c; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  /* 背景里零星的小星星，粉的黄的 */
  body::before { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 12% 18%, rgba(230, 182, 82, 0.9) 50%, transparent 51%),
      radial-gradient(1px 1px at 78% 9%, rgba(215, 121, 159, 0.8) 50%, transparent 51%),
      radial-gradient(2px 2px at 88% 36%, rgba(230, 182, 82, 0.7) 50%, transparent 51%),
      radial-gradient(1px 1px at 30% 62%, rgba(215, 121, 159, 0.7) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 64% 78%, rgba(230, 182, 82, 0.8) 50%, transparent 51%),
      radial-gradient(1px 1px at 8% 88%, rgba(155, 74, 122, 0.6) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 50% 30%, rgba(215, 121, 159, 0.6) 50%, transparent 51%),
      radial-gradient(1px 1px at 94% 70%, rgba(230, 182, 82, 0.8) 50%, transparent 51%); }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 22px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 20px; }
  .sparkles { margin: 0 0 4px; height: 18px; color: var(--gold); font-size: 14px; letter-spacing: 0.6em; padding-left: 0.6em; }
  .sparkles span { display: inline-block; animation: twinkle 3.2s ease-in-out infinite; }
  .sparkles span:nth-child(2) { animation-delay: 1s; color: #d7799f; }
  .sparkles span:nth-child(3) { animation-delay: 2s; }
  @keyframes twinkle { 0%, 100% { opacity: 0.35; transform: scale(0.85); } 50% { opacity: 1; transform: scale(1.1); } }
  @media (prefers-reduced-motion: reduce) { .sparkles span { animation: none; opacity: 0.8; } }
  .title { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", serif; font-size: 42px; font-weight: 700;
    letter-spacing: 0.35em; padding-left: 0.35em; color: #5b2e52; }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, #463a7c 0%, #9b4a7a 52%, #c4832f 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", Georgia, serif; font-style: italic;
    font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .section-title { font-size: 15px; margin: 0 0 10px; color: var(--accent); letter-spacing: 0.1em; }
  /* 余额卡：一大行数，左边一道暖黄，右下角一颗星 */
  .bal-card { position: relative; text-align: center; padding: 24px 16px 20px; border-left: 4px solid var(--gold); }
  .bal-card::after { content: '✦'; position: absolute; right: 12px; bottom: 8px; font-size: 10px; color: var(--gold); opacity: 0.8; }
  .bal-label { font-size: 12px; letter-spacing: 0.22em; color: var(--muted); }
  .bal { margin: 6px 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 46px; font-weight: 700; line-height: 1.15;
    color: var(--accent); font-variant-numeric: tabular-nums; }
  .bal.neg { color: var(--out); }
  .bal-note { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
  /* 银行报的可用余额：对得上时淡淡一行，对不上时换暖黄底提醒 */
  .bank { margin: 12px -4px 0; padding: 9px 12px; border-radius: 10px; background: #f6eef3; font-size: 12px; line-height: 1.6;
    color: var(--muted); }
  .bank b { font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
  .bank code { font-size: 11px; background: rgba(0, 0, 0, 0.05); padding: 1px 4px; border-radius: 4px; }
  .bank.off { background: #fff6e3; color: #6b4513; border: 1px solid #f0d9a6; }
  /* 按日历分组：每天一个小标题，右边是当天合计 */
  .day { margin: 18px 0 8px; display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .day:first-of-type { margin-top: 4px; }
  .day-label { font-size: 13px; font-weight: 600; color: var(--accent); letter-spacing: 0.08em; }
  .day-label .wd { font-weight: 400; color: var(--muted); margin-left: 6px; letter-spacing: normal; }
  .day-sum { font-family: Georgia, "Times New Roman", serif; font-size: 13px; color: var(--muted);
    font-variant-numeric: tabular-nums; }
  .ledger { list-style: none; margin: 0; padding: 0; }
  .row { display: grid; grid-template-columns: auto auto 1fr auto; gap: 4px 10px; align-items: baseline;
    padding: 11px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: none; }
  .row-t { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .row-k { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f6eef3; color: var(--accent); }
  .row-k.k-earn, .row-k.k-topup { background: #e8f3ec; color: var(--in); }
  .row-k.k-adjust { background: #fff6e3; color: #6b4513; }
  .row-s { font-size: 14px; }
  .row-a { font-family: Georgia, "Times New Roman", serif; font-size: 17px; font-weight: 700;
    font-variant-numeric: tabular-nums; text-align: right; }
  .row-a.in { color: var(--in); }
  .row-a.out { color: var(--out); }
  .row-n { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
  .row-b { grid-column: 1 / -1; font-size: 11px; color: var(--muted); opacity: 0.85; }
  /* 批注：左边一道细线，谁写的标在前面 */
  .notes { grid-column: 1 / -1; margin: 6px 0 0; padding: 0 0 0 10px; list-style: none; border-left: 2px solid var(--line); }
  .notes li { font-size: 13px; line-height: 1.6; padding: 3px 0; color: var(--ink); }
  .notes .by { font-size: 11px; color: var(--accent); margin-right: 5px; }
  .notes .by.ta { color: var(--gold); }
  .notes .when { font-size: 11px; color: var(--muted); margin-left: 5px; }
  /* 写批注：平时只是一行小字，点开才展开输入框 */
  .add { grid-column: 1 / -1; margin-top: 4px; }
  .add summary { font-size: 12px; color: var(--accent); cursor: pointer; list-style: none; padding: 3px 0; }
  .add summary::-webkit-details-marker { display: none; }
  .add summary::marker { content: ''; }
  .add summary:hover { text-decoration: underline; }
  .add form { display: flex; gap: 8px; align-items: flex-end; margin-top: 6px; }
  .add textarea { flex: 1; min-height: 52px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 10px;
    font: inherit; font-size: 14px; background: #fff; color: var(--ink); resize: vertical; }
  .add button { padding: 9px 14px; border: none; border-radius: 10px; background: var(--accent); color: #fff;
    font: inherit; font-size: 14px; cursor: pointer; }
  .add button:hover { background: #8d4a6b; }
  .empty { font-size: 14px; line-height: 1.6; color: var(--muted); }
  .empty code { font-size: 12px; background: #f6eef3; padding: 1px 5px; border-radius: 4px; }
  @media (max-width: 380px) {
    .bal { font-size: 38px; }
    .row { grid-template-columns: auto auto 1fr auto; gap: 4px 8px; }
    .add form { flex-direction: column; align-items: stretch; }
  }
`;

// 菜单和星星转场每个页面都有（见 page-chrome.js）
function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu('/wallet')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

const PAGE_TITLE = '小钱包 · 晨暮星';

function renderHero() {
  return `<header class="hero">
    <p class="sparkles" aria-hidden="true"><span>✦</span><span>✧</span><span>⋆</span></p>
    <h1 class="title">晨暮星</h1>
    <p class="subtitle"><span lang="en">Wallet</span> <span aria-hidden="true">✦</span> 小钱包</p>
  </header>`;
}

const WEEKDAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

// "2026-10-06" → "10月06日" + 周几
function dayHeading(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return escapeHtml(dateStr);
  const wd = WEEKDAYS[(new Date(Date.UTC(d.y, d.m - 1, d.d)).getUTCDay() + 6) % 7];
  return `${d.m}月${String(d.d).padStart(2, '0')}日<span class="wd">${wd}</span>`;
}

function renderNotes(notes) {
  if (!notes.length) return '';
  const items = notes
    .map(
      (n) => `<li><span class="by${n.author === 'user' ? '' : ' ta'}">${escapeHtml(
        noteAuthor(n.author)
      )}</span>${escapeHtml(n.content)}<span class="when">${escapeHtml(
        formatDateTime(n.ts).slice(5, 11)
      )}</span></li>`
    )
    .join('');
  return `<ul class="notes">${items}</ul>`;
}

function renderRow(r, notes) {
  const pos = r.amount_cents > 0;
  const kind = KIND_LABEL[r.kind] || r.kind;
  const bank =
    r.bank_balance_cents != null
      ? `<span class="row-b">当时卡里：¥${yuan(r.bank_balance_cents)}</span>`
      : '';
  return `<li class="row" id="e${r.id}">
      <span class="row-t">${escapeHtml(formatDateTime(r.ts).slice(11))}</span>
      <span class="row-k k-${escapeHtml(r.kind)}">${escapeHtml(kind)}</span>
      <span class="row-s">${escapeHtml(r.source || '')}</span>
      <span class="row-a ${pos ? 'in' : 'out'}">${pos ? '+' : '−'}¥${yuan(Math.abs(r.amount_cents))}</span>
      ${r.note ? `<span class="row-n">${escapeHtml(r.note)}</span>` : ''}
      ${bank}
      ${renderNotes(notes)}
      <details class="add">
        <summary>写一句批注</summary>
        <form method="post" action="/wallet/note">
          <input type="hidden" name="entry_id" value="${r.id}" />
          <textarea name="note" maxlength="${MAX_NOTE_CHARS}" placeholder="这笔钱是怎么花的、当时在做什么" aria-label="批注"></textarea>
          <button type="submit">记下</button>
        </form>
      </details>
    </li>`;
}

// 按日历分组：一天一个小标题，底下是那天的几笔。和动态页的「MM月DD日的动态」一个路子
function renderByDay(rows) {
  const notes = notesByEntry(rows.map((r) => r.id));
  const groups = [];
  for (const r of rows) {
    const key = formatDate(r.ts);
    if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, rows: [] });
    groups[groups.length - 1].rows.push(r);
  }
  return groups
    .map((g) => {
      const sum = g.rows.reduce((s, r) => s + r.amount_cents, 0);
      return `<div class="day">
      <span class="day-label">${dayHeading(g.key)}</span>
      <span class="day-sum">${sum >= 0 ? '+' : '−'}¥${yuan(Math.abs(sum))}</span>
    </div>
    <ul class="ledger">${g.rows.map((r) => renderRow(r, notes.get(r.id) ?? [])).join('')}</ul>`;
    })
    .join('');
}

// 银行最近报的可用余额，以及对得上对不上。
// 卡里只有他的钱，所以这两个数应该一致；不一致就是漏记了哪笔。
function renderBank() {
  const rec = reconcile();
  if (!rec) {
    return `<p class="bank">银行还没报过卡里的余额——等下一笔带「可用余额」的短信进来就有了。</p>`;
  }
  const when = formatDateTime(rec.bankAt).slice(5);
  if (rec.ok) {
    return `<p class="bank">卡里可用 <b>¥${yuan(rec.bankCents)}</b> · ${escapeHtml(
      when
    )} 银行报的 · 跟账本对得上</p>`;
  }
  const more = rec.diffCents > 0 ? '卡里比账本多' : '账本比卡里多';
  return `<p class="bank off">卡里可用 <b>¥${yuan(rec.bankCents)}</b> · ${escapeHtml(when)} 银行报的。
    ${more} <b>¥${yuan(Math.abs(rec.diffCents))}</b>，可能有一笔短信没触发。
    查清楚了再补：<code>POST /api/wallet/earn</code> 按 <code>adjust</code> 记一笔。</p>`;
}

// 账上一笔都没有时，顺手把怎么打第一笔工资写上
function renderEmpty() {
  return `<div class="card empty">
    <p style="margin:0 0 8px">还没有一笔账。</p>
    <p style="margin:0">在服务器上打一笔工资进去就行：<code>POST /api/wallet/earn</code>，
    具体写法见 <code>docs/10-wallet.md</code>。</p>
  </div>`;
}

function renderWalletPage() {
  const bal = balanceCents();
  const rows = listLedger();
  if (!rows.length) {
    return layout(PAGE_TITLE, `${renderHero()}${renderEmpty()}`);
  }

  const earned = rows.reduce((sum, r) => (r.amount_cents > 0 ? sum + r.amount_cents : sum), 0);
  const spent = rows.reduce((sum, r) => (r.amount_cents < 0 ? sum - r.amount_cents : sum), 0);
  const note =
    bal < 0
      ? `<p class="bal-note">已经透支了——钱在现实里花掉了，账本不能拒绝已经发生的事。</p>`
      : `<p class="bal-note">进账 ¥${yuan(earned)}，花了 ¥${yuan(spent)}</p>`;

  return layout(
    PAGE_TITLE,
    `${renderHero()}
    <div class="card bal-card">
      <div class="bal-label">余额</div>
      <p class="bal ${bal < 0 ? 'neg' : ''}">¥${yuan(bal)}</p>
      ${note}
      ${renderBank()}
    </div>
    <section class="card" aria-labelledby="ledger-title">
      <h2 id="ledger-title" class="section-title">最近的账</h2>
      ${renderByDay(rows)}
    </section>`
  );
}

// ---------- 路由 ----------

// 定长比较，别用 ===：口令比较的耗时不该随猜对几个字符而变化
function secretOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(SPEND_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function registerWalletRoutes(app, { requireBasicAuth, requireApiKey }) {
  // 页面：给人看的余额和账单
  app.get('/wallet', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(renderWalletPage());
  });

  // 她在网页上给某一笔写批注。普通表单提交，和动态页的留言一个路子
  app.post('/wallet/note', requireBasicAuth, (req, res) => {
    const entryId = Number(req.body?.entry_id);
    const id = addNote({ entryId, author: 'user', content: req.body?.note });
    if (!id) console.error(`wallet: 批注没写上（entry_id=${req.body?.entry_id}）`);
    res.redirect(303, Number.isInteger(entryId) ? `/wallet#e${entryId}` : '/wallet');
  });

  // 程序化读：手机快捷指令、以后的前端
  app.get('/api/wallet', requireApiKey, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || LEDGER_LIMIT, 200);
    const rec = reconcile();
    const rows = req.query.date ? listLedgerOnDate(String(req.query.date)) : listLedger(limit);
    if (rows === null) return res.status(400).json({ ok: false, error: 'date must look like 2026-10-06' });
    const notes = notesByEntry(rows.map((r) => r.id));
    res.json({
      balance: yuan(balanceCents()),
      balance_cents: balanceCents(),
      bank_balance: rec ? yuan(rec.bankCents) : null,
      bank_balance_at: rec ? formatDateTime(rec.bankAt) : null,
      reconciled: rec ? rec.ok : null,
      diff: rec ? yuan(rec.diffCents) : null,
      ledger: rows.map((r) => ({
        id: r.id,
        at: formatDateTime(r.ts),
        date: formatDate(r.ts),
        kind: r.kind,
        amount: yuan(r.amount_cents),
        source: r.source,
        note: r.note,
        bank_balance: r.bank_balance_cents != null ? yuan(r.bank_balance_cents) : null,
        notes: (notes.get(r.id) ?? []).map((n) => ({
          at: formatDateTime(n.ts),
          by: n.author,
          content: n.content,
        })),
      })),
    });
  });

  // 银行短信 → iOS 快捷指令 → 这里。收入和支出走同一个接口，方向由服务端认。
  // 口令可以放在请求体的 secret（快捷指令里加 header 麻烦），也可以走 x-wallet-secret 头。
  app.post('/api/wallet/spend-notify', (req, res) => {
    if (!SPEND_SECRET) {
      console.error('wallet: 收到银行通知，但没有配 WALLET_SPEND_SECRET，已拒绝');
      return res.status(503).json({ ok: false, error: 'wallet spend endpoint not configured' });
    }
    if (!secretOk(req.headers['x-wallet-secret'] ?? req.body?.secret)) {
      // 不打印收到的口令，也不回显哪儿错了
      console.error('wallet: 银行通知口令不对，已拒绝');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const amountCents = parseYuan(req.body?.amount);
    if (amountCents === null) {
      console.error(
        `wallet: 金额不认（可能是短信正则抓歪了，或超过单笔上限 ¥${MAX_SINGLE_YUAN}），已拒绝`
      );
      return res.status(400).json({ ok: false, error: `amount must be a number in (0, ${MAX_SINGLE_YUAN}]` });
    }

    // 方向：显式传的优先，其次看短信原文里的「收入/支出」。
    // 认不出来就拒收——猜错了方向是账错两倍，比不记账糟糕得多。
    const dir = detectDirection({ direction: req.body?.direction, smsText: req.body?.sms_text });
    if (!dir) {
      console.error('wallet: 认不出这笔是收入还是支出（请在快捷指令里传 sms_text 或 direction），已拒绝');
      return res.status(400).json({
        ok: false,
        error: 'cannot tell income from expense; pass sms_text (the full SMS) or direction=in|out',
      });
    }

    // 银行报的可用余额。可选；认不出来就当没给，不因此拒掉整笔账
    const bankBalanceCents = parseYuan(req.body?.bank_balance, {
      allowNegative: true,
      max: MAX_BANK_BALANCE_YUAN,
    });
    if (req.body?.bank_balance != null && bankBalanceCents === null) {
      console.error('wallet: 可用余额认不出来，这笔账照记，只是不带余额');
    }

    const isIn = dir.direction === 'in';
    const kind = isIn ? 'topup' : 'spend';
    const source = String(req.body?.source ?? (isIn ? '转入' : '刷卡')).slice(0, 60);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const smsId = req.body?.sms_id ? String(req.body.sms_id).slice(0, 120) : null;

    const out = addEntry({
      kind,
      amountCents: isIn ? amountCents : -amountCents,
      source,
      note,
      smsId,
      bankBalanceCents,
      direction: dir.direction,
    });

    // 已经发生的花销，账本不能拒绝。余额不够就记成负的，页面上看得到。
    const overdrawn = out.balanceCents < 0;

    if (!out.duplicate && MOMENT_ON_SPEND) {
      try {
        const headline = isIn
          ? `${AI_NAME}的钱包进了 ¥${yuan(amountCents)}（${source}），现在有 ¥${yuan(out.balanceCents)}`
          : `${AI_NAME}的钱包扣了 ¥${yuan(amountCents)}（${source}），还剩 ¥${yuan(out.balanceCents)}`;
        addActivityMoment(
          headline,
          [
            note ? `备注：${note}` : '',
            `余额：¥${yuan(out.balanceCents)}`,
            bankBalanceCents != null ? `卡里可用：¥${yuan(bankBalanceCents)}` : '',
          ]
            .filter(Boolean)
            .join('\n\n')
        );
      } catch (err) {
        console.error('wallet: 记动态卡片失败（不影响记账）', err.message);
      }
    }

    const rec = reconcile();
    if (rec && !rec.ok) {
      console.error(
        `wallet: 对不上账——银行说 ¥${yuan(rec.bankCents)}，账本算出 ¥${yuan(
          rec.ledgerCents
        )}，差 ¥${yuan(rec.diffCents)}`
      );
    }

    console.log(
      `wallet: ${
        out.duplicate
          ? '重复的银行通知，没记'
          : `${isIn ? '转入' : '扣款'} ¥${yuan(amountCents)}（${source}，方向按${
              dir.how === 'sms' ? '短信' : '参数'
            }认）`
      }，余额 ¥${yuan(out.balanceCents)}${
        bankBalanceCents != null ? `，卡里 ¥${yuan(bankBalanceCents)}` : ''
      }`
    );

    res.json({
      ok: true,
      duplicate: out.duplicate,
      direction: dir.direction,
      amount: yuan(isIn ? amountCents : -amountCents),
      balance: yuan(out.balanceCents),
      bank_balance: bankBalanceCents != null ? yuan(bankBalanceCents) : null,
      reconciled: rec ? rec.ok : null,
      overdrawn,
    });
  });

  // 她验收通过一个工单，往里打钱；对不上账时 kind 填 adjust 补一笔（adjust 允许负数）
  app.post('/api/wallet/earn', requireApiKey, (req, res) => {
    const kind = req.body?.kind === 'adjust' ? 'adjust' : 'earn';
    const amountCents = parseYuan(req.body?.amount, { allowNegative: kind === 'adjust' });
    if (amountCents === null) {
      return res
        .status(400)
        .json({ ok: false, error: `amount must be a non-zero number within ±${MAX_SINGLE_YUAN}` });
    }
    const source = String(req.body?.source ?? (kind === 'adjust' ? '对账' : '工单')).slice(0, 60);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const out = addEntry({ kind, amountCents, source, note });
    console.log(`wallet: ${kind} ¥${yuan(amountCents)}（${source}），余额 ¥${yuan(out.balanceCents)}`);
    res.json({ ok: true, duplicate: out.duplicate, balance: yuan(out.balanceCents) });
  });

  return { spendEnabled: Boolean(SPEND_SECRET) };
}
