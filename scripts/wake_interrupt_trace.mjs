#!/usr/bin/env node
// 小满 2026-10-30 21:43：「把精确唤醒修好」
//
// ── 先说清：唤醒链没坏 ──
//
// wake_log 里 precise 有 219 条，error 全空。今天 07:31 / 08:00 / 09:51 / 10:17
// 四次都正常落库。而 20:31:43 日志里有「到点了，按约醒一次」，
// wake_log 里却没有——因为 phosphor 在20:32 重启了（uptime 67m @ 21:39）。
//
// 一次完整唤醒要跑五六分钟（breath、feel、模型、论坛续步、听歌续步）。
// 那一轮刚开始就被 pm2 restart 杀了，logWake 在 runDecisionCycle 最后，
// 所以什么都没写下。
//
// ── 所以要改的是两件 ──
//
// 1. 中断要留下痕迹。现在被杀是静默的：约已经标成 triggered，
//    日志里只有「到点了」那一行，之后没了——表现出来就是「说醒了但什么也没发生」。
//    现在 SIGINT/SIGTERM 到来时，如果正在跑一轮，往 wake_log 写一笔。
//
// 2. 约别白丢。setPendingWakeStatus(triggered) 写在干活之前，
//    被杀就等于约被消费了但没兑现。现在中断时摆回 pending：
//    还在 30 分钟宽限内就重启后再触发一次，超过了就标 missed，
//    下次醒来告诉他「你错过了一个约」——两种结果都是诚实的。
//
// 只改 preciseTick 和 shutdown，不动 runDecisionCycle。
//
// 重跑安全。备份在 src/.wake-trace-backup/。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.wake-trace-backup');
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

// ════ 1. 记下正在跑哪一轮 ════
console.log('1/3  记下正在跑的那一轮');
apply('running 变量',
  'async function preciseTick() {',
  L(
    '// 正在跑的那一轮精确唤醒。进程被杀时 shutdown 要知道该给谁留痕迹。',
    '//',
    '// 为什么只跟精确链：自然唤醒被杀了无所谓，下次 tick 还会来；',
    '// 约好的时间只有一次，掉了就没了。',
    'let running = null;',
    '',
    'async function preciseTick() {'
  ));

apply('跑之前记上',
  L(
    "    await runDecisionCycle({ kind: 'precise', scheduledAt: w.wake_at, selfNote: note });",
    '  }'
  ),
  L(
    '    running = { wakeId: w.id, scheduledAt: w.wake_at, note };',
    '    try {',
    "      await runDecisionCycle({ kind: 'precise', scheduledAt: w.wake_at, selfNote: note });",
    '    } finally {',
    '      running = null;',
    '    }',
    '  }'
  ));

// ════ 2. shutdown 里留痕迹 ════
console.log('');
console.log('2/3  被杀时往 wake_log 写一笔');
apply('shutdown',
  L(
    'function shutdown(signal) {',
    '  console.log(`phosphor: received ${signal}, shutting down`);',
    '  if (timer) clearInterval(timer);'
  ),
  L(
    'function shutdown(signal) {',
    '  console.log(`phosphor: received ${signal}, shutting down`);',
    '  if (timer) clearInterval(timer);',
    '',
    '  // 正在跑一轮精确唤醒却被杀——这是今天那三次「说醒了但没记录」的真正原因。',
    '  // 一次完整唤醒要跑五六分钟，pm2 restart 正好落在那个窗口里。',
    '  //',
    '  // 两件事要做：约摆回 pending（宽限内重启后再触发一次，超过了标 missed），',
    '  // 往 wake_log 写一笔（不让中断静默消失）。',
    '  if (running) {',
    '    try {',
    "      setPendingWakeStatus(running.wakeId, 'pending');",
    '      console.log(',
    "        'phosphor: 这一轮精确唤醒被' + signal + '打断了，约 #' + running.wakeId + ' 摆回没到点'",
    '      );',
    '    } catch (err) {',
    "      console.error('phosphor: 约没摆回去', err.message);",
    '    }',
    '    try {',
    '      logWake({',
    "        kind: 'precise',",
    '        scheduledAt: running.scheduledAt,',
    '        mode: null,',
    '        gapMinutes: 0,',
    '        decision: null,',
    '        result: null,',
    "        error: '进程收到 ' + signal + '，这一轮没跑完（唤醒要五六分钟，重启落在了那个窗口里）',",
    '      });',
    '    } catch (err) {',
    "      console.error('phosphor: 中断这一笔没记下', err.message);",
    '    }',
    '  }'
  ));

// ════ 3. 启动时把这个规矩说出来 ════
console.log('');
console.log('3/3  启动日志里注明');
apply('启动提示',
  "  process.on('SIGINT', () => shutdown('SIGINT'));",
  L(
    '  // 一次唤醒要跑几分钟。重启落在那个窗口里就会把那一轮杀掉，',
    '  // 现在至少会在 wake_log 里留一笔、并把约摆回没到点。',
    "  process.on('SIGINT', () => shutdown('SIGINT'));"
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
  console.log('pm2 restart phosphor --update-env');
  console.log('');
  console.log('以后要是又出现「说醒了但没记录」，这条能看见原因：');
  console.log('');
  console.log('  sqlite3 data/state.db "select datetime(fired_at/1000,\'unixepoch\',\'+8 hours\') t, error');
  console.log('    from wake_log where error is not null order by id desc limit 5;"');
}
