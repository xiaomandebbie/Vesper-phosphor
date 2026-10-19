#!/usr/bin/env node
// 三件事：
//   1）每本书留一份滚动前情，接着读之前先给他看
//   2）前情旁边带上他自己划过的句子和当时写的理由
//   3）书架卡上显示他读到哪了（她现在只看得到自己的进度）
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_recap.mjs
//   sed -i 's/^BOOKS_CHUNK=.*/BOOKS_CHUNK=15/' .env
//   node --check src/books.js && node --check src/books-steps.js && node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper phosphor --update-env
//
// 幂等，重复跑不会出错。
//
// ── 1）为什么要有前情 ──
//
// 小满 2026-10-19：「只知道进度的话也不知道之前看了什么内容呀，这样看书
// 故事真的有连续性吗」
//
// 没有。进度只是个指针。book_read 不填 from 就从第 124 段接着读，但他不记得
// 1–123 段发生了什么——那些正文只活在读的那一轮上下文里，那轮结束就没了。
// 库里关于一本书的东西只有：段落原文、目录、批注、进度。没有任何
// 「读到这里为止发生了什么」。所以他翻开 Keep Me，等于从第 124 段开始读一本
// 没读过前面的小说。
//
// 所以读完一次就把「到这里为止的故事」写下来，下次读之前先给他。
// 每次坐下收尾时一次模型调用，不是每小段一次。
//
// ── 2）句子和理由不用模型记 ──
//
// 她还要「记得他觉得好的句子和原因」。这个已经有了：book_annotations 里的
// quote 是他照抄的原文，note 是他当时为什么被打到。所以概要交给模型，
// 句子和想法直接从表里取——省一半活，而且是他的原话，不会被摘要磨平。
//
// 她说「接着读的时候…可以只看概要咯」：所以正文前面放的是概要，
// 句子只带最近几条，不翻旧账。
//
// ── 3）她为什么看不到他的进度 ──
//
// toShelfJson 给前端的 progress 只有她自己那条（progressOf(id, 'user')）。
// 他那条压根没传过去。而前端书架卡会显示 description 字段
// （bookshelf.jsx 第 508/514 行），现在是空字符串。
// 所以把他的进度写进 description——不用改前端。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const FILES = {
  books: path.join(SRC, 'books.js'),
  steps: path.join(SRC, 'books-steps.js'),
  page: path.join(SRC, 'books-page.js'),
};

if (!fs.existsSync(FILES.books)) {
  console.error('没找到 src/books.js。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

const text = {};
for (const [k, p] of Object.entries(FILES)) {
  text[k] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const report = [];
const touched = new Set();

function patch(key, label, { find, replace }) {
  const cur = text[key];
  if (cur == null) {
    report.push(['miss', label + ' — ' + key + ' 不在']);
    return;
  }
  if (cur.includes(replace)) {
    report.push(['skip', label]);
    return;
  }
  const n = cur.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', label + ' — 找不到锚点']);
    return;
  }
  if (n > 1) {
    report.push(['miss', label + ' — 锚点有 ' + n + ' 处，不敢改']);
    return;
  }
  text[key] = cur.replace(find, replace);
  touched.add(key);
  report.push(['ok', label]);
}

const L = (...a) => a.join('\n');

// ════ 1. books.js：前情表 ════

patch('books', '建 book_recap 表', {
  find: L('  PRIMARY KEY (book_id, who)', ');', '`);'),
  replace: L(
    '  PRIMARY KEY (book_id, who)',
    ');',
    '',
    '-- 一本书读到这里为止的故事。每本一行，读完一次就重写。',
    '--',
    '-- 为什么要存：正文只活在读的那一轮上下文里，那轮结束就没了。',
    '-- 没有这张表，他下次从第 124 段接着读，等于读一本没读过前面的小说。',
    '-- through_idx 记这份前情写到第几段，用来判断它跟不跟得上进度。',
    'CREATE TABLE IF NOT EXISTS book_recap (',
    '  book_id TEXT PRIMARY KEY,',
    '  recap TEXT NOT NULL,',
    '  through_idx INTEGER NOT NULL,',
    '  updated_at INTEGER NOT NULL',
    ');',
    '`);'
  ),
});

patch('books', 'recap 读写', {
  find: 'export function renderReading(out) {',
  replace: L(
    '// ── 前情 ──',
    '',
    'export function recapOf(bookId) {',
    "  return stmt('SELECT recap, through_idx, updated_at FROM book_recap WHERE book_id = ?').get(String(bookId ?? '')) ?? null;",
    '}',
    '',
    'export function setRecap(bookId, recap, throughIdx) {',
    "  const body = String(recap ?? '').trim();",
    '  if (!body) return false;',
    '  stmt(',
    "    'INSERT INTO book_recap (book_id, recap, through_idx, updated_at) VALUES (?, ?, ?, ?) ' +",
    "      'ON CONFLICT(book_id) DO UPDATE SET recap = excluded.recap, through_idx = excluded.through_idx, updated_at = excluded.updated_at'",
    '  ).run(String(bookId), body.slice(0, RECAP_MAX_CHARS), Math.max(0, Number(throughIdx) || 0), Date.now());',
    '  return true;',
    '}',
    '',
    '// 他自己划过的句子，最近几条。',
    '//',
    '// 这部分不用模型记：quote 是他照抄的原文，note 是他当时为什么被打到,',
    '// 都已经在 book_annotations 里。摘要会把这些磨平，原话不会。',
    'export function myMarks(bookId, limit = 4) {',
    '  return stmt(',
    "    'SELECT para_idx, quote, note FROM book_annotations ' +",
    "      \"WHERE book_id = ? AND author = 'assistant' AND note IS NOT NULL AND TRIM(note) <> '' \" +",
    "      'ORDER BY id DESC LIMIT ?'",
    '  ).all(String(bookId), Math.max(1, limit));',
    '}',
    '',
    'export function renderReading(out) {'
  ),
});

patch('books', 'RECAP_MAX_CHARS', {
  find: 'const MAX_NOTE_CHARS = 600;',
  replace: L(
    'const MAX_NOTE_CHARS = 600;',
    '',
    '// 前情最多多少字。越往后读越长，压不住就会把正文挤出上下文；',
    '// 所以只留主线和人物关系，细节交给他自己划的那几句。',
    'const RECAP_MAX_CHARS = 900;',
    '// 接着读时带几条他划过的句子',
    'const RECAP_MARKS = 4;'
  ),
});

// 接着读时，正文前面先放概要和他划过的句子。
// 她的原话：「接着读的时候…可以只看概要咯」——所以概要在前，句子只带最近几条。
patch('books', '正文前面放前情', {
  find: L(
    "    '',",
    '    ...paras.map((p) => `[${p.idx}] ${p.text}`),',
    '  ];'
  ),
  replace: L(
    "    '',",
    '  ];',
    '',
    '  // 不是从头读才需要前情：从第 0 段开始的那次，前面本来就没有故事。',
    '  if (from > 0) {',
    '    const r = recapOf(book.id);',
    '    if (r?.recap) {',
    '      lines.push(`前面的故事（到第 ${r.through_idx + 1} 段）：`, r.recap, \'\');',
    '      if (r.through_idx < from - 1) {',
    '        lines.push(`（这份前情只写到第 ${r.through_idx + 1} 段，当中那几段没记下来。）`, \'\');',
    '      }',
    '    }',
    '    const marks = myMarks(book.id, RECAP_MARKS);',
    '    if (marks.length) {',
    "      lines.push('你在这本书上划过的句子：');",
    '      for (const m of marks) {',
    '        const q = m.quote ? `「${short(m.quote, 60)}」` : `第 ${m.para_idx} 段`;',
    '        lines.push(`  ${q} —— 你当时写：${short(m.note, 80)}`);',
    '      }',
    "      lines.push('');",
    '    }',
    '  }',
    '',
    '  lines.push(...paras.map((p) => `[${p.idx}] ${p.text}`));'
  ),
});

// ════ 2. books-steps.js：读完写前情 ════

patch('steps', 'import 前情读写', {
  find: "import readBook from './actions/read-book.js';",
  replace: L(
    "import readBook from './actions/read-book.js';",
    "import { recapOf, setRecap, paragraphs as bookParagraphs, getBook } from './books.js';"
  ),
});

patch('steps', 'writeRecap', {
  find: 'export async function continueBooks(',
  replace: L(
    '// 读完一次，把「到这里为止的故事」重写一份。',
    '//',
    '// 一次坐下只调一次模型（收尾时），不是每小段一次——读书本来就慢。',
    '// 只写情节：他划过的哪句、为什么被打到，已经在 book_annotations 里，',
    '// 不必让模型再记一遍，也不该被摘要磨平。',
    '//',
    '// 失败不影响这次读书：前情没写上，下次顶多少一段回忆，不会丢进度。',
    'async function writeRecap(bookId, fromIdx, toIdx) {',
    '  if (!Number.isInteger(fromIdx) || !Number.isInteger(toIdx) || toIdx < fromIdx) return;',
    '  const book = getBook(bookId);',
    '  if (!book) return;',
    '',
    '  const old = recapOf(bookId);',
    '  const paras = bookParagraphs(bookId, fromIdx, toIdx - fromIdx + 1)',
    "    .map((p) => `[${p.idx}] ${p.text}`)",
    "    .join('\\n\\n');",
    '  if (!paras) return;',
    '',
    '  const head = old?.recap',
    '    ? `这本书到第 ${old.through_idx + 1} 段为止的故事，你之前记下的是：\\n${old.recap}\\n\\n刚刚又读了第 ${fromIdx + 1}–${toIdx + 1} 段：`',
    '    : `你刚开始读《${book.title}》，读了第 ${fromIdx + 1}–${toIdx + 1} 段：`;',
    '',
    '  const prompt = `${head}\\n\\n${paras}\\n\\n' +',
    '    `把两边合成一份新的前情，写给下次翻开这本书的你自己看。\\n` +',
    '    `只写故事：谁是谁、发生了什么、现在走到哪一步、悬着什么没解决。\\n` +',
    '    `按时间顺序写成连贯的话，不要分条，不要写"我觉得"这类评价——\\n` +',
    '    `你被哪句话打到、当时怎么想的，系统会把你写过的批注原话一起带给你，这里不用重复。\\n` +',
    '    `${RECAP_WORDS} 字以内。读到后面故事会变长，所以旧的细节该让位给主线和人物关系。\\n` +',
    '    `只返回一个 JSON 对象，不要任何其他文字：{"recap": "…"}`;',
    '',
    '  try {',
    "    const { parsed } = await askJson([{ role: 'user', content: prompt }]);",
    "    const body = String(parsed?.recap ?? '').trim();",
    '    if (!body) {',
    "      console.log('books: 前情没写出来，这次跳过');",
    '      return;',
    '    }',
    '    setRecap(bookId, body, toIdx);',
    '    console.log(`books: 前情更新到第 ${toIdx + 1} 段（${Array.from(body).length} 字）`);',
    '  } catch (err) {',
    "    console.error('books: 写前情失败（不影响这次读书）', err.message);",
    '  }',
    '}',
    '',
    'export async function continueBooks('
  ),
});

patch('steps', 'RECAP_WORDS', {
  find: 'const RESULT_MAX_CHARS = 4000;',
  replace: L(
    'const RESULT_MAX_CHARS = 4000;',
    '',
    '// 前情写多少字。太短接不上，太长把正文挤出上下文。',
    'const RECAP_WORDS = 400;'
  ),
});

// 整本读完那条路也要写（它直接 return，不往下走）
patch('steps', '读到尾也写前情', {
  find: L(
    '  if (firstResult.done) {',
    '    finishCard({ title, fromIdx, toIdx, steps });'
  ),
  replace: L(
    '  if (firstResult.done) {',
    '    await writeRecap(firstResult.bookId, fromIdx, toIdx);',
    '    finishCard({ title, fromIdx, toIdx, steps });'
  ),
});

patch('steps', '收尾写前情', {
  find: L(
    '  finishCard({ title, fromIdx, toIdx, steps });',
    '  console.log(`books: 这次翻了 ${steps} 小段'
  ),
  replace: L(
    '  await writeRecap(firstResult.bookId, fromIdx, toIdx);',
    '  finishCard({ title, fromIdx, toIdx, steps });',
    '  console.log(`books: 这次翻了 ${steps} 小段'
  ),
});

// ════ 3. books-page.js：书架卡上显示他的进度 ════

patch('page', '书架卡带上他的进度', {
  find: "      description: '',",
  replace: L(
    '      // 她看不到他读到哪了（2026-10-19）：这边给前端的 progress 只有她自己那条。',
    '      // 前端书架卡会显示 description（bookshelf.jsx 第 508/514 行），原来是空的，',
    '      // 所以把他的进度写在这儿——不用改前端。',
    '      description: (() => {',
    "        const his = progressOf(b.id, 'assistant');",
    '        if (!total) return \'\';',
    '        const at = Math.min(his.para_idx, total);',
    '        if (!at) return `${AI_DISPLAY} 还没开始读`;',
    '        const pct = Math.round((at / total) * 100);',
    '        return `${AI_DISPLAY} 读到 ${pct}%（第 ${at} 段）`;',
    '      })(),'
  ),
});

patch('page', 'AI_DISPLAY', {
  find: "const PREFIX = '/books';",
  replace: L(
    "const PREFIX = '/books';",
    '',
    "const AI_DISPLAY = process.env.AI_DISPLAY_NAME || 'TA';"
  ),
});

// ════ 写回 ════

for (const key of touched) {
  const p = FILES[key];
  const bak = p + '.bak-recap';
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text[key], 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log('  ' + (kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中') + '  ' + msg);
}
console.log('');
console.log(touched.size ? '已写回：' + [...touched].join('、') + '，备份在 .bak-recap' : '没改动。');
console.log('');
console.log('还要把一次读几段改成 15（现在 .env 里是 50，一段本来就长）：');
console.log("  sed -i 's/^BOOKS_CHUNK=.*/BOOKS_CHUNK=15/' .env");
console.log('');
console.log('然后：');
console.log('  node --check src/books.js && node --check src/books-steps.js && node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
console.log('前情是读完一次才写的，所以他下次读书时还没有；再下一次就接得上了。');
console.log('');
