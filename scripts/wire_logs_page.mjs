#!/usr/bin/env node
// 把后台日志页（src/logs-page.js）接进 vesper 和右上角菜单。
//
// 两处：
//   src/vesper.js      import + 挂载 /logs
//   src/page-chrome.js 菜单里加一项「后台日志」（排在小钱包后面）
//
// 这两个文件服务器上跟仓库可能有分叉，所以锚点用正则、缩进照抄原行，
// 匹配不到或匹配到多处就整个文件原样还原并打出周围实际原文，不乱改。
//
// 日志页是网页，跑在 vesper 里：
//   node scripts/wire_logs_page.mjs
//   pm2 restart vesper --update-env
//
// 然后浏览器打开 /logs（走和其他页一样的 VESPER_BASIC_USER / PASS）。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const OK = '\u2713 ';
const NO = '\u2717 ';

function patch(rel, edits) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(NO + rel + ' 找不到');
    return false;
  }
  const bak = file + '.bak-logspage';
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);

  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  let changed = 0;

  for (const e of edits) {
    if (src.includes(e.done)) {
      console.log('. 已经改过，跳过：' + e.what);
      continue;
    }
    const hits = src.match(new RegExp(e.regex.source, 'gm')) || [];
    if (hits.length !== 1) {
      console.error('');
      console.error(NO + rel + ' — ' + e.what + '：锚点命中 ' + hits.length + ' 处，应该只有 1 处。整个文件不改。');
      console.error('  我找的是：' + e.regex.source);
      for (const h of hits) console.error('    命中：' + h);
      const lines = before.split('\n');
      const i = lines.findIndex((l) => l.includes(e.probe));
      if (i >= 0) {
        console.error('');
        console.error('  ' + rel + ' 第 ' + (i + 1) + ' 行附近实际是：');
        for (let k = Math.max(0, i - 3); k < Math.min(lines.length, i + 9); k++) {
          console.error('    ' + (k + 1) + ': ' + lines[k]);
        }
      } else {
        console.error('  （连「' + e.probe + '」都没找到）');
      }
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    src = src.replace(new RegExp(e.regex.source, 'm'), e.replacement);
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

// ── vesper.js ──
// 跟在心绪页后面：那两行的形状和这两行一模一样，所以拿它做锚点最稳
const VESPER = [
  {
    what: 'import registerLogRoutes',
    done: 'logs-page.js',
    regex: /^import \{ registerDrivesRoutes \} from '\.\/drives-page\.js';$/,
    replacement: (m) => m + "\nimport { registerLogRoutes } from './logs-page.js';",
    probe: 'drives-page.js',
  },
  {
    what: '挂载 /logs',
    done: 'registerLogRoutes(app',
    regex: /^([ \t]*)registerDrivesRoutes\(app, \{ requireBasicAuth \}\);$/,
    replacement: (m, indent) => m + '\n' + indent + 'registerLogRoutes(app, { requireBasicAuth });',
    probe: 'registerDrivesRoutes(app',
  },
];

// ── page-chrome.js ──
// 菜单中间那段（可以滑的）排在小钱包后面
const CHROME = [
  {
    what: '菜单里加「后台日志」',
    done: "label: '后台日志'",
    regex: /^([ \t]*)\{ href: '\/wallet', label: '小钱包' \},$/,
    replacement: (m, indent) => m + '\n' + indent + "{ href: '/logs', label: '后台日志' },",
    probe: "label: '小钱包'",
  },
];

const a = patch('src/vesper.js', VESPER);
const b = patch('src/page-chrome.js', CHROME);

console.log('');
if (a && b) {
  console.log('接着：pm2 restart vesper --update-env');
  console.log('然后看一眼挂没挂上：');
  console.log('  pm2 logs vesper --lines 30 --nostream | grep 后台日志');
  console.log('打开 /logs。进程牌子在标题下面，点哪个看哪个。');
} else {
  console.log('有没成的（上面打了那处的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
