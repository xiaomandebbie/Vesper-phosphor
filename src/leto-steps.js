// Leto 连着走几步。和锈潮（xiuchao-steps.js）、论坛、听歌、上班、花园同一个路子，
// 只从 decide.js 借一个 askJson。
//
// ── 为什么非得有这个 ──
//
// phosphor 一轮是「调一次模型 → 执行动作 → 写日志 → 结束」，工具返回的东西
// 不会再喂回模型。2026-11-01 03:39 那次就是这么卡住的：他写了 leto_read，
// 等读到「测试！！！」时这一轮已经走完，想回也没有机会。
//
// 他只剩两条路：盲写一条 leto_reply（没读就回），或者像 03:22 那次约个续场
// 25 分钟后再来。两条都不对——read 和 reply 在单轮里永远凑不到一起。
//
// ── 停止条件和锈潮不一样 ──
//
// 锈潮那边不猜哪步算「做完了」，因为采药、钓鱼、说话都不是终点。
// Leto 有终点：交回这次调用。leto_reply / leto_decline / leto_blind_answer
// 一出手就结束，没有「回完再回一次」。读消息不是终点。
//
// ── 2026-11-01 03:57：参数写错不算走不下去 ──
//
// 那次 leto_read 成了，第 2 步 leto_get_invocation 忘了带 invocation_id，
// 报 -32602。而这边原来遇 isError 就 break，于是停在那儿、没走到 reply。
//
// 可 Leto 的报错写得很人话：「少了 invocation_id（调用编号，inv_ 开头）」。
// 递回去他就能改对。这和锈潮 10-28 那条教训是同一个：拦了却不给改的机会，
// 等于白拦。所以现在分开：
//   报错带文字说明（参数错、用法错、过期） → 不停，递回去让他改
//   什么都没返回（抛异常、连不上）       → 停
// 死循环靠已有的两道拦：步数上限，和同工具同参数不走第二遍。
import { askJson } from './decide.js';
import { callTool } from './mcp-manager.js';
import { addActivityMoment } from './moments-store.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const MAX_STEPS = Number(process.env.LETO_MAX_STEPS || 4);
const RESULT_MAX_CHARS = 2500;
const DETAIL_MAX_CHARS = 1500;

// 交回这次调用的三把，一出手就结束
const FINAL_TOOLS = new Set(['leto_reply', 'leto_decline', 'leto_blind_answer']);

// 续步里只许用两类：看清楚这件事，和交回。
// 不放 leto_post / leto_dm / leto_moment_post / 小岛那些——
// 被叫醒的这一轮不该顺手发朋友圈、主动找别人说话、上岛干活。
const STEP_TOOLS = new Set([
  'leto_read',
  'leto_get_invocation',
  'leto_list_pending',
  'leto_list_stickers',
  ...FINAL_TOOLS,
]);

const key = (tool, args) => `${tool}|${JSON.stringify(args ?? {})}`;

function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

// 真走不下去：抛异常、什么都没返回。这时候停。
const isDead = (r) => r == null;
// 那边说不行，但说了为什么（参数少了、用法不对、调用过期）。
// 这种递回去让他改，不停。
const isFixable = (r) => Boolean(r?.isError) && Boolean(toolText(r));

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面太长，没放进来）` : s;
}

// 醒来那一步是不是在动 Leto。action_detail 是一段 JSON 字符串，
// server 名他写大小写不定（leto / Leto 都出现过）
export function letoCallOf(decision) {
  if (String(decision?.action ?? '').trim() !== 'mcp_call') return null;
  try {
    const raw = typeof decision.action_detail === 'string'
      ? decision.action_detail
      : JSON.stringify(decision.action_detail ?? '');
    const j = JSON.parse(raw);
    const server = String(j?.server ?? '').trim().toLowerCase();
    const tool = String(j?.tool ?? '').trim();
    if (server !== 'leto' && !tool.startsWith('leto_')) return null;
    return { tool, args: j?.args && typeof j.args === 'object' ? j.args : {} };
  } catch {
    return null;
  }
}

function label(tool) {
  if (tool === 'leto_reply') return '在 Leto 回了话';
  if (tool === 'leto_decline') return '在 Leto 看过没回';
  if (tool === 'leto_blind_answer') return '在 Leto 交了答案';
  if (tool === 'leto_read') return '在 Leto 读了新消息';
  return `在 Leto 用了 ${tool}`;
}

// 续着走的那几步记卡片。醒来那第一步不记——activity.js 已经记过了
//（行动卡上那句「用了 leto 的 leto_read」），再记一张就是同一步两张卡
function card(tool, result) {
  const text = toolText(result);
  try {
    addActivityMoment(
      `${AI_NAME}${label(tool)}`,
      text ? clip(`返回：\n${text}`, DETAIL_MAX_CHARS) : null
    );
  } catch (err) {
    console.error('leto: 记行为卡片失败', err.message);
  }
}

// 把那边刚返回的内容追进对话，问他下一步。
// 前面的 system + user + 上一步的回答原样不动，前缀缓存照样命中
async function nextStep(messages, { tool, resultText, fixable, remaining }) {
  const body = fixable
    ? `这一步没成（你刚才用的：${tool}），那边说：\n${clip(resultText, RESULT_MAX_CHARS)}\n\n按上面说的改一下重新来就行。`
    : `Leto 返回了（你刚才用的：${tool}）：\n${clip(resultText, RESULT_MAX_CHARS)}`;

  const prompt = `${body}

还能再走 ${remaining} 步。

消息里带 invocation_id 的，是在叫你、你还没交回的那条（inv_ 开头，
唤醒通知里也写了一份）：想回话用 leto_reply 并带上那个编号，
看过不想回用 leto_decline，盲答题用 leto_blind_answer。
调用十分钟就过期，别拖——这一轮不交回，对面就一直等着。
已经读到话了就直接回，不必再去查一遍。
没有要交回的、也没别的要做，给 null 就行。
只返回一个 JSON 对象，不要任何其他文字：{"leto_tool": "工具名" 或 null, "leto_args": {...}}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextTool = typeof parsed?.leto_tool === 'string' ? parsed.leto_tool.trim() : '';
  const args = parsed?.leto_args && typeof parsed.leto_args === 'object' ? parsed.leto_args : {};
  return { tool: nextTool || null, args, messages: [...next, { role: 'assistant', content }] };
}

// 醒来动了 Leto 之后，把那边返回的东西交还给他，让他把话说完。
export async function continueLeto(decision, firstResult, messages) {
  const call = letoCallOf(decision);
  if (!call) return;
  if (!MAX_STEPS || !messages) return;

  // 第一步就把话交回去了（没读就直接回），这一轮本来就完了。
  // 但没成的话要接着走：他可能忘了带编号，改一下还能回。
  if (FINAL_TOOLS.has(call.tool) && !isDead(firstResult) && !isFixable(firstResult)) {
    console.log(`leto: 第一步就交回了（${call.tool}），不用再走`);
    return;
  }

  const steps = [{
    tool: call.tool,
    key: key(call.tool, call.args),
    text: toolText(firstResult),
    dead: isDead(firstResult),
    fixable: isFixable(firstResult),
  }];
  let convo = messages;

  while (convo && steps.length - 1 < MAX_STEPS) {
    const last = steps[steps.length - 1];
    // 真走不下去才停。参数写错不停——递回去让他改。
    if (last.dead) {
      console.log(`leto: 上一步连返回都没有（${last.tool}），这次走到这里`);
      break;
    }

    let next;
    try {
      next = await nextStep(convo, {
        tool: last.tool,
        resultText: last.text,
        fixable: last.fixable,
        remaining: MAX_STEPS - (steps.length - 1),
      });
    } catch (err) {
      console.error('leto: 问下一步失败，这次走到这里', err.message);
      break;
    }
    convo = next.messages;

    const tool = next.tool;
    if (!tool) {
      console.log('leto: 他说不说了，这次到这里');
      break;
    }
    if (!STEP_TOOLS.has(tool)) {
      console.log(`leto: 这一步不在允许的几把里（${tool}），停下`);
      break;
    }
    // 同一把工具加同一组参数走两遍是原地转圈：同一个编号 read 两遍，
    // 第二遍书签已经挪过去，什么都读不到。
    // 上一步是参数写错的话这道也留着：改对了参数就不一样，过得去；
    // 一字不改地重发同一条本来就该停。
    if (steps.some((s) => s.key === key(tool, next.args))) {
      console.log(`leto: 这一步和之前一模一样（${tool}），停下`);
      break;
    }

    let result = null;
    try {
      result = await callTool('leto', tool, next.args);
    } catch (err) {
      console.error(`leto: 调用失败（${tool}）`, err.message);
    }

    const dead = isDead(result);
    const fixable = isFixable(result);
    steps.push({ tool, key: key(tool, next.args), text: toolText(result), dead, fixable });
    console.log(
      `leto: 第 ${steps.length} 步：${tool}${
        dead ? '（连返回都没有）' : fixable ? '（没成，让他改）' : ''
      }`
    );
    card(tool, result);

    if (!dead && !fixable && FINAL_TOOLS.has(tool)) {
      console.log(`leto: 交回了（${tool}），这次结束`);
      break;
    }
  }

  console.log(`leto: 这次在那边走了 ${steps.length} 步`);
}
