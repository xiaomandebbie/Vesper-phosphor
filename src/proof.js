// 小酒馆：晨暮星这一侧接 Proof（https://github.com/lumingye/Proof）的那部分代码。
//
// ╔══ 最要紧的一件事：递的杯子要「领」，不是「喝 offerId」 ══
// Proof 的约定（见它 docs/ordinary-mode-persistence.md）：
//   「归属在饮用时确定，而不是递出时确定。只有经过 /agent/offers/claim 领取，
//   才会进入该 Agent 的持久状态。」
// 所以 POST /human/offers 创建的杯子并不在他的引擎里；targetId 只是记一笔「想给谁」。
// 拿 offerId 走 /agent/offers/:id/drink 会直接 404 —— 2026-10-13 整天那个 not_found 就是这个。
// 正确做法：存下创建时返回的 link，# 后面就是 capabilityToken，喝的时候用它 claim。
//
// Proof 自己负责配方、六轴、代谢、断片判定和账本；这里只做三件事：
//   1. 替你递一杯过去（/human/offers），替他领走（/agent/offers/claim）
//   2. 把他每次喝酒记进我们自己的时间轴，给 /bar 页面看
//   3. 数「连续几夜自斟」，到第三夜提醒、第四夜不给这个动作
//
// 身份：一个 token 就是一个 Agent。PROOF_AGENT_ID 默认 vesper。
//
// 三种杯子（账本里的 by 字段）：
//   self —— 深夜醒来自己倒的。只有这种算进连续夜数。
//   her  —— 你在 /bar 递过去的。
//   chat —— 聊天里通过 MCP 自己点的。
import fs from 'fs';
import path from 'path';
import { wallParts, formatDate, formatDateTime } from './wall-time.js';

const env = (k) => String(process.env[k] ?? '').trim();
// Number('') 是 0 不是 NaN，所以先看原值空不空。
// 不然 .env 没写时超时被算成 0，AbortSignal.timeout(0) 当场把请求掉掉。
const num = (k, dflt) => {
  const raw = env(k);
  if (!raw) return dflt;
  const v = Number(raw);
  return Number.isFinite(v) ? v : dflt;
};

export const PROOF_API_URL = env('PROOF_API_URL') || 'http://127.0.0.1:8791';
export const PROOF_AGENT_ID = env('PROOF_AGENT_ID') || 'vesper';
const TOKEN_FILE = env('PROOF_AGENT_TOKEN_FILE');
const ADMIN_TOKEN = env('PROOF_ADMIN_TOKEN');

// 超时分两档：/agent/home 要把整份酒单过一遍引擎，比其他请求重很多
const TIMEOUT_MS = num('PROOF_TIMEOUT_MS', 20000);
const HOME_TIMEOUT_MS = num('PROOF_HOME_TIMEOUT_MS', 90000);
const SLOW_MS = num('PROOF_SLOW_LOG_MS', 3000);

// 递过去的杯子多久会凉。只用来说人话和本地兜底，
// **真正判定在 Proof 那边**（它的 PROOF_PUBLIC_LINK_TTL_MS）。两边要对着填。
const OFFER_TTL_MS = num('PROOF_OFFER_TTL_MS', 30 * 60 * 1000);

// 自斟的时段（按 TIME_ZONE 的墙上时间）。跨午夜，所以 22.5 到次日 2。
const NIGHT_WINDOW = (() => {
  const raw = env('PROOF_NIGHT_WINDOW') || '22:30-2:00';
  const m = /^(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return { from: 22.5, to: 2 };
  const h = (a, b) => Number(a) + Number(b || 0) / 60;
  return { from: h(m[1], m[2]), to: h(m[3], m[4]) };
})();

const WARN_AFTER_NIGHTS = num('PROOF_WARN_AFTER_NIGHTS', 2);
const BLOCK_AFTER_NIGHTS = num('PROOF_BLOCK_AFTER_NIGHTS', 3);

export function isProofEnabled() {
  return Boolean(TOKEN_FILE);
}

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

export function listPours() {
  return load().pours.slice().sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

// 这一条递出去多久了（毫秒）。拿不准就返回 null，别瞎猜。
function offerAgeMs(row, now = Date.now()) {
  const sent = Number(row?.sentAt);
  if (Number.isFinite(sent) && sent > 0) return now - sent;
  const raw = String(row?.at || '').trim();
  if (!raw) return null;
  const t = Date.parse(raw.includes('T') ? raw : raw.replace(' ', 'T'));
  return Number.isFinite(t) ? now - t : null;
}

// 还在吧台上、没过期的那几杯。返回带 token，执行端要用它去 claim。
// 按本地时间滤一遍过期：不然他醒来看到一杯已经凉了的酒，试着喝还会失败。
export function localPendingOffers({ includeStale = false } = {}) {
  const now = Date.now();
  return load()
    .pours.filter((p) => {
      if (!p.pending || !p.offerId) return false;
      if (includeStale) return true;
      const age = offerAgeMs(p, now);
      if (age == null) return false;
      return age < OFFER_TTL_MS;
    })
    .map((p) => ({
      offerId: p.offerId,
      token: p.token || '',
      name: p.name || '无名的一杯',
      intro: p.intro || '',
    }));
}

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

// 这一夜他能不能自己倒酒。只管深夜醒来那杯；你递的、聊天里陪你喝的都不走这条路。
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

async function request(pathname, { method = 'GET', body, auth = 'agent', timeoutMs = TIMEOUT_MS, headers: extra } = {}) {
  const headers = { ...(extra || {}) };
  if (auth === 'agent') {
    if (!TOKEN_FILE) return { ok: false, error: 'proof_not_configured' };
    try {
      headers.authorization = `Bearer ${fs.readFileSync(TOKEN_FILE, 'utf8').trim()}`;
    } catch (err) {
      return { ok: false, error: 'token_unreadable', detail: err.message };
    }
  } else if (auth === 'capability') {
    // 公开 capability token（递酒时返回的 link 里 # 后面那段）
    if (!extra?.authorization) return { ok: false, error: 'capability_required' };
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
    console.error(`proof: ${method} ${pathname} 失败（等了 ${(ms / 1000).toFixed(1)}s，上限 ${(timeoutMs / 1000).toFixed(0)}s）：${err.message}`);
    return { ok: false, error: 'proof_unavailable', detail: err.message, elapsedMs: ms };
  }
  const ms = Date.now() - started;
  if (ms >= SLOW_MS) console.warn(`proof: ${method} ${pathname} 用了 ${(ms / 1000).toFixed(1)}s（慢）`);

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) return { ok: false, status: res.status, ...(data || { error: 'proof_request_failed' }) };
  return data ?? { ok: true };
}

export const agentHome = ({ timeoutMs = HOME_TIMEOUT_MS } = {}) =>
  request('/agent/home', { timeoutMs });

export const turnContext = () => request('/agent/turn-context');

export const drinkMenu = async (drinkId) => {
  const out = await request(`/agent/menu/${encodeURIComponent(drinkId)}/drink`, { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};

// 领走你递的那杯。**这才是正确入口**：带 capabilityToken，不是 offerId。
// 领成功就进他的持久引擎，效果跟着走。
export const claimOffer = async (capabilityToken, beliefs) => {
  const body = { capabilityToken };
  if (Array.isArray(beliefs) && beliefs.length) body.beliefs = beliefs;
  const out = await request('/agent/offers/claim', { method: 'POST', body });
  invalidateBarCache();
  return out;
};

// 不喝，放回去。走公开 capability 通道：拒绝不写任何 Agent 账本。
export const rejectCapability = async (capabilityToken) => {
  const out = await request('/capability/offer', {
    method: 'POST',
    body: { action: 'reject' },
    auth: 'capability',
    headers: { authorization: `Bearer ${capabilityToken}` },
  });
  invalidateBarCache();
  return out;
};

export const reset = async () => {
  const out = await request('/agent/reset', { method: 'POST', body: {} });
  invalidateBarCache();
  return out;
};

export const humanOffers = () => request('/human/offers', { auth: 'human' });

// 你在页面上调一杯递给他。
// 返回里的 link 形如 https://…/proof/drink/#<token>，# 后面那段就是 capabilityToken——
// 必须存下来，不然他永远领不走这杯。
export async function offerDrink({ name, parts, intro }) {
  const payload = { targetId: PROOF_AGENT_ID, name: String(name || '').trim() || '无名的一杯', parts };
  if (intro) payload.intro = String(intro).slice(0, 200);
  const out = await request('/human/offers', { method: 'POST', body: payload, auth: 'human' });
  invalidateBarCache();
  return out;
}

// 从 link 里取 capability token。也接裸 token。
export function tokenFromLink(link) {
  const raw = String(link || '').trim();
  if (!raw) return '';
  const hash = raw.indexOf('#');
  const t = hash >= 0 ? raw.slice(hash + 1) : raw;
  return /^[A-Za-z0-9_-]{16,}$/.test(t) ? t : '';
}

// ══ 吧台缓存 ══
const BAR_CACHE_MS = num('PROOF_BAR_CACHE_MS', 45000);
let barCache = null;

export function invalidateBarCache() {
  barCache = null;
}

export async function barSnapshot({ timeoutMs } = {}) {
  if (barCache && Date.now() - barCache.at < BAR_CACHE_MS) {
    return { home: barCache.home, cached: true };
  }
  const home = await agentHome(timeoutMs ? { timeoutMs } : undefined);
  if (home && home.ok !== false) barCache = { at: Date.now(), home };
  return { home, cached: false };
}

// ══ 记账 ══

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

// 从 Proof 的返回里挑出给人看的那几样。
// claim 的返回层级可能是 projection / result.projection / portableResult，挨个兜。
function readProjection(result) {
  const p =
    result?.projection ||
    result?.result?.projection ||
    result?.view?.projection ||
    result?.portableResult?.projection ||
    {};
  const flavor = [p.flavorDescription, p.finish].filter(Boolean).join(' · ');
  const effect =
    p.actualEffectDescription?.text ||
    result?.actualEffectDescription?.text ||
    result?.result?.actualEffectDescription?.text ||
    '';
  const v = {
    name: p.claimedName || result?.name || '无名的一杯',
    flavor: flavor || '',
    intro: p.intro || '',
    effect,
  };
  const recipe = normalizeRecipe(p.recipe ?? result?.recipe);
  if (recipe) v.recipe = recipe;
  return v;
}

export function recordSelfPour(drinkId, result, mood) {
  const v = readProjection(result);
  record({ by: 'self', drinkId, mood: mood || '', ...v });
  return v;
}

export function recordChatPour(drinkId, result) {
  const v = readProjection(result);
  record({ by: 'chat', drinkId, ...v });
  return v;
}

// 你刚递出去，还没喝。token 必须存——他要用它 claim。
export function recordOfferSent(offerId, name, intro, parts, token) {
  const recipe = normalizeRecipe(parts);
  record({
    by: 'her',
    offerId,
    token: token || '',
    sentAt: Date.now(),
    name: name || '无名的一杯',
    intro: intro || '',
    ...(recipe ? { recipe } : {}),
    pending: true,
  });
}

// 他领走并喝了你递的那杯
export function markOfferDrunk(offerId, result) {
  const db = load();
  const row = db.pours.find((x) => x.offerId === offerId && x.pending);
  const v = readProjection(result);
  if (!row) {
    record({ by: 'her', offerId, ...v });
    return v;
  }
  delete row.pending;
  delete row.token; // 一次性的，用过就不必留
  row.drunkAt = formatDateTime();
  row.flavor = v.flavor;
  row.effect = v.effect;
  if (!row.intro && v.intro) row.intro = v.intro;
  if (!row.recipe && v.recipe) row.recipe = v.recipe;
  try {
    save(db);
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
  }
  return v;
}

export function markOfferRejected(offerId) {
  const db = load();
  const row = db.pours.find((x) => x.offerId === offerId && x.pending);
  if (!row) {
    record({ by: 'her', offerId, rejected: true });
    return;
  }
  delete row.pending;
  delete row.token;
  row.rejected = true;
  try {
    save(db);
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
  }
}

// 这杯已经不在了（领的时候 Proof 说没有/过期/被别人喝了）。划掉，不让下次再撞。
export function markOfferGone(offerId, why) {
  const db = load();
  const row = db.pours.find((x) => x.offerId === offerId && x.pending);
  if (!row) return false;
  delete row.pending;
  delete row.token;
  row.expired = true;
  row.expiredAt = formatDateTime();
  if (why) row.goneReason = String(why).slice(0, 200);
  try {
    save(db);
    return true;
  } catch (err) {
    console.error('proof: 账本写不下来', err.message);
    return false;
  }
}

// ══ 对账 ══
// 每次打开 /bar 时跟 Proof 对一次。**Proof 说什么就是什么**；
// 本地 TTL 只在完全连不上 Proof 时兜底。
const DRUNK = /consumed|drunk|drank|claimed/i;
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
    out = null;
  }

  const offers = out && out.ok !== false && Array.isArray(out.offers) ? out.offers : null;
  const byId = offers ? new Map(offers.map((o) => [String(o.id), o])) : null;

  let drunk = 0;
  let rejected = 0;
  let expired = 0;
  const now = Date.now();

  for (const row of pending) {
    const remote = byId?.get(String(row.offerId));

    if (remote) {
      const status = String(remote.status || '');
      if (DRUNK.test(status)) {
        const v = readProjection(remote);
        delete row.pending;
        delete row.token;
        row.drunkAt = formatDateTime();
        row.flavor = v.flavor;
        row.effect = v.effect;
        if (!row.intro && v.intro) row.intro = v.intro;
        if (!row.recipe && v.recipe) row.recipe = v.recipe;
        drunk++;
      } else if (REJECTED.test(status)) {
        delete row.pending;
        delete row.token;
        row.rejected = true;
        rejected++;
      } else if (EXPIRED.test(status)) {
        delete row.pending;
        delete row.token;
        row.expired = true;
        row.expiredAt = formatDateTime();
        expired++;
      }
      // 还是 pending：别动。本地觉得凉了也不算——Proof 才是权威
      continue;
    }

    // 读到了列表但里面没这杯 → 已经被清掉了
    if (offers) {
      delete row.pending;
      delete row.token;
      row.expired = true;
      row.expiredAt = formatDateTime();
      expired++;
      continue;
    }

    // 根本连不上 Proof → 本地超时才兜底
    const age = offerAgeMs(row, now);
    if (age != null && age >= OFFER_TTL_MS) {
      delete row.pending;
      delete row.token;
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
  return { checked: pending.length, drunk, rejected, expired, offline: !offers };
}

export function configSummary() {
  if (!isProofEnabled()) return '小酒馆：未配置（没填 PROOF_AGENT_TOKEN_FILE）';
  const db = load();
  const streak = selfStreakBefore();
  return `小酒馆：${PROOF_API_URL}，身份 ${PROOF_AGENT_ID}，自斟时段 ${nightWindowLabel()}，连 ${WARN_AFTER_NIGHTS + 1} 夜提醒、连 ${BLOCK_AFTER_NIGHTS + 1} 夜不倒；递的杯子 ${offerTtlLabel()}后凉，领取走 /agent/offers/claim；已记 ${db.pours.length} 杯，昨夜往前连着 ${streak} 夜自斟`;
}
