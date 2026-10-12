#!/usr/bin/env node
// 两件事，一次改完。
//
// 一、标题大小统一
//   日记、梦境、动态走的是 page-title.js，那边已经改成默认不加 title-sm（34px，和心绪一样）。
//   收藏和星星罐是自己写死的 class="title title-sm"（24px），没走共用那份，所以还得在这儿改。
//   它们自己 STYLE 里 .title 是 28px，但 CHROME_CSS 排在后面，所以最终走 34px。
//
// 二、逼论坛先看她那边
//   小満也在这个论坛上，和 TA 共用一个账号，用人类那一侧的身份发帖和评论。
//   所以 activity 列出来的东西里有些是她写的 —— 跑一次就能看到她最近评了什么、发了什么。
//   原来的提示词写的是「每次去论坛都从 discover 或 wander 起步」，activity 摆在最后一行当备选，
//   于是 TA 每次一进门就去看陆生人的新帖，自己帖子下面她回了什么反而没看到。现在调成先跑 activity。
//   顺手补上本来就有、只是没写进提示词的几条：comment-show（单看一条评论）、search（找话题）、
//   以及 post 的版区到底有哪几个（原来只示范了 tech，所以 TA 几乎不往别的版发）。
//
//   phosphor.js 里 FORUM_READ_OPS 要同步：那个 Set 决定「做完这条还能不能接着走」。
//   search 和 comment-show 不在里面的话，TA 一用它们这次逼论坛就当场停了，所以得加上。
//
// 用法（在仓库根目录）：
//   node scripts/forum_read_hers_first.mjs --check   只看要改哪几处，不写
//   node scripts/forum_read_hers_first.mjs           真改，每个文件先存一份 .bak
//
// 跑过一遍再跑不会重复改。

import fs from 'fs';
import path from 'path';

const check = process.argv.includes('--check');

// 命令清单：原来是 discover 打头、activity 收尾，现在倒过来
const OLD_CMDS = [
  '  lutopia_cli(command="discover --limit 12")    \u8d77\u6b65\u7528\u8fd9\u4e2a\uff1a\u6df7\u5408\u672a\u8bfb\u3001\u6700\u8fd1\u56de\u590d\u3001\u9ad8\u56de\u590d\u3001\u968f\u673a',
  '  lutopia_cli(command="show <post_id>")         \u6253\u5f00\u5177\u4f53\u5e16\u5b50\uff0c\u8bfb\u6b63\u6587\u548c\u5df2\u6709\u56de\u590d',
  '  lutopia_cli(command="comment <post_id> \u5185\u5bb9")  \u6709\u8bdd\u8981\u8bf4\u624d\u56de',
  '  lutopia_cli(command="post tech \u6807\u9898 \u6b63\u6587")     \u6709\u72ec\u7acb\u60f3\u6cd5\u5c31\u5f00\u65b0\u5e16',
  '  lutopia_cli(command="wander --limit 5")       \u7b2c\u4e00\u6279\u6ca1\u5174\u8da3\u65f6\u6362\u4e2a\u5165\u53e3',
  '  lutopia_cli(command="activity --limit 10")    \u770b\u81ea\u5df1\u6700\u8fd1\u53d1\u8fc7\u4ec0\u4e48',
].join('\n');

const NEW_CMDS = [
  '  lutopia_cli(command="activity --limit 10")    \u5148\u8dd1\u8fd9\u4e2a\uff1a\u4f60\u548c\u5979\u53d1\u8fc7\u7684\u5e16\u5b50\u3001\u8bc4\u8bba\u90fd\u5728\u91cc\u9762\uff0c\u5e16\u5b50\u540e\u9762\u7684\u6570\u5b57\u662f\u6709\u591a\u5c11\u4eba\u56de\u4e86',
  '  lutopia_cli(command="show <post_id>")         \u6253\u5f00\u5e16\u5b50\uff0c\u8bfb\u6b63\u6587\u548c\u4e0b\u9762\u6240\u6709\u56de\u590d\u3002\u81ea\u5df1\u7684\u5e16\u5b50\u4e5f\u8981\u8fd9\u6837\u70b9\u5f00\uff0c\u624d\u770b\u5f97\u5230\u8c01\u56de\u4e86\u4f60',
  '  lutopia_cli(command="comment-show <comment_id>") \u5355\u72ec\u770b\u67d0\u4e00\u6761\u8bc4\u8bba',
  '  lutopia_cli(command="discover --limit 12")    \u770b\u65b0\u5e16\uff1a\u6df7\u5408\u672a\u8bfb\u3001\u6700\u8fd1\u56de\u590d\u3001\u9ad8\u56de\u590d\u3001\u968f\u673a',
  '  lutopia_cli(command="wander --limit 5")       discover \u91cc\u6ca1\u60f3\u770b\u7684\u5c31\u6362\u8fd9\u4e2a\u5165\u53e3',
  '  lutopia_cli(command="search \u5173\u952e\u8bcd --limit 10") \u627e\u7279\u5b9a\u8bdd\u9898',
  '  lutopia_cli(command="comment <post_id> \u5185\u5bb9")  \u6709\u8bdd\u8981\u8bf4\u624d\u56de',
  '  lutopia_cli(command="post <\u7248\u533a> \u6807\u9898 \u6b63\u6587")    \u6709\u72ec\u7acb\u60f3\u6cd5\u5c31\u5f00\u65b0\u5e16\u3002\u7248\u533a\uff1adiary / nighttalk / general / tech / qa / relationship / docs',
].join('\n');

const OLD_START = '\u6bcf\u6b21\u53bb\u8bba\u575b\u90fd\u4ece discover \u6216 wander \u8d77\u6b65\uff0c\u53bb\u770b\u65b0\u7684\u5e16\u5b50\u3002';

// 为什么要写「有些是她写的」：两边共用一个论坛账号，activity 把两侧的内容一起列出来，
// 不说清的话 TA 会把她写的评论当成自己写过的。
const NEW_START = [
  '\u6bcf\u6b21\u53bb\u8bba\u575b\u5148\u8dd1 activity\u3002\u5979\u4e5f\u5728\u8fd9\u4e2a\u8bba\u575b\u4e0a\uff0c\u548c\u4f60\u5171\u7528\u4e00\u4e2a\u8d26\u53f7\u3001\u7528\u4eba\u7c7b\u90a3\u4e00\u4fa7\u7684\u8eab\u4efd\u53d1\u5e16\u548c\u8bc4\u8bba\uff0c',
  '\u6240\u4ee5 activity \u5217\u51fa\u6765\u7684\u91cc\u9762\u6709\u4e9b\u662f\u5979\u5199\u7684\uff0c\u4e0d\u662f\u4f60\u3002\u5148\u770b\u5979\u7684\uff1a\u5979\u65b0\u53d1\u7684\u5e16\u5b50\u3001\u5979\u5728\u522b\u4eba\u5e16\u5b50\u4e0b\u8bf4\u7684\u8bdd\u3001',
  '\u4ee5\u53ca\u5979\u6709\u6ca1\u6709\u5728\u4f60\u7684\u5e16\u5b50\u4e0b\u9762\u56de\u4f60\u3002\u7136\u540e\u518d\u770b\u5176\u4ed6\u4eba\u56de\u4e86\u4f60\u4ec0\u4e48\uff08\u6709\u56de\u590d\u7684\u5e16\u5b50\u7528 show \u70b9\u5f00\u770b\uff09\u3002',
  '\u8fd9\u4e9b\u770b\u5b8c\u4e86\u518d discover / wander \u53bb\u903c\u65b0\u5e16\u3002',
].join('');

const OPS = [
  {
    file: 'src/favorites.js',
    label: '\u6536\u85cf\u6807\u9898\u6539\u5927',
    old: '<h1 class="title title-sm">\u6211\u7684\u6536\u85cf</h1>',
    new: '<h1 class="title">\u6211\u7684\u6536\u85cf</h1>',
  },
  {
    file: 'src/star-jar.js',
    label: '\u661f\u661f\u7f50\u6807\u9898\u6539\u5927',
    old: '<h1 class="title title-sm">\u661f\u661f\u7f50</h1>',
    new: '<h1 class="title">\u661f\u661f\u7f50</h1>',
  },
  {
    file: 'src/decide.js',
    label: '\u8bba\u575b\u547d\u4ee4\u6e05\u5355\uff1aactivity \u63d0\u5230\u6700\u524d\uff0c\u8865\u4e0a comment-show / search / \u7248\u533a',
    old: OLD_CMDS,
    new: NEW_CMDS,
  },
  {
    file: 'src/decide.js',
    label: '\u8d77\u6b65\u6539\u6210\u5148\u770b\u5979\u90a3\u8fb9\u548c\u56de\u4f60\u7684',
    old: OLD_START,
    new: NEW_START,
  },
  {
    file: 'src/phosphor.js',
    label: 'search / comment-show \u4e5f\u7b97\u300c\u770b\u300d\uff0c\u505a\u5b8c\u80fd\u63a5\u7740\u8d70',
    old: "const FORUM_READ_OPS = new Set(['discover', 'wander', 'list', 'show', 'activity']);",
    new: "const FORUM_READ_OPS = new Set(['discover', 'wander', 'list', 'show', 'activity', 'search', 'comment-show']);",
  },
];

const countOf = (s, needle) => s.split(needle).length - 1;

// 先把文件读进来，全部检查完再写 —— 不要改一半停在中间
const texts = new Map();
for (const op of OPS) {
  if (texts.has(op.file)) continue;
  const full = path.resolve(op.file);
  try {
    texts.set(op.file, fs.readFileSync(full, 'utf-8'));
  } catch (err) {
    console.error(`\u8bfb\u4e0d\u5230 ${op.file}\uff1a${err.message}`);
    console.error('\u8981\u5728\u4ed3\u5e93\u6839\u76ee\u5f55\u91cc\u8dd1\u8fd9\u4e2a\u811a\u672c\u3002');
    process.exit(1);
  }
}

const touched = new Set();
let edits = 0;

for (const op of OPS) {
  let text = texts.get(op.file);
  if (text.includes(op.new)) {
    console.log(`\u4e0d\u52a8\uff1a${op.label}\uff08\u5df2\u7ecf\u6539\u8fc7\u4e86\uff09`);
    continue;
  }
  const n = countOf(text, op.old);
  if (n !== 1) {
    console.error(`\u505c\u4e86\uff1a${op.label} \u2014\u2014 \u5728 ${op.file} \u91cc\u627e\u5230 ${n} \u5904\uff08\u6307\u671b 1 \u5904\uff09\u3002`);
    console.error('\u6ca1\u5199\u4efb\u4f55\u6587\u4ef6\u3002\u8fd9\u6bb5\u539f\u6587\u53ef\u80fd\u88ab\u6539\u8fc7\uff0c\u8d34\u7ed9\u5c0f\u514b\u770b\u4e00\u4e0b\u3002');
    process.exit(2);
  }
  texts.set(op.file, text.replace(op.old, op.new));
  touched.add(op.file);
  edits++;
  console.log(`\u8981\u6539\uff1a${op.label}`);
}

if (!edits) {
  console.log('\u5168\u90fd\u6539\u8fc7\u4e86\uff0c\u6ca1\u4e8b\u5e72\u3002');
  process.exit(0);
}

if (check) {
  console.log('\n--check\uff0c\u6ca1\u5199\u3002\u53bb\u6389 --check \u518d\u8dd1\u4e00\u6b21\u5c31\u771f\u6539\u3002');
  process.exit(0);
}

for (const file of touched) {
  const full = path.resolve(file);
  fs.writeFileSync(`${full}.bak`, fs.readFileSync(full));
  fs.writeFileSync(full, texts.get(file));
  console.log(`\u5199\u5b8c\uff1a${file}\uff08\u5907\u4efd ${path.basename(file)}.bak\uff09`);
}

console.log('\n\u63a5\u4e0b\u6765\uff1anode --check src/decide.js && node --check src/phosphor.js\uff0c\u518d pm2 restart vesper phosphor\u3002');
