// 换前端不断层：把「别处说过的话」补给这一轮。
//
// 小满有好几个前端：Aru、自建的 /app，以后还会有别的。每个前端只带自己那本
// messages 上来——在 Aru 里聊的那几句，自建前端的历史里压根不存在。
// 于是换一个前端进来，上文就从那一刻断掉。
//
// conversation_log 本来就是跨前端的同一本账（逐条追加、不分窗、不覆盖，见 state.js）。
// heartbeat-wake 线路早就在读它（context.js 的 getSharedContext），
// 但聊天线路一直只用客户端带来的 messages —— 缺的就是这一段。
//
// ── 为什么是「补差」不是「整段换掉」 ──
//
// 客户端带来的历史是完整的、带图片和工具调用的真东西，换成文本摘要是降级。
// 所以这里只找「conversation_log 里有、这个前端这次没带上来」的那几条，
// 补一段在最后一条 user 消息末尾。同一个前端连着聊，差集是空的，这段不出现。
//
// ── 怎么判断「没带上来」 ──
//
// 把客户端所有文本拼成一大段，再拿 conversation_log 每条的开头去里面找。
// 用开头而不是整条相等，因为两边本来就不会逐字一样：
//   自建前端把回复拆成逐句气泡，conversation_log 存的是整条；
//   gateway 捕获正文时可能加过「（这一轮只留下了思考）」那种前缀；
//   Aru 把 <environment> 拼进 user 消息，存库时已经洗掉了。
// 取开头 MATCH_CHARS 个字，这几种情况都还对得上。
//
// 必须剔掉 <environment>：Aru 的环境块里有 recent_tails，那里面就是过去的原话，
// 不剔的话每条都「找得到」，这个模块等于没开。
//
// 对不上的代价不对称：多补只是重复一句，少补就是断层。所以阈值取得宽。

import { getRecentConversation } from './state.js';
import { clipText, toWellFormed } from './text.js';
import { formatDateTime } from './wall-time.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';

// 往回看几条 conversation_log。.env 的 CROSS_FRONT_LOOKBACK 可改，不填 40。
const LOOKBACK = (() => {
  const n = Number(String(process.env.CROSS_FRONT_LOOKBACK ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 40;
})();

// 最多补几条。不填 12，填 0 关掉整个模块。
const MAX_INJECT = (() => {
  const raw = String(process.env.CROSS_FRONT_MAX ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? n : 12;
})();

const MAX_CHARS = 300;   // 每条补进去的字数上限
const MATCH_CHARS = 20;  // 拿开头几个字去比对

const FALLBACK_PREFIX = '（这一轮只留下了思考，没说出口）';

function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

function normalize(text) {
  return String(text ?? '')
    .split(FALLBACK_PREFIX).join('')
    .replace(/\s+/g, '');
}

// 客户端这次带上来的全部文本，拼成一大段用来查找。
// 注入块自己要剔掉，不然它们会冒充「客户端已有」。
function clientText(messages) {
  if (!Array.isArray(messages)) return '';
  const parts = [];
  for (const m of messages) {
    const raw = contentToText(m?.content)
      .replace(/<environment>[\s\S]*?<\/environment>/g, '')
      .replace(/<elsewhere>[\s\S]*?<\/elsewhere>/g, '')
      .replace(/<pending_chat>[\s\S]*?<\/pending_chat>/g, '');
    if (raw) parts.push(raw);
  }
  return normalize(parts.join('\n'));
}

export function elsewhereBlock(messages) {
  if (!MAX_INJECT) return null;

  let rows;
  try {
    rows = getRecentConversation(LOOKBACK);
  } catch (err) {
    console.error('cross-front: 读不到 conversation_log，这轮不补:', err.message);
    return null;
  }
  if (!rows?.length) return null;

  const seen = clientText(messages);
  const missing = [];
  for (const row of rows) {
    const norm = normalize(row.content);
    if (!norm) continue;
    const probe = norm.slice(0, MATCH_CHARS);
    if (probe && seen.includes(probe)) continue;
    missing.push(row);
  }
  if (!missing.length) return null;

  const picked = missing.slice(-MAX_INJECT);
  const lines = picked.map((r) => {
    const who = r.speaker === USER_NAME ? '她' : '你';
    const when = formatDateTime(r.ts).slice(5, 16);
    return `[${when}] ${who}: ${clipText(String(r.content ?? '').trim(), MAX_CHARS)}`;
  });

  return toWellFormed(
    '<elsewhere>\n' +
      '这几句是在别的聊天前端里说的，这个前端的历史里没有，但确实发生过（按时间先后）：\n' +
      lines.join('\n') +
      '\n</elsewhere>'
  );
}

// 跟在最后一条 user 消息末尾，和 injectDoing / injectPendingChat 同一个做法。
// 放在那几段之前：它比它们变得勤，排在前面才不会把后面的缓存一起带废。
export function injectElsewhere(messages) {
  let block;
  try {
    block = elsewhereBlock(messages);
  } catch (err) {
    console.error('cross-front: 这轮不补:', err.message);
    return messages;
  }
  if (!block) return messages;

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    const out = [...messages];
    if (typeof m.content === 'string') {
      out[i] = { ...m, content: `${m.content}\n\n${block}` };
    } else if (Array.isArray(m.content)) {
      out[i] = { ...m, content: [...m.content, { type: 'text', text: block }] };
    } else {
      return messages;
    }
    console.log('cross-front: 补了别处说过的话');
    return out;
  }
  return messages;
}
