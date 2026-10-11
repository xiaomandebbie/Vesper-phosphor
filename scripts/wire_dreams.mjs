#!/usr/bin/env node
// wire_dreams.mjs — 把梦境那几样东西接到 vesper 和 phosphor 上。
//
// 用法（在仓库根目录）：
//     node scripts/wire_dreams.mjs --check   # 只看能不能打，不动文件
//     node scripts/wire_dreams.mjs           # 真打，每个文件先备份
//
// 接四样：
//   1) 梦境页 /dreams（src/dreams-page.js）—— 挂在动态页之前
//   2) 夜梦生成（src/dreams.js）—— 挂在每次唤醒尾巴，不占行动
//   3) 梦的浮现—— 挂在做决定**之前**：触发词碎到了就把正文注入这一次的上下文。
//      顺序写死：注入 → LLM 调用成功返回 → 才标记撔掉。调用失败不算，梦还在。
//   4) heartbeat 管理页转发 /heartbeat/—— 和记忆库同理，要挂在 express.json() 之前
//   再加两个菜单入口：梦境、heartbeat。
//
// 写这个脚本踩过的坑（2026-10-11）：补丁文本本来用反引号模板装着，
// 而要生成的代码里也有反引号，嵌在一起把外层提前关掉了——SyntaxError。
// 现在补丁文本全用单/双引号，生成的代码用字符串拼接，不再出现嵌套。
//
// 原文对不上就整个不改，不猜。退回：把 .bak-dreams 覆回原文件再重启。

import { copyFile, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const L = (...lines) => lines.join('\n');

// ══ src/vesper.js ══

const VESPER = [
  ['引入梦境页和 heartbeat 转发',
    L("import { registerDiaryRoutes } from './diary-page.js';",
      "import { registerMemoryProxy } from './memory-proxy.js';"),
    L("import { registerDiaryRoutes } from './diary-page.js';",
      "import { registerDreamRoutes } from './dreams-page.js';",
      "import { registerMemoryProxy } from './memory-proxy.js';",
      "import { registerHeartbeatProxy } from './heartbeat-proxy.js';")],

  ['heartbeat 转发挂在 body 解析之前',
    L('const memoryProxy = registerMemoryProxy(app, { requireBasicAuth });',
      'const musicProxy = registerMusicProxy(app, { requireBasicAuth });'),
    L('const memoryProxy = registerMemoryProxy(app, { requireBasicAuth });',
      'const musicProxy = registerMusicProxy(app, { requireBasicAuth });',
      '// heartbeat 管理页 /heartbeat/（见 heartbeat-proxy.js）：和记忆库同理，',
      '// 保存配置、重启都是 POST，要原样拿到请求体，所以挂在下面的 body 解析之前',
      'const heartbeatProxy = registerHeartbeatProxy(app, { requireBasicAuth });')],

  ['梦境页挂在动态页之前',
    'const diaryPage = registerDiaryRoutes(app, { requireBasicAuth });',
    L('const diaryPage = registerDiaryRoutes(app, { requireBasicAuth });',
      '// 梦境页 /dreams（夜里做的梦，正文存在 vesper 自己这边，见 dreams-page.js）。',
      '// 要挂在动态页之前：动态页里有很宽的路径匹配',
      'registerDreamRoutes(app, { requireBasicAuth });')],

  ['启动日志带上梦境和 heartbeat',
    "；星星罐：/moments/star-jar`",
    "；梦境：/dreams；heartbeat：${heartbeatProxy ? `转发 ${heartbeatProxy}` : '未配置'}；星星罐：/moments/star-jar`"],
];

// ══ src/phosphor.js ══
// 生成的代码用字符串拼接，不用模板字符串——免得反引号嵌套

const PHOSPHOR = [
  ['引入夜梦',
    "import { executeAction } from './actions/index.js';",
    L("import { executeAction } from './actions/index.js';",
      "import { maybeDream, recallDream, markRecalled, dreamConfigSummary } from './dreams.js';")],

  ['做决定前先看梦有没有被词碎到',
    L('  let decision = null;',
      '  let messages = null;',
      '  let result = null;',
      '  let errorMessage = null;'),
    L('  // 梦的浮现（见 dreams.js）：拿最近对话和心绪去碎触发词。',
      '  // 不是他去找梦——是某个词碎到了那个梦，它自己浮上来。',
      '  // 碎到了就把正文注入这一次的上下文；标记撔掉要等调用真的成功返回之后。',
      '  let dreamHit = null;',
      '  try {',
      '    const haystack = [',
      "      ...recentMessages.map((m) => String(m.content ?? '')),",
      "      String(context.mood ?? ''),",
      "      ...(drivesTop ?? []).map((t) => String(t.label ?? '')),",
      "    ].join('\\n');",
      '    dreamHit = recallDream(haystack);',
      '    if (dreamHit) {',
      '      context.dreamRecall = dreamHit.text;',
      "      console.log('[' + kind + '] 梦被「' + dreamHit.hit + '」碎到了，正文注入这一次的上下文');",
      '    }',
      '  } catch (err) {',
      "    console.error('[' + kind + '] recallDream failed:', err.message);",
      '  }',
      '',
      '  let decision = null;',
      '  let messages = null;',
      '  let result = null;',
      '  let errorMessage = null;')],

  ['读完了才撔掉',
    L('    const out = await decideWithMessages(context);',
      '    decision = normalizeDecision(out.decision, wakeState.mood);',
      '    messages = out.messages;'),
    L('    const out = await decideWithMessages(context);',
      '    decision = normalizeDecision(out.decision, wakeState.mood);',
      '    messages = out.messages;',
      '    // 调用真的成功返回了，正文确实进过他的上下文——现在才算浮现过。',
      '    // 前面报错或超时就走不到这里，梦还在，下次再碎。',
      '    if (dreamHit) markRecalled(dreamHit.id);')],

  ['唤醒尾巴叫一下夜梦',
    L('  logWake({', '    kind,', '    scheduledAt,'),
    L('  // 夜梦（见 dreams.js）：凌晨、素材够、赶上概率才做。',
      '  // 不占行动、不影响 say，出什么错都不拖累这次唤醒的收尾。',
      '  // 正文不进 wake_log——他只该记得自己做过梦。',
      '  try {',
      '    await maybeDream();',
      '  } catch (err) {',
      "    console.error('[' + kind + '] maybeDream failed:', err.message);",
      '  }',
      '',
      '  logWake({', '    kind,', '    scheduledAt,')],

  ['启动日志带上夜梦',
    "；共享时间线：${isSharedTimelineEnabled() ? '已开启' : '未开启'}",
    "；${dreamConfigSummary()}；共享时间线：${isSharedTimelineEnabled() ? '已开启' : '未开启'}"],
];

// ══ src/decide.js —— 浮上来的梦进这一次的 user 消息 ══

const DECIDE = [
  ['浮上来的梦进上下文',
    '    recentActionsBlock(context.recentActions),',
    L('    // 浮上来的那个梦（见 dreams.js）。摆在前面：它是这一次最先跳出来的东西，',
      '    // 不是备忘。只浮现这一次，下次就没了。',
      "    context.dreamRecall || '',",
      '    recentActionsBlock(context.recentActions),')],
];

// ══ src/page-chrome.js —— 菜单入口 ══

const CHROME = [
  ['引入 heartbeatBase',
    "import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';",
    L("import { STAR_ENTRY_CSS, STAR_ENTRY_SCRIPT } from './star-entry.js';",
      "import { heartbeatBase } from './heartbeat-proxy.js';")],

  ['菜单加梦境',
    L('  return [',
      "    { href: '/moments', label: '回到主页' },",
      '    diary,'),
    L('  // heartbeat 管理页转发进来了就有这一项（见 heartbeat-proxy.js）',
      '  const heartbeat = heartbeatBase()',
      "    ? { href: '/heartbeat/admin', label: 'heartbeat' }",
      "    : { href: '', label: 'heartbeat', note: '未配置' };",
      '  return [',
      "    { href: '/moments', label: '回到主页' },",
      '    diary,',
      "    { href: '/dreams', label: '梦境' },")],

  ['heartbeat 摆在记忆库后面',
    L('    memory,',
      "    { href: '/moments/profile', label: '自定义' },"),
    L('    memory,',
      '    heartbeat,',
      "    { href: '/moments/profile', label: '自定义' },")],
];

async function apply(rel, patches, check) {
  const file = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch {
    return { ok: false, msgs: ['\u2717 找不到 ' + rel] };
  }
  let out = src;
  const msgs = [];
  for (const [name, old, rep] of patches) {
    if (out.includes(rep)) {
      msgs.push('\u00b7 ' + name + '（已经打过了）');
      continue;
    }
    const hits = out.split(old).length - 1;
    if (hits === 0) {
      msgs.push('\u2717 「' + name + '」对不上原文');
      return { ok: false, msgs };
    }
    if (hits > 1) {
      msgs.push('\u2717 「' + name + '」出现 ' + hits + ' 次，不敢猜');
      return { ok: false, msgs };
    }
    out = out.replace(old, rep);
    msgs.push('\u00b7 ' + name);
  }
  if (out !== src && !check) {
    await copyFile(file, file + '.bak-dreams');
    await writeFile(file, out, 'utf8');
  }
  return { ok: true, msgs };
}

// 先确认三个新文件到位了
for (const f of ['src/dreams.js', 'src/dreams-page.js', 'src/heartbeat-proxy.js']) {
  try {
    await access(path.join(ROOT, f));
  } catch {
    console.error('\u2717 缺 ' + f + '。先 git pull 把新文件拉下来。');
    process.exit(1);
  }
}

const check = process.argv.includes('--check');
console.log(check ? '体检模式，不动文件\n' : '开始接线，每个文件先备份\n');

let allOk = true;
for (const [rel, patches] of [
  ['src/vesper.js', VESPER],
  ['src/phosphor.js', PHOSPHOR],
  ['src/decide.js', DECIDE],
  ['src/page-chrome.js', CHROME],
]) {
  const { ok, msgs } = await apply(rel, patches, check);
  console.log('  ' + rel);
  for (const m of msgs) console.log('    ' + m);
  if (!ok) {
    allOk = false;
    break;
  }
}

console.log();
if (!allOk) {
  console.log('有对不上的地方，已改的文件有 .bak-dreams 备份。');
  console.log('把这条的输出发我，按实际原文重写匹配段：');
  console.log('    grep -n "let decision = null\\|recentActionsBlock\\|回到主页" src/phosphor.js src/decide.js src/page-chrome.js');
  process.exit(2);
}

if (check) {
  console.log('都能打上，去掉 --check 就真改。');
} else {
  console.log('接完了。重启：pm2 restart vesper vesper-gateway');
  console.log();
  console.log('然后：');
  console.log('  梦境页      /dreams（菜单里也有入口）');
  console.log('  heartbeat   /heartbeat/admin');
  console.log();
  console.log('想立刻试一个梦（不等凌晨），把下面整段粘进终端：');
  console.log();
  console.log('cat > /tmp/try-dream.mjs <<\'EOF\'');
  console.log("import 'dotenv/config';");
  console.log("process.env.DREAM_AFTER_HOUR = '0';");
  console.log("process.env.DREAM_UNTIL_HOUR = '24';");
  console.log("process.env.DREAM_CHANCE = '1';");
  console.log("process.env.DREAM_MIN_MATERIAL = '1';");
  console.log("const { connectAll } = await import('./src/mcp-manager.js');");
  console.log('await connectAll();');
  console.log("const { maybeDream } = await import('./src/dreams.js');");
  console.log('console.log(await maybeDream());');
  console.log('process.exit(0);');
  console.log('EOF');
  console.log('node /tmp/try-dream.mjs');
  console.log();
  console.log('做完去 /dreams 看正文，日志里会打出触发词是哪几个。');
  console.log('以后谈话里碎到那些词，梦就会自己浮上来——一次，之后从他那边退掉。');
  console.log();
  console.log('节律在 .env 里调（都有默认值）：DREAM_AFTER_HOUR=3、DREAM_UNTIL_HOUR=9、');
  console.log('DREAM_CHANCE=0.72、DREAM_MAX_PER_NIGHT=3、DREAM_MIN_MATERIAL=5、DREAM_DATA_DIR=...');
  console.log();
  console.log('退回：for f in vesper phosphor decide page-chrome; do cp src/$f.js.bak-dreams src/$f.js; done');
}
