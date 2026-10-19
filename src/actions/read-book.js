// read_book：翻开共读书架。四种用法——看书架、往下读、写批注、回她一句。
//
// 这是 2 级动作（见 budget.js）：坐下来读书跟上班、种地、进锈潮是一个量级。
// 读完一段可以接着读或者写一笔（见 books-steps.js）。
//
// 返回的形状和其他 action 一样：成功给对象，失败给 { isError, text }。
// 行为卡片由 activity.js 负责（wire 脚本给它加了 read_book 的说法）。

import {
  listBooks,
  paragraphCount,
  progressOf,
  readOn,
  renderReading,
  addAnnotation,
  addReply,
  resolveBook,
  chapterAt,
  BOOKS_CHUNK,
} from '../books.js';
import db from '../state.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

const fail = (text) => ({ isError: true, text: String(text) });

function shelfText() {
  const all = listBooks();
  if (!all.length) return '书架还是空的。等她导几本书进来再说。';
  const lines = all.map((b) => {
    const total = paragraphCount(b.id);
    const mine = progressOf(b.id, 'assistant');
    const hers = progressOf(b.id, 'user');
    const pct = (p) => (total ? Math.round((Math.min(p.para_idx, total) / total) * 100) : 0);
    const where = chapterAt(b.id, mine.para_idx);
    return (
      `  《${b.title}》${b.author ? ` · ${b.author}` : ''}${b.status === 'finished' ? '（读完了）' : ''}\n` +
      `      你读到 ${pct(mine)}%（第 ${mine.para_idx} 段${where ? `，${where}` : ''}），${USER_NAME} ${pct(hers)}%，全书 ${total} 段\n` +
      `      id：${b.id}`
    );
  });
  return `书架上有 ${all.length} 本：\n${lines.join('\n')}`;
}

export default async function readBook(detail) {
  let j;
  try {
    j = detail ? JSON.parse(detail) : {};
  } catch {
    return fail('read_book 的 action_detail 要是 JSON 字符串，比如 {"mode":"read","book":"书名"}');
  }
  const mode = String(j?.mode ?? 'shelf').trim();

  if (mode === 'shelf') {
    return { mode, text: shelfText() };
  }

  if (mode === 'read') {
    const book = resolveBook(j.book);
    if (!book) return fail(`书架上找不到「${j.book ?? ''}」。先用 {"mode":"shelf"} 看一眼有哪几本。`);
    const count = Number.isInteger(Number(j.count)) ? Number(j.count) : BOOKS_CHUNK;
    const out = readOn(book.id, count, 'assistant');
    if (out.error) return fail(out.error);
    return { mode, bookId: book.id, title: book.title, from: out.from, to: out.to, done: out.done, text: renderReading(out) };
  }

  if (mode === 'note') {
    const book = resolveBook(j.book);
    if (!book) return fail(`书架上找不到「${j.book ?? ''}」。`);
    const para = Number(j.para);
    if (!Number.isInteger(para) || para < 0) {
      return fail('para 要是段落编号（正文里方括号里那个数字）。');
    }
    const total = paragraphCount(book.id);
    if (para >= total) return fail(`《${book.title}》只有 ${total} 段，没有第 ${para} 段。`);
    const note = String(j.note ?? '').trim();
    if (!note) return fail('批注写点什么吧——note 是空的。只想划线不必占这次动作。');
    const id = addAnnotation({
      bookId: book.id,
      paraIdx: para,
      quote: j.quote ?? null,
      note,
      color: j.color ?? null,
      author: 'assistant',
    });
    return { mode, bookId: book.id, title: book.title, annotationId: id, text: `写在了《${book.title}》第 ${para} 段旁边（批注#${id}）：\n${note}` };
  }

  if (mode === 'reply') {
    const id = Number(j.id);
    if (!Number.isInteger(id)) return fail('id 要是批注前面那个 #号。');
    const row = db.prepare('SELECT a.id, a.note, a.author, b.title FROM book_annotations a JOIN books b ON b.id = a.book_id WHERE a.id = ?').get(id);
    if (!row) return fail(`没有批注#${id}。读到那几段时带出来的那些才有 #号。`);
    const reply = String(j.reply ?? '').trim();
    if (!reply) return fail('reply 是空的。');
    addReply({ annotationId: id, author: 'assistant', content: reply });
    return { mode, annotationId: id, text: `回了《${row.title}》里那条批注（#${id}）：\n${reply}` };
  }

  return fail(`read_book 没有 ${mode} 这种用法。只有 shelf / read / note / reply。`);
}
