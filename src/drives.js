// 接 Drivesoid（情绪驱动系统，单独部署的旁路服务，默认 http://127.0.0.1:24601）。
//
// 这里做两件事：
//   1. 上报：gateway 每记一条聊天，就报给 Drivesoid（msg_user / msg_assistant）。
//      Drivesoid 用自己的分类模型给消息打情绪标签，再更新情绪状态。
//   2. 读取：phosphor 每次醒来先读当前情绪块（/api/drives/context），放进 decide 的 prompt。
//
// 以前还有第三件：醒来时调一次模型把最近对话提炼成一句话。为了省 token 去掉了，
// decide 本来就能看到最近的对话原文和最近选过的动作，够它参考。
//
// DRIVES_URL 不填时上报和读取都不做，phosphor 和 gateway 的行为跟原来一样。
// Drivesoid 的上报接口只接受本机请求，所以它要和 vesper 装在同一台机器上。

const DRIVES_URL = (process.env.DRIVES_URL || '').trim().replace(/\/+$/, '');
const REPORT_TIMEOUT_MS = 3000;
const READ_TIMEOUT_MS = 3000;
// 读情绪前先让 Drivesoid 跑一轮 tick，把刚上报、还没处理的消息分类掉（它自己每 2.5 分钟才跑一次）。
// 分类要调一次模型，所以给宽一点；超时就直接读它现有的快照。
const REFRESH_TIMEOUT_MS = 15000;

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

// ---------- 读取情绪 ----------

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

// 返回 Drivesoid 的 [drives] 文本块；没接、没开、快照过期都返回 null。
export async function getDrivesBlock() {
  if (!DRIVES_URL) return null;
  await refreshSnapshot();
  try {
    const res = await fetch(`${DRIVES_URL}/api/drives/context`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (!res.ok) {
      // 503 = 快照超过 5 分钟没更新（刚启动，或者 worker 卡住了）
      console.warn(`drives: 读情绪失败 HTTP ${res.status}，这次不带情绪`);
      return null;
    }
    const text = (await res.text()).trim();
    return text || null;
  } catch (err) {
    console.error('drives: 读情绪失败（Drivesoid 在运行吗？）:', err.message);
    return null;
  }
}
