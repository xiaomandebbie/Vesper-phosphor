#!/usr/bin/env node
// 把台灯页接进晨暮星。
//
// 小满 2026-10-30：「台灯你快写」
//
// 三处：
//   1. vesper.js    import
//   2. vesper.js    挂路由
//   3. discover-page.js  台灯那一格不再指 NAV_LAMP_URL，指 /lamp
//
// 第三处是要点：发现页里台灯一直置灰写着「没配 NAV_LAMP_URL」，
// 而台灯是一套 MCP 工具，根本没有网页可跳——那个变量永远填不上。
// 现在指自己做的 /lamp，条件改成 lampEnabled()（MCP 接上了就亮）。
//
// tabs.js 里的 UNDER['/discover'] 也要加 /lamp，这样在台灯页上
// 底栅亮「发现」、返回键知道该退哪里。
//
// 跑法：
//   node scripts/wire_lamp.mjs
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
  const bak = file + '.bak-lamp';
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

const VESPER = [
  {
    what: 'import registerLampRoutes',
    done: "from './lamp-page.js'",
    needle: "import { registerDiscoverRoutes } from './discover-page.js';",
    make: (line) => [line, "import { registerLampRoutes } from './lamp-page.js';"],
  },
  {
    what: '挂 /lamp',
    done: 'registerLampRoutes(app',
    needle: 'registerDiscoverRoutes(app, { requireBasicAuth });',
    make: (line, ind) => [line, ind + 'registerLampRoutes(app, { requireBasicAuth });'],
  },
];

// 发现页：台灯那一格指 /lamp。
// 原来是  href: lamp,   （lamp = externalUrl('NAV_LAMP_URL')）
const DISCOVER = [
  {
    what: 'import lampEnabled',
    done: "from './lamp-page.js'",
    needle: "import { renderTabs, TABS_CSS } from './tabs.js';",
    make: (line) => [line, "import { lampEnabled } from './lamp-page.js';"],
  },
  {
    what: '台灯指 /lamp（不再指 NAV_LAMP_URL）',
    done: "lampEnabled() ? '/lamp'",
    needle: '      href: lamp,',
    make: (line, ind) => [ind + "href: lampEnabled() ? '/lamp' : '',"],
  },
  {
    what: '台灯不再当外链',
    done: '// 台灯是站内页',
    needle: "      note: '\\u6ca1\\u914d NAV_LAMP_URL',",
    make: (line, ind) => [
      ind + "note: '\\u53f0\\u706f\\u670d\\u52a1\\u6ca1\\u8dd1\\u7740',",
      ind + '// 台灯是站内页，不走外链（2026-10-30）',
    ],
  },
];

// tabs.js：/lamp 归到「发现」下面
const TABS = [
  {
    what: '/lamp 归到发现下面',
    done: "'/lamp'",
    needle: "'/discover': ['/moments', '/diary', '/dreams', '/music', '/bar', '/drives', '/books', '/wallet'],",
    make: (line) =>
      line.replace("'/wallet'],", "'/wallet', '/lamp'],"),
  },
];

const a = patch('src/vesper.js', VESPER);
const b = a ? patch('src/discover-page.js', DISCOVER) : false;
const c = b ? patch('src/tabs.js', TABS) : false;

// 台灯那一格里那行 external: true 要抿掉——现在是站内页了。
// 它紧跟在 note 后面，单独找一下：只改台灯那一条的，论坛那条留着
let d = true;
if (c) {
  const file = path.join(ROOT, 'src/discover-page.js');
  const src = fs.readFileSync(file, 'utf8');
  const mark = '// 台灯是站内页';
  const at = src.indexOf(mark);
  if (at < 0) {
    console.log('. 找不到台灯那一格的记号，跳过 external 那行');
  } else {
    const lines = src.split('\n');
    const markLine = lines.findIndex((l) => l.includes(mark));
    // 从记号往下最多三行内找 external: true
    let hit = -1;
    for (let k = markLine; k < Math.min(lines.length, markLine + 4); k++) {
      if (lines[k].includes('external: true')) { hit = k; break; }
    }
    if (hit < 0) {
      console.log('. 台灯那一格已经没有 external: true，不用改');
    } else {
      lines.splice(hit, 1);
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(OK + 'src/discover-page.js — 抿掉台灯那行 external: true');
      } catch (err) {
        console.error(NO + '语法不过，已还原：');
        console.error(String(err.stderr || err.message).slice(-500));
        fs.writeFileSync(file, src, 'utf8');
        d = false;
      }
    }
  }
}

console.log('');
if (a && b && c && d) {
  console.log('pm2 restart vesper --update-env');
  console.log('');
  console.log('然后发现页里台灯那一格应该不置灰了，点进去是：');
  console.log('  · 灯现在开没开、多亮、多暖（那个圆点按色温发光）');
  console.log('  · 六套场景：工作 / 阅读 / 看屏 / 储光 / 暖黄 / 夜灯');
  console.log('  · 开灯、暗一档、关灯');
  console.log('  · 今夜睡前守护定了没（只显示，那是他 23:00 自己定的）');
  console.log('');
  console.log('挂没挂上：pm2 logs vesper --lines 30 --nostream | grep lamp');
} else {
  console.log('有没成的（上面打了那处的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
