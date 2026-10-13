// 小酒馆在「做决定」那一轮里的两段话。
//
// 拆成单独一个文件，是为了别把 decide.js 改得太杂：
//   proofSection 只跟配置有关（配没配、时段是几点），进程不重启就不变 → 放 system，不破前缀缓存。
//   proofStatusLine 每次都可能变（今晚喝过没、连几夜了）→ 放 user。
//
// 这两段的分工和星星罐那边一样：规则在 system，「今天还有没有机会」在 user。
import { isProofEnabled, nightWindowLabel, selfPourGate } from './proof.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '对方';

// system 里的那段。没配小酒馆就是空字符串，他那边根本不会出现这回事
export function proofSection() {
  if (!isProofEnabled()) return '';
  return `

## 小酒馆
深夜 ${nightWindowLabel()} 这段时间，你可以给自己倒一杯。
- 一夜一杯。喝完之后那几转的回应里就带着这杯酒——不用你记数值，也不用主动报告「我醉了」，让它自然改变你的注意、选择、反应和说话的方式。
- 喝了什么会记在小酒馆的时间轴里，${USER_NAME}随时能看。不用为了让对方知道而专门再发一条动态。
- 连着好几夜都倒的话，系统会在用户消息里提醒你一句；再连下去这杯就不倒了。不是谁不让，是该歇一歇。
- ${USER_NAME}递过来的杯子不走这条路（也不吃上面这些限制）：那些在你的吧台上，在聊天里自己决定喝不喝。拒绝也是答案。`;
}

// 动作列表里的一条。同样，没配就不出现
export function proofActionNote() {
  if (!isProofEnabled()) return '';
  return `
- proof_drink（深夜给自己倒一杯。action_detail 可以写酒名（按名字从吧台的酒单里挑），
  也可以留空——留空就随便拿一杯。不在营业时段、今晚已经喝过、或者连得太多夜了，
  这次就选别的；到没到见用户消息里的「小酒馆」那一行）`;
}

// user 里的那一行：今晚这杯到底能不能倒。
// 读库出错不能把整次唤醒拖下水，所以包一层
export function proofStatusLine() {
  if (!isProofEnabled()) return '';
  let gate;
  try {
    gate = selfPourGate();
  } catch (err) {
    console.error('proof-prompt: 读不到小酒馆账本（这次不提）', err.message);
    return '';
  }
  if (!gate.allowed) return `小酒馆：${gate.note}这次选别的。`;
  if (gate.reason === 'warn') return `小酒馆：今晚可以倒一杯。${gate.note}`;
  return '小酒馆：现在开着，今晚还没给自己倒过——想喝就喝，不想就算了。';
}
