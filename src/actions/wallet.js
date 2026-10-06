// 钱包的三个动作：都是他自己要去做的，不是塞到眼前的。
//
//   wallet_balance  打开小钱包——现在有多少钱，跟卡里对不对得上
//   wallet_ledger   翻账本——最近几笔、某一天的、或者最近的批注
//   wallet_note     记一笔账——给账本里某一笔写句批注
//
// 行为卡片在这里自己写，不走 activity.js 的 describeActivity：
// 那边对未知动作返回 null，正好不会重复记一张。和 shake_jar、read_memo 同一个路子。
// 卡片正文只写做了什么（打开了小钱包 / 翻了翻账本 / 记了一笔账），
// 看到了什么、写了什么在点开的详情里。
//
// 返回值会进 wake_log，所以里面不放账单正文，只放算出来的数和一个 text
// （text 是给续步用的，见 phosphor.js 的 continueWallet）。

import {
  addNote,
  describeBalance,
  describeLedger,
  describeNotes,
  getEntry,
  listNotesFor,
  yuan,
  WAKE_LEDGER_LIMIT,
  MAX_NOTE_CHARS,
} from '../wallet.js';
import { addActivityMoment } from '../moments-store.js';
import { formatDateTime } from '../wall-time.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 详情最多记多少字。翻一整天的账可能很长，全存会把动态页撑大
const MAX_DETAIL_CHARS = 2000;

function clip(text, n = MAX_DETAIL_CHARS) {
  const chars = Array.from(String(text ?? '').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面还有，太长没记下来）` : chars.join('');
}

function tryJson(value) {
  if (value == null || value === '') return {};
  if (typeof value === 'object') return value;
  try {
    const v = JSON.parse(value);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

function card(text, detail) {
  try {
    addActivityMoment(text, detail ? clip(detail) : null);
  } catch (err) {
    console.error('wallet action: 记行为卡片失败', err.message);
  }
}

// ---------- 打开小钱包 ----------

export async function walletBalance() {
  let text;
  try {
    text = describeBalance();
  } catch (err) {
    console.error('wallet_balance: 读账失败', err.message);
    return null;
  }
  card(`${AI_NAME}打开了小钱包`, text);
  console.log('wallet_balance: 看了一眼余额');
  return { ok: true, kind: 'balance', text };
}

// ---------- 翻账本 ----------

// action_detail 三选一：{} 最近几笔、{"date":"2026-10-06"} 那天的、{"notes":true} 最近的批注
export async function walletLedger(detail) {
  const j = tryJson(detail);
  const wantNotes = j.notes === true || j.notes === 'true';
  const date = typeof j.date === 'string' && j.date.trim() ? j.date.trim() : null;

  let text;
  try {
    text = wantNotes ? describeNotes(WAKE_LEDGER_LIMIT) : describeLedger({ date });
  } catch (err) {
    console.error('wallet_ledger: 读账失败', err.message);
    return null;
  }

  // 卡片上带上看的是哪一段，其余在详情里
  const what = wantNotes ? '，读了读批注' : date ? `，翻到 ${date} 那一天` : '';
  card(`${AI_NAME}翻了翻账本${what}`, text);
  console.log(`wallet_ledger: 翻了账本${wantNotes ? '（批注）' : date ? `（${date}）` : ''}`);
  return { ok: true, kind: wantNotes ? 'notes' : 'ledger', date, text };
}

// ---------- 记一笔账 ----------

// action_detail：{"entry_id":12,"note":"..."}
export async function walletNote(detail) {
  const j = tryJson(detail);
  const entryId = Number(j.entry_id ?? j.entryId ?? j.id);
  const content = String(j.note ?? j.content ?? j.memo ?? '').trim();

  if (!Number.isInteger(entryId)) {
    console.error('wallet_note: 没给 entry_id，不知道该记在哪笔账旁边');
    return null;
  }
  if (!content) {
    console.error('wallet_note: 批注是空的，没写');
    return null;
  }

  const entry = getEntry(entryId);
  if (!entry) {
    console.error(`wallet_note: 账本里没有 #${entryId} 这笔`);
    return null;
  }

  let id;
  try {
    id = addNote({ entryId, author: 'assistant', content });
  } catch (err) {
    console.error('wallet_note: 写批注失败', err.message);
    return null;
  }
  if (!id) return null;

  const amount = `${entry.amount_cents > 0 ? '+' : '−'}¥${yuan(Math.abs(entry.amount_cents))}`;
  const which = `#${entry.id} ${formatDateTime(entry.ts).slice(5)}${
    entry.source ? ` ${entry.source}` : ''
  } ${amount}`;

  // 卡片正文只说记了一笔；写的那句话在详情里。
  // 详情里把这笔账旁边已有的批注也带上，谁写的都看得见
  const lines = [which, '', content];
  const others = listNotesFor(entryId).filter((n) => n.id !== id);
  if (others.length) {
    lines.push('', '这笔旁边还有：');
    for (const n of others) {
      const who = n.author === 'user' ? process.env.USER_DISPLAY_NAME || '她' : AI_NAME;
      lines.push(`${who}（${formatDateTime(n.ts).slice(5)}）：${n.content}`);
    }
  }
  card(`${AI_NAME}记了一笔账`, lines.join('\n'));

  console.log(`wallet_note: 给 #${entryId} 记了一句（${content.length} 字）`);
  // 批注正文不进返回值：返回值会进 wake_log
  return { ok: true, kind: 'note', entryId, noteId: id, length: content.length };
}

// ---------- 给续步用 ----------

// phosphor.js 的 continueWallet 用这个跑第二步以后的动作。
// args 是对象，和 action_detail 走同一套解析
export const WALLET_READ_ACTIONS = new Set(['wallet_balance', 'wallet_ledger']);
export const WALLET_WRITE_ACTIONS = new Set(['wallet_note']);

export async function runWalletStep(action, args) {
  switch (action) {
    case 'wallet_balance':
      return walletBalance();
    case 'wallet_ledger':
      return walletLedger(args);
    case 'wallet_note':
      return walletNote(args);
    default:
      return null;
  }
}

export { MAX_NOTE_CHARS };
