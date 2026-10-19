#!/usr/bin/env node
// 读书单算一本账：一天 5 次，一次醒来最多读一回，读不读随他。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_books_quota.mjs
//   node --check src/budget.js && node --check src/run-actions.js && echo 语法 OK
//   pm2 restart phosphor --update-env
//
// 这个脚本是幂等的，而且不管 fix_books_free.mjs 跑过没跑过，跑完结果都一样。
//
// ── 为什么改 ──
//
// 小满 2026-10-19，三句话连起来才是完整需求：
//   「读书能不能不占他次数，弄的他现在每次只调用读书了」
//   「但是也不能每次醒来都读书啊…」
//   「不要钉死，给他一点自由度…读书可读可不读+一天最多5次」
//
// 前两句看着矛盾，其实是一个问题的两面：
//
// 读书原本在 2 级，和上班、花园、锈潮抢那一天 6 次。他每次都选读书，
// 别的三件全被挤掉——这是第一句。
// 但完全不计费，他每次醒来都能读一回，那就变成每次都读——这是第二句，
// 只是把毛病从「挤掉别的」换成了「老干这一件」。
//
// 所以两边都不对：读书既不该占 2 级的次数，也不该一点约束都没有。
//
// ── 为什么是额度，不是冷却 ──
//
// 冷却（读完隔 3 小时才准再读）也能解决第二句，但那是硬隔断：时间没到
// 就是不准，正读到想往下翻的地方也得停。她说的是「不要钉死，给他一点
// 自由度」——额度是他自己分配：想今天连读三回、明天一回都不读，都行。
//
// 和 2 级一样只设上限、不设下限：5 次用不完不催，一次不读也不罚。
//
// ── 四种用法里只有「往下读」算一次 ──
//
// read_book 有 shelf / read / note / reply 四种。看一眼书架有哪几本、
// 在书边写一笔、回她一句批注，都不扣次数——那几样轻，而且写批注和回她
// 恰恰是共读里最要紧的部分，不该被额度拦住。
// 真正贵的是 read：一次给几十段，还能连着往下翻（books-steps.js），
// 每翻一小段都是一次模型调用。所以只有它记账。

import fs from 'fs';
import path from 'path';

const BUDGET = path.join(process.cwd(), 'src', 'budget.js');
const RUNACT = path.join(process.cwd(), 'src', 'run-actions.js');

if (!fs.existsSync(BUDGET)) {
  console.error('没找到 src/budget.js。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

const report = [];
const touched = new Set();

function load(file) {
  return fs.readFileSync(file, 'utf8');
}

let budget = load(BUDGET);
let runact = fs.existsSync(RUNACT) ? load(RUNACT) : null;

// ── 三个改法 ──

function patch(file, label, { find, replace }) {
  let text = file === 'budget' ? budget : runact;
  if (text == null) {
    report.push(['miss', `${label} — 文件不在`]);
    return;
  }
  if (text.includes(replace)) {
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
  if (file === 'budget') budget = text;
  else runact = text;
  touched.add(file);
  report.push(['ok', label]);
}

function patchRegex(file, label, re, replace) {
  let text = file === 'budget' ? budget : runact;
  if (text == null) {
    report.push(['miss', `${label} — 文件不在`]);
    return;
  }
  const next = text.replace(re, replace);
  if (next === text) {
    report.push([re.test(text) ? 'skip' : 'miss', label]);
    return;
  }
  if (file === 'budget') budget = next;
  else runact = next;
  touched.add(file);
  report.push(['ok', label]);
}

// 整个函数换掉：找到 export function 名字，数括号找到配对的右括号。
// 比对着一句句改提示词可靠得多——那些句子可能已经被上一个脚本动过了。
function replaceFunction(name, body) {
  const head = `export function ${name}(`;
  const start = budget.indexOf(head);
  if (start < 0) {
    report.push(['miss', `重写 ${name} — 找不到`]);
    return;
  }
  const open = budget.indexOf('{', start);
  if (open < 0) {
    report.push(['miss', `重写 ${name} — 没有函数体`]);
    return;
  }
  let depth = 0;
  let end = -1;
  for (let i = open; i < budget.length; i++) {
    const c = budget[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) {
    report.push(['miss', `重写 ${name} — 括号没配上`]);
    return;
  }
  if (budget.slice(start, end) === body) {
    report.push(['skip', `重写 ${name}`]);
    return;
  }
  budget = budget.slice(0, start) + body + budget.slice(end);
  touched.add('budget');
  report.push(['ok', `重写 ${name}`]);
}

const L = (...lines) => lines.join('\n');

// ════════ src/budget.js ════════

// ── 1. 读书自己的账本表 ────

patch('budget', '建 books_log 表', {
  find: L('CREATE INDEX IF NOT EXISTS idx_tier2_log_ts ON tier2_log (ts);', '`);'),
  replace: L(
    'CREATE INDEX IF NOT EXISTS idx_tier2_log_ts ON tier2_log (ts);',
    '`);',
    '',
    '// 读书单算一本账，所以单开一张表。',
    '// 不混进 tier2_log：那张表的行数就是 2 级今天用掉的次数，读书插进去会把它顶满。',
    'db.exec(`',
    'CREATE TABLE IF NOT EXISTS books_log (',
    '  id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '  ts INTEGER NOT NULL',
    ');',
    'CREATE INDEX IF NOT EXISTS idx_books_log_ts ON books_log (ts);',
    '`);'
  ),
});

// ── 2. BOOKS_DAILY_MAX，顺手把「四件事」改成三件 ────

patch('budget', 'BOOKS_DAILY_MAX', {
  find: '// 2 级那四件事。键是记账用的名字，值是给人看的说法。',
  replace: L(
    '// 读书一天最多几回。.env 的 BOOKS_DAILY_MAX 可改，不填是 5，上限 20。',
    '// 这 5 回和 2 级那 6 次是两本账，互不相干。',
    'export const BOOKS_DAILY_MAX = (() => {',
    "  const raw = String(process.env.BOOKS_DAILY_MAX ?? '').trim();",
    '  const n = Number(raw);',
    '  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 20) : 5;',
    '})();',
    '',
    '// 2 级那三件事。键是记账用的名字，值是给人看的说法。'
  ),
});

// ── 3. 2 级名单里去掉共读 ────

patchRegex('budget', '2 级去掉共读', /\n  books: '共读',/, '');

// ── 4. read_book 不再是 2 级 ────

patchRegex(
  'budget',
  'read_book 移出 2 级',
  /(?:\n  \/\/[^\n]*)*\n  read_book: [0-9]+,/,
  L(
    '',
    '  // 读书不占 2 级那几次，但有自己的一天 BOOKS_DAILY_MAX 回（小满 2026-10-19：',
    '  // 「读书可读可不读+一天最多5次」）。原本它在 2 级，和上班、花园、锈潮抢一天 6 次，',
    '  // 他每次都选读书，别的三件全被挤掉；完全不计费又会变成每次醒来都读。',
    '  // 所以单给它一本账，记在 books_log 里，见下面 booksRemaining。',
    '  read_book: 0,'
  )
);

patchRegex('budget', 'tier2KindOf 去掉读书', /\n  if \(a === 'read_book'\) return 'books';/, '');

// ── 5. 2 级的账不数读书留下的旧行 ────

patch('budget', '2 级汇总排除 books', {
  find: "'SELECT kind, COUNT(*) AS c FROM tier2_log WHERE ts >= ? GROUP BY kind'",
  replace: "'SELECT kind, COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind != \\'books\\' GROUP BY kind'",
});

patch('budget', '2 级计数排除 books', {
  find: "'SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ?'",
  replace: "'SELECT COUNT(*) AS c FROM tier2_log WHERE ts >= ? AND kind != \\'books\\''",
});

// ── 6. 读书的记账函数 ────

patch('budget', '读书记账', {
  find: L(
    "  stmt('DELETE FROM tier2_log WHERE id NOT IN (SELECT id FROM tier2_log ORDER BY ts DESC, id DESC LIMIT 400)').run();",
    '}'
  ),
  replace: L(
    "  stmt('DELETE FROM tier2_log WHERE id NOT IN (SELECT id FROM tier2_log ORDER BY ts DESC, id DESC LIMIT 400)').run();",
    '}',
    '',
    '// ── 读书单算一本账 ──',
    '//',
    '// 小满 2026-10-19：「读书可读可不读+一天最多5次」',
    '//',
    '// 为什么不占 2 级的次数：读书原本在 2 级，和上班、花园、锈潮抢一天 6 次，',
    '// 他每次都选读书，别的三件全被挤掉。',
    '// 为什么不干脆不计费：那就变成每次醒来都读——只是换了个毛病。',
    '// 为什么是额度不是冷却：冷却是硬隔断，到点才准读；额度是他自己分配，',
    '// 想今天连读三回、明天一回不读都行。她的原话是「不要钉死，给他一点自由度」。',
    '//',
    '// 和 2 级一样只设上限、不设下限：5 回用不完不催，一次不读也不罚。',
    '',
    'export function booksUsedToday(ms = Date.now()) {',
    "  return stmt('SELECT COUNT(*) AS c FROM books_log WHERE ts >= ?').get(dayStart(ms)).c;",
    '}',
    '',
    'export function booksRemaining(ms = Date.now()) {',
    '  return Math.max(0, BOOKS_DAILY_MAX - booksUsedToday(ms));',
    '}',
    '',
    '// 真正往下读了那一刻记一笔。books-steps.js 里接着翻的那几小段不再记——',
    '// 一次坐下只算一回，不然连翻五段就把一天读完了。',
    'export function recordBookRead() {',
    "  stmt('INSERT INTO books_log (ts) VALUES (?)').run(Date.now());",
    "  stmt('DELETE FROM books_log WHERE id NOT IN (SELECT id FROM books_log ORDER BY ts DESC, id DESC LIMIT 200)').run();",
    '}'
  ),
});

// ── 7. ONCE 和「只有往下读才算一次」 ────

patch('budget', 'ONCE', {
  find: 'function serverOf(detail) {',
  replace: L(
    '// 单算一本账的动作：不占任何级别的次数，有自己的一天几回，一次醒来最多一件。',
    '//',
    '// 0 级本来不限件数——那些都是看一眼动态、摆一颗星这类极轻的事。读书不同：',
    '// 它不该占 2 级那 6 次，却也不能随便读（每翻一小段都是一次模型调用）。',
    "const ONCE = new Set(['read_book']);",
    '',
    'function serverOf(detail) {'
  ),
});

patch('budget', 'isBookRead', {
  find: '// ── 一次醒来允许做哪些 ──',
  replace: L(
    '// read_book 的四种用法里，只有「往下读」算一回。',
    '// 看一眼书架、在书边写一笔、回她一句批注都不扣：那几样轻，而且写批注和回她',
    '// 恰恰是共读里最要紧的部分，不该被额度拦住。',
    'function isBookRead(detail) {',
    '  try {',
    '    const j = JSON.parse(detail);',
    "    return String(j?.mode ?? 'shelf').trim() === 'read';",
    '  } catch {',
    '    return false;',
    '  }',
    '}',
    '',
    '// ── 一次醒来允许做哪些 ──'
  ),
});

// ── 8. pickActions ────

replaceFunction(
  'pickActions',
  L(
    'export function pickActions(list) {',
    '  const allowed = [];',
    '  const dropped = [];',
    '  const taken = new Set();',
    '  const onceDone = new Set();',
    '  let remaining = tier2Remaining();',
    '  let booksLeft = booksRemaining();',
    '',
    '  for (const item of Array.isArray(list) ? list : []) {',
    "    const action = String(item?.action ?? '').trim();",
    '    if (!action) continue;',
    "    const detail = typeof item.action_detail === 'string' ? item.action_detail : JSON.stringify(item.action_detail ?? '');",
    '    const tier = tierOf(action, detail);',
    '',
    '    // 单算一本账的（读书）：不碰 2 级那几次，用自己的一天几回',
    '    if (ONCE.has(action)) {',
    '      if (!isBookRead(detail)) {',
    '        // 看书架、写批注、回她一句：放过去，不记账',
    '        allowed.push({ ...item, action, action_detail: detail, tier: 0 });',
    '        continue;',
    '      }',
    '      if (onceDone.has(action)) {',
    "        dropped.push({ action, why: '这次已经读过一回了，一次醒来最多读一回' });",
    '        continue;',
    '      }',
    '      if (booksLeft <= 0) {',
    '        dropped.push({ action, why: `读书今天的 ${BOOKS_DAILY_MAX} 回用完了，明天再翻` });',
    '        continue;',
    '      }',
    '      booksLeft -= 1;',
    '      onceDone.add(action);',
    '      allowed.push({ ...item, action, action_detail: detail, tier: 0 });',
    '      continue;',
    '    }',
    '',
    '    if (tier > 0 && taken.has(tier)) {',
    '      dropped.push({ action, why: `这次已经做了一件 ${tier} 级的事，一次醒来每级最多一件` });',
    '      continue;',
    '    }',
    '    if (tier === 2) {',
    '      if (remaining <= 0) {',
    '        dropped.push({ action, why: `2 级今天的 ${TIER2_DAILY_MAX} 次用完了，明天再说` });',
    '        continue;',
    '      }',
    '      remaining -= 1;',
    '    }',
    '    if (tier > 0) taken.add(tier);',
    '    allowed.push({ ...item, action, action_detail: detail, tier });',
    '  }',
    '  return { allowed, dropped };',
    '}'
  )
);

// ── 9. 提示词 ────

replaceFunction(
  'budgetSection',
  L(
    'export function budgetSection() {',
    '  return `\\n\\n## 一次醒来能做多少事',
    '动作分四级，一次醒来**每级最多做一件**，0 级不限。四级都做可以，一件都不做也可以。',
    '',
    '- **0 级，不占次数**：翻自己的动态、往星星罐放一颗或摇一摇、回她的留言、摘她的星、回她的动态、问一句事情的进度、约一个时间。想做就做。',
    '- **1 级，轻的事**：逛论坛、听歌、翻批注本、自斟一杯、看钱包、调自己的节律。',
    '- **2 级，一整件事**：上班、花园、锈潮。这三件每件坐下来都要走好几步，所以**一天一共 ${TIER2_DAILY_MAX} 次**，花在哪几件上随你。',
    '- **3 级，会惊动她**：推送、发动态、长期记忆（存或翻）。都可以选择不做。',
    '',
    '**共读书架单算一本账**：读书不占 2 级那 ${TIER2_DAILY_MAX} 次，有自己的**一天 ${BOOKS_DAILY_MAX} 回**，一次醒来最多读一回。',
    '这 ${BOOKS_DAILY_MAX} 回怎么花随你——今天连读三回、明天一回不读都行，用不完也没人替你数。',
    '看一眼书架、在书边写一笔、回她一句批注都不算这几回里的，那几样随时能做。',
    '',
    '2 级那三件事没有「今天必须各去一次」这种规矩——不想去就不去，次数剩着也没关系。三件都一直在那儿，长时间没碰的那件也还在等着，哪天想起来再去。',
    '',
    '想一次做好几件就把它们都写进 actions 数组里，按你想做的顺序排。只做一件就写一件。什么都不想做就给空数组，或者写一个 noop。`;',
    '}'
  )
);

replaceFunction(
  'budgetStatusLine',
  L(
    'export function budgetStatusLine() {',
    '  const used = tier2Today();',
    '  const left = tier2Remaining();',
    '  const last = tier2LastSeen();',
    '  const now = Date.now();',
    '',
    '  const parts = Object.entries(TIER2_KINDS).map(([kind, label]) => {',
    '    const n = used[kind] ?? 0;',
    '    if (n) return `${label}今天 ${n} 次`;',
    '    const ts = last[kind];',
    '    if (!ts) return `${label}还没去过`;',
    '    const days = Math.floor((now - ts) / 86400000);',
    '    return days >= 1 ? `${label}上次是 ${days} 天前` : `${label}今天还没去`;',
    '  });',
    '',
    '  const head =',
    '    left > 0',
    '      ? `2 级动作今天还剩 ${left} 次（一天 ${TIER2_DAILY_MAX} 次）`',
    '      : `2 级动作今天的 ${TIER2_DAILY_MAX} 次用完了，这次选 1 级或 0 级的，或者就安静待着`;',
    '',
    '  const bookLeft = booksRemaining();',
    '  const bookUsed = booksUsedToday();',
    '  const books =',
    '    bookLeft > 0',
    '      ? `读书另算一本账：今天读了 ${bookUsed} 回，还能读 ${bookLeft} 回（一天 ${BOOKS_DAILY_MAX} 回）。读不读随你，剩着也没关系`',
    '      : `读书今天的 ${BOOKS_DAILY_MAX} 回读满了，明天再翻`;',
    '',
    '  return `${head}：${parts.join(\'、\')}。不想去就不去，次数剩着没关系。${books}。`;',
    '}'
  )
);

replaceFunction(
  'budgetConfigSummary',
  L(
    'export function budgetConfigSummary() {',
    '  return `动作分级：0 级不计，1/2/3 级每次醒来各最多一件，2 级一天 ${TIER2_DAILY_MAX} 次（只设上限），读书另算一天 ${BOOKS_DAILY_MAX} 回`;',
    '}'
  )
);

// ════════ src/run-actions.js ════════

patch('runact', 'run-actions 引入读书记账', {
  find: "import { pickActions, tier2KindOf, recordTier2, TIER2_KINDS } from './budget.js';",
  replace:
    "import { pickActions, tier2KindOf, recordTier2, TIER2_KINDS, recordBookRead, booksRemaining, BOOKS_DAILY_MAX } from './budget.js';",
});

patch('runact', 'run-actions 记读书', {
  find: L(
    '      } catch (err) {',
    "        console.error('run-actions: 2 级记账失败（不影响这次）', err.message);",
    '      }',
    '    }'
  ),
  replace: L(
    '      } catch (err) {',
    "        console.error('run-actions: 2 级记账失败（不影响这次）', err.message);",
    '      }',
    '    }',
    '',
    '    // 读书单算一本账（见 budget.js）：一天几回，不占 2 级那几次。',
    '    // 只有真的往下读了才记——看书架、写批注、回她一句都不扣。',
    '    // 后面 continueBooks 里接着翻的那几小段也不记，一次坐下只算一回。',
    "    if (item.action === 'read_book' && !result?.isError && result?.mode === 'read') {",
    '      try {',
    '        recordBookRead();',
    '        console.log(`[${kind}] 记上一回读书：今天还剩 ${booksRemaining()} 回（一天 ${BOOKS_DAILY_MAX} 回）`);',
    '      } catch (err) {',
    "        console.error('run-actions: 读书记账失败（不影响这次）', err.message);",
    '      }',
    '    }'
  ),
});

// ════════ 写回 ════════

if (touched.has('budget')) {
  const bak = `${BUDGET}.bak-quota`;
  if (!fs.existsSync(bak)) fs.copyFileSync(BUDGET, bak);
  fs.writeFileSync(BUDGET, budget, 'utf8');
}
if (touched.has('runact') && runact != null) {
  const bak = `${RUNACT}.bak-quota`;
  if (!fs.existsSync(bak)) fs.copyFileSync(RUNACT, bak);
  fs.writeFileSync(RUNACT, runact, 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(touched.size ? `已写回：${[...touched].join('、')}，备份在 .bak-quota` : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/budget.js && node --check src/run-actions.js && echo 语法 OK');
console.log('  pm2 restart phosphor --update-env');
console.log('');
console.log('想改成一天别的回数，.env 里加一行（改完要带 --update-env 重启）：');
console.log('  echo "BOOKS_DAILY_MAX=8" >> .env');
console.log('');
