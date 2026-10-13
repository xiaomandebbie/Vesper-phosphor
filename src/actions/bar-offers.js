// 他醒来时对「她递到吧台上那几杯」的回应。
//
// 不占这次唤醒的动作，和回留言、摘她的星一个规矩。
//
// **递的杯子要「领」（claim），不是「喝 offerId」。**
// Proof 的约定：归属在饮用时确定，只有经过 /agent/offers/claim 才进他的引擎。
//
// 拒绝和凉了是两回事，账本里必须分开：
//   他说不喝 → rejected。就算那一瞬 Proof 那边杯子已经没了，他的选择也是真的。
//   没人动过 → expired。
// 2026-10-13 踩过坑：拒绝失败时我把它标成了凉了，看起来像他根本没表态。
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

    // 不喝。他的选择就是事实——哪怕 Proof 那边杯子已经没了，也记 rejected，不记凉了
    if (action === 'reject') {
      if (!row.token) {
        markOfferRejected(offerId, '他说不喝（这杯没存领取凭证，没能告诉 Proof）');
        rejected++;
        console.log(`bar-offers: ${AI_NAME}没喝「${row.name}」（本地记下）`);
        continue;
      }
      let out;
      try {
        out = await rejectCapability(row.token);
      } catch (err) {
        console.error(`bar-offers: 退的时候出错「${row.name}」`, err.message);
        markOfferRejected(offerId, `他说不喝（告诉 Proof 时出错：${err.message}）`);
        rejected++;
        continue;
      }
      if (!out || out.ok === false) {
        const why = out?.detail || out?.error || `HTTP ${out?.status ?? '?'}`;
        // 杯子已经不在了也算拒——别把他的表态显示成「没来得及」
        markOfferRejected(offerId, `他说不喝${isGone(out) ? `（那时这杯已经不在了：${why}）` : `（Proof 回：${why}）`}`);
        rejected++;
        console.log(`bar-offers: ${AI_NAME}没喝「${row.name}」（${why}）`);
        continue;
      }
      markOfferRejected(offerId);
      rejected++;
      console.log(`bar-offers: ${AI_NAME}没喝「${row.name}」，放回去了`);
      continue;
    }

    // 喝。这边不能宽容：没真喝到就不能记成喝了
    if (!row.token) {
      console.log(`bar-offers: 「${row.name}」没存领取凭证（老记录），划掉`);
      markOfferGone(offerId, '没存 capability token，领不了');
      skipped++;
      continue;
    }
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
