#!/usr/bin/env node
// 补回台灯转发。
//
// 小满 2026-10-30 21:05：「台灯页面又点不进去了」
//
// 是 404 不是 401——curl 带着晨暮星的凭据打 127.0.0.1:3001/lamp 回 404，
// 而 grep light-proxy vesper.js 是空输出。所以路由根本没挂：
// 那两行只存在服务器本地，被 git pull 的合并冲掉了——
// 和之前发现页、个人页丢失同一个原因。
//
// light-proxy.js 本身好着（它不在仓库里，是本地文件，所以没被冲）：
//   28:  const PREFIX = '/lamp'
//   141: export function registerLightProxy(app, { requireBasicAuth })
//
// ── 挂在哪里 ──
//
// 跟在记忆库、音乐转发后面——和它们同一类：都是把别人的页面转发过来，
// 要拿到原始请求体，所以必须在 express.json() 之前。
//
// 重跑安全。只改 vesper.js。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(join(srcDir, 'light-proxy.js'))) {
  console.error('✗ src/light-proxy.js 不在，先找回那个文件');
  process.exit(1);
}

const p = join(srcDir, 'vesper.js');
if (!existsSync(p)) {
  console.error('✗ src/vesper.js 不在');
  process.exit(1);
}

let t = readFileSync(p, 'utf8');
const before = t;

// ── import ──
const MUSIC_IMPORT = "import { registerMusicProxy } from './music-proxy.js';";
if (t.includes("from './light-proxy.js'")) {
  console.log('· import：已经有了');
} else if (t.includes(MUSIC_IMPORT)) {
  t = t.replace(MUSIC_IMPORT, L(
    MUSIC_IMPORT,
    "import { registerLightProxy } from './light-proxy.js';"
  ));
  console.log('✓ import registerLightProxy');
} else {
  console.error('✗ 找不到 music-proxy 那行 import');
  failed++;
}

// ── 挂载：跟在音乐转发后面 ──
const MUSIC_MOUNT = 'const musicProxy = registerMusicProxy(app, { requireBasicAuth });';
if (t.includes('registerLightProxy(app')) {
  console.log('· 挂载：已经有了');
} else if (t.includes(MUSIC_MOUNT)) {
  t = t.replace(MUSIC_MOUNT, L(
    MUSIC_MOUNT,
    '// 台灯页 /lamp（见 light-proxy.js）：把本机 3003 那个台灯服务的页面转发过来。',
    '// 和记忆库、音乐同一类，所以挂在同一位置：要拿到原始请求体，',
    '// 必须在下面的 express.json() 之前。',
    '//',
    '// 2026-10-30：这行被 git pull 的合并冲掉过一次，表现是 /lamp 返回 404。',
    '// 发现页、个人页当时也是同一个原因丢的。',
    'const lightProxy = registerLightProxy(app, { requireBasicAuth });'
  ));
  console.log('✓ 挂载 registerLightProxy');
} else {
  console.error('✗ 找不到 registerMusicProxy 那行挂载');
  failed++;
}

if (failed) {
  console.error('');
  console.error('失败 ' + failed + ' 处，没改。把这条的输出发我：');
  console.error("  grep -n 'registerMusicProxy\\|registerMemoryProxy\\|express.json' src/vesper.js");
  process.exit(1);
}

if (t !== before) {
  writeFileSync(p, t, 'utf8');
  console.log('');
  console.log('写了 src/vesper.js');
}

console.log('');
console.log('pm2 restart vesper --update-env');
console.log('');
console.log('验：curl -s -o /dev/null -w "%{http_code}\\n" -H "Accept: text/html" http://127.0.0.1:3001/lamp');
console.log('期望 302（没带 cookie 被登录层拦）或 200，不再是 404。');
