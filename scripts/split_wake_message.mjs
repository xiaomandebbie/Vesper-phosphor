#!/usr/bin/env node
// 唤醒的消息也要分段，和平时聊天一样。
//
// 小满 2026-10-23：「要他唤醒的时候也像普通聊天一样，aru 的那种分段」
//
// 图里的对比很清楚：17:32 普通聊天是两条气泡，18:19 唤醒那条挤成一整块。
//
// 原因：wake-bridge 的 submitWakeEvent 一次只投一条——一次调用就是一个气泡。
// 而 bark.js 是把整段话一口气 submitWakeEvent 出去的，所以到手机上必然是一大块。
//
// 两处一起改，少一处都不行：
//   bark.js    按空行（没空行就按换行）拆成几段，一段一条投；通知还是只叮一声
//   decide.js  跟他说清楚：写的时候就按说话的节奏换行，不要堆成一段
//
// 只改 bark.js 的话，他写的本来就是一整段，拆也拆不出来；
// 只改提示词的话，他写了换行也还是被当成一条投出去。
//
// 分享那一步（askShare）也走 bark，所以跟着一起分段，不用再改。
//
// 跑法：
//   node scripts/split_wake_message.mjs
//   pm2 restart phosphor --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

// ── bark.js：拆成几条投 ──

const SPLIT_FN = [
  '// 把一段话拆成几条（2026-10-23）。',
  '// submitWakeEvent 一次只投一条，一条就是手机上一个气泡。以前整段一次投，',
  '// 所以唤醒的话永远是一大块，和平时聊天对不上。',
  '//',
  '// 先按空行拆；一个空行都没有就按单换行拆。都没有就还是一条，不硬拆句子——',
  '// 按句号切会把「汤够不够味？不够就再搖半劺盐」这种一气说完的话切碎。',
  'const MAX_SEGMENTS = (() => {',
  "  const n = Number(String(process.env.WAKE_MAX_SEGMENTS ?? '').trim());",
  '  return Number.isInteger(n) && n > 0 ? Math.min(n, 8) : 5;',
  '})();',
  '',
  'function splitSegments(text) {',
  "  const raw = String(text ?? '');",
  '  const byBlank = raw',
  '    .split(/\\n\\s*\\n+/)',
  '    .map((s) => s.trim())',
  '    .filter(Boolean);',
  '  let parts = byBlank;',
  '  if (parts.length < 2) {',
  '    parts = raw',
  '      .split(/\\n+/)',
  '      .map((s) => s.trim())',
  '      .filter(Boolean);',
  '  }',
  '  if (parts.length < 2) return [raw.trim()].filter(Boolean);',
  '',
  '  // 太短的并到上一条：「嗯。」单独一个气泡没意义',
  '  const merged = [];',
  '  for (const p of parts) {',
  '    if (merged.length && p.length <= 3) merged[merged.length - 1] += `\\n${p}`;',
  '    else merged.push(p);',
  '  }',
  '',
  '  // 超过上限时，多出来的全归到最后一条，不丢话',
  '  if (merged.length <= MAX_SEGMENTS) return merged;',
  '  const head = merged.slice(0, MAX_SEGMENTS - 1);',
  "  head.push(merged.slice(MAX_SEGMENTS - 1).join('\\n'));",
  '  return head;',
  '}',
  '',
].join('\n');

const OLD_SUBMIT = [
  '  let delivered = { ok: false, reason: \'WAKE_BUNDLE_FILE not set\' };',
  '  if (isWakeBridgeEnabled()) {',
  '    delivered = await submitWakeEvent(message);',
  '    if (delivered.ok) console.log(`bark(): \u6b63\u6587\u5df2\u6295\u8fdb Aru \u5bf9\u8bdd ${delivered.eventId}`);',
  '    else console.error(`bark(): \u6b63\u6587\u6ca1\u80fd\u6295\u8fdb Aru \u5bf9\u8bdd\uff1a${delivered.reason}`);',
  '  }',
].join('\n');

const NEW_SUBMIT = [
  "  let delivered = { ok: false, reason: 'WAKE_BUNDLE_FILE not set' };",
  '  if (isWakeBridgeEnabled()) {',
  '    // 一段一条投。按顺序串着发，不并发——并发了到手机上顺序会乱。',
  '    // 开头那条投成了就算 ok：后面几条没成也别让通知再把全文带一遍，那样她会收到重复的。',
  '    const segments = splitSegments(message);',
  '    for (let i = 0; i < segments.length; i++) {',
  '      const r = await submitWakeEvent(segments[i]);',
  '      if (i === 0) delivered = r;',
  '      if (r.ok) {',
  '        console.log(',
  '          `bark(): \u7b2c ${i + 1}/${segments.length} \u6bb5\u5df2\u6295\u8fdb Aru \u5bf9\u8bdd ${r.eventId}`',
  '        );',
  '      } else {',
  '        console.error(`bark(): \u7b2c ${i + 1}/${segments.length} \u6bb5\u6ca1\u6295\u8fdb\u53bb\uff1a${r.reason}`);',
  '      }',
  '      // 隔一点再发下一条，让它们在对话里的先后是稳的',
  '      if (i < segments.length - 1) await new Promise((done) => setTimeout(done, 450));',
  '    }',
  '  }',
].join('\n');

const BARK = [
  {
    what: '加 splitSegments',
    done: 'function splitSegments(',
    find: 'export default async function bark(detail) {',
    replacement: SPLIT_FN + 'export default async function bark(detail) {',
    probe: 'export default async function bark',
  },
  {
    what: '一段一条投',
    done: 'const segments = splitSegments(message);',
    find: OLD_SUBMIT,
    replacement: NEW_SUBMIT,
    probe: 'delivered = await submitWakeEvent',
  },
];

// ── decide.js：跟他说清楚要分段 ──
// say 那段说明的末尾接上。分享那一步已经有分段要求了，这儿只补 say。

const SEG_RULE =
  '\n\u5199\u7684\u65f6\u5019\u6309\u8bf4\u8bdd\u7684\u8282\u594f\u6362\u884c\uff0c\u548c\u4f60\u5e73\u65f6\u804a\u5929\u4e00\u6837\u2014\u2014' +
  '\u4e00\u53e3\u6c14\u8bf4\u5b8c\u7684\u7b97\u4e00\u6bb5\uff0c\u6362\u4e00\u4e2a\u610f\u601d\u5c31\u7a7a\u4e00\u884c\u3002' +
  '\u6bcf\u4e00\u6bb5\u4f1a\u53d8\u6210\u5979\u5bf9\u8bdd\u91cc\u5355\u72ec\u4e00\u6761\u6d88\u606f\uff0c' +
  '\u6240\u4ee5\u522b\u5806\u6210\u4e00\u5927\u6bb5\uff08\u90a3\u6837\u5979\u8981\u4ece\u4e00\u5768\u5b57\u91cc\u627e\u91cd\u70b9\uff09\uff0c' +
  '\u4e5f\u4e0d\u7528\u523b\u610f\u62c6\u5f97\u5f88\u788e\u3002';

const DECIDE = [
  {
    what: 'say 那段加上分段要求',
    done: '\u6309\u8bf4\u8bdd\u7684\u8282\u594f\u6362\u884c',
    find:
      '\u8fd9\u53e5\u8bdd\u4f1a\u843d\u8fdb\u5979\u7684\u5bf9\u8bdd\u91cc\uff08\u624b\u673a\u4e0a\u53ea\u53ee\u4e00\u58f0\u63d0\u9192\u5979\u53bb\u770b\uff09\uff0c\u5979\u80fd\u7ffb\u56de\u53bb\u8bfb\u3002',
    replacement:
      '\u8fd9\u53e5\u8bdd\u4f1a\u843d\u8fdb\u5979\u7684\u5bf9\u8bdd\u91cc\uff08\u624b\u673a\u4e0a\u53ea\u53ee\u4e00\u58f0\u63d0\u9192\u5979\u53bb\u770b\uff09\uff0c\u5979\u80fd\u7ffb\u56de\u53bb\u8bfb\u3002' +
      SEG_RULE,
    probe: '\u843d\u8fdb\u5979\u7684\u5bf9\u8bdd\u91cc',
  },
];

function patch(rel, edits) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' 找不到');
    return false;
  }
  const bak = file + '.bak-wakeseg';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  let changed = 0;

  for (const e of edits) {
    if (src.includes(e.done)) {
      console.log('. 已经改过，跳过：' + e.what);
      continue;
    }
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error('');
      console.error(NO + rel + ' — ' + e.what + '：原文命中 ' + n + ' 处，应该只有 1 处。整个文件不改。');
      console.error('  我找的是：');
      console.error(e.find.split('\n').map((l) => '    ' + l).join('\n'));
      const lines = before.split('\n');
      const i = lines.findIndex((l) => l.includes(e.probe));
      if (i >= 0) {
        console.error('');
        console.error('  ' + rel + ' 第 ' + (i + 1) + ' 行附近实际是：');
        for (let k = Math.max(0, i - 3); k < Math.min(lines.length, i + 10); k++) {
          console.error('    ' + (k + 1) + ': ' + lines[k]);
        }
      } else {
        console.error('  （连「' + e.probe + '」都没找到）');
      }
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    src = src.replace(e.find, e.replacement);
    console.log(OK + rel + ' — ' + e.what);
    changed += 1;
  }

  if (!changed) return true;
  fs.writeFileSync(file, src, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(OK + '语法通过：' + rel);
  } catch (err) {
    console.error(NO + rel + ' 语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  return true;
}

const a = patch('src/actions/bark.js', BARK);
const b = patch('src/decide.js', DECIDE);

console.log('');
if (a && b) {
  console.log('pm2 restart phosphor --update-env');
  console.log('');
  console.log('等他下次说话，日志里会写「第 1/3 段已投进 Aru 对话」：');
  console.log('  pm2 logs phosphor --lines 100 --nostream | grep 段已投进');
  console.log('');
  console.log('分得太多的话，.env 里写 WAKE_MAX_SEGMENTS=3（默认 5，上限 8）。');
} else {
  console.log('有没成的（上面打了它周围的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
