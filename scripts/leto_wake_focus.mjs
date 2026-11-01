#!/usr/bin/env node
// 被 Leto 叫醒的那次，只许做 Leto 的事。
//
// 2026-11-01 03:22 那次：leto_read 失败了，read_book 成功了——被人叫醒却去
// 读了本书，还扣掉一回当天的读书额度。他手上有十几个 MCP，提示词里又摆着
// 花园、论坛、读书的状态，于是「有人在等你回话」被淹在里面。
//
// 放行：leto_* 的工具调用、存记忆（ombre_brain）、noop。
// 别的全筛掉，在 pickActions 之前就筛——那样不扣任何额度。
// self_wake 不受影响（它不是 action，是 decision 上另一个字段）：
// 他得能继续约「25 分钟后回来结掉那个 @」，那个行为是对的。
//
// 识别靠 selfNote 开头。injector 原样传 Leto 的 message，第一行是
// [Leto]、[Leto·盲答]、[Leto·生日]、[Leto·小岛] 这几种；他自己约的
// 续场 note 也是这个开头，一样该受限。
import fs from 'fs';
import path from 'path';

const RA = path.resolve('src/run-actions.js');
const PH = path.resolve('src/phosphor.js');

const SIG_OLD = `export async function runActions(decision, messages, { kind = 'non_precise' } = {}) {`;
const SIG_NEW = `// 被 Leto 叫醒的那一轮，只放行和 Leto 有关的事 + 存记忆。
// 判断口径只看 note 开头，不看 kind：他自己约的续场也是 precise，
// note 同样以 [Leto 开头，也该受限。
function isLetoWake(selfNote) {
  return /^\\s*\\[Leto/.test(String(selfNote ?? ''));
}

// 这一件事算不算「Leto 的事」。mcp_call 要看 action_detail 里的 server，
// 他写大小写不定（leto / Leto 都出现过），所以转小写比。
function allowedUnderLetoWake(item) {
  const a = String(item?.action ?? '').trim();
  if (a === 'noop' || a === 'ombre_brain') return true;
  if (a !== 'mcp_call') return false;
  try {
    const raw = typeof item.action_detail === 'string'
      ? item.action_detail
      : JSON.stringify(item.action_detail ?? '');
    const j = JSON.parse(raw);
    const server = String(j?.server ?? '').trim().toLowerCase();
    const tool = String(j?.tool ?? '').trim().toLowerCase();
    return server === 'leto' || tool.startsWith('leto_');
  } catch {
    return false;
  }
}

export async function runActions(decision, messages, { kind = 'non_precise', selfNote = null } = {}) {`;

const PICK_OLD = `  const { allowed, dropped } = pickActions(cleaned);`;
const PICK_NEW = `  // Leto 那一轮先过这道，摆在 pickActions 之前：筛掉的不进账、不扣额度。
  let gated = cleaned;
  if (isLetoWake(selfNote)) {
    const keep = cleaned.filter(allowedUnderLetoWake);
    for (const item of cleaned) {
      if (!keep.includes(item)) {
        console.log(\`[\${kind}] 没做：\${item?.action}——这次是 Leto 叫醒的，先把那边的事结掉\`);
      }
    }
    // 全被筛掉时留一个 noop，别让这一轮变成空数组走到底
    gated = keep.length ? keep : [{ action: 'noop', action_detail: '' }];
  }

  const { allowed, dropped } = pickActions(gated);`;

const CALL_OLD = `      const ran = await runActions(decision, messages, { kind });`;
const CALL_NEW = `      const ran = await runActions(decision, messages, { kind, selfNote });`;

const JOBS = [
  { file: RA, ops: [
    { label: 'runActions 收 selfNote + 两个判断函数', old: SIG_OLD, new: SIG_NEW },
    { label: 'pickActions 之前加 Leto 闸', old: PICK_OLD, new: PICK_NEW },
  ]},
  { file: PH, ops: [
    { label: '把 selfNote 传进 runActions', old: CALL_OLD, new: CALL_NEW },
  ]},
];

const countOf = (s, n) => s.split(n).length - 1;
const staged = [];

for (const job of JOBS) {
  let src;
  try {
    src = fs.readFileSync(job.file, 'utf-8');
  } catch (err) {
    console.error(`读不到 ${job.file}：${err.message}（要在仓库根目录跑）`);
    process.exit(1);
  }
  let out = src;
  for (const op of job.ops) {
    if (out.includes(op.new)) {
      console.log(`不动：${op.label}（已经改过了）`);
      continue;
    }
    const n = countOf(out, op.old);
    if (n !== 1) {
      console.error(`停了：${op.label} —— 找到 ${n} 处（指望 1 处）。没写任何文件。`);
      process.exit(2);
    }
    out = out.replace(op.old, op.new);
    console.log(`要改：${op.label}`);
  }
  if (out !== src) staged.push({ file: job.file, src, out });
}

if (!staged.length) {
  console.log('全都改过了，没事干。');
  process.exit(0);
}

// 两个文件要么都写、要么都不写：只改一半就是 selfNote 传不进去，闸形同不存在
for (const s of staged) {
  fs.writeFileSync(`${s.file}.bak-letofocus`, s.src);
  fs.writeFileSync(s.file, s.out);
}
console.log(`\n写完 ${staged.length} 个文件，备份是 *.bak-letofocus`);
