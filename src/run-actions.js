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
import { pickActions, tier1KindOf, recordTier1, TIER1_KINDS, tier2KindOf, recordTier2, TIER2_KINDS, recordBookRead, booksRemaining, BOOKS_DAILY_MAX } from './budget.js';

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

// 他想「什么都不做」，却写成了一次工具调用。
//
// 2026-10-19 14:16 那次：{"server":"garden","tool":"noop","args":{}}。
// 花园没有叫 noop 的工具，于是 Unknown tool.——这次醒来既没做事，也没留下任何痕迹。
// 他的意图很清楚，不该因为写法不对就变成一次失败。
//
// 要在 pickActions 之前就改完：否则 tier2KindOf 会把它认成「花园」，
// 兑成成功之后反而白扣一次 2 级额度。
function isNoopCall(action, detail) {
  if (action !== 'mcp_call') return false;
  try {
    const raw = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '');
    const j = JSON.parse(raw);
    const tool = String(j?.tool ?? '').trim().toLowerCase();
    const cmd = String(j?.args?.command ?? '').trim().toLowerCase();
    return !tool || tool === 'noop' || tool === 'none' || cmd === 'noop';
  } catch {
    return false;
  }
}

// 做完这一次该做的事。
// 返回 { results, dropped }。results 每项带 action / action_detail / result，
// logWake 和共享时间线那边要用 action_detail 重建一个 decision 形状。
// 被 Leto 叫醒的那一轮，只放行和 Leto 有关的事 + 存记忆。
//
// 2026-11-01 修：原来只看 note 是不是以「[Leto」开头，而唤醒桥投进来的 note
// 不一定是那个格式。13:15 那轮日志里 server 写的是 'Leto'、动作也选对了，却被
// 当成普通唤醒放行——Leto 叫醒的那一轮于是什么都能干，跟「被叫醒就先把那边
// 的事结掉」这条正好相反。现在只要求 note 里出现 leto 这个词：大小写不限、
// 有没有方括号都认。
function isLetoWake(selfNote) {
  return /leto/i.test(String(selfNote ?? ''));
}

// 这一件事算不算「Leto 的事」。mcp_call 要看 action_detail 里的 server，
// 他写大小写不定（leto / Leto 都出现过），所以转小写比。
function allowedUnderLetoWake(item) {
  const a = String(item?.action ?? '').trim();
  if (a === 'noop' || a === 'ombre_brain') return true;
  if (a !== 'mcp_call') return false;
  try {
    const raw = typeof item.action_detail === 'string'
      ? item.action_detail
      : JSON.stringify(item.action_detail ?? '');
    const j = JSON.parse(raw);
    const server = String(j?.server ?? '').trim().toLowerCase();
    const tool = String(j?.tool ?? '').trim().toLowerCase();
    return server === 'leto' || tool.startsWith('leto_');
  } catch {
    return false;
  }
}

export async function runActions(decision, messages, { kind = 'non_precise', selfNote = null } = {}) {
  // 只给了单个 action 的老形状也认：模型有时候不写 actions 数组
  const list =
    Array.isArray(decision?.actions) && decision.actions.length
      ? decision.actions
      : [{ action: decision?.action, action_detail: decision?.action_detail }];

  // 把「包成工具调用的 noop」兑回真 noop，再进筛子
  const cleaned = list.map((item) => {
    const a = String(item?.action ?? '').trim();
    if (!isNoopCall(a, item?.action_detail)) return item;
    console.log(`[${kind}] 他把 noop 当成工具去调了（${item?.action_detail}），按「什么都不做」算`);
    return { ...item, action: 'noop', action_detail: '' };
  });

  const letoWake = isLetoWake(selfNote);

  // Leto 那一轮先过这道，摆在 pickActions 之前：筛掉的不进账、不扣额度。
  let gated = cleaned;
  if (letoWake) {
    const keep = cleaned.filter(allowedUnderLetoWake);
    for (const item of cleaned) {
      if (!keep.includes(item)) {
        console.log(`[${kind}] 没做：${item?.action}——这次是 Leto 叫醒的，先把那边的事结掉`);
      }
    }
    // 全被筛掉时留一个 noop，别让这一轮变成空数组走到底
    gated = keep.length ? keep : [{ action: 'noop', action_detail: '' }];
  }

  // ── Leto 叫醒的那一轮，不走「每级最多一件」──
  //
  // 2026-11-01 17:17 那次：那边同时有四条在叫他，他一次写了四条 leto_reply，
  // pickActions 按 2 级只放行一件，后三条全被挡成「这次已经做了一件 2 级的事」。
  //
  // 那条规矩是给「消遣」用的——一次醒来别把上班、花园、锈潮全刷一遍。
  // 可被叫醒的时候，那边等着的每一条都是一封没回的信，不是一个选项。
  // 只回其中一条，剩下三条就晾在那儿，下次醒来还得再碰运气。
  //
  // 上面那道门已经把这一轮筛成「只有 Leto 的事 + noop + 存记忆」了，
  // 所以这里直接全放行，不会把论坛、游戏那些顺手带进来。
  // 记账照旧（下面 recordTier2 还在跑），只是不再拦。
  let allowed;
  let dropped;
  if (letoWake) {
    allowed = gated.map((item) => ({ ...item, tier: 2 }));
    dropped = [];
  } else {
    const picked = pickActions(gated);
    allowed = picked.allowed;
    dropped = picked.dropped;
  }
  for (const d of dropped) console.log(`[${kind}] 没做：${d.action}——${d.why}`);

  const results = [];
  for (const item of allowed) {
    // 每件事自己一个 decision 形状：executeAction 和所有 continueXxx 都按
    // { action, action_detail, mood } 这三个字段认事，给全了就不用改它们
    // selfNote 一起传下去：leto-steps 靠它分辨「被叫醒」和「自己醒来选的」，两轮步数上限不同。
    const one = { ...decision, action: item.action, action_detail: item.action_detail, selfNote };

    if (item.action === 'noop') {
      results.push({ action: item.action, action_detail: item.action_detail, result: null });
      continue;
    }

    let result = null;
    try {
      result = await executeAction(one);
      console.log(`[${kind}] ${item.action}（${item.tier ?? '?'} 级）：`, JSON.stringify(result));
    } catch (err) {
      console.error(`[${kind}] ${item.action} 没做成：`, err.message);
      results.push({ action: item.action, action_detail: item.action_detail, result: null, error: err.message });
      continue;
    }

    // 2 级记一笔。记在这里（真正开跑了的那一刻），而不是模型说要做的时候；
    // 后面 continueXxx 里接着走的那几步不再记——一件事只算一次
    // 1 级也记一笔（见 budget.js）。和下面 2 级同一个位置：真正开跑了才记，
    // continueXxx 里接着走的那些步不再记。这本账没有上限，只是为了让他下次
    // 醒来看见「论坛上次是 3 天前」——和那四个游戏一样的活状态。
    const kind1 = tier1KindOf(item.action, item.action_detail);
    if (kind1 && !result?.isError) {
      try {
        recordTier1(kind1);
        console.log(`[${kind}] 记上一次 1 级：${TIER1_KINDS[kind1]}`);
      } catch (err) {
        console.error('run-actions: 1 级记账失败（不影响这次）', err.message);
      }
    }

    const kind2 = tier2KindOf(item.action, item.action_detail);
    if (kind2 && !result?.isError) {
      try {
        recordTier2(kind2);
        console.log(`[${kind}] 记上一次 2 级：${TIER2_KINDS[kind2]}`);
      } catch (err) {
        console.error('run-actions: 2 级记账失败（不影响这次）', err.message);
      }
    }

    // 读书单算一本账（见 budget.js）：一天几回，不占 2 级那几次。
    // 只有真的往下读了才记——看书架、写批注、回她一句都不扣。
    // 后面 continueBooks 里接着翻的那几小段也不记，一次坐下只算一回。
    if (item.action === 'read_book' && !result?.isError && result?.mode === 'read') {
      try {
        recordBookRead();
        console.log(`[${kind}] 记上一回读书：今天还剩 ${booksRemaining()} 回（一天 ${BOOKS_DAILY_MAX} 回）`);
      } catch (err) {
        console.error('run-actions: 读书记账失败（不影响这次）', err.message);
      }
    }

    await runContinuers(one, result, messages);
    results.push({ action: item.action, action_detail: item.action_detail, result });
  }

  return { results, dropped };
}
