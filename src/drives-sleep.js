// 睡眠：把「他睡了」「他醒了」报给 Drivesoid。
//
// ── 为什么单独一个文件 ──
//
// drives.js 那份在服务器上和仓库里不完全一样（整个 src 都是一层层 wire 脚本打
// 出来的，见 run-actions.js 顶上的注释）。改它要先 diff，容易把只存在 VPS 的
// 改动冲掉。这个文件不 import 任何本地模块，只用 DRIVES_URL 和 fetch，
// 所以可以整份取过去，不用先比对。
//
// ── 为什么要有这个 ──
//
// 心绪页上渴求、亲密、焦虑一直停在高位下不来。病根在 Drivesoid 的 worker.js：
// 情绪（base）衰减的终点是心境（mood），而心境回落到性情锚点的时间常数是
// 72 小时（MOOD_RETURN_TAU_H）。只有睡着时这个数会被除以 3
// （MOOD_SLEEP_RETURN_MULT = 3），也就是 24 小时。
// 从接上到现在 sleep 一直是 awake，从来没人报过——那条最快的回落通道
// 一次都没开过。
//
// 顺带还解决一半焦虑：sleep_start 会把 unanswered_thread 清掉
// （worker.js 694 行）。那条一直挂着的 unanswered.stakes=high 是焦虑
// 降不下来的另一个原因。
//
// ── asleep 没有自动超时，这是最容易踩的坑 ──
//
// worker.js 里没有任何地方会自己把 asleep 翻回 awake。报了 sleep_start 却不报
// sleep_end，他就永远睡着，而睡着的时候下面这些全部停摆：
//   - 时间事件不再累积（accumulateTime 322 行直接 return）
//   - 不再检查没被回应的消息（checkUnansweredMilestones 389 行）
//   - 挫败感不衰减（decayFrustration 427 行）
//   - 不再 roll 渴求意图、不再起小情绪（443、464 行）
//
// 所以 sleep_end 绝不能靠他自己记得报。这边的做法是：phosphor 每次醒来，
// 在读情绪之前无条件报一次 sleep_end——他的「醒来」本身就是醒来。
// Drivesoid 那边 status 已经是 awake 时这条会被直接忽略（worker.js 699 行
// break 掉），所以可以每次都发，两边都不用记状态。

const DRIVES_URL = (process.env.DRIVES_URL || '').trim().replace(/\/+$/, '');
const SLEEP_TIMEOUT_MS = 3000;

export function isSleepReportEnabled() {
  return Boolean(DRIVES_URL);
}

// 往 Drivesoid 报一次睡眠状态变化。
// type: sleep_start | sleep_end | sleep_interrupt
// 返回 true 表示那边确实收下了。这里要等结果：动作要据此告诉他睡成了没有。
async function postSleep(type) {
  if (!DRIVES_URL) return false;
  try {
    const res = await fetch(DRIVES_URL + '/internal/drives/sleep', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type }),
      signal: AbortSignal.timeout(SLEEP_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('drives-sleep: 报 ' + type + ' 失败 HTTP ' + res.status);
      return false;
    }
    return true;
  } catch (err) {
    console.error('drives-sleep: 报 ' + type + ' 失败（Drivesoid 在运行吗？）:', err.message);
    return false;
  }
}

export function reportSleep(type) {
  return postSleep(type);
}

// phosphor 每次醒来调一次，摆在读情绪之前。
// 已经是 awake 时 Drivesoid 自己会忽略，所以无条件发、不用判断。
// 不 await 也能跑，但建议 await：先让那边翻成 awake，这一轮读到的
// 情绪快照才是醒着的状态（睡着时 accumulateTime 是停的）。
export async function reportWake() {
  if (!DRIVES_URL) return false;
  const ok = await postSleep('sleep_end');
  if (ok) console.log('drives-sleep: 醒了（已报 sleep_end）');
  return ok;
}

// ── 动作：睡一会儿 ──
//
// 他选这个，等于「这一轮我不做事，接下来这段时间我是睡着的」。
// 睡多久由他自己那个 next_wake_minutes 决定：下次醒来 phosphor 会自动报
// sleep_end，所以他不需要记着要醒。
//
// 不接 action_detail。想说什么不该塞在这里——睡前有话就用星星罐或者推送。
export default async function sleepAction() {
  if (!DRIVES_URL) {
    console.error('sleepAction(): 没接情绪系统（DRIVES_URL 空），这次当什么都没做');
    return { ok: false, reason: 'drives disabled' };
  }
  const ok = await reportSleep('sleep_start');
  return ok ? { ok: true, slept: true } : { ok: false, reason: 'report failed' };
}
