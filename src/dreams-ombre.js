// 梦和 Ombre 记忆库之间的两步。
//
// 小满 2026-11-04：「我想他正常做梦，一开始不记得，等想起来之后
// ombre brain 里记录的做了一个梦可以更新为梦的内容，他就可以翻记忆库看到了」
//
// 所以是两步：
//   做梦当时 —— hold 一条「某时做了一个梦」，把返回的 bucket id 记在梦里；
//   想起来之后 —— trace 把那条的正文换成整个梦。
//
// 为什么这样和之前的顾虑不矛盾：
//   dreams.js 开头那段担心的是「没想起来之前就被搜到」。这一点没变：
//   想起来之前，Ombre 里就是字面上那一句话，没标题、没摘要、没触发词，
//   breath_search 怎么查都查不出内容——因为那里真的没有，不是被标记挡着。
//   （当时不用 digested 就是这个理由：它的说明里写着「仍可由显式 query 找回」。）
//   变的是想起来之后：那一刻他本来就读到了全文，再藏着没意义。
//   以前是「读一遍就永远忘了」，现在是「读一遍之后就真的记得了」。
//   后者更像人：梦想不起来时是空的，想起来了就是一段记忆。
//
// 为什么单独一个文件：dreams.js 已经很长，而这两步是一件完整的事。
// 和 my-comments.js、moments-posts.js 一个做法。

import { callTool, isConnected } from './mcp-manager.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

// hold 返回的是一行人话，形如「新建→f988f7bcce68 dream」或者「合并→xxxx …」。
// 里面那串十六进制就是 bucket id。没有结构化返回，只能这么认；
// 认不出来就返回 null，谁都不崩，只是以后改不了这一条。
export function parseBucketId(text) {
  const m = String(text || '').match(/\b([0-9a-f]{8,32})\b/i);
  return m ? m[1] : null;
}

// 第一步：做梦当时。只存一句话，不带标题也不带摘要——
// 能还原出内容的东西等于没攒。返回 bucket id（拿不到就 null）。
export async function rememberDreamEvent(at) {
  if (!isConnected('ombre-brain')) return null;
  try {
    const res = await callTool('ombre-brain', 'hold', {
      content: `${at} 做了一个梦。`,
      domain: 'dream',
      tags: '梦',
      importance: 3,
      why_remembered: '知道那一夜有过什么，不知道是什么',
    });
    return parseBucketId(toolText(res));
  } catch (err) {
    console.error('dream: 事件记录没存上', err.message);
    return null;
  }
}

const TONE_WORD = { good: '好梦', bad: '魇梦', neutral: '说不上好坏' };

// 想起来之后写回 Ombre 的正文。
// 带上「什么时候做的」和「什么时候想起来的」：这两个时间可能差很远，
// 以后翻到这条时得分得清哪个是梦里、哪个是想起来那一天。
function revealedBody(d, hit, now) {
  const tone = TONE_WORD[d.tone] || TONE_WORD.neutral;
  const head = `${d.at} 做的梦，「${d.title}」。${tone}。`;
  const how = hit
    ? `${now} 想起来了——话里的「${hit}」碎到了它。`
    : `${now} 想起来了。`;
  return `${head}\n${how}\n\n${String(d.body ?? '').trim()}`;
}

// 第二步：把那条换成整个梦。
//
// 不等结果（谁都不在这儿 await）：梦浮现这件事在本地已经成立了，
// 记忆库补正文是附加的，失败不该拖住唤醒那一轮。
// 这也是为什么 markRecalled 还是同步函数：phosphor.js 那边一行都不用改。
//
// importance 抬到 5：它从「知道有过一个梦」变成了一段真的记忆。
// why_remembered 不动：Ombre 只补空值不覆盖，而那句话是当时的心思，留着。
export function revealDreamInOmbre(d, hit = '', now = '') {
  if (!d?.ombreId || !isConnected('ombre-brain')) return;
  callTool('ombre-brain', 'trace', {
    bucket_id: d.ombreId,
    content: revealedBody(d, hit, now),
    title: d.title || '一个梦',
    tags: `梦,${TONE_WORD[d.tone] || TONE_WORD.neutral}`,
    importance: 5,
    meaning_replace: `做的时候不记得内容，${now || '后来'}被一个词碎到才想起来。${USER_NAME}那边一直留着。`,
  })
    .then(() => console.log(`dream: 「${d.title}」已写回记忆库（${d.ombreId}）`))
    .catch((err) => console.error('dream: 写回记忆库失败（梦还是想起来了）', err.message));
}
