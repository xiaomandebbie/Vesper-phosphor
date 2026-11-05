// 聊天的气泡长什么样：双方底色、双方字色、字体大小。
//
// 小满 2026-11-05：「自定义里面可以更改双方气泡颜色、字体大小」
//
// ── 为什么单独一个模块 ──
//
// 因为改的人和用的人不在同一页：自定义页（moments-page.js）改，
// 聊天页（chat-page.js）用。两边各自读这里，不互相 import。
//
// ── 怎么生效 ──
//
// 不改 ROOM_STYLE 里那几行，而是在它后面追一段同名选择器的 CSS——
// 同样特异性，后来者胜。这样原样式还在（恢复默认就是不追这段），
// 而且改坏了也就是颜色不对，不会把整页排版弄死。
//
// ── 只收自己认得的值 ──
//
// 颜色必须是 #rrggbb，字号必须是 12..22 的整数。别的一概不存——
// 这些值要直接拼进 <style>，不校就是个注入口子。

import db from './state.js';

db.exec(`
CREATE TABLE IF NOT EXISTS chat_look (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
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

// 默认就是现在这套（ROOM_STYLE 里写死的那几个值）。
// 字段名和表单 name 一致，省得两边对不上。
export const LOOK_DEFAULTS = {
  me_bg: '#1a1a1a',
  me_fg: '#fdfdfd',
  ta_bg: '#f0f0f0',
  ta_fg: '#1a1a1a',
  size: '15',
};

export const LOOK_LABELS = {
  me_bg: '我的气泡底色',
  me_fg: '我的字色',
  ta_bg: 'TA 的气泡底色',
  ta_fg: 'TA 的字色',
};

const HEX = /^#[0-9a-fA-F]{6}$/;
const MIN_SIZE = 12;
const MAX_SIZE = 22;

function clean(key, raw) {
  const v = String(raw ?? '').trim();
  if (key === 'size') {
    const n = Math.round(Number(v));
    if (!Number.isFinite(n)) return null;
    return String(Math.min(MAX_SIZE, Math.max(MIN_SIZE, n)));
  }
  return HEX.test(v) ? v.toLowerCase() : null;
}

// 返回完整的一套：库里没存的用默认。读失败也返回默认——
// 聊天页不应该因为读不到颜色就打不开。
export function getLook() {
  const out = { ...LOOK_DEFAULTS };
  let rows = [];
  try {
    rows = stmt('SELECT key, value FROM chat_look').all();
  } catch (err) {
    console.error('chat-look: 读不到，用默认的', err.message);
    return out;
  }
  for (const r of rows) {
    if (!Object.prototype.hasOwnProperty.call(LOOK_DEFAULTS, r.key)) continue;
    const v = clean(r.key, r.value);
    if (v) out[r.key] = v;
  }
  return out;
}

// 存。只收认得的字段和认得的值，其余直接拒（不是默默跳过）。
export function saveLook(patch) {
  const bad = [];
  const good = {};
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(LOOK_DEFAULTS, k)) continue;
    const c = clean(k, v);
    if (c === null) bad.push(k);
    else good[k] = c;
  }
  if (bad.length) return { error: `这几项填得不对：${bad.join('、')}` };
  if (!Object.keys(good).length) return { ok: true, changed: [] };

  const put = stmt(
    'INSERT INTO chat_look (key, value, updated_at) VALUES (?, ?, ?)\n' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
  );
  const now = Date.now();
  try {
    for (const [k, v] of Object.entries(good)) put.run(k, v, now);
  } catch (err) {
    console.error('chat-look: 存不下来', err.message);
    return { error: err.message };
  }
  console.log(`chat-look: 改了 ${Object.keys(good).join('、')}`);
  return { ok: true, changed: Object.keys(good) };
}

export function resetLook() {
  try {
    stmt('DELETE FROM chat_look').run();
  } catch (err) {
    return { error: err.message };
  }
  console.log('chat-look: 恢复默认');
  return { ok: true };
}

// 追在 ROOM_STYLE 后面的覆盖段。和默认一样时返回空串，
// 这样「没改过」的页面和以前一个字节都不差。
//
// 行高跟着字号走：字调大了行高不跟，两行字会贴在一起。
export function lookCSS() {
  const v = getLook();
  const same = Object.keys(LOOK_DEFAULTS).every((k) => v[k] === LOOK_DEFAULTS[k]);
  if (same) return '';
  const size = Number(v.size);
  return `
  .bub { font-size: ${size}px; line-height: ${size >= 19 ? 1.6 : 1.7}; }
  .grp.me .bub { background: ${v.me_bg}; color: ${v.me_fg}; }
  .grp.ta .bub { background: ${v.ta_bg}; color: ${v.ta_fg}; }
`;
}

export const LOOK_RANGE = { min: MIN_SIZE, max: MAX_SIZE };
