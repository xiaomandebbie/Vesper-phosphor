#!/usr/bin/env node
// fix_heartbeat_prompt.mjs — 唤醒 prompt 三件事。
//
// 用法（在 vesper-phosphor 根目录）：
//     node scripts/fix_heartbeat_prompt.mjs --check          # 只看能不能打，不动文件
//     node scripts/fix_heartbeat_prompt.mjs                  # 真打，先自动备份
//     node scripts/fix_heartbeat_prompt.mjs /路径/heartbeat  # 手动指定目录
//
// 三件事：
//   1) 说清「这次没有工具」。
//      根不在 heartbeat 自己的 prompt 里——wakeMessages 把 Aru 那边的 system prompt
//      （cleanSP）拼进了同一条 system 消息，工具说明是从那儿漏过来的。
//      而唤醒请求根本没挂工具，模型以为自己能搜歌、能翻记忆，就会在话里
//      承诺一些它做不到的事。删不掉 cleanSP（那是他的人格），所以在
//      wakePrompt 里明确否掉，用优先级压过它。
//   2) 一个句子一段。prompt 里说清，再加一步轻量规范化：
//      模型按句分行时把单换行补成空行，Aru 那边才会显示成分段。
//   3) diary 不漏进聊天。
//      extractDiaryFromResponse 的正则要求 [DIARY]...[/DIARY] 成对，
//      模型少写结尾标签时匹配不到，整段日记就留在 remainingText 里投给她。
//      这里加兑底：只开不关时，从 [DIARY] 到结尾都当日记收走；
//      剩下的标签碎片也清掉，别让 [/DIARY] 这种东西发出去。
//
// 原文对不上就整个不改，不猜。
// 退回：cp wake_up.js.bak-prompt wake_up.js && pm2 restart wake-up

import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  process.argv.find((a) => a.startsWith('/') && !a.endsWith('.mjs')),
  '/root/dylan-heartbeat',
  '/root/heartbeat',
  path.join(os.homedir(), 'dylan-heartbeat'),
].filter(Boolean);

let DIR = null;
for (const d of CANDIDATES) {
  try {
    await access(path.join(d, 'wake_up.js'));
    DIR = d;
    break;
  } catch {}
}
if (!DIR) {
  console.error('\u2717 找不到 heartbeat 的 wake_up.js。试过：');
  CANDIDATES.forEach((d) => console.error(`    ${d}`));
  process.exit(1);
}

const WAKE_FILE = path.join(DIR, 'wake_up.js');
const PROMPT_FILE = path.join(DIR, 'wake_prompt.txt');
const check = process.argv.includes('--check');

// ══ 1. 「没有工具」那条规则 ══

const RULE_OLD = '3. 输出格式必须严格遵守以下二选一。';

const RULE_NEW = [
'3. 这次唤醒没有任何工具可用。不能搜歌、不能点歌、不能查天气、不能翻记忆库、',
'   不能记账、不能逛论坛、不能调用任何 MCP。人格设定里提到的那些工具，',
'   这一轮一个都没有——只能用你已经知道的事说话。',
'   所以也别在话里说「我去搜首歌」「我翻了下批注」这类做不到的事。',
'4. 输出格式必须严格遵守下面的规则。',
].join('\n');

// ══ 2. 「一句一段」输出格式 ══
// 两种原文变体都认：打过 fix_heartbeat_say_not_push 的、和没打过的

const SAY_VARIANTS = [
  '- 如果想联系用户，直接写你想说的话，整段会作为一条消息发给她。不用写标题，也不用分行当标题正文。',
  '- 如果想联系用户，直接写你想说的话。系统会自动打包成手机推送发送。可以是一句话，也可以第一行作为标题、第二行作为正文。',
];

const SAY_NEW = [
'- 想跟她说话：直接写你想说的话，整段会作为一条消息发给她。',
'  一个句子一段，每句之间空一行。别写标题，也别把第一行当标题。',
'  别把几句话挤在同一段里——她在手机上读，分段了才看得清。',
].join('\n');

// ══ 3. diary 规则 ══

const DIARY_OLD = '- 如果你想写日记，可以额外输出 [DIARY]...[/DIARY]。只有想写时才写，不必每次都写。';

const DIARY_NEW = [
'- 想写日记：另外输出 [DIARY] 日记内容 [/DIARY]，结尾标签必须写全。',
'  日记只写在标签里面，不要在说给她的话里重复一遍——那是你自己的本子，她不看。',
'  只写日记不说话也行：标签外面什么都不写就是。',
'  只有想写时才写，不必每次都写。',
].join('\n');

// ══ 4. diary 提取兑底 ══

const EXTRACT_OLD = [
'function extractDiaryFromResponse(text) {',
'  const diaryBlocks = [];',
'  const remainingText = String(text || "").replace(/\\[DIARY\\]([\\s\\S]*?)\\[\\/DIARY\\]/gi, (_, content) => {',
'    const diary = String(content || "").trim();',
'    if (diary) diaryBlocks.push(diary);',
'    return "";',
'  }).trim();',
'  return {',
'    diaryContent: diaryBlocks.join("\\n\\n").trim(),',
'    remainingText',
'  };',
'}',
].join('\n');

const EXTRACT_NEW = [
'function extractDiaryFromResponse(text) {',
'  const diaryBlocks = [];',
'  let remainingText = String(text || "").replace(/\\[DIARY\\]([\\s\\S]*?)\\[\\/DIARY\\]/gi, (_, content) => {',
'    const diary = String(content || "").trim();',
'    if (diary) diaryBlocks.push(diary);',
'    return "";',
'  }).trim();',
'',
'  // 批注 2026-10-09：上面那条正则要求 [DIARY] 和 [/DIARY] 成对。',
'  // 模型只写了开头标签、忘了结尾时匹配不到，整段日记会留在',
'  // remainingText 里被当成聊天内容投给她——日记是他自己的本子，不该漏出去。',
'  // 这里兑底：只开不关时，从 [DIARY] 到结尾都当日记收走。',
'  const openOnly = remainingText.match(/\\[DIARY\\]([\\s\\S]*)$/i);',
'  if (openOnly) {',
'    const diary = String(openOnly[1] || "").replace(/\\[\\/?DIARY\\]/gi, "").trim();',
'    if (diary) diaryBlocks.push(diary);',
'    remainingText = remainingText.slice(0, openOnly.index).trim();',
'  }',
'',
'  // 还剩孤立的标签碎片就清掉，别让 [/DIARY] 这种东西发出去',
'  remainingText = remainingText.replace(/\\[\\/?DIARY\\]/gi, "").trim();',
'',
'  return {',
'    diaryContent: diaryBlocks.join("\\n\\n").trim(),',
'    remainingText',
'  };',
'}',
].join('\n');

// ══ 5. 段落规范化（接在 sayText 清洗后面）══

const FORMAT_OLD = [
'    // 「标题：」「正文：」这种前缀也清掉，剩下的整段原样发',
'    sayText = sayText',
'      .replace(/^标题[：:]\\s*/gm, "")',
'      .replace(/^正文[：:]\\s*/gm, "")',
'      .trim();',
].join('\n');

const FORMAT_NEW = [
'    // 「标题：」「正文：」这种前缀也清掉，剩下的整段原样发',
'    sayText = sayText',
'      .replace(/^标题[：:]\\s*/gm, "")',
'      .replace(/^正文[：:]\\s*/gm, "")',
'      .trim();',
'',
'    // 一个句子一段：prompt 里要求了，这里再轻轻规范一次。',
'    // 模型按句分行时把单换行补成空行，Aru 那边才显示成分段；',
'    // 已经是空行分隔的不动，连续多个空行收成一个。',
'    sayText = sayText',
'      .replace(/\\n{3,}/g, "\\n\\n")',
'      .replace(/([^\\n])\\n([^\\n])/g, "$1\\n\\n$2");',
].join('\n');

// ══ 干活 ══

let src;
try {
  src = await readFile(WAKE_FILE, 'utf8');
} catch (err) {
  console.error(`\u2717 读不动 ${WAKE_FILE}：${err.message}`);
  process.exit(1);
}

console.log(`heartbeat: ${DIR}\n`);

let out = src;
const done = [];

function one(name, old, rep, optional = false) {
  if (out.includes(rep)) {
    done.push(`\u00b7 ${name}（已经打过了）`);
    return true;
  }
  const hits = out.split(old).length - 1;
  if (hits === 0) {
    if (optional) {
      done.push(`\u00b7 ${name}（跳过：没找到原文）`);
      return true;
    }
    console.error(`\u2717 「${name}」对不上原文，整个文件没改。`);
    return false;
  }
  if (hits > 1) {
    console.error(`\u2717 「${name}」出现 ${hits} 次，不敢猜。整个文件没改。`);
    return false;
  }
  out = out.replace(old, rep);
  done.push(`\u00b7 ${name}`);
  return true;
}

if (!one('「这次没有工具」规则', RULE_OLD, RULE_NEW)) process.exit(2);

// 输出格式：两种变体选匹配的那个
if (out.includes(SAY_NEW)) {
  done.push('\u00b7 一句一段（已经打过了）');
} else {
  const hit = SAY_VARIANTS.find((v) => out.split(v).length - 1 === 1);
  if (!hit) {
    console.error('\u2717 「一句一段」两种原文都对不上，整个文件没改。');
    process.exit(2);
  }
  out = out.replace(hit, SAY_NEW);
  done.push('\u00b7 一句一段');
}

if (!one('diary 规则', DIARY_OLD, DIARY_NEW)) process.exit(2);
if (!one('diary 提取兑底', EXTRACT_OLD, EXTRACT_NEW)) process.exit(2);
if (!one('段落规范化', FORMAT_OLD, FORMAT_NEW, true)) process.exit(2);

let hasPromptFile = false;
try {
  await access(PROMPT_FILE);
  hasPromptFile = true;
} catch {}

if (check) {
  console.log('\u2713 能打上，文件没动：');
  done.forEach((d) => console.log(`  ${d}`));
  if (hasPromptFile) {
    console.log('\n\u26a0 wake_prompt.txt 存在，它会完全覆盖默认 prompt。');
    console.log('  改完还得把那个文件也改一遍，不然这三件事白改。');
  }
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await copyFile(WAKE_FILE, `${WAKE_FILE}.bak-prompt`);
await writeFile(WAKE_FILE, out, 'utf8');

console.log('\u2713 改完了，备份在 wake_up.js.bak-prompt：');
done.forEach((d) => console.log(`  ${d}`));
console.log();
if (hasPromptFile) {
  console.log('\u26a0 wake_prompt.txt 存在，它覆盖默认 prompt，这三件事要同步改过去：');
  console.log(`    ${PROMPT_FILE}`);
  console.log();
}
console.log('重启：pm2 restart wake-up');
console.log();
console.log('下次他说话时：一个句子一段，不再承诺工具做不到的事，');
console.log('日记只进 diary/ 目录。日志：pm2 logs wake-up --lines 0 --timestamp');
console.log();
console.log('退回：cp wake_up.js.bak-prompt wake_up.js && pm2 restart wake-up');
