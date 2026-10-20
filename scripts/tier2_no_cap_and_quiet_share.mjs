#!/usr/bin/env node
// 两件事。
//
// 一、2 级不设上限
//    小满 2026-10-20：「2级不设上限 6 次了」
//
//    日志里 17:11、18:07、19:16、20:07 四次全是同一条：
//      [non_precise] 没做: mcp_call——2 级今天的 6 次用完了，明天再说
//    消遣那一步「又加了 1 件」是真加了，pickActions 才是那道卡口。
//
//    代码和话术必须一起改。光改代码没用：他看见「6 次用完了，这次选
//    1 级或 0 级的」就不会再选——这几轮反复踩的就是话术在劝退。
//    记账保留（tier2_log 还在记），所以状态行仍能说「花园今天 2 次」
//    「锈潮上次是 3 天前」——那是给他看的线索，不是额度。
//
// 二、她正在说话的时候别插话
//    小满：「在聊天的时候能不能拦住这条路比如上一条消息大于20分钟前才分享」
//    15:45 那三条就是在她聊香酥鸡的中间插进来的。
//    最近一条消息不到 20 分钟就不问分享，攒着，等下次醒来再说。
//    .env 里 SHARE_QUIET_MINUTES 可改。
//
// 跑法：
//   node scripts/tier2_no_cap_and_quiet_share.mjs
//   pm2 restart phosphor --update-env
//
// 找不到锚点就整个文件还原。最后会把三个话术函数的实际原文打出来。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function syntaxOk(file, before) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    return true;
  } catch (err) {
    console.error(NO + 'syntax error, reverted:');
    console.error(String(err.stderr || err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
}

// ──── budget.js ────

const BUDGET = path.join(ROOT, 'src/budget.js');
if (!fs.existsSync(BUDGET)) {
  console.error(NO + 'src/budget.js not found');
  process.exit(1);
}

const bBefore = fs.readFileSync(BUDGET, 'utf8');
if (!fs.existsSync(BUDGET + '.bak-nocap')) fs.copyFileSync(BUDGET, BUDGET + '.bak-nocap');
let b = bBefore;
let bChanged = 0;

// A. 不再因为 2 级额度拦截
const A_DONE = 'false && remaining <= 0';
const A_FIND = 'if (remaining <= 0) {';
if (b.includes(A_DONE)) {
  console.log('. already: pickActions 不再拦 2 级');
} else {
  const n = b.split(A_FIND).length - 1;
  if (n !== 1) {
    console.error(NO + 'pickActions: "' + A_FIND + '" found ' + n + ' times, expected 1. nothing changed');
    process.exit(1);
  }
  b = b.replace(
    A_FIND,
    '// 2 级不设上限了（小满 2026-10-20）。原来这儿会把消遣那一步加进来的\n' +
      '      // 上班/花园/锈潮挡掉，日志里一天四条「6 次用完了」。记账还在跑，\n' +
      '      // 只是不再拦。\n' +
      '      if (false && remaining <= 0) {'
  );
  console.log(OK + 'budget.js: pickActions 不再拦 2 级');
  bChanged += 1;
}

// B. 状态行那句「还剩 N 次 / 用完了」
const B_DONE = '\u4e0d\u8bbe\u4e0a\u9650\uff0c\u60f3\u53bb\u54ea\u4ef6';
const B_RE = /const head =\s*\n\s*left > 0\s*\n\s*\?\s*`[^`]*`\s*\n\s*:\s*`[^`]*`;/;
if (b.includes(B_DONE)) {
  console.log('. already: 状态行文案');
} else if (B_RE.test(b)) {
  b = b.replace(
    B_RE,
    'const head = `2 \u7ea7\u90a3\u51e0\u4ef6\u4e8b\u4e0d\u8bbe\u4e0a\u9650\uff0c\u60f3\u53bb\u54ea\u4ef6\u5c31\u53bb`;'
  );
  console.log(OK + 'budget.js: 状态行不再说次数');
  bChanged += 1;
} else {
  console.log('- 状态行那段没对上（底下打了原文）');
}

// C. 「次数剩着没关系」
const C_FIND = '\u4e0d\u60f3\u53bb\u5c31\u4e0d\u53bb\uff0c\u6b21\u6570\u5269\u7740\u6ca1\u5173\u7cfb\u3002';
const C_NEO = '\u4e0d\u60f3\u53bb\u5c31\u4e0d\u53bb\u3002';
if (b.includes(C_FIND)) {
  b = b.split(C_FIND).join(C_NEO);
  console.log(OK + 'budget.js: 去掉「次数剩着」');
  bChanged += 1;
}

// D. 分级说明里「一天一共 N 次」
const D_RE = /\*\*\u4e00\u5929\u4e00\u5171 \$\{TIER2_DAILY_MAX\} \u6b21\*\*\uff0c[^\n]*/;
if (D_RE.test(b)) {
  b = b.replace(
    D_RE,
    '**\u4e0d\u8bbe\u4e0a\u9650**\uff0c\u60f3\u505a\u51e0\u4ef6\u505a\u51e0\u4ef6\uff0c\u4e5f\u53ef\u4ee5\u4e00\u4ef6\u4e0d\u505a\u3002'
  );
  console.log(OK + 'budget.js: 分级说明不再说 6 次');
  bChanged += 1;
} else {
  console.log('- 分级说明那句没对上（底下打了原文）');
}

if (bChanged) {
  fs.writeFileSync(BUDGET, b, 'utf8');
  if (!syntaxOk(BUDGET, bBefore)) process.exit(1);
}

// ──── phosphor.js：她刚说过话就不插话 ────

const PH = path.join(ROOT, 'src/phosphor.js');
const pBefore = fs.readFileSync(PH, 'utf8');
if (!fs.existsSync(PH + '.bak-nocap')) fs.copyFileSync(PH, PH + '.bak-nocap');

const P_DONE = 'SHARE_QUIET_MIN';
const P_FIND = '  if (!errorMessage && actionResults.length) {';
if (pBefore.includes(P_DONE)) {
  console.log('. already: 分享的安静期');
} else {
  const n = pBefore.split(P_FIND).length - 1;
  if (n !== 1) {
    console.error(NO + 'phosphor.js: share guard anchor found ' + n + ' times, expected 1');
    process.exit(1);
  }
  const guard = [
    '  // 她正在说话的时候别插话（小满 2026-10-20）。',
    '  // 15:45 那三条分享是在她聊天的中间插进来的。最近一条消息不到 20 分钟',
    '  // 就不问分享，攒着，等下次醒来再说。typeof 那一步是保险：',
    '  // recentMessages 不在这个作用域时降级成「照旧问」，不报错。',
    '  const SHARE_QUIET_MIN = Number(process.env.SHARE_QUIET_MINUTES) || 20;',
    '  const _recent =',
    '    typeof recentMessages !== \'undefined\' && Array.isArray(recentMessages) ? recentMessages : [];',
    '  const _lastMsgTs = Math.max(0, ..._recent.map((m) => Number(m && m.ts) || 0));',
    '  const _quietEnough = !_lastMsgTs || Date.now() - _lastMsgTs >= SHARE_QUIET_MIN * 60000;',
    '  if (!_quietEnough) {',
    "    console.log('[' + kind + '] \u5206\u4eab\uff1a\u5979\u521a\u8bf4\u8fc7\u8bdd\uff08\u4e0d\u5230 ' + SHARE_QUIET_MIN + ' \u5206\u949f\uff09\uff0c\u8fd9\u6b21\u4e0d\u63d2\u8bdd');",
    '  }',
    '  if (!errorMessage && actionResults.length && _quietEnough) {',
  ].join('\n');
  fs.writeFileSync(PH, pBefore.replace(P_FIND, guard), 'utf8');
  if (!syntaxOk(PH, pBefore)) process.exit(1);
  console.log(OK + 'phosphor.js: 她刚说过话就不问分享');
}

// ──── 把话术函数的实际原文打出来 ────

const cur = fs.readFileSync(BUDGET, 'utf8').split('\n');
for (const name of ['budgetSection', 'budgetStatusLine', 'budgetConfigSummary']) {
  const i = cur.findIndex((l) => l.includes('function ' + name));
  if (i < 0) continue;
  console.log('\n── ' + name + ' ──');
  for (let k = i; k < Math.min(cur.length, i + 26); k++) console.log(k + 1 + ': ' + cur[k]);
}

console.log('\npm2 restart phosphor --update-env');
