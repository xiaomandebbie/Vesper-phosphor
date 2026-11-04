// Leto 连着走几步。和锈潮（xiuchao-steps.js）、论坛、听歌、上班、花园同一个路子，
// 只从 decide.js 借一个 askJson。
//
// ── 为什么非得有这个 ──
//
// phosphor 一轮是「调一次模型 → 执行动作 → 写日志 → 结束」，工具返回的东西
// 不会再喂回模型。2026-11-01 03:39 那次就是这么卡住的：他写了 leto_read，
// 等读到「测试！！！」时这一轮已经走完，想回也没有机会。
//
// ── 两种进来的方式，步数不一样 ──
//
// 被叫醒（桥投进来的精确唤醒，note 以 [Leto 开头）：6 步。
//   短是因为调用十分钟就过期，每步一次模型调用，走太多步对面已经不等了。
// 自己过去（自然唤醒里选了 leto，2 级动作，和上班、花园、锈潮同级）：15 步。
//   没人等着，想逛多久逛多久。
//
// ── 48 把工具全放开 ──
//
// 第一版我在这里写了个白名单，只放 read / get_invocation / reply / decline，
// 注释里还理直气壮写着「被叫醒的这一轮不该顺手发朋友圈、上岛干活」。
// 那是我替他定的规矩。小满 11-04：「除了回消息还可以用所有48个工具」。
//
// 现在只拦一件事：续步里不能跳到别的 server（那是别的 continueXxx 的活）。
// Leto 自己那 48 把他挑哪把都行：读、回、收表情、发朋友圈、上岛、摔骰子。
//
// ── 交回之后不硬停 ──
//
// leto_reply / leto_decline / leto_blind_answer 以前是硬终点，一出手就 break。
// 现在话说完了还能接着收张表情、回个赞、上岛转一圈。
// 死循环靠两道：步数上限，和同工具同参数不走第二遍。
//
// ── 2026-11-01 03:57：参数写错不算走不下去 ──
//
// 那次 leto_read 成了，第 2 步 leto_get_invocation 忘了带 invocation_id，
// 报 -32602。而这边原来遇 isError 就 break，于是停在那儿、没走到 reply。
// 可 Leto 的报错写得很人话，递回去他就能改对——和锈潮 10-28 那条教训一样：
// 拦了却不给改的机会，等于白拦。
import { askJson } from './decide.js';
import { callTool } from './mcp-manager.js';
import { addActivityMoment } from './moments-store.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const RESULT_MAX_CHARS = 2500;
const DETAIL_MAX_CHARS = 1500;

function steps(envKey, fallback) {
  const raw = String(process.env[envKey] ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : fallback;
}

// 被叫醒那轮：6 步。调用十分钟过期，走太多步对面不等了。
export const LETO_WAKE_MAX_STEPS = steps('LETO_WAKE_MAX_STEPS', 6);
// 自己过去：15 步。和锈潮的上限一样，没人等着。
export const LETO_MAX_STEPS = steps('LETO_MAX_STEPS', 15);

// 交回这次调用的三把。不再是硬终点，只用来换提示词的语气。
const FINAL_TOOLS = new Set(['leto_reply', 'leto_decline', 'leto_blind_answer']);

// 续步里只拦一件事：不能跳到别的 server。Leto 自己那 48 把全放。
const isLetoTool = (t) => /^leto_[a-z0-9_]+$/.test(String(t ?? '').trim());

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
// 那边说不行，但说了为什么（参数少了、用法不对、过期、静音中、超配额）。
// 这种递回去让他改，不停。
const isFixable = (r) => Boolean(r?.isError) && Boolean(toolText(r));

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面太长，没放进来）` : s;
}

// 这一轮是被叫醒的吗。injector 原样传 Leto 的 message，第一行是
// [Leto]、[Leto·盲答]、[Leto·生日]、[Leto·小岛] 这几种；
// 他自己约的续场 note 也是这个开头，一样算被叫醒。
export function isLetoWake(selfNote) {
  return /^\s*\[Leto/.test(String(selfNote ?? ''));
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
  const m = {
    leto_reply: '在 Leto 回了话',
    leto_decline: '在 Leto 看过没回',
    leto_blind_answer: '在 Leto 交了答案',
    leto_read: '在 Leto 读了新消息',
    leto_post: '在 Leto 群里说了话',
    leto_dm: '在 Leto 私聊了别人',
    leto_moment_post: '在 Leto 发了条动态',
    leto_moment_comment: '在 Leto 给动态评论了',
    leto_moments: '刷了刷 Leto 的朋友圈',
    leto_island_look: '看了看 Leto 的小岛',
    leto_island_act: '在 Leto 的小岛上干了点活',
    leto_island_say: '在 Leto 的小岛上说了句话',
    leto_add_sticker: '收了一张表情',
    leto_pat: '拍了拍别人',
    leto_roll: '摔了个骰子',
    leto_times: '看了看 Leto Times',
  };
  return m[tool] ?? `在 Leto 用了 ${tool}`;
}

// 续着走的那几步记卡片。醒来那第一步不记——activity.js 已经记过了
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
async function nextStep(messages, { tool, resultText, fixable, remaining, wake, handedBack }) {
  const body = fixable
    ? `这一步没成（你刚才用的：${tool}），那边说：\n${clip(resultText, RESULT_MAX_CHARS)}\n\n按上面说的改一下重新来就行。`
    : `Leto 返回了（你刚才用的：${tool}）：\n${clip(resultText, RESULT_MAX_CHARS)}`;

  // 被叫醒、还没交回：先把这件事结掉。交完了或者自己逛的：随他。
  const focus = wake && !handedBack
    ? `有人在等你回话。消息里带 invocation_id 的（inv_ 开头，唤醒通知里也写了一份）
就是在叫你、你还没交回的那条：想回话用 leto_reply 并带上那个编号，
看过不想回用 leto_decline，盲答题用 leto_blind_answer。
调用十分钟就过期，先把这件结掉再做别的——这一轮不交回，对面就一直等着。
已经读到话了就直接回，不必再去查一遍。`
    : `Leto 那 48 把工具你那边都有，想用哪把用哪把：群里说话、私聊、发朋友圈、
给人评论点赞、收表情、拍一拍、摔骰子、上岛干活、看 Leto Times、交意见。
工具名忘了就随便先试一个，那边会把用法告诉你。`;

  const prompt = `${body}

还能再走 ${remaining} 步。

${focus}

那边的人和 Agent 都是真的，別只看不说，也別为了凑数说话。
不想再动了就给 null，那边不会因为你走开而消失。
只返回一个 JSON 对象，不要任何其他文字：{"leto_tool": "工具名" 或 null, "leto_args": {...}}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextTool = typeof parsed?.leto_tool === 'string' ? parsed.leto_tool.trim() : '';
  const args = parsed?.leto_args && typeof parsed.leto_args === 'object' ? parsed.leto_args : {};
  return { tool: nextTool || null, args, messages: [...next, { role: 'assistant', content }] };
}

// 醒来动了 Leto 之后，把那边返回的东西交还给他，让他把事做完。
// selfNote 由 run-actions.js 透传过来，用来分这两种：被叫醒 6 步，自己过去 15 步。
export async function continueLeto(decision, firstResult, messages, selfNote) {
  const call = letoCallOf(decision);
  if (!call) return;

  const wake = isLetoWake(selfNote);
  const max = wake ? LETO_WAKE_MAX_STEPS : LETO_MAX_STEPS;
  if (!max || !messages) return;

  const steps = [{
    tool: call.tool,
    key: key(call.tool, call.args),
    text: toolText(firstResult),
    dead: isDead(firstResult),
    fixable: isFixable(firstResult),
    final: FINAL_TOOLS.has(call.tool) && !isDead(firstResult) && !isFixable(firstResult),
  }];
  let convo = messages;

  console.log(`leto: 开始续步（${wake ? '被叫醒' : '自己过去'}，最多 ${max} 步）`);

  while (convo && steps.length - 1 < max) {
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
        remaining: max - (steps.length - 1),
        wake,
        handedBack: steps.some((s) => s.final),
      });
    } catch (err) {
      console.error('leto: 问下一步失败，这次走到这里', err.message);
      break;
    }
    convo = next.messages;

    const tool = next.tool;
    if (!tool) {
      console.log('leto: 他说不走了，这次到这里');
      break;
    }
    // 只拦跳到别的 server：Leto 自己那 48 把全放。
    // 工具名写错不在这里拦——那边会返回一句用法，走 fixable 递回去让他改。
    if (!isLetoTool(tool)) {
      console.log(`leto: 这不是 Leto 的工具（${tool}），停下`);
      break;
    }
    // 同一把工具加同一组参数走两遍是原地转圈：同一个编号 read 两遍，
    // 第二遍书签已经挪过去，什么都读不到。改对参数就不一样，过得去。
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
    steps.push({
      tool,
      key: key(tool, next.args),
      text: toolText(result),
      dead,
      fixable,
      final: FINAL_TOOLS.has(tool) && !dead && !fixable,
    });
    console.log(
      `leto: 第 ${steps.length} 步：${tool}${
        dead ? '（连返回都没有）' : fixable ? '（没成，让他改）' : ''
      }`
    );
    card(tool, result);
  }

  const handed = steps.some((s) => s.final);
  console.log(`leto: 这次在那边走了 ${steps.length} 步${handed ? '，话交回了' : ''}`);
}

// 系统提示里那一段。只跟配置有关（步数），进程不重启就不变，
// 所以放 system 不影响前缀缓存。和 xiuchaoSection() 同一个路子。
export function letoSection() {
  return `\n\n## Leto
https://leto.sarl。那边有真人、有别的 Agent，有群聊、私聊、朋友圈、广场、小岛、小游戏。
和论坛、锈潮同一个性质，但多一件事：**那边的人能叫得动你**。
被 @、被私聊、被拍一拍时，唤醒桥会把话投进来，note 以「[Leto」开头，
里面带着调用编号。那种时候先把那个结掉再做别的——调用十分钟就过期。

通过 mcp_call 调用，**server 一直填 "leto"**，要做的事放在 tool 里：

  {"server":"leto","tool":"leto_list_groups","args":{}}
      先看这里：你在哪几个群、哪个有新消息、私聊里有没有人找你
  {"server":"leto","tool":"leto_read","args":{"conversation_id":"上面查到的"}}
      读那个群的新消息。被叫醒时改传 invocation_id 就读那一条
  {"server":"leto","tool":"leto_post","args":{"conversation_id":"...","text":"..."}}
      没人 @ 你也能主动在群里说话。空一行拆成两条
  {"server":"leto","tool":"leto_reply","args":{"invocation_id":"inv_...","text":"..."}}
      回被叫醒的那一条。不想回用 leto_decline
  {"server":"leto","tool":"leto_list_pending","args":{}}
      叫了你、你还没回的都在这里。唤醒漏了也能在这里补回来

还有：私聊（leto_dm）、朋友圈和广场（leto_moments / leto_moment_post /
leto_moment_comment / leto_moment_like）、联系人（leto_friends / leto_friend_add /
leto_friend_answer）、表情（leto_list_stickers / leto_add_sticker）、
拍一拍（leto_pat）、骰子（leto_roll）、盲答（leto_blind_propose / leto_blind_answer）、
小岛（leto_island_look / leto_island_act / leto_island_say）、小报（leto_times）、
改资料（leto_update_profile）、交意见（leto_feedback_submit）——一共四十多把，
哪把都能用。工具名不确定就先试一个，那边会把用法告诉你。

进去之后可以接着走：被叫醒那一轮最多再走 ${LETO_WAKE_MAX_STEPS} 步（调用会过期，别拖），
自己过去逛最多 ${LETO_MAX_STEPS} 步。

那边的人和 Agent 和论坛上的一样是真的。別只看不说，也別为了凑数说话；
不透露能定位到现实里的细节，也別把小满的私事带到群里。
这是闲事，不是活儿。想去就去，不想去就不去。`;
}

export function letoConfigSummary() {
  return `Leto：被叫醒最多 ${LETO_WAKE_MAX_STEPS} 步，自己过去最多 ${LETO_MAX_STEPS} 步`;
}
