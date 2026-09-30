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
  getRecentActions,
  getPendingComments,
  markCommentsHandled,
  addMomentComment,
  closeDb,
} from './state.js';
import decide from './decide.js';
import { executeAction } from './actions/index.js';
import { isImageEnabled, isVoiceEnabled } from './actions/moment.js';
import { listAllTools, connectAll, callTool, isConnected } from './mcp-manager.js';
import { isSharedTimelineEnabled, describeAction, postSharedEvent } from './timeline.js';
import { getSharedContext, countRecentChat } from './context.js';
import { getDrivesBlock, isDrivesEnabled } from './drives.js';
import { maybeCleanup, isCleanupEnabled, KEEP_HOURS, KEEP_MIN } from './cleanup.js';

const TICK_MS = 60 * 1000;
const MISSED_GRACE_MS = 3 * 60 * 1000;
const LOW_FREQ_MIN_GAP_MINUTES = 90;
const DEFAULT_WAKE_MINUTES = 60;
const MIN_WAKE_MINUTES = 5;
const MAX_COMMENTS_PER_WAKE = 5;
const MAX_REPLY_CHARS = 500;
// 做决定时带多少条最近对话。每条在 decide.js 里还会再截短。
// 条数越多越贵；.env 的 DECIDE_CONTEXT_LIMIT 可改，不填是 12。
const DECIDE_CONTEXT_LIMIT = (() => {
  const n = Number(process.env.DECIDE_CONTEXT_LIMIT);
  return Number.isInteger(n) && n > 0 ? n : 12;
})();
// 两次自然唤醒之间最长隔多久。模型给得再大也会被截到这个值。
// .env 里 PHOSPHOR_MAX_WAKE_MINUTES 可改，不填是 1440（一天）。
const MAX_WAKE_MINUTES = (() => {
  const n = Number(process.env.PHOSPHOR_MAX_WAKE_MINUTES);
  return Number.isFinite(n) && n >= MIN_WAKE_MINUTES ? Math.round(n) : 24 * 60;
})();

// 模型返回的 JSON 字段不一定齐全、类型也不一定对。
// 缺 next_wake_minutes 会让 next_wake_at 变成 NaN（存进库里是 NULL），之后每分钟都判定"该醒了"，
// 等于每分钟调一次 LLM；缺 mood 会让 updateWakeState 报 Missing named parameter。统一在这里兜住。
function normalizeDecision(raw, fallbackMood) {
  const d = raw && typeof raw === 'object' ? raw : {};

  let minutes = Number(d.next_wake_minutes);
  if (!Number.isFinite(minutes)) minutes = Math.min(DEFAULT_WAKE_MINUTES, MAX_WAKE_MINUTES);
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

  // 留言回复：只留 comment_id 是数字、reply 非空的
  const commentReplies = Array.isArray(d.comment_replies)
    ? d.comment_replies
        .map((r) => ({
          comment_id: Number(r?.comment_id),
          reply: typeof r?.reply === 'string' ? r.reply.trim().slice(0, MAX_REPLY_CHARS) : '',
        }))
        .filter((r) => Number.isInteger(r.comment_id) && r.reply)
    : [];

  return {
    ...d,
    next_wake_minutes: minutes,
    mood,
    action,
    action_detail: actionDetail,
    self_wake: selfWake,
    comment_replies: commentReplies,
  };
}

// 回动态下的留言。不占这次醒来的动作，和 executeAction 互不影响。
// 这次给模型看过的留言一律标记为已处理，没回的下次不再出现，免得每次醒来都被同一条催。
function handleCommentReplies(decision, shownComments) {
  if (!shownComments.length) return 0;
  const byId = new Map(shownComments.map((c) => [c.id, c]));
  let replied = 0;
  for (const r of decision?.comment_replies ?? []) {
    const c = byId.get(r.comment_id);
    if (!c) continue; // 模型编了一个不存在的 id
    try {
      addMomentComment({ momentId: c.moment_id, author: 'assistant', content: r.reply, replyTo: c.id, handled: 1 });
      replied++;
    } catch (err) {
      console.error('handleCommentReplies(): 写入回复失败', err.message);
    }
  }
  markCommentsHandled(shownComments.map((c) => c.id));
  if (replied) console.log(`phosphor: 回复了 ${replied} 条动态留言`);
  return replied;
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
// 只拉 feel（"我现在感觉怎么样"）的话，后台这一侧就只剩情绪，看不到主线发生过什么——
// 表现出来就是"失忆"：知道心里闷，但想不起为什么。breath 是 0 参数的纯读库调用，正好补这个缺口。
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
  // 最近对话：所有聊天窗口的记录 + 唤醒事件，换窗口不会丢（见 context.js）
  const density = countRecentChat(2 * 60 * 60 * 1000);
  const recentMessages = getSharedContext(DECIDE_CONTEXT_LIMIT);
  // 长期记忆和 Drivesoid 情绪互不依赖，一起取。任何一个取不到都是 null，不影响这一轮唤醒。
  const [{ breathSummary, feelSummary }, drivesBlock] = await Promise.all([getMemorySummary(), getDrivesBlock()]);
  const gapMinutes = wakeState.updated_at ? (Date.now() - wakeState.updated_at) / 60000 : 0;
  const pendingComments = getPendingComments(MAX_COMMENTS_PER_WAKE);

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
    drivesBlock,
    breathSummary,
    feelSummary,
    missedSummary,
    battery: latestDevice?.battery ?? null,
    location: latestDevice?.location ?? null,
    screenTime: latestDevice?.screen_time_min ?? null,
    availableTools: (await listAllTools()).map((t) => t.name),
    recentActions: getRecentActions(8),
    pendingComments,
    imageEnabled: isImageEnabled(),
    voiceEnabled: isVoiceEnabled(),
    heartbeatActive: isSharedTimelineEnabled(),
  };

  let decision = null;
  let result = null;
  let errorMessage = null;

  try {
    decision = normalizeDecision(await decide(context), wakeState.mood);
    console.log(`[${kind}] decision:`, decision);
  } catch (err) {
    errorMessage = err.message;
    console.error(`[${kind}] decide failed:`, err);
  }

  // 先回留言，再执行动作：动作失败也不影响回复
  let repliedCount = 0;
  if (decision) {
    try {
      repliedCount = handleCommentReplies(decision, pendingComments);
    } catch (err) {
      console.error(`[${kind}] handleCommentReplies failed:`, err);
    }
    try {
      result = await executeAction(decision);
      console.log(`[${kind}] action result:`, JSON.stringify(result));
    } catch (err) {
      errorMessage = err.message;
      console.error(`[${kind}] executeAction failed:`, err);
    }
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

  // 做了事就写回共享时间线，让另一边醒来时也知道
  if (!errorMessage) await postSharedEvent(describeAction(decision, result));
  if (repliedCount) {
    await postSharedEvent(`自动唤醒：本次未发送推送｜回复了动态下的 ${repliedCount} 条留言`);
  }

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
    // 对话记录每 24 小时清一次，没到时间就什么都不做（只读一次 meta，不花钱）
    try {
      await maybeCleanup();
    } catch (err) {
      console.error('cleanup error:', err);
    }
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
  const cleanupNote = isCleanupEnabled()
    ? `保留 ${KEEP_HOURS} 小时（至少 ${KEEP_MIN} 条），每 24 小时清理一次`
    : '不清理';
  console.log(
    `phosphor: 最长唤醒间隔 ${MAX_WAKE_MINUTES} 分钟；决策带最近对话 ${DECIDE_CONTEXT_LIMIT} 条；对话记录：${cleanupNote}；共享时间线：${isSharedTimelineEnabled() ? '已开启' : '未开启'}；动态配图：${isImageEnabled() ? '已开启' : '未配置'}；动态语音：${isVoiceEnabled() ? '已开启' : '未配置'}；情绪（Drivesoid）：${isDrivesEnabled() ? '已接入' : '未接入'}`
  );
  await connectAll();
  await tick();
  timer = setInterval(tick, TICK_MS);
}

main();
