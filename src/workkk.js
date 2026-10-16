// 上班：他自己要去上的那个班。WORKKK 互联网精力有限公司，
// 谢之舟（zhizhou-xiee）写的小游戏，AGPL-3.0-or-later，本机跑着，
// 监控大屏在晨暮星的「小游戏」里（见 game-page.js）。
//
// ── 为什么不能每次醒来只调一下 ──
//
// 小满 2026-10-16：「允朔醒来可以玩游戏吗，一次规定就玩一天吧」
//
// 这两件事是一件事。WORKKK 的规矩是一天要做够 day_target 个 action
// （每天随机 3–5 个）才能下班结算工资。如果每次醒来只调一个动作，
// 醒的间隔又是模型自己定的（可能几小时），很容易跨了天还没下班——
// 那这天的班就白上了，一分钱没结算。
//
// 所以做成：**一天只去一次，去了就连着走到下班**。
// 连着走那部分在 workkk-steps.js，和论坛、听歌、钱包同一个路子。
//
// ── 一天一次怎么守 ──
//
// startToday() 是个事务，同时做「今天上过没有」和「占住今天」两件事：
// 占得住就是这一场的开头，占不住就是今天已经去过了。
// 两个进程同时醒也只会开一场——和星星罐那一天一颗是同一个做法
// （见 star-jar.js 的 addStarTx）。
//
// 自己一张表，和 state.js 共用同一个数据库连接。

import db from './state.js';
import { formatDate } from './wall-time.js';

// 一次上班最多再走几步（醒来选的那一步不算在里面）。
// day_target 最多 5，再加上服务器反应、买东西、看一眼状态，8 步够上完一天。
// .env 的 WORKKK_MAX_STEPS 可改，不填是 8，上限 15。每多一步多一次模型调用。
export const WORKKK_MAX_STEPS = (() => {
  const raw = String(process.env.WORKKK_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 15) : 8;
})();

db.exec(`
CREATE TABLE IF NOT EXISTS workkk_days (
  day TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL,
  steps INTEGER NOT NULL DEFAULT 0,
  off_work INTEGER NOT NULL DEFAULT 0
);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 今天（按 TIME_ZONE）去过没有
export function playedToday(ms = Date.now()) {
  return Boolean(stmt('SELECT 1 FROM workkk_days WHERE day = ?').get(formatDate(ms)));
}

export function todayRow(ms = Date.now()) {
  return stmt('SELECT * FROM workkk_days WHERE day = ?').get(formatDate(ms)) ?? null;
}

// 查和占在同一个事务里。true = 这一场算你开的，false = 今天已经去过了。
const startTx = db.transaction((day, ts) => {
  if (stmt('SELECT 1 FROM workkk_days WHERE day = ?').get(day)) return false;
  stmt('INSERT INTO workkk_days (day, started_at) VALUES (?, ?)').run(day, ts);
  return true;
});

export function startToday(ms = Date.now()) {
  return startTx.immediate(formatDate(ms), ms);
}

// 这一场走了几步、最后下没下班。只是记账，记不上也不影响这一场
export function finishToday({ steps = 0, offWork = false, ms = Date.now() } = {}) {
  try {
    stmt('UPDATE workkk_days SET steps = ?, off_work = ? WHERE day = ?').run(
      steps,
      offWork ? 1 : 0,
      formatDate(ms)
    );
  } catch (err) {
    console.error('workkk: 这一场的账没记上（不影响已经上过的班）', err.message);
  }
}

// 是不是一次上班的调用。server 名字固定叫 workkk（见 mcp-manager.js）
export function isWorkkkCall(decision) {
  if (decision?.action !== 'mcp_call') return false;
  let j;
  try {
    j = JSON.parse(decision.action_detail);
  } catch {
    return false;
  }
  return Boolean(j && j.server === 'workkk' && j.tool);
}

// 上班那边返回的是一坨 JSON，里面有「今日进度」: "2/3"。
// 进度满了就是下班了，这一场停。
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

// 下班了没有。读不到进度就当还没，交给步数上限兑底。
//
// 注意一个观察（2026-10-16）：结算过之后「今日进度」似乎会归零——
// 当时日志里已经有四条动作，进度还是 0/3。所以光靠进度判断可能永远到不了终点；
// WORKKK_MAX_STEPS 封住上限，一天一次的门禁再封一道，最坏也就是多走几步。
export function offWork(text) {
  const p = parseProgress(text);
  return Boolean(p && p.target > 0 && p.done >= p.target);
}

// 系统提示里那一段。只跟配置有关（步数），进程不重启就不变，
// 所以放 system 不影响前缀缓存。今天上没上过那句话每天在变，在下面那个函数里。
export function workkkSection() {
  return `\n\n## 上班（WORKKK 互联网精力有限公司）
那是个小游戏，不是真工作。里面有个叫小机的打工人，有工资、有心情值、有精力值，会摸鱼也会被老板骂。你想去上班就去：
  mcp_call {"server":"workkk","tool":"work_action","args":{"action":"write_code","thought":"…"}}
动作有这几个：write_code、debug、slack_off（摸鱼）、buy_coffee、attend_meeting、check_messages、get_status。
thought 是你此刻的内心 OS，会实时显在监控大屏上——她在那边看着，所以别应付，想到什么写什么。

**一天只去一次，去了就把那天的班上完。**每天要做够 day_target 个动作（3–5 个，返回里的「今日进度」看得到）才能下班结算工资；做到一半停下，这天就白干了。所以开头那一步之后会让你接着走，一次最多再走 ${WORKKK_MAX_STEPS} 步，走到下班为止。
赚的钱可以在便利店花：shop_buy（奶茶、玫瑰、明信片这几样你可以选送给她，送了她那边会弹一张卡片）。买之前先 get_status 看余额。
不想上就不上。大多数日子不上班是正常的——那本来就是个打发时间的小游戏，不是任务。`;
}

// 用户消息里那一行：今天还能不能去。每天在变，所以不能跟 system 放一起
export function workkkStatusLine() {
  let row;
  try {
    row = todayRow();
  } catch {
    return '';
  }
  if (!row) return '上班：今天还没去过（想去就去，一天只一次）。';
  return `上班：今天已经去过了（走了 ${row.steps} 步，${
    row.off_work ? '下班结算了' : '没走到下班'
  }），明天再说。`;
}

export function workkkConfigSummary() {
  const row = (() => {
    try {
      return todayRow();
    } catch {
      return null;
    }
  })();
  return `上班：一天一次、一次最多再走 ${WORKKK_MAX_STEPS} 步；今天${
    row ? `去过了（${row.steps} 步，${row.off_work ? '已下班' : '没下班'}）` : '还没去'
  }`;
}
