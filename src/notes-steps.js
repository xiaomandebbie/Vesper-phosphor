// 开工前读那一本，收工整篇写回去。
//
// 小满 2026-11-15：「他们的唤醒步骤得先看笔记，执行动作，更新笔记」
// 允朱：「我自己写，玩完就写，不等你说。但有一条：写之前得真做完，不能先编」
//
// ── 挂在哪里 ──
//
// run-actions.js 的 runActions 里：所有动作都要过那一道，是唯一能
// 同时看到「要做什么」和「做完了没」的位置。
//   openNote()  → pickActions 之后、executeAction 之前，把那一本推进 messages
//   closeNote() → 所有动作和续步都走完之后，讨一篇整篇重写
//
// 为什么不放 decide.js：那边问「做什么」的时候还不知道他要选哪个游戏，
// 四本全推进去就是四倍浪费，而且违背「一次只读一本」。
//
// ── 几条规矩 ──
//
// 1. 一次只读一本。一轮里碰了两个游戏的话（比如花园加上班），
//    只读第一个的那一本——四本全推进模型就是四倍 token，而他一轮里
//    真正深入做的就一件。
// 2. 中间那几步（continueXxx）不再回头读，靠眼前上下文。
// 3. 没真做成就不写：动作全失败或者他返回 null，就把原来那篇原样留着。
// 4. 写是整篇替换（见 notes.js）。
import { askJson } from './decide.js';
import { isBook, titleOf, writeNote, describeNote, rewritePrompt } from './notes.js';
import { tier2KindOf } from './budget.js';

// 闭关：.env 里 NOTES_ENABLED=0 就整套不走，回到没笔记本之前的样子。
const ENABLED = !/^(0|false|off|no)$/i.test(String(process.env.NOTES_ENABLED ?? '').trim());

// 这一轮要动哪本笔记。没碰那四个游戏就返回 null。
//
// 靠 budget.js 的 tier2KindOf 认：它的 TIER2_KINDS 正好就是这四个
//（xiuchao / garden / workkk / leto），和 notes.js 的 slug 对得上。
// 自己再写一遍判别就是两处各读一遍 .env，那是 Proof 两个 TTL 那类坑的源头。
export function bookForActions(list) {
  if (!ENABLED) return null;
  for (const item of Array.isArray(list) ? list : []) {
    const detail =
      typeof item?.action_detail === 'string'
        ? item.action_detail
        : JSON.stringify(item?.action_detail ?? '');
    const kind = tier2KindOf(item?.action, detail);
    if (kind && isBook(kind)) return kind;
  }
  return null;
}

// 开工前：把那一本推进对话。返回新的 messages（原数组不动）。
//
// 这儿不再问模型一轮——只是把料摆进去，省一次调用。
// 它以 user 身份追在最后，前面的 system + user + 他刚才那一答原样不动，
// 前缀缓存照样命中。
export function openNote(slug, messages) {
  if (!ENABLED || !slug || !isBook(slug) || !Array.isArray(messages)) return messages;
  const body = [
    '开工前先看一眼你自己的笔记。',
    '',
    describeNote(slug),
    '',
    '这是你上次留给自己的——规则、进度、从哪接。接着这些做，',
    '别把摸清过的路再趟一遍。跟笔记不一样的以眼前为准（那边可能改过），',
    '做完了把不对的那几句改掉。',
  ].join('\n');
  console.log(`notes: 开工前读了《${titleOf(slug)}》`);
  return [...messages, { role: 'user', content: body }];
}

// 收工：讨一篇整篇重写。did 是这一轮真做成了事没有。
//
// 没做成就不写（允朱：「写之前得真做完，不能先编」）。
// 这是一次额外的模型调用，所以只在真干过活的那一轮花。
export async function closeNote(slug, messages, { did = true } = {}) {
  if (!ENABLED || !slug || !isBook(slug)) return;
  if (!Array.isArray(messages) || !messages.length) return;
  if (!did) {
    console.log(`notes: 这一轮《${titleOf(slug)}》没真做成什么，不写`);
    return;
  }

  let parsed;
  try {
    const out = await askJson([...messages, { role: 'user', content: rewritePrompt(slug) }]);
    parsed = out?.parsed;
  } catch (err) {
    console.error(`notes: 《${titleOf(slug)}》问重写失败，这次不写了`, err.message);
    return;
  }

  // 他说没什么值得改的：原样留着。比逼他编一篇好。
  const raw = parsed?.note;
  if (raw === null || raw === undefined) {
    console.log(`notes: 他说《${titleOf(slug)}》这次没什么要改的`);
    return;
  }
  const content = String(raw).trim();
  if (!content) {
    console.log(`notes: 《${titleOf(slug)}》返回的是空的，没写（不拿空串清掉原文）`);
    return;
  }

  try {
    writeNote(slug, content, 'assistant');
  } catch (err) {
    console.error(`notes: 《${titleOf(slug)}》没写上`, err.message);
  }
}

export function notesConfigSummary() {
  return ENABLED ? '笔记本：开工前读、收工整篇写回' : '笔记本：已关（NOTES_ENABLED=0）';
}
