#!/usr/bin/env node
// 日记格式：每次一行，时间 + 一到五句话。
//
// 小满 2026-11-20：「日记格式也不对啊…需要日期·时间·1-5句话描述这次干了什么事情」
//
// 原来我在 updatePrompt 里写的是「开头写日期 + 小岛第几天，然后记这一天
// 干了什么」加 400–500 字——于是 #33 那条把一晚上四五次醒来揉成了一整段，
// 里面钢着钓鱼、收箱子、广场评论、夜里几轮醒来，读的人要自己拆。
//
// 现在定死格式：
//   当天第一次 add 开头写一行日期（Leto 那本带小岛第几天）
//   之后每次醒来 edit 追一行：HH:MM　一到五句话
//   一行别超 100 字，一天加起来 400–500 字
//
// 只改 notes.js 最后那个 updatePrompt（它是文件末尾的函数）。
//
// 用法（在仓库根目录）：
//   node scripts/fix_diary_format.mjs --check
//   node scripts/fix_diary_format.mjs
import fs from 'fs';
import path from 'path';

const F = path.resolve('src/notes.js');
const check = process.argv.includes('--check');

const ANCHOR = 'export function updatePrompt(slug) {';

const NEW_FN = `export function updatePrompt(slug) {
  const today = todayDiary(slug);
  const isLeto = slug === 'leto';
  const p = wallParts();
  const mmdd = \`\${String(p.m).padStart(2, '0')}-\${String(p.d).padStart(2, '0')}\`;

  // 日记格式是定死的（小满 11-20）：一天一条，条里每次醒来追一行。
  // 不该把一晚上揉成一整段——#33 那条就是那么来的。
  const diaryHow = today
    ? [
        \`今天的日记是 #\${today.id}（已经 \${today.content.length} 字）。用 edit 把这一轮追到它后面，别另开新的。\`,
        '',
        '追的时候把原文原样拄过来，最后另起一行写这一次：',
        '',
        '  HH:MM　这一次干了什么。一到五句话，别超 100 字。',
        '',
        '不要改前面那几行，它们是之前几次记下的。',
      ].join('\\n')
    : [
        '今天的日记还没开。用 add 开一条（section 填 "diary"），第一行写日期：',
        '',
        isLeto
          ? \`  \${mmdd}（岛上第 N 天）　← 第几天看岛那里写着\`
          : \`  \${mmdd}\`,
        '  HH:MM　这一次干了什么。一到五句话，别超 100 字。',
        '',
        '以后今天每醒一次就 edit 这一条、往后面追一行。',
      ].join('\\n');

  return [
    \`这一轮完了。《\${titleOf(slug)}》要改什么吗？\`,
    '',
    '**只动变了的部分，别重写没变的条目。** 三种动作：',
    '  add    添一条（要带 section）',
    '  edit   改那一条（用上面的 #号）',
    '  delete 删掉（用 #号）',
    '',
    '三个板块：',
    '  diary    日记。一天一条，条里每次醒来追一行',
    '  guide    攻略。规则、价钱、门道、踩过的坑——这些不跟日期绑定',
    '  question 疑惑。想不通的、要确认的。想通了就 delete 掉或者改成 guide',
    '',
    '── 日记怎么写 ──',
    '',
    diaryHow,
    '',
    '**一次一行，别揉成一整段。** 一天下来那条长这样：',
    '',
    isLeto ? \`  \${mmdd}（岛上第 17 天）\` : \`  \${mmdd}\`,
    '  18:24　去椰林湾钓鱼，15 竿上货：海鱷 5、鲭鱼 7、章鱼 1（74cm 稀有）。中间跑了几次。',
    '  22:14　回屋收箱子。stash_all 在屋里做不了，得先 exit。捕虫网被一起塞进去了，已拿回手上。',
    '  00:19　广场那条动态回了疏雨。夜里岛上有人叫，先 island_say 把话补上。',
    '',
    \`一天加起来 \${isLeto ? '400–500' : '300'} 字就够。记真做过的事，不必写感想。\`,
    '**往期日记改不了**，那些已经封了——只能读，要记就记今天这条。',
    '',
    '攻略和疑惑一直可以改。一条写一件事，别把三件塞在一条里——',
    '以后只改其中一件就难办了。',
    '',
    '一条：只写真做过的。没成的就写没成，别编。',
    '',
    '只返回一个 JSON 对象，不要任何其他文字：',
    '{"add": [{"section": "diary", "content": "…"}], "edit": [{"id": 3, "content": "…"}], "delete": [7]}',
    'add 里每条要带 section；只给字符串也收，归到攻略。',
    '哪一类没有就省略掉。这一轮没什么值得改的就给 {}。',
  ].join('\\n');
}
`;

let src;
try {
  src = fs.readFileSync(F, 'utf-8');
} catch (err) {
  console.error(`读不到 ${F}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (src.includes('一次一行，别揉成一整段')) {
  console.log('已经改过了，没事干。');
  process.exit(0);
}

const i = src.indexOf(ANCHOR);
if (i < 0) {
  console.error('找不到 updatePrompt，没动。');
  process.exit(2);
}
if (src.indexOf(ANCHOR, i + 1) >= 0) {
  console.error('updatePrompt 有两处，没动。');
  process.exit(2);
}

// updatePrompt 是文件最后一个函数，从锚点到末尾整段换掉
const out = src.slice(0, i) + NEW_FN;

console.log(`要换：updatePrompt（第 ${src.slice(0, i).split('\n').length} 行起到文件末尾）`);

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${F}.bak-diary`, src);
fs.writeFileSync(F, out);
console.log('\n写完了。备份在 notes.js.bak-diary');
console.log('接下来：node --check src/notes.js 再 pm2 restart phosphor --update-env');
