// 钱包连着走几步。和论坛（phosphor.js 的 continueForum）、听歌（continueMusic）同一个规矩：
// 「看」的动作做完可以接着走，「写」的做完这次就结束。
//
// 单独一个文件，是为了别再往 phosphor.js 和 decide.js 里塞整段——那两边已经各有两支续步逻辑了。
// 只从 decide.js 借一个 askJson（带重试和 JSON 容错的请求）。
//
// 行为卡片不在这里记：三个动作自己会写（见 actions/wallet.js），这边再记一遍就重了。
//
// 停下来的情况：TA 给了 null、记了批注、走满 WALLET_MAX_STEPS、
// 出错、给了不存在的动作名，或者重复了同一个「动作＋参数」。

import { askJson } from './decide.js';
import { runWalletStep, WALLET_READ_ACTIONS, WALLET_WRITE_ACTIONS } from './actions/wallet.js';
import { WALLET_MAX_STEPS, WAKE_LEDGER_LIMIT, MAX_NOTE_CHARS } from './wallet.js';

// 账本返回的内容最多带多少字给模型看。翻一整天的账加上批注可能很长
const RESULT_MAX_CHARS = 3000;

const isErr = (r) => r == null || Boolean(r?.isError);
const keyOf = (action, args) => `${action}|${JSON.stringify(args ?? {})}`;

function clip(value) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > RESULT_MAX_CHARS
    ? `${chars.slice(0, RESULT_MAX_CHARS).join('')}\n…（后面太长，没放进来）`
    : s;
}

// 把账本刚返回的内容追加进对话，问 TA 下一步做什么。
// 和 decide.js 里的 forumNextStep / musicNextStep 是同一个形状：
// 前面的 system + user + 上一步的回答原样不动，所以前缀缓存照样命中。
export async function walletNextStep(messages, { action, resultText, isError, remaining }) {
  const body = isError
    ? `钱包这次出错了（你刚才用的：${action}）：\n${clip(resultText)}`
    : `账本返回了（你刚才用的：${action}）：\n${clip(resultText)}`;
  const prompt = `${body}

这次醒来你还可以在钱包里再走 ${remaining} 步，比如：
- 想看某一天的账：wallet_ledger {"date":"2026-10-06"}
- 想翻翻你们在账旁边写过什么：wallet_ledger {"notes":true}
- 想再看一眼余额：wallet_balance
- 有话想记在某一笔旁边：wallet_note {"entry_id":12,"note":"…"}（${MAX_NOTE_CHARS} 字以内）
翻账本不填参数就是最近 ${WAKE_LEDGER_LIMIT} 笔。entry_id 用账本里那个 #号，别自己编。
记了批注之后，这次看账就结束了。看完不想再做什么就给 null，这是正常的；不用为了凑一笔而写。
只返回一个 JSON 对象，不要任何其他文字：{"wallet_action": "动作名" 或 null, "wallet_args": {…}}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextAction = typeof parsed?.wallet_action === 'string' ? parsed.wallet_action.trim() : '';
  const args = parsed?.wallet_args && typeof parsed.wallet_args === 'object' ? parsed.wallet_args : {};
  return { action: nextAction || null, args, messages: [...next, { role: 'assistant', content }] };
}

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
