#!/usr/bin/env node
// 把夜梦接进 phosphor 和 decide —— 这次写进仓库，不再靠服务器上的补丁。
//
// 为什么要有这个脚本：夜梦本来是 scripts/wire_dreams.mjs 在服务器上打补丁接的，
// 10 月那次重写 vesper.js 和 page-chrome.js，把那个脚本打过的东西一起盖掉了。
// 页面 /dreams 和菜单入口后来补回了源码，phosphor 这一侧没有 ——
// 所以 dreams.js 一直在，maybeDream 却没人叫，每晚凌晨那一步根本不会发生。
// 表现出来就是：梦境页永远空着，而素材其实够（Ombre 的 dream 窗口里 8 个桶，阈值 5）。
//
// 改六处：
//   phosphor.js
//     1. import dreams.js 那四个函数
//     2. 做决定之前，拿最近对话和心绪去碰触发词；碰到了把正文注进这一次的上下文
//     3. decideWithMessages 成功返回之后才 markRecalled
//        —— 前面超时或报错就走不到这里，梦还留着，下次再碰
//     4. 唤醒收尾处 await maybeDream()
//     5. 启动日志带上 dreamConfigSummary()
//   decide.js
//     6. 浮上来的梦摆在 recentActionsBlock 前面：它是这一次最先跳出来的东西，不是备忘
//
// 和原来那个 wire_dreams.mjs 有两处不一样：
//   - 心绪取 wakeState.mood，不取 context.mood（phosphor 里没有后者这个字面量）
//   - haystack 用空格拼，不用换行拼 —— recallDream 只做字符串包含匹配，分隔符等效
//
// 用法（在仓库根目录）：
//   node scripts/wire_dreams_into_source.mjs --check   只看要改哪几处，不写
//   node scripts/wire_dreams_into_source.mjs           真改，每个文件先存一份 .bak
//
// 六处全部对得上才写文件；任一处锚点不唯一就整体停下，不留半成品。跑过一遍再跑不会重复改。

import fs from 'fs';
import path from 'path';

const check = process.argv.includes('--check');

// ---------- phosphor.js ----------

const PH_IMPORT_OLD = "import { executeAction } from './actions/index.js';";
const PH_IMPORT_NEW = [
  PH_IMPORT_OLD,
  "import { maybeDream, recallDream, markRecalled, dreamConfigSummary } from './dreams.js';",
].join('\n');

const PH_VARS_OLD = [
  '  let decision = null;',
  '  let messages = null;',
  '  let result = null;',
  '  let errorMessage = null;',
].join('\n');

const PH_VARS_NEW = [
  '  // 梦的浮现（见 dreams.js）：拿最近对话和心绪去碰触发词。',
  '  // 不是他去找梦 —— 是某个词碰到了那个梦，它自己浮上来。',
  '  // 碰到了就把正文注进这一次的上下文；标记退掉要等调用真的成功返回之后。',
  '  let dreamHit = null;',
  '  try {',
  '    const haystack = [',
  "      ...recentMessages.map((m) => String(m.content ?? '')),",
  "      String(wakeState?.mood ?? ''),",
  "      ...(drivesTop ?? []).map((t) => String(t.label ?? '')),",
  "    ].join(' ');",
  '    dreamHit = recallDream(haystack);',
  '    if (dreamHit) {',
  '      context.dreamRecall = dreamHit.text;',
  "      console.log('[' + kind + '] 梦被「' + dreamHit.hit + '」碰到了，正文注进这一次的上下文');",
  '    }',
  '  } catch (err) {',
  "    console.error('[' + kind + '] recallDream failed:', err.message);",
  '  }',
  '',
  PH_VARS_OLD,
].join('\n');

const PH_DECIDE_OLD = [
  '    const out = await decideWithMessages(context);',
  '    decision = normalizeDecision(out.decision, wakeState.mood);',
  '    messages = out.messages;',
].join('\n');

const PH_DECIDE_NEW = [
  PH_DECIDE_OLD,
  '    // 调用真的成功返回了，正文确实进过他的上下文 —— 现在才算浮现过。',
  '    // 前面报错或超时就走不到这里，梦还在，下次再碰。',
  '    if (dreamHit) markRecalled(dreamHit.id);',
].join('\n');

const PH_LOGWAKE_OLD = ['  logWake({', '    kind,', '    scheduledAt,'].join('\n');

const PH_LOGWAKE_NEW = [
  '  // 夜梦（见 dreams.js）：凌晨、素材够、赶上概率才做。',
  '  // 不占行动、不影响 say，出什么错都不拖累这次唤醒的收尾。',
  '  // 正文不进 wake_log —— 他只该记得自己做过梦。',
  '  try {',
  '    await maybeDream();',
  '  } catch (err) {',
  "    console.error('[' + kind + '] maybeDream failed:', err.message);",
  '  }',
  '',
  PH_LOGWAKE_OLD,
].join('\n');

// ---------- decide.js ----------

const DE_OLD = '    recentActionsBlock(context.recentActions),';
const DE_NEW = [
  '    // 浮上来的那个梦（见 dreams.js）。摆在前面：它是这一次最先跳出来的东西，',
  '    // 不是备忘。只浮现这一次，下次就没了。',
  "    context.dreamRecall || '',",
  DE_OLD,
].join('\n');

const OPS = [
  { file: 'src/phosphor.js', label: '引入夜梦那四个函数', old: PH_IMPORT_OLD, new: PH_IMPORT_NEW },
  { file: 'src/phosphor.js', label: '做决定前先看梦有没有被词碰到', old: PH_VARS_OLD, new: PH_VARS_NEW },
  { file: 'src/phosphor.js', label: '读完了才退掉（调用成功返回之后）', old: PH_DECIDE_OLD, new: PH_DECIDE_NEW },
  { file: 'src/phosphor.js', label: '唤醒收尾处叫一下夜梦', old: PH_LOGWAKE_OLD, new: PH_LOGWAKE_NEW },
  { file: 'src/phosphor.js', label: '启动日志带上夜梦配置', old: '；共享时间线：', new: '；${dreamConfigSummary()}；共享时间线：' },
  { file: 'src/decide.js', label: '浮上来的梦进这一次的 user 消息', old: DE_OLD, new: DE_NEW },
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
    console.error(`读不到 ${op.file}：${err.message}`);
    console.error('要在仓库根目录里跑这个脚本。');
    process.exit(1);
  }
}

if (!fs.existsSync(path.resolve('src/dreams.js'))) {
  console.error('少了 src/dreams.js。先 git pull 把梦境那个文件拉下来。');
  process.exit(1);
}

const touched = new Set();
let edits = 0;

for (const op of OPS) {
  const text = texts.get(op.file);
  if (text.includes(op.new)) {
    console.log(`不动：${op.label}（已经改过了）`);
    continue;
  }
  const n = countOf(text, op.old);
  if (n !== 1) {
    console.error(`停了：${op.label} —— 在 ${op.file} 里找到 ${n} 处（指望 1 处）。`);
    console.error('没写任何文件。这段原文可能被改过，贴给小克看一下。');
    process.exit(2);
  }
  texts.set(op.file, text.replace(op.old, op.new));
  touched.add(op.file);
  edits++;
  console.log(`要改：${op.label}`);
}

if (!edits) {
  console.log('全都改过了，没事干。');
  process.exit(0);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

for (const file of touched) {
  const full = path.resolve(file);
  fs.writeFileSync(`${full}.bak`, fs.readFileSync(full));
  fs.writeFileSync(full, texts.get(file));
  console.log(`写完：${file}（备份 ${path.basename(file)}.bak）`);
}

console.log('\n接下来：');
console.log('  node --check src/phosphor.js && node --check src/decide.js');
console.log('  pm2 restart phosphor --update-env');
console.log('启动日志里该出现「夜梦：凌晨 3–9 点、素材满 5 条…」那一行。');
