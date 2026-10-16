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
      return;
    }
  }

  console.log(`workkk: 这次走了 ${count} 步，没走到下班`);
}
