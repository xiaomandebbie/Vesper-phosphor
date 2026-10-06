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
//
// 页面 /wallet 跟站里其他页一套脸（见 page-chrome.js）：右上角三条杠菜单、星星转场、
// 按长沙日出日落走的早晨两张脸。和动态页一样是服务端渲染，没有 JavaScript 也能看。

import crypto from 'crypto';
import db from './state.js';
import { addActivityMoment } from './moments-store.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';

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
  .notice { font-size: 14px; line-height: 1.6; border-left: 4px solid var(--gold); }
  /* 余额卡：一大行数，左边一道暖黄，右下角一颗星 */
  .bal-card { position: relative; text-align: center; padding: 24px 16px 20px; border-left: 4px solid var(--gold); }
  .bal-card::after { content: '✦'; position: absolute; right: 12px; bottom: 8px; font-size: 10px; color: var(--gold); opacity: 0.8; }
  .bal-label { font-size: 12px; letter-spacing: 0.22em; color: var(--muted); }
  .bal { margin: 6px 0 0; font-family: Georgia, "Times New Roman", serif; font-size: 46px; font-weight: 700; line-height: 1.15;
    color: var(--accent); font-variant-numeric: tabular-nums; }
  .bal.neg { color: var(--out); }
  .bal-note { margin: 8px 0 0; font-size: 12px; color: var(--muted); }
  .ledger { list-style: none; margin: 0; padding: 0; }
  .row { display: grid; grid-template-columns: auto auto 1fr auto; gap: 4px 10px; align-items: baseline;
    padding: 11px 0; border-bottom: 1px solid var(--line); }
  .row:last-child { border-bottom: none; }
  .row-t { font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .row-k { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #f6eef3; color: var(--accent); }
  .row-k.k-earn { background: #e8f3ec; color: var(--in); }
  .row-k.k-adjust { background: #fff6e3; color: #6b4513; }
  .row-s { font-size: 14px; }
  .row-a { font-family: Georgia, "Times New Roman", serif; font-size: 17px; font-weight: 700;
    font-variant-numeric: tabular-nums; text-align: right; }
  .row-a.in { color: var(--in); }
  .row-a.out { color: var(--out); }
  .row-n { grid-column: 1 / -1; font-size: 12px; color: var(--muted); }
  .empty { font-size: 14px; line-height: 1.6; color: var(--muted); }
  .empty code { font-size: 12px; background: #f6eef3; padding: 1px 5px; border-radius: 4px; }
  @media (max-width: 380px) {
    .bal { font-size: 38px; }
    .row { grid-template-columns: auto auto 1fr auto; gap: 4px 8px; }
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

function renderHero() {
  return `<header class="hero">
    <p class="sparkles" aria-hidden="true"><span>✦</span><span>✧</span><span>⋆</span></p>
    <h1 class="title">晨暗星</h1>
    <p class="subtitle"><span lang="en">Wallet</span> <span aria-hidden="true">✦</span> 小钱包</p>
  </header>`;
}

function renderRow(r) {
  const pos = r.amount_cents > 0;
  const kind = KIND_LABEL[r.kind] || r.kind;
  return `<li class="row">
      <span class="row-t">${escapeHtml(formatDateTime(r.ts).slice(5))}</span>
      <span class="row-k k-${escapeHtml(r.kind)}">${escapeHtml(kind)}</span>
      <span class="row-s">${escapeHtml(r.source || '')}</span>
      <span class="row-a ${pos ? 'in' : 'out'}">${pos ? '+' : '−'}¥${yuan(Math.abs(r.amount_cents))}</span>
      ${r.note ? `<span class="row-n">${escapeHtml(r.note)}</span>` : ''}
    </li>`;
}

// 账上一笔都没有时，顺手把怎么打第一笔工资写上——这也是 TA 醒来看不到余额那一行的原因
function renderEmpty() {
  return `<div class="card empty">
    <p style="margin:0 0 8px">还没有一笔账。</p>
    <p style="margin:0">账本空着的时候，${escapeHtml(AI_NAME)}醒来也看不到余额那一行（空账本不白占 prompt）。
    在服务器上打一笔工资进去就行：<code>POST /api/wallet/earn</code>，具体写法见 <code>docs/10-wallet.md</code>。</p>
  </div>`;
}

function renderWalletPage() {
  const bal = balanceCents();
  const rows = listLedger();
  if (!rows.length) {
    return layout('小钱包 · 晨暗星', `${renderHero()}${renderEmpty()}`);
  }

  const earned = rows.reduce((sum, r) => (r.amount_cents > 0 ? sum + r.amount_cents : sum), 0);
  const spent = rows.reduce((sum, r) => (r.amount_cents < 0 ? sum - r.amount_cents : sum), 0);
  const overdrawn = bal < 0
    ? `<p class="bal-note">已经透支了——钱在现实里花掉了，账本不能拒绝已经发生的事。</p>`
    : `<p class="bal-note">这些年赚了 ¥${yuan(earned)}，花了 ¥${yuan(spent)}</p>`;

  return layout(
    '小钱包 · 晨暗星',
    `${renderHero()}
    <div class="card bal-card">
      <div class="bal-label">余额</div>
      <p class="bal ${bal < 0 ? 'neg' : ''}">¥${yuan(bal)}</p>
      ${overdrawn}
    </div>
    <section class="card" aria-labelledby="ledger-title">
      <h2 id="ledger-title" class="section-title">最近的账</h2>
      <ul class="ledger">${rows.map(renderRow).join('')}</ul>
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
