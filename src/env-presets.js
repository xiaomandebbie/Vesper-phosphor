// 线路预设：把一组配好的地址 + 模型 + key 起个名字存下来，以后点一下换回去。
//
// 小满 2026-11-05：「可以保存以前的模型嘛」「换一个模型连接也可以换回之前的」
//
// ── 为什么不用 .env.bak 那套 ──
//
// env-store.js 每次保存前备份一份 .env.bak.<时间戳>，那是防改坏的。
// 但它不能当「换回去」用：
//   文件名只有时间戳，看不出哪份是 DeepSeek 哪份是聚樦；
//   整份恢复会把这之后改的别的东西也一起退回去；
//   而且得上服务器才能恢复。
//
// 所以预设是另一个东西：每条线路各自存多个带名字的组合，只动这一组。
// 切换时仍然走 writeFields，所以 .env.bak 那道保险照旧生效。
//
// ── key 存在哪 ──
//
// 和 .env 同一台机器、同一个人能读到，所以存在 data/state.db 里。
// 这不增加暴露：能读到数据库的人本来就能读 .env。
//
// 但页面上永远不回显 key 原文，只显示末尾四位——和输入框那边一个口径。
//
// ── 存的时候 key 空着怎么办 ──
//
// 存预设用的是 .env 里当前生效的值，不是框里填的——因为她点「存为预设」
// 时想存的是「现在这套」，而不是「框里这套没保存的」。
// 先保存再存预设，这个顺序页面上写清楚了。

import db from './state.js';
import { FIELDS, GROUPS } from './env-store.js';

db.exec(`
CREATE TABLE IF NOT EXISTS env_presets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id TEXT NOT NULL,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_env_presets_group ON env_presets (group_id);
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

const MAX_NAME_CHARS = 20;
// 一条线路最多存几个。满了让她先删，不自己做主汻掉最旧的
const MAX_PER_GROUP = 12;

const groupKeys = (groupId) => GROUPS.find((g) => g.id === groupId)?.keys ?? [];

function parsePayload(raw) {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? v : {};
  } catch {
    return {};
  }
}

// 给页面用的列表。secret 只给末尾四位，不给原文。
export function listPresets(groupId) {
  let rows;
  try {
    rows = stmt(
      'SELECT id, name, payload, created_at, used_at FROM env_presets WHERE group_id = ? ORDER BY used_at DESC, id DESC'
    ).all(String(groupId));
  } catch (err) {
    console.error('env-presets: 读不到预设', err.message);
    return [];
  }
  const keys = groupKeys(groupId);
  return rows.map((r) => {
    const p = parsePayload(r.payload);
    const modelKey = keys.find((k) => /_MODEL$/.test(k));
    const baseKey = keys.find((k) => /_BASE_URL$|_API_URL$/.test(k));
    const keyKey = keys.find((k) => FIELDS[k]?.kind === 'secret');
    const secret = keyKey ? String(p[keyKey] ?? '') : '';
    return {
      id: r.id,
      name: r.name,
      model: modelKey ? String(p[modelKey] ?? '') : '',
      base: baseKey ? String(p[baseKey] ?? '') : '',
      keyTail: secret ? secret.slice(-4) : '',
      hasKey: Boolean(secret),
      createdAt: r.created_at,
      usedAt: r.used_at,
    };
  });
}

// 存一份。values 是调用方从 .env 读出来的当前值（带 key 原文）。
// 同名的覆盖：她再存一次「DeepSeek 官方」就是想更新那一份，不是存两份重名的。
export function savePreset(groupId, name, values) {
  const gid = String(groupId);
  const keys = groupKeys(gid);
  if (!keys.length) return { error: '没有这一组' };

  const label = Array.from(String(name ?? '').replace(/\s+/g, ' ').trim())
    .slice(0, MAX_NAME_CHARS)
    .join('');
  if (!label) return { error: '给它起个名字' };

  // 只存这一组里真正有值的字段
  const payload = {};
  for (const k of keys) {
    const v = String(values?.[k] ?? '').trim();
    if (v) payload[k] = v;
  }
  if (!Object.keys(payload).length) return { error: '这一组现在是空的，没什么可存' };

  try {
    const old = stmt('SELECT id FROM env_presets WHERE group_id = ? AND name = ?').get(gid, label);
    if (old) {
      stmt('UPDATE env_presets SET payload = ?, created_at = ? WHERE id = ?')
        .run(JSON.stringify(payload), Date.now(), old.id);
      console.log(`env-presets: 更新了「${label}」（${gid}）`);
      return { ok: true, id: old.id, name: label, updated: true };
    }

    const n = stmt('SELECT COUNT(*) AS c FROM env_presets WHERE group_id = ?').get(gid).c;
    if (n >= MAX_PER_GROUP) {
      return { error: `这条线路已经存了 ${n} 个，先删几个不用的` };
    }

    const id = stmt(
      'INSERT INTO env_presets (group_id, name, payload, created_at) VALUES (?, ?, ?, ?)'
    ).run(gid, label, JSON.stringify(payload), Date.now()).lastInsertRowid;
    console.log(`env-presets: 存了「${label}」（${gid}）`);
    return { ok: true, id, name: label };
  } catch (err) {
    console.error('env-presets: 存不下来', err.message);
    return { error: err.message };
  }
}

// 拿一份出来。返回 { name, values }，values 直接交给 writeFields。
// 这里不自己写 .env：写盘、白名单、备份都在 env-store 那一层，
// 两处各写一遍就是下一个坑。
export function loadPreset(id) {
  let row;
  try {
    row = stmt('SELECT group_id, name, payload FROM env_presets WHERE id = ?').get(Number(id));
  } catch (err) {
    return { error: err.message };
  }
  if (!row) return { error: '找不到这份预设' };

  const keys = groupKeys(row.group_id);
  const p = parsePayload(row.payload);
  const values = {};
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(p, k)) values[k] = p[k];
  }
  return { ok: true, groupId: row.group_id, name: row.name, values };
}

export function markUsed(id) {
  try {
    stmt('UPDATE env_presets SET used_at = ? WHERE id = ?').run(Date.now(), Number(id));
  } catch {}
}

export function dropPreset(id) {
  try {
    return stmt('DELETE FROM env_presets WHERE id = ?').run(Number(id)).changes > 0;
  } catch {
    return false;
  }
}

// 当前这套和哪份预设一样。一样就在页面上打个勾，
// 不用猜「我现在用的是哪个」。
//
// 比整组：地址、模型、key 都得对上。只有模型名一样不算——
// 两家供应商很可能都叫 deepseek-chat。
export function matchCurrent(groupId, current) {
  const keys = groupKeys(groupId);
  if (!keys.length) return null;
  let rows;
  try {
    rows = stmt('SELECT id, name, payload FROM env_presets WHERE group_id = ?').all(String(groupId));
  } catch {
    return null;
  }
  for (const r of rows) {
    const p = parsePayload(r.payload);
    const same = keys.every((k) => {
      const a = String(p[k] ?? '').trim();
      const b = String(current?.[k] ?? '').trim();
      return a === b;
    });
    if (same) return { id: r.id, name: r.name };
  }
  return null;
}
