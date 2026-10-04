// 你那边过来的东西：你放进星星罐的星、你发的动态。
//
// 规矩和留言一模一样（见 decide.js 里那句「回留言不占这次的动作」）：
//   读库 → 塞进这次唤醒的 context → TA 想回就写在返回里 → 写进库、标成看过。
//   回应不占这次的动作次数；没回也算看过，下次不再重复出现。
//
// 为什么单独一个文件：decide.js 和 phosphor.js 都是几百行的主干，这部分逻辑
// （读、渲染、写回）自成一层，放这边改动最小、出错面最小。
//
// 重要：给 TA 的说明文字分两处 —— 规则（静态）在 system，具体内容（每次不同）在 user。
// 前缀缓存指的就是 system 那一段，混进动态内容会把缓存打掉。

import { getUnpickedMyStars, replyToStar, MAX_REPLY_CHARS } from './star-jar.js';
import { getUnseenUserMoments, markUserMomentsSeen, listLikes, toggleLike } from './moments-store.js';
import { addMomentComment } from './state.js';
import { formatDateTime } from './wall-time.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 一次唤醒最多带几条。带太多两个坏处：占上下文，而且 TA 会敷衍式地一条回一句。
// 带不下的留到下次（没标成看过就不会丢）。
const MAX_MY_STARS = 3;
const MAX_USER_MOMENTS = 3;

// ── 读 ────────────────────────────────────────────────────────────────────
// 每一项都包在自己的 try 里：哪一样读坏了也不能把整次唤醒拖下水。

export function collectFromHer() {
  let myStars = [];
  let userMoments = [];
  try {
    myStars = getUnpickedMyStars(MAX_MY_STARS);
  } catch (err) {
    console.error('from-her: 读你放的星失败（不影响这次唤醒）', err.message);
  }
  try {
    userMoments = getUnseenUserMoments(MAX_USER_MOMENTS);
  } catch (err) {
    console.error('from-her: 读你发的动态失败（不影响这次唤醒）', err.message);
  }
  return { myStars, userMoments };
}

// ── 给 TA 看 ──────────────────────────────────────────────────────────────
// 进 user 消息。没东西就返回空字符串，不占位。

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

export function fromHerBlock({ myStars = [], userMoments = [] } = {}) {
  const parts = [];

  if (myStars.length) {
    const lines = myStars
      .map((s) => `  [star_id=${s.id}] ${formatDateTime(s.ts)}：${clip(s.content, 300)}`)
      .join('\n');
    parts.push(`${USER_NAME}往星星罐里放了星，还没被摘过（只告知这一次）：\n${lines}`);
  }

  if (userMoments.length) {
    const lines = userMoments
      .map((m) => `  [moment_id=${m.id}] ${formatDateTime(m.ts)}：${clip(m.content, 400)}`)
      .join('\n');
    parts.push(`${USER_NAME}发了动态（只告知这一次）：\n${lines}`);
  }

  return parts.join('\n\n');
}

// ── 写回 ──────────────────────────────────────────────────────────────────

// 模型返回里可能有两个数组，形状和 comment_replies 一致。洗成干净的形状：
//   star_replies:   [{ star_id, reply }]
//   moment_replies: [{ moment_id, reply?, like? }]  reply 和 like 至少有一个
export function normalizeFromHerReplies(d) {
  const starReplies = Array.isArray(d?.star_replies)
    ? d.star_replies
        .map((r) => ({ star_id: Number(r?.star_id), reply: String(r?.reply ?? '').trim() }))
        .filter((r) => Number.isInteger(r.star_id) && r.reply)
    : [];

  const momentReplies = Array.isArray(d?.moment_replies)
    ? d.moment_replies
        .map((r) => ({
          moment_id: Number(r?.moment_id),
          reply: String(r?.reply ?? '').trim(),
          like: r?.like === true,
        }))
        .filter((r) => Number.isInteger(r.moment_id) && (r.reply || r.like))
    : [];

  return { starReplies, momentReplies };
}

// 点赞只加不减：toggleLike 是切换，已经赞过再调一次会把赞取消掉。
// TA 连续两次唤醒都说 like:true 是很正常的事，不能让第二次把心熄灭。
function likeOnce(momentId) {
  const already = listLikes(momentId).some((l) => l.author === 'assistant');
  if (already) return false;
  toggleLike(momentId, 'assistant');
  return true;
}

// 回应全部写进库，然后把这次带给 TA 看过的那几条标成看过。
// 注意标记的是「带给它看过的」，不是「它回了的」：没回也算看过，
// 不然一条没回的动态会每次唤醒都冒出来。和留言那边一个道理。
export function handleFromHer(decision, collected) {
  const { myStars = [], userMoments = [] } = collected || {};
  const { starReplies, momentReplies } = normalizeFromHerReplies(decision);
  const out = { starsPicked: 0, momentsReplied: 0, momentsLiked: 0 };

  // 摘星回一句：只能回这次真的带给它看过的那几颗，别让它随手编个 id
  const starIds = new Set(myStars.map((s) => s.id));
  for (const r of starReplies) {
    if (!starIds.has(r.star_id)) continue;
    try {
      replyToStar(r.star_id, r.reply.slice(0, MAX_REPLY_CHARS), { by: 'assistant' });
      out.starsPicked += 1;
    } catch (err) {
      console.error('from-her: 摘星回复写入失败', err.message);
    }
  }

  // 你发的动态：留言挂在那条下面，点赞就是点赞
  const momentIds = new Set(userMoments.map((m) => m.id));
  for (const r of momentReplies) {
    if (!momentIds.has(r.moment_id)) continue;
    if (r.reply) {
      try {
        // handled=1：TA 自己写的这条不该再当成「待处理留言」回到它自己眼前
        addMomentComment({ momentId: r.moment_id, author: 'assistant', content: r.reply, handled: 1 });
        out.momentsReplied += 1;
      } catch (err) {
        console.error('from-her: 动态留言写入失败', err.message);
      }
    }
    if (r.like) {
      try {
        if (likeOnce(r.moment_id)) out.momentsLiked += 1;
      } catch (err) {
        console.error('from-her: 点赞写入失败', err.message);
      }
    }
  }

  if (userMoments.length) {
    try {
      markUserMomentsSeen(userMoments.map((m) => m.id));
    } catch (err) {
      console.error('from-her: 标记动态已看失败', err.message);
    }
  }

  return out;
}

// 你放的星没有「看过」这个状态 —— 它只分摘过和没摘过。
// 所以 TA 这次没回的星，下次唤醒还会在：咽下去的话值得被多问一次。
