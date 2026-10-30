#!/usr/bin/env node
// 把底栅和三个新页接进晨暮星。
//
// 小满 2026-10-30：「导航页面要下栅目那种 聊天、记忆、主页、发现、个人」
//
// 四处：
//   1. vesper.js  import 三个新页
//   2. vesper.js  挂路由
//   3. page-chrome.js  CHROME_CSS 接上 TABS_CSS、CHROME_SCRIPT 接上 TABS_SCRIPT
//      （这样现有十几个页不用改，运行时自己长出底栅）
//
// 发现页没单独建：暂时让它指向动态页（她说「动态在发现里面」）。
// 要是后来想要一个真的聚合页，再单独写一个 /discover。
//
// 跑法：
//   node scripts/wire_tabs.mjs
//   pm2 restart vesper --update-env

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function patch(rel, steps) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' 找不到');
    return false;
  }
  const bak = file + '.bak-tabs';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let lines = before.split('\n');
  let changed = 0;
  let failed = false;

  const indentOf = (s) => (s.match(/^\s*/) || [''])[0];

  for (const s of steps) {
    if (lines.some((l) => l.includes(s.done))) {
      console.log('. 已经改过，跳过：' + s.what);
      continue;
    }
    const hits = [];
    lines.forEach((l, i) => {
      if (l.includes(s.needle)) hits.push(i);
    });
    if (hits.length !== 1) {
      console.error('');
      console.error(NO + rel + ' — ' + s.what + '：含「' + s.needle + '」的行有 ' + hits.length + ' 条，应该只有 1 条');
      for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
      failed = true;
      break;
    }
    const i = hits[0];
    const out = s.make(lines[i], indentOf(lines[i]));
    lines.splice(i, 1, ...(Array.isArray(out) ? out : [out]));
    console.log(OK + rel + ' — ' + s.what);
    changed += 1;
  }

  if (failed) {
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  if (!changed) return true;

  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(OK + '语法通过：' + rel);
  } catch (err) {
    console.error(NO + rel + ' 语法不过，已还原：');
    console.error(String(err.stderr || err.message).slice(-700));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  return true;
}

// ── vesper.js ──
// 跟在 registerHomeRoutes 那一行前后：那行形状独特，做锚点稳
const VESPER = [
  {
    what: 'import 三个新页',
    done: "from './chat-page.js'",
    needle: "import { registerHomeRoutes } from './home-page.js';",
    make: (line) => [
      line,
      "import { registerChatRoutes } from './chat-page.js';",
      "import { registerMemoriesRoutes } from './memories-page.js';",
      "import { registerMeRoutes } from './me-page.js';",
    ],
  },
  {
    what: '挂三个新路由',
    done: 'registerChatRoutes(app',
    needle: 'registerHomeRoutes(app, { requireBasicAuth });',
    make: (line, ind) => [
      line,
      ind + '// 底栅那三页（2026-10-30）。发现暂时指动态页，没单独建。',
      ind + 'registerChatRoutes(app, { requireBasicAuth });',
      ind + 'registerMemoriesRoutes(app, { requireBasicAuth });',
      ind + 'registerMeRoutes(app, { requireBasicAuth });',
      ind + "app.get('/discover', requireBasicAuth, (req, res) => res.redirect(302, '/moments'));",
    ],
  },
];

// ── page-chrome.js ──
// CHROME_CSS 结尾是  ${FACE_CSS}${FACE_PATCH_CSS}${FLOURISH_CSS}${STAR_ENTRY_CSS}`;
// CHROME_SCRIPT 结尾是 ${STAR_ENTRY_SCRIPT}`;  （上一轮 PWA 那个补丁可能已经往后面接了 PWA_SCRIPT）
const CHROME = [
  {
    what: 'import tabs',
    done: "from './tabs.js'",
    needle: "import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';",
    make: (line) => [line, "import { TABS_CSS, TABS_SCRIPT } from './tabs.js';"],
  },
  {
    what: 'CHROME_CSS 接上 TABS_CSS',
    done: '${TABS_CSS}',
    needle: '${FACE_CSS}${FACE_PATCH_CSS}${FLOURISH_CSS}${STAR_ENTRY_CSS}`;',
    make: (line) =>
      line.replace('${STAR_ENTRY_CSS}`;', '${STAR_ENTRY_CSS}${TABS_CSS}`;'),
  },
];

const a = patch('src/vesper.js', VESPER);
const b = a ? patch('src/page-chrome.js', CHROME) : false;

// CHROME_SCRIPT 末尾接 TABS_SCRIPT。那一行可能是
//   ${STAR_ENTRY_SCRIPT}`;        或
//   ${STAR_ENTRY_SCRIPT}\n${PWA_SCRIPT}`;   （上一轮接过）
// 所以找以 `; 结尾、且含 SCRIPT} 的那一行
let c = true;
if (b) {
  const file = path.join(ROOT, 'src/page-chrome.js');
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('${TABS_SCRIPT}')) {
    console.log('. 已经改过，跳过：CHROME_SCRIPT 接 TABS_SCRIPT');
  } else {
    const lines = src.split('\n');
    const hits = [];
    lines.forEach((l, i) => {
      if (/SCRIPT\}`;\s*$/.test(l)) hits.push(i);
    });
    if (hits.length !== 1) {
      console.error('');
      console.error(NO + 'page-chrome.js：以 SCRIPT}`; 结尾的行有 ' + hits.length + ' 条，应该只有 1 条');
      for (const i of hits) console.error('    ' + (i + 1) + ': ' + lines[i]);
      c = false;
    } else {
      const i = hits[0];
      lines.splice(i, 1, lines[i].replace(/`;\s*$/, '\n${TABS_SCRIPT}`;'));
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(OK + 'src/page-chrome.js — CHROME_SCRIPT 接上 TABS_SCRIPT');
      } catch (err) {
        console.error(NO + '语法不过，已还原：');
        console.error(String(err.stderr || err.message).slice(-600));
        fs.writeFileSync(file, src, 'utf8');
        c = false;
      }
    }
  }
}

console.log('');
if (a && b && c) {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('然后手机上转一圈：');
  console.log('  /chat      聊天（假输入框 + 行动卡片，点卡片弹详情）');
  console.log('  /memories  记忆（Ombre Brain 是其中一条）');
  console.log('  /home      主页（唤醒时间）');
  console.log('  /discover  发现（暂时跳动态页）');
  console.log('  /me        个人（后台、自定义）');
  console.log('');
  console.log('挂没挂上：');
  console.log('  pm2 logs vesper --lines 40 --nostream | grep -E "chat:|memories:|me:"');
} else {
  console.log('有没成的（上面打了那处的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
