// 购物 —— 心愿单和购物记录是同一张表：一件东西从「想要」一路走到「已完成」，
// 中间经过「已请示」「待下单」「待支付」「待收货」。取消了就停在「取消了」。
//
// ── 为什么合成一张表 ──
//
// 原来 taobao-shopping-mcp 里心愿单（wishlist.json）和真实订单是两回事：
// 心愿单是他自己的"想要"，订单在淘宝那边。但对小满来说这是一件事的两头——
// 她在购物页上想看的是「这个东西现在到哪一步了」，不是两个列表对着看。
// 所以状态机从头拉到尾，页面按状态分组，MCP 按状态筛。
//
// ── 钱的边界 ──
//
// 付款这一步永远不在这个进程里。真正动浏览器的是「手」（见 scripts/shopping-hand.mjs，
// 跑在家里那台有登录态的机器上）。手走到支付密码框前会停下，回一个
// {ok:false, 哪步:'付款', 为什么:'要支付密码'}——这边就把这件事落成
// 「待支付」，然后往 Aru 的对话里发一句提醒（见 notifyPendingPay）。
// 小满要的「遇到待支付需要 aru 里发消息提醒我」就是这条路。
//
// 手上配了支付口令时它才会自己付完，那是小满在她自己那台机器上的选择，
// 这边不替她决定、也不保存口令。
//
// ── 家规 ──
//
// 单件上限、每月预算、一天几单：都在 .env 里（见 docs/13-shopping.md）。
// 撞了就拦在动浏览器之前，返回一句给他看的话，让他先来问小满。

import db from './state.js';
import { wallParts, wallMidnight, formatDateTime } from './wall-time.js';
import bark from './actions/bark.js';

db.exec(`
CREATE TABLE IF NOT EXISTS shopping_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'taobao',
  title TEXT NOT NULL,
  item_id TEXT,
  shop TEXT,
  url TEXT,
  image TEXT,
  sku TEXT,
  price_cents INTEGER,
  qty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'want',
  reason TEXT,
  note TEXT,
  order_no TEXT,
  eta TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  asked_at INTEGER,
  to_order_at INTEGER,
  to_pay_at INTEGER,
  to_receive_at INTEGER,
  done_at INTEGER,
  canceled_at INTEGER,
  notified_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_shopping_status ON shopping_items (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_shopping_created ON shopping_items (created_at);

CREATE TABLE IF NOT EXISTS shopping_chats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER,
  who TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_shopping_chats_item ON shopping_chats (item_id, ts);
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

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// ── 状态 ──

export const STATUS = ['want', 'asked', 'to_order', 'to_pay', 'to_receive', 'done', 'canceled'];

export const STATUS_LABEL = {
  want: '想要',
  asked: '已请示',
  to_order: '待下单',
  to_pay: '待支付',
  to_receive: '待收货',
  done: '已完成',
  canceled: '取消了',
};

// 页面上分组的顺序：要她动手的排前面，已经结束的排后面
export const STATUS_ORDER = ['to_pay', 'to_receive', 'to_order', 'asked', 'want', 'done', 'canceled'];

const STAMP = {
  asked: 'asked_at',
  to_order: 'to_order_at',
  to_pay: 'to_pay_at',
  to_receive: 'to_receive_at',
  done: 'done_at',
  canceled: 'canceled_at',
};

// 还没结束的：她还要管的那些
const OPEN = ['want', 'asked', 'to_order', 'to_pay', 'to_receive'];

export const KIND_LABEL = { taobao: '淘宝', takeout: '外卖' };

export const yuan = (cents) => ((Number(cents) || 0) / 100).toFixed(2);
const toCents = (price) => (Number.isFinite(Number(price)) ? Math.round(Number(price) * 100) : null);

// ── 读写 ──

export function addItem({ kind, title, itemId, shop, url, image, sku, price, qty, reason, status, note, orderNo, eta }) {
  const now = Date.now();
  const k = kind === 'takeout' ? 'takeout' : 'taobao';
  const st = STATUS.includes(status) ? status : 'want';
  const row = stmt(
    `INSERT INTO shopping_items
       (kind, title, item_id, shop, url, image, sku, price_cents, qty, status, reason, note, order_no, eta,
        created_at, updated_at, ${STAMP[st] ? `${STAMP[st]}, ` : ''}notified_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${STAMP[st] ? '?, ' : ''}NULL)`
  ).run(
    k,
    String(title || '没写名字的东西').slice(0, 200),
    itemId ? String(itemId).slice(0, 64) : null,
    shop ? String(shop).slice(0, 120) : null,
    url ? String(url).slice(0, 2048) : null,
    image ? String(image).slice(0, 2048) : null,
    sku ? String(sku).slice(0, 200) : null,
    toCents(price),
    Number.isInteger(qty) && qty > 0 ? Math.min(qty, 99) : 1,
    st,
    reason ? String(reason).slice(0, 500) : '',
    note ? String(note).slice(0, 500) : '',
    orderNo ? String(orderNo).slice(0, 64) : null,
    eta ? String(eta).slice(0, 64) : null,
    now,
    now,
    ...(STAMP[st] ? [now] : [])
  );
  return getItem(row.lastInsertRowid);
}

export function getItem(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) return null;
  return stmt('SELECT * FROM shopping_items WHERE id = ?').get(n) || null;
}

export function setStatus(id, status, note) {
  const it = getItem(id);
  if (!it) return null;
  if (!STATUS.includes(status)) return null;
  const now = Date.now();
  const col = STAMP[status];
  // 换了状态就把提醒过的记号清掉：下一次又变成待支付时该再提醒一次
  stmt(
    `UPDATE shopping_items SET status = ?, updated_at = ?, notified_at = NULL${
      note ? ', note = ?' : ''
    }${col ? `, ${col} = ?` : ''} WHERE id = ?`
  ).run(...[status, now, ...(note ? [String(note).slice(0, 500)] : []), ...(col ? [now] : []), it.id]);
  return getItem(it.id);
}

export function updateItem(id, patch = {}) {
  const it = getItem(id);
  if (!it) return null;
  const sets = [];
  const vals = [];
  const put = (col, value) => {
    sets.push(`${col} = ?`);
    vals.push(value);
  };
  if (patch.title != null) put('title', String(patch.title).slice(0, 200));
  if (patch.shop != null) put('shop', String(patch.shop).slice(0, 120));
  if (patch.url != null) put('url', String(patch.url).slice(0, 2048));
  if (patch.image != null) put('image', String(patch.image).slice(0, 2048));
  if (patch.sku != null) put('sku', String(patch.sku).slice(0, 200));
  if (patch.price != null) put('price_cents', toCents(patch.price));
  if (patch.qty != null && Number.isInteger(patch.qty)) put('qty', Math.min(Math.max(patch.qty, 1), 99));
  if (patch.reason != null) put('reason', String(patch.reason).slice(0, 500));
  if (patch.note != null) put('note', String(patch.note).slice(0, 500));
  if (patch.orderNo != null) put('order_no', String(patch.orderNo).slice(0, 64));
  if (patch.eta != null) put('eta', String(patch.eta).slice(0, 64));
  if (!sets.length) return it;
  put('updated_at', Date.now());
  stmt(`UPDATE shopping_items SET ${sets.join(', ')} WHERE id = ?`).run(...vals, it.id);
  return getItem(it.id);
}

export function removeItem(id) {
  const it = getItem(id);
  if (!it) return false;
  stmt('DELETE FROM shopping_chats WHERE item_id = ?').run(it.id);
  stmt('DELETE FROM shopping_items WHERE id = ?').run(it.id);
  return true;
}

export function listItems({ status, kind, limit = 60 } = {}) {
  const n = Math.min(Math.max(Number(limit) || 60, 1), 200);
  const where = [];
  const vals = [];
  if (status === 'open') {
    where.push(`status IN (${OPEN.map(() => '?').join(', ')})`);
    vals.push(...OPEN);
  } else if (STATUS.includes(status)) {
    where.push('status = ?');
    vals.push(status);
  }
  if (kind === 'taobao' || kind === 'takeout') {
    where.push('kind = ?');
    vals.push(kind);
  }
  const sql = `SELECT * FROM shopping_items${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
               ORDER BY updated_at DESC, id DESC LIMIT ?`;
  return stmt(sql).all(...vals, n);
}

export function counts() {
  const rows = stmt('SELECT status, COUNT(*) AS c FROM shopping_items GROUP BY status').all();
  const out = {};
  for (const s of STATUS) out[s] = 0;
  for (const r of rows) out[r.status] = r.c;
  return out;
}

export function pendingPay() {
  return stmt('SELECT * FROM shopping_items WHERE status = ? ORDER BY to_pay_at ASC, id ASC').all('to_pay');
}

// ── 客服对话 / 批注 ──

export const MAX_CHAT_CHARS = 500;

export function addChat({ itemId, who, content }) {
  const text = String(content ?? '').trim().slice(0, MAX_CHAT_CHARS);
  if (!text) return null;
  const role = ['assistant', 'user', 'seller'].includes(who) ? who : 'assistant';
  const id = itemId != null && Number.isInteger(Number(itemId)) ? Number(itemId) : null;
  const row = stmt('INSERT INTO shopping_chats (item_id, who, content, ts) VALUES (?, ?, ?, ?)').run(
    id,
    role,
    text,
    Date.now()
  );
  return Number(row.lastInsertRowid);
}

export function listChats(itemId, limit = 30) {
  const n = Math.min(Math.max(Number(limit) || 30, 1), 100);
  if (itemId == null) {
    return stmt('SELECT * FROM shopping_chats ORDER BY ts DESC, id DESC LIMIT ?').all(n).reverse();
  }
  return stmt('SELECT * FROM shopping_chats WHERE item_id = ? ORDER BY ts ASC, id ASC LIMIT ?').all(
    Number(itemId),
    n
  );
}

// ── 家规 ──

const envNum = (key, fallback) => {
  const raw = String(process.env[key] ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : fallback;
};

// 单件上限（元）。0 = 不限
export const MAX_PRICE = envNum('SHOPPING_MAX_PRICE', 200);
// 每月预算（元）。0 = 不限
export const MONTHLY_BUDGET = envNum('SHOPPING_MONTHLY_BUDGET', 600);
// 一天最多推进几单（下单 / 加购这类真会动钱的动作）
export const DAILY_ORDERS = envNum('SHOPPING_DAILY_ORDERS', 2);

const dayStart = (ms = Date.now()) => {
  const p = wallParts(ms);
  return wallMidnight(p.y, p.m, p.d);
};

export function monthStats(ms = Date.now()) {
  const p = wallParts(ms);
  const from = wallMidnight(p.y, p.m, 1);
  const rows = stmt(
    `SELECT price_cents, qty, status FROM shopping_items
      WHERE created_at >= ? AND status IN ('to_order','to_pay','to_receive','done')`
  ).all(from);
  const spentCents = rows.reduce((s, r) => s + (Number(r.price_cents) || 0) * (Number(r.qty) || 1), 0);
  return {
    month: `${p.y}-${String(p.m).padStart(2, '0')}`,
    count: rows.length,
    spentCents,
    budgetCents: MONTHLY_BUDGET ? Math.round(MONTHLY_BUDGET * 100) : 0,
  };
}

export function ordersToday(ms = Date.now()) {
  return stmt(
    `SELECT COUNT(*) AS c FROM shopping_items
      WHERE (to_order_at >= ? OR to_pay_at >= ? OR to_receive_at >= ?)`
  ).get(dayStart(ms), dayStart(ms), dayStart(ms)).c;
}

// 这件事能不能往前推一步（真要花钱的那一步）。
// 返回 { ok } 或 { ok:false, reasons:[...] }
export function checkPolicy(item) {
  const reasons = [];
  const cents = (Number(item?.price_cents) || 0) * (Number(item?.qty) || 1);
  if (MAX_PRICE && cents > MAX_PRICE * 100) {
    reasons.push(`这件 ¥${yuan(cents)}，超过单件上限 ¥${MAX_PRICE.toFixed(2)}`);
  }
  const m = monthStats();
  if (m.budgetCents && m.spentCents + cents > m.budgetCents) {
    reasons.push(
      `这个月已经记了 ¥${yuan(m.spentCents)}，再加这件会超过预算 ¥${yuan(m.budgetCents)}`
    );
  }
  if (DAILY_ORDERS && ordersToday() >= DAILY_ORDERS) {
    reasons.push(`今天已经推进了 ${ordersToday()} 单，一天最多 ${DAILY_ORDERS} 单`);
  }
  return reasons.length ? { ok: false, reasons } : { ok: true };
}

// ── 本机那只手 ──
//
// 真正动浏览器的脚本（order.js、taobao relay）住在家里那台有登录态的机器上，
// 晨暮星在 VPS 上，所以隔着一层 HTTP。手的协议见 scripts/shopping-hand.mjs。
// 没配 SHOPPING_HAND_URL 时所有真实动作都明确报"没有手"，心愿单照样能用。

const HAND_URL = String(process.env.SHOPPING_HAND_URL ?? '').trim().replace(/\/+$/, '');
const HAND_TOKEN = String(process.env.SHOPPING_HAND_TOKEN ?? '').trim();

export function handEnabled() {
  return Boolean(HAND_URL);
}

// 下单、付款这类动作在浏览器里要走好几十秒，所以超时给得长。
export async function hand(path, body, { timeoutMs = 90000 } = {}) {
  if (!HAND_URL) {
    return {
      ok: false,
      error: 'hand_not_configured',
      message: '这台机器上没有手（没配 SHOPPING_HAND_URL），只能看和记，不能真的动淘宝或外卖。',
    };
  }
  try {
    const res = await fetch(`${HAND_URL}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(HAND_TOKEN ? { 'x-shopping-hand-token': HAND_TOKEN } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!res.ok) {
      return { ok: false, error: `hand_http_${res.status}`, message: data?.message || `手那边回了 HTTP ${res.status}` };
    }
    if (data == null) return { ok: false, error: 'hand_bad_json', message: '手那边回的东西读不出来' };
    return data;
  } catch (err) {
    return { ok: false, error: 'hand_unreachable', message: `连不上家里那只手：${err.message}` };
  }
}

export async function handPing() {
  if (!HAND_URL) return { ok: false, message: '没配 SHOPPING_HAND_URL' };
  return hand('/ping', {}, { timeoutMs: 8000 });
}

// ── 待支付 → 往 Aru 的对话里说一句 ──
//
// 同一件事 6 小时内只提醒一次（notified_at）。状态变过又回到待支付时记号会清掉，
// 所以那种情况会再提醒 —— 那本来就是新的一次"等她付钱"。

const NOTIFY_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function payLine(it) {
  const price = it.price_cents ? ` ¥${yuan(it.price_cents * (it.qty || 1))}` : '';
  const where = it.kind === 'takeout' ? '外卖' : '淘宝';
  const head = `有一单${where}卡在付款那一步了：「${it.title}」${price}`;
  const tail = it.url ? `\n${it.url}` : '';
  const why = it.note ? `\n（${it.note}）` : '';
  return `${head}${why}\n你有空的时候付一下就好，我这边不碰钱。${tail}`;
}

export async function notifyPendingPay(item, { force = false } = {}) {
  const it = typeof item === 'object' ? item : getItem(item);
  if (!it || it.status !== 'to_pay') return { ok: false, reason: 'not_pending_pay' };
  if (!force && it.notified_at && Date.now() - it.notified_at < NOTIFY_COOLDOWN_MS) {
    return { ok: false, reason: 'cooldown' };
  }
  let out;
  try {
    out = await bark(payLine(it));
  } catch (err) {
    console.error('shopping: 待支付提醒没发出去', err.message);
    return { ok: false, reason: err.message };
  }
  if (out?.ok) {
    stmt('UPDATE shopping_items SET notified_at = ? WHERE id = ?').run(Date.now(), it.id);
    console.log(`shopping: 待支付提醒已发（#${it.id}「${it.title}」）`);
  } else {
    console.error(`shopping: 待支付提醒没发成（#${it.id}）：${out?.reason ?? '?'}`);
  }
  return out ?? { ok: false, reason: 'unknown' };
}

// vesper 起来之后每隔一阵扫一遍：有待支付又没提醒过的就说一句。
// 手那边把状态写成待支付时（不走这个进程），靠这个兜住。
export function startPendingPayWatch({ intervalMinutes = 30 } = {}) {
  const every = Math.max(Number(intervalMinutes) || 30, 5) * 60000;
  const sweep = async () => {
    try {
      for (const it of pendingPay()) {
        if (it.notified_at && Date.now() - it.notified_at < NOTIFY_COOLDOWN_MS) continue;
        await notifyPendingPay(it);
      }
    } catch (err) {
      console.error('shopping: 巡检待支付出错', err.message);
    }
  };
  // 刚起来先等两分钟，别和启动时那堆事挤在一起
  setTimeout(sweep, 2 * 60000);
  const timer = setInterval(sweep, every);
  timer.unref?.();
  return timer;
}

// ── 给他看的文字 ──

export function describeItem(it) {
  const bits = [`#${it.id}`, `[${STATUS_LABEL[it.status] ?? it.status}]`, `${KIND_LABEL[it.kind] ?? it.kind}`, it.title];
  if (it.price_cents) bits.push(`¥${yuan(it.price_cents)}${(it.qty || 1) > 1 ? ` ×${it.qty}` : ''}`);
  if (it.sku) bits.push(`（${it.sku}）`);
  const head = bits.join(' ');
  const lines = [head];
  if (it.shop) lines.push(`  店：${it.shop}`);
  if (it.reason) lines.push(`  为什么想要：${it.reason}`);
  if (it.note) lines.push(`  备注：${it.note}`);
  if (it.order_no) lines.push(`  单号：${it.order_no}${it.eta ? ` · ${it.eta}` : ''}`);
  if (it.url) lines.push(`  ${it.url}`);
  lines.push(`  最后动过：${formatDateTime(it.updated_at).slice(5)}`);
  return lines.join('\n');
}

export function describeList({ status, kind, limit } = {}) {
  const items = listItems({ status, kind, limit });
  const c = counts();
  const head =
    `购物清单（${items.length} 条${status ? `，${STATUS_LABEL[status] ?? status}` : ''}）。` +
    `现在：${STATUS_ORDER.filter((s) => c[s]).map((s) => `${STATUS_LABEL[s]} ${c[s]}`).join('、') || '什么都没有'}。`;
  if (!items.length) return `${head}\n\n还没有东西。`;
  return `${head}\n\n${items.map(describeItem).join('\n\n')}`;
}

export function describeMoney() {
  const m = monthStats();
  const lines = [
    `${m.month} 记在账上的：${m.count} 件，合计 ¥${yuan(m.spentCents)}` +
      (m.budgetCents ? ` / 预算 ¥${yuan(m.budgetCents)}` : '（没设预算）'),
    MAX_PRICE ? `单件上限 ¥${MAX_PRICE.toFixed(2)}` : '单件没有上限',
    DAILY_ORDERS ? `今天推进了 ${ordersToday()} 单，一天最多 ${DAILY_ORDERS} 单` : '一天的单数没有上限',
    handEnabled() ? '家里那只手配好了，可以真的去逛、去加购、去点外卖。' : '还没配手，这边只能看和记。',
  ];
  return lines.join('\n');
}

export function shoppingSummaryLine() {
  const c = counts();
  const open = STATUS_ORDER.filter((s) => OPEN.includes(s) && c[s]);
  if (!open.length) return '购物清单里现在没有待办的。';
  return `购物清单：${open.map((s) => `${STATUS_LABEL[s]} ${c[s]}`).join('、')}。`;
}

export { AI_NAME as SHOPPING_AI_NAME, OPEN as OPEN_STATUS };
