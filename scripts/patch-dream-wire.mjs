// 补丁：把 dream 续步接上，并修「顶层写了 server+tool 却落成 noop」那个 bug。
//
// 两处都在 src/phosphor.js（4xKB，整文件改不过去），所以做精确字串替换。
// 按每处各自独立：对不上的单独报出来，不连坐。已经改过的跳过，可重复跑。
//
// 为什么要改 noop 那一处：2026-11-20 日志里有两次是这个形状——
//   {"server":"leto","tool":"leto_notices","args":{}, ... "action":"noop"}
// server / tool 写在了顶层而不是 action_detail 里，action 字段缺席，
// normalizeDecision 于是兑成 noop。他想去看 Leto 通知，结果这一轮什么都没做，
// 钱照花。意图很清楚，不该因为写法不对就变成一次空转——
// run-actions.js 里已经有一个反方向的兑法（isNoopCall：把包成工具调用的 noop
// 兑回真 noop），这是那个的双生兄弟。
//
//   node scripts/patch-dream-wire.mjs
//   node --check src/phosphor.js && pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILE = 'src/phosphor.js';

const edits = [
  {
    why: '续步注册表里加 continueDream',
    done: 'dream-steps.js',
    grep: 'books-steps',
    find: "    ['./books-steps.js', 'continueBooks'],",
    replace: [
      "    ['./dream-steps.js', 'continueDream'],",
      "    ['./books-steps.js', 'continueBooks'],",
    ].join('\n'),
  },
  {
    why: "normalizeDecision：const action 改成 let（下一处要改它）",
    done: 'let action = typeof d.action',
    grep: 'const action = typeof d.action',
    find: "  const action = typeof d.action === 'string' && d.action.trim() ? d.action.trim() : 'noop';",
    replace: "  let action = typeof d.action === 'string' && d.action.trim() ? d.action.trim() : 'noop';",
  },
  {
    why: '顶层写了 server+tool 而 action 是 noop：当 mcp_call',
    done: '顶层写了 server+tool',
    grep: 'actionDetail',
    find: "  if (typeof actionDetail !== 'string') actionDetail = JSON.stringify(actionDetail);",
    replace: [
      "  if (typeof actionDetail !== 'string') actionDetail = JSON.stringify(actionDetail);",
      '',
      '  // 顶层写了 server+tool，action 却是 noop：他想调一个工具，只是放错了层。',
      '  //',
      '  // 2026-11-20 日志里两次都是这个形状：',
      '  //   {"server":"leto","tool":"leto_notices","args":{}, … "action":"noop"}',
      '  // 两轮都真的醒过来了、模型也调了，却什么都没做。',
      '  // run-actions.js 里有个反方向的兑法（isNoopCall），这是它的双生兄弟。',
      "  if ((!action || action === 'noop') && !actionDetail) {",
      "    const srv = typeof d.server === 'string' ? d.server.trim() : '';",
      "    const tl = typeof d.tool === 'string' ? d.tool.trim() : '';",
      "    if (srv && tl && tl.toLowerCase() !== 'noop') {",
      "      action = 'mcp_call';",
      '      actionDetail = JSON.stringify({ server: srv, tool: tl, args: d.args ?? {} });',
      "      console.log('phosphor: server/tool 写在了顶层（' + srv + '/' + tl + '），按 mcp_call 算');",
      '    }',
      '  }',
    ].join('\n'),
  },
];

const abs = path.join(ROOT, FILE);
if (!fs.existsSync(abs)) {
  console.error('找不到 ' + FILE + '，没在仓库根目录跑？');
  process.exit(1);
}

let changed = 0;
let skipped = 0;
const failed = [];

for (const e of edits) {
  const src = fs.readFileSync(abs, 'utf8');
  if (src.includes(e.done)) {
    console.log('跳过  ' + e.why + '（已经改过了）');
    skipped += 1;
    continue;
  }
  const at = src.indexOf(e.find);
  if (at < 0) {
    failed.push({ ...e, reason: '这段原文没找到（本地改过）' });
    continue;
  }
  if (src.indexOf(e.find, at + 1) >= 0) {
    failed.push({ ...e, reason: '这段出现了两次，不敢改' });
    continue;
  }
  fs.writeFileSync(abs, src.replace(e.find, e.replace), 'utf8');
  console.log('改好  ' + e.why);
  changed += 1;
}

console.log('');
console.log('改了 ' + changed + ' 处，跳过 ' + skipped + ' 处，对不上 ' + failed.length + ' 处。');

if (failed.length) {
  console.log('');
  console.log('这几处没改（一个字都没动），把对应的 grep 结果发我：');
  for (const f of failed) {
    console.log('  ✗ ' + f.why + ' —— ' + f.reason);
    console.log('    grep -n "' + f.grep + '" ' + FILE);
  }
}

if (changed) {
  console.log('');
  console.log('接下来：');
  console.log('  node --check src/phosphor.js && node --check src/dream-steps.js && echo ok');
  console.log('  pm2 restart phosphor --update-env');
  console.log('  pm2 logs phosphor --lines 5 --nostream | grep 续步');
}
