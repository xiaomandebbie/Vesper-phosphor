// 动态页"TA此刻"下面那一行要用的三个时间：上次唤醒、下次唤醒、自主唤醒。
// 只读库，不调模型。和 state.js 共用同一个数据库连接。
import db from './state.js';

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// lastAt：最近一次醒来（wake_log 里最新一条，包括 noop 和出错）
// nextAt：下一次自然唤醒（wake_state.next_wake_at）；mode 是 silent 时自然唤醒暂停
// selfAt：TA 自己约的、还没到的最早一次精确唤醒（pending_wake）
export function getWakeTimes() {
  const state = stmt('SELECT mode, next_wake_at FROM wake_state WHERE id = 1').get();
  const last = stmt('SELECT MAX(fired_at) AS t FROM wake_log').get();
  const self = stmt(
    "SELECT wake_at, note FROM pending_wake WHERE status = 'pending' ORDER BY wake_at ASC LIMIT 1"
  ).get();
  return {
    mode: state?.mode ?? 'normal',
    lastAt: last?.t ?? null,
    nextAt: state?.next_wake_at ?? null,
    selfAt: self?.wake_at ?? null,
    selfNote: self?.note ?? null,
  };
}
