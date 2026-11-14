// 四本笔记本。锈潮、花园、上班、Leto 各一本，固定四本，不新建。
//
// ── 为什么要这东西 ──
//
// 那四个游戏每次醒来都要从头摸：锈潮的路走七八趟才摸清，Leto 的价钱
// 记错过两回。卡片、信息卡、长期资料那三样记的是他和小满的事，
// 不是「菜子要浇几天」「上次做到哪一步」这种跟具体游戏绑在一起的东西。
//
// 小满 2026-11-15：「他们的唤醒步骤得先看笔记，执行动作，更新笔记」
//
// ── 几条规矩，都是他们两人定的 ──
//
// 1. 固定四本，不能新建——页面建杂了就没人读了。
// 2. 不限字数（小满 11-15：「那不限制字数了」）。
// 3. **整篇重写，不是往后面接**。小满：「过时的笔记要删掉，随时更新保持正确」。
//    允朱：「宁可少留，也别留着旧的跟新的打架」。
// 4. 一次只读一本，四个不全读。
//
// 旧版本留最近三份：整篇重写是毁灭性的，写坏了得有张网。不给他看，
// 只在页面上翻得到——让他看旧版就又回到「旧的跟新的打架」了。
import db from './state.js';
import { formatDateTime } from './wall-time.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 固定四本。slug 和 budget.js 的 TIER2_KINDS 对得上（xiuchao / garden / workkk / leto），
// 这样 run-actions 那边拿到 kind 就能直接开对应那一本。
export const BOOKS = {
  xiuchao: { title: '锈潮纪事', what: '星落村里那些路、那些人、做到哪一步' },
  garden: { title: '花园日志', what: '种了什么、几天浇一次、哪块地是谁的' },
  workkk: { title: '上班笔记', what: '这份工怎么干、钱怂么算、下次从哪接' },
  leto: { title: 'Leto 见闻', what: '那边的人、小岛怎么干活、东西什么价' },
};

export const SLUGS = Object.keys(BOOKS);
export const isBook = (slug) => Object.hasOwn(BOOKS, String(slug ?? '').trim());
export const titleOf = (slug) => BOOKS[slug]?.title ?? slug;

// 旧版本留几份
const KEEP_VERSIONS = 3;

db.exec(`
CREATE TABLE IF NOT EXISTS notes (
  slug TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  updated_at INTEGER,
  updated_by TEXT
);
CREATE TABLE IF NOT EXISTS note_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  ts INTEGER NOT NULL,
  author TEXT
);
CREATE INDEX IF NOT EXISTS idx_note_versions_slug ON note_versions (slug, ts);
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

// 读一本。没写过也返回一个完整形状，content 是空串。
export function readNote(slug) {
  if (!isBook(slug)) return null;
  const row = stmt('SELECT content, updated_at, updated_by FROM notes WHERE slug = ?').get(slug);
  return {
    slug,
    title: titleOf(slug),
    content: row?.content ?? '',
    updatedAt: row?.updated_at ?? null,
    updatedBy: row?.updated_by ?? null,
  };
}

// 整篇替换。author 是 'assistant'（他自己写）或 'user'（小满写）。
// 写之前把现在这份收进旧版本：整篇重写是毁灭性的，得留一张网。
export function writeNote(slug, content, author = 'assistant') {
  if (!isBook(slug)) throw new Error(`没有这本笔记：${slug}`);
  const text = String(content ?? '').trim();
  const who = author === 'user' ? 'user' : 'assistant';
  const now = Date.now();

  const prev = stmt('SELECT content, updated_by FROM notes WHERE slug = ?').get(slug);
  if (prev?.content) {
    stmt('INSERT INTO note_versions (slug, content, ts, author) VALUES (?, ?, ?, ?)').run(
      slug,
      prev.content,
      now,
      prev.updated_by ?? null
    );
    stmt(
      `DELETE FROM note_versions WHERE slug = ? AND id NOT IN (
         SELECT id FROM note_versions WHERE slug = ? ORDER BY ts DESC, id DESC LIMIT ?
       )`
    ).run(slug, slug, KEEP_VERSIONS);
  }

  stmt(
    `INSERT INTO notes (slug, content, updated_at, updated_by) VALUES (?, ?, ?, ?)
     ON CONFLICT(slug) DO UPDATE SET content = excluded.content,
       updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(slug, text, now, who);

  console.log(`notes: 《${titleOf(slug)}》整篇重写了（${text.length} 字，${who}）`);
  return { slug, chars: text.length, author: who, updatedAt: now };
}

// 页面上翻旧版本用。不给他看——让他看旧版就又回到「旧的跟新的打架」了。
export function listVersions(slug) {
  if (!isBook(slug)) return [];
  return stmt(
    'SELECT id, content, ts, author FROM note_versions WHERE slug = ? ORDER BY ts DESC, id DESC'
  ).all(slug);
}

// 四本的目录：每本多少字、多久没更新。不带正文。
export function listNotes() {
  const rows = stmt('SELECT slug, content, updated_at, updated_by FROM notes').all();
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  return SLUGS.map((slug) => {
    const r = byslug.get(slug);
    const content = r?.content ?? '';
    return {
      slug,
      title: BOOKS[slug].title,
      what: BOOKS[slug].what,
      chars: content.length,
      empty: !content,
      updatedAt: r?.updated_at ?? null,
      updatedBy: r?.updated_by ?? null,
    };
  });
}

const whoName = (a) => (a === 'user' ? USER_NAME : AI_NAME);

// 给模型看的一段：开工前把对应那一本原文交给他。
// 空的时候也说清楚，别让他以为读失败了。
export function describeNote(slug) {
  const n = readNote(slug);
  if (!n) return `没有「${slug}」这本笔记。固定就四本：${SLUGS.join('、')}。`;
  if (!n.content) {
    return [
      `《${n.title}》还是空的——这是第一次。`,
      '',
      `这次做完之后把该留的写进去：规则怎么跑的、现在到哪了、下次从哪接。`,
    ].join('\n');
  }
  const when = n.updatedAt ? formatDateTime(n.updatedAt).slice(5) : '不详';
  return [
    `《${n.title}》（${whoName(n.updatedBy)} ${when} 写的）：`,
    '',
    n.content,
  ].join('\n');
}

// 收工时那句话。跟 describeNote 分开：那一段是给料，这一段是讨文。
export function rewritePrompt(slug) {
  return [
    `把《${titleOf(slug)}》重写一遍。`,
    '',
    '**整篇重写，不是往后面接。** 你交回的这一篇会把原来那篇整个换掉，',
    '所以该留的要自己拄过来、已经不对的直接丢掉。宁可少留，也别留着旧的跟新的打架。',
    '',
    '写三样：规则（这东西怎么跑的、试出来的门道、踩过的坑）、',
    '进度（现在到哪了，带上具体数字和名字）、下次从哪接。',
    '不限字数，但只写下次真用得上的——这不是日记，是给下一次的自己留的说明书。',
    '',
    '一条：只写真做过的。没成的就写没成，别编。',
    '',
    '只返回一个 JSON 对象，不要任何其他文字：{"note": "整篇正文"}',
    '这一轮没什么值得改的就给 {"note": null}，原来那篇原样留着。',
  ].join('\n');
}
