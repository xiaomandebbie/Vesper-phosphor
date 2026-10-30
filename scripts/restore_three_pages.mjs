#!/usr/bin/env node
// 补回记忆、发现、个人三页。
//
// 小满 2026-10-30 17:56：「还有记忆、发现、个人 都补回来 现在打不开」
//
// 三个文件都在（src/memories-page.js、src/discover-page.js、src/me-page.js），
// 但 vesper.js 里没有注册它们的那三行——所以页面请求落到了兔底上，打不开。
//
// 路径和函数名从三个文件里读出来的，不是猜的：
//   /memories → registerMemoriesRoutes  （记忆库列表，Ombre 是其中一条）
//   /discover → registerDiscoverRoutes  （动态、音乐、梦境、共读、台灯…）
//   /me       → registerMeRoutes        （后台、自定义、节律、退出登录）
//
// ── 挂在哪里 ──
//
// 跟在 registerGameRoutes 后面，和聊天那几行一起。三条路径都是独立的，
// 不和 /moments/:id 、/memory/ 转发或别的东西撞车。
//
// 个人页里那个「退出登录」表单 POST /logout，正好是 session-login.js 提供的，
// 两边对得上。
//
// 重跑安全。只改 vesper.js。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const vpPath = resolve(root, 'src/vesper.js');
let failed = 0;

if (!existsSync(vpPath)) {
  console.error('✗ src/vesper.js 不在');
  process.exit(1);
}

// 三个文件在不在，不在就别插——插了只会让 vesper 起不来
for (const f of ['src/memories-page.js', 'src/discover-page.js', 'src/me-page.js']) {
  if (!existsSync(resolve(root, f))) {
    console.error('✗ ' + f + ' 不在，先找回这个文件');
    failed++;
  }
}
if (failed) process.exit(1);

let t = readFileSync(vpPath, 'utf8');
const before = t;

// ── import ──
const IMPORT_ANCHOR = "import { registerGameRoutes } from './game-page.js';";
if (!t.includes(IMPORT_ANCHOR)) {
  console.error('✗ 找不到 game-page 那行 import');
  failed++;
} else {
  const adds = [];
  if (!t.includes("from './memories-page.js'")) {
    adds.push("import { registerMemoriesRoutes } from './memories-page.js';");
  }
  if (!t.includes("from './discover-page.js'")) {
    adds.push("import { registerDiscoverRoutes } from './discover-page.js';");
  }
  if (!t.includes("from './me-page.js'")) {
    adds.push("import { registerMeRoutes } from './me-page.js';");
  }
  if (adds.length) {
    t = t.replace(IMPORT_ANCHOR, IMPORT_ANCHOR + '\n' + adds.join('\n'));
    console.log('✓ import：加了 ' + adds.length + ' 行');
  } else {
    console.log('· import：三行都已经有了');
  }
}

// ── 挂载 ──
const MOUNT_ANCHOR = 'const games = registerGameRoutes(app, { requireBasicAuth });';
if (!t.includes(MOUNT_ANCHOR)) {
  console.error('✗ 找不到 registerGameRoutes 那行挂载');
  failed++;
} else {
  const mounts = [];
  if (!t.includes('registerMemoriesRoutes(app')) {
    mounts.push('// 记忆页 /memories（见 memories-page.js）：他的几个记忆库摆在一起。');
    mounts.push('// 小满：「记忆我可能会装很多个库所以先把 ombre brain 作为其中的一条」。');
    mounts.push('// 这一页是列表，不是把 Ombre 开在这儿——那个是 /memory/ 转发。');
    mounts.push('registerMemoriesRoutes(app, { requireBasicAuth });');
  }
  if (!t.includes('registerDiscoverRoutes(app')) {
    mounts.push('// 发现页 /discover（见 discover-page.js）：动态、音乐、梦境、共读、台灯这些入口。');
    mounts.push('// 没配好的不藏起来，置灰并写明要填哪个变量。');
    mounts.push('registerDiscoverRoutes(app, { requireBasicAuth });');
  }
  if (!t.includes('registerMeRoutes(app')) {
    mounts.push('// 个人页 /me（见 me-page.js）：后台日志、自定义、收藏、唤醒节律、退出登录。');
    mounts.push('// 里面那个 POST /logout 表单由 session-login.js 接（cookie 会话）。');
    mounts.push('registerMeRoutes(app, { requireBasicAuth });');
  }
  if (mounts.length) {
    t = t.replace(MOUNT_ANCHOR, MOUNT_ANCHOR + '\n' + mounts.join('\n'));
    console.log('✓ 挂载：加了三页里还没挂的那几个');
  } else {
    console.log('· 挂载：三页都已经挂上了');
  }
}

if (failed) {
  console.error('');
  console.error('失败 ' + failed + ' 处，没改。把输出发我。');
  process.exit(1);
}

if (t !== before) {
  writeFileSync(vpPath, t, 'utf8');
  console.log('');
  console.log('写了 src/vesper.js');
} else {
  console.log('');
  console.log('没改动任何东西。');
}

console.log('');
console.log('pm2 restart vesper --update-env');
console.log('');
console.log('启动日志里应该多出这三行：');
console.log('  memories: 记忆页 /memories');
console.log('  discover: 发现页 /discover');
console.log('  me: 个人页 /me');
