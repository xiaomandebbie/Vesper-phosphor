#!/usr/bin/env node
// MCP 调用抛异常时重试一次。
//
// ── 为什么 ──
//
// 2026-11-20 的日志：
//   11:31:05  failed to list tools for leto: fetch failed
//   12:04:30  leto: 上一步连返回都没有（leto_island_look），这次走到这里
//
// 而《Leto 见闻》#22 那条笔记他数到了「第十六次栽」。他把它解释成
// 「被笔记流程先接走」，那是猜的——日志里 notes 读完立刻就是 leto 续步，
// 没有任何东西把动作吃掉。真因是 Leto 那边时断时续，而他看不到
// fetch failed 那行日志。
//
// ── 现在的重试为什么不管用 ──
//
// withClient 只对 isSessionError 重试：那个正则只认 Session not found /
// session expired / 404。纯网络层的 fetch failed、ECONNRESET、超时
// 都直接抛出去，续步那边 isDead 一见空返回就停。
//
// 改法：在 withClient 里多一条——连接类的错误也重试一次，等一秒再走。
// 两次都坏才算真走不下去。只重试一次：再多就是卡着等，而 Leto 的
// 调用十分钟就过期。
//
// 七个服务都过 withClient，所以花园、锈潮、论坛一起受益。
//
// 用法（在仓库根目录）：
//   node scripts/mcp_retry_once.mjs --check
//   node scripts/mcp_retry_once.mjs
import fs from 'fs';
import path from 'path';

const F = path.resolve('src/mcp-manager.js');
const check = process.argv.includes('--check');

// 1) 多一个判别函数。摆在 isSessionError 后面。
const A1 = 'async function reconnect(name) {';

const N1 = `// 纯网络层的毛病：连不上、连到一半袭断、超时。
//
// 2026-11-20：Leto 时断时续（failed to list tools for leto: fetch failed），
// 而他的续步代码一见空返回就停。#22 那条笔记他数到第十六次——
// 对他来说就是「又没走成」，而连不上这件事他根本看不见。
//
// undici 把真正的原因装在 err.cause 里，message 只给一句 fetch failed，
// 所以两层都要看。
function isTransportError(err) {
  const msg = String(err?.message ?? '');
  const cause = String(err?.cause?.code ?? err?.cause?.message ?? '');
  const code = String(err?.code ?? '');
  return /fetch failed|network|socket|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|ENOTFOUND|EAI_AGAIN|UND_ERR|terminated|aborted|timeout/i.test(
    \`\${msg} \${cause} \${code}\`
  );
}

async function reconnect(name) {`;

// 2) withClient 里多一条重试。
const A2 = `  try {
    return await fn(client);
  } catch (err) {
    if (!isSessionError(err)) throw err;
    console.warn(\`MCP "\${name}" 会话失效，重新连接后重试：\${err.message}\`);
    const fresh = await reconnect(name);
    return fn(fresh);
  }`;

const N2 = `  try {
    return await fn(client);
  } catch (err) {
    if (isSessionError(err)) {
      console.warn(\`MCP "\${name}" 会话失效，重新连接后重试：\${err.message}\`);
      const fresh = await reconnect(name);
      return fn(fresh);
    }
    // 网络抖了一下：等一秒、重连、再试一次。两次都坏才算真走不下去。
    //
    // 只重试一次：再多就是卡着等，而 Leto 的调用十分钟就过期。
    if (isTransportError(err)) {
      const why = err?.cause?.code ?? err?.cause?.message ?? err.message;
      console.warn(\`MCP "\${name}" 连接抖了（\${why}），等一秒再试一次\`);
      await new Promise((r) => setTimeout(r, 1000));
      let fresh;
      try {
        fresh = await reconnect(name);
      } catch (again) {
        console.error(\`MCP "\${name}" 重连也没成：\${again.message}\`);
        throw err;
      }
      return fn(fresh);
    }
    throw err;
  }`;

const OPS = [
  { label: '加 isTransportError', old: A1, new: N1 },
  { label: 'withClient 多一条重试', old: A2, new: N2 },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(F, 'utf-8');
} catch (err) {
  console.error(`读不到 ${F}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (src.includes('isTransportError')) {
  console.log('已经改过了，没事干。');
  process.exit(0);
}

let out = src;
let bad = 0;
for (const op of OPS) {
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`✗ ${op.label} —— 找到 ${n} 处（指望 1 处）`);
    bad++;
    continue;
  }
  out = out.replace(op.old, op.new);
  console.log(`✓ ${op.label}`);
}

if (bad) {
  console.error(`\n停了：${bad} 处锚点对不上，没写任何文件。`);
  console.error('把 src/mcp-manager.js 里 withClient 那整段贴给小克看。');
  process.exit(2);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${F}.bak-retry`, src);
fs.writeFileSync(F, out);
console.log('\n写完了。备份在 mcp-manager.js.bak-retry');
console.log('接下来：node --check src/mcp-manager.js 再 pm2 restart phosphor --update-env');
console.log('以后抖了日志里会有：MCP "leto" 连接抖了（…），等一秒再试一次');
