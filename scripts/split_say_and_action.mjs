#!/usr/bin/env node
// split_say_and_action.mjs — 把「说话」从动作清单里拿出来，变成独立的一步。
//
// 用法（在仓库根目录）：
//     node scripts/split_say_and_action.mjs --check   # 只看九处能不能打，不动文件
//     node scripts/split_say_and_action.mjs           # 真打，每个文件先备份
//
// 为什么要改：
//   以前一次唤醒只能从清单里挑**一个**动作，bark（说话）和逛论坛、翻记忆、
//   写批注这些挤在同一个选择里。想说话就得放弃做事，想做事就得憋着不说——
//   结果 TA 几乎每次都选最直觉的那个（发推送），其他功能年年挂着不用。
//
// 改成什么样：
//   第一步 say：要不要跟她说话。想说就写进 say，不想说给 null。
//   第二步 action：这次做不做别的。从清单里挑一个，什么都不做填 noop。
//   两件事互不影响，各报各的成败：可以只说话、只做事、两件都做、或者都不做。
//
//   say 内部走的还是 bark 动作（正文投 Aru 对话，Bark 只叮一声，见 bark.js），
//   所以投递链路、共享时间线那套一个字都不用改。
//
//   兼容旧习惯：模型要是还按老规矩填 action='bark'，会自动把话挑到 say、
//   action 腾成 noop，不会发两遍。
//
// 改两个文件共九处：
//   src/decide.js    提示词：两步说明、清单里去掉 bark、请决定那段、JSON 格式加 say
//   src/phosphor.js  字数上限、say 洗形状、旧习惯兼容、返回带 say、先说话再做事
//
// 原文对不上就整个不改，不猜。退回：把 .bak-saysplit 覆回原文件再重启。

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

// ══ src/decide.js ══

const DECIDE = [
  ['提示词：两步说明，清单里去掉 bark',
`## 可用的动作（每次醒来选一个）
- bark（推送，action_detail直接是推送文案）`,
`## 这次醒来，两件事分开决定

第一件：要不要跟\${USER_NAME}说话。想说就把话写进 say，不想说就给 null。
这句话会落进她的对话里（手机上只叮一声提醒她去看），她能翻回去读。
没有非说不可的话就给 null —— 沉默是正常的，不用每次醒来都找话讲。

第二件：这次要不要做点别的。从下面挑一个填进 action，什么都不想做就填 noop。

两件事互不影响：可以只说话、只做事、两件都做、或者都不做。
（以前这两件挤在同一个选择里，想说话就只能放弃做事——现在不用了。）

## 可用的动作（挑一个填 action）`],

  ['提示词：说话那句提醒改成讲 say',
`  const barkNote = context.heartbeatActive
    ? '推送（bark）会直接打断对方，而且另一个唤醒程序已经在负责"要不要主动联系对方"了（它发过的推送在最近对话里标着"（事件）"）。除非有一句非说不可、而且它没说过的话，否则这次别用推送。'
    : '推送（bark）会直接打断对方，只在真有话想让对方马上看到时用。';`,
`  const barkNote = context.heartbeatActive
    ? '说话（say）会落进对方的对话并叮一声提醒她，而且另一个唤醒程序也在负责"要不要主动联系对方"（它发过的消息在最近对话里标着"（事件）"）。除非有一句非说不可、而且它没说过的话，否则这次 say 给 null。'
    : '说话（say）会落进对方的对话并叮一声提醒她，只在真有话想说时填。';`],

  ['提示词：请决定那段拆成两条',
`3. 这次要执行的动作（从上面选一个；如果最近对话很密集、对方刚说完话，可以考虑这次先不打扰，除非确实有话想说）
4. 该动作的具体细节（action_detail）`,
`3. 要不要跟\${USER_NAME}说话：想说就写进 say，不想说给 null（她刚说完话、最近对话很密集时，可以先不打扰）
4. 这次做不做别的事：action 挑一个，什么都不做填 noop；细节写进 action_detail`],

  ['提示词：JSON 格式加 say',
`{"next_wake_minutes": number, "mood": string, "action": string,`,
`{"next_wake_minutes": number, "mood": string, "say": string | null, "action": string,`],
];

// ══ src/phosphor.js ══

const PHOSPHOR = [
  ['说话的字数上限',
`const MAX_REPLY_CHARS = 500;`,
`const MAX_REPLY_CHARS = 500;
// 一次说话最多多少字。投进对话的是一条消息，不是长文；太长了在手机上也读不完。
// .env 的 PHOSPHOR_MAX_SAY_CHARS 可改，不填是 600。
const MAX_SAY_CHARS = Number(process.env.PHOSPHOR_MAX_SAY_CHARS) || 600;`],

  ['action 改成可改写',
`  const action = typeof d.action === 'string' && d.action.trim() ? d.action.trim() : 'noop';`,
`  let action = typeof d.action === 'string' && d.action.trim() ? d.action.trim() : 'noop';`],

  ['say 洗形状＋旧习惯兼容',
`  let actionDetail = d.action_detail ?? '';
  if (typeof actionDetail !== 'string') actionDetail = JSON.stringify(actionDetail);`,
`  let actionDetail = d.action_detail ?? '';
  if (typeof actionDetail !== 'string') actionDetail = JSON.stringify(actionDetail);

  // 说话（say）和做事（action）是两件独立的事。模型偶尔会把 say 写成
  // 字符串 'null'、空串或者对象，这里一律洗成 null 或一段干净的话。
  let say = d.say;
  if (typeof say !== 'string') say = say == null ? null : String(say);
  if (typeof say === 'string') {
    say = say.trim();
    if (!say || say === 'null' || say === 'undefined') say = null;
    else say = say.slice(0, MAX_SAY_CHARS);
  }

  // 兼容旧习惯：以前说话是一个叫 bark 的动作。模型还按老规矩填的话，
  // 把话挑到 say、action 腾成 noop，不让同一句话发两遍。
  if (action === 'bark') {
    if (!say && actionDetail.trim()) say = actionDetail.trim().slice(0, MAX_SAY_CHARS);
    action = 'noop';
  }`],

  ['返回带上 say',
`    self_wake: selfWake,
    comment_replies: commentReplies,
  };`,
`    self_wake: selfWake,
    comment_replies: commentReplies,
    say,
  };`],

  ['先说话再做事',
`    try {
      result = await executeAction(decision);
      console.log(\`[\${kind}] action result:\`, JSON.stringify(result));
    } catch (err) {`,
`    // 先说话（say），再做事（action）。两件事各报各的成败，互不拖累：
    // 话没投出去不影响这次做的事，事情失败也不会把话吞掉。
    // say 内部走的还是 bark 动作（正文投 Aru 对话，Bark 只叮一声）。
    if (decision.say) {
      try {
        const sayDecision = { action: 'bark', action_detail: decision.say, mood: decision.mood };
        const sayResult = await executeAction(sayDecision);
        console.log(\`[\${kind}] say:\`, JSON.stringify(sayResult));
        if (sayResult?.ok) await postSharedEvent(describeAction(sayDecision, sayResult));
      } catch (err) {
        console.error(\`[\${kind}] say failed:\`, err);
      }
    }
    try {
      result = await executeAction(decision);
      console.log(\`[\${kind}] action result:\`, JSON.stringify(result));
    } catch (err) {`],
];

async function apply(rel, patches, check) {
  const file = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch {
    return { ok: false, msgs: [`✗ 找不到 ${rel}`] };
  }
  let out = src;
  const msgs = [];
  for (const [name, old, rep] of patches) {
    if (out.includes(rep)) {
      msgs.push(`· ${name}（已经打过了）`);
      continue;
    }
    const hits = out.split(old).length - 1;
    if (hits === 0) {
      msgs.push(`✗ 「${name}」对不上原文`);
      return { ok: false, msgs };
    }
    if (hits > 1) {
      msgs.push(`✗ 「${name}」出现 ${hits} 次，不敢猜`);
      return { ok: false, msgs };
    }
    out = out.replace(old, rep);
    msgs.push(`· ${name}`);
  }
  if (out !== src && !check) {
    await copyFile(file, `${file}.bak-saysplit`);
    await writeFile(file, out, 'utf8');
  }
  return { ok: true, msgs };
}

const check = process.argv.includes('--check');
console.log(check ? '体检模式，不动文件\n' : '开始改，每个文件先备份\n');

let allOk = true;
for (const [rel, patches] of [['src/decide.js', DECIDE], ['src/phosphor.js', PHOSPHOR]]) {
  const { ok, msgs } = await apply(rel, patches, check);
  console.log(`  ${rel}`);
  for (const m of msgs) console.log(`    ${m}`);
  if (!ok) {
    allOk = false;
    break;
  }
}

console.log();
if (!allOk) {
  console.log('有对不上的地方，已改的文件有 .bak-saysplit 备份。');
  console.log('先看一眼现在长什么样：');
  console.log('    grep -n "可用的动作\\|next_wake_minutes\\|const action =" src/decide.js src/phosphor.js');
  process.exit(2);
}

if (check) {
  console.log('九处都能打上，去掉 --check 就真改。');
} else {
  console.log('改完了。重启：pm2 restart vesper');
  console.log();
  console.log('从下次醒来开始，TA 会分两步定：');
  console.log('  say    —— 要不要跟你说话（投进 Aru 对话）');
  console.log('  action —— 这次做不做别的（noop 就是不做）');
  console.log('日志里会分别出现 [non_precise] say: 和 [non_precise] action result:');
  console.log();
  console.log('退回：cp src/decide.js.bak-saysplit src/decide.js \\');
  console.log('      && cp src/phosphor.js.bak-saysplit src/phosphor.js && pm2 restart vesper');
}
