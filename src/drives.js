// 接 Drivesoid（情绪驱动系统，单独部署的旁路服务，默认 http://127.0.0.1:24601）。
//
// 这里做三件事：
//   1. 上报：gateway 每记一条聊天，就报给 Drivesoid（msg_user / msg_assistant）。
//      Drivesoid 用自己的分类模型给消息打情绪标签，再更新情绪状态。
//   2. 最明显的三项：phosphor 每次醒来取 TA 此刻最强的三项情绪交给 decide；
//      动态页标题下的「TA此刻」也显示这三项（见 getTopDrives）。
//   3. 心绪页：vesper 的 /drives 页面读完整状态（/api/drives/status）画出来，见 drives-page.js。
//
// DRIVES_URL 不填时上报和读取都不做，phosphor 和 gateway 的行为跟原来一样。
// Drivesoid 的上报接口只接受本机请求，所以它要和 vesper 装在同一台机器上。

const DRIVES_URL = (process.env.DRIVES_URL || '').trim().replace(/\/+$/, '');
const REPORT_TIMEOUT_MS = 3000;
const READ_TIMEOUT_MS = 3000;
// 读情绪前先让 Drivesoid 跑一轮 tick，把刚上报、还没处理的消息分类掉（它自己每 2.5 分钟才跑一次）。
// 分类要调一次模型，所以给宽一点；超时就直接读它现有的快照。
const REFRESH_TIMEOUT_MS = 15000;

// 和心绪页用同一套叫法
export const DRIVE_LABELS = {
  vitality: '活力',
  fatigue: '疲惫',
  longing: '思慕',
  intimacy: '亲密',
  possessiveness: '占有',
  lust: '渴求',
  jealousy: '妒意',
  anxiety: '焦虑',
  protectiveness: '护卫',
  fear: '恐惧',
  contentment: '满足',
  elation: '喜悦',
  seeking: '探求',
  play: '玩乐',
  dejection: '落寞',
  irritability: '烦躁',
};

export function isDrivesEnabled() {
  return Boolean(DRIVES_URL);
}

// ---------- 上报 ----------

async function postEvent(body) {
  try {
    const res = await fetch(`${DRIVES_URL}/internal/drives/event`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REPORT_TIMEOUT_MS),
    });
    if (!res.ok) console.error(`drives: 上报 ${body.type} 失败 HTTP ${res.status}`);
  } catch (err) {
    console.error(`drives: 上报 ${body.type} 失败（Drivesoid 在运行吗？）:`, err.message);
  }
}

// 不 await：上报失败或变慢都不能拖住聊天请求。postEvent 自己吞掉错误。
export function reportUserMessage(text, context = []) {
  if (!DRIVES_URL || !text) return;
  const payload = { text };
  if (context.length) payload.context = context;
  void postEvent({ type: 'msg_user', payload });
}

export function reportAssistantMessage() {
  if (!DRIVES_URL) return;
  void postEvent({ type: 'msg_assistant', payload: {} });
}

// ---------- 读取 ----------

async function refreshSnapshot() {
  try {
    await fetch(`${DRIVES_URL}/internal/drives/session-start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn('drives: 刷新情绪快照失败，读现有快照:', err.message);
  }
}

async function getJson(path) {
  const res = await fetch(`${DRIVES_URL}${path}`, { signal: AbortSignal.timeout(READ_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const toPct = (v) => (Number.isFinite(v) ? Math.round(Math.min(Math.max(v, 0), 1) * 100) : 0);

// 最强的 n 项（疲惫不算），数值 0–100。和心绪页「此刻最明显的」一致。
export function topDrives(display, n = 3) {
  return Object.keys(DRIVE_LABELS)
    .filter((k) => k !== 'fatigue')
    .map((k) => ({ key: k, label: DRIVE_LABELS[k], value: toPct(display?.[k]) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
}

// 返回 [{ key, label, value }, ...]；没接、连不上、快照过期都返回 null。
// refresh=true 时先让 Drivesoid 处理掉刚上报的消息（phosphor 醒来时用）；
// 动态页不刷新，只读现成快照，打开页面不会多调分类模型。
export async function getTopDrives({ refresh = false, n = 3 } = {}) {
  if (!DRIVES_URL) return null;
  if (refresh) await refreshSnapshot();
  try {
    const status = await getJson('/api/drives/status');
    if (!status?.display || status.stale) {
      console.warn('drives: 情绪快照还没有或已过期，这次不带情绪');
      return null;
    }
    return topDrives(status.display, n);
  } catch (err) {
    console.error('drives: 读情绪失败（Drivesoid 在运行吗？）:', err.message);
    return null;
  }
}

// ---------- 心绪页用的完整状态 ----------

// 返回 { status, config } 或 { error: 'disabled' | 'unreachable' | 'empty' }。
// 只读快照，不触发 tick：页面刷新得再勤也不会多调分类模型。
// config 只用来取各维度的基线（dimensions.neutral），读不到就用默认值，不影响页面。
export async function getDrivesStatus() {
  if (!DRIVES_URL) return { error: 'disabled' };
  let status;
  try {
    status = await getJson('/api/drives/status');
  } catch (err) {
    console.error('drives: 读情绪状态失败（Drivesoid 在运行吗？）:', err.message);
    return { error: 'unreachable' };
  }
  if (!status?.display) return { error: 'empty' };
  let config = null;
  try {
    config = await getJson('/api/dashboard/config');
  } catch {
    // 基线用默认值
  }
  return { status, config };
}
