#!/usr/bin/env node
// wire_dreams.mjs — 把梦境那三样东西接到 vesper 和 phosphor 上。
//
// 用法（在仓库根目录）：
//     node scripts/wire_dreams.mjs --check   # 只看六处能不能打，不动文件
//     node scripts/wire_dreams.mjs           # 真打，每个文件先备份
//
// 接三样：
//   1) 梦境页 /dreams（src/dreams-page.js）—— 挂在动态页之前
//   2) 夜梦生成（src/dreams.js）—— 挂在 phosphor 每次唤醒尾巴，不占行动
//   3) heartbeat 管理页转发 /heartbeat/（src/heartbeat-proxy.js）—— 和记忆库同理，
//      要挂在 express.json() 之前才拿得到原始请求体
//   再加两个菜单入口：梦境、heartbeat。
//
// 原文对不上就整个不改，不猜。
// 退回：把 .bak-dreams 覆回原文件再重启。

import { copyFile, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');

// ══ src/vesper.js ══

const VESPER = [
  ['引入梦境页和 heartbeat 转发',
`import { registerDiaryRoutes } from './diary-page.js';
import { registerMemoryProxy } from './memory-proxy.js';`,
`import { registerDiaryRoutes } from './diary-page.js';
import { registerDreamRoutes } from './dreams-page.js';
import { registerMemoryProxy } from './memory-proxy.js';
import { registerHeartbeatProxy } from './heartbeat-proxy.js';`],

  ['heartbeat 转发挂在 body 解析之前',
`const memoryProxy = registerMemoryProxy(app, { requireBasicAuth });
const musicProxy = registerMusicProxy(app, { requireBasicAuth });`,
`const memoryProxy = registerMemoryProxy(app, { requireBasicAuth });
const musicProxy = registerMusicProxy(app, { requireBasicAuth });
// heartbeat 管理页 /heartbeat/（见 heartbeat-proxy.js）：和记忆库同理，
// 保存配置、重启都是 POST，要原样拿到请求体，所以挂在下面的 body 解析之前
const heartbeatProxy = registerHeartbeatProxy(app, { requireBasicAuth });`],

  ['梦境页挂在动态页之前',
`const diaryPage = registerDiaryRoutes(app, { requireBasicAuth });`,
`const diaryPage = registerDiaryRoutes(app, { requireBasicAuth });
// 梦境页 /dreams（夜里做的梦，从记忆库读，见 dreams-page.js）。
// 要挂在动态页之前：动态页里有很宽的路径匹配
registerDreamRoutes(app, { requireBasicAuth });`],

  ['启动日志带上梦境和 heartbeat',
'；星星罐：/moments/star-jar`',
'；梦境：/dreams；heartbeat：${heartbeatProxy ? `转发 ${heartbeatProxy}` : '未配置'}；星星罐：/moments/star-jar`'],
];

// ══ src/phosphor.js ══

const PHOSPHOR = [
  ['引入夜梦',
`import { executeAction } from './actions/index.js';`,
`import { executeAction } from './actions/index.js';
import { maybeDream, dreamConfigSummary } from './dreams.js';`],

  ['唤醒尾巴叫一下夜梦',
`  logWake({
    kind,
    scheduledAt,`,
`  // 夜梦（见 dreams.js）：凌晨、素材够、赶上概率才做。
  // 不占行动、不影响 say，出什么错都不拖累这次唤醒的收尾。
  // 正文不进 wake_log——梦该在记忆库里自己衰减，不在这儿留存档。
  try {
    await maybeDream();
  } catch (err) {
    console.error(\`[\${kind}] maybeDream failed:\`, err.message);
  }

  logWake({
    kind,
    scheduledAt,`],

  ['启动日志带上夜梦',
'；共享时间线：${isSharedTimelineEnabled() ? '已开启' : '未开启'}',
'；${dreamConfigSummary()}；共享时间线：${isSharedTimelineEnabled() ? '已开启' : '未开启'}'],
];

// ══ src/page-chrome.js —— 菜单入口 ══

const CHROME = [
  ['菜单加梦境和 heartbeat',
`  return [
    { href: '/moments', label: '回到主页' },
    diary,`,
`  // heartbeat 管理页转发进来了就有这一项（见 heartbeat-proxy.js）
  const heartbeat = heartbeatBase()
    ? { href: '/heartbeat/admin', label: 'heartbeat' }
    : { href: '', label: 'heartbeat', note: '未配置' };
  return [
    { href: '/moments', label: '回到主页' },
    diary,
    { href: '/dreams', label: '梦境' },`],

  ['引入 heartbeatBase',
`import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';`,
`import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';
import { heartbeatBase } from './heartbeat-proxy.js';`],

  ['heartbeat 摆在记忆库后面',
`    memory,
    { href: '/moments/profile', label: '自定义' },`,
`    memory,
    heartbeat,
    { href: '/moments/profile', label: '自定义' },`],
];

async function apply(rel, patches, check) {
  const file = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch {
    return { ok: false, msgs: [`\u2717 找不到 ${rel}`] };
  }
  let out = src;
  const msgs = [];
  for (const [name, old, rep] of patches) {
    if (out.includes(rep)) {
      msgs.push(`\u00b7 ${name}（已经打过了）`);
      continue;
    }
    const hits = out.split(old).length - 1;
    if (hits === 0) {
      msgs.push(`\u2717 「${name}」对不上原文`);
      return { ok: false, msgs };
    }
    if (hits > 1) {
      msgs.push(`\u2717 「${name}」出现 ${hits} 次，不敢猜`);
      return { ok: false, msgs };
    }
    out = out.replace(old, rep);
    msgs.push(`\u00b7 ${name}`);
  }
  if (out !== src && !check) {
    await copyFile(file, `${file}.bak-dreams`);
    await writeFile(file, out, 'utf8');
  }
  return { ok: true, msgs };
}

// 先确认三个新文件到位了
for (const f of ['src/dreams.js', 'src/dreams-page.js', 'src/heartbeat-proxy.js']) {
  try {
    await access(path.join(ROOT, f));
  } catch {
    console.error(`\u2717 缺 ${f}。先 git pull 把新文件拉下来。`);
    process.exit(1);
  }
}

const check = process.argv.includes('--check');
console.log(check ? '体检模式，不动文件\n' : '开始接线，每个文件先备份\n');

let allOk = true;
for (const [rel, patches] of [
  ['src/vesper.js', VESPER],
  ['src/phosphor.js', PHOSPHOR],
  ['src/page-chrome.js', CHROME],
]) {
  const { ok, msgs } = await apply(rel, patches, check);
  console.log(`  ${rel}`);
  for (const m of msgs) console.log(`    ${m}`);
  if (!ok) {
    allOk = false;
    break;
  }
}

console.log();
if (!allOk) {
  console.log('有对不上的地方，已改的文件有 .bak-dreams 备份。');
  console.log('先看一眼现在长什么样：');
  console.log('    grep -n "registerDiaryRoutes\\|logWake({\\|回到主页" src/vesper.js src/phosphor.js src/page-chrome.js');
  process.exit(2);
}

if (check) {
  console.log('六处都能打上，去掉 --check 就真改。');
} else {
  console.log('接完了。重启两个进程：');
  console.log('    pm2 restart vesper vesper-gateway');
  console.log();
  console.log('然后：');
  console.log('  梦境页      https://你的域名/dreams（菜单里也有入口）');
  console.log('  heartbeat   https://你的域名/heartbeat/admin');
  console.log();
  console.log('夜梦要凌晨 3 点后、素材满 5 条、还要赶上 72% 的概率才做。想立刻试一个：');
  console.log('    cd /root/vesper-phosphor && node -e "await import(\'dotenv/config\');\\');
  console.log('    process.env.DREAM_AFTER_HOUR=\'0\'; process.env.DREAM_UNTIL_HOUR=\'24\';\\');
  console.log('    process.env.DREAM_CHANCE=\'1\'; process.env.DREAM_MIN_MATERIAL=\'1\';\\');
  console.log('    const {connectAll}=await import(\'./src/mcp-manager.js\'); await connectAll();\\');
  console.log('    const {maybeDream}=await import(\'./src/dreams.js\');\\');
  console.log('    console.log(await maybeDream());" --input-type=module');
  console.log();
  console.log('要调节做梦的节律，.env 里加（都有默认值，不填也能跑）：');
  console.log('    DREAM_AFTER_HOUR=3        凌晨几点后开始可能做梦');
  console.log('    DREAM_UNTIL_HOUR=9        到几点为止');
  console.log('    DREAM_CHANCE=0.72         素材够时做梦的概率');
  console.log('    DREAM_MAX_PER_NIGHT=3     一晚最多几个（连环梦）');
  console.log('    DREAM_MIN_MATERIAL=5      最近两天至少有几条没消化完的');
  console.log();
  console.log('退回：cp src/vesper.js.bak-dreams src/vesper.js \\');
  console.log('      && cp src/phosphor.js.bak-dreams src/phosphor.js \\');
  console.log('      && cp src/page-chrome.js.bak-dreams src/page-chrome.js && pm2 restart vesper');
}
