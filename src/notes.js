// 四本笔记本。锈潮、花园、上班、Leto 各一本，固定四本，不新建。
//
// ── 为什么要这东西 ──
//
// 那四个游戏每次醒来都要从头摸：锈潮的路走七八趟才摸清，Leto 的价钱
// 记错过两回。卡片、信息卡、长期资料那三样记的是他和小满的事，
// 不是「菜子要浇几天」「上次做到哪一步」这种跟具体游戏绑在一起的东西。
//
// ── 为什么是条目而不是一篇文 ──
//
// 第一版我写的是「整篇重写」：每次收工让他把整本交一遍。
// 小满 11-15：「每次都整篇重写吗…？会不会工程太大，只需要新增和修改呀」
//
// 她对。改一句话要把没变的部分全抄一遍，每次都是一整篇的 token，
// 而且抄着抄着就把好东西抄丢了。现在是：
//   新摸到一件事 → 添一条
//   发现之前写的不对 → 改那一条
//   已经没用了     → 删那一条
// 别的条目一个字不动。
//
// 每条带两个时间：建的时候、上次改的时候（小满：「要记录各个条目的日期」）。
//
// ── 三类板块 ──
//
// 小满 11-19：「笔记本分为：日记，今日已做，攻略，疑惑…之类的板块」
//
// 「今日已做」没做成独立板块——它和日记写的是同一件事，只是一个当天有、
// 一个事后留。所以日记今天那条一直追加，到第二天自然就是历史，
// 不用两套、也不用每天 6:00 清空。
//
//   diary    日记。一天一条，当天追加；**往期只能读**
//   guide    攻略。摸到门道就改对应那条，一直可以改
//   question 疑惑。想不通的记一条，想通了删掉或挤进攻略；一直可以改
//
// 往期日记的锁写在 editEntry 里，不只写在提示词里——他哪天想「补充一下
// 上周那条」就会动手，而小满要的是往期封存。
//
// 现有条目全归 guide（小满：「不用管现有的那些」）。从它们的形状看也对：
// 【两个岛别弄混】【钱】【打工】【岛上的人】那几条本来就是门道。
//
// ── 几条规矩 ──
//
// 1. 固定四本，不能新建——页面建杂了就没人读了。
// 2. 条数不限，单条不限字数。日记那条 400–500 字是**软的**，
//    写在提示词里，这边不拦——真有一天他有大事要记，硬拦会卡住。
// 3. 过时的要删（小满：「过时的笔记要删掉，随时更新保持正确」）。
// 4. 一次只读一本，四个不全读。
//
// ── 已读水位 ──
//
// 小满要发现页像微信一样标未读数字。要算未读就必须有一条「你看到哪了」，
// 所以这边多一张 note_reads。只记她的水位：他写的东西对她来说是新的，
// 她自己写的不算。点进那一本就清掉那一本的。
import db from './state.js';
import { formatDateTime, wallParts, wallMidnight } from './wall-time.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 固定四本。slug 和 budget.js 的 TIER2_KINDS 对得上（xiuchao / garden / workkk / leto），
// 这样 run-actions 那边拿到 kind 就能直接开对应那一本。
export const BOOKS = {
  xiuchao: { title: '锈潮纪事', what: '星落村里那些路、那些人、做到哪一步' },
  garden: { title: '花园日志', what: '种了什么、几天浇一次、哪块地是谁的' },
  workkk: { title: '上班笔记', what: '这份工怎么干、钱怎么算、下次从哪接' },
  leto: { title: 'Leto 见闻', what: '那边的人、小岛怎么干活、东西什么价' },
};

export const SLUGS = Object.keys(BOOKS);
export const isBook = (slug) => Object.hasOwn(BOOKS, String(slug ?? '').trim());
export const titleOf = (slug) => BOOKS[slug]?.title ?? slug;

// 三类板块。顺序就是页面和读取时的显示顺序。
export const SECTIONS = {
  diary: { title: '日记', what: '今天在那边做了什么，一天一条' },
  guide: { title: '攻略', what: '摸到的门道、规则、价钱' },
  question: { title: '疑惑', what: '想不通的、要确认的' },
};
export const SECTION_KEYS = Object.keys(SECTIONS);
export const isSection = (s) => Object.hasOwn(SECTIONS, String(s ?? '').trim());
export const sectionTitleOf = (s) => SECTIONS[s]?.title ?? s;

// 现有条目和没明说的都算攻略。
const DEFAULT_SECTION = 'guide';

db.exec(`
CREATE TABLE IF NOT EXISTS note_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  author TEXT
);
CREATE INDEX IF NOT EXISTS idx_note_entries_slug ON note_entries (slug, updated_at);
CREATE TABLE IF NOT EXISTS note_reads (
  slug TEXT PRIMARY KEY,
  ts INTEGER NOT NULL
);
`);

// section 是 11-19 加的。表已经存在时 CREATE TABLE 不会补列，所以单独 ALTER。
// 已经加过就报 duplicate column name，吃掉。
try {
  db.exec(`ALTER TABLE note_entries ADD COLUMN section TEXT NOT NULL DEFAULT '${DEFAULT_SECTION}'`);
  console.log('notes: 给 note_entries 加了 section 列（现有条目归攻略）');
} catch {
  // 已经有这列了
}
try {
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_note_entries_section ON note_entries (slug, section, updated_at)'
  );
} catch {
  // 建不上索引不影响读写
}

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 今天零点。往期日记的锁要用它——按墙上时间（TIME_ZONE）而不是 UTC。
function todayStart(ms = Date.now()) {
  const p = wallParts(ms);
  return wallMidnight(p.y, p.m, p.d);
}

// 一本里的条目。最近改过的排最上面（小满：「点进去最新修改过的在最上面」）。
// 传 section 只要那一类。
export function listEntries(slug, section = null) {
  if (!isBook(slug)) return [];
  if (section && isSection(section)) {
    return stmt(
      `SELECT id, content, section, created_at, updated_at, author FROM note_entries
       WHERE slug = ? AND section = ? ORDER BY updated_at DESC, id DESC`
    ).all(slug, section);
  }
  return stmt(
    `SELECT id, content, section, created_at, updated_at, author FROM note_entries
     WHERE slug = ? ORDER BY updated_at DESC, id DESC`
  ).all(slug);
}

export function getEntry(id) {
  return stmt(
    'SELECT id, slug, content, section, created_at, updated_at, author FROM note_entries WHERE id = ?'
  ).get(Number(id));
}

// 今天的日记。一天一条，所以最多一条；没有就 null。
export function todayDiary(slug) {
  if (!isBook(slug)) return null;
  return (
    stmt(
      `SELECT id, content, section, created_at, updated_at, author FROM note_entries
       WHERE slug = ? AND section = 'diary' AND created_at >= ?
       ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(slug, todayStart()) ?? null
  );
}

// 这条还能不能改。往期日记不行，其他都行。
export function canEdit(entry) {
  if (!entry) return false;
  if (entry.section !== 'diary') return true;
  return entry.created_at >= todayStart();
}

// 添一条。返回新条目的编号——以后要改要删就用这个号。
export function addEntry(slug, content, author = 'assistant', section = DEFAULT_SECTION) {
  if (!isBook(slug)) throw new Error(`没有这本笔记：${slug}`);
  const text = String(content ?? '').trim();
  if (!text) throw new Error('条目是空的');
  const sec = isSection(section) ? section : DEFAULT_SECTION;
  const who = author === 'user' ? 'user' : 'assistant';
  const now = Date.now();
  const r = stmt(
    `INSERT INTO note_entries (slug, content, section, created_at, updated_at, author)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(slug, text, sec, now, now, who);
  console.log(
    `notes: 《${titleOf(slug)}》${sectionTitleOf(sec)}添了一条 #${r.lastInsertRowid}（${text.length} 字，${who}）`
  );
  return {
    id: Number(r.lastInsertRowid),
    slug,
    section: sec,
    chars: text.length,
    author: who,
    createdAt: now,
  };
}

// 改一条。created_at 不动——这条是什么时候摸出来的这件事没变。
// 往期日记拒绝（小满 11-19：「今天的能改。往期只能阅读」）。
export function editEntry(id, content, author = 'assistant') {
  const entry = getEntry(id);
  if (!entry) return null;
  if (!canEdit(entry)) {
    const day = formatDateTime(entry.created_at).slice(5, 10);
    throw new Error(`#${id} 是 ${day} 的日记，往期只能读不能改。要记今天的就改今天那条`);
  }
  const text = String(content ?? '').trim();
  if (!text) throw new Error('改成空的等于删，要删用 deleteEntry');
  const who = author === 'user' ? 'user' : 'assistant';
  const now = Date.now();
  stmt('UPDATE note_entries SET content = ?, updated_at = ?, author = ? WHERE id = ?').run(
    text,
    now,
    who,
    entry.id
  );
  console.log(`notes: 《${titleOf(entry.slug)}》改了 #${entry.id}（${text.length} 字，${who}）`);
  return {
    id: entry.id,
    slug: entry.slug,
    section: entry.section,
    chars: text.length,
    author: who,
    updatedAt: now,
  };
}

export function deleteEntry(id) {
  const entry = getEntry(id);
  if (!entry) return null;
  stmt('DELETE FROM note_entries WHERE id = ?').run(entry.id);
  console.log(`notes: 《${titleOf(entry.slug)}》删了 #${entry.id}`);
  return entry;
}

// ── 已读水位 ──
//
// 未读 = 他写的、而且比她上次看这本的时间新。她自己写的不算。

export function unreadCount(slug) {
  if (!isBook(slug)) return 0;
  const mark = stmt('SELECT ts FROM note_reads WHERE slug = ?').get(slug)?.ts ?? 0;
  return stmt(
    `SELECT COUNT(*) AS c FROM note_entries
     WHERE slug = ? AND author = 'assistant' AND updated_at > ?`
  ).get(slug, mark).c;
}

// 四本加起来。发现页那张卡上的数字就是它。
export function unreadTotal() {
  return SLUGS.reduce((n, slug) => n + unreadCount(slug), 0);
}

// 看过了。点进那一本的时候调，只清那一本。
export function markRead(slug) {
  if (!isBook(slug)) return;
  stmt(
    `INSERT INTO note_reads (slug, ts) VALUES (?, ?)
     ON CONFLICT(slug) DO UPDATE SET ts = excluded.ts`
  ).run(slug, Date.now());
}

// 四本的目录：多少条、多久没暨、有几条新的。不带正文。
// 最近改过的排最上面，一条都没的沉底。
export function listNotes() {
  const rows = stmt(
    `SELECT slug, COUNT(*) AS n, MAX(updated_at) AS last_at FROM note_entries GROUP BY slug`
  ).all();
  const byslug = new Map(rows.map((r) => [r.slug, r]));
  const last = stmt(
    `SELECT slug, author FROM note_entries WHERE updated_at = (
       SELECT MAX(updated_at) FROM note_entries e2 WHERE e2.slug = note_entries.slug
     ) GROUP BY slug`
  ).all();
  const authorOf = new Map(last.map((r) => [r.slug, r.author]));

  return SLUGS.map((slug) => {
    const r = byslug.get(slug);
    return {
      slug,
      title: BOOKS[slug].title,
      what: BOOKS[slug].what,
      count: r?.n ?? 0,
      empty: !r?.n,
      lastAt: r?.last_at ?? null,
      lastBy: authorOf.get(slug) ?? null,
      unread: unreadCount(slug),
    };
  }).sort((a, b) => (b.lastAt ?? 0) - (a.lastAt ?? 0));
}

// 一本里各板块几条。页面分段用。
export function sectionCounts(slug) {
  if (!isBook(slug)) return {};
  const rows = stmt(
    'SELECT section, COUNT(*) AS n FROM note_entries WHERE slug = ? GROUP BY section'
  ).all(slug);
  const out = {};
  for (const k of SECTION_KEYS) out[k] = 0;
  for (const r of rows) out[r.section] = r.n;
  return out;
}

const whoName = (a) => (a === 'user' ? USER_NAME : AI_NAME);
const when = (ts) => (ts ? formatDateTime(ts).slice(5) : '不详');

// 一条的时间怎么写。没改过就只写建的时候；改过就两个都写——
// 哪条是上周摸出来、今天才发现不对的，他自己要看得见。
export function stampOf(e) {
  const made = when(e.created_at);
  if (!e.updated_at || Math.abs(e.updated_at - e.created_at) < 60000) return made;
  return `${made} 记下，${when(e.updated_at)} 改过`;
}

// 给模型看的一段：开工前把对应那一本原文交给他。
// 按板块分段，编号要给——不给编号他没法说「改第几条」。
export function describeNote(slug) {
  if (!isBook(slug)) return `没有「${slug}」这本笔记。固定就四本：${SLUGS.join('、')}。`;
  const all = listEntries(slug);
  if (!all.length) {
    return [
      `《${titleOf(slug)}》还是空的——这是第一次。`,
      '',
      '这次做完之后把该留的添进去：今天做了什么（日记）、摸到的门道（攻略）、',
      '想不通的（疑惑）。',
    ].join('\n');
  }

  const today = todayDiary(slug);
  const lines = [`《${titleOf(slug)}》现在有 ${all.length} 条：`];

  for (const key of SECTION_KEYS) {
    const list = all.filter((e) => e.section === key);
    if (!list.length) continue;
    lines.push('', `【${SECTIONS[key].title}】`);
    for (const e of list) {
      const mark =
        key === 'diary'
          ? today && e.id === today.id
            ? ' ← 今天这条，还能改'
            : '（往期，只能读）'
          : '';
      lines.push(`#${e.id}　[${stampOf(e)}]${mark}\n${e.content}`);
    }
  }

  if (!today) {
    lines.push('', '今天的日记还没开——这一轮做了事就添一条新的。');
  }
  return lines.join('\n');
}

// 收工时那句话。跟 describeNote 分开：那一段是给料，这一段是讨文。
export function updatePrompt(slug) {
  const today = todayDiary(slug);
  const isLeto = slug === 'leto';

  const diaryLine = today
    ? `今天的日记是 #${today.id}（已经 ${today.content.length} 字）。这一轮做的事用 edit 追到那条后面，别另开新的。`
    : '今天的日记还没开，用 add 开一条（section 填 "diary"）。';

  return [
    `这一轮完了。《${titleOf(slug)}》要改什么吗？`,
    '',
    '**只动变了的部分，别重写没变的条目。** 三种动作：',
    '  add    添一条（要带 section）',
    '  edit   改那一条（用上面的 #号）',
    '  delete 删掉（用 #号）',
    '',
    '三个板块：',
    `  diary    日记。${
      isLeto
        ? '开头写日期 + 小岛第几天（看岛那里写着），然后记这一天干了什么'
        : '今天做了什么'
    }。一天一条`,
    '  guide    攻略。规则、价钱、门道、踩过的坑——这些不跟日期绑定',
    '  question 疑惑。想不通的、要确认的。想通了就 delete 掉或者改成 guide',
    '',
    diaryLine,
    `日记一天大概 ${isLeto ? '400–500' : '300'} 字就够，记真做过的事，不必写感想。`,
    '**往期日记改不了**，那些已经封了——只能读，要记就记今天这条。',
    '',
    '攻略和疑惑一直可以改。一条写一件事，别把三件塞在一条里——',
    '以后只改其中一件就难办了。',
    '',
    '一条：只写真做过的。没成的就写没成，别编。',
    '',
    '只返回一个 JSON 对象，不要任何其他文字：',
    '{"add": [{"section": "diary", "content": "…"}], "edit": [{"id": 3, "content": "…"}], "delete": [7]}',
    'add 里每条要带 section；只给字符串也收，归到攻略。',
    '哪一类没有就省略掉。这一轮没什么值得改的就给 {}。',
  ].join('\n');
}
