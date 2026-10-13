// 你自己存的配方。
//
// 和经典配方分开：那 16 杯是抄 Proof 内容包的死名单，这里是你调出来的。
// 存 JSON 不建表，和饮用账本一个做法——这点量用不着动 state.db。
//
// 名字当 id：同名就是覆盖，按你平时的习惯。改一点重存一遍比建一堆同名的好。
import fs from 'fs';
import path from 'path';
import { formatDateTime } from './wall-time.js';

const env = (k) => String(process.env[k] ?? '').trim();
const DATA_DIR = env('PROOF_DATA_DIR') || env('VESPER_DATA_DIR') || path.join(process.cwd(), 'data');
const FILE = path.join(DATA_DIR, 'bar-recipes.json');

// 存多少张。满了再存就把最早那张挤掉
const MAX = 60;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(j.recipes) ? j.recipes : [];
  } catch {
    return [];
  }
}

function save(recipes) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ recipes }, null, 1), 'utf8');
  fs.renameSync(tmp, FILE);
}

// 新的在前
export function listRecipes() {
  return load()
    .slice()
    .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
}

// 配方洗成 [{ id, volume }]，和递酒表单一个形状
function clean(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const it of parts) {
    const id = String(it?.id ?? '').trim();
    const vol = Number(it?.volume);
    if (id && Number.isFinite(vol) && vol > 0) out.push({ id, volume: Math.round(vol) });
  }
  return out;
}

// 存一张。同名覆盖，返回 { ok, overwrote } 或 { ok: false, error }
export function saveRecipe({ name, parts, intro }) {
  const title = String(name || '').trim().slice(0, 24);
  if (!title) return { ok: false, error: '得给它起个名字。' };
  const recipe = clean(parts);
  if (!recipe.length) return { ok: false, error: '配方是空的，至少要有一样原料和毫升数。' };

  const all = load();
  const idx = all.findIndex((r) => String(r.name).trim() === title);
  const row = {
    name: title,
    parts: recipe,
    intro: String(intro || '').trim().slice(0, 80),
    at: formatDateTime(),
  };
  if (idx >= 0) {
    all[idx] = row;
    try {
      save(all);
    } catch (err) {
      return { ok: false, error: `存不下来：${err.message}` };
    }
    return { ok: true, overwrote: true, name: title };
  }
  all.push(row);
  // 满了挤掉最早的
  while (all.length > MAX) all.shift();
  try {
    save(all);
  } catch (err) {
    return { ok: false, error: `存不下来：${err.message}` };
  }
  return { ok: true, overwrote: false, name: title };
}

export function deleteRecipe(name) {
  const title = String(name || '').trim();
  if (!title) return { ok: false, error: '没说删哪张。' };
  const all = load();
  const next = all.filter((r) => String(r.name).trim() !== title);
  if (next.length === all.length) return { ok: false, error: `没有「${title}」这张。` };
  try {
    save(next);
  } catch (err) {
    return { ok: false, error: `删不掉：${err.message}` };
  }
  return { ok: true, name: title };
}

export function recipeCount() {
  return load().length;
}
