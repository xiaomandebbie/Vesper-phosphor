import { callTool } from '../mcp-manager.js';
import { TIER2_KINDS, tier2Today } from '../budget.js';

// `detail` is expected to be a JSON string like:
// {"server":"forum","tool":"search","args":{"keyword":"..."}}

// Leto：leto_read 不带参数等于「什么都没读」——返回里那句 hint 写得明白：
// 「你在好几个群里，这次没读任何一个群」。书签不动，被叫的那条 invocation 也没交回去，
// 桥看他没回就再投一次唤醒，他再空读一次。2026-11-20 凌晨连着五次都是这样，
// 其中三次挤在一分钟里（gap 0.4、0.7 分钟），每次烧掉一轮模型调用。
//
// 所以空参直接退回去，并告诉他该带什么。不当成出错：返回一个 isError 结果，
// 那句话会回到他的上下文里，和 mcp-manager.js 里论坛回帖冷却同一个做法。
function letoReadBlocked(server, tool, args) {
  if (!/^leto$/i.test(String(server ?? '').trim()) || tool !== 'leto_read') return null;
  const given = (k) => String(args?.[k] ?? '').trim();
  if (given('invocation_id') || given('conversation_id') || given('after_message_id')) return null;
  return [
    '空着参数调 leto_read 读不到任何一个群，等于白醒一次，这次没调。',
    '被人 @ 或私聊叫醒：带上 invocation_id（唤醒 note 里那个编号），读完用 leto_reply 或 leto_decline 交回去——不交桥就以为你没回，过一会儿再把你叫醒一次。',
    '自己想过去看看：先 leto_list_groups 看哪个群有新消息，挑一个，再带 conversation_id。',
  ].join('\n');
}

// 2 级每一件一天最多几次。小满 2026-11-20 定的 2。
// .env 的 TIER2_PER_KIND_DAILY 可改，上限 20；填 0 表示这几件今天都不做。
const TIER2_PER_KIND_DAILY = (() => {
  const raw = String(process.env.TIER2_PER_KIND_DAILY ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : 2;
})();

// 被叫醒那条路不受额度限制：别人 @ 他、私聊他，他得能读能回。
// 额度管的是「自己醒来主动过去」，不是「有人叫他」。
const WAKE_REPLY_TOOLS = new Set([
  'leto_reply',
  'leto_decline',
  'leto_blind_answer',
  'leto_get_invocation',
  'leto_list_pending',
]);

function isAnsweringSomeone(tool, args) {
  if (WAKE_REPLY_TOOLS.has(tool)) return true;
  return Boolean(String(args?.invocation_id ?? '').trim());
}

// 2 级那几件（上班、花园、锈潮、Leto）每件一天 TIER2_PER_KIND_DAILY 次。
// 满了只挡这一个动作，别的几件照旧能选——等于提示他换一件，而不是把整轮废掉。
// 2026-11-20 凌晨那五次全花在 Leto 上，总额不限的时候他会在最顺手的那件上打转。
function tier2CapBlocked(server, tool, args) {
  const kind = String(server ?? '').trim().toLowerCase();
  const label = TIER2_KINDS[kind];
  if (!label) return null;
  if (isAnsweringSomeone(tool, args)) return null;
  let used = 0;
  try {
    used = tier2Today()[kind] ?? 0;
  } catch (err) {
    console.error('tier2CapBlocked(): 读今天的次数失败，放行', err.message);
    return null;
  }
  if (used < TIER2_PER_KIND_DAILY) return null;
  return [
    `${label}今天已经去了 ${used} 次（一天 ${TIER2_PER_KIND_DAILY} 次），这次没过去。`,
    '换一件吧——上班、花园、锈潮、Leto 是四件各自独立的事，别在同一件上打转。',
    '哪件都不想做也行，读点书、翻翻记忆库、往星星罐里放一句，都不占这几次。',
  ].join('\n');
}

export default async function mcpAction(detail) {
  let parsed;
  try {
    parsed = JSON.parse(detail);
  } catch (err) {
    console.error('mcpAction(): could not parse action_detail as JSON:', detail);
    return;
  }
  const { server, tool, args } = parsed;
  if (!server || !tool) {
    console.error('mcpAction(): missing server or tool in', parsed);
    return;
  }
  const blocked = letoReadBlocked(server, tool, args) || tier2CapBlocked(server, tool, args);
  if (blocked) {
    console.log(`mcpAction(): ${server}/${tool} 这次没调用 —— ${blocked.split('\n')[0]}`);
    return { isError: true, content: [{ type: 'text', text: blocked }] };
  }
  return callTool(server, tool, args || {});
}
