// 他醒来时对「她递到吧台上那几杯」的回应。
//
// 不占这次唤醒的动作，和回留言、摘她的星一个规矩。
//
// **递的杯子要「领」（claim），不是「喝 offerId」。**
// Proof 的约定：归属在饮用时确定，只有经过 /agent/offers/claim 才进他的引擎。
// 2026-10-13 整天那个 not_found 就是因为我让他走 /agent/offers/:id/drink——那个必然 404。
import {
  claimOffer,
  rejectCapability,
  markOfferDrunk,
  markOfferRejected,
  markOfferGone,
  localPendingOffers,
} from '../proof.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const MAX_PER_WAKE = Number(process.env.PROOF_OFFERS_PER_WAKE) || 2;

// Proof 回这些就是「这杯已经不在了」
const GONE = /not_found|notfound|gone|missing|unknown|expire|link_expired|already|conflict/i;
const isGone = (out) =>
  out?.status === 404 ||
  out?.status === 409 ||
  out?.status === 410 ||
  GONE.test(String(out?.error ?? '')) ||
  GONE.test(String(out?.detail ?? '')) ||
  GONE.test(String(out?.message ?? ''));

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

export async function handleBarOffers(decision) {
  const asked = normalizeBarOffers(decision?.bar_offers);
  if (!asked.length) return { drunk: 0, rejected: 0, skipped: 0 };

  let pending;
  try {
    pending = new Map(localPendingOffers().map((o) => [String(o.offerId), o]));
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
      console.log(`bar-offers: 账本里没有 ${offerId} 这杯，跳过`);
      skipped++;
      continue;
    }
    if (!row.token) {
      // 老记录没存 token（那时还在走错的接口）——领不了，划掉
      console.log(`bar-offers: 「${row.name}」没存领取凭证（老记录），划掉`);
      markOfferGone(offerId, '没存 capability token，领不了');
      skipped++;
      continue;
    }

    if (action === 'reject') {
      let out;
      try {
        out = await rejectCapability(row.token);
      } catch (err) {
        console.error(`bar-offers: 退不掉「${row.name}」`, err.message);
        skipped++;
        continue;
      }
      if (!out || out.ok === false) {
        const why = out?.detail || out?.error || `HTTP ${out?.status ?? '?'}`;
        console.error(`bar-offers: 退不掉「${row.name}」：${why}`);
        if (isGone(out)) markOfferGone(offerId, `退的时候 Proof 回：${why}`);
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

    // 领走并喝下。这是唯一正确的入口
    let out;
    try {
      out = await claimOffer(row.token);
    } catch (err) {
      console.error(`bar-offers: 「${row.name}」领不走`, err.message);
      skipped++;
      continue;
    }
    if (!out || out.ok === false) {
      const why = out?.detail || out?.error || `HTTP ${out?.status ?? '?'}`;
      console.error(`bar-offers: 「${row.name}」领不走：${why}`);
      if (isGone(out)) markOfferGone(offerId, `领的时候 Proof 回：${why}`);
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
