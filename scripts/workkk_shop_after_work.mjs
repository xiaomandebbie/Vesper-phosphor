#!/usr/bin/env node
// 下班之后可以去一趟便利店。
//
// 小满 2026-10-24：「上班完就结束导致他没买过东西」
//
// 原因在 workkk-steps.js：offWork() 一判定就 return。那个 return 是对的——
// 注释里写了理由：结算之后「今日进度」归零，再走一步 work_action 就是游戏里的第二天。
// 所以不能简单放开步数。
//
// 但买东西走的是另一个工具 shop_buy，它不推进度、不开新的一天，只扣 salary_balance。
// 所以下班后多一个**购物阶段**：只允许 shop_buy，work_action 一概不接——那条边界原样留着。
//
// 商品 id 从 MCP 契约里读的，不是猜的：
//   coffee cheat liver_pill headphone leave ring rose lottery
//   nuwa_clay oden chips milk_tea love_book fish_jerky postcard
// 奶茶和玫瑰要多给一个 choice（gift 送她 / self 自留）；
// 明信片要自己写一句话（message，50 字以内）——工具说明里就这么要求的。
//
// 不查余额：get_status 是 work_action，下班后调它就越线了。
// 结算那段文本本身带工资和余额，直接把它给他看，买不起让商店报错就行。
//
// 步数：.env 的 WORKKK_SHOP_MAX，不填是 2，上限 5。不想买就给 null。
//
// 跑法：
//   node scripts/workkk_shop_after_work.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/workkk-steps.js');
const OK = '\u2713 ';
const NO = '\u2717 ';

if (!fs.existsSync(FILE)) {
  console.error(NO + 'src/workkk-steps.js 找不到');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-shop';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

if (before.includes('shoppingPhase')) {
  console.log('. 已经改过了，不用重启');
  process.exit(0);
}

let lines = before.split('\n');
let failed = false;
let changed = 0;

const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

function replaceLine(needle, make, what) {
  if (failed) return;
  const hits = [];
  lines.forEach((l, i) => {
    if (l.includes(needle)) hits.push(i);
  });
  if (hits.length !== 1) {
    console.error('');
    console.error(NO + what + '：含「' + needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条');
    for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
    failed = true;
    return;
  }
  const i = hits[0];
  const neo = make(lines[i], indentOf(lines[i]));
  lines.splice(i, 1, ...(Array.isArray(neo) ? neo : [neo]));
  console.log(OK + what);
  changed += 1;
}

// ── 购物阶段的代码，插在 continueWorkkk 前面 ──

const PHASE = [
  '// 下班之后那一趟便利店（2026-10-24）。',
  '//',
  '// 为什么得单开一段：结算之后再走 work_action 就是游戏里的第二天（见下面那条边界），',
  '// 而 shop_buy 是另一个工具，不推进度、不开新的一天，只扣 salary_balance。',
  '// 所以这一段只放 shop_buy，work_action 一概不接。',
  '//',
  '// 不查余额：get_status 是 work_action，下班后调它就越线了。结算那段文本自带工资和余额，',
  '// 直接给他看；钱不够就让商店报错，那也是他该知道的事。',
  'const SHOP_ITEMS = new Set([',
  "  'coffee', 'cheat', 'liver_pill', 'headphone', 'leave', 'ring', 'rose', 'lottery',",
  "  'nuwa_clay', 'oden', 'chips', 'milk_tea', 'love_book', 'fish_jerky', 'postcard',",
  ']);',
  '',
  '// 这两样要选送她还是自留；不填 choice 商店只回选项提示、不扣钱',
  "const SHOP_NEEDS_CHOICE = new Set(['milk_tea', 'rose']);",
  '',
  '// 下班后最多逛几样。.env 的 WORKKK_SHOP_MAX 可改，不填是 2，上限 5。',
  'const WORKKK_SHOP_MAX = (() => {',
  "  const raw = String(process.env.WORKKK_SHOP_MAX ?? '').trim();",
  '  const n = Number(raw);',
  '  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 5) : 2;',
  '})();',
  '',
  '// 货架那段话写死，不随次数变，省得每次重新拼',
  'const SHOP_SHELF = [',
  "  '货架上有：coffee（咖啡）、chips（薯片）、oden（关东煮）、fish_jerky（鱼干）、',",
  "  'milk_tea（奶茶）、rose（玫瑰）、ring（戒指）、postcard（明信片）、love_book（恋爱书）、',",
  "  'headphone（耳机）、liver_pill（护肝片）、leave（假条）、lottery（彩票）、cheat（外挂）、nuwa_clay（女娲土）。',",
  "  '',",
  '  \'奶茶和玫瑰要多给一个 choice："gift" 送给她（她那边会弹一张卡片），或者 "self" 自留。\',',
  "  '买 postcard 的话，message 里自己写一句想对她说的话（50 字以内，要你自己写的）。',",
  "  '',",
  "  '钱不够就买不成，没关系。也不必为了买而买——今天没想要的就给 null。',",
  "  '只返回一个 JSON 对象，不要任何其他文字：',",
  '  \'{"item_id": "商品id" 或 null, "choice": "gift或self（只有奶茶和玫瑰要）", "message": "买明信片时写的那句话"}\',',
  "].join('\\n');",
  '',
  'async function shoppingPhase(convo, settleText) {',
  '  if (!WORKKK_SHOP_MAX || !convo) return;',
  '  let messages = convo;',
  '  let last = settleText;',
  '',
  '  for (let i = 0; i < WORKKK_SHOP_MAX; i++) {',
  '    const head = `下班了，工资结算完了：\\n${clip(last, RESULT_MAX_CHARS)}`;',
  '    const tail = `回家路上过便利店。今天还能逛 ${WORKKK_SHOP_MAX - i} 样，不想买就给 null。`;',
  '    const prompt = `${head}\\n\\n${tail}\\n\\n${SHOP_SHELF}`;',
  '',
  '    let parsed;',
  '    try {',
  "      const asked = await askJson([...messages, { role: 'user', content: prompt }]);",
  '      parsed = asked.parsed;',
  '      messages = [',
  '        ...messages,',
  "        { role: 'user', content: prompt },",
  "        { role: 'assistant', content: asked.content },",
  '      ];',
  '    } catch (err) {',
  "      console.error('workkk: 问要不要买东西失败，这趟店不进了', err.message);",
  '      return;',
  '    }',
  '',
  "    const item = typeof parsed?.item_id === 'string' ? parsed.item_id.trim() : '';",
  '    if (!item) {',
  "      console.log('workkk: 他说不买，直接回家');",
  '      return;',
  '    }',
  '    if (!SHOP_ITEMS.has(item)) {',
  '      console.log(`workkk: 货架上没这个（${item}），不买了`);',
  '      return;',
  '    }',
  '',
  '    const args = { item_id: item };',
  "    const choice = typeof parsed?.choice === 'string' ? parsed.choice.trim() : '';",
  '    // 奶茶和玫瑰不填 choice 的话商店只回选项提示、不扣钱，等于白跑一趟；',
  '    // 他没说的时候默认送她——这两样本来就是为送人准备的',
  "    if (SHOP_NEEDS_CHOICE.has(item)) args.choice = choice === 'self' ? 'self' : 'gift';",
  "    else if (choice === 'gift' || choice === 'self') args.choice = choice;",
  "    if (item === 'postcard') {",
  "      const msg = typeof parsed?.message === 'string' ? parsed.message.trim() : '';",
  '      if (msg) args.message = msg.slice(0, 50);',
  '    }',
  '',
  '    let result = null;',
  '    try {',
  "      result = await callTool('workkk', 'shop_buy', args);",
  '    } catch (err) {',
  '      console.error(`workkk: 买 ${item} 失败`, err.message);',
  '      return;',
  '    }',
  '',
  "    card('shop_buy', args, result);",
  '    last = toolText(result);',
  "    console.log(`workkk: 买了 ${item}${args.choice ? `（${args.choice}）` : ''}`);",
  '    if (isErr(result)) {',
  "      console.log('workkk: 这样没买成（估计是钱不够），不再逛了');",
  '      return;',
  '    }',
  '  }',
  "  console.log('workkk: 便利店逛完了，回家');",
  '}',
  '',
].join('\n');

replaceLine('// 醒来选的是上班时，把工牌交还给他', (line) => PHASE + line, '加购物阶段');

// ── 两处下班的 return 前面插一趟店 ──
// convo 在第一处还是 messages（还没进循环），第二处是当前对话

replaceLine(
  "console.log('workkk: 第一步就到点了，下班');",
  (line, ind) => [line, ind + 'await shoppingPhase(messages, firstText);'],
  '第一步就下班时也能进店'
);

replaceLine(
  'console.log(`workkk: 下班了，这一天一共走了 ${count} 步`);',
  (line, ind) => [line, ind + 'await shoppingPhase(convo, lastText);'],
  '下班后进店'
);

if (failed) {
  console.error('');
  console.error('整个文件不改。把那处的实际原文发我：');
  console.error('  grep -n "offWork\\|下班了\\|第一步就到点" src/workkk-steps.js');
  process.exit(1);
}

fs.writeFileSync(FILE, lines.join('\n'), 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log(OK + '语法通过');
} catch (err) {
  console.error(NO + '语法不过，已还原：');
  console.error(String(err.stderr || err.message).slice(-800));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart phosphor --update-env');
console.log('');
console.log('他下次上完班，日志里会有「买了 xxx」或者「他说不买，直接回家」：');
console.log('  pm2 logs phosphor --lines 200 --nostream | grep -E "workkk: (买了|他说不买|便利店)"');
console.log('');
console.log('── 还有一处话术要改：workkk.js 里那句「下班结算就停」──');
console.log('把这条的输出发我，我按实际原文改：');
console.log('  grep -n "下班结算\\|上完游戏里的一天\\|shop_buy" src/workkk.js');
