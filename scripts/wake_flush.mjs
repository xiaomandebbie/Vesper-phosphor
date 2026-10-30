#!/usr/bin/env node
// 小满 2026-10-30 21:31：「上下文要连得上」
//
// ── 之前那个设计错在哪 ──
//
// handleChatReplies 是「读走你的话 → 他自己回一句进 relay」。
// 但你的话从来没进 relay 的库——所以 relay 里只有他的回复，前后不接。
// 数据库里那四条 via=wake 就是这么来的：标记改了，话没递。
//
// ── 改成走同一条路 ──
//
// 唤醒时发现有攒着的，就调 flushPending()——和她点那个按钮一模一样：
//   你的话 → relay 库 → api_loop 读到 → 他回复 → relay 库
// 于是两边都在库里、顺序对得上，下次再聊还能翻到。
//
// 而不是让 phosphor 自己回：那条路的人格在 decide.js 的提示词里，
// 和网页上那个（persona.md）不是同一份。同一个入口两种语气，她会觉得怪。
//
// ── 废掉的那些留着不删 ──
//
// decide.js 里 chat_replies 的提示词还在，他写了也没人读——只是浪费几十个
// token。改那个文件风险比这点浪费大，明天清醒时再摸。
//
// ── 上一版为什么炸 ──
//
// 我写了 if (t !== before_check()) 然后把 before_check 声明在它后面，
// 而且那个函数读的是备份文件——逻辑还是反的。这一版直接记原文。
//
// 重跑安全。备份在 src/.wake-flush-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.wake-flush-backup');
const stamp = String(Date.now());
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });

const p = join(srcDir, 'phosphor.js');
if (!existsSync(p)) {
  console.error('✗ src/phosphor.js 不在');
  process.exit(1);
}

const original = readFileSync(p, 'utf8');
writeFileSync(join(bakDir, 'phosphor.js.' + stamp), original, 'utf8');
let t = original;

function apply(label, find, repl) {
  if (t.includes(repl)) {
    console.log('  · ' + label + '：已经是这样了');
    return;
  }
  if (!t.includes(find)) {
    console.error('  ✗ ' + label + '：找不到原文');
    failed++;
    return;
  }
  t = t.replace(find, repl);
  console.log('  ✓ ' + label);
}

console.log('1/3  import 换成 flushPending');
apply('import',
  "import { listPending, markPendingRead, replyToChat } from './chat-queue.js';",
  L(
    '// 唤醒时把攒着的话递给 relay（和她点按钮走同一条路）。',
    '// 不自己回：那样你的话不进 relay 库，上下文就断了。',
    "import { listPending, flushPending } from './chat-queue.js';"
  ));

console.log('');
console.log('2/3  handleChatReplies 换成 flushChatOnWake');

const A = '// 回她在网页聊天里攒着的话。';
const B = '// 从 Ombre Brain 取一段文本。';
if (t.includes('async function flushChatOnWake')) {
  console.log('  · 已经换过了');
} else {
  const a = t.indexOf(A);
  const b = t.indexOf(B, a);
  if (a < 0 || b < 0) {
    console.error('  ✗ 定不到 handleChatReplies 的起止');
    failed++;
  } else {
    const FN = L(
      '// 她在网页聊天里发了、没点「让你回复」的那几句：递给 relay。',
      '//',
      '// 小满 10-30：「上下文要连得上」。所以走和她点按钮完全同一条路：',
      '//   你的话 → relay 库 → api_loop 读到 → 他回复 → relay 库',
      '// 两边都在库里、顺序对得上，下次再聊还能翻到。',
      '//',
      '// 上一版是「读走 → 他自己回一句」，错在你的话从来没进 relay——',
      '// 数据库里那几条 via=wake 就是那么来的：标记改了，话没递。',
      '//',
      '// 不占这次醒来的动作，和回动态留言一个道理。',
      '// 递失败不标已读（flushPending 里就是这么写的），下次醒来再试。',
      'async function flushChatOnWake(rows) {',
      '  if (!rows.length) return 0;',
      '  try {',
      '    const out = await flushPending();',
      '    if (out.sent) {',
      "      console.log('phosphor: 把 ' + out.sent + ' 条攒着的话递给 relay 了，他会回');",
      '    }',
      '    if (out.error) {',
      "      console.error('phosphor: 攒着的话没递出去，下次醒来再试：' + out.error);",
      '    }',
      '    return out.sent || 0;',
      '  } catch (err) {',
      "    console.error('phosphor: 递攒着的话失败', err.message);",
      '    return 0;',
      '  }',
      '}',
      '',
      B
    );
    t = t.slice(0, a) + FN + t.slice(b + B.length);
    console.log('  ✓ 整段换成 flushChatOnWake');
  }
}

console.log('');
console.log('3/3  调用处');
apply('调用处',
  L(
    '    try {',
    '      await handleChatReplies(decision, pendingChat);',
    '    } catch (err) {',
    '      console.error(`[${kind}] handleChatReplies failed:`, err);',
    '    }'
  ),
  L(
    '    try {',
    '      await flushChatOnWake(pendingChat);',
    '    } catch (err) {',
    '      console.error(`[${kind}] flushChatOnWake failed:`, err);',
    '    }'
  ));

if (t !== original) {
  writeFileSync(p, t, 'utf8');
  console.log('');
  console.log('写了 src/phosphor.js');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + join(bakDir, 'phosphor.js.' + stamp) + ' ' + p);
  process.exitCode = 1;
} else {
  console.log('找 phosphor 进程名：pm2 list | grep -iE "phos|decide"');
  console.log('然后重启它。');
  console.log('');
  console.log('顺带把那四条摆回「还没递出去」，下次唤醒就真的递给 relay：');
  console.log('');
  console.log('  cd /root/vesper-phosphor && sqlite3 data/state.db \\');
  console.log('    "update chat_pending set sent=0, sent_at=null, via=null where id in (4,6,7,8);"');
}
