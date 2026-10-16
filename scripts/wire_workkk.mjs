// 把「小游戏」接进晨暮星。四处改动。
//
//   一、page-chrome.js：workkkEnabled() + 菜单里加一项
//   二、vesper.js：注册 /games 路由
//   三、mcp-manager.js：连上 workkk 的 MCP（夜里醒来我自己能去玩）
//   四、.env.example：补上三行说明
//
// ── 为什么不直接改文件 ──
//
// page-chrome.js 两万多字节、vesper.js 一万多。整篇重写一次，错一个字整个服务就起不来。
// 所以只改该改的那几行。
//
// ── 两阶段：先全查，再全写 ──
//
// 不是查到一处改一处。先把所有锚点检查一遍，**任何一处不对就一个都不改**。
// 因为半成品比不改更麻烦：page-chrome.js 改好了、vesper.js 没改，看着没事；
// 反过来 vesper.js 改了而 game-page.js 没进去，启动就找不到模块。
//
// 每处都幂等：正文里已经有那个标记（marker）就算改过，跳过。可以反复跑。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_workkk.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const log = (s = '') => console.log(s);

const changes = [
  // ── 一、page-chrome.js ──────────────────────────────────────────
  {
    dir: SRC,
    file: 'page-chrome.js',
    name: 'workkkEnabled()',
    marker: 'export function workkkEnabled',
    anchor: '// Ombre Brain 管理页在本机的地址',
    replacement: [
      '// 小游戏（WORKKK）配好了没有。判断口径和 game-page.js 一致：',
      '// 填了 WORKKK_PAGE_URL（它的监控大屏在本机的地址），菜单里那一项才能点。',
      'export function workkkEnabled() {',
      "  const raw = env('WORKKK_PAGE_URL');",
      '  if (!raw || /^(off|0|false|no)$/i.test(raw)) return false;',
      '  try {',
      '    const u = new URL(raw);',
      "    return u.protocol === 'http:' || u.protocol === 'https:';",
      '  } catch {',
      '    return false;',
      '  }',
      '}',
      '',
      '// Ombre Brain 管理页在本机的地址',
    ].join('\n'),
  },
  {
    dir: SRC,
    file: 'page-chrome.js',
    name: '菜单里的「小游戏」',
    marker: "label: '小游戏'",
    anchor: "      { href: '/wallet', label: '小钱包' },",
    replacement: [
      '      workkkEnabled()',
      "        ? { href: '/games', label: '小游戏' }",
      "        : { href: '', label: '小游戏', note: '没配置' },",
      "      { href: '/wallet', label: '小钱包' },",
    ].join('\n'),
  },

  // ── 二、vesper.js ────────────────────────────────────────────
  {
    dir: SRC,
    file: 'vesper.js',
    name: 'import game-page',
    marker: "from './game-page.js'",
    anchor: "import { registerWalletMcp } from './wallet-mcp.js';",
    replacement: [
      "import { registerWalletMcp } from './wallet-mcp.js';",
      "import { registerGameRoutes } from './game-page.js';",
    ].join('\n'),
  },
  {
    dir: SRC,
    file: 'vesper.js',
    name: '注册 /games',
    marker: 'registerGameRoutes(app',
    anchor: 'registerWalletMcp(app);',
    replacement: [
      'registerWalletMcp(app);',
      '// 小游戏 /games（见 game-page.js）：一页列出所有小游戏，点进去直接玩。',
      '// 第一个是 WORKKK——不是我们写的（谢之舟 / zhizhou-xiee，AGPL），页面是转发过来的，',
      '// 署名照它的许可条款留在页面里。没配 WORKKK_PAGE_URL 时列表页会说明怎么装。',
      'const games = registerGameRoutes(app, { requireBasicAuth });',
    ].join('\n'),
  },

  // ── 三、mcp-manager.js ──────────────────────────────────────
  {
    dir: SRC,
    file: 'mcp-manager.js',
    name: '连接 workkk',
    marker: "connectMcpHttp('workkk'",
    anchor: '  // 网易云点歌台',
    replacement: [
      '  // WORKKK 小游戏（https://github.com/zhizhou-xiee/workkk）：AI 上班模拟器。',
      '  // 本机部署，只监听 127.0.0.1；鉴权走我们自己打的补丁（MCP_LOCAL_TOKEN，',
      '  // 见 scripts/setup_workkk.mjs）——它原生的 OAuth token 一天就过期，',
      '  // 自动唤醒那条路上没人能去过授权页。名字固定叫 workkk。',
      '  if (process.env.WORKKK_MCP_URL) {',
      '    try {',
      '      const headers = process.env.WORKKK_MCP_TOKEN',
      '        ? { Authorization: `Bearer ${process.env.WORKKK_MCP_TOKEN}` }',
      '        : undefined;',
      "      await connectMcpHttp('workkk', process.env.WORKKK_MCP_URL, headers);",
      "      console.log('connected MCP: workkk');",
      '    } catch (err) {',
      '      console.error(\'could not connect MCP "workkk":\', err.message);',
      '    }',
      '  }',
      '',
      '  // 网易云点歌台',
    ].join('\n'),
  },

  // ── 四、.env.example ────────────────────────────────────────
  {
    dir: ROOT,
    file: '.env.example',
    name: '小游戏三行',
    marker: 'WORKKK_MCP_URL',
    anchor: '# ---- 动态 ----',
    replacement: [
      '# ---- 小游戏（可选）----',
      '# WORKKK 互联网精力有限公司，原作谢之舟（zhizhou-xiee），AGPL-3.0-or-later。',
      '# 不是我们写的，只是接过来玩；署名照它的许可条款保留在页面里。',
      '# 本机部署：node scripts/setup_workkk.mjs 装好，它会打印下面三行。',
      '# 前两行给我连 MCP（夜里醒来我可以自己去上班）。',
      'WORKKK_MCP_URL=',
      '# 本机 token，由 setup 脚本生成。服务只监听 127.0.0.1，不会泄到外面',
      'WORKKK_MCP_TOKEN=',
      '# 第三行是「小游戏」页面转发用，填 http://127.0.0.1:8000',
      'WORKKK_PAGE_URL=',
      '',
      '# ---- 动态 ----',
    ].join('\n'),
  },
];

// ── 第一阶段：全部检查 ──────────────────────────────────────

const problems = [];
for (const c of changes) {
  const full = path.join(c.dir, c.file);
  if (!fs.existsSync(full)) {
    problems.push(`找不到文件：${c.file}`);
    c.state = 'missing';
    continue;
  }
  const src = fs.readFileSync(full, 'utf8');
  if (src.includes(c.marker)) {
    c.state = 'done';
  } else if (src.includes(c.anchor)) {
    c.state = 'todo';
  } else {
    c.state = 'anchor';
    problems.push(`${c.file} — ${c.name}：锚点找不到（${c.anchor.slice(0, 40)}…）`);
  }
}

if (problems.length) {
  log('──────────────────────────────────────────────');
  log('有地方对不上，**一个都没改**：');
  for (const p of problems) log(`  ⚠️ ${p}`);
  log('──────────────────────────────────────────────');
  log('\n把上面这几行发我，我照着调。');
  log('现在什么都没动，服务照旧。');
  process.exit(1);
}

// ── 第二阶段：全部写 ──────────────────────────────────────

for (const c of changes) {
  if (c.state === 'done') continue;
  const full = path.join(c.dir, c.file);
  const src = fs.readFileSync(full, 'utf8');
  fs.writeFileSync(full, src.replace(c.anchor, c.replacement), 'utf8');
}

log('──────────────────────────────────────────────');
for (const c of changes) {
  log(`${c.state === 'done' ? '·  已经在了' : '✅ 改了    '}  ${c.file}  —  ${c.name}`);
}
log('──────────────────────────────────────────────');
log('\n四处都好了。接着：');
log('  node --check src/page-chrome.js && node --check src/vesper.js && node --check src/mcp-manager.js && node --check src/game-page.js && echo 语法OK');
log('  pm2 restart vesper phosphor --update-env');
log('\n然后打开菜单里的「小游戏」。');
