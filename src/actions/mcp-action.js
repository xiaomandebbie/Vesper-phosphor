import { callTool } from '../mcp-manager.js';

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
  const blocked = letoReadBlocked(server, tool, args);
  if (blocked) {
    console.log('mcpAction(): leto_read 空参，这次没调用');
    return { isError: true, content: [{ type: 'text', text: blocked }] };
  }
  return callTool(server, tool, args || {});
}
