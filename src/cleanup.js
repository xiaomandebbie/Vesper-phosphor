// 对话记录定期清理，清完回忆一下。
//
// conversation_log 每条聊天都会追加一行，不清理会一直涨。
// 做决定只用最近 12 条、heartbeat 共享上下文最多 30 条、Drivesoid 前文 10 条，太旧的本来就用不上。
// 所以每 24 小时清一次，只保留最近 CONVERSATION_KEEP_HOURS 小时的；
// 不管多旧，最新的 CONVERSATION_KEEP_MIN 条总是留着，聊得少的时候也不会清空。
//
// 清完调一次 Ombre Brain 的 breath（纯读库，不调模型），在动态页记一张黄卡，
// 点开能看到清了多少条、想起了什么。
// 由 phosphor 的 tick 调用，和醒来做决定共用同一把"不并发"的锁。

import { getMeta, setMeta, pruneConversationLog } from './state.js';
import { addActivityMoment } from './moments-store.js';
import { callTool } from './mcp-manager.js';

const HOUR_MS = 3600 * 1000;
const INTERVAL_MS = 24 * HOUR_MS;
const META_KEY = 'conversation_pruned_at';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const MAX_DETAIL_CHARS = 3000;

function envNumber(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

// 保留最近多少小时的对话。填 0 = 不清理
export const KEEP_HOURS = envNumber('CONVERSATION_KEEP_HOURS', 24);
// 不管多旧都留着的最新条数
export const KEEP_MIN = Math.floor(envNumber('CONVERSATION_KEEP_MIN', 30));

export function isCleanupEnabled() {
  return KEEP_HOURS > 0;
}

function clip(s) {
  return s.length > MAX_DETAIL_CHARS ? `${s.slice(0, MAX_DETAIL_CHARS)}\n…（后面还有，太长没记下来）` : s;
}

// 调一次 breath，取文字部分。没连 Ombre Brain、调用出错都返回 null，不影响清理本身
async function recallBreath() {
  try {
    const res = await callTool('ombre-brain', 'breath', {});
    if (res?.isError) return null;
    const text = (res?.content ?? [])
      .filter((c) => c?.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n')
      .trim();
    return text || null;
  } catch (err) {
    console.warn('cleanup: 回忆（breath）没成功:', err.message);
    return null;
  }
}

// 到时间了就清一次。没到时间、没开清理都直接返回 null
export async function maybeCleanup(now = Date.now()) {
  if (!isCleanupEnabled()) return null;
  const last = Number(getMeta(META_KEY)) || 0;
  if (now - last < INTERVAL_MS) return null;
  // 先记下时间：就算下面出错，也等 24 小时后再试，不会每分钟重试一遍
  setMeta(META_KEY, now);

  let removed;
  try {
    removed = pruneConversationLog(now - KEEP_HOURS * HOUR_MS, KEEP_MIN);
  } catch (err) {
    console.error('cleanup: 清理对话记录失败:', err.message);
    return null;
  }
  const summary = `清掉了 ${removed} 条 ${KEEP_HOURS} 小时以前的对话记录（最新 ${KEEP_MIN} 条始终保留）`;
  console.log(`cleanup: ${summary}`);

  const recall = await recallBreath();
  if (recall) console.log('cleanup: 清理完回忆了一下（breath）');

  if (removed > 0 || recall) {
    const text = recall
      ? `${AI_NAME}刚刚清理了一下旧的聊天记录，又翻了翻记忆`
      : `${AI_NAME}刚刚清理了一下旧的聊天记录`;
    const parts = [summary];
    if (recall) parts.push(`想起了这些：\n${recall}`);
    try {
      addActivityMoment(text, clip(parts.join('\n\n')));
    } catch (err) {
      console.error('cleanup: 记录黄卡失败:', err.message);
    }
  }
  return { removed, recalled: Boolean(recall) };
}
