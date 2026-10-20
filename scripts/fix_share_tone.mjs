#!/usr/bin/env node
// 分享的口吻不对。
//
// 小满 2026-10-20：「不要这种转述，要是跟我聊天的口吻」
//
// 他 14:17 发的那两条里写的是「**她**那边停在 38%」。明明是发给她的消息，
// 却像在写日记、像在向第三方交代。
//
// 原因在我这边：整个 decide.js 的提示词都是第三人称在讲「她」（因为那些是
// 跟模型交代背景），而 askShare 的问法沿用了同一个语气——「有想跟 XX 说的吗」。
// 于是他顺着那个视角写下来，把收信人当成了第三方。
//
// 改两处：问法里明说这条是直接发给她的；规则里明说用「你」称呼她。
//
// 跑法：
//   node scripts/fix_share_tone.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const FILE = path.join(process.cwd(), 'src/decide.js');

if (!fs.existsSync(FILE)) {
  console.error('\u2717 src/decide.js not found');
  process.exit(1);
}

const before = fs.readFileSync(FILE, 'utf8');
const bak = FILE + '.bak-sharetone';
if (!fs.existsSync(bak)) fs.copyFileSync(FILE, bak);

const EDITS = [
  {
    what: '问法：明说这条是直接发给她的',
    done: '\u8fd9\u6761\u662f\u76f4\u63a5\u53d1\u5230\u5979\u5bf9\u8bdd\u91cc\u7684',
    find: '\u8bf4\u7684\u5417\uff1f\u60f3\u8bf4\u5c31\u5199\u8fdb share\uff0c\u4e0d\u60f3\u8bf4\u7ed9 null\u3002',
    replacement:
      '\u8bf4\u7684\u5417\uff1f\u60f3\u8bf4\u5c31\u5199\u8fdb share\uff0c\u4e0d\u60f3\u8bf4\u7ed9 null\u3002\n\u8fd9\u6761\u662f\u76f4\u63a5\u53d1\u5230\u5979\u5bf9\u8bdd\u91cc\u7684\uff0c\u5979\u4f1a\u5f53\u6210\u4f60\u53d1\u6765\u7684\u6d88\u606f\u8bfb\u3002',
  },
  {
    what: '规则：用「你」称呼她，别写成日记',
    done: '\u522b\u7528\u300c\u5979\u300d',
    find:
      '- \u8bf4\u4f60\u81ea\u5df1\u771f\u7684\u78b0\u5230\u4e86\u4ec0\u4e48\u3001\u60f3\u5230\u4e86\u4ec0\u4e48\u3002',
    replacement:
      '- **\u5f53\u9762\u8ddf\u5979\u8bf4\u8bdd\uff0c\u7528\u300c\u4f60\u300d\u79f0\u547c\u5979\uff0c\u522b\u7528\u300c\u5979\u300d\u3002**\u4f60\u662f\u5728\u7ed9\u5979\u53d1\u6d88\u606f\uff0c\u4e0d\u662f\u5199\u65e5\u8bb0\u3001\u4e5f\u4e0d\u662f\u5411\u522b\u4eba\u8f6c\u8ff0\u4f60\u4eec\u7684\u4e8b\u3002\n- \u8bf4\u4f60\u81ea\u5df1\u771f\u7684\u78b0\u5230\u4e86\u4ec0\u4e48\u3001\u60f3\u5230\u4e86\u4ec0\u4e48\u3002',
  },
];

let src = before;
let changed = 0;

for (const e of EDITS) {
  if (src.includes(e.done)) {
    console.log('. already done, skip: ' + e.what);
    continue;
  }
  const n = src.split(e.find).length - 1;
  if (n !== 1) {
    console.error('\u2717 ' + e.what + ': found ' + n + ' times, expected 1. nothing changed');
    console.error('  looking for: ' + e.find);
    fs.writeFileSync(FILE, before, 'utf8');
    process.exit(1);
  }
  src = src.replace(e.find, e.replacement);
  console.log('\u2713 ' + e.what);
  changed += 1;
}

if (!changed) {
  console.log('nothing to change');
  process.exit(0);
}

fs.writeFileSync(FILE, src, 'utf8');

try {
  execFileSync(process.execPath, ['--check', FILE], { stdio: 'pipe' });
  console.log('\u2713 syntax ok');
} catch (err) {
  console.error('\u2717 syntax error, reverted:');
  console.error(String(err.stderr || err.message).slice(-600));
  fs.writeFileSync(FILE, before, 'utf8');
  process.exit(1);
}

console.log('');
console.log('pm2 restart phosphor --update-env');
