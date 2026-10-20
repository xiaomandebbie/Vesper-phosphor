#!/usr/bin/env node
// 做完事之后，单独问一句有没有想跟她说的。
//
// 小满 2026-10-20：「能让允朔有行动之后给我发个消息跟我分享一下嘛。
//   注意告诉他不要写在一段里，要多分段。」
//
// 为什么不能用现成的 say：say 是在动作**之前**定的（见 split_say_and_action.mjs
// 那处「先说话再做事」）。那会儿事情还没做，他只能说「我打算去看看」，
// 说不了「我刚才看到了什么」。
//
// 所以这是独立的第三步，插在所有动作和续步（continueWorkkk / continueGarden
// 这些）都跑完之后、logWake 之前。那时 actionResults 里是真实结果。
//
// 投递走 bark（正文进 Aru 对话，Bark 只叮一声，见 bark.js），不另造链路。
//
// 写进提示词的三条：一件事一段、段间空行；说碰到了什么而不是复述流程；
// 没什么想说的就给 null。
//
// token：接在同一段对话后面追加一条消息，前面的 system + user + 决定原样不动，
// 吃前缀缓存。行动卡片本身不花 token（addActivityMoment 就是一条 INSERT）。
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/wire_share_after_actions.mjs
//   pm2 restart phosphor --update-env
//
// 锚点对不上就整个文件原样还原并打出周围实际原文。重复跑安全。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const Q = String.fromCharCode(39);

const SHARE_FN = [
  '// ---------- 分享：做完事之后，问一句有没有想说的 ----------',
  '// 和 say 不是一回事。say 在动作之前定，那时事情还没做，他只能说「我打算」；',
  '// 这一步在所有动作跑完之后问，手上有真实结果，说的是实际做过的事。',
  '//',
  '// 小满 2026-10-20：「有行动之后给我发个消息跟我分享一下…不要写在一段里，要多分段。」',
  'export async function askShare(messages, results) {',
  '  const lines = (Array.isArray(results) ? results : []).map((r, i) => {',
  '    const out = r && r.result;',
  '    const texts =',
  '      out && Array.isArray(out.content)',
  '        ? out.content',
  '            .filter((c) => c && c.type === TEXT_TYPE && typeof c.text === STR_TYPE)',
  '            .map((c) => c.text)',
  '            .join(NL)',
  '        : EMPTY;',
  '    const act = (r && r.action) || QMARK;',
  '    const det = r && r.action_detail ? SP + clipText(String(r.action_detail), 200) : EMPTY;',
  '    const ret = texts ? NL + RET_LABEL + clipText(texts, 600) : EMPTY;',
  '    return i + 1 + DOT + act + det + ret;',
  '  });',
  '',
  '  const prompt = [',
  '    HEAD,',
  '    lines.join(NL),',
  '    EMPTY,',
  '    ASK_A + USER_NAME + ASK_B,',
  '    EMPTY,',
  '    RULE_HEAD,',
  '    RULE_1,',
  '    RULE_2,',
  '    RULE_3,',
  '    EMPTY,',
  '    FMT,',
  '  ].join(NL);',
  '',
  '  const next = [...messages, { role: ROLE_USER, content: prompt }];',
  '  const { parsed } = await askJson(next);',
  '  const s = parsed && typeof parsed.share === STR_TYPE ? parsed.share.trim() : EMPTY;',
  '  return s && s !== NULL_STR && s !== UNDEF_STR ? s : null;',
  '}',
  '',
  '',
].join('\n');

const CONSTS = [
  '// askShare 用到的几个字面量（见下面 askShare）',
  'const NL = String.fromCharCode(10);',
  'const EMPTY = ' + Q + Q + ';',
  'const SP = ' + Q + ' ' + Q + ';',
  'const DOT = ' + Q + '. ' + Q + ';',
  'const QMARK = ' + Q + '?' + Q + ';',
  'const TEXT_TYPE = ' + Q + 'text' + Q + ';',
  'const STR_TYPE = ' + Q + 'string' + Q + ';',
  'const ROLE_USER = ' + Q + 'user' + Q + ';',
  'const NULL_STR = ' + Q + 'null' + Q + ';',
  'const UNDEF_STR = ' + Q + 'undefined' + Q + ';',
  'const RET_LABEL = ' + Q + '   返回：' + Q + ';',
  'const HEAD = ' + Q + '这次醒来你做完了这些事：' + Q + ';',
  'const ASK_A = ' + Q + '有想跟' + Q + ';',
  'const ASK_B = ' + Q + '说的吗？想说就写进 share，不想说给 null。' + Q + ';',
  'const RULE_HEAD = ' + Q + '写的时候注意：' + Q + ';',
  'const RULE_1 =',
  '  ' + Q + '- **一件事一段，段之间空一行。**不要把几件事挤在一段里——那样她得自己从一坨字里找哪句对应哪件事。' + Q + ';',
  'const RULE_2 =',
  '  ' + Q + '- 说你自己真的碰到了什么、想到了什么。不用复述流程（「我打开论坛，然后看了帖子」这种她在动态页看得见）。' + Q + ';',
  'const RULE_3 =',
  '  ' + Q + '- 没什么值得说的就给 null。不用为了有话说而找话说，这一步空着很正常。' + Q + ';',
  'const FMT = ' + Q + '只返回一个JSON对象，不要任何其他文字：{"share": "..." 或 null}' + Q + ';',
  '',
  '',
].join('\n');

const SHARE_STEP = [
  '  // 分享：动作和续步都跑完了，再单独问一句有没有想跟她说的（2026-10-20）。',
  '  // 和 say 不是一回事：say 在动作之前定，那会儿事还没做，说不了「刚才做了什么」。',
  '  // 这一步手上有真实结果。投递走 bark（正文进 Aru 对话，只叮一声），不另造链路。',
  '  // 问不出来、或者他给 null，都不影响这次收尾。',
  '  if (!errorMessage && actionResults.length) {',
  '    try {',
  '      const share = await askShare(messages, actionResults);',
  '      if (share) {',
  '        const shareDecision = {',
  '          action: ' + Q + 'bark' + Q + ',',
  '          action_detail: share,',
  '          mood: decision && decision.mood,',
  '        };',
  '        const shareResult = await executeAction(shareDecision);',
  '        console.log(' + Q + '[' + Q + ' + kind + ' + Q + '] 分享:' + Q + ', JSON.stringify(shareResult));',
  '      } else {',
  '        console.log(' + Q + '[' + Q + ' + kind + ' + Q + '] 分享：这次没什么想说的' + Q + ');',
  '      }',
  '    } catch (err) {',
  '      console.error(' + Q + '[' + Q + ' + kind + ' + Q + '] 分享这一步没成（不影响收尾）:' + Q + ', err.message);',
  '    }',
  '  }',
  '',
].join('\n');

const DECIDE_EDITS = [
  {
    what: '加 askShare 用到的字面量',
    done: 'const RULE_1 =',
    find: '// ---------- 第二阶段：正事定完了，再问消遣 ----------',
    replacement: CONSTS + '// ---------- 第二阶段：正事定完了，再问消遣 ----------',
  },
  {
    what: '加 askShare',
    done: 'export async function askShare',
    find: 'export async function decideWithMessages(context) {',
    replacement: SHARE_FN + 'export async function decideWithMessages(context) {',
  },
];

const PHOSPHOR_EDITS = [
  {
    what: '做完事之后问一句分享',
    done: 'await askShare(messages, actionResults)',
    find: '  logWake({',
    replacement: SHARE_STEP + '  logWake({',
  },
];

function addImport(src) {
  if (/askShare/.test(src)) return { src: src, already: true };
  const re = /import \{([^}]*)\} from '\.\/decide\.js';/;
  const m = re.exec(src);
  if (!m) return { src: src, error: "找不到 import ... from './decide.js' 那一行" };
  const names = m[1].trim().replace(/,$/, '');
  return { src: src.replace(re, 'import { ' + names + ", askShare } from './decide.js';") };
}

function patch(rel, edits, extra) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error('✗ 找不到 ' + rel + '——是不是不在 /root/vesper-phosphor 下跑的？');
    return false;
  }
  const bak = file + '.bak-share';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  let changed = 0;

  for (const e of edits) {
    if (src.includes(e.done)) {
      console.log('· 已经改过，跳过：' + rel + ' — ' + e.what);
      continue;
    }
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error('');
      console.error('✗ ' + rel + ' — ' + e.what + '：原文出现 ' + n + ' 次，应该只有 1 次。整个文件不改。');
      console.error('  我找的是：' + e.find);
      const lines = before.split('\n');
      const probe = e.find.trim().slice(0, 20);
      const i = lines.findIndex((l) => l.includes(probe));
      if (i >= 0) {
        console.error('');
        console.error('  第 ' + (i + 1) + ' 行附近实际是：');
        for (let k = Math.max(0, i - 3); k < Math.min(lines.length, i + 8); k++) {
          console.error('    ' + (k + 1) + ': ' + lines[k]);
        }
      }
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    src = src.replace(e.find, e.replacement);
    console.log('✓ ' + rel + ' — ' + e.what);
    changed += 1;
  }

  if (extra) {
    const out = extra(src);
    if (out.error) {
      console.error('');
      console.error('✗ ' + rel + '：' + out.error + '。整个文件不改。');
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    if (out.already) {
      console.log('· 已经改过，跳过：' + rel + ' — import');
    } else {
      src = out.src;
      console.log('✓ ' + rel + ' — import 带上 askShare');
      changed += 1;
    }
  }

  if (!changed) return true;
  fs.writeFileSync(file, src, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log('✓ 语法通过：' + rel);
  } catch (err) {
    console.error('✗ ' + rel + ' 语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-800));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  return true;
}

const okDecide = patch('src/decide.js', DECIDE_EDITS);
const okPhosphor = okDecide ? patch('src/phosphor.js', PHOSPHOR_EDITS, addImport) : false;

console.log('');
if (okDecide && okPhosphor) {
  console.log('两处都成了。接着：pm2 restart phosphor --update-env');
  console.log('然后等他醒一次、并且真的做了事，日志里 grep 分享 看结果。');
  console.log('他给 null 时日志写「这次没什么想说的」——那也是正常的。');
} else {
  console.log('有没成的（上面打了它周围的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
