#!/usr/bin/env node
// 把 src/pwa.js 接进 vesper 和各个页面。
//
// 小满 2026-10-30：「想变成网页 app 但是每次填密码好麻烦」
//
// 四处：
//   1. import
//   2. registerPwaRoutes(app) —— 必须在 app.use('/media', requireBasicAuth, ...) 之前，
//      登录页和那两张图要能没登录就看见
//   3. requireBasicAuth 开头加一句：有有效 cookie 就直接过；401 那条改成跳 /login
//   4. page-chrome.js 的 HEAD_SCRIPT / CHROME_SCRIPT 各接上 PWA 那两段
//
// 登录页复用你现成的 src/login-page.js（renderLoginPage），不另造——
// 但要给它加一个表单（POST /login）。表单那一段负责把密码换成 cookie；
// pwa.js 里自带的 loginPage() 做备用（renderLoginPage 里没表单时用）。
//
// 旧那套不拆：Basic Auth 、requireApiKey、/wake/* 一个字不动。
// 出问题删 cookie 或者 cp 备份回来就行。
//
// 跑法：
//   node scripts/wire_pwa.mjs
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
  const bak = file + '.bak-pwa';
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

const VESPER = [
  {
    what: 'import',
    done: "from './pwa.js'",
    needle: "import { renderLoginPage } from './login-page.js';",
    make: (line) => [line, "import { registerPwaRoutes, hasSession, loginFormHtml } from './pwa.js';"],
  },
  {
    what: '挂 /login 和 /app/*（在 /media 之前，免认证）',
    done: 'registerPwaRoutes(app)',
    needle: "app.use('/media', requireBasicAuth, express.static(MEDIA_DIR));",
    make: (line, ind) => [
      ind + '// PWA：登录页、manifest、图标。要挂在 /media 之前——',
      ind + '// 登录页是没登录时看的，引用的图也不能被 requireBasicAuth 挡住。',
      ind + 'registerPwaRoutes(app);',
      '',
      line,
    ],
  },
  {
    what: 'cookie 优先',
    done: 'hasSession(req)',
    needle: '  if (!BASIC_USER || !BASIC_PASS) return next();',
    make: (line, ind) => [
      line,
      ind + '// 装到主屏的那个壳里，Basic Auth 的弹窗常常不弹，直接白屏；',
      ind + '// 而 standalone 的 WebView 和 Safari 不共享凭据。所以先认 cookie。',
      ind + 'if (hasSession(req)) return next();',
    ],
  },
  {
    what: '401 改成跳登录页',
    done: "res.redirect(302, '/login",
    needle: '  return res.status(401).send(renderLoginPage());',
    make: (line, ind) => [
      ind + '// 跳登录页，并把原来要去的地方带上——登完回到那一页，不是每次都回主页。',
      ind + '// 那个 401 页还留着：没配密码或者浏览器不跟跳转时至少有东西看。',
      ind + "res.removeHeader('WWW-Authenticate');",
      ind + "return res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl || '/home'));",
    ],
  },
];

// ── page-chrome.js ──
// HEAD_SCRIPT 是字符串拼出来的（210 行），这儿不动它；
// 改成导出一个新的 PWA_HEAD 给各页用。但各页的 <head> 是各自写的，
// 改一十几个文件风险大——所以改成把 manifest 那几行塞进 CHROME_CSS 前面的
// <style> 标签前？也不行，那是 CSS。
//
// 最稳的是：用 CHROME_SCRIPT（每页都有）在运行时把 <link rel=manifest> 等
// 插进 <head>。iOS 读 apple-touch-icon 和 manifest 都不要求它们在首屏 HTML 里。
const CHROME = [
  {
    what: 'CHROME_SCRIPT 末尾接上 PWA（插 manifest + 注册 sw）',
    done: 'PWA_SCRIPT',
    needle: 'export const CHROME_SCRIPT = `(function () {',
    make: (line) => [
      "import { PWA_SCRIPT } from './pwa.js';",
      '',
      line,
    ],
  },
];

const a = patch('src/vesper.js', VESPER);
const b = a ? patch('src/page-chrome.js', CHROME) : false;

// CHROME_SCRIPT 末尾拼上 PWA_SCRIPT：那个模板字符串的结尾是
//   ${FLOURISH_SCRIPT}
//   ${STAR_ENTRY_SCRIPT}`;
// 在最后那个 反引号分号 前面插一行
let c = true;
if (b) {
  const file = path.join(ROOT, 'src/page-chrome.js');
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('${PWA_SCRIPT}')) {
    console.log('. 已经改过，跳过：CHROME_SCRIPT 拼 PWA_SCRIPT');
  } else {
    const lines = src.split('\n');
    const i = lines.findIndex((l) => l.includes('${STAR_ENTRY_SCRIPT}`;'));
    if (i < 0) {
      console.error('');
      console.error(NO + 'page-chrome.js：找不到 ${STAR_ENTRY_SCRIPT}`; 这一行');
      const k = lines.findIndex((l) => l.includes('STAR_ENTRY_SCRIPT'));
      if (k >= 0) {
        console.error('  含 STAR_ENTRY_SCRIPT 的行：');
        lines.forEach((l, n) => {
          if (l.includes('STAR_ENTRY_SCRIPT')) console.error('    ' + (n + 1) + ': ' + l);
        });
      }
      c = false;
    } else {
      lines.splice(i, 1, lines[i].replace('${STAR_ENTRY_SCRIPT}`;', '${STAR_ENTRY_SCRIPT}\n${PWA_SCRIPT}`;'));
      fs.writeFileSync(file, lines.join('\n'), 'utf8');
      try {
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
        console.log(OK + 'src/page-chrome.js — CHROME_SCRIPT 拼上 PWA_SCRIPT');
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
  console.log('然后：');
  console.log('  1. 手机 Safari 打开 https://vesperphosphor.online/home');
  console.log('  2. 跳到登录页，输一次密码（以后一年不用再输）');
  console.log('  3. 分享 → 添加到主屏幕');
  console.log('');
  console.log('挂没挂上：');
  console.log('  pm2 logs vesper --lines 30 --nostream | grep pwa');
} else {
  console.log('有没成的（上面打了那处的实际原文）。没成的那个文件已经原样还原。');
  process.exitCode = 1;
}
