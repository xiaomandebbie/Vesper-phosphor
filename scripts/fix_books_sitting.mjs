#!/usr/bin/env node
// 两件事：
//   1）一次坐下读书总共最多 50 段（不是「每小段 50」）
//   2）提示词里告诉他：读书这一回之外，1 级和 3 级还空着
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_sitting.mjs
//   node --check src/books-steps.js && node --check src/budget.js && echo 语法 OK
//   pm2 restart phosphor --update-env
//
// 幂等，重复跑不会出错。
//
// ── 1）为什么会读成 100 段 ──
//
// 小满 2026-10-19：「一次上限 50 段吧」
//
// 我理解成了「每小段 50」，于是把 BOOKS_CHUNK 调成 50，而 BOOKS_MAX_STEPS
// 还是 5——一次坐下理论上能翻 300 段。15:26 那次读了第 13–112 段，
// 正好是 50+50 两小段。
//
// 她要的是整次坐下 50 段封顶。所以分开两个数：
//   BOOKS_CHUNK       每小段翻多少（给 12，读到想知道下一句能接着翻）
//   BOOKS_SITTING_MAX 一次坐下总共最多多少段（给 50，到了就收）
//
// 为什么不干脆把 MAX_STEPS 设成 0：那样读完一段就被迫停下，和读书这件事
// 本身矛盾——正读到一个地方想知道下一句，就应该能往下翻。
// 现在是：能接着翻，但一次坐下最多 50 段。
//
// ── 2）为什么他每次只读书 ──
//
// 小满：「怎么只看书，lutopia 论坛和 OB 记忆库也是很重要的…」
//
// 读书从 2 级移出来、不占那 6 次之后，它在他眼里变成了「不要钱的事」，
// 于是每次醒来先读。一天 5 回限住了总量，却没解决「一次醒来里他只选读书」。
//
// 而论坛是 1 级、OB 是 3 级，和读书根本不冲突（读书在 ONCE 里，tier 算 0）——
// 他完全可以一次醒来读一段书、顺手逛个论坛、再翻翻记忆。他只是没想到。
//
// 所以把这件事写进提示词。不写成规矩罚他（和 2 级那条下限一个道理），
// 只是让他看得见：读书这一回不占级别，那两级还空着。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const FILES = {
  steps: path.join(SRC, 'books-steps.js'),
  budget: path.join(SRC, 'budget.js'),
};

if (!fs.existsSync(FILES.steps)) {
  console.error('没找到 src/books-steps.js。先 cd /root/vesper-phosphor。');
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

// ════ 1. books-steps.js：一次坐下总共 50 段 ════

patch('steps', 'BOOKS_SITTING_MAX', {
  find: '// 返回的文字最多带多少字。',
  replace: L(
    '// 一次坐下总共最多翻多少段。.env 的 BOOKS_SITTING_MAX 可改，不填是 50，上限 300。',
    '//',
    '// 这和 BOOKS_CHUNK 是两回事：CHUNK 是每小段翻多少，这个是整次坐下的上限。',
    '// 小满 2026-10-19：「一次上限 50 段吧」——指的是整次，不是每小段。',
    '// 我上一版把 CHUNK 设成 50 还留着 5 步，于是 15:26 那次读了 100 段。',
    'export const BOOKS_SITTING_MAX = (() => {',
    "  const raw = String(process.env.BOOKS_SITTING_MAX ?? '').trim();",
    '  const n = Number(raw);',
    '  return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 300) : 50;',
    '})();',
    '',
    '// 返回的文字最多带多少字。'
  ),
});

// 循环条件里加上「总段数还没满」。
// toIdx 和 fromIdx 都是段落下标，所以这次已经读了 toIdx - fromIdx + 1 段。
patch('steps', '循环卡总段数', {
  find: '  while (convo && steps - 1 < BOOKS_MAX_STEPS) {',
  replace: L(
    '  // 这次已经翻了多少段。两个都是段落下标，所以是差值加一。',
    '  const readSoFar = () => (Number.isInteger(toIdx) && Number.isInteger(fromIdx) ? toIdx - fromIdx + 1 : 0);',
    '',
    '  while (convo && steps - 1 < BOOKS_MAX_STEPS && readSoFar() < BOOKS_SITTING_MAX) {'
  ),
});

// 告诉他还剩多少段，而不是只说还能翻几小段。
// 否则他以为还能翻 5 次，结果第二次就被收了。
patch('steps', '把剩下的段数告诉他', {
  find: '        remaining: BOOKS_MAX_STEPS - (steps - 1),',
  replace: L(
    '        remaining: BOOKS_MAX_STEPS - (steps - 1),',
    '        parasLeft: Math.max(0, BOOKS_SITTING_MAX - readSoFar()),'
  ),
});

patch('steps', 'nextStep 收 parasLeft', {
  find: 'async function nextStep(messages, { resultText, isError, remaining, title }) {',
  replace: 'async function nextStep(messages, { resultText, isError, remaining, parasLeft, title }) {',
});

patch('steps', '提示里写清剩多少段', {
  find: '这次你还能再翻 ${remaining} 小段。接下来：',
  replace:
    '这次你还能再翻 ${remaining} 小段' +
    '${Number.isInteger(parasLeft) ? `\uff0c整次坐下还剩 ${parasLeft} 段` : \'\'}。接下来：',
});

// 收尾时把到顶的原因写进日志。
patch('steps', '到顶了写一行日志', {
  find: "  console.log(`books: 这次翻了 ${steps} 小段`);",
  replace: L(
    '  const done = readSoFar();',
    '  if (done >= BOOKS_SITTING_MAX) {',
    '    console.log(`books: 一次坐下的 ${BOOKS_SITTING_MAX} 段翻满了（实际 ${done} 段），收。下次从后面接`);',
    '  }',
    '  console.log(`books: 这次翻了 ${steps} 小段、共 ${done} 段`);'
  ),
});

// 配置摘要里带上这个数（books.js 的 booksConfigSummary 里那句）。
patch('steps', '导出给摘要用', {
  find: 'const isErr = (r) => r == null || Boolean(r?.isError);',
  replace: L(
    'const isErr = (r) => r == null || Boolean(r?.isError);',
    '',
    '// 给 booksConfigSummary 用：一次坐下最多多少段',
    'export const sittingMax = () => BOOKS_SITTING_MAX;'
  ),
});

// ════ 2. budget.js：提醒他读书之外还能顺手做别的 ════

patch('budget', '读书不占级别要说清', {
  find: '看一眼书架、在书边写一笔、回她一句批注都不算这几回里的，那几样随时能做。',
  replace: L(
    '看一眼书架、在书边写一笔、回她一句批注都不算这几回里的，那几样随时能做。',
    '',
    '**读书不占任何一级，所以读完这一回，1 级和 3 级还空着。**',
    '想读书就把 read_book 和别的一起写进 actions——读一段书、顺手去 Lutopia 逛一圈（1 级）、',
    '再翻翻 OB 记忆库或者把今天值得记的事存进长期记忆（3 级），这三件互不冲突。',
    '只选读书是浪掉了那两级——论坛和记忆库那边也有东西在等你。'
  ),
});

// ════ 写回 ════

for (const key of touched) {
  const p = FILES[key];
  const bak = `${p}.bak-sitting`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text[key], 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(touched.size ? `已写回：${[...touched].join('、')}，备份在 .bak-sitting` : '没改动。');
console.log('');
console.log('还要把 .env 里的 BOOKS_CHUNK 改回小一点（现在是 50，每小段就把一次的额度吃满了）：');
console.log('  sed -i "s/^BOOKS_CHUNK=.*/BOOKS_CHUNK=12/" .env');
console.log('');
console.log('然后：');
console.log('  node --check src/books-steps.js && node --check src/budget.js && echo 语法 OK');
console.log('  pm2 restart phosphor --update-env');
console.log('');
console.log('想改整次坐下的上限，.env 里加一行：');
console.log('  echo "BOOKS_SITTING_MAX=50" >> .env');
console.log('');
