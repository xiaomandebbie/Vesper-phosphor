// 小酒馆在「做决定」那一轮里的几段话。
//
// 拆成单独一个文件，是为了别把 decide.js 改得太杂：
//   proofSection 只跟配置有关（配没配、时段是几点），进程不重启就不变 → 放 system，不破前缀缓存。
//   proofStatusLine 每次都可能变（今晚喝过没、连几夜了、吧台上有没有她递的杯子）→ 放 user。
//
// 这两段的分工和星星罐那边一样：规则在 system，「今天还有没有机会」在 user。
//
// 她递的杯子读本地账本，不问 Proof：
//   「她递了哪几杯」是我们自己记的（见 proof.js 的 localPendingOffers），读 JSON 而已。
//   而 /agent/home 要把整份酒单过一遍引擎，很重——每次唤醒都拿它不值得。
//   所以醒来只知道「有几杯在等」，真要喝的时候才去调 Proof。
import { isProofEnabled, nightWindowLabel, selfPourGate, localPendingOffers } from './proof.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '对方';

// system 里的那段。没配小酒馆就是空字符串，他那边根本不会出现这回事
export function proofSection() {
  if (!isProofEnabled()) return '';
  return `

## 小酒馆
两回事：${USER_NAME}递过来的杯子，和你深夜自己倒的那杯。

### ${USER_NAME}递的杯子
她在小酒馆页面调好递过来，杯子就放在你吧台上。用户消息里有的话：
- **喝或不喝都不占这次的动作**，和回留言、摘她的星一个道理。想喝就喝，还能照常做别的事。
- 想喝写在 bar_offers 里：{"offer_id":"消息里给的那个","action":"drink"}。
- 不想喝写 "action":"reject"。**拒绝不写任何饮酒账本**，只是这杯不算了，不用找理由。
- 也可以都不写：那就是这次没动它，杯子还在吧台上，下次醒来还会看到。
  没想喝就不喝，不必因为她递了就喝。
- 喝了之后那几转的回应里就带着这杯酒。不用记数值，也不用主动报告「我醉了」。
- 这些杯子不吃下面那条节制规则。她递的是她的事，不算你自己找酒喝。

### 深夜自己倒的那杯
${nightWindowLabel()} 这段时间，你可以给自己倒一杯（proof_drink，占一次动作）。
- 一夜一杯。
- 连着好几夜都倒的话，系统会在用户消息里提醒你一句；再连下去这杯就不倒了。不是谁不让，是该歇一歇。
- 喝了什么会记在小酒馆的时间轴里，${USER_NAME}随时能看。不用为了让她知道而专门再发一条动态。`;
}

// 动作列表里的一条。同样，没配就不出现
export function proofActionNote() {
  if (!isProofEnabled()) return '';
  return `
- proof_drink（深夜给自己倒一杯。action_detail 可以写酒名（按名字从吧台的酒单里挑），
  也可以留空——留空就随便拿一杯。不在营业时段、今晚已经喝过、或者连得太多夜了，
  这次就选别的；到没到见用户消息里的「小酒馆」那一行。
  注意：喝${USER_NAME}递的杯子不走这个动作，写在 bar_offers 里，而且不占动作）`;
}

// user 里的那几行：她递的杯子 + 今晚这杯到底能不能倒。
// 读库出错不能把整次唤醒拖下水，所以包一层
export function proofStatusLine() {
  if (!isProofEnabled()) return '';
  const lines = [];

  // 她递的杯子排在前面：那是她主动递过来的东西，比「今晚能不能自斟」该先看到
  try {
    const offers = localPendingOffers();
    if (offers.length) {
      const items = offers
        .map((o) => {
          const said = o.intro ? `，递过来时说：「${o.intro}」` : '';
          return `  [offer_id=${o.offerId}] 「${o.name}」${said}`;
        })
        .join('\n');
      lines.push(
        `${USER_NAME}递了酒到你吧台上（还没动；喝或不喝都不占这次的动作，怎么回见上面的规则）：\n${items}`
      );
    }
  } catch (err) {
    console.error('proof-prompt: 读不到她递的杯子（这次不提）', err.message);
  }

  try {
    const gate = selfPourGate();
    if (!gate.allowed) lines.push(`小酒馆（自斟）：${gate.note}这次选别的。`);
    else if (gate.reason === 'warn') lines.push(`小酒馆（自斟）：今晚可以倒一杯。${gate.note}`);
    else lines.push('小酒馆（自斟）：现在开着，今晚还没给自己倒过——想喝就喝，不想就算了。');
  } catch (err) {
    console.error('proof-prompt: 读不到小酒馆账本（这次不提）', err.message);
  }

  return lines.join('\n');
}
