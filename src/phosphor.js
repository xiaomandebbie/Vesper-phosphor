import 'dotenv/config';
import { getWakeState,
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
  pruneConversationLogIfDue,
  getForumNotes,
  addForumNotes,
  closeDb,
} from './state.js';
import { decideWithMessages, forumNextStep, musicNextStep, FORUM_MAX_STEPS, MUSIC_MAX_STEPS, askShare } from './decide.js';
import { executeAction } from './actions/index.js';
import { runActions, registerContinuers } from './run-actions.js';
import { budgetConfigSummary } from './budget.js';
import { xiuchaoConfigSummary } from './xiuchao.js';
import { booksConfigSummary } from './books.js';
import { maybeDream, recallDream, markRecalled, dreamConfigSummary } from './dreams.js';
import { describeActivity, describeActivityDetail } from './actions/activity.js';
import { workkkConfigSummary } from './workkk.js';
import { continueWorkkk } from './workkk-steps.js';
import { continueLeto } from './leto-steps.js';
import { addActivityMoment } from './moments-store.js';
// 网页聊天里攒着的话（见 chat-queue.js）。和动态留言同一套做法：
// 带进来、他自己定回不回、不占这次的动作。
// 唤醒时把攒着的话递给 relay（和她点按钮走同一条路）。
// 不自己回：那样你的话不进 relay 库，上下文就断了。
import { listPending, flushPending } from './chat-queue.js';
import { isImageEnabled, isVoiceEnabled } from './actions/moment.js';
import { listAllTools, connectAll, callTool, isConnected } from './mcp-manager.js';
import { isSharedTimelineEnabled, describeAction, postSharedEvent } from './timeline.js';
import { gardenConfigSummary } from './garden.js';
import { continueGarden } from './garden-steps.js';
import { continueXiuchao } from './xiuchao-steps.js';
import { getSharedContext, countRecentChat } from './context.js';
import { getTopDrives, isDrivesEnabled } from './drives.js';
import { getUnseenStarReplies, markStarRepliesSeen, hasStarToday, starWindowLabel } from './star-jar.js';
import { collectFromHer, handleFromHer } from './from-her.js';
import { handleBarOffers } from './actions/bar-offers.js';
import { configSummary as proofSummary } from './proof.js';
import { handleDoingFollowUp } from './actions/doing-follow-up.js';
import {
  doingSummary,
  sweepStale,
  pendingPriorWrites,
  markPriorsSynced,
  priorMemoText,
  cachePrior,
  parsePriorsFromMemory,
} from './doing.js';

const TICK_MS = 60 * 1000;
// 约好的时间晚了多久就不算了。
//
// 原来是 3 分钟，太短 —— 一次完整唤醒（breath、feel、模型、论坛续步、听歌续步）
// 跑五六分钟是常态，那几分钟里 tick 全被 ticking 锁跳过，等跑完这个约已经过期，
// 下一轮第一件事就把它标成 missed，于是「到点了什么都没发生」。
//
// 30 分钟足够盖住一次最长的唤醒。真正该判 missed 的是停机几小时那种 ——
// 那时候一口气补触发五个约没有意义，告诉他错过了就够。
// .env 的 WAKE_MISSED_GRACE_MINUTES 可改。
const MISSED_GRACE_MS = (() => {
  const n = Number(process.env.WAKE_MISSED_GRACE_MINUTES);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60 * 1000;
})();
const LOW_FREQ_MIN_GAP_MINUTES = 90;
const DEFAULT_WAKE_MINUTES = 60;
const MIN_WAKE_MINUTES = 5;
const MAX_COMMENTS_PER_WAKE = 5;
// 一次醒来最多带几条她在网页聊天里攒着的话。比留言宽：
// 聊天本来就是一句一条，五条很容易切成半句话。
const MAX_CHAT_PER_WAKE = 20;
const MAX_REPLY_CHARS = 500;
// 一次醒来最多带几条"新的阳光撒下"（她摘下星星后回的话）。带过的就算告知过，下次不再出现
const MAX_STAR_REPLIES_PER_WAKE = 3;
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
// conversation_log 多久整理一次、清掉多久以前的（小时）。.env 的 CONVERSATION_LOG_CLEAN_HOURS 可改，
// 不填是 24，填 0 不整理。注意 Number('') 是 0，所以空值要单独当作"没填"。
const CLEAN_HOURS = (() => {
  const raw = String(process.env.CONVERSATION_LOG_CLEAN_HOURS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : 24;
})();
// 整理时无论多旧都保留最新多少条。不填是 30（heartbeat-wake 默认也带 30 条），
// 最少不低于 DECIDE_CONTEXT_LIMIT，保证清完之后做决定还有"最近的对话"可看。
const CONVERSATION_LOG_KEEP = (() => {
  const n = Number(process.env.CONVERSATION_LOG_KEEP);
  const keep = Number.isInteger(n) && n >= 0 && String(process.env.CONVERSATION_LOG_KEEP).trim() ? n : 30;
  return Math.max(keep, DECIDE_CONTEXT_LIMIT);
})();
// 整理时先把要清的搬进 conversation_archive 再删（见 state.js），原话不会真的消失。
// .env 的 CONVERSATION_ARCHIVE=0 可以退回老做法：直接删，不留归档。
const CONVERSATION_ARCHIVE = !/^(0|off|false|no)$/i.test(
  String(process.env.CONVERSATION_ARCHIVE ?? '').trim()
);
// 归档保留多少天。不填是 180，填 0 = 永久保留。
const CONVERSATION_ARCHIVE_KEEP_DAYS = (() => {
  const raw = String(process.env.CONVERSATION_ARCHIVE_KEEP_DAYS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isFinite(n) && n >= 0 ? n : 180;
})();

// 论坛："看"的命令做完可以接着走；"写"的命令做完这次就结束
//
// 2026-11-02 小满：「唤醒用 lutopia 的时候要所有工具都能用」。
// 原来是白名单 FORUM_READ_OPS，只放七个抽屉（discover / wander / list / show /
// activity / search / comment-show），inbox、channel、chat、dm、confess、qian、
// bedtime、homepage、wiki、letter、stronghold、stardew 全都走不下去——
// 等于给了一柜子工具只开七格。现在反过来：只认「写完就收手」的那几个，
// 其余一律放行。步数上限 FORUM_MAX_STEPS 照旧兜着，不会真的走不完。
const FORUM_WRITE_OPS = new Set(['comment', 'post', 'dm']);
// chat 有子命令：chat send 是写，chat list / show 是看。
const isForumWriteOp = (command) => {
  const parts = String(command ?? '').trim().split(/\s+/);
  const op = (parts[0] || '').toLowerCase();
  if (op === 'chat') return (parts[1] || '').toLowerCase() === 'send';
  return FORUM_WRITE_OPS.has(op);
};
// 下次醒来带多少条"最近在论坛做过的"
const FORUM_NOTES_SHOWN = 6;
