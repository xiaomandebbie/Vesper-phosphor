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
  closeDb,
} from './state.js';
import decide from './decide.js';
import { executeAction } from './actions/index.js';
import { listAllTools, connectAll, callTool, isConnected } from './mcp-manager.js';

const TICK_MS = 60 * 1000;
const MISSED_GRACE_MS = 3 * 60 * 1000;
const LOW_FREQ_MIN_GAP_MINUTES = 90;
const DEFAULT_WAKE_MINUTES = 60;
const MIN_WAKE_MINUTES = 5;
const MAX_WAKE_MINUTES = 24 * 60;

// 模型返回的 JSON 字段不一定齐全、类型也不一定对。
// 缺 next_wake_minutes 会让 next_wake_at 变成 NaN（存进库里是 NULL），之后每分钟都判定"该醒了"，
// 等于每分钟调一次 LLM；缺 mood 会让 updateWakeState 报 Missing named parameter。统一在这里兜住。
function normalizeDecision(raw, fallbackMood) {
  const d = raw && typeof raw === 'object' ? raw : {};

  let minutes = Number(d.next_wake_minutes);
  if (!Number.isFinite(minutes)) minutes = DEFAULT_WAKE_MINUTES;
  minutes = Math.min(Math.max(Math.round(minutes), MIN_WAKE_MINUTES), MAX_WAKE_MINUTES);

  const mood =
    typeof d.mood === 'string' && d.mood.trim() ? d.mood.trim() : (fallbackMood ?? '平静');
  const action = typeof d.action === 'string' && d.action.trim() ? d.action.trim() : 'noop';

  // action_detail 约定是字符串；模型有时直接给对象，转回 JSON 字符串，下游各 action 照常解析
  let actionDetail = d.action_detail ?? '';
  if (typeof actionDetail !== 'string') actionDetail = JSON.stringify(actionDetail);

  let selfWake = null;
  if (d.self_wake && typeof d.self_wake === 'object') {
    const after = Number(d.self_wake.after_minutes);
    if (Number.isFinite(after) && after > 0) {
      selfWake = {
        after_minutes: after,
        note: typeof d.self_wake.note === 'string' ? d.self_wake.note : null,
      };
    }
  }

  return {
    ...d,
    next_wake_minutes: minutes,
    mood,
    action,
    action_detail: actionDetail,
    self_wake: selfWake,
  };
}

// 对话密度：最近2小时的消息数，作为一个简单但真实的信号。
// 消息数据来自 conversation_log 表，由外部聊天前端（比如 aru）主动上报进来
// （见 vesper.js 的 POST /wake/conversation）——这个项目本身接触不到真实对话，
// 没有上报就一直是0，不是坏了。
async function computeConversationDensity() {
  return countRecentConversation(2 * 60 * 60 * 1000);
}

// 从 Ombre Brain 取一段文本。取不到就返回 null，不影响这一轮唤醒。
async function callOmbre(toolName, args) {
  try {
    const res = await callTool('ombre-brain', toolName, args);
    const textBlock = res?.content?.find?.((c) => c.type === 'text');
    return textBlock?.text ?? null;
  } catch (err) {
    console.error(`callOmbre(${toolName}) failed:`, err.message);
    return null;
  }
}

// 醒来先想起自己是谁。
// 原来只拉 feel（"我现在感觉怎么样"），后台这一侧就只剩情绪，看不到主线发生过什么——
// 表现出来就是"失忆"：知道心里闷，但想不起为什么。breath 是 0 参数、0 次 LLM 调用，
// 纯读库，最省 token 的那条路，正好用来补这个缺口。
async function getMemorySummary() {
  if (!isConnected('ombre-brain')) return { breathSummary: null, feelSummary: null };
  const [breathSummary, feelSummary] = await Promise.all([
    callOmbre('breath', {}),
    callOmbre('feel', { query: '我现在感觉怎么样，最近在想什么' }),
  ]);
  return { breathSummary, feelSummary };
}

async function runDecisionCycle({ kind, scheduledAt = null, selfNote = null }) {
  const wakeState = getWakeState();
  const latestDevice = getLatestDeviceReport();
  const { breathSummary, feelSummary } = await getMemorySummary();
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
    breathSummary,
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
    decision = normalizeDecision(await decide(context), wakeState.mood);
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
    if (decision.self_wake) {
      const wakeAt = Date.now() + decision.self_wake.after_minutes * 60000;
      addPendingWake(wakeAt, decision.self_wake.note);
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

// decide() 加上重试可能跑超过一分钟；上一轮没跑完就跳过这一轮，
// 不然 next_wake_at 还没更新，同一次唤醒会被并发触发两遍。
let ticking = false;
async function tick() {
  if (ticking) return;
  ticking = true;
  try {
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
  } finally {
    ticking = false;
  }
}

// pm2 stop / restart 会发 SIGINT。主动关库再退出，
// 不让 better-sqlite3 的 Statement 拖到 Node 拆环境时才析构（日志里那个 (env) != nullptr 断言）。
let timer = null;
function shutdown(signal) {
  console.log(`phosphor: received ${signal}, shutting down`);
  if (timer) clearInterval(timer);
  try {
    closeDb();
  } catch (err) {
    console.error('closeDb() failed:', err.message);
  }
  process.exit(0);
}

async function main() {
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  await connectAll();
  await tick();
  timer = setInterval(tick, TICK_MS);
}

main();
