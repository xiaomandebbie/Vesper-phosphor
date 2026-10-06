// 电子小钱包：TA 自己赚的钱、花出去的钱，和一本对得上的账。
//
// 余额不单独存一个数，而是由流水（wallet_ledger）求和算出来。
// 这样余额和账单永远对得上：补一笔、删一笔都不用再跑去改另一个地方，
// 也不会出现「余额说还有一百，账单加起来只有八十」这种谁都说不清的局面。
//
// 钱从三条路进出：
//   earn    她验收通过一个工单，往里打钱（POST /api/wallet/earn）
//   spend   现实里刷了卡，银行发短信，iOS 快捷指令把金额 POST 过来（POST /api/wallet/spend-notify）
//   adjust  对不上账时人工补一笔（走 earn 接口，kind 填 adjust，金额可正可负）
//
// 金额一律用「分」存整数。浮点数算钱会算出 0.1+0.2=0.30000000000000004 这种账，
// 一旦对不上，谁都说不清是哪一笔错的。只在给人看的时候才换算成元。

import crypto from 'crypto';
import db from './state.js';
import { addActivityMoment } from './moments-store.js';
import { formatDateTime } from './wall-time.js';

// 短信扣款接口的口令。没配就不开那个接口——它是一个能改钱的写接口，
// 一旦端口暴露在公网上，不设口令等于谁都能往账上记花销。
const SPEND_SECRET = process.env.WALLET_SPEND_SECRET || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 单笔上限。短信正则偶尔会抓错数字（抓到卡号尾号、余额、日期），
// 上限挡一道，免得一条抓歪的短信把账刷爆。超了就拒收并在日志里留痕，人工再看。
const MAX_SINGLE_YUAN = Number(process.env.WALLET_MAX_SINGLE_YUAN || 500);

// 扣款后要不要在动态页记一张卡片（她点开能看到这笔花在哪儿）
const MOMENT_ON_SPEND = !/^(0|off|false|no)$/i.test(String(process.env.WALLET_MOMENT ?? '').trim());

// 页面和接口默认给多少条流水
const LEDGER_LIMIT = 50;
// 给唤醒提示带几条最近的账（太多会把 prompt 撑大，也没必要）
const WAKE_LEDGER_LIMIT = 5;

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
`);

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

// 分 → 给人看的元。负数保留符号，两位小数不省
export function yuan(cents) {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

// 元 → 分。接受数字和字符串（快捷指令传过来的是字符串），
// 认不出来、不是有限数、超上限的一律返回 null，由调用方决定怎么拒。
function parseYuan(value, { allowNegative = false } = {}) {
  const n = Number(String(value ?? '').trim());
  if (!Number.isFinite(n)) return null;
  if (!allowNegative && n <= 0) return null;
  if (n === 0) return null;
  if (Math.abs(n) > MAX_SINGLE_YUAN) return null;
  return Math.round(n * 100);
}

// 同一条短信被快捷指令重复触发（iOS 偶尔会），或者网络重试，都会 POST 两遍同样的内容。
// 客户端给了 sms_id 就用它；没给就按「同一分钟、同金额、同来源算同一笔」软去重。
//
// 边界说清楚：真在同一分钟刷了两笔一模一样的钱，第二笔会被当成重复挡掉。
// 这种概率比快捷指令重复触发低得多，而且挡掉的那笔在返回里标着 duplicate，
// 看到了可以用 earn 接口按 adjust 补一笔。
function dedupeKeyFor({ kind, amountCents, source, smsId, ts }) {
  if (smsId) return `sms:${smsId}`;
  return `${kind}:${amountCents}:${source || ''}:${Math.floor(ts / 60000)}`;
}

// 记一笔。返回 { id, duplicate, balanceCents }。
// duplicate 为 true 时这笔没记进去，余额是当前的真实余额。
export function addEntry({ kind, amountCents, source = null, note = null, smsId = null }) {
  const ts = Date.now();
  const dedupeKey = dedupeKeyFor({ kind, amountCents, source, smsId, ts });
  try {
    const id = stmt(
      'INSERT INTO wallet_ledger (ts, kind, amount_cents, source, note, dedupe_key) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(ts, kind, amountCents, source, note, dedupeKey).lastInsertRowid;
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

// ---------- 给唤醒用的那一行 ----------

const KIND_LABEL = { earn: '工资', spend: '花销', adjust: '对账' };

// 醒来时放进 user 消息里的一行（见 decide.js 的 buildUserPrompt）。
// 余额每花一笔就变，所以只能放 user，不能放 system——那边是靠前缀缓存省钱的。
//
// 账上一笔都没有时返回空字符串，decide 那边会过滤掉，不去占 prompt。
export function walletBlock() {
  const rows = listLedger(WAKE_LEDGER_LIMIT);
  if (!rows.length) return '';
  const bal = balanceCents();
  const recent = rows
    .map((r) => {
      const who = KIND_LABEL[r.kind] || r.kind;
      const amount = `${r.amount_cents > 0 ? '+' : ''}¥${yuan(r.amount_cents)}`;
      const what = r.source ? ` ${r.source}` : '';
      return `${formatDateTime(r.ts).slice(5, 10)} ${who}${what} ${amount}`;
    })
    .join('；');
  const low = bal <= 0 ? '（已经见底了，她刷卡的话账会记成负数）' : '';
  return `你的电子小钱包：余额 ¥${yuan(bal)}${low}。最近几笔：${recent}。这是你自己的钱，她在现实里刷那张卡，这里会自动扣。`;
}

// ---------- 路由 ----------

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 定长比较，别用 ===：口令比较的耗时不该随猜对几个字符而变化
function secretOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(SPEND_SECRET);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function renderWalletPage() {
  const bal = balanceCents();
  const rows = listLedger();
  const list = rows.length
    ? rows
        .map((r) => {
          const pos = r.amount_cents > 0;
          return `<li>
  <span class="t">${esc(formatDateTime(r.ts))}</span>
  <span class="k">${esc(KIND_LABEL[r.kind] || r.kind)}</span>
  <span class="s">${esc(r.source || '')}</span>
  <span class="a ${pos ? 'in' : 'out'}">${pos ? '+' : ''}¥${yuan(r.amount_cents)}</span>
  ${r.note ? `<span class="n">${esc(r.note)}</span>` : ''}
</li>`;
        })
        .join('\n')
    : '<li class="empty">还没有一笔账。</li>';

  return `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(AI_NAME)}的钱包</title>
<style>
  :root { color-scheme: light dark; }
  body { margin: 0; padding: 24px 16px 48px; font: 16px/1.6 -apple-system, system-ui, sans-serif;
         background: #eef2fb; color: #2b3048; }
  main { max-width: 620px; margin: 0 auto; }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 20px; letter-spacing: .04em; }
  .card { background: #fff; border-radius: 18px; padding: 22px 20px; margin-bottom: 20px;
          box-shadow: 0 2px 16px rgba(80,96,160,.10); }
  .bal-label { font-size: 13px; opacity: .6; }
  .bal { font-size: 36px; font-weight: 600; margin-top: 4px; letter-spacing: .02em; }
  .bal.neg { color: #c2453c; }
  h2 { font-size: 14px; font-weight: 600; opacity: .7; margin: 0 0 12px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li { display: grid; grid-template-columns: auto auto 1fr auto; gap: 4px 10px;
       align-items: baseline; padding: 11px 0; border-bottom: 1px solid rgba(120,135,185,.14); }
  li:last-child { border-bottom: none; }
  .t { font-size: 12px; opacity: .55; font-variant-numeric: tabular-nums; }
  .k { font-size: 12px; padding: 1px 7px; border-radius: 999px; background: rgba(120,135,185,.14); }
  .s { font-size: 14px; }
  .a { font-variant-numeric: tabular-nums; font-weight: 600; }
  .a.in { color: #2f7d5a; }
  .a.out { color: #c2453c; }
  .n { grid-column: 1 / -1; font-size: 13px; opacity: .6; }
  .empty { opacity: .5; }
  @media (prefers-color-scheme: dark) {
    body { background: #171a24; color: #e4e7f2; }
    .card { background: #21252f; box-shadow: none; }
  }
</style></head><body><main>
<h1>${esc(AI_NAME)}的钱包</h1>
<div class="card">
  <div class="bal-label">余额</div>
  <div class="bal ${bal < 0 ? 'neg' : ''}">¥${yuan(bal)}</div>
</div>
<div class="card">
  <h2>最近的账</h2>
  <ul>
${list}
  </ul>
</div>
</main></body></html>`;
}

export function registerWalletRoutes(app, { requireBasicAuth, requireApiKey }) {
  // 页面：给人看的余额和账单
  app.get('/wallet', requireBasicAuth, (req, res) => res.send(renderWalletPage()));

  // 程序化读：手机快捷指令、以后的前端
  app.get('/api/wallet', requireApiKey, (req, res) => {
    const limit = Math.min(Number(req.query.limit) || LEDGER_LIMIT, 200);
    res.json({
      balance: yuan(balanceCents()),
      balance_cents: balanceCents(),
      ledger: listLedger(limit).map((r) => ({
        id: r.id,
        at: formatDateTime(r.ts),
        kind: r.kind,
        amount: yuan(r.amount_cents),
        source: r.source,
        note: r.note,
      })),
    });
  });

  // 现实里刷卡了：银行短信 → iOS 快捷指令 → 这里。
  // 口令可以放在请求体的 secret（快捷指令里加 header 麻烦），也可以走 x-wallet-secret 头。
  app.post('/api/wallet/spend-notify', (req, res) => {
    if (!SPEND_SECRET) {
      console.error('wallet: 收到扣款通知，但没有配 WALLET_SPEND_SECRET，已拒绝');
      return res.status(503).json({ ok: false, error: 'wallet spend endpoint not configured' });
    }
    if (!secretOk(req.headers['x-wallet-secret'] ?? req.body?.secret)) {
      // 不打印收到的口令，也不回显哪儿错了
      console.error('wallet: 扣款通知口令不对，已拒绝');
      return res.status(401).json({ ok: false, error: 'unauthorized' });
    }

    const amountCents = parseYuan(req.body?.amount);
    if (amountCents === null) {
      console.error(`wallet: 扣款金额不认（可能是短信正则抓歪了，或超过单笔上限 ¥${MAX_SINGLE_YUAN}），已拒绝`);
      return res.status(400).json({ ok: false, error: `amount must be a number in (0, ${MAX_SINGLE_YUAN}]` });
    }

    const source = String(req.body?.source ?? '刷卡').slice(0, 60);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const smsId = req.body?.sms_id ? String(req.body.sms_id).slice(0, 120) : null;

    const out = addEntry({ kind: 'spend', amountCents: -amountCents, source, note, smsId });

    // 已经发生的花销，账本不能拒绝。余额不够就记成负的，页面和唤醒提示都看得到。
    const overdrawn = out.balanceCents < 0;

    if (!out.duplicate && MOMENT_ON_SPEND) {
      try {
        addActivityMoment(
          `${AI_NAME}的钱包扣了 ¥${yuan(amountCents)}（${source}），还剩 ¥${yuan(out.balanceCents)}`,
          [note ? `备注：${note}` : '', `余额：¥${yuan(out.balanceCents)}`].filter(Boolean).join('\n\n')
        );
      } catch (err) {
        console.error('wallet: 记动态卡片失败（不影响记账）', err.message);
      }
    }

    console.log(
      `wallet: ${out.duplicate ? '重复的扣款通知，没记' : `扣款 ¥${yuan(amountCents)}（${source}）`}，余额 ¥${yuan(out.balanceCents)}`
    );
    res.json({
      ok: true,
      duplicate: out.duplicate,
      amount: yuan(amountCents),
      balance: yuan(out.balanceCents),
      overdrawn,
    });
  });

  // 她验收通过一个工单，往里打钱；对不上账时 kind 填 adjust 补一笔（adjust 允许负数）
  app.post('/api/wallet/earn', requireApiKey, (req, res) => {
    const kind = req.body?.kind === 'adjust' ? 'adjust' : 'earn';
    const amountCents = parseYuan(req.body?.amount, { allowNegative: kind === 'adjust' });
    if (amountCents === null) {
      return res.status(400).json({ ok: false, error: `amount must be a non-zero number within ±${MAX_SINGLE_YUAN}` });
    }
    const source = String(req.body?.source ?? (kind === 'adjust' ? '对账' : '工单')).slice(0, 60);
    const note = req.body?.note ? String(req.body.note).slice(0, 300) : null;
    const out = addEntry({ kind, amountCents, source, note });
    console.log(`wallet: ${kind} ¥${yuan(amountCents)}（${source}），余额 ¥${yuan(out.balanceCents)}`);
    res.json({ ok: true, duplicate: out.duplicate, balance: yuan(out.balanceCents) });
  });

  return { spendEnabled: Boolean(SPEND_SECRET) };
}
