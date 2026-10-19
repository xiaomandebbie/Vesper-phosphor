// 一次醒来里「做事」这一段：按级别筛一遍，按顺序做，每件做完该接着走的就走。
//
// ── 为什么把它从 phosphor.js 里抬出来 ──
//
// 原来 runDecisionCycle 里是这么排的：一句 executeAction，紧跟两个
//   if (decision && !errorMessage) { ... continueForum ... }
//   if (decision && !errorMessage) { ... continueMusic ... }
// 每接一个新东西就往下再抄一个同样的 if。现在有六支（论坛、听歌、
// 上班、花园、锈潮、读书），而且一次醒来不再是只做一件事——再堆在
// 那边就是六个 if 嵌一个循环。所以收到这里。
//
// 顺带解决一个真实的隐患：服务器上那份 phosphor.js 是一层层 wire 脚本打出来的，
// 和仓库里那份不完全一样（见 5a4c679 那条提交：decide.js 是从 .bak 恢复的）。
// 把续步分发收在这一个文件里，接线脚本就只需要改 phosphor.js 一处，
// 而不是在两份不同的文本里各找六个锚点。
//
// ── 续步模块用动态引入 ──
//
// workkk-steps.js / garden-steps.js 这几个是往后陆续接的，哪台机器上有哪几个
// 不一定。顶层 import 一个不存在的文件，phosphor 启动就是 SyntaxError，
// 整个唤醒跑不起来（fa75608 那条提交就是这么炸的）。所以这边用动态 import
// 加 try：没那个模块就只是这一支不续步，不拖累其他事。

import { executeAction } from './actions/index.js';
import { pickActions, tier2KindOf, recordTier2, TIER2_KINDS } from './budget.js';

// 哪些动作做完该问「还往下走吗」，以及去哪个模块找那个函数。
// 条件判定在各自的 continueXxx 里面（不是它该续的就直接 return），
// 所以这边无条件全部问一遍就行。
const CONTINUERS = [
  ['./books-steps.js', 'continueBooks'],
  ['./xiuchao-steps.js', 'continueXiuchao'],
  ['./workkk-steps.js', 'continueWorkkk'],
  ['./garden-steps.js', 'continueGarden'],
];

// 论坛和听歌的续步历史上写在 phosphor.js 自己里（continueForum / continueMusic），
// 不在单独的 *-steps.js 里。接线时把那两个函数从外面传进来。
let extraContinuers = [];
export function registerContinuers(list) {
  extraContinuers = Array.isArray(list) ? list.filter((f) => typeof f === 'function') : [];
}

async function runContinuers(decision, result, messages) {
  for (const fn of extraContinuers) {
    try {
      await fn(decision, result, messages);
    } catch (err) {
      console.error('run-actions: 续步出错（不影响其他）', err.message);
    }
  }
  for (const [path, name] of CONTINUERS) {
    let fn;
    try {
      const mod = await import(path);
      fn = mod?.[name];
    } catch {
      continue; // 这台机器上没接这一支，跳过
    }
    if (typeof fn !== 'function') continue;
    try {
      await fn(decision, result, messages);
    } catch (err) {
      console.error(`run-actions: ${name} 出错（不影响其他）`, err.message);
    }
  }
}

// 做完这一次该做的事。
// 返回 { results, dropped }：results 按顺序给每件的结果（给 logWake 和共享时间线用）。
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
      results.push({ action: item.action, result: null });
      continue;
    }

    let result = null;
    try {
      result = await executeAction(one);
      console.log(`[${kind}] ${item.action}（${item.tier} 级）：`, JSON.stringify(result));
    } catch (err) {
      console.error(`[${kind}] ${item.action} 没做成：`, err.message);
      results.push({ action: item.action, result: null, error: err.message });
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
    results.push({ action: item.action, result });
  }

  return { results, dropped };
}
