// 按 .env 的 TIME_ZONE 处理"墙上时间"。日历、纪念日、行为动态的日期都用它。
// 服务器本身可能是 UTC，直接 new Date().getDate() 会差 8 小时，所以统一走这里。
export const TIME_ZONE = process.env.TIME_ZONE || 'Asia/Shanghai';

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIME_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

export const pad = (n) => String(n).padStart(2, '0');

export function wallParts(ms = Date.now()) {
  const o = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24, min: +o.minute, s: +o.second };
}

// TIME_ZONE 下某天 00:00 对应的毫秒时间戳。月、日超出范围会自动进位（比如 13 月 = 下一年 1 月）
export function wallMidnight(y, m, d) {
  const guess = Date.UTC(y, m - 1, d);
  const p = wallParts(guess);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.min, p.s);
  return guess - (asUtc - guess);
}

// "2026-09-29"
export function formatDate(ms = Date.now()) {
  const p = wallParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

// "2026-09-29 12:56"
export function formatDateTime(ms = Date.now()) {
  const p = wallParts(ms);
  return `${p.y}-${pad(p.m)}-${pad(p.d)} ${pad(p.h)}:${pad(p.min)}`;
}

// "2026-09-02" → { y, m, d }。格式不对、日期不存在（比如 2 月 30 日）、年份离谱都返回 null
export function parseDate(str) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  if (y < 1900 || y > 2200) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

// "2026-09" → { y, m }
export function parseMonth(str) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(str ?? '').trim());
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12) return null;
  return { y, m: mo };
}

// b 比 a 晚几天，按日历日算，不受时分影响
export function daysBetween(a, b) {
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
}

export function daysInMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

// 这个月 1 号是星期几，周一 = 0
export function firstWeekday(y, m) {
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}
