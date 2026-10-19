#!/usr/bin/env node
// 「noop 是动作名，不是哪个服务里的工具」——修两头：代码这边兑成真的 noop，
// 提示词那边把话说清楚。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/fix_noop_action.mjs
//   node --check src/run-actions.js && node --check src/budget.js && node --check src/decide.js && echo 语法 OK
//   pm2 restart phosphor --update-env
//
// 幂等，重复跑不会出错。
//
// ── 为什么改 ──
//
// 2026-10-19 14:16 那次醒来，小满问「怎么没有动作卡」。日志里他发的是：
//
//   actions: [{ action: 'mcp_call',
//               action_detail: '{"server":"garden","tool":"noop","args":{}}' }]
//   → {"isError":true,"text":"Unknown tool."}
//
// 没卡片是对的：activity.js 的 describeActivity 第一行就把 isError 挡掉了，
// 做失败的事不该在动态里留痕。recordTier2 同样要求没出错，所以次数也没白扣。
// 这两处判断都不用动。
//
// 真正的毛病在更上一层：他想的是「这次什么都不做」，却把 noop 包成了一次工具调用。
// 提示词里写的是「什么都不想做就给空数组，或者写一个 noop」——「写一个 noop」
// 没说清写在哪里，他理解成「去调一个叫 noop 的工具」，于是选了个服务填进去。
// 顺底那个老字段也一样，写的是 lutopia_cli + command: "noop"。
//
// 两边都要改：
//
// 1）代码这边兑成真 noop。他的意图很清楚，不该因为写法不对就变成一次失败。
//    要在 pickActions 之前改完：否则 tier2KindOf 会把它认成「花园」，兑成成功之后
//    反而会白扣一次 2 级额度——什么都没做却扣了一次，比报错更坏。
//
// 2）提示词把话说清。只在代码里兑是治症状：他下次还会这么写，而且每次都白花
//    一轮模型调用去调一个不存在的工具。

import fs from 'fs';
import path from 'path';

const SRC = path.join(process.cwd(), 'src');
const FILES = {
  runact: path.join(SRC, 'run-actions.js'),
  budget: path.join(SRC, 'budget.js'),
  decide: path.join(SRC, 'decide.js'),
};

if (!fs.existsSync(FILES.runact)) {
  console.error('没找到 src/run-actions.js。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

const text = {};
for (const [k, p] of Object.entries(FILES)) {
  text[k] = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

const report = [];
const touched = new Set();

function patch(key, label, { find, replace }) {
  const cur = text[key];
  if (cur == null) {
    report.push(['miss', `${label} — ${key} 不在`]);
    return;
  }
  if (cur.includes(replace)) {
    report.push(['skip', label]);
    return;
  }
  const n = cur.split(find).length - 1;
  if (n === 0) {
    report.push(['miss', `${label} — 找不到锚点`]);
    return;
  }
  if (n > 1) {
    report.push(['miss', `${label} — 锚点有 ${n} 处，不敢改`]);
    return;
  }
  text[key] = cur.replace(find, replace);
  touched.add(key);
  report.push(['ok', label]);
}

const L = (...lines) => lines.join('\n');

// ════ 1. run-actions.js：兑成真 noop ════

patch('runact', '认出包成工具调用的 noop', {
  find: '// 做完这一次该做的事。',
  replace: L(
    '// 他想「什么都不做」，却写成了一次工具调用。',
    '//',
    '// 2026-10-19 14:16 那次：{"server":"garden","tool":"noop","args":{}}。',
    '// 花园没有叫 noop 的工具，于是 Unknown tool.——这次醒来既没做事，也没留下任何痕迹。',
    '// 他的意图很清楚，不该因为写法不对就变成一次失败。',
    '//',
    '// 要在 pickActions 之前就改完：否则 tier2KindOf 会把它认成「花园」，',
    '// 兑成成功之后反而白扣一次 2 级额度。',
    'function isNoopCall(action, detail) {',
    "  if (action !== 'mcp_call') return false;",
    '  try {',
    "    const raw = typeof detail === 'string' ? detail : JSON.stringify(detail ?? '');",
    '    const j = JSON.parse(raw);',
    "    const tool = String(j?.tool ?? '').trim().toLowerCase();",
    "    const cmd = String(j?.args?.command ?? '').trim().toLowerCase();",
    "    return !tool || tool === 'noop' || tool === 'none' || cmd === 'noop';",
    '  } catch {',
    '    return false;',
    '  }',
    '}',
    '',
    '// 做完这一次该做的事。'
  ),
});

patch('runact', '筛之前先兑 noop', {
  find: '  const { allowed, dropped } = pickActions(list);',
  replace: L(
    '  // 把「包成工具调用的 noop」兑回真 noop，再进筛子',
    '  const cleaned = list.map((item) => {',
    "    const a = String(item?.action ?? '').trim();",
    '    if (!isNoopCall(a, item?.action_detail)) return item;',
    '    console.log(`[${kind}] 他把 noop 当成工具去调了（${item?.action_detail}），按「什么都不做」算`);',
    "    return { ...item, action: 'noop', action_detail: '' };",
    '  });',
    '',
    '  const { allowed, dropped } = pickActions(cleaned);'
  ),
});

// ════ 2. budget.js：把那句话说清 ════

patch('budget', 'budgetSection 说清 noop', {
  find: '什么都不想做就给空数组，或者写一个 noop。',
  replace:
    '什么都不想做就给空数组，或者写 {"action":"noop"}——noop 是动作名本身，' +
    '不是哪个服务里的工具，不要用 mcp_call 去调它。',
});

// ════ 3. decide.js：动作清单里那一行 ════
//
// 服务器上这份和仓库里不完全一样（是 wire 脚本一层层打出来的），
// 所以这条没命中也不影响前两条。

patch('decide', 'decide 动作清单说清 noop', {
  find: '- noop（什么都不做，这是合法结果，不代表失败）',
  replace:
    '- noop（什么都不做，这是合法结果，不代表失败。' +
    '就把 action 写成 "noop"，不需要 action_detail。' +
    '它不是哪个 MCP 服务里的工具，别用 mcp_call 去调一个叫 noop 的工具）',
});

// ════ 写回 ════

for (const key of touched) {
  const p = FILES[key];
  const bak = `${p}.bak-noop`;
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, text[key], 'utf8');
}

console.log('');
for (const [kind, msg] of report) {
  console.log(`  ${kind === 'ok' ? '改好了' : kind === 'skip' ? '跳过  ' : '没命中'}  ${msg}`);
}
console.log('');
console.log(touched.size ? `已写回：${[...touched].join('、')}，备份在 .bak-noop` : '没改动。');
console.log('');
console.log('接下来：');
console.log('  node --check src/run-actions.js && node --check src/budget.js && node --check src/decide.js && echo 语法 OK');
console.log('  pm2 restart phosphor --update-env');
console.log('');
