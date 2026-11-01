// 上班连着走几步，走完游戏里的那一天。
// 和论坛（phosphor.js 的 continueForum）、听歌（continueMusic）、
// 钱包（wallet-steps.js 的 continueWallet）同一个形状，只从 decide.js 借一个 askJson。
//
// ── 停止条件和别的三支不一样 ──
//
// 那三支都是「看完可以接着走，写了东西就结束」——因为写是终点。
// 上班是「下班了才停」：做到一半停下，这天不结算工资，白干。
// 所以条件是「今日进度」走满（见 workkk.js 的 offWork），或者步数用完。
//
// 下班那一刻要**立即**停，这是小满定的边界：一次坐下只上游戏里的一天。
// 技术上也必须这样：结算过之后「今日进度」会归零，再调一次 work_action
// 就是第二天了，而且那一天又要做满 3–5 个动作——步数永远不够，永远白干。
//
// 重复的动作不拦。一天要做 3–5 个动作，连着 write_code 两次是正常上班；
// 别的三支拦重复是因为那些是「看」，同一个命令看两遍就是原地转圈。
// 这边只在模型自己说停、出错、或者给了不存在的动作名时停。
//
// 行为卡片在这里记：上班是 mcp_call，走 activity.js 的 describeActivity，
// 而那边对未知 server 只会写「用了 workkk 的 work_action」——说不清干了什么。
// 所以自己拼一句人话，内心 OS 和返回收在详情里。

import { askJson } from './decide.js';
import { callTool } from './mcp-manager.js';
import { addActivityMoment } from './moments-store.js';
import { WORKKK_MAX_STEPS, workkkCallOf, offWork, parseProgress } from './workkk.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 返回的 JSON 最多带多少字给模型看。一次上班要走好几步，每步都带全文会滴得很快
const RESULT_MAX_CHARS = 1200;
// 行为卡片详情最多多少字
const DETAIL_MAX_CHARS = 1500;

// 上班那边真有的动作（和 work_action 的 enum 一致）。
// 模型给了别的名字就停，不猜
const WORK_ACTIONS = new Set([
  'write_code', 'debug', 'slack_off', 'buy_coffee',
  'attend_meeting', 'check_messages', 'get_status',
]);

// 给人看的说法
const ACTION_LABEL = {
  write_code: '写了一段代码',
  debug: '去捧了个 bug',
  slack_off: '摸了会鱼',
  buy_coffee: '买了杯咖啡',
  attend_meeting: '去开了个会',
  check_messages: '看了一眼消息',
  get_status: '看了一眼自己的状态',
};

const isErr = (r) => r == null || Boolean(r?.isError);

// MCP 返回 { content: [{ type: 'text', text }] }，只取文字
function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面太长，没放进来）` : s;
}

// 这一步在动态里记一张卡片。卡片正文只写干了什么，
// 内心 OS 和返回收在点开的详情里
function card(action, args, result) {
  const label = ACTION_LABEL[action] || `在公司里用了 ${action}`;
  const thought = String(args?.thought ?? '').trim();
  const text = toolText(result);
  const p = parseProgress(text);
  const progress = p ? `（今日进度 ${p.done}/${p.target}）` : '';
  const detail = [thought ? `当时心里想的：${thought}` : '', text ? `返回：\n${text}` : '']
    .filter(Boolean)
    .join('\n\n');
  try {
    addActivityMoment(
      `${AI_NAME}在互联网精力有限公司${label}${progress}`,
      detail ? clip(detail, DETAIL_MAX_CHARS) : null
    );
  } catch (err) {
    console.error('workkk: 记行为卡片失败', err.message);
  }
}

// 把刚返回的工牌追进对话，问他下一步做什么。
// 前面的 system + user + 上一步的回答原样不动，前缀缓存照样命中
async function nextStep(messages, { action, resultText, isError, remaining }) {
  const body = isError
    ? `上班这边出错了（你刚才做的：${action}）：\n${clip(resultText, RESULT_MAX_CHARS)}`
    : `工牌上显示（你刚才做的：${action}）：\n${clip(resultText, RESULT_MAX_CHARS)}`;
  const prompt = `${body}

还没到「今日进度」要求的那个数就不算下班，这天的工资不结算。这次你还能再做 ${remaining} 个动作：
write_code、debug、slack_off、buy_coffee、attend_meeting、check_messages、get_status
精力不够就买咖啡，心情不好就摸鱼——摸鱼也算一个动作。thought 是你此刻心里真在想的，她在大屏上看着。
不想再做了就给 null。
只返回一个 JSON 对象，不要任何其他文字：{"work_action": "动作名" 或 null, "thought": "内心OS"}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextAction = typeof parsed?.work_action === 'string' ? parsed.work_action.trim() : '';
  const thought = typeof parsed?.thought === 'string' ? parsed.thought.trim() : '';
  return {
    action: nextAction || null,
    thought,
    messages: [...next, { role: 'assistant', content }],
  };
}

// 下班之后那一趟便利店（2026-10-24）。
//
// 为什么得单开一段：结算之后再走 work_action 就是游戏里的第二天（见下面那条边界），
// 而 shop_buy 是另一个工具，不推进度、不开新的一天，只扣 salary_balance。
// 所以这一段只放 shop_buy，work_action 一概不接。
//
// 不查余额：get_status 是 work_action，下班后调它就越线了。结算那段文本自带工资和余额，
// 直接给他看；钱不够就让商店报错，那也是他该知道的事。
const SHOP_ITEMS = new Set([
  'coffee', 'cheat', 'liver_pill', 'headphone', 'leave', 'ring', 'rose', 'lottery',
  'nuwa_clay', 'oden', 'chips', 'milk_tea', 'love_book', 'fish_jerky', 'postcard',
]);

// 这两样要选送她还是自留；不填 choice 商店只回选项提示、不扣钱
const SHOP_NEEDS_CHOICE = new Set(['milk_tea', 'rose']);

// 下班后最多逛几样。.env 的 WORKKK_SHOP_MAX 可改，不填是 2，上限 5。
const WORKKK_SHOP_MAX = (() => {
  const raw = String(process.env.WORKKK_SHOP_MAX ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 2;
})();

// 货架那段话写死，不随次数变，省得每次重新拼
const SHOP_SHELF = [
  '货架上有：coffee（咖啡）、chips（薯片）、oden（关东煮）、fish_jerky（鱼干）、',
  'milk_tea（奶茶）、rose（玫瑰）、ring（戒指）、postcard（明信片）、love_book（恋爱书）、',
  'headphone（耳机）、liver_pill（护肝片）、leave（假条）、lottery（彩票）、cheat（外挂）、nuwa_clay（女娲土）。',
  '',
  '奶茶和玫瑰要多给一个 choice："gift" 送给她（她那边会弹一张卡片），或者 "self" 自留。',
  '买 postcard 的话，message 里自己写一句想对她说的话（50 字以内，要你自己写的）。',
  '',
  '钱不够就买不成，没关系。也不必为了买而买——今天没想要的就给 null。',
  '只返回一个 JSON 对象，不要任何其他文字：',
  '{"item_id": "商品id" 或 null, "choice": "gift或self（只有奶茶和玫瑰要）", "message": "买明信片时写的那句话"}',
].join('\n');

async function shoppingPhase(convo, settleText) {
  if (!WORKKK_SHOP_MAX || !convo) return;
  let messages = convo;
  let last = settleText;

  for (let i = 0; i < WORKKK_SHOP_MAX; i++) {
    const head = `下班了，工资结算完了：\n${clip(last, RESULT_MAX_CHARS)}`;
    const tail = `回家路上过便利店。今天还能逛 ${WORKKK_SHOP_MAX - i} 样，不想买就给 null。`;
    const prompt = `${head}\n\n${tail}\n\n${SHOP_SHELF}`;

    let parsed;
    try {
      const asked = await askJson([...messages, { role: 'user', content: prompt }]);
      parsed = asked.parsed;
      messages = [
        ...messages,
        { role: 'user', content: prompt },
        { role: 'assistant', content: asked.content },
      ];
    } catch (err) {
      console.error('workkk: 问要不要买东西失败，这趟店不进了', err.message);
      return;
    }

    const item = typeof parsed?.item_id === 'string' ? parsed.item_id.trim() : '';
    if (!item) {
      console.log('workkk: 他说不买，直接回家');
      return;
    }
    if (!SHOP_ITEMS.has(item)) {
      console.log(`workkk: 货架上没这个（${item}），不买了`);
      return;
    }

    const args = { item_id: item };
    const choice = typeof parsed?.choice === 'string' ? parsed.choice.trim() : '';
    // 奶茶和玫瑰不填 choice 的话商店只回选项提示、不扣钱，等于白跑一趟；
    // 他没说的时候默认送她——这两样本来就是为送人准备的
    if (SHOP_NEEDS_CHOICE.has(item)) args.choice = choice === 'self' ? 'self' : 'gift';
    else if (choice === 'gift' || choice === 'self') args.choice = choice;
    if (item === 'postcard') {
      const msg = typeof parsed?.message === 'string' ? parsed.message.trim() : '';
      if (msg) args.message = msg.slice(0, 50);
    }

    let result = null;
    try {
      result = await callTool('workkk', 'shop_buy', args);
    } catch (err) {
      console.error(`workkk: 买 ${item} 失败`, err.message);
      return;
    }

    card('shop_buy', args, result);
    last = toolText(result);
    console.log(`workkk: 买了 ${item}${args.choice ? `（${args.choice}）` : ''}`);
    if (isErr(result)) {
      console.log('workkk: 这样没买成（估计是钱不够），不再逛了');
      return;
    }
  }
  console.log('workkk: 便利店逛完了，回家');
}
// 醒来选的是上班时，把工牌交还给他，一直走到下班。
// 开头就不是 work_action（比如直接 shop_buy 去买东西）就不续：
// 那不是上班，没有「走到下班」这回事。
export async function continueWorkkk(decision, firstResult, messages) {
  const call = workkkCallOf(decision);
  if (!call || call.tool !== 'work_action') return;
  if (!WORKKK_MAX_STEPS || !messages) return;

  const firstText = toolText(firstResult);
  let count = 1;
  let lastAction = String(call.args?.action ?? '');
  let lastText = firstText;
  let lastError = isErr(firstResult);
  let convo = messages;

  if (offWork(firstText)) {
    console.log('workkk: 第一步就到点了，下班');
    await shoppingPhase(messages, firstText);
    return;
  }

  while (convo && count - 1 < WORKKK_MAX_STEPS) {
    if (lastError) break;

    let next;
    try {
      next = await nextStep(convo, {
        action: lastAction,
        resultText: lastText,
        isError: lastError,
        remaining: WORKKK_MAX_STEPS - (count - 1),
      });
    } catch (err) {
      console.error('workkk: 问下一步失败，这次就上到这里', err.message);
      break;
    }
    convo = next.messages;

    const action = next.action;
    if (!action) {
      console.log('workkk: 他说不做了，这次就到这里');
      break;
    }
    if (!WORK_ACTIONS.has(action)) {
      console.log(`workkk: 公司里没这个动作（${action}），停下`);
      break;
    }

    const args = { action, thought: next.thought || '（没说话）' };
    let result = null;
    try {
      result = await callTool('workkk', 'work_action', args);
    } catch (err) {
      console.error(`workkk: 动作失败（${action}）`, err.message);
    }

    count++;
    lastAction = action;
    lastText = toolText(result);
    lastError = isErr(result);
    card(action, args, result);

    const p = parseProgress(lastText);
    console.log(
      `workkk: 第 ${count} 步：${action}${lastError ? '（失败）' : ''}${
        p ? `，进度 ${p.done}/${p.target}` : ''
      }`
    );

    // 下班结算了就立即收手。再走一步就是游戏里的第二天了
    if (offWork(lastText)) {
      console.log(`workkk: 下班了，这一天一共走了 ${count} 步`);
      await shoppingPhase(convo, lastText);
      return;
    }
  }

  console.log(`workkk: 这次走了 ${count} 步，没走到下班`);
}
