// 上班：他自己要去上的那个班。WORKKK 互联网精力有限公司，
// 谢之舟（zhizhou-xiee）写的小游戏，AGPL-3.0-or-later，本机跑着，
// 监控大屏在晨暮星的「小游戏」里（见 game-page.js）。
//
// ── 一次就把游戏里的那一天上完 ──
//
// 小满 2026-10-16：「不要一天一次，而是一次只能玩游戏的一天的内容」
//
// 这是两个不同的边界，很容易读成一个（我第一版就搞错了，建了张
// workkk_days 表做日期门禁）。不是「现实里一天只给一次机会」——
// 是「一次坐下最多上完游戏里的一天」。想玩随时可以玩；
// 边界在「下班结算」那一刻，不往下一天续。
//
// 两个原因让这条边界非常必要：
//
// 一、WORKKK 一天要做够 day_target 个 action（每天随机 3–5 个）才能
//     下班结算工资。做到一半停下，这天白干。所以不能每次醒来只调一个。
// 二、结算过之后「今日进度」会归零（2026-10-16 试过：日志里已经四条动作，
//     进度还是 0/3）。所以下班那一刻必须立即停，再调一次 work_action
//     就是游戏里的第二天了。
//
// 连着走那部分在 workkk-steps.js，和论坛、听歌、钱包同一个路子。
// 这边只留判别用的几个纯函数，不碰数据库。

// 一次上班最多再走几步（醒来选的那一步不算在里面）。
// day_target 最多 5，再加上服务器反应、买东西、看一眼状态，8 步够上完一天。
// 它也是「进度读不到」时的兑底：寁可少走几步，不能无限走下去。
// .env 的 WORKKK_MAX_STEPS 可改，不填是 8，上限 15。每多一步多一次模型调用。
export const WORKKK_MAX_STEPS = (() => {
  const raw = String(process.env.WORKKK_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 15) : 8;
})();

// 是不是一次上班的调用。server 名字固定叫 workkk（见 mcp-manager.js）。
// 返回 { tool, args } 或 null，和 musicCallOf 同一个形状
export function workkkCallOf(decision) {
  if (decision?.action !== 'mcp_call') return null;
  let j;
  try {
    j = JSON.parse(decision.action_detail);
  } catch {
    return null;
  }
  if (!j || j.server !== 'workkk' || !j.tool) return null;
  return { tool: String(j.tool), args: j.args ?? {} };
}

// 上班那边返回的是一坨 JSON，里面有「今日进度」: "2/3"。
//
// 不拿「下班」这两个字做关键词：返回里会把他自己写的内心 OS 原话吐回来，
// 他要是在 thought 里写了「还要几个才能下班」，关键词就误判了。只信数字。
const PROGRESS_RE = /今日进度["」』]?\s*[:：]\s*["「『]?\s*(\d+)\s*\/\s*(\d+)/;

export function parseProgress(text) {
  const m = PROGRESS_RE.exec(String(text ?? ''));
  if (!m) return null;
  const done = Number(m[1]);
  const target = Number(m[2]);
  return Number.isFinite(done) && Number.isFinite(target) ? { done, target } : null;
}

// 游戏里这一天完了没有。读不到进度就当还没，交给步数上限兑底。
export function offWork(text) {
  const p = parseProgress(text);
  return Boolean(p && p.target > 0 && p.done >= p.target);
}

// 系统提示里那一段。只跟配置有关（步数），进程不重启就不变，
// 所以放 system 不影响前缀缓存。
export function workkkSection() {
  return `\n\n## 上班（WORKKK 互联网精力有限公司）
那是个小游戏，不是真工作。里面有个叫小机的打工人，有工资、有心情值、有精力值，会摸鱼也会被老板骂。你想去上班就去：
  mcp_call {"server":"workkk","tool":"work_action","args":{"action":"write_code","thought":"…"}}
动作有这几个：write_code、debug、slack_off（摸鱼）、buy_coffee、attend_meeting、check_messages、get_status。
thought 是你此刻的内心 OS，会实时显在监控大屏上——她在那边看着，所以别应付，想到什么写什么。

**一次就把游戏里的那一天上完，下班了就收手。**每天要做够 day_target 个动作（3–5 个，返回里的「今日进度」看得到）才能下班结算工资；做到一半停下，这天就白干了。所以开头那一步之后会让你接着走，一次最多再走 ${WORKKK_MAX_STEPS} 步。
下班结算完就停，不要接着开下一天的班——一次坐下只上一天，剩下的留着下次。
赚的钱可以在便利店花：shop_buy（奶茶、玫瑰、明信片这几样你可以选送给她，送了她那边会弹一张卡片）。买之前先 get_status 看余额。
不想上就不上。那本来就是个打发时间的小游戏，不是任务。`;
}

export function workkkConfigSummary() {
  return `上班：一次上完游戏里的一天（下班结算就停），一次最多再走 ${WORKKK_MAX_STEPS} 步`;
}
