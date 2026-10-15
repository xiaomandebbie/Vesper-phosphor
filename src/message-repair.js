// 把客户端交上来的 messages 里「上游一定会报 400」的形状修掉。
//
// 为什么要有这东西（2026-10-15 晒夜踩的坑）：
//   上游要求 role=tool 的消息必须紧跟在一条带 tool_calls 的 assistant 消息后面。
//   记忆自动总结（或任何删消息的环节）把那条 assistant 压掉之后，tool 消息就孤立了，
//   于是整个请求 400。更麻烦的是：**这个坏序列已经存在对话历史里了**，
//   之后每一轮都带着它发上去，所以重启、换模型、关功能都没用，只能开新对话——
//   除非在转发前把它捡掉。
//
// **只做减法，不做加法。** 不补假的 tool_calls（伪造工具调用比丢掉结果更坏），
// 不重排、不合并、不改正文。没有前导的 tool 消息本身已经是死的，捡掉它不会多丢任何东西。

// 一条 assistant 消息算不算「发起过工具调用」。
// 兼容两种写法：OpenAI 的 tool_calls 数组，和更老的 function_call 单对象。
function hasToolCalls(m) {
  if (!m || m.role !== 'assistant') return false;
  if (Array.isArray(m.tool_calls) && m.tool_calls.length) return true;
  if (m.function_call && typeof m.function_call === 'object') return true;
  return false;
}

// 捡掉没有前导 tool_calls 的 tool 消息。
//
// 判据：从当前位置往前找，跳过连续的 tool 消息（一次并行调用会有好几条），
// 第一条非 tool 消息必须是带 tool_calls 的 assistant。不是就丢掉这条 tool。
//
// 返回 { messages, dropped }。dropped 为 0 时 messages 是原数组本身，不新建。
export function dropOrphanToolMessages(messages) {
  if (!Array.isArray(messages) || !messages.length) return { messages, dropped: 0 };

  // 先快速看一眼有没有 tool 消息，绝大多数轮次到这里就返回了
  if (!messages.some((m) => m?.role === 'tool')) return { messages, dropped: 0 };

  const keep = [];
  let dropped = 0;

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m?.role !== 'tool') {
      keep.push(m);
      continue;
    }
    // 往前找它的「发起人」——注意要在 keep 里找，不是在原数组里：
    // 前面那条 assistant 如果已经被丢掉，这条 tool 也跟着死。
    let j = keep.length - 1;
    while (j >= 0 && keep[j]?.role === 'tool') j--;
    if (j >= 0 && hasToolCalls(keep[j])) {
      keep.push(m);
    } else {
      dropped++;
    }
  }

  return dropped ? { messages: keep, dropped } : { messages, dropped: 0 };
}

// 网关每轮调这一个。出什么错都原样转发：修不了至少和改之前一样，
// 不能因为修复逻辑自己报错把整轮对话带崩。
export function repairMessages(messages) {
  try {
    const { messages: out, dropped } = dropOrphanToolMessages(messages);
    if (dropped) {
      console.warn(
        `gateway: 捡掉 ${dropped} 条没有前导 tool_calls 的 tool 消息（应该是记忆总结压掉了发起那条）`
      );
    }
    return out;
  } catch (err) {
    console.error('gateway: 消息序列没修成，原样转发', err.message);
    return messages;
  }
}
