#!/usr/bin/env node
// 批注高亮画错位置——按引文在段落里的真实位置画，找不到就不画。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_quote_span.mjs
//   node --check src/books.js && node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper phosphor --update-env
//
// 幂等，重复跑不会出错。
//
// ── 怎么回事 ──
//
// 2026-10-19 小满：「标记的句子和实际的不一致」
//
// 图里黄条从段首 "You've arrived at your destination," 开始，停在
// announ 这个词中间；而那条批注的引文是
// "Don't talk to me like that, Sylvie. I'm not afraid."
//
// 因为：他写批注只给 para + quote（见 actions/read-book.js 的 note 模式）。
// 他看到的是「[87] 正文…」这种段号，根本没有「字符偏移量」这个概念。
// 于是 range_start / range_end 存成 null，toShelfJson 再拿 0 和
// quote.length 兜底，而前端画高亮是按字符位置切的：
//
//   bookshelf.jsx 的 ReaderParagraph：text.slice(rangeStart, rangeEnd)
//
// 所以高亮**永远从段首开始、长度等于引文**。这本书一段就是一整章，
// 所以段号是对的，错的是段内位置。
//
// ── 改法 ──
//
// 写进去的时候就把 quote 在那一段里找出来，算出真实位置。
// 书里是弯引号和长破折号，他照拄时常写成直引号，所以比对前先归一化。
// 找不到就留 null——前端会跳过不画（它要求 rangeStart 和 rangeEnd 都非
// null 且 start < end）。宁可不画高亮，也不要画错一条：批注本文和引文还在，
// 读的人不会被一条指错地方的黄条误导。

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const SRC = path.join(process.cwd(), 'src');
const FILES = {
  books: path.join(SRC, 'books.js'),
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
    report.push(['miss', `${label} — ${key} 不在`]);
    return;
  }
  if (cur.includes(replace)) {
    report.push(['skip', label]);
    return;
  }
  const n = cur.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  text[key] = cur.replace(find, replace);
  touched.add(key);
  report.push(['ok', label]);
}

const L = (...lines) => lines.join('\n');

// ════ 1. books.js：把引文在段落里找出来 ════

patch('books', 'quoteSpanIn 助手', {
  find: 'export function addAnnotation({',
  replace: L(
    '// ── 批注落在段落里的哪一段字 ──',
    '//',
    '// 他写批注时只给 quote（照拄的原文），不给字符位置——他看到的是',
    '// 「[87] 正文…」这种段号，没有偏移量这个概念。',
    '// 而前端画高亮是按 rangeStart/rangeEnd 切那一段的字符',
    '//（bookshelf.jsx 的 ReaderParagraph：text.slice(s, e)）。',
    '//',
    '// 以前这里存 null，toShelfJson 再拿 0 和 quote.length 兜底，于是高亮',
    '// 永远从段首开始、长度等于引文—2026-10-19 小满看到的就是这个：',
    '// 黄条停在 announ 中间，而引文其实在这一段后面很远的地方。',
    '//',
    '// 书里是弯引号和长破折号，他照拄时常写成直引号，所以比对前先归一化；',
    '// 找不到就返回 null——宁可不画高亮，也不要画错。',
    'const QUOTE_PUNCT = {',
    '  \u2018: "\'", \u2019: "\'", \u201a: "\'", \u201b: "\'",',
    '  \u201c: \'"\', \u201d: \'"\', \u201e: \'"\', \u201f: \'"\',',
    "  \u2013: '-', \u2014: '-', \u2015: '-', \u2212: '-',",
    "  \u00a0: ' ', \u3000: ' ',",
    '};',
    '',
    '// 归一化，同时记下每个字符在原文里的位置。',
    '// 这份 map 是关键：匹配在归一化后的串上做，但位置要换算回原文，',
    '// 不然前端 slice 出来的还是错的。',
    'function normWithMap(s) {',
    '  const out = [];',
    '  const map = [];',
    '  let prevSpace = false;',
    '  for (let i = 0; i < s.length; i++) {',
    '    const raw = s[i];',
    '    if (/\\s/.test(raw)) {',
    '      if (prevSpace) continue;',
    '      prevSpace = true;',
    "      out.push(' ');",
    '      map.push(i);',
    '      continue;',
    '    }',
    '    prevSpace = false;',
    '    out.push((QUOTE_PUNCT[raw] ?? raw).toLowerCase());',
    '    map.push(i);',
    '  }',
    "  return { text: out.join(''), map };",
    '}',
    '',
    '// 返回 [start, end]（原文的字符下标），找不到返回 null。',
    'export function quoteSpanIn(bookId, paraIdx, quote) {',
    "  const q = String(quote ?? '').trim();",
    '  if (!q) return null;',
    '  const idx = Math.max(0, Number(paraIdx) || 0);',
    '  const row = paragraphs(bookId, idx, 1)[0];',
    '  if (!row || row.idx !== idx) return null;',
    "  const full = String(row.text ?? '');",
    '  const P = normWithMap(full);',
    '  const Q = normWithMap(q);',
    '  if (!Q.text) return null;',
    '',
    '  let at = P.text.indexOf(Q.text);',
    '  let exact = at >= 0;',
    '  if (!exact && Q.text.length > 24) {',
    '    // 省略号、破折号这些他可能写得不一样；用开头一截再找一次',
    '    at = P.text.indexOf(Q.text.slice(0, 24));',
    '  }',
    '  if (at < 0) return null;',
    '',
    '  const start = P.map[at];',
    '  let end;',
    '  if (exact) {',
    '    const lastNorm = Math.min(at + Q.text.length - 1, P.map.length - 1);',
    '    end = P.map[lastNorm] + 1;',
    '  } else {',
    '    // 只对上了开头：按引文原长度圈一段，大致落在对的地方',
    '    end = Math.min(full.length, start + q.length);',
    '  }',
    '  return end > start ? [start, end] : null;',
    '}',
    '',
    'export function addAnnotation({'
  ),
});

patch('books', 'addAnnotation 自己算位置', {
  find: "  const a = author === 'assistant' ? 'assistant' : 'user';\n  return stmt(\n    `INSERT INTO book_annotations",
  replace: L(
    "  const a = author === 'assistant' ? 'assistant' : 'user';",
    '  // 没给字符位置就自己找：网页上划的带真偏移量，他写的只有 quote。',
    '  // 找不到就留 null，前端跳过不画，而不是从段首画一条错的。',
    '  const spanIdx = Math.max(0, Number(paraIdx) || 0);',
    '  const given =',
    '    Number.isInteger(Number(rangeStart)) &&',
    '    Number.isInteger(Number(rangeEnd)) &&',
    '    Number(rangeEnd) > Number(rangeStart);',
    '  const span = given',
    '    ? [Number(rangeStart), Number(rangeEnd)]',
    '    : quoteSpanIn(bookId, spanIdx, quote);',
    '  return stmt(',
    '    `INSERT INTO book_annotations'
  ),
});

patch('books', 'addAnnotation 写真位置', {
  find: '    rangeStart ?? null,\n    rangeEnd ?? null\n    ,\n',
  replace: '    span ? span[0] : null,\n    span ? span[1] : null,\n',
});

// ════ 2. books-page.js：去掉那个画错的兜底 ════

patch('page', '兜底改成 null', {
  find:
    '      rangeStart: a.range_start ?? 0,\n' +
    '      rangeEnd: a.range_end ?? (a.quote ? Array.from(a.quote).length : 0),',
  replace: L(
    '      // 没有真实字符位置时给 null，前端会跳过不画高亮。',
    '      // 以前这里兜底成 0 和 quote.length，于是高亮永远从段首开始、',
    '      // 长度等于引文——画出来的位置和引文根本不是一处（2026-10-19）。',
    '      rangeStart: a.range_start ?? null,',
    '      rangeEnd: a.range_end ?? null,'
  ),
});

// ════ 写回 ════

for (const key of touched) {
  const p = FILES[key];
  const bak = `${p}.bak-span`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text[key], 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(touched.size ? `已写回：${[...touched].join('、')}，备份在 .bak-span` : '代码没改动。');

// ════ 3. 把已有的批注补上真位置 ════
//
// 必须在写完文件之后做：要用刚装上的 quoteSpanIn。

console.log('');
console.log('给已有的批注补真位置…');

try {
  const books = await import(pathToFileURL(FILES.books).href);
  const state = await import(pathToFileURL(path.join(SRC, 'state.js')).href);
  const db = state.default;

  const rows = db
    .prepare(
      `SELECT id, book_id, para_idx, quote
         FROM book_annotations
        WHERE quote IS NOT NULL AND TRIM(quote) <> ''
          AND (range_start IS NULL OR range_end IS NULL OR range_end <= range_start)
        ORDER BY id ASC`
    )
    .all();

  if (!rows.length) {
    console.log('  没有需要补的。');
  } else {
    const up = db.prepare('UPDATE book_annotations SET range_start = ?, range_end = ? WHERE id = ?');
    let ok = 0;
    const missed = [];
    db.transaction(() => {
      for (const r of rows) {
        const span = books.quoteSpanIn(r.book_id, r.para_idx, r.quote);
        if (!span) {
          missed.push(r.id);
          continue;
        }
        up.run(span[0], span[1], r.id);
        ok++;
      }
    })();
    console.log(`  补好了 ${ok} 条（共 ${rows.length} 条缺位置）。`);
    if (missed.length) {
      console.log(`  这 ${missed.length} 条的引文在那一段里没找到，留空不画高亮：#${missed.join(' #')}`);
      console.log('  （批注本文和引文还在，只是不画那条黄底——比画错地方强。）');
    }
  }
} catch (err) {
  console.error('  补位置没做成：' + err.message);
  console.error('  要是报数据库锁住，先 pm2 stop vesper，跑完这个脚本再 pm2 start vesper。');
}

console.log('');
console.log('接下来：');
console.log('  node --check src/books.js && node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper phosphor --update-env');
console.log('');
console.log('然后把 /books 关掉重开（要重新 GET 一次才能拿到新的位置）。');
console.log('');
