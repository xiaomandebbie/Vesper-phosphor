// 一次醒来里「做事」这一段：按级别筛一遍，按顺序做，每件做完该接着走的就走。
//
// ── 为什么把它从 phosphor.js 里抬出来 ──
//
// 原来 runDecisionCycle 里是这么排的：一句 executeAction，紧跟几个形状一模一样的
//   if (decision && !errorMessage) { ... continueForum ... }
// 每接一个新东西就往下再抄一个。现在有六支（论坛、听歌、上班、花园、
// 锈潮、读书），而且一次醒来不再是只做一件事——再堆在那边就是六个 if
// 嵌一个循环。所以收到这里。
//
// 顺带解决一个真实的隐患：服务器上那份 phosphor.js 是一层层 wire 脚本打出来的，
// 和仓库里那份不完全一样（见 5a4c679：decide.js 是从 .bak 恢复的）。
// 把续步分发收在这一个文件里，接线脚本就只需要改 phosphor.js 一处。
//
// ── 续步函数由外面注册进来，这边不自己找 ──
//
// 第一版这里写的是动态 import 各个 *-steps.js。那是错的：服务器上
// phosphor.js 里已经有 continueWorkkk / continueGarden 的调用块，两边都跑
// 就是上班连走两轮（而上班那边结算过之后再走就是游戏里的第二天）。
// 现在改成只认 registerContinuers 注册进来的：哪几支在这台机器上真的接了，
// 由接线脚本说了算，一件事只走一遍。

import { executeAction } from './actions/index.js';
import { pickActions, tier2KindOf, recordTier2, TIER2_KINDS } from './budget.js';

let continuers = [];

// phosphor.js 启动时调一次，把这台机器上真正接了的续步函数全交过来。
// 每个函数的形状都是 (decision, result, messages)，不该它续的它自己会立即 return。
export function registerContinuers(list) {
  continuers = Array.isArray(list) ? list.filter((f) => typeof f === 'function') : [];
}

async function runContinuers(decision, result, messages) {
  for (const fn of continuers) {
    try {
      await fn(decision, result, messages);
    } catch (err) {
      console.error(`run-actions: ${fn.name || '续步'} 出错（不影响其他）`, err.message);
    }
  }
}

// 做完这一次该做的事。
// 返回 { results, dropped }。results 每项带 action / action_detail / result，
// logWake 和共享时间线那边要用 action_detail 重建一个 decision 形状。
export async function runActions(decision, messages, { kind = 'non_precise' } = {}) {
  // 只给了单个 action 的老形状也认：模型有时候不写 actions 数组
  const list =
    Array.isArray(decision?.actions) && decision.actions.length
      ? decision.actions
      : [{ action: decision?.action, action_detail: decision?.action_detail }];

  const { allowed, dropped } = pickActions(list);
  for (const d of dropped) console.log(`[${kind}] 没做：${d.action}——${d.why}`);

  const results = [];
  for (const item of allowed) {
    // 每件事自己一个 decision 形状：executeAction 和所有 continueXxx 都按
    // { action, action_detail, mood } 这三个字段认事，给全了就不用改它们
    const one = { ...decision, action: item.action, action_detail: item.action_detail };

    if (item.action === 'noop') {
      results.push({ action: item.action, action_detail: item.action_detail, result: null });
      continue;
    }

    let result = null;
    try {
      result = await executeAction(one);
      console.log(`[${kind}] ${item.action}（${item.tier} 级）：`, JSON.stringify(result));
    } catch (err) {
      console.error(`[${kind}] ${item.action} 没做成：`, err.message);
      results.push({ action: item.action, action_detail: item.action_detail, result: null, error: err.message });
      continue;
    }

    // 2 级记一笔。记在这里（真正开跑了的那一刻），而不是模型说要做的时候；
    // 后面 continueXxx 里接着走的那几步不再记——一件事只算一次
    const kind2 = tier2KindOf(item.action, item.action_detail);
    if (kind2 && !result?.isError) {
      try {
        recordTier2(kind2);
        console.log(`[${kind}] 记上一次 2 级：${TIER2_KINDS[kind2]}`);
      } catch (err) {
        console.error('run-actions: 2 级记账失败（不影响这次）', err.message);
      }
    }

    await runContinuers(one, result, messages);
    results.push({ action: item.action, action_detail: item.action_detail, result });
  }

  return { results, dropped };
}
