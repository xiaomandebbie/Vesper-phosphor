// 他醒来时对「她递到吧台上那几杯」的回应。
//
// 不占这次唤醒的动作，和回留言、摘她的星一个规矩（小满 2026-10-13 定）。
// 所以单独一个文件，不走 executeAction。
//
// 两道门：
//   1. offer_id 必须是此刻真在吧台上的——**以 Proof 为准**，不是我们的账本。
//      2026-10-13 就是这个坑：账本说还在，Proof 说没了，他伸手拿空还写了篇动态。
//   2. 一次醒来最多处理几杯，免得一口气把积着的全喝了。
//
// 拿空了就把账本里那条划掉（forgetOffer），让它自己愈合，不再反复撞。
import { drinkOffer, rejectOffer, markOfferDrunk, markOfferRejected } from '../proof.js';
import { pendingForWake, isGone, forgetOffer } from '../proof-offers.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 一次醒来最多动几杯。积了很多杯的时候，也该一杯一杯来
const MAX_PER_WAKE = Number(process.env.PROOF_OFFERS_PER_WAKE) || 2;

// 模型返回的 bar_offers 洗成 [{ offerId, action }]。
// 字段名宽容一点：offer_id / offerId / id 都认；drink|喝 和 reject|拒 都认。
export function normalizeBarOffers(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const it of raw) {
    if (!it || typeof it !== 'object') continue;
    const offerId = String(it.offer_id ?? it.offerId ?? it.id ?? '').trim();
    if (!offerId) continue;
    const a = String(it.action ?? it.do ?? '').trim().toLowerCase();
    const action = /^(reject|decline|no)$/.test(a) || a.includes('拒') || a.includes('不喝')
      ? 'reject'
      : 'drink';
    out.push({ offerId, action });
  }
  return out;
}

// 真的去喝 / 退掉。返回 { drunk, rejected, skipped } 给日志用。
// 任何一杯出错不影响其他杯，也不影响这次唤醒剩下的事。
export async function handleBarOffers(decision) {
  const asked = normalizeBarOffers(decision?.bar_offers);
  if (!asked.length) return { drunk: 0, rejected: 0, skipped: 0 };

  // 此刻真在吧台上的那几杯。能问到 Proof 就以它为准
  let pending;
  let source = 'local';
  try {
    const got = await pendingForWake();
    pending = new Map(got.offers.map((o) => [String(o.offerId), o]));
    source = got.source;
  } catch (err) {
    console.error('bar-offers: 读不到吧台上的杯子，这次不动', err.message);
    return { drunk: 0, rejected: 0, skipped: asked.length };
  }

  let drunk = 0;
  let rejected = 0;
  let skipped = 0;

  for (const { offerId, action } of asked) {
    if (drunk + rejected >= MAX_PER_WAKE) {
      skipped++;
      continue;
    }
    const row = pending.get(offerId);
    if (!row) {
      // 编的 id，或者这杯已经不在了。账本里要是还挂着，顺手划掉
      console.log(`bar-offers: 吧台上没有 ${offerId} 这杯（按 ${source}），跳过`);
      if (source === 'proof') forgetOffer(offerId, '对账时 Proof 已没有这杯');
      skipped++;
      continue;
    }

    if (action === 'reject') {
      let out;
      try {
        out = await rejectOffer(offerId);
      } catch (err) {
        console.error(`bar-offers: 退不掉「${row.name}」`, err.message);
        skipped++;
        continue;
      }
      if (!out || out.ok === false) {
        const why = out?.detail || out?.error || '不知道为什么';
        console.error(`bar-offers: 退不掉「${row.name}」：${why}`);
        if (isGone(out)) forgetOffer(offerId, `退的时候 Proof 回：${why}`);
        skipped++;
        continue;
      }
      try {
        markOfferRejected(offerId);
      } catch (err) {
        console.error('bar-offers: 账本没记上', err.message);
      }
      rejected++;
      console.log(`bar-offers: ${AI_NAME}没喝「${row.name}」，放回去了`);
      continue;
    }

    let out;
    try {
      out = await drinkOffer(offerId);
    } catch (err) {
      console.error(`bar-offers: 「${row.name}」没喝成`, err.message);
      skipped++;
      continue;
    }
    if (!out || out.ok === false) {
      const why = out?.detail || out?.error || '不知道为什么';
      console.error(`bar-offers: 「${row.name}」没喝成：${why}`);
      // 拿空了。划掉账本里那条，不让下次醒来再撞一次
      if (isGone(out)) forgetOffer(offerId, `喝的时候 Proof 回：${why}`);
      skipped++;
      continue;
    }
    let saved = row;
    try {
      saved = markOfferDrunk(offerId, out);
    } catch (err) {
      console.error('bar-offers: 账本没记上（酒已经喝了）', err.message);
    }
    drunk++;
    console.log(`bar-offers: ${AI_NAME}喝了她递的「${saved?.name || row.name}」`);
  }

  return { drunk, rejected, skipped };
}
