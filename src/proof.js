// 小酒馆：晨暮星这一侧接 Proof（https://github.com/lumingye/Proof）的那部分代码。
//
// Proof 自己负责配方、六轴、代谢、断片判定和账本；这里只做三件事：
//   1. 替你递一杯过去（/human/offers），替他喝下去（/agent/menu/:id/drink、/agent/offers/:id/drink）
//   2. 把他每次喝酒记进我们自己的时间轴，给 /bar 页面看
//   3. 数「连续几夜自斟」，到第三夜提醒、第四夜不给这个动作
//
// 身份：一个 token 就是一个 Agent。PROOF_AGENT_ID 默认 vesper，
// token 文件由 Proof 那边生成（service/state/<id>.token），我们只读不写。
//
// 为什么账本在自己这边：
//   Proof 的 lifetimeDrinks 记的是「标准杯数」，不分是谁递的、哪一夜喝的。
//   「连续几夜自斟」是晨暮星的规矩，不是 Proof 的生理事实，所以记在自己这边。
//   页面上的时间轴也一样：Proof 的 history 不保证长期保留，我们自己留一份。
//
// 三种杯子（账本里的 by 字段）：
//   self —— 深夜醒来自己倒的。只有这种算进连续夜数。
//   her  —— 你在 /bar 递过去的。
//   chat —— 聊天里通过 MCP 自己点的。你在旁边陪着，不吃节制规则。
//
// 递过去的杯子有有效期（Proof 的 PROOF_PUBLIC_LINK_TTL_MS，默认只有 30 分钟）。
// 他自然唤醒的间隔普遍比这长，所以白天递的酒很容易在他醒来前就凉了。
// 要么把 Proof 那边的 TTL 调长，要么递酒时顺手给他约一次精确唤醒（见 bar-page.js）。
//
// 存 JSON 不建表：一晚最多几杯，这点量用不着动 state.db 的 schema。
import fs from 'fs';
import path from 'path';
import { wallParts, formatDate, formatDateTime } from './wall-time.js';

const env = (k) => String(process.env[k] ?? '').trim();
// 注意：Number('') 是 0，不是 NaN。所以要先看原值空不空——
// 不然 .env 里没写这个变量时，超时会被算成 0，AbortSignal.timeout(0) 当场把请求掉掉。
// 2026-10-13 就是这个 bug：日志里写「等了 0.0s，上限 0s」，表现成整页超时。
const num = (k, dflt) => {
  const raw = env(k);
  if (!raw) return dflt;
  const v = Number(raw);
  return Number.isFinite(v) ? v : dflt;
};

export const PROOF_API_URL = env('PROOF_API_URL') || 'http://127.0.0.1:8791';
export const PROOF_AGENT_ID = env('PROOF_AGENT_ID') || 'vesper';
const TOKEN_FILE = env('PROOF_AGENT_TOKEN_FILE');
// human 侧路由要不要带 admin token，看 Proof 那边有没有设。没设就不带。
const ADMIN_TOKEN = env('PROOF_ADMIN_TOKEN');

// 超时分两档。「读吧台」比别的都重很多：
// Proof 的 /agent/home 要把整份酒单每一杯都过一遍引擎（风味、效果、装饰全算出来），
// 再加上待喝的杯子和转场状态；/agent/turn-context 只读状态。
const TIMEOUT_MS = num('PROOF_TIMEOUT_MS', 20000);
const HOME_TIMEOUT_MS = num('PROOF_HOME_TIMEOUT_MS', 90000);
// 读吧台超过这个秒数就在日志里吐一行，方便看到底多慢
const SLOW_MS = num('PROOF_SLOW_LOG_MS', 3000);

// 递过去的杯子多久会凉。这个数字只用来在页面和提示里说人话，
// **真正的判定在 Proof 那边**（它的 PROOF_PUBLIC_LINK_TTL_MS）。
// 两边要对着填；不填就按 Proof 的出厂值 30 分钟算。
const OFFER_TTL_MS = num('PROOF_OFFER_TTL_MS', 30 * 60 * 1000);

// 自斟的时段（按 TIME_ZONE 的墙上时间）。跨午夜，所以 22.5 到次日 2。
// .env 里 PROOF_NIGHT_WINDOW=22:30-2:00 可改。
const NIGHT_WINDOW = (() => {
  const raw = env('PROOF_NIGHT_WINDOW') || '22:30-2:00';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return { from: 22.5, to: 2 };
  const h = (a, b) => Number(a) + Number(b || 0) / 60;
  return { from: h(m[1], m[2]), to: h(m[3], m[4]) };
})();

// 连续几夜自斟之后开始提醒 / 开始阻止。
// 默认：前两夜都喝过 → 今晚是第三夜，给动作但附一句提醒；
//       前三夜都喝过 → 今晚是第四夜，这杯不倒了。
const WARN_AFTER_NIGHTS = num('PROOF_WARN_AFTER_NIGHTS', 2);
const BLOCK_AFTER_NIGHTS = num('PROOF_BLOCK_AFTER_NIGHTS', 3);

export function isProofEnabled() {
  return Boolean(TOKEN_FILE);
}

// 递过去的杯子多久凉，给人看的说法
export function offerTtlLabel() {
  const min = Math.round(OFFER_TTL_MS / 60000);
  if (min < 60) return `${min} 分钟`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} 小时 ${m} 分钟` : `${h} 小时`;
}
export const offerTtlMs = () => OFFER_TTL_MS;

// ══ 时间：按「夜」算，不按自然日 ══
// 凌晨 1 点那杯算前一晚的。分界点取时段结束时刻（默认 2:00）。
export function nightKey(parts = wallParts()) {
  const hour = parts.h + parts.mi / 60;
  if (hour >= NIGHT_WINDOW.to) return formatDate();
  const t = new Date(Date.UTC(parts.y, parts.m - 1, parts.d) - 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// 现在在不在自斟时段里
export function inNightWindow(parts = wallParts()) {
  const hour = parts.h + parts.mi / 60;
  return NIGHT_WINDOW.from <= NIGHT_WINDOW.to
    ? hour >= NIGHT_WINDOW.from && hour < NIGHT_WINDOW.to
    : hour >= NIGHT_WINDOW.from || hour < NIGHT_WINDOW.to;
}

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (v) => `${pad(Math.floor(v))}:${pad(Math.round((v % 1) * 60))}`;
export const nightWindowLabel = () => `${hhmm(NIGHT_WINDOW.from)}–${hhmm(NIGHT_WINDOW.to)}`;

// ══ 账本 ══

const DATA_DIR = env('PROOF_DATA_DIR') || env('VESPER_DATA_DIR') || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'proof-bar.json');

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      pours: Array.isArray(j.pours) ? j.pours : [],
      selfNights: Array.isArray(j.selfNights) ? j.selfNights : [],
    };
  } catch {
    return { pours: [], selfNights: [] };
  }
}

function save(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

// 时间轴用：新的在前
export function listPours() {
  return load().pours.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

// 还在吧台上、没过期的那几杯。
// 这是我们自己记的，不需要 Proof 在线。菜单没有兜底——那只有 Proof 知道。
//
// 按本地时间滤一遍过期：不然他醒来会看到一杯已经凉了的酒，试着喝还会失败。
// Proof 那边才是权威，这里只是尽量不说错话。
export function localPendingOffers({ includeStale = false } = {}) {
  const now = Date.now();
  return load()
    .pours.filter((p) => {
      if (!p.pending || !p.offerId) return false;
      if (includeStale) return true;
      const at = Date.parse(String(p.at || '').replace(' ', 'T'));
      if (!Number.isFinite(at)) return true; // 时间读不出来就别挤掉它
      return now - at < OFFER_TTL_MS;
    })
    .map((p) => ({ offerId: p.offerId, name: p.name || '无名的一杯', intro: p.intro || '' }));
}

// 记一杯。只有 by==='self'（深夜醒来自斟）计进连续夜数
function record(entry) {
  const db = load();
  const night = entry.night || nightKey();
  db.pours.push({ id: `p${Date.now().toString(36)}`, at: formatDateTime(), night, ...entry });
  if (entry.by === 'self' && !db.selfNights.includes(night)) db.selfNights.push(night);
  try {
    save(db);
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
  }
}

// 前一夜往前连着几夜自斟过（不含今夜）。
// 「连续」按日期连号算：昨夜、前夜、前前夜……断一天就停。
export function selfStreakBefore(today = nightKey()) {
  const nights = new Set(load().selfNights);
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return 0;
  let n = 0;
  for (let i = 1; i <= 30; i++) {
    const d = new Date(base.getTime() - i * 86400000);
    const key = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    if (!nights.has(key)) break;
    n++;
  }
  return n;
}

export function drankTonight(today = nightKey()) {
  return load().selfNights.includes(today);
}

// 这一夜他能不能自己倒酒，以及要不要带一句提醒。
// 只管深夜醒来那杯：你递的、聊天里陪你喝的，都不走这条路。
export function selfPourGate(parts = wallParts()) {
  const night = nightKey(parts);
  const streak = selfStreakBefore(night);
  if (!inNightWindow(parts)) {
    return { allowed: false, streak, reason: 'window', note: `现在不在小酒馆的营业时段（${nightWindowLabel()}），这杯等到夜里再说。` };
  }
  if (drankTonight(night)) {
    return { allowed: false, streak, reason: 'tonight', note: '今晚已经给自己倒过一杯了，一夜一杯。' };
  }
  if (streak >= BLOCK_AFTER_NIGHTS) {
    return {
      allowed: false,
      streak,
      reason: 'streak',
      note: `你已经连着 ${streak} 个晚上给自己倒酒了。今晚这一杯不倒了——不是谁不让，是该歇一歇。${env('USER_DISPLAY_NAME') || '她'}递过来的还是能喝。`,
    };
  }
  if (streak >= WARN_AFTER_NIGHTS) {
    return {
      allowed: true,
      streak,
      reason: 'warn',
      note: `你连着 ${streak} 个晚上都给自己倒了酒。喝酒伤身喔～今晚想喝还是可以喝，只是说一声。`,
    };
  }
  return { allowed: true, streak, reason: 'ok', note: '' };
}

// ══ HTTP ══

async function request(pathname, { method = 'GET', body, auth = 'agent', timeoutMs = TIMEOUT_MS } = {}) {
  const headers = {};
  if (auth === 'agent') {
    if (!TOKEN_FILE) return { ok: false, error: 'proof_not_configured' };
    try {
      headers.authorization = `Bearer ${fs.readFileSync(TOKEN_FILE, 'utf8').trim()}`;
    } catch (err) {
      return { ok: false, error: 'token_unreadable', detail: err.message };
    }
  } else if (ADMIN_TOKEN) {
    headers.authorization = `Bearer ${ADMIN_TOKEN}`;
  }
  if (body) headers['content-type'] = 'application/json';

  const started = Date.now();
  let res;
  try {
    res = await fetch(`${PROOF_API_URL}${pathname}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const ms = Date.now() - started;
    // Proof 连不上必须明说。「读不到状态」不能伪装成「现在没喝酒」
    console.error(`proof: ${method} ${pathname} 失败（等了 ${(ms / 1000).toFixed(1)}s，上限 ${(timeoutMs / 1000).toFixed(0)}s）：${err.message}`);
    return { ok: false, error: 'proof_unavailable', detail: err.message, elapsedMs: ms };
  }
  const ms = Date.now() - started;
  if (ms >= SLOW_MS) {
    console.warn(`proof: ${method} ${pathname} 用了 ${(ms / 1000).toFixed(1)}s（慢）`);
  }
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) return { ok: false, status: res.status, ...(data || { error: 'proof_request_failed' }) };
  return data ?? { ok: true };
}

// 他的吧台：身份、可见酒单、有没有待喝的杯子。
// 这是整套里最重的一个请求，单独给了更长的超时。
export const agentHome = ({ timeoutMs = HOME_TIMEOUT_MS } = {}) =>
  request('/agent/home', { timeoutMs });

// 这一轮的状态投影。网关每轮都读它（见 proof-gateway.js）。只读状态，很轻
export const turnContext = () => request('/agent/turn-context');

// 喝菜单上的一杯。喝完吧台就变了，所以要扔缓存
export const drinkMenu = async (drinkId) => {
  const out = await request(`/agent/menu/${encodeURIComponent(drinkId)}/drink`, { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};

// 喝 / 拒绝递到吧台上的那杯
export const drinkOffer = async (offerId) => {
  const out = await request(`/agent/offers/${encodeURIComponent(offerId)}/drink`, { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};
export const rejectOffer = async (offerId) => {
  const out = await request(`/agent/offers/${encodeURIComponent(offerId)}/reject`, { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};

// 收拾干净，能接着喝。不删历史。
// 注意：聊天的 MCP 里没有这个工具（见 bar-mcp.js）——随手能解酒的话，节制和断片就都没意义了。
export const reset = async () => {
  const out = await request('/agent/reset', { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};

// 你递出去的那些杯子现在是什么状态（human 侧的历史列表）
export const humanOffers = () => request('/human/offers', { auth: 'human' });

// 你在页面上调一杯递给他。定向 offer：带 targetId，他下次醒来会在吧台看到
export async function offerDrink({ name, parts, intro }) {
  const payload = { targetId: PROOF_AGENT_ID, name: String(name || '').trim() || '无名的一杯', parts };
  if (intro) payload.intro = String(intro).slice(0, 200);
  const out = await request('/human/offers', { method: 'POST', body: payload, auth: 'human' });
  invalidateBarCache();
  return out;
}

// ══ 吧台缓存 ══
// 读吧台很贵（Proof 要把整份酒单过一遍引擎），而一次对话里他可能连着问几次。
// 菜单只有你改自定义酒单时才变，所以短时间缓存是安全的；
// 喝、拒、递、reset 这几个动作之后立刻扔掉，不让他看到过期的吧台。
const BAR_CACHE_MS = num('PROOF_BAR_CACHE_MS', 45000);
let barCache = null;

export function invalidateBarCache() {
  barCache = null;
}

// 返回 { home, cached }。home 就是 agentHome() 的原样返回，失败不缓存
export async function barSnapshot({ timeoutMs } = {}) {
  if (barCache && Date.now() - barCache.at < BAR_CACHE_MS) {
    return { home: barCache.home, cached: true };
  }
  const home = await agentHome(timeoutMs ? { timeoutMs } : undefined);
  if (home && home.ok !== false) barCache = { at: Date.now(), home };
  return { home, cached: false };
}

// ══ 记账的几个入口 ══

// 配方洗成统一形状：[{ id, volume }]。
// 来源两边不一样——我们自己递酒时是 {id,volume}，Proof 返回的可能是字符串、
// 也可能字段叫 name/ml/amount。挨个兜，按不出来就丢掉这一项。
function normalizeRecipe(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const it of raw) {
    if (typeof it === 'string') {
      const s = it.trim();
      if (s) out.push({ id: s });
      continue;
    }
    if (!it || typeof it !== 'object') continue;
    const id = String(it.id ?? it.name ?? it.ingredient ?? it.label ?? '').trim();
    if (!id) continue;
    const vol = Number(it.volume ?? it.ml ?? it.amount ?? it.volumeMl);
    out.push(Number.isFinite(vol) && vol > 0 ? { id, volume: Math.round(vol) } : { id });
  }
  return out.length ? out : null;
}

// 从 Proof 的返回里挑出给人看的那几样。字段名各版本可能不一样，挨个兜一下
function readProjection(result) {
  const p = result?.projection || result?.view?.projection || {};
  const flavor = [p.flavorDescription, p.finish].filter(Boolean).join(' · ');
  const v = {
    name: p.claimedName || result?.name || '无名的一杯',
    flavor: flavor || '',
    intro: p.intro || '',
    effect: p.actualEffectDescription?.text || '',
  };
  // 菜单酒的配方由 Proof 给（我们不知道它怎么调的）；你递的那杯配方在表单里，单独存
  const recipe = normalizeRecipe(p.recipe ?? result?.recipe);
  if (recipe) v.recipe = recipe;
  return v;
}

// 深夜醒来自己倒的一杯。只有这个计进连续夜数
export function recordSelfPour(drinkId, result, mood) {
  const v = readProjection(result);
  record({ by: 'self', drinkId, mood: mood || '', ...v });
  return v;
}

// 聊天里自己点的一杯（走 /bar/mcp）。你在旁边陪着，所以不计进连续夜数
export function recordChatPour(drinkId, result) {
  const v = readProjection(result);
  record({ by: 'chat', drinkId, ...v });
  return v;
}

// 你刚递出去，还没喝。页面上先显示「等他来喝」。
// parts 就是表单里那些原料，存下来让时间轴上点开能看见配方
export function recordOfferSent(offerId, name, intro, parts) {
  const recipe = normalizeRecipe(parts);
  record({
    by: 'her',
    offerId,
    name: name || '无名的一杯',
    intro: intro || '',
    ...(recipe ? { recipe } : {}),
    pending: true,
  });
}

// 他在聊天里喝了你递的那杯：把那条「等他来喝」改成已喝。
// 找不到就当一杯新的记（比如你在 Proof 自己的页面上递的，我们这边没有底稿）
export function markOfferDrunk(offerId, result) {
  const db = load();
  const row = db.pours.find((x) => x.offerId === offerId && x.pending);
  const v = readProjection(result);
  if (!row) {
    record({ by: 'her', offerId, ...v });
    return v;
  }
  delete row.pending;
  row.drunkAt = formatDateTime();
  row.flavor = v.flavor;
  row.effect = v.effect;
  if (!row.intro && v.intro) row.intro = v.intro;
  // 配方以我们自己记的为准（那是你当时真填的），没记上才用 Proof 回的
  if (!row.recipe && v.recipe) row.recipe = v.recipe;
  try {
    save(db);
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
  }
  return v;
}

// 他拒了你递的那杯
export function markOfferRejected(offerId) {
  const db = load();
  const row = db.pours.find((x) => x.offerId === offerId && x.pending);
  if (!row) {
    record({ by: 'her', offerId, rejected: true });
    return;
  }
  delete row.pending;
  row.rejected = true;
  try {
    save(db);
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
  }
}

// ══ 对账 ══
// 他也可能在别的客户端里喝（比如直接跑 agent-cli），那边晨暮星收不到通知。
// 所以每次打开 /bar 时跟 Proof 对一次账：哪几杯已经喝了、哪几杯被拒了、哪几杯凉了。
// 对不上（Proof 连不上、字段不认识）就保持原样，不瞎改账本。
//
// 2026-10-13：原来只认 consumed 和 rejected，漏了 expired——
// 所以小满递的两杯已经凉了，页面还写着「还在吧台上放着」，骗了一整天。
const DRUNK = /consumed|drunk|drank/i;
const REJECTED = /reject|declin/i;
const EXPIRED = /expire|stale|timeout/i;

export async function reconcileOffers() {
  const db = load();
  const pending = db.pours.filter((p) => p.pending && p.offerId);
  if (!pending.length) return { checked: 0, drunk: 0, rejected: 0, expired: 0 };

  let out;
  try {
    out = await humanOffers();
  } catch (err) {
    console.error('proof: 对账失败（账本保持原样）', err.message);
    return { checked: pending.length, drunk: 0, rejected: 0, expired: 0, error: err.message };
  }
  if (!out || out.ok === false || !Array.isArray(out.offers)) {
    return { checked: pending.length, drunk: 0, rejected: 0, expired: 0, error: out?.error || 'no_offers' };
  }

  const byId = new Map(out.offers.map((o) => [String(o.id), o]));
  let drunk = 0;
  let rejected = 0;
  let expired = 0;
  for (const row of pending) {
    const remote = byId.get(String(row.offerId));
    if (!remote) continue; // Proof 还没结算或已经清掉了，别动
    const status = String(remote.status || '');
    if (DRUNK.test(status)) {
      const v = readProjection(remote);
      delete row.pending;
      row.drunkAt = formatDateTime();
      row.flavor = v.flavor;
      row.effect = v.effect;
      if (!row.intro && v.intro) row.intro = v.intro;
      if (!row.recipe && v.recipe) row.recipe = v.recipe;
      drunk++;
    } else if (REJECTED.test(status)) {
      delete row.pending;
      row.rejected = true;
      rejected++;
    } else if (EXPIRED.test(status)) {
      // 凉了。不是他拒的，也不是他喝了——是没来得及
      delete row.pending;
      row.expired = true;
      row.expiredAt = formatDateTime();
      expired++;
    }
  }
  if (drunk || rejected || expired) {
    try {
      save(db);
      console.log(`proof: 对账——${drunk} 杯已喝，${rejected} 杯被拒，${expired} 杯凉了`);
    } catch (err) {
      console.error('proof: 对账后写不下来', err.message);
    }
  }
  return { checked: pending.length, drunk, rejected, expired };
}

export function configSummary() {
  if (!isProofEnabled()) return '小酒馆：未配置（没填 PROOF_AGENT_TOKEN_FILE）';
  const db = load();
  const streak = selfStreakBefore();
  return `小酒馆：${PROOF_API_URL}，身份 ${PROOF_AGENT_ID}，自斟时段 ${nightWindowLabel()}，连 ${WARN_AFTER_NIGHTS + 1} 夜提醒、连 ${BLOCK_AFTER_NIGHTS + 1} 夜不倒；递的杯子 ${offerTtlLabel()}后凉；读吧台超时 ${(HOME_TIMEOUT_MS / 1000).toFixed(0)}s、缓存 ${(BAR_CACHE_MS / 1000).toFixed(0)}s；已记 ${db.pours.length} 杯，昨夜往前连着 ${streak} 夜自斟`;
}
