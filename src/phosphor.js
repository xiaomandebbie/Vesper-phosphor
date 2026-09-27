import 'dotenv/config';
import {
  getWakeState,
  updateWakeState,
  addPendingWake,
  getDuePendingWakes,
  getOverduePendingWakes,
  setPendingWakeStatus,
  getUnacknowledgedMissed,
  acknowledgeMissed,
  logWake,
  getLatestDeviceReport,
  getRecentConversation,
  countRecentConversation,
} from './state.js';
import decide from './decide.js';
import { executeAction } from './actions/index.js';
import { listAllTools, connectAll, callTool, isConnected } from './mcp-manager.js';

const TICK_MS = 60 * 1000;
const MISSED_GRACE_MS = 3 * 60 * 1000;
const LOW_FREQ_MIN_GAP_MINUTES = 90;

// 对话密度：最近2小时的消息数，作为一个简单但真实的信号。
// 消息数据来自 conversation_log 表，由外部聊天前端（比如 aru）主动上报进来
// （见 vesper.js 的 POST /wake/conversation）——这个项目本身接触不到真实对话，
// 没有上报就一直是0，不是坏了。
async function computeConversationDensity() {
  return countRecentConversation(2 * 60 * 60 * 1000);
}

async function getFeelSummary() {
  if (!isConnected('ombre-brain')) return null;
  try {
    const res = await callTool('ombre-brain', 'feel', { query: '我现在感觉怎么样，最近在想什么' });
    const textBlock = res?.content?.find?.((c) => c.type === 'text');
    return textBlock?.text ?? null;
  } catch (err) {
    console.error('getFeelSummary() failed:', err.message);
    return null;
  }
}

async function runDecisionCycle({ kind, scheduledAt = null, selfNote = null }) {
  const wakeState = getWakeState();
  const latestDevice = getLatestDeviceReport();
  const feelSummary = await getFeelSummary();
  const density = await computeConversationDensity();
  const recentMessages = getRecentConversation(15);
  const gapMinutes = wakeState.updated_at ? (Date.now() - wakeState.updated_at) / 60000 : 0;

  const missed = getUnacknowledgedMissed();
  const missedSummary = missed.length
    ? missed
        .map((m) => `原定${new Date(m.wake_at).toLocaleString()}，note:${m.note ?? '(无)'}`)
        .join('；')
    : null;

  const context = {
    now: new Date().toISOString(),
    mode: wakeState.mode,
    kind,
    scheduledAt,
    selfNote,
    gapMinutes,
    density,
    recentMessages,
    feelSummary,
    missedSummary,
    battery: latestDevice?.battery ?? null,
    location: latestDevice?.location ?? null,
    screenTime: latestDevice?.screen_time_min ?? null,
    availableTools: (await listAllTools()).map((t) => t.name),
  };

  let decision = null;
  let result = null;
  let errorMessage = null;

  try {
    decision = await decide(context);
    console.log(`[${kind}] decision:`, decision);
    result = await executeAction(decision);
    console.log(`[${kind}] action result:`, JSON.stringify(result));
  } catch (err) {
    errorMessage = err.message;
    console.error(`[${kind}] runDecisionCycle failed:`, err);
  }

  logWake({
    kind,
    scheduledAt,
    mode: wakeState.mode,
    gapMinutes,
    decision,
    result,
    error: errorMessage,
  });

  if (missed.length) acknowledgeMissed(missed.map((m) => m.id));

  if (decision) {
    updateWakeState({ mood: decision.mood });
    if (decision.self_wake && decision.self_wake.after_minutes) {
      const wakeAt = Date.now() + decision.self_wake.after_minutes * 60000;
      addPendingWake(wakeAt, decision.self_wake.note ?? null);
    }
  }

  return decision;
}

async function nonPreciseTick() {
  const wakeState = getWakeState();
  if (wakeState.mode === 'silent') return;
  if (Date.now() < wakeState.next_wake_at) return;

  const decision = await runDecisionCycle({ kind: 'non_precise' });
  if (!decision) {
    // 决策本身出错了：别卡死在原地反复重试，稍后再看一次
    updateWakeState({ next_wake_at: Date.now() + 10 * 60000 });
    return;
  }

  const currentMode = getWakeState().mode;
  const nextMinutes =
    currentMode === 'low-frequency'
      ? Math.max(decision.next_wake_minutes, LOW_FREQ_MIN_GAP_MINUTES)
      : decision.next_wake_minutes;

  updateWakeState({
    next_wake_at: Date.now() + nextMinutes * 60000,
  });
}

async function preciseTick() {
  const overdue = getOverduePendingWakes(Date.now(), MISSED_GRACE_MS);
  for (const w of overdue) {
    setPendingWakeStatus(w.id, 'missed');
  }

  const due = getDuePendingWakes();
  for (const w of due) {
    setPendingWakeStatus(w.id, 'triggered');
    await runDecisionCycle({ kind: 'precise', scheduledAt: w.wake_at, selfNote: w.note });
  }
}

async function tick() {
  try {
    await nonPreciseTick();
  } catch (err) {
    console.error('nonPreciseTick error:', err);
  }
  try {
    await preciseTick();
  } catch (err) {
    console.error('preciseTick error:', err);
  }
}

async function main() {
  await connectAll();
  await tick();
  setInterval(tick, TICK_MS);
}

main();
