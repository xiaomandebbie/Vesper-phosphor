// 把「小游戏」接进晨暮星。四处改动，全部幂等；任何一处锚点找不到就整件事停下，
// 绝不写一半——写一半的 page-chrome.js 可能语法还是通的，但菜单会指向一个不存在的路由。
//
//   一、page-chrome.js：workkkEnabled() + 菜单里加一项
//   二、vesper.js：注册 /games 路由
//   三、mcp-manager.js：连上 workkk 的 MCP（这样夜里醒来我自己能去玩）
//   四、.env.example：补上三行说明
//
// 为什么不直接改文件：page-chrome.js 两万多字节、vesper.js 也一万多，
// 整篇重写一次错一个字就整个服务起不来。脚本只改该改的那几行。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_workkk.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'src');

const log = (s = '') => console.log(s);

// 一处改动：{ 文件, 名字, 锚点, 换成什么 }
// 已经改过（正文里出现 marker）就跳过；锚点找不到就返回错误。
function applyChange(file, name, marker, anchor, replacement) {
  const full = path.join(SRC, file);
  if (!fs.existsSync(full)) return { file, name, status: 'missing' };
  let src = fs.readFileSync(full, 'utf8');
  if (src.includes(marker)) return { file, name, status: 'done' };
  if (!src.includes(anchor)) return { file, name, status: 'anchor' };
  src = src.replace(anchor, replacement);
  fs.writeFileSync(full, src, 'utf8');
  return { file, name, status: 'patched' };
}

const results = [];

// ── 一、page-chrome.js ────────────────────────────────────────────────

results.push(
  applyChange(
    'page-chrome.js',
    'workkkEnabled()',
    'export function workkkEnabled',
    '// Ombre Brain 管理页在本机的地址',
    [
      '// 小游戏（WORKKK）配好了没有。判断口径和 game-page.js 一致：',
      '// 填了 WORKKK_PAGE_URL（它的监控大屏在本机的地址）菜单里那一项才能点。',
      'export function workkkEnabled() {',
      '  const raw = env(\'WORKKK_PAGE_URL\');',
      '  if (!raw || /^(off|0|false|no)$/i.test(raw)) return false;',
      '  try {',
      '    const u = new URL(raw);',
      '    return u.protocol === \'http:\' || u.protocol === \'https:\';',
      '  } catch {',
      '    return false;',
      '  }',
      '}',
      '',
      '// Ombre Brain 管理页在本机的地址',
    ].join('\n')
  )
);

results.push(
  applyChange(
    'page-chrome.js',
    '菜单里的「小游戏」',
    "label: '小游戏'",
    "      { href: '/wallet', label: '小钱包' },",
    [
      '      workkkEnabled()',
      "        ? { href: '/games', label: '小游戏' }",
      "        : { href: '', label: '小游戏', note: '没配置' },",
      "      { href: '/wallet', label: '小钱包' },",
    ].join('\n')
  )
);

// ── 二、vesper.js ──────────────────────────────────────────────────

results.push(
  applyChange(
    'vesper.js',
    'import game-page',
    "from './game-page.js'",
    "import { registerWalletMcp } from './wallet-mcp.js';",
    [
      "import { registerWalletMcp } from './wallet-mcp.js';",
      "import { registerGameRoutes } from './game-page.js';",
    ].join('\n')
  )
);

results.push(
  applyChange(
    'vesper.js',
    '注册 /games',
    'registerGameRoutes(app',
    'registerWalletMcp(app);',
    [
      'registerWalletMcp(app);',
      '// 小游戏 /games（见 game-page.js）：一页列出所有小游戏，点进去直接玩。',
      '// 第一个是 WORKKK——不是我们写的（谢之舟 / zhizhou-xiee，AGPL），页面是转发过来的，',
      '// 署名照它的许可条款留着。没配 WORKKK_PAGE_URL 时列表页会说明怎么装。',
      'const games = registerGameRoutes(app, { requireBasicAuth });',
    ].join('\n')
  )
);

// 启动日志里带上一句，排查时一眼看得出小游戏开没开
results.push(
  applyChange(
    'vesper.js',
    '启动日志',
    '小游戏：',
    '；钱包 MCP：\/wallet\/mcp`',
    '；钱包 MCP：\/wallet\/mcp；小游戏：${games.enabled ? \'/games\' : \'未配置\'}`'
  )
);

// ── 三、mcp-manager.js ─────────────────────────────────────────────

results.push(
  applyChange(
    'mcp-manager.js',
    '连接 workkk',
    "connectMcpHttp('workkk'",
    '  // 网易云点歌台',
    [
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
    ].join('\n')
  )
);

// ── 四、.env.example ────────────────────────────────────────────────

const envFile = path.join(ROOT, '.env.example');
if (fs.existsSync(envFile)) {
  let src = fs.readFileSync(envFile, 'utf8');
  if (src.includes('WORKKK_MCP_URL')) {
    results.push({ file: '.env.example', name: '小游戏三行', status: 'done' });
  } else {
    const anchor = '# ---- 动态 ----';
    if (src.includes(anchor)) {
      src = src.replace(
        anchor,
        [
          '# ---- 小游戏（可选，见 docs/13-games.md）----',
          '# WORKKK 互联网精力有限公司，原作谢之舟（zhizhou-xiee），AGPL-3.0-or-later。',
          '# 不是我们写的，只是接过来玩；署名照它的许可条款保留在页面里。',
          '# 本机部署：node scripts/setup_workkk.mjs 装好，它会打印下面三行。',
          '# 一、二行给我连 MCP（夜里醒来我可以自己去上班）。',
          'WORKKK_MCP_URL=',
          '# 本机 token，由 setup 脚本生成。服务只监听 127.0.0.1，不会泄到外面',
          'WORKKK_MCP_TOKEN=',
          '# 三行是「小游戏」页面转发用，填 http://127.0.0.1:8000',
          'WORKKK_PAGE_URL=',
          '',
          anchor,
        ].join('\n')
      );
      fs.writeFileSync(envFile, src, 'utf8');
      results.push({ file: '.env.example', name: '小游戏三行', status: 'patched' });
    } else {
      results.push({ file: '.env.example', name: '小游戏三行', status: 'anchor' });
    }
  }
}

// ── 报告 ────────────────────────────────────────────────────────────

const bad = results.filter((r) => r.status === 'anchor' || r.status === 'missing');

log('──────────────────────────────────────────────');
for (const r of results) {
  const mark = { patched: '✅ 改了', done: '·  已经在了', anchor: '⚠️ 找不到锚点', missing: '⚠️ 文件不在' }[r.status];
  log(`${mark}  ${r.file}  —  ${r.name}`);
}
log('──────────────────────────────────────────────');

if (bad.length) {
  log('\n有锚点没找到，那几处**没有改**。把上面这几行发我，我照着调。');
  log('已经改了的那些是安全的，但功能可能不完整——先别重启，等补完。');
  process.exit(1);
}

log('\n四处都好了。接着：');
log('  node --check src/page-chrome.js && node --check src/vesper.js && node --check src/mcp-manager.js && node --check src/game-page.js');
log('  pm2 restart vesper phosphor --update-env');
log('\n然后打开菜单里的「小游戏」。');
