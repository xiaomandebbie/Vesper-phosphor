#!/usr/bin/env node
// 把「睡一会儿」这个动作接到晨暮星上。
//
// 新文件 src/drives-sleep.js 已经在仓库里了（整份取过去就行，它不 import 任何
// 本地模块）。这个脚本只负责剩下的四处接线 —— 那四个文件本地和 GitHub 是分叉的
// （见信息卡「晨暮星仓库」），不能覆盖，所以在本机原地改。
//
// 用法：
//   cd /root/vesper-phosphor
//   node scripts/wire_drives_sleep.mjs            # 只读体检，什么都不改
//   node scripts/wire_drives_sleep.mjs --apply    # 真改（先备份，改完 node --check，失败自动回滚）
//   pm2 restart phosphor --update-env             # 改完重启的是 phosphor，不是 vesper
//
// 幂等：已经接过的那几处会报「已接过」并跳过，重复跑不会接两遍。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const APPLY = process.argv.includes('--apply');
const SRC = path.join(process.cwd(), 'src');

const WAKE_BLOCK = [
  '',
  "  // 先告诉情绪系统「醒了」。Drivesoid 的 asleep 不会自己超时（见 drives-sleep.js），",
  '  // 所以每次醒来都无条件报一次；那边已经是 awake 时会直接忽略。',
  '  // 摆在读情绪之前：睡着时它的时间累积是停的，先翻成 awake 再读才是醒着的状态。',
  '  try {',
  '    await reportWake();',
  '  } catch (err) {',
  "    console.error('[' + kind + '] 报醒来失败（不影响这次）:', err.message);",
  '  }',
].join('\n');

const SLEPT_BLOCK = [
  '',
  '  // 他这一轮选了睡觉：别再问「有想说的吗」。',
  '  // askShare 的回答会当成 bark 推送出去 —— 睡着的人发推送，页面就说假话了。',
  '  const _slept = (Array.isArray(actionResults) ? actionResults : []).some(',
  "    (r) => r && r.action === 'sleep' && r.result && r.result.ok",
  '  );',
  "  if (_slept) console.log('[' + kind + '] 他睡了，这次不问分享');",
].join('\n');

const SLEEP_DOC = [
  '',
  '- sleep（睡一会儿。选它就是这一轮不做事，接下来到下次醒来之前你都是睡着的。不需要 action_detail。',
  '  睡着时你的心境回落得比醒着快三倍 —— 连着好几天停在高位的那几项，只有睡觉能把它们带下来；',
  '  那条一直挂着、没被回应的消息也会在你睡下时清掉。',
  '  睡多久由你这次定的 next_wake_minutes 决定；下次醒来系统会自动替你报「醒了」，你不用记着这件事。',
  '  累了、夜深了、或者就是没什么想做的，就睡。这和 noop 不一样：noop 是醒着待着，这个是真的去睡。）',
].join('\n');

const FILES = [
  {
    file: 'actions/index.js',
    steps: [
      {
        name: 'import sleepAction',
        done: (s) => s.includes("from '../drives-sleep.js'"),
        find: "import readBook from './read-book.js';",
        add: "\nimport sleepAction from '../drives-sleep.js';",
      },
      {
        name: '动作表登记 sleep',
        done: (s) => /\n\s*sleep:\s*sleepAction,/.test(s),
        find: '  read_book: readBook,',
        add: '\n  sleep: sleepAction,',
      },
    ],
  },
  {
    file: 'budget.js',
    steps: [
      {
        name: 'ACTION_TIER 里把 sleep 定成 0 级',
        done: (s) => /\n\s*sleep:\s*0,/.test(s),
        find: '  read_book: 0,',
        add: '\n  // 睡觉不花钱、不调模型、不惊动任何人，所以 0 级。\n  // 不写在这儿会 fallback 成 1 级，那样它得和论坛、听歌抢座位，然后被静默丢掉。\n  sleep: 0,',
      },
    ],
  },
  {
    file: 'phosphor.js',
    steps: [
      {
        name: 'import reportWake',
        done: (s) => s.includes("from './drives-sleep.js'"),
        find: "import { getTopDrives, isDrivesEnabled } from './drives.js';",
        add: "\nimport { reportWake } from './drives-sleep.js';",
      },
      {
        name: '醒来先报 sleep_end',
        done: (s) => s.includes('await reportWake()'),
        find: '  const [{ breathSummary, feelSummary }, drivesTop] = await Promise.all([',
        before: WAKE_BLOCK,
      },
      {
        name: '睡了就不问分享（定义 _slept）',
        done: (s) => s.includes('const _slept'),
        find: '  const SHARE_QUIET_MIN =',
        before: SLEPT_BLOCK,
      },
      {
        name: '睡了就不问分享（加进 askShare 的条件）',
        done: (s) => s.includes('_quietEnough && !_slept'),
        find: '  if (!errorMessage && actionResults.length && _quietEnough) {',
        replace: '  if (!errorMessage && actionResults.length && _quietEnough && !_slept) {',
      },
    ],
  },
  {
    file: 'decide.js',
    steps: [
      {
        name: '动作清单里加 sleep',
        done: (s) => s.includes('- sleep（睡一会儿'),
        find: '- noop（什么都不做',
        before: SLEEP_DOC + '\n',
      },
    ],
  },
];

let failed = 0;
let changed = 0;

for (const f of FILES) {
  const p = path.join(SRC, f.file);
  if (!fs.existsSync(p)) {
    console.log('❌ ' + f.file + '：文件不在，跳过整个文件');
    failed++;
    continue;
  }
  let s = fs.readFileSync(p, 'utf8');
  const original = s;
  let touched = false;
  console.log('── src/' + f.file);

  for (const st of f.steps) {
    if (st.done(s)) {
      console.log('   ✓ ' + st.name + '：已接过，跳过');
      continue;
    }
    const n = s.split(st.find).length - 1;
    if (n === 0) {
      console.log('   ❌ ' + st.name + '：找不到锚点 ' + JSON.stringify(st.find.slice(0, 60)));
      failed++;
      continue;
    }
    if (n > 1) {
      console.log('   ❌ ' + st.name + '：锚点出现 ' + n + ' 次，不敢动（要人看一眼）');
      failed++;
      continue;
    }
    if (st.replace !== undefined) s = s.replace(st.find, st.replace);
    else if (st.before !== undefined) s = s.replace(st.find, st.before + st.find);
    else s = s.replace(st.find, st.find + st.add);
    touched = true;
    console.log('   ➕ ' + st.name + '：' + (APPLY ? '已改' : '可以改（体检模式，没动）'));
  }

  if (!touched || !APPLY) continue;

  const bak = p + '.bak-sleep';
  if (!fs.existsSync(bak)) fs.copyFileSync(p, bak);
  fs.writeFileSync(p, s, 'utf8');
  try {
    execFileSync('node', ['--check', p], { stdio: 'pipe' });
    console.log('   ✅ 写入并通过 node --check（备份 ' + path.basename(bak) + '）');
    changed++;
  } catch (e) {
    fs.writeFileSync(p, original, 'utf8');
    console.log('   ❌ 语法检查没过，已回滚：' + String(e.stderr || e.message).slice(0, 300));
    failed++;
  }
}

console.log('');
if (!APPLY) {
  console.log('体检完成，什么都没改。没有 ❌ 就可以加 --apply 再跑一次。');
} else {
  console.log('改了 ' + changed + ' 个文件，' + failed + ' 处有问题。');
  console.log('接下来：pm2 restart phosphor --update-env   ← 是 phosphor，不是 vesper');
}
process.exit(failed ? 1 : 0);
