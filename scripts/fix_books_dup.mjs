#!/usr/bin/env node
// 修批注重复，并清掉已经重复的。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_dup.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// ── 怎么回事 ──
//
// 2026-10-19：她写了一条批注，列表里出现好几条一模一样的。
//
// 前端新建批注时 id 是 "an_1760..." 这种字符串（见 bookshelf.jsx 的
// saveAnnotation），而服务器存的是自增数字——两边永远对不上。
// applyShelfJson 里的判断是：
//   if (Number.isInteger(numeric) && mine.has(numeric)) → 只补回复
//   else → addAnnotation（新建）
// "an_xxx" 转数字是 NaN，所以永远走新建。
//
// 而 persistShelf() 是整份写，每翻一页、每改一次进度都调一次。
// 于是同一条批注被反复新建，读得越多重复越多。
//
// （刚修好 Storage hook、回写终于通了，这个坑才跟着露出来。之前回写
//   根本没发出过，所以看不到。）
//
// ── 改法 ──
//
// 前端那份的 an_xxx 永远不会被纠正（除非关页重开重新 GET），所以不能指望
// id 对得上。改成**按内容认人**：
//   同一本书 + 同一段 + 同一个作者 + 同样的话 = 同一条
// 命中时不新建，但仍然把回复补到保留的那条上——不然本次会话里刚写的
// 回复会丢。
//
// 误伤风险：她真想在同一段写两条**一字不差**的批注——极少，而且代价只是
// 少了一条重复的。内容不同不会认成同一条。

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const FILE = path.join(process.cwd(), 'src', 'books-page.js');
if (!fs.existsSync(FILE)) {
  console.error('没找到 src/books-page.js。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

let text = fs.readFileSync(FILE, 'utf8');
const report = [];
let changed = false;

function patch(label, { done, find, replace }) {
  if (done(text)) {
    report.push(['skip', label]);
    return;
  }
  const n = text.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  text = text.replace(find, replace);
  changed = true;
  report.push(['ok', label]);
}

// ──── 1. 建一份按内容的索引 ────

patch('按内容建索引', {
  done: (t) => t.includes('const byContent'),
  find:
    '    const total = paragraphCount(id);\n' +
    '    const mine = new Map(annotationsIn(id, 0, Math.max(0, total - 1)).map((a) => [a.id, a]));',
  replace:
    '    const total = paragraphCount(id);\n' +
    '    const existingAnns = annotationsIn(id, 0, Math.max(0, total - 1));\n' +
    '    const mine = new Map(existingAnns.map((a) => [a.id, a]));\n' +
    '    // 按内容的索引，用来查重（理由见下面那段注释）\n' +
    "    const annSig = (x) => [x.para_idx, x.author, String(x.note ?? '').trim()].join('\\u0000');\n" +
    '    const byContent = new Map(existingAnns.map((x) => [annSig(x), x.id]));',
});

// ──── 2. 新建前先查重 ────

patch('新建前查重', {
  done: (t) => t.includes('const dup = byContent.get(sig)'),
  find: '      const newId = addAnnotation({',
  replace:
    '      // 查重。前端新建的批注 id 是 "an_1760..."，服务器存的是数字——两边永远对不上，\n' +
    '      // 所以上面那个按 id 的判断对它永远不生效，每次都走到新建。\n' +
    '      // 而 persistShelf() 每翻一页都触发，于是同一条被反复新建。\n' +
    '      // （2026-10-19：她加一条，列表里出现好几条一样的，就是这个。）\n' +
    '      // 所以按内容认人：同一本书 + 同一段 + 同一个作者 + 同样的话 = 同一条。\n' +
    '      const sig = [\n' +
    '        Number(a?.paraIdx) || 0,\n' +
    "        a?.author === 'ai' ? 'assistant' : 'user',\n" +
    "        String(a?.note ?? '').trim(),\n" +
    "      ].join('\\u0000');\n" +
    '      const dup = byContent.get(sig);\n' +
    '      if (dup) {\n' +
    '        // 已经有一条一样的。不新建，但要把回复补上——\n' +
    '        // 不然本次会话里刚写的回复会丢（那条批注在前端还是 an_xxx）\n' +
    '        const have = repliesOf(dup).length;\n' +
    '        const incoming = Array.isArray(a.comments) ? a.comments : [];\n' +
    '        for (const c of incoming.slice(have)) {\n' +
    "          const t = String(c?.text ?? '').trim();\n" +
    '          if (!t) continue;\n' +
    '          addReply({\n' +
    '            annotationId: dup,\n' +
    "            author: c?.author === 'ai' ? 'assistant' : 'user',\n" +
    '            content: t,\n' +
    '          });\n' +
    '          replies++;\n' +
    '        }\n' +
    '        continue;\n' +
    '      }\n' +
    '      const newId = addAnnotation({',
});

// ──── 3. 新建完记进索引（防同一次 PUT 里自己重复） ────

patch('新建后记进索引', {
  done: (t) => t.includes('byContent.set(sig, newId)'),
  find: '      });\n      notes++;',
  replace: '      });\n      byContent.set(sig, newId);\n      notes++;',
});

if (changed) {
  const bak = `${FILE}.bak-dup`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-dup' : '代码没改动。');

// ──── 4. 清掉库里已有的重复 ────
//
// 每组保留最早那条（id 最小）。先把其他条的回复迁到保留者身上，再删，
// 不丢回复；最后再去重回复本身（重复批注带过来的回复也是重复的）。

console.log('');
console.log('清理库里已有的重复…');

try {
  const mod = await import(pathToFileURL(path.join(process.cwd(), 'src', 'state.js')).href);
  const db = mod.default;

  const rows = db
    .prepare(
      `SELECT id, book_id, para_idx, author, COALESCE(note, '') AS note
       FROM book_annotations ORDER BY id ASC`
    )
    .all();

  const keep = new Map(); // 签名 → 保留的 id
  const drop = []; // [要删的 id, 并到哪条]
  for (const r of rows) {
    const sig = [r.book_id, r.para_idx, r.author, r.note].join('\u0000');
    if (keep.has(sig)) drop.push([r.id, keep.get(sig)]);
    else keep.set(sig, r.id);
  }

  if (!drop.length) {
    console.log('  没有重复的批注。');
  } else {
    const tx = db.transaction(() => {
      const move = db.prepare('UPDATE book_replies SET annotation_id = ? WHERE annotation_id = ?');
      const del = db.prepare('DELETE FROM book_annotations WHERE id = ?');
      for (const [bad, good] of drop) {
        move.run(good, bad);
        del.run(bad);
      }
      // 回复本身也去一次重
      db.prepare(
        `DELETE FROM book_replies WHERE id NOT IN (
           SELECT MIN(id) FROM book_replies GROUP BY annotation_id, author, content
         )`
      ).run();
    });
    tx();
    console.log(`  删了 ${drop.length} 条重复批注（回复已经迁到保留的那条上）。`);
  }

  const left = db.prepare('SELECT COUNT(*) AS c FROM book_annotations').get().c;
  const lr = db.prepare('SELECT COUNT(*) AS c FROM book_replies').get().c;
  console.log(`  现在库里有 ${left} 条批注、${lr} 条回复。`);
} catch (err) {
  console.error('  清理没做成：' + err.message);
  console.error('  要是报数据库锁住，先 pm2 stop vesper，跑完这个脚本再 pm2 start vesper。');
}

console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('');
console.log('然后手机上把 /books 关掉重开（要重新 GET 一次，把前端那份 an_xxx 换成数字 id）。');
console.log('');
