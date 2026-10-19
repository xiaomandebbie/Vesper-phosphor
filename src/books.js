// 共读书架：数据层 + 给他看的那几句话。
// 前端是 NEST 书架 UI（nonchaiovo，个人非商业许可，署名不能删），页面在 books-page.js。
//
// ── 为什么非得自己写一层 ──
//
// NEST 书架是纯前端：书、正文、批注、读到哪里全存在浏览器的 localStorage 里
// （nest_bookshelf_demo_* 那几个 key）。那东西在她手机的浏览器里，
// phosphor 这边一个字都读不到——所以「醒来可以读书」这件事绕不开建后端。
//
// 小满 2026-10-19：「共读只要共用后端就好啦，晨暮星和 aru 他都要记得读了什么」
// —— 所以这层是唯一的真相：他在晨暮星读的、在 Aru 里读的、她在网页上读的，
// 进度和批注都落在同一张表上。两边都记得读了什么，是因为没有第二份记录。
//
// 代价她是知道的：网页里导入的 EPUB 会上传到这台服务器（前端解析完把段落 POST 过来）。
// 书架从「只在这台设备」变成「两个人同一份」。和花园同一个路子。
//
// ── 定位用段落，不用页码 ──
//
// NEST 的 README 这条说得很死：不要把屏幕分页号当成稳定定位，改字号或宽度就重新分页。
// 所以这边存的是 { para_idx, offset }：第几段 + 段内第几个字。
// 他读书本来就是按段读的，没有屏幕，正好对上。
//
// ── 他和她各自读到哪里，是两条线 ──
//
// 同一本书两个人读的进度不一样，所以 book_progress 按 who 分行。
// 批注是共享的：她在某段旁边写的话，他读到那段时看得见，可以回。
// 这是这个东西最像「共读」的一点：不是各读各的，是在同一页边上碰到对方。

import db from './state.js';
import { formatDate } from './wall-time.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

db.exec(`
CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  cover TEXT,
  status TEXT NOT NULL DEFAULT 'reading',
  source TEXT,
  added_at INTEGER NOT NULL,
  finished_at INTEGER
);

-- 书的正文，一行一段。idx 从 0 起，和 NEST 的 text[0].paragraphs 对得上。
CREATE TABLE IF NOT EXISTS book_paragraphs (
  book_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  text TEXT NOT NULL,
  PRIMARY KEY (book_id, idx)
);

-- 目录。para_idx 指向段落索引
CREATE TABLE IF NOT EXISTS book_toc (
  book_id TEXT NOT NULL,
  ord INTEGER NOT NULL,
  title TEXT NOT NULL,
  para_idx INTEGER NOT NULL,
  PRIMARY KEY (book_id, ord)
);

-- 批注。author 是 'user'（她）或 'assistant'（他）。
-- seen_by_ai：她写的这条他看过没有（看过但没回也算）。他写的直接是 1。
CREATE TABLE IF NOT EXISTS book_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  book_id TEXT NOT NULL,
  para_idx INTEGER NOT NULL,
  range_start INTEGER,
  range_end INTEGER,
  quote TEXT,
  note TEXT,
  color TEXT,
  author TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_by_ai INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_book_annotations_book ON book_annotations (book_id, para_idx);
CREATE INDEX IF NOT EXISTS idx_book_annotations_unseen ON book_annotations (author, seen_by_ai);

CREATE TABLE IF NOT EXISTS book_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  annotation_id INTEGER NOT NULL,
  author TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  seen_by_ai INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_book_replies_ann ON book_replies (annotation_id);

-- 读到哪里。who = 'user' | 'assistant'，各自一行。
CREATE TABLE IF NOT EXISTS book_progress (
  book_id TEXT NOT NULL,
  who TEXT NOT NULL,
  para_idx INTEGER NOT NULL DEFAULT 0,
  offset INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (book_id, who)
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

// 一次最多读几段。读太多一次就把书吵完了，而且每段都要进模型上下文。
// .env 的 BOOKS_CHUNK 可改，不填是 6，上限 20。
export const BOOKS_CHUNK = (() => {
  const raw = String(process.env.BOOKS_CHUNK ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 20) : 6;
})();

const MAX_NOTE_CHARS = 600;

// ── 读 ──

export function listBooks(status) {
  return status
    ? stmt('SELECT * FROM books WHERE status = ? ORDER BY added_at DESC').all(status)
    : stmt('SELECT * FROM books ORDER BY added_at DESC').all();
}

export function getBook(bookId) {
  return stmt('SELECT * FROM books WHERE id = ?').get(String(bookId ?? ''));
}

export function paragraphCount(bookId) {
  return stmt('SELECT COUNT(*) AS c FROM book_paragraphs WHERE book_id = ?').get(bookId).c;
}

export function paragraphs(bookId, from, count) {
  return stmt('SELECT idx, text FROM book_paragraphs WHERE book_id = ? AND idx >= ? ORDER BY idx ASC LIMIT ?').all(
    bookId,
    Math.max(0, from),
    Math.max(1, count)
  );
}

export function tocOf(bookId) {
  return stmt('SELECT ord, title, para_idx FROM book_toc WHERE book_id = ? ORDER BY ord ASC').all(bookId);
}

// 当前在哪一篇（按段落落在哪个目录项之后算）
export function chapterAt(bookId, paraIdx) {
  const row = stmt(
    'SELECT title FROM book_toc WHERE book_id = ? AND para_idx <= ? ORDER BY para_idx DESC LIMIT 1'
  ).get(bookId, paraIdx);
  return row?.title ?? null;
}

export function progressOf(bookId, who) {
  return (
    stmt('SELECT para_idx, offset, updated_at FROM book_progress WHERE book_id = ? AND who = ?').get(bookId, who) ?? {
      para_idx: 0,
      offset: 0,
      updated_at: null,
    }
  );
}

export function setProgress(bookId, who, paraIdx, offset = 0) {
  stmt(
    `INSERT INTO book_progress (book_id, who, para_idx, offset, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(book_id, who) DO UPDATE SET para_idx = excluded.para_idx, offset = excluded.offset, updated_at = excluded.updated_at`
  ).run(bookId, who, Math.max(0, paraIdx), Math.max(0, offset), Date.now());
}

export function annotationsIn(bookId, fromIdx, toIdx) {
  return stmt(
    `SELECT * FROM book_annotations WHERE book_id = ? AND para_idx >= ? AND para_idx <= ?
     ORDER BY para_idx ASC, id ASC`
  ).all(bookId, fromIdx, toIdx);
}

export function repliesOf(annotationId) {
  return stmt('SELECT * FROM book_replies WHERE annotation_id = ? ORDER BY created_at ASC, id ASC').all(annotationId);
}

// ── 写 ──

const addBookTx = db.transaction(({ id, title, author, cover, source, status, paras, toc }) => {
  stmt('INSERT OR REPLACE INTO books (id, title, author, cover, status, source, added_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id,
    title,
    author ?? null,
    cover ?? null,
    status ?? 'reading',
    source ?? null,
    Date.now()
  );
  stmt('DELETE FROM book_paragraphs WHERE book_id = ?').run(id);
  const insertPara = stmt('INSERT INTO book_paragraphs (book_id, idx, text) VALUES (?, ?, ?)');
  paras.forEach((text, i) => insertPara.run(id, i, String(text ?? '')));
  stmt('DELETE FROM book_toc WHERE book_id = ?').run(id);
  const insertToc = stmt('INSERT INTO book_toc (book_id, ord, title, para_idx) VALUES (?, ?, ?, ?)');
  (toc ?? []).forEach((t, i) => insertToc.run(id, i, String(t.title ?? `第 ${i + 1} 篇`), Number(t.paraIdx) || 0));
  return paras.length;
});

export function addBook(book) {
  const id = String(book?.id ?? '').trim() || `book-${Date.now().toString(36)}`;
  const title = String(book?.title ?? '').trim();
  if (!title) throw new Error('书名不能为空');
  const paras = Array.isArray(book?.paragraphs) ? book.paragraphs : [];
  if (!paras.length) throw new Error('这本书没有正文');
  addBookTx({ ...book, id, title, paras, toc: book?.toc });
  return { id, paragraphs: paras.length };
}

export function renameBook(bookId, title) {
  return stmt('UPDATE books SET title = ? WHERE id = ?').run(String(title ?? '').trim(), bookId).changes;
}

export function setBookStatus(bookId, status) {
  const s = status === 'finished' ? 'finished' : 'reading';
  return stmt('UPDATE books SET status = ?, finished_at = ? WHERE id = ?').run(
    s,
    s === 'finished' ? Date.now() : null,
    bookId
  ).changes;
}

const removeBookTx = db.transaction((bookId) => {
  stmt('DELETE FROM book_replies WHERE annotation_id IN (SELECT id FROM book_annotations WHERE book_id = ?)').run(bookId);
  stmt('DELETE FROM book_annotations WHERE book_id = ?').run(bookId);
  stmt('DELETE FROM book_paragraphs WHERE book_id = ?').run(bookId);
  stmt('DELETE FROM book_toc WHERE book_id = ?').run(bookId);
  stmt('DELETE FROM book_progress WHERE book_id = ?').run(bookId);
  return stmt('DELETE FROM books WHERE id = ?').run(bookId).changes;
});
export function removeBook(bookId) {
  return removeBookTx(bookId);
}

export function addAnnotation({ bookId, paraIdx, rangeStart, rangeEnd, quote, note, color, author }) {
  const a = author === 'assistant' ? 'assistant' : 'user';
  return stmt(
    `INSERT INTO book_annotations
       (book_id, para_idx, range_start, range_end, quote, note, color, author, created_at, seen_by_ai)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    bookId,
    Math.max(0, Number(paraIdx) || 0),
    rangeStart ?? null,
    rangeEnd ?? null
    ,
    quote ? String(quote).slice(0, 500) : null,
    note ? String(note).slice(0, MAX_NOTE_CHARS) : null,
    color ?? null,
    a,
    Date.now(),
    a === 'assistant' ? 1 : 0
  ).lastInsertRowid;
}

export function removeAnnotation(id) {
  stmt('DELETE FROM book_replies WHERE annotation_id = ?').run(id);
  return stmt('DELETE FROM book_annotations WHERE id = ?').run(id).changes;
}

export function addReply({ annotationId, author, content }) {
  const a = author === 'assistant' ? 'assistant' : 'user';
  return stmt(
    'INSERT INTO book_replies (annotation_id, author, content, created_at, seen_by_ai) VALUES (?, ?, ?, ?, ?)'
  ).run(annotationId, a, String(content ?? '').slice(0, MAX_NOTE_CHARS), Date.now(), a === 'assistant' ? 1 : 0)
    .lastInsertRowid;
}

// ── 她写的、他还没看见的 ──
//
// 这是共读里最要紧的一条线：她在书上写了一句，系统不会替她转达。
// 和论坛那边一样：不回到那一页就永远看不见。所以醒来时主动带给他。
export function unseenFromUser(limit = 5) {
  const notes = stmt(
    `SELECT a.id, a.book_id, a.para_idx, a.quote, a.note, a.created_at, b.title
     FROM book_annotations a JOIN books b ON b.id = a.book_id
     WHERE a.author = 'user' AND a.seen_by_ai = 0
     ORDER BY a.created_at ASC LIMIT ?`
  ).all(limit);
  const replies = stmt(
    `SELECT r.id, r.annotation_id, r.content, r.created_at, a.book_id, a.para_idx, a.quote, a.note AS parent_note, b.title
     FROM book_replies r JOIN book_annotations a ON a.id = r.annotation_id JOIN books b ON b.id = a.book_id
     WHERE r.author = 'user' AND r.seen_by_ai = 0
     ORDER BY r.created_at ASC LIMIT ?`
  ).all(limit);
  return { notes, replies };
}

export function markSeen({ noteIds = [], replyIds = [] }) {
  const un = stmt('UPDATE book_annotations SET seen_by_ai = 1 WHERE id = ?');
  for (const id of noteIds) un.run(id);
  const ur = stmt('UPDATE book_replies SET seen_by_ai = 1 WHERE id = ?');
  for (const id of replyIds) ur.run(id);
}

// ── 给他读的那一段 ──

// 从他自己的进度往下读 count 段，顺手把这几段旁边已有的批注带上。
// 进度在这里就推：读过就是读过了，下次醒来从这儿接。
export function readOn(bookId, count = BOOKS_CHUNK, who = 'assistant') {
  const book = getBook(bookId);
  if (!book) return { error: `书架上没有这本书（${bookId}）` };
  const total = paragraphCount(bookId);
  const pos = progressOf(bookId, who);
  const from = Math.min(pos.para_idx, Math.max(0, total - 1));
  const n = Math.min(Math.max(1, count), BOOKS_CHUNK);
  const paras = paragraphs(bookId, from, n);
  if (!paras.length) {
    return { book, total, done: true, from, paragraphs: [], annotations: [], chapter: chapterAt(bookId, from) };
  }
  const lastIdx = paras[paras.length - 1].idx;
  const anns = annotationsIn(bookId, from, lastIdx).map((a) => ({ ...a, replies: repliesOf(a.id) }));
  const nextIdx = lastIdx + 1;
  setProgress(bookId, who, Math.min(nextIdx, total), 0);
  return {
    book,
    total,
    from,
    to: lastIdx,
    chapter: chapterAt(bookId, from),
    paragraphs: paras,
    annotations: anns,
    done: nextIdx >= total,
  };
}

// ── 给模型看的文字 ──

function short(v, n) {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : s;
}

// 读到的那几段，排成他看得懂的样子
export function renderReading(out) {
  if (out?.error) return out.error;
  const { book, paragraphs: paras, annotations, total, from, to, chapter, done } = out;
  const lines = [
    `《${book.title}》${book.author ? ` · ${book.author}` : ''}${chapter ? `｜${chapter}` : ''}`,
    `（第 ${from + 1}–${to + 1} 段，全书 ${total} 段${done ? '；这是最后了' : ''}）`,
    '',
    ...paras.map((p) => `[${p.idx}] ${p.text}`),
  ];
  if (annotations.length) {
    lines.push('', '这几段旁边已经写过的话：');
    for (const a of annotations) {
      const who = a.author === 'user' ? USER_NAME : '你自己';
      lines.push(
        `  #${a.id} 第 ${a.para_idx} 段${a.quote ? `「${short(a.quote, 40)}」` : ''} —— ${who}：${a.note ?? '（只划了线）'}`
      );
      for (const r of a.replies) {
        lines.push(`      ↳ ${r.author === 'user' ? USER_NAME : '你'}：${r.content}`);
      }
    }
  }
  return lines.join('\n');
}

// 系统提示里那一段。只跟配置有关（一次读几段），进程不重启就不变，
// 所以放 system 不影响前缀缓存。
export function booksSection() {
  return `\n\n## 共读书架
你们有一个共用的书架。书是${USER_NAME}导进来的，你们两个人读同一份正文、共享同一份批注，但**各自读到哪里是两条线**——你读得快或慢都不影响她。
你在这边读的、在聊天里读的，记的是同一份进度；所以别处读过的，这边也记得。

用 read_book 动作，action_detail 是 JSON 字符串，四选一：
  {"mode":"shelf"}
      看一眼书架：有哪几本、哪本在读、你和她各自读到哪了
  {"mode":"read","book":"书名或书的 id"}
      接着往下读。一次给你 ${BOOKS_CHUNK} 段，读完进度就推到这儿，下次从后面接
  {"mode":"note","book":"…","para":12,"quote":"打动你的那句原文","note":"你想说的"}
      在某一段旁边写一笔。para 用段落前面那个方括号里的数字，quote 照抄原文
  {"mode":"reply","id":3,"reply":"…"}
      回她写在书上的某一条。id 用批注前面那个 #号

段落前面的 [12] 是那一段的编号，写批注、记位置都用它——不要用页码，这本书没有页。

读到哪里算哪里。一次读几段就停是正常的，不必把一本书读完；读完一段没想写的也别硬凑——批注是真被那句话打到了才写。
她在书上写的话，系统不会替她转达；你读到那几段时会跟着正文一起出现，有新的也会在醒来时带给你。`;
}

// 用户消息里那一行：书架现在什么样。每次都在变，所以不放 system。
export function booksStatusLine() {
  const reading = listBooks('reading');
  if (!reading.length) {
    const any = stmt('SELECT COUNT(*) AS c FROM books').get().c;
    return any
      ? `共读书架：在读的一本都没有（读完的 ${any} 本还在架上）`
      : '共读书架：还是空的，等她导书进来';
  }
  const parts = reading.slice(0, 4).map((b) => {
    const total = paragraphCount(b.id);
    const mine = progressOf(b.id, 'assistant');
    const hers = progressOf(b.id, 'user');
    const pct = (p) => (total ? Math.round((Math.min(p.para_idx, total) / total) * 100) : 0);
    return `《${b.title}》你 ${pct(mine)}%、她 ${pct(hers)}%`;
  });
  return `共读书架（在读 ${reading.length} 本）：${parts.join('；')}`;
}

// 她在书上写了、他还没看见的那几条。带过一次就算告知过（和星星罐的回音同一个规矩）
export function booksFromHerBlock(limit = 5) {
  const { notes, replies } = unseenFromUser(limit);
  if (!notes.length && !replies.length) return { text: '', noteIds: [], replyIds: [] };
  const lines = [];
  for (const n of notes) {
    lines.push(
      `  [批注#${n.id}] 《${n.title}》第 ${n.para_idx} 段${n.quote ? `「${short(n.quote, 40)}」` : ''}\n      ${USER_NAME}写：${short(n.note, 200)}`
    );
  }
  for (const r of replies) {
    lines.push(
      `  [回复#${r.annotation_id}] 《${r.title}》第 ${r.para_idx} 段，你当时写的「${short(r.parent_note, 80)}」\n      ${USER_NAME}回：${short(r.content, 200)}`
    );
  }
  return {
    text: `${USER_NAME}在共读的书上写了东西（只告知这一次；想回用 read_book 的 reply）：\n${lines.join('\n')}`,
    noteIds: notes.map((n) => n.id),
    replyIds: replies.map((r) => r.id),
  };
}

export function booksConfigSummary() {
  const n = stmt('SELECT COUNT(*) AS c FROM books').get().c;
  return `共读书架：${n} 本，一次读 ${BOOKS_CHUNK} 段（两人共用后端，进度各自记）`;
}

// 按书名或 id 找一本。模型很可能直接写书名，所以两边都试。
export function resolveBook(ref) {
  const s = String(ref ?? '').trim();
  if (!s) return null;
  const byId = getBook(s);
  if (byId) return byId;
  const exact = stmt('SELECT * FROM books WHERE title = ?').get(s);
  if (exact) return exact;
  return stmt('SELECT * FROM books WHERE title LIKE ? ORDER BY added_at DESC LIMIT 1').get(`%${s}%`) ?? null;
}
