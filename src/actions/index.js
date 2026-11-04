import bark from './bark.js';
import moment from './moment.js';
import mcpAction from './mcp-action.js';
import ombreBrain from './ombre-brain.js';
import setMode from './set-mode.js';
import starJar from './star-jar.js';
import shakeJar from './shake-jar.js';
import readMemo from './read-memo.js';
import proofDrink from './proof-drink.js';
import readBook from './read-book.js';
import { describeActivity, describeActivityDetail } from './activity.js';
import { addActivityMoment } from '../moments-store.js';
import { pushAsync } from '../push.js';

const actions = {
  bark,
  moment,
  // 旧名兼容：日记已经换成动态，模型偶尔还写 diary 时照样按动态发
  diary: moment,
  mcp_call: mcpAction,
  ombre_brain: ombreBrain,
  set_mode: setMode,
  star_jar: starJar,
  shake_jar: shakeJar,
  read_memo: readMemo,
  proof_drink: proofDrink,
  read_book: readBook,
  noop: async () => {},
};

export async function executeAction(decision) {
  const fn = actions[decision.action] || actions.noop;
  let result;
  try {
    // 自斟那杯要把当时的心情一起记进小酒馆的时间轴，所以多传一个上下文。
    // 其他 action 只收第一个参数，多给的这个他们不看
    result = await fn(decision.action_detail, { mood: decision.mood });
  } catch (err) {
    console.error(`executeAction(): action "${decision.action}" failed:`, err.message);
    return null;
  }

  // 推送、发动态以外的行动（逛论坛、翻记忆、调节律），在动态里记一笔，点开能看详情。
  // 行为记录不占"6 小时一条"的动态间隔。
  // 星星罐不在这里：describeActivity 对 star_jar 返回 null，那句话只在星星罐里。
  // 摇罐子（shake_jar）也不在：它在自己里面写好了卡片，落出来的那句话收在详情里。
  // 翻批注本（read_memo）同理：卡片在它自己里面写，批注正文收在详情里。
  // 自斟（proof_drink）也不在：喝了什么在小酒馆 /bar 的时间轴里，不必再往动态里塞一张卡。
  //
  // 通知和行动卡走同一句话（2026-11-05）：
  // describeActivity() 生成的就是「允朔刚刚逛了 Lutopia 论坛，随便逛了逛」
  // 这样的人话，直接当通知正文，不另写一套说法——两处各写一遍，
  // 改了一边忘了另一边就是下一个坑。
  // 详情不进通知：那里面是工具返回的整段内容，最多三千字。
  try {
    const text = describeActivity(decision, result);
    if (text) {
      addActivityMoment(text, describeActivityDetail(decision, result));
      // tag 固定：一次醒来可能做几件事，后一条盖前一条，不把锁屏堆成一片。
      // 点通知进主页：行动卡就摆在那里（见 home-activity.js）
      pushAsync({ title: text, url: '/home', tag: 'vp-act' });
    }
  } catch (err) {
    console.error('executeAction(): 记录行为动态失败', err.message);
  }
  return result;
}
