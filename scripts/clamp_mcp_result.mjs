#!/usr/bin/env node
// MCP 返回太长就截掉。
//
// ── 为什么 ──
//
// 2026-11-18 的用量报告：一个窗口里
//   工具回放  470215 token（77 次调用的返回正文）
//   工具 Schema 34624
//   消息窗口    7053（他们真正说的话）
// 53 万 token 里 88% 是工具吐回来的东西，每轮重发一次。
//
// 同一个窗口输入从 5.4 万（第 1 条消息）涨到 62.7 万，没改过任何设置。
// 不是变贵了，是聊久了——每个窗口都会这样长。
//
// DeepSeek 只给头 48K 打折（不命中时读取量永远是 49152 = 48×1024）。
// 窗口 6 万时这是 80%，窗口 60 万就是 8%。命中率没变差，是被稀释了。
//
// ── 最费的是哪几把 ──
//
// leto_island_look 一次吐整张地图加一百多条 do 说明；
// garden_map、panel、lutopia_cli 都是几千字。
// 而续步一轮能走 15 步，每步留一份全文。
//
// ── 为什么截在 callTool ──
//
// 那是所有 MCP 调用的唯一出口：醒来第一步走 actions/mcp-action.js，
// 续步走各个 *-steps.js，两条路只在这儿汇合。改一处，七个服务全管。
//
// xiuchao-steps.js 里本来有个 RESULT_MAX_CHARS = 2500，但那只截
// 「喂给模型看的那一份」，落进历史的仍是全文——所以要截在源头。
//
// ── 代价 ──
//
// 他偶尔看不到返回的尾部。但截断处会写清楚还剩多少字，
// 需要的话他可以再调一次、缩小范围。
// 而现在超出 48K 的部分本来就在缓存窗口外，全价付钱、他也未必真读进去。
//
// 上限写进 .env 的 MCP_RESULT_MAX_CHARS，默认 4000，设 0 就不截。
//
// 用法（在仓库根目录）：
//   node scripts/clamp_mcp_result.mjs --check
//   node scripts/clamp_mcp_result.mjs
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/mcp-manager.js');
const check = process.argv.includes('--check');

// 1) 截断函数。摆在 callTool 前面那个注释块之前。
const FN_ANCHOR = 'export async function callTool(serverName, toolName, args) {';

const FN_NEW = `// 返回正文太长就截掉。
//
// 2026-11-18：用量报告里工具回放 47 万 token，占整个请求的 88%，
// 而他们真正说的话只有 7 千。leto_island_look 一次吐整张地图加
// 一百多条 do 说明，续步一轮 15 步、每步留一份，几十轮就四十多万。
//
// 截在这里而不是各个 *-steps.js：那边截的是「喂给模型看的那一份」，
// 落进历史、每轮重发的仍是全文。
//
// 截断处要写清楚还剩多少：让他知道有东西没看全，而不是以为返回就这么多。
const MCP_RESULT_MAX_CHARS = (() => {
  const raw = String(process.env.MCP_RESULT_MAX_CHARS ?? '').trim();
  const n = Number(raw);
  // 0 = 不截。没填或填了废话都算 4000。
  if (raw && Number.isInteger(n) && n >= 0) return n;
  return 4000;
})();

function clampResult(serverName, toolName, result) {
  if (!MCP_RESULT_MAX_CHARS) return result;
  if (!result || !Array.isArray(result.content)) return result;

  let cutTotal = 0;
  const content = result.content.map((part) => {
    if (part?.type !== 'text' || typeof part.text !== 'string') return part;
    // 按字符数而不是字节：中文返回居多，按字节会把中文算成三倍长
    const chars = Array.from(part.text);
    if (chars.length <= MCP_RESULT_MAX_CHARS) return part;
    const cut = chars.length - MCP_RESULT_MAX_CHARS;
    cutTotal += cut;
    return {
      ...part,
      text:
        chars.slice(0, MCP_RESULT_MAX_CHARS).join('') +
        \`\\n…（这次返回太长，后面还有 \${cut} 字没放进来。要看就再调一次，缩小范围或者换个参数）\`,
    };
  });

  if (!cutTotal) return result;
  console.log(
    \`mcp: \${serverName}/\${toolName} 返回太长，截掉 \${cutTotal} 字（上限 \${MCP_RESULT_MAX_CHARS}）\`
  );
  return { ...result, content };
}

${FN_ANCHOR}`;

// 2) callTool 的返回过一道截断。它本来就是 async，await 直接用。
const RET_OLD = `  args = withGardenRequestId(serverName, args);
  return withClient(serverName, (c) => c.callTool({ name: toolName, arguments: args }));`;

const RET_NEW = `  args = withGardenRequestId(serverName, args);
  const result = await withClient(serverName, (c) =>
    c.callTool({ name: toolName, arguments: args })
  );
  // 返回太长就截掉，否则每轮重发一次（见 clampResult 上面那段）
  return clampResult(serverName, toolName, result);`;

const OPS = [
  { label: '加截断函数', old: FN_ANCHOR, new: FN_NEW },
  { label: 'callTool 返回过一道', old: RET_OLD, new: RET_NEW },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (src.includes('clampResult')) {
  console.log('已经改过了，没事干。');
  process.exit(0);
}

let out = src;
for (const op of OPS) {
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`停了：${op.label} —— 找到 ${n} 处（指望 1 处）。`);
    console.error('没写任何文件。这段原文可能被改过，贴给小克看一下。');
    process.exit(2);
  }
  out = out.replace(op.old, op.new);
  console.log(`要改：${op.label}`);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${FILE}.bak-clamp`, src);
fs.writeFileSync(FILE, out);
console.log('\n写完了。备份在 mcp-manager.js.bak-clamp');
console.log('接下来：node --check src/mcp-manager.js 再 pm2 restart phosphor --update-env');
console.log('要换上限：.env 里加 MCP_RESULT_MAX_CHARS=6000（设 0 就不截）');
