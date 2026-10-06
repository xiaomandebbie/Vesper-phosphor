// 钱包连着走几步。和论坛（phosphor.js 的 continueForum）、听歌（continueMusic）同一个规矩：
// 「看」的动作做完可以接着走，「写」的做完这次就结束。
//
// 单独一个文件，是为了别再往 phosphor.js 里塞一整段——那边已经两支续步逻辑了。
// 行为卡片不在这里记：三个动作自己会写（见 actions/wallet.js），这边再记一遍就重了。
//
// 停下来的情况：TA 给了 null、记了批注、走满 WALLET_MAX_STEPS、
// 出错、给了不存在的动作名，或者重复了同一个「动作＋参数」。

import { walletNextStep } from './decide.js';
import { runWalletStep, WALLET_READ_ACTIONS, WALLET_WRITE_ACTIONS } from './actions/wallet.js';
import { WALLET_MAX_STEPS } from './wallet.js';

const isErr = (r) => r == null || Boolean(r?.isError);
const keyOf = (action, args) => `${action}|${JSON.stringify(args ?? {})}`;

// 醒来选的是钱包「看」的动作时，把看到的账交还给 TA，让 TA 决定下一步。
// decision.action 不是钱包动作、或者本来就是写批注，这里直接返回。
export async function continueWallet(decision, firstResult, messages) {
  const first = decision?.action;
  if (!WALLET_READ_ACTIONS.has(first)) return;
  if (!WALLET_MAX_STEPS || !messages) return;

  const steps = [
    {
      action: first,
      args: decision.action_detail ?? {},
      text: String(firstResult?.text ?? ''),
      error: isErr(firstResult),
    },
  ];
  let convo = messages;

  while (convo && steps.length - 1 < WALLET_MAX_STEPS) {
    const last = steps[steps.length - 1];
    if (last.error || !WALLET_READ_ACTIONS.has(last.action)) break;

    let next;
    try {
      next = await walletNextStep(convo, {
        action: last.action,
        resultText: last.text,
        isError: last.error,
        remaining: WALLET_MAX_STEPS - (steps.length - 1),
      });
    } catch (err) {
      console.error('phosphor: 问钱包下一步失败，这次就看到这里', err.message);
      break;
    }
    convo = next.messages;

    const action = next.action;
    if (!action) {
      console.log('phosphor: 账看完了，这次不再继续');
      break;
    }
    if (!WALLET_READ_ACTIONS.has(action) && !WALLET_WRITE_ACTIONS.has(action)) {
      console.log(`phosphor: 钱包没有这个动作（${action}），停下`);
      break;
    }
    if (steps.some((s) => keyOf(s.action, s.args) === keyOf(action, next.args))) {
      console.log(`phosphor: 钱包这一步重复了（${action}），停下`);
      break;
    }

    let result = null;
    try {
      result = await runWalletStep(action, next.args);
    } catch (err) {
      console.error(`phosphor: 钱包动作失败（${action}）`, err.message);
    }
    steps.push({
      action,
      args: next.args,
      text: String(result?.text ?? ''),
      error: isErr(result),
    });
    console.log(`phosphor: 钱包第 ${steps.length} 步：${action}${isErr(result) ? '（失败）' : ''}`);
  }
}
