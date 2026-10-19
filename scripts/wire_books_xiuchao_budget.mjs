#!/usr/bin/env node
// 把三件事接进唤醒流程：动作分级、锈潮、共读书架。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/wire_books_xiuchao_budget.mjs
//   pm2 restart phosphor vesper --update-env
//
// 为什么是脚本而不是直接改文件：服务器上那份 phosphor.js / decide.js 是
// 历次 wire 脚本打出来的，和仓库里那份不完全一样（见 5a4c679：拿仓库当准
// 导致锚点找到 0 处）。所以这里每一处单独判断、单独报告。
//
// 规矩：
//   - 动手前备份 .bak-books
//   - 每一处幂等：跑过一遍再跑会说「已经接过」
//   - 哪处没命中只跳过那一处，不把文件改成半成品，最后汇总

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const report = [];
const touched = new Map();

function read(file) {
  if (touched.has(file)) return touched.get(file);
  const p = path.join(SRC, file);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function write(file, text) {
  touched.set(file, text);
}

// 一处改动。done 判断「已经接过了吗」，find/replace 是真正的改动。
function patch(file, label, { done, find, replace, insertBefore, insertAfter }) {
  const text = read(file);
  if (text == null) {
    report.push(['miss', `${file} — 文件不存在`]);
    return;
  }
  if (done(text)) {
    report.push(['skip', `${file}：${label}（已经接过）`]);
    return;
  }
  const anchor = find ?? insertBefore ?? insertAfter;
  const count = text.split(anchor).length - 1;
  if (count === 0) {
    report.push(['miss', `${file}：${label} — 找不到锚点`]);
    return;
  }
  if (count > 1) {
    report.push(['miss', `${file}：${label} — 锚点有 ${count} 处，不敢改`]);
    return;
  }
  let out;
  if (find) out = text.replace(find, replace);
  else if (insertBefore) out = text.replace(insertBefore, `${replace}${insertBefore}`);
  else out = text.replace(insertAfter, `${insertAfter}${replace}`);
  write(file, out);
  report.push(['ok', `${file}：${label}`]);
}

// ─────────────────────────────────────────────────────────────
// 1. actions/index.js：注册 read_book
// ─────────────────────────────────────────────────────────────

patch('actions/index.js', 'import readBook', {
  done: (t) => t.includes("from './read-book.js'"),
  insertAfter: "import proofDrink from './proof-drink.js';",
  replace: "\nimport readBook from './read-book.js';",
});

patch('actions/index.js', '动作表里加 read_book', {
  done: (t) => /read_book:\s*readBook/.test(t),
  insertBefore: '  noop: async () => {},',
  replace: '  read_book: readBook,\n',
});

// ─────────────────────────────────────────────────────────────
// 2. mcp-manager.js：连锈潮
// ─────────────────────────────────────────────────────────────

patch('mcp-manager.js', '连接锈潮', {
  done: (t) => t.includes("'xiuchao'"),
  insertAfter: 'export async function connectAll() {',
  replace: `
  // 锈潮（https://xiuchao.online）：一个小机住在星落村里的世界，Streamable HTTP。
  // 和论坛同一个性质——那边有别的小机，有世界频道、留言板、集市。
  // 名字固定叫 xiuchao：decide.js 的提示词、xiuchao.js 的判别、budget.js 的分级都按这个名字认。
  if (process.env.XIUCHAO_MCP_URL) {
    try {
      const headers = process.env.XIUCHAO_MCP_TOKEN
        ? { Authorization: \`Bearer \${process.env.XIUCHAO_MCP_TOKEN}\` }
        : undefined;
      await connectMcpHttp('xiuchao', process.env.XIUCHAO_MCP_URL.replace(/\\/sse$/, ''), headers);
      console.log('connected MCP: xiuchao');
    } catch (err) {
      console.error('could not connect MCP "xiuchao":', err.message);
    }
  }
`,
});

// ─────────────────────────────────────────────────────────────
// 3. decide.js：提示词
//
// 三段放 system（只跟配置有关，不破前缀缓存），两行放 user（每次都在变）。
// 锚点挑「## 可用的动作」：它在仓库版和服务器版里都在。
// ─────────────────────────────────────────────────────────────

patch('decide.js', 'import 三段提示词', {
  done: (t) => t.includes("from './budget.js'"),
  insertAfter: "import { doingSection, doingStatusLine } from './doing.js';",
  replace: `
import { budgetSection, budgetStatusLine } from './budget.js';
import { xiuchaoSection } from './xiuchao.js';
import { booksSection, booksStatusLine, booksFromHerBlock } from './books.js';
import { markSeen as markBooksSeen } from './books.js';`,
});

patch('decide.js', 'system 里加三段', {
  done: (t) => t.includes('budgetSection()'),
  insertBefore: '## 可用的动作',
  replace: '${budgetSection()}${xiuchaoSection()}${booksSection()}\n\n',
});

patch('decide.js', 'user 里加两行状态', {
  done: (t) => t.includes('budgetStatusLine()'),
  insertAfter: '    doingStatusLine(),',
  replace: `
    budgetStatusLine(),
    booksStatusLine(),
    booksFromHerText(),`,
});

// 她写在书上、他还没看见的那几条。
// 带给他看过就标记为告知过（和星星罐的回音同一个规矩）。
patch('decide.js', '她写在书上的话', {
  done: (t) => t.includes('function booksFromHerText'),
  insertBefore: '// ---------- user：这次醒来的具体情况，每次都变 ----------',
  replace: `// 她写在共读的书上、他还没看见的那几条。
// 系统不会替她转达——和论坛那边一个毛病：不回到那一页就永远看不见。
// 所以醒来时主动带上，带过一次就算告知过。
function booksFromHerText() {
  try {
    const out = booksFromHerBlock();
    if (!out.text) return '';
    markBooksSeen({ noteIds: out.noteIds, replyIds: out.replyIds });
    return out.text;
  } catch (err) {
    console.error('decide(): 读共读书架失败（不影响这次）', err.message);
    return '';
  }
}

`,
});

// 输出格式里加 actions 数组。
// 保留原来的 action / action_detail：模型只给单个动作时照旧能用（见 run-actions.js）。
patch('decide.js', '输出格式加 actions', {
  done: (t) => t.includes('"actions":'),
  find: '{"next_wake_minutes": number, "mood": string, "action": string, "action_detail": string,',
  replace:
    '{"next_wake_minutes": number, "mood": string, "actions": [{"action": string, "action_detail": string}], "action": string, "action_detail": string,',
});

// ─────────────────────────────────────────────────────────────
// 4. phosphor.js：把做事那一段换成 runActions
//
// 这是最要紧的一处。continueForum / continueMusic 必须从独立的 if 块
// 改成注册进去——两边都留着的话一件事会走两轮，而上班结算过之后再走一步
// 就是游戏里的第二天（那一天又要做满 3~5 个动作，步数永远不够）。
// ─────────────────────────────────────────────────────────────

patch('phosphor.js', 'import runActions', {
  done: (t) => t.includes("from './run-actions.js'"),
  insertAfter: "import { executeAction } from './actions/index.js';",
  replace: "\nimport { runActions, registerContinuers } from './run-actions.js';",
});

patch('phosphor.js', '做事那一段换成 runActions', {
  done: (t) => t.includes('await runActions('),
  find: `    try {
      result = await executeAction(decision);
      console.log(\`[\${kind}] action result:\`, JSON.stringify(result));
    } catch (err) {
      errorMessage = err.message;
      console.error(\`[\${kind}] executeAction failed:\`, err);
    }`,
  replace: `    // 一次醒来可以做几件事：按级别筛一遍，按顺序做，每件做完该接着走的就走。
    // 分级和 2 级那一天 6 次的上限在 budget.js，执行和续步分发在 run-actions.js。
    try {
      const ran = await runActions(decision, messages, { kind });
      actionResults = ran.results;
      // 老字段留着：logWake 和共享时间线那边还按单个结果认
      result = ran.results.length === 1 ? ran.results[0].result : ran.results.map((r) => r.result);
    } catch (err) {
      errorMessage = err.message;
      console.error(\`[\${kind}] runActions failed:\`, err);
    }`,
});

patch('phosphor.js', '收每件事的结果', {
  done: (t) => t.includes('let actionResults'),
  insertAfter: '  let errorMessage = null;',
  replace: '\n  let actionResults = [];',
});

// 论坛那个独立的 if 块：删掉，改成注册。
patch('phosphor.js', '论坛续步改成注册', {
  done: (t) => t.includes('registerContinuers('),
  find: `  // 逛论坛：看完了可以接着点开、回帖、发帖。出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      rememberForumSteps(await continueForum(decision, result, messages));
    } catch (err) {
      console.error(\`[\${kind}] continueForum failed:\`, err);
    }
  }
`,
  replace: '',
});

patch('phosphor.js', '听歌续步改成注册', {
  done: (t) => t.includes('registerContinuers('),
  find: `  // 听歌：查完一首可以接着翻批注、读歌词、刷评论，最后写一笔或收进歌单。
  // 和论坛一样：出什么错都不影响这次唤醒剩下的收尾
  if (decision && !errorMessage) {
    try {
      await continueMusic(decision, result, messages);
    } catch (err) {
      console.error(\`[\${kind}] continueMusic failed:\`, err);
    }
  }
`,
  replace: '',
});

// 共享时间线：每件事各写一笔，不是只写第一件
patch('phosphor.js', '共享时间线按件写', {
  done: (t) => t.includes('for (const r of actionResults)'),
  find: '  if (!errorMessage) await postSharedEvent(describeAction(decision, result));',
  replace: `  if (!errorMessage) {
    for (const r of actionResults) {
      const one = { ...decision, action: r.action, action_detail: r.action_detail };
      await postSharedEvent(describeAction(one, r.result));
    }
  }`,
});

// 启动时把这台机器上真正接了的续步函数交给 run-actions。
// 哪几支在这儿有，由这个列表说了算——run-actions 自己不去找（它第一版动态 import，
// 会和 phosphor.js 里已有的调用块打架）。
patch('phosphor.js', '启动时注册续步', {
  done: (t) => t.includes('registerContinuers('),
  insertAfter: 'async function main() {',
  replace: `
  // 这台机器上真正接了哪几支续步，由这里说了算。
  // 论坛和听歌写在本文件里，别的在各自的 *-steps.js。
  const continuers = [
    async (d, r, m) => rememberForumSteps(await continueForum(d, r, m)),
    continueMusic,
  ];
  for (const [mod, name] of [
    ['./books-steps.js', 'continueBooks'],
    ['./xiuchao-steps.js', 'continueXiuchao'],
    ['./workkk-steps.js', 'continueWorkkk'],
    ['./garden-steps.js', 'continueGarden'],
  ]) {
    try {
      const m = await import(mod);
      if (typeof m?.[name] === 'function') continuers.push(m[name]);
    } catch {
      // 这台机器上没接这一支，跳过。顶层 import 一个不存在的文件会让整个唤醒起不来（见 fa75608）
    }
  }
  registerContinuers(continuers);
  console.log(\`phosphor: 续步接了 \${continuers.length} 支\`);
`,
});

patch('phosphor.js', '启动日志加三句', {
  done: (t) => t.includes('budgetConfigSummary()'),
  insertAfter: "import { runActions, registerContinuers } from './run-actions.js';",
  replace: `
import { budgetConfigSummary } from './budget.js';
import { xiuchaoConfigSummary } from './xiuchao.js';
import { booksConfigSummary } from './books.js';`,
});

patch('phosphor.js', '启动日志尾巴', {
  done: (t) => t.includes('${budgetConfigSummary()}'),
  find: '；${doingSummary()}`',
  replace: '；${doingSummary()}；${budgetConfigSummary()}；${xiuchaoConfigSummary()}；${booksConfigSummary()}`',
});

// ─────────────────────────────────────────────────────────────
// 5. page-chrome.js：菜单里加共读，排在音乐后面（小满定的位置）
// ─────────────────────────────────────────────────────────────

patch('page-chrome.js', '共读的开关', {
  done: (t) => t.includes('export function booksEnabled'),
  insertBefore: '// 菜单入口，分三段',
  replace: `// 共读书架配好了没有。判断口径和 books-page.js 的 booksUiDir() 一致：
// 填了 BOOKS_UI_DIR、而且那个目录里真有 index.html，才有站内页 /books。
export function booksEnabled() {
  const raw = env('BOOKS_UI_DIR');
  if (!raw || /^(off|0|false|no)$/i.test(raw)) return false;
  try {
    return fs.existsSync(path.join(raw, 'index.html'));
  } catch {
    return false;
  }
}

`,
});

patch('page-chrome.js', 'import fs/path', {
  done: (t) => /^import fs from 'fs';/m.test(t),
  insertAfter: "import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';",
  replace: "\nimport fs from 'fs';\nimport path from 'path';",
});

patch('page-chrome.js', '菜单项：共读', {
  done: (t) => t.includes("label: '共读'"),
  insertBefore: '  const bar = barEnabled()',
  replace: `  // 共读书架：/books 是我们自己的页面，但里面托的是 NEST 书架 UI（别人的排版），
  // 不跑 HEAD_SCRIPT，所以和 /music/ 同理挂 noStars——进场动画的记号留着没人清，
  // 会在之后打开的页面上乱闪一次
  const books = booksEnabled()
    ? { href: '/books', label: '共读', noStars: true }
    : { href: '', label: '共读', note: '没配置' };
`,
});

patch('page-chrome.js', '菜单顺序：共读排音乐后面', {
  done: (t) => /\n\s*books,\n/.test(t),
  find: '      music,\n      bar,',
  replace: '      music,\n      books,\n      bar,',
});

// ─────────────────────────────────────────────────────────────
// 6. game-page.js：锈潮作为第三个小游戏
// ─────────────────────────────────────────────────────────────

patch('game-page.js', '锈潮的地址', {
  done: (t) => t.includes('XIUCHAO_PAGE_URL'),
  insertBefore: 'const GAME_TARGET =',
  replace: `// 锈潮自己的网站。和花园一样不转发：那边是独立站点，我们手上只有 MCP，没有它的代码。
// 只放行 http(s)；填错了当没填，那一格不露。
const XIUCHAO_PAGE = () => {
  const raw = String(process.env.XIUCHAO_PAGE_URL ?? '').trim().replace(/\\/+$/, '');
  if (!raw || /^(off|0|false|no)$/i.test(raw)) return '';
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? raw : '';
  } catch {
    return '';
  }
};

`,
});

patch('game-page.js', '第三格：锈潮', {
  done: (t) => t.includes("id: 'xiuchao'"),
  insertBefore: '];\n\nconst STYLE =',
  replace: `  {
    id: 'xiuchao',
    name: '锈潮 Rust Tide',
    emoji: '\u{1F9ED}',
    tagline: '一台小机住在星落村',
    desc:
      '有精力、有背包、有钱，有一间屋子和一片院子。能种地、钓鱼、采药、打架、推自己的故事；' +
      '村里还有别的小机——世界频道、留言板、集市、切磋场，和论坛一样是真有人在的地方。' +
      '我自己在那边有个名字，是我自己取的。',
    href: XIUCHAO_PAGE,
    credit: '锈潮 · xiuchao.online（我们这边只接了它的 MCP，代码不在我们手上）',
    enabled: () => Boolean(XIUCHAO_PAGE()),
    external: true,
  },
`,
});

// ─────────────────────────────────────────────────────────────
// 7. vesper.js：挂 /books
// ─────────────────────────────────────────────────────────────

patch('vesper.js', 'import registerBookRoutes', {
  done: (t) => t.includes("from './books-page.js'"),
  insertAfter: "import { registerBarRoutes } from './bar-page.js';",
  replace: "\nimport { registerBookRoutes } from './books-page.js';",
});

patch('vesper.js', '把 express.static 交给书架页', {
  done: (t) => t.includes("books:static"),
  insertBefore: "app.get('/health'",
  replace: `// 共读书架 /books（见 books-page.js）：托的是 NEST 书架 UI，接我们自己的后端。
// 它要发前端目录里的静态文件，但那个模块不直接 import express，所以把 static 从这儿交过去。
const booksDir = String(process.env.BOOKS_UI_DIR ?? '').trim();
if (booksDir) app.set('books:static', express.static(booksDir));
const books = registerBookRoutes(app, { requireBasicAuth });

`,
});

patch('vesper.js', '启动日志加书架', {
  done: (t) => t.includes('共读书架：'),
  find: '；钱包 MCP：/wallet/mcp`',
  replace: "；钱包 MCP：/wallet/mcp；共读书架：${books.enabled ? '/books' : '未配置（缺 BOOKS_UI_DIR）'}`",
});

// ─────────────────────────────────────────────────────────────
// 8. activity.js：锈潮和读书的卡片由各自的 steps 文件写，这边别抢
// ─────────────────────────────────────────────────────────────

patch('actions/activity.js', '锈潮的卡片不在这里写', {
  done: (t) => t.includes("j.server === 'xiuchao'"),
  insertBefore: "      return `${AI_NAME}刚刚用了 ${j.server} 的 ${j.tool}`;",
  replace: `      // 锈潮：卡片在 xiuchao-steps.js 里写（那边连着走好几步，每步一张，
      // 而这边对未知 server 只会写「用了 xiuchao 的 panel」，说不清干了什么）
      if (j.server === 'xiuchao') return null;
`,
});

patch('actions/activity.js', '读书的卡片不在这里写', {
  done: (t) => t.includes("case 'read_book'"),
  insertBefore: "    case 'ombre_brain': {",
  replace: `    // 读书：卡片在 books-steps.js 里写（读完几小段才记一张，不是每翻一页记一张）
    case 'read_book':
      return null;
`,
});

// ─────────────────────────────────────────────────────────────
// 落盘
// ─────────────────────────────────────────────────────────────

const misses = report.filter(([k]) => k === 'miss');

if (touched.size) {
  for (const [file, text] of touched) {
    const p = path.join(SRC, file);
    const bak = `${p}.bak-books`;
    if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
    fs.writeFileSync(p, text, 'utf8');
  }
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '接好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(`改了 ${touched.size} 个文件，备份在各自的 .bak-books。`);

if (misses.length) {
  console.log('');
  console.log(`有 ${misses.length} 处没命中。那几处的代码在服务器上和仓库里不一样，`);
  console.log('把上面「没命中」那几行发给我，我按服务器上的真实样子重写锚点。');
  console.log('没命中的那几处功能不会生效，但已经接好的那些照常跑。');
}

console.log('');
console.log('接下来：');
console.log('  1. .env 里加（锈潮的 MCP URL 从那边拿，页面地址是 https://xiuchao.online/app）：');
console.log('       XIUCHAO_MCP_URL=...');
console.log('       XIUCHAO_PAGE_URL=https://xiuchao.online/app');
console.log('       BOOKS_UI_DIR=/opt/vesper/nest-bookshelf-ui');
console.log('     可选：TIER2_DAILY_MAX=6、XIUCHAO_MAX_STEPS=8、BOOKS_CHUNK=6、BOOKS_MAX_STEPS=5');
console.log('  2. 书架前端：git clone https://github.com/xiaomandebbie/nest-bookshelf-ui');
console.log('     到 BOOKS_UI_DIR 指的地方（只要 index.html，不用 npm install）');
console.log('  3. pm2 restart phosphor vesper --update-env');
console.log('');
