// 小酒馆在「做决定」那一轮里的几段话。
//
// 拆成单独一个文件，是为了别把 decide.js 改得太杂：
//   proofSection 只跟配置有关（配没配、时段是几点），进程不重启就不变 → 放 system，不破前缀缓存。
//   proofStatusLine 每次都可能变（今晚喝过没、连几夜了、吧台上有没有她递的杯子）→ 放 user。
//
// 这两段的分工和星星罐那边一样：规则在 system，「今天还有没有机会」在 user。
//
// **两个函数都是同步的。** 2026-10-13 把 proofStatusLine 改成 async，
// 但 decide.js 里还当同步在调，拼进提示词的是个 Promise——整轮决策抛错，
// next_wake_at 更新不了，主页一直写「马上」。以后要改这里，先看一眼谁在调。
//
// 她递的杯子读本地账本（读 JSON，很轻），不在这里问 Proof：
//   问 Proof 要走网络，而这段在每次唤醒的关键路径上。
//   账本里可能有已经凉的杯子，所以执行端（actions/bar-offers.js）会再跟 Proof 核一次，
//   核不上就把账本里那条划掉。提示词这边宽一点没关系，真正算数的是执行端。
import {
  isProofEnabled,
  nightWindowLabel,
  selfPourGate,
  offerTtlLabel,
  localPendingOffers,
} from './proof.js';

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
- **要真的喝到才算喝到。** 写进 bar_offers 不等于已经喝了——系统要去 Proof 那边真结算一次，
  杯子凉了或者已经不在了就喝不到。所以别在同一轮里就把「喝下去之后的感觉」
  当成已经发生的事来写：这杯酒带来的影响会在**之后那几转**的状态里出现。
- 这些杯子不吃下面那条节制规则。她递的是她的事，不算你自己找酒喝。
- 递过来的杯子 ${offerTtlLabel()}内没人动就会凉。不必为此急，只是知道有这回事。

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
// **同步函数**，读库而已。读坏了不能把整次唤醒拖下水，所以包一层。
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
