// 推送给她的东西分两路走：
//   1) 正文投进 Aru 的对话（wake-bridge，见 ./wake-bridge.js）——消息留在那儿，能翻回去看；
//   2) Bark 只负责"叮"一声，标题和正文固定，不再搬运内容。
// 没配 wake-bridge 时退回老做法：Bark 直接带正文，至少不会漏掉。
//
// 返回 { ok, message, delivered }，phosphor 据此判断推送有没有真的发出去，
// 发出去了才写进共享时间线（见 timeline.js）。delivered 表示正文有没有落进对话。
import { isWakeBridgeEnabled, submitWakeEvent } from './wake-bridge.js';

// 通知的标题要留着：手机上靠它一眼认出来是谁发的。
// 用 || 而不是 ??：.env 里写成空值时也回退到默认，免得标题悄悄没了。
const BARK_TITLE = (process.env.BARK_TITLE || '允朔').trim();
const BARK_BODY = (process.env.BARK_BODY || '一条新消息送达～').trim();
const BARK_ICON = (process.env.BARK_ICON || '').trim();

// 模型习惯在正文开头署名（"允朔｜……"，以前还有"来自AI｜……"）。
// 这段话现在会变成对话里的一条消息，署名就成了多余的一截，统一在这里剥掉。
// 只认竖线分隔，不动"老婆，……"这种正常开头。
// 注意：剥的是投进对话的正文，通知上的标题是另一回事，不受影响。
function stripNamePrefix(text) {
  return String(text ?? '')
    .replace(/^\s*[^\n｜|]{1,12}[｜|]\s*/, '')
    .trim();
}

export default async function bark(detail) {
  const message = stripNamePrefix(detail) || '嗨，我醒了';

  // 先投对话。投失败不影响下面那声通知，两件事各报各的错。
  let delivered = { ok: false, reason: 'WAKE_BUNDLE_FILE not set' };
  if (isWakeBridgeEnabled()) {
    delivered = await submitWakeEvent(message);
    if (delivered.ok) console.log(`bark(): 正文已投进 Aru 对话 ${delivered.eventId}`);
    else console.error(`bark(): 正文没能投进 Aru 对话：${delivered.reason}`);
  }

  const key = process.env.BARK_KEY;
  if (!key) {
    console.warn('bark(): BARK_KEY not set, skipping notification');
    return { ok: false, reason: 'BARK_KEY not set' };
  }

  // 正文已经落进对话了，通知就只报个信；没落进去时还是把正文带上，不然她什么都看不到
  let segments = delivered.ok ? [BARK_TITLE, BARK_BODY].filter(Boolean) : [message];
  if (!segments.length) segments = ['一条新消息送达～'];
  const path = segments.map((s) => encodeURIComponent(s)).join('/');
  const icon = BARK_ICON ? `?icon=${encodeURIComponent(BARK_ICON)}` : '';
  const url = `https://api.day.app/${key}/${path}${icon}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error('bark(): push failed', res.status);
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true, message, delivered: delivered.ok };
  } catch (err) {
    console.error('bark(): push failed', err.message);
    return { ok: false, reason: err.message };
  }
}
