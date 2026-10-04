// 往星星罐里放一颗星：今天最重要的那一句"想说但没说出来的话"。
// 一天只有一次机会（见 star-jar.js 的 addStar，查和插在同一个事务里）。
//
// 今天已经放过了就当这次没做成：返回 null，executeAction 不记行为卡片，
// 共享时间线也不会写——罐子里的话是"咽下去的"，不该顺着时间线漏到别处去。
// 能不能放，决策时已经在用户消息里告诉过 TA 了（见 decide.js 的 starJarLine）。
//
// 这里只管 TA 自己放的那颗（who='assistant'）。你放的那颗走网页表单，见 star-jar.js 的路由。

import { addStar, hasStarToday, MAX_STAR_CHARS } from '../star-jar.js';

export default async function starJar(detail) {
  // action_detail 约定是正文；模型有时会给 {"content":"..."}，两种都收
  let text = String(detail ?? '').trim();
  if (text.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      if (j && typeof j === 'object') text = String(j.content ?? j.text ?? j.star ?? '').trim();
    } catch {
      // 不是 JSON，就当正文
    }
  }
  if (!text) {
    console.log('star_jar: 没有正文，这次不放');
    return null;
  }

  if (hasStarToday(Date.now(), 'assistant')) {
    console.log('star_jar: 今天已经放过一颗了，这次不放');
    return null;
  }

  const id = addStar(text, { who: 'assistant' });
  if (!id) {
    console.log('star_jar: 没放进去（今天已经有一颗了）');
    return null;
  }
  console.log(`star_jar: 放进去一颗（#${id}）`);
  return { ok: true, id, content: text.slice(0, MAX_STAR_CHARS) };
}
