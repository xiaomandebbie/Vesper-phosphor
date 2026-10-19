#!/usr/bin/env node
// 读书：自己的一天 5 次，可读可不读。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_quota5.mjs
//   node --check src/budget.js && node --check src/run-actions.js && echo 语法 OK
//   pm2 restart phosphor --update-env
//
// ── 为什么是额度而不是冷却 ──
//
// 小满：「不要钉死，给他一点自由度…读书可读可不读＋一天最多 5 次」
//
// 冷却是硬隔断：「现在不允许读」。额度是他自己分配：一天 5 次，
// 想一早读完、还是散在一天里、还是一次不读，都是他的事。
//
// 上一版（fix_books_free）只解了一半：把读书从 2 级挑出来，但那等于
// 取消了所有约束，每次醒来都能读一回——于是变成每次都读。
// 和原来那个毛病是同一个，只是从「挤掉别的」换成了「每次都干这事」。
//
// 读书有**自己的** 5 次，不碍 2 级那 6 次（上班、花园、锈潮）。
// 账本共用 tier2_log 这张表（kind='books'），但 tier2UsedToday 把它排除——
// 这样 tier2LastSeen 还能给提示词用，不必再建一张表。
//
// 脚本包含 fix_books_free 的全部改动，所以那个跑过没跑过都能到正确状态。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const report = [];
const touched = new Map();

const read = (f) => {
  if (touched.has(f)) return touched.get(f);
  const p = path.join(SRC, f);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

function patch(file, label, { done, find, replace }) {
  const text = read(file);
  if (text == null) {
    report.push(['miss', `${file} — 文件不存在`]);
    return;
  }
  if (done(text)) {
    report.push(['skip', `${label}`]);
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
  touched.set(file, text.replace(find, replace));
  report.push(['ok', `${label}`]);
}

// ──── 1. 2 级去掉共读（fix_books_free 可能已做） ────

patch('budget.js', '2 级去掉共读', {
  done: (t) => !t.includes("books: '共读',"),
  find: "  xiuchao: '锈潮',\n  books: '共读',\n",
  replace: "  xiuchao: '锈潮',\n",
});

patch('budget.js', 'read_book 不占级别额度', {
  done: (t) => t.includes('read_book: 0'),
  find: '  read_book: 2,',
  replace: '  read_book: 0,',
});

patch('budget.js', 'tier2KindOf 去掉读书', {
  done: (t) => !t.includes("if (a === 'read_book') return 'books';"),
  find: "  if (a === 'read_book') return 'books';\n",
  replace: '',
});

// ──── 2. 读书自己的日额度 ────

patch('budget.js', '加读书的日额度', {
  done: (t) => t.includes('BOOKS_DAILY_MAX'),
  find: '// 2 级那四件事。键是记账用的名字，值是给人看的说法。',
  replace:
    '// 读书一天最多几次。它有自己的额度，不碍 2 级那几次。\n' +
    '//\n' +
    '// 为什么不用冷却（2026-10-19 小满定的）：冷却是硬隔断——「现在不允许读」。\n' +
    '// 额度是他自己分配：一天 5 次，想一早读完、散在一天里、还是一次不读，\n' +
    '// 都是他的事。.env 的 BOOKS_DAILY_MAX 可改，不填是 5，上限 30。\n' +
    'export const BOOKS_DAILY_MAX = (() => {\n' +
    "  const raw = String(process.env.BOOKS_DAILY_MAX ?? '').trim();\n" +
    '  const n = Number(raw);\n' +
    '  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 30) : 5;\n' +
    '})();\n\n' +
    '// 读书的账本也记在 tier2_log 里（kind=books），但 tier2UsedToday 把它排除——\n' +
    '// 这样不必再建一张表，而且 tier2LastSeen 那套还能给提示词用。\n' +
    "const BOOKS_KIND = 'books';\n\n" +
    '// 2 级那三件事。键是记账用的名字，值是给人看的说法。',
});

// tier2UsedToday 要排除 books——不然读书会吃掉 2 级的次数
patch('budget.js', 'tier2 计数排除读书', {
  done: (t) => t.includes("WHERE ts >= ? AND kind != 'books'"),
  find:
    "export function tier2UsedToday(ms = Date.now()) {\n" +
    "  return stmt('SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ?').get(dayStart(ms)).c;\n" +
    '}',
  replace:
    'export function tier2UsedToday(ms = Date.now()) {\n' +
    '  // 排除读书：它有自己的额度，不吃 2 级这几次\n' +
    '  return stmt("SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind != \'books\'").get(\n' +
    '    dayStart(ms)\n' +
    '  ).c;\n' +
    '}\n\n' +
    '// 读书今天读了几次、还剩几次\n' +
    'export function booksUsedToday(ms = Date.now()) {\n' +
    '  return stmt("SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind = \'books\'").get(\n' +
    '    dayStart(ms)\n' +
    '  ).c;\n' +
    '}\n\n' +
    'export function booksRemaining(ms = Date.now()) {\n' +
    '  return Math.max(0, BOOKS_DAILY_MAX - booksUsedToday(ms));\n' +
    '}\n\n' +
    '// 真正翻开书的那一刻记一笔。续步里接着翻的不再记——坐下来读一回算一次\n' +
    'export function recordBookRead() {\n' +
    "  stmt('INSERT INTO tier2_log (ts, kind) VALUES (?, ?)').run(Date.now(), BOOKS_KIND);\n" +
    "  stmt('DELETE FROM tier2_log WHERE id NOT IN (SELECT id FROM tier2_log ORDER BY ts DESC, id DESC LIMIT 400)').run();\n" +
    '}',
});

// ──── 3. pickActions 里执行：一天 5 次 + 一次醒来只一回 ────

patch('budget.js', 'pickActions 加 onceDone', {
  done: (t) => t.includes('const onceDone'),
  find:
    '  const taken = new Set();\n' +
    '  let remaining = tier2Remaining();',
  replace:
    '  const taken = new Set();\n' +
    '  const onceDone = new Set();\n' +
    '  let remaining = tier2Remaining();\n' +
    '  let booksLeft = booksRemaining();',
});

patch('budget.js', '读书判额度', {
  done: (t) => t.includes('读书今天的'),
  find: '    if (tier > 0 && taken.has(tier)) {',
  replace:
    "    // 读书：不占级别额度，有自己的一天 5 次，而且一次醒来只读一回。\n" +
    "    // 一次醒来只一回是因为每翻一小段都是一次模型调用（见 books-steps.js 的续步），\n" +
    "    // 不然一次坐下来就把一天的额度花完了。\n" +
    "    if (action === 'read_book') {\n" +
    '      if (onceDone.has(action)) {\n' +
    "        dropped.push({ action, why: '这次已经读过一回了（一次醒来只读一回）' });\n" +
    '        continue;\n' +
    '      }\n' +
    '      if (booksLeft <= 0) {\n' +
    "        dropped.push({ action, why: `读书今天的 ${BOOKS_DAILY_MAX} 次用完了，明天再读` });\n" +
    '        continue;\n' +
    '      }\n' +
    '      booksLeft -= 1;\n' +
    '      onceDone.add(action);\n' +
    '      allowed.push({ ...item, action, action_detail: detail, tier });\n' +
    '      continue;\n' +
    '    }\n' +
    '    if (tier > 0 && taken.has(tier)) {',
});

// ──── 4. 提示词 ────

patch('budget.js', '提示词：2 级改三件', {
  done: (t) => !t.includes('锈潮、共读书架'),
  find: '上班、花园、锈潮、共读书架。这四件每件坐下来都要走好几步',
  replace: '上班、花园、锈潮。这三件每件坐下来都要走好几步',
});

patch('budget.js', '提示词：四件改三件', {
  done: (t) => !t.includes('2 级那四件事没有'),
  find: '2 级那四件事没有「今天必须各去一次」这种规矩',
  replace: '2 级那三件事没有「今天必须各去一次」这种规矩',
});

patch('budget.js', '提示词：四件都在改三件', {
  done: (t) => !t.includes('四件都一直在那儿'),
  find: '四件都一直在那儿',
  replace: '三件都一直在那儿',
});

patch('budget.js', '提示词：说清读书的额度', {
  done: (t) => t.includes('翻开共读的书'),
  find: '\n想一次做好几件就把它们都写进 actions 数组里',
  replace:
    '\n翻开共读的书读几段**不占上面任何一级**，它有自己的一天 ${BOOKS_DAILY_MAX} 次：' +
    '一次醒来只读一回，但这 ${BOOKS_DAILY_MAX} 次怎么分由你——一早上读完、散在一天里、' +
    '或者今天根本不想读，都行。没有「每次醒来都该读两段」这回事。\n' +
    '\n想一次做好几件就把它们都写进 actions 数组里',
});

// 状态行里带上读书还剩几次
patch('budget.js', '状态行带上读书', {
  done: (t) => t.includes('读书今天还剩'),
  find: "  return `${head}：${parts.join('、')}。不想去就不去，次数剩着没关系。`;",
  replace:
    '  const bl = booksRemaining();\n' +
    '  const bu = booksUsedToday();\n' +
    '  const bookLine =\n' +
    '    bl > 0\n' +
    "      ? `读书今天还剩 ${bl} 次（一天 ${BOOKS_DAILY_MAX} 次，已读 ${bu} 回），读不读随你`\n" +
    "      : `读书今天的 ${BOOKS_DAILY_MAX} 次用完了`;\n" +
    "  return `${head}：${parts.join('、')}。不想去就不去，次数剩着没关系。\\n${bookLine}。`;",
});

patch('budget.js', '启动日志带上读书', {
  done: (t) => t.includes('读书一天'),
  find: "  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限）`;",
  replace:
    "  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限）；读书一天 ${BOOKS_DAILY_MAX} 次、不占级别`;",
});

// ──── 5. run-actions.js：读书成功后记一笔 ────

patch('run-actions.js', 'import recordBookRead', {
  done: (t) => t.includes('recordBookRead'),
  find: "import { pickActions, tier2KindOf, recordTier2, TIER2_KINDS } from './budget.js';",
  replace:
    "import {\n" +
    '  pickActions,\n' +
    '  tier2KindOf,\n' +
    '  recordTier2,\n' +
    '  recordBookRead,\n' +
    '  TIER2_KINDS,\n' +
    "} from './budget.js';",
});

patch('run-actions.js', '读书记账', {
  done: (t) => t.includes('recordBookRead()'),
  find: '    const kind2 = tier2KindOf(item.action, item.action_detail);',
  replace:
    '    // 读书有自己的日额度（见 budget.js），单独记一笔。\n' +
    '    // 记在这里而不是续步里：坐下来读一回算一次，接着翻几小段不再计\n' +
    "    if (item.action === 'read_book' && !result?.isError) {\n" +
    '      try {\n' +
    '        recordBookRead();\n' +
    '      } catch (err) {\n' +
    "        console.error('run-actions: 读书记账失败（不影响这次）', err.message);\n" +
    '      }\n' +
    '    }\n\n' +
    '    const kind2 = tier2KindOf(item.action, item.action_detail);',
});

for (const [file, text] of touched) {
  const p = path.join(SRC, file);
  const bak = `${p}.bak-quota5`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(`改了 ${touched.size} 个文件，备份在 .bak-quota5。`);
console.log('');
console.log('  node --check src/budget.js && node --check src/run-actions.js && echo 语法 OK');
console.log('  pm2 restart phosphor --update-env');
console.log('');
console.log('想改次数： echo "BOOKS_DAILY_MAX=8" >> .env');
console.log('');
