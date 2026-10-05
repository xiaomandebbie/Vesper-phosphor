// 摇一摇星星罐：从罐子里随机落出一颗旧星星，回头看看当时咽下去的是什么话。
//
// 和 star_jar 正好相反：那个是往里放（一天一颗），这个只是翻出来看，不写入、也不消耗那次机会。
// 但它占一次行动：回头看自己放过什么，本身就是这次醒来做的那件事。
//
// 两个人放的都算（who 不限）—— 罐子是共用的，摇出谁的那一颗都行。
//
// 行为卡片在这里自己写，不走 activity.js 的 describeActivity：
// 那边对未知动作返回 null，正好不会重复记一张。卡片正文只写摇了罐子，
// 落出来的具体内容在点开的详情里——咽下去的话不该摄在卡片表面。

import { listStars } from '../star-jar.js';
import { addActivityMoment } from '../moments-store.js';
import { formatDateTime } from '../wall-time.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

export default async function shakeJar() {
  let stars = [];
  try {
    stars = listStars();
  } catch (err) {
    console.error('shake_jar: 读星星罐失败', err.message);
    return null;
  }

  if (!stars.length) {
    console.log('shake_jar: 罐子还是空的，摇不出东西');
    return null;
  }

  const pick = stars[Math.floor(Math.random() * stars.length)];
  const fromHer = pick.who === 'user';
  const owner = fromHer ? USER_NAME : AI_NAME;

  // 卡片正文：只说摇了罐子。「星星罐」三个字在页面上会被标成暖黄（见 star-entry.js）
  const text = `${AI_NAME}摇了摇星星罐`;

  // 详情：落出来的是谁的哪一颗、当时写了什么、后来有没有被摘下来回过
  const lines = [`落出来一颗——${owner}放的，${formatDateTime(pick.ts)}`, '', pick.content];
  if (pick.reply) {
    lines.push('', `后来被摘下来回过：${pick.reply}`);
  } else if (fromHer) {
    lines.push('', '还没被摘下来过。');
  }

  try {
    addActivityMoment(text, lines.join('\n'));
  } catch (err) {
    console.error('shake_jar: 记行为卡片失败', err.message);
  }

  console.log(`shake_jar: 摇出了 #${pick.id}（${fromHer ? '她' : '自己'}放的）`);
  // 内容不进返回值：返回值会进 wake_log，咽下去的话不该漏到那里去
  return { ok: true, id: pick.id, who: pick.who, total: stars.length };
}
