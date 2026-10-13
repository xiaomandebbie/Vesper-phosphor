// 「她递到吧台上的那几杯」——以 Proof 为准。
//
// 2026-10-13 踩的坑：原来他醒来看到的待喝列表读的是我们本地账本，
// 而真正算数的是 Proof。账本里「清凉」挂着 pending，Proof 那边这个 offerId
// 已经不在了，结果他看见了、伸手了、拿空了，然后按「看见的」写了篇动态。
//
// 所以这里的规矩：
//   能问到 Proof 就以它为准；问不到才退回本地账本（并按 TTL 滤一遍）。
//   拿空了就把账本里那条划掉，不让它下次再来骗人。
import {
  humanOffers,
  localPendingOffers,
  markOfferGone,
  PROOF_AGENT_ID,
} from './proof.js';

const PENDING = /pending|open|offered|waiting/i;

// 问 Proof：此刻真在他吧台上的那几杯。
// 返回 null = 问不到（服务挂了、字段不认），让调用方自己决定要不要退回本地。
// 空数组 = 真的没有。这两种不能混。
export async function proofPendingOffers() {
  let out;
  try {
    out = await humanOffers();
  } catch (err) {
    console.error('proof-offers: 问不到 Proof（退回本地账本）', err.message);
    return null;
  }
  if (!out || out.ok === false || !Array.isArray(out.offers)) return null;

  return out.offers
    .filter((o) => {
      if (!PENDING.test(String(o?.status || ''))) return false;
      // 只要递给他的。公开链接没有 targetId，那种走的是另一条路，不在这里
      const target = String(o?.targetId ?? o?.target ?? '').trim();
      return !target || target === PROOF_AGENT_ID;
    })
    .map((o) => ({
      offerId: String(o.id),
      name: o?.projection?.claimedName || o?.name || '无名的一杯',
      intro: o?.projection?.intro || '',
    }));
}

// 他醒来时该看到哪几杯。
// 这是唯一入口：提示词和执行端都用它，两边看到的必须是同一份。
export async function pendingForWake() {
  const authoritative = await proofPendingOffers();
  if (authoritative) return { offers: authoritative, source: 'proof' };
  return { offers: localPendingOffers(), source: 'local' };
}

// 伸手拿空了（Proof 回 not_found / gone / 不存在）。
// 把账本里那条划掉，下次就不会再端给他。
const GONE = /not_found|notfound|gone|missing|unknown_offer|expire/i;
export function isGone(result) {
  return GONE.test(String(result?.error ?? result?.detail ?? result?.message ?? ''));
}

export function forgetOffer(offerId, why) {
  try {
    const ok = markOfferGone(offerId, why);
    if (ok) console.log(`proof-offers: 账本里那杯「${offerId}」已经不在 Proof 上了，划掉`);
    return ok;
  } catch (err) {
    console.error('proof-offers: 划不掉', err.message);
    return false;
  }
}
