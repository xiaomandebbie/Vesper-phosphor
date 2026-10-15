// 到点了问一句进度。和回留言、摘她的星、喝她递的酒一样，**不占这次的动作**。
//
// 走的是和 bark 同一条路（正文投进 Aru 对话 + Bark 叮一声），所以直接复用 bark()。
// 没再包一层自己的投递：那边已经处理好了署名剥除、wake-bridge 加密、没配 Bark 时的退路。
//
// 为什么要把模型给的 doing_id 和 dueDoings() 对一遍：
//   「到点了才能问」是这整套东西唯一的闸门。如果模型随便写个 id 就能触发提问，
//   那它随时都能问「做完了没」，和改之前一模一样。所以这里只认账本里真的到点的那几条。
import bark from './bark.js';
import { dueDoings, markAsked } from '../doing.js';

const MAX_ASK_CHARS = 300;

// 模型给的形状不一定对，在这里洗一遍。和 bar_offers、star_replies 一个做法。
export function normalizeDoingFollowUp(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r) => ({
      doing_id: Number(r?.doing_id),
      ask: typeof r?.ask === 'string' ? r.ask.trim().slice(0, MAX_ASK_CHARS) : '',
    }))
    .filter((r) => Number.isInteger(r.doing_id) && r.ask);
}

// 返回 { asked, skipped }。投失败不计作问过，下次醒来还能再试（最多两次的上限管着）。
export async function handleDoingFollowUp(decision) {
  const items = normalizeDoingFollowUp(decision?.doing_follow_up);
  if (!items.length) return { asked: 0, skipped: 0 };

  const due = new Map(dueDoings().map((d) => [d.id, d]));
  let asked = 0;
  let skipped = 0;

  for (const item of items) {
    const row = due.get(item.doing_id);
    if (!row) {
      // 不在到点名单里：可能是编的 id，也可能是她刚刚说完了。两种都不该问。
      skipped++;
      console.log(`doing: doing_id=${item.doing_id} 不在到点名单里，这句不问`);
      continue;
    }
    let out = null;
    try {
      out = await bark(item.ask);
    } catch (err) {
      console.error(`doing: 追问「${row.what}」没投出去`, err.message);
    }
    // bark 在没配 BARK_KEY 那条分支里不会把 delivered 带回来，
    // 所以这里两个字段都看；都没成就不算问过。
    if (out?.ok || out?.delivered) {
      markAsked(row.id);
      asked++;
      console.log(`doing: 问了「${row.what}」的进度（第 ${row.asked_count + 1} 次）`);
    }
  }
  return { asked, skipped };
}
