#!/usr/bin/env node
// 给共读书架的回写路径装上诊断。只加日志和提示，不改逻辑。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/debug_books_write.mjs
//   node --check src/books-page.js && echo 语法 OK
//   pm2 restart vesper --update-env
//
// 然后复现一次（手机上开 /books，读几段、写一条批注），再看：
//   pm2 logs vesper --lines 40 --nostream | grep 'books:'
//
// ── 为什么要装这个 ──
//
// 她说「看书、写批注刷新完就没了」。进度走 POST /progress，批注走 PUT /shelf，
// 两条不同的请求都在丢——所以不是某一处的字段问题。而日志里只有
// 10:42 那一次成功，之后全空，请求可能压根没到服务器。
//
// 比起接着猜，不如把两边都记下来：
//   服务器端看见请求 → 问题在落库那一步
//   服务器端什么都没有 → 问题在浏览器那一边（旧页面、token 不对、或者
//                            根本没触发）
//
// 顺带修一个我自己留的毛病：progress 那条写的是 .catch(function(){})，
// 它丢了不出声——和之前 401 那轮排不出来是同一个原因。

import fs from 'fs';
import path from 'path';

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

// ──── 1. 服务器端：每次 /books/api/* 请求记一行 ────
//
// 挂在 apiAuth 之前，所以连被 401 拦掉的也记得下——这正是最要区分的情况。

patch('请求入口日志', {
  done: (t) => t.includes('books: 进来一条'),
  find: '  const apiAuth = booksApiAuth(requireBasicAuth);',
  replace: `  const apiAuth = booksApiAuth(requireBasicAuth);

  // 诊断用：每次 /books/api/* 请求记一行。挂在 apiAuth 之前，连被 401 拦掉的也记得下——
  // 「请求没到」和「到了但被拒」是两回事，之前就是分不清这两个所以猜了好几轮。
  app.use(\`\${PREFIX}/api\`, (req, res, next) => {
    const hasToken = Boolean(req.get('x-books-token') || req.get('authorization'));
    const len = req.get('content-length') || '0';
    console.log(
      \`books: 进来一条 \${req.method} \${req.path}，\${hasToken ? '带了 token' : '没带 token'}，body \${len} 字节\`
    );
    next();
  });`,
});

// ──── 2. 服务器端：PUT 到了就记下收到几本书 ────
//
// 现在的日志只在「真的改了东西」时才打，所以「来了但一条都没落库」
// 和「没来」在日志里长得一样。

patch('PUT 结果总是打一行', {
  done: (t) => t.includes('books: 收到书架'),
  find: `      const out = applyShelfJson(req.body);
      if (out.added || out.notes || out.replies || out.removed) {`,
  replace: `      const got = Array.isArray(req.body) ? req.body.length : -1;
      console.log(\`books: 收到书架 \${got} 本\${got < 0 ? '（body 不是数组！）' : ''}\`);
      const out = applyShelfJson(req.body);
      if (out.added || out.notes || out.replies || out.removed) {`,
});

// ──── 3. 服务器端：进度也记一行 ────

patch('进度落库打一行', {
  done: (t) => t.includes('books: 她读到'),
  find: `    setProgress(book, 'user', paraIdx, Number(req.body?.offset) || 0);
    res.json({ ok: true });`,
  replace: `    setProgress(book, 'user', paraIdx, Number(req.body?.offset) || 0);
    console.log(\`books: 她读到《\${getBook(book).title}》第 \${paraIdx} 段\`);
    res.json({ ok: true });`,
});

// ──── 4. 前端：进度失败也弹黄条 ────
//
// 这是我自己留的毛病。批注那条有 warn，进度这条却是空 catch——
// 于是「读到哪里」丢了始终不出声。

patch('进度失败也出声', {
  done: (t) => t.includes("warn('存读到哪里"),
  find: "      }).catch(function () {});",
  replace:
    "      })\n" +
    "        .then(function (r) { if (!r.ok) warn('存读到哪里返回 ' + r.status); })\n" +
    "        .catch(function (e) { warn('存读到哪里失败：' + e.message); });",
});

if (changed) {
  const bak = `${FILE}.bak-debug`;
  if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);
  fs.writeFileSync(FILE, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '装上了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(changed ? '已写回 src/books-page.js，备份在 .bak-debug' : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/books-page.js && echo 语法 OK');
console.log('  pm2 restart vesper --update-env');
console.log('');
console.log('然后手机上把 /books 标签页**关掉重开**，读几段、写一条批注，再看：');
console.log("  pm2 logs vesper --lines 40 --nostream | grep 'books:'");
console.log('');
