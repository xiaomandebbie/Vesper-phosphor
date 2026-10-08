#!/usr/bin/env node
// wire_heartbeat_wake_bridge.mjs — 让 heartbeat 的推送也走 wake-bridge。
//
// 用法（在 vesper-phosphor 根目录）：
//     node scripts/wire_heartbeat_wake_bridge.mjs --check          # 只看能不能打，不动文件
//     node scripts/wire_heartbeat_wake_bridge.mjs                  # 真打，先自动备份
//     node scripts/wire_heartbeat_wake_bridge.mjs /路径/heartbeat  # 手动指定目录
//
// 为什么要改：
//   服务器上跑着两套独立的唤醒系统：
//     vesper-phosphor 的 phosphor —— bark.js 已经改成「正文投 Aru，Bark 只叮一声」
//     dylan-heartbeat 的 wake-up —— 自己一套 sendPushNotification，正文直接塞进推送
//   平时发消息最勤的是后者（白天 10 分钟查一次），所以只改 phosphor 没用。
//
// 改成什么样：
//   推送前先把「标题｜正文」投进 Aru 对话；投成功了，推送只显示固定的
//   「允朔 / 一条新消息送达～」；投失败或没配凭据就退回老做法，正文照旧带上。
//   唤醒事件记录（写回 Gateway 那条）不动，所以时间线里还是能看到原话。
//
//   heartbeat 是独立进程、独立目录，import 不到 vesper 那边的 wake-bridge.js，
//   所以这里给它放一份独立的 wake-bridge.mjs（加密那段和 vesper 一模一样：
//   AES-256-GCM、nonce 12 字节、密文后接 auth tag、整体 base64）。
//   Host 哪天换格式，两边都要跟着改。
//
//   凭据走 heartbeat 自己的 .env：WAKE_BUNDLE_FILE。可以和 vesper 用同一份文件。
//
// 改两个文件：
//   新增 wake-bridge.mjs（投递函数）
//   改 wake_up.js 两处：import、推送前先投对话
//
// 原文对不上就整个不改，不猜。
// 退回：cp wake_up.js.bak-wakebridge wake_up.js && pm2 restart wake-up

import { access, copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const CANDIDATES = [
  process.argv.find((a) => a.startsWith('/') && !a.endsWith('.mjs')),
  '/root/dylan-heartbeat',
  '/root/heartbeat',
  path.join(os.homedir(), 'dylan-heartbeat'),
].filter(Boolean);

let DIR = null;
for (const d of CANDIDATES) {
  try {
    await access(path.join(d, 'wake_up.js'));
    DIR = d;
    break;
  } catch {}
}
if (!DIR) {
  console.error('✗ 找不到 heartbeat 的 wake_up.js。试过：');
  CANDIDATES.forEach((d) => console.error(`    ${d}`));
  console.error('\n把真实路径当参数传进来：');
  console.error('    node scripts/wire_heartbeat_wake_bridge.mjs /你的/heartbeat目录');
  process.exit(1);
}

const BRIDGE_FILE = path.join(DIR, 'wake-bridge.mjs');
const WAKE_FILE = path.join(DIR, 'wake_up.js');
const check = process.argv.includes('--check');

// ══ 新增：wake-bridge.mjs ══
// 加密格式和 vesper-phosphor/src/actions/wake-bridge.js 完全一致

const BRIDGE = `// 把一段话投进 Aru 的对话，而不是只弹一个通知。
//
// 走的是 Aru Host 的 wake-bridge：正文要用 sender-bundle 里的密钥加密再发。
// 加密方式和 vesper-phosphor 那边的 src/actions/wake-bridge.js 一模一样
// （AES-256-GCM，nonce 12 字节，密文后面接 auth tag，整体 base64）。
// 两边要么都不改，要改就一起改，不然 Host 会拒收其中一边。
//
// 凭据不放仓库里：sender-bundle 是一份 JSON，路径写在 .env 的 WAKE_BUNDLE_FILE。
// 它等于「以你的名义往她手机投消息」的钥匙，别提交、别截图、别贴进聊天。
import fs from 'fs';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';

const BUNDLE_FILE = (process.env.WAKE_BUNDLE_FILE || '').trim();
const BUNDLE_INLINE = (process.env.WAKE_BUNDLE || '').trim();
const TIMEOUT_MS = Number(process.env.WAKE_SUBMIT_TIMEOUT_MS || 15000);

let cached = null;

export function isWakeBridgeEnabled() {
  return Boolean(BUNDLE_FILE || BUNDLE_INLINE);
}

// 读一次就记住。换了 bundle 要重启 wake-up 才生效。
function loadBundle() {
  if (cached) return cached;
  const raw = BUNDLE_FILE ? fs.readFileSync(BUNDLE_FILE, 'utf8') : BUNDLE_INLINE;
  const bundle = JSON.parse(raw);
  if (bundle?.schema !== 'aru.wake-bridge.sender-bundle.v2') {
    throw new Error(\`sender-bundle 的 schema 不认识：\${bundle?.schema}\`);
  }
  const key = Buffer.from(bundle.encryptionKey ?? '', 'base64');
  if (key.length !== 32) throw new Error('sender-bundle 里的 encryptionKey 不是 32 字节');
  cached = { ...bundle, key };
  return cached;
}

function seal(bundle, content, eventId) {
  const payload = Buffer.from(
    JSON.stringify({
      schema: 'aru.wake-bridge.payload.v2',
      eventId,
      triggerId: bundle.triggerId,
      content,
    }),
    'utf8'
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bundle.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

// 投一段话。成功返回 { ok: true, eventId }；没配或投失败返回 { ok: false, reason }。
// 这里不抛错：调用方还要接着发通知，不能被这里带崩。
export async function submitWakeEvent(content) {
  if (!isWakeBridgeEnabled()) return { ok: false, reason: 'WAKE_BUNDLE_FILE not set' };
  const text = String(content ?? '').trim();
  if (!text) return { ok: false, reason: 'content is empty' };
  try {
    const bundle = loadBundle();
    const eventId = randomUUID();
    const res = await fetch(bundle.submitURL, {
      method: 'POST',
      headers: {
        authorization: \`Bearer \${bundle.submitToken}\`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schema: 'aru.wake-bridge.sealed-event.v1',
        eventId,
        sealedPayload: seal(bundle, text, eventId),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: \`HTTP \${res.status}\` };
    return { ok: true, eventId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
`;

// ══ 改 wake_up.js ══

const PATCHES = [
  ['引入投递函数',
`async function sendPushNotification({ title, body }) {
  const provider = (process.env.PUSH_PROVIDER || "bark").trim().toLowerCase();`,
`// 批注 2026-10-08：推送前先把正文投进 Aru 对话（见 ./wake-bridge.mjs）。
// 投成功了推送就只叮一声，话留在对话里能翻回去看；
// 没配凭据或投失败就退回老做法，正文照旧带在推送里，不致于什么都看不到。
const WAKE_TITLE = process.env.WAKE_PUSH_TITLE || process.env.BARK_TITLE || "允朔";
const WAKE_BODY = process.env.WAKE_PUSH_BODY || process.env.BARK_BODY || "一条新消息送达～";

async function sendPushNotification({ title, body }) {
  const provider = (process.env.PUSH_PROVIDER || "bark").trim().toLowerCase();`],

  ['推送前先投对话',
`      const pushResult = await sendPushNotification({ title: safeTitle, body: safeBody });`,
`      // 先投 Aru 对话。投失败不影响下面那声通知，两件事各报各的错。
      let bridged = { ok: false, reason: "WAKE_BUNDLE_FILE not set" };
      try {
        const wb = await import("./wake-bridge.mjs");
        if (wb.isWakeBridgeEnabled()) {
          bridged = await wb.submitWakeEvent(\`\${safeTitle}｜\${safeBody}\`);
          if (bridged.ok) console.log(\`\\n正文已投进 Aru 对话 \${bridged.eventId}\\n\`);
          else console.error(\`\\n正文没能投进 Aru 对话：\${bridged.reason}\\n\`);
        }
      } catch (err) {
        console.error(\`\\nwake-bridge 没加载起来：\${err.message}\\n\`);
      }
      // 正文已经落进对话了，通知就只报个信；否则还是把原话带上
      const pushResult = await sendPushNotification(
        bridged.ok ? { title: WAKE_TITLE, body: WAKE_BODY } : { title: safeTitle, body: safeBody }
      );`],
];

let src;
try {
  src = await readFile(WAKE_FILE, 'utf8');
} catch (err) {
  console.error(`✗ 读不动 ${WAKE_FILE}：${err.message}`);
  process.exit(1);
}

console.log(`heartbeat: ${DIR}\n`);

let out = src;
const done = [];
for (const [name, old, rep] of PATCHES) {
  if (out.includes(rep)) {
    done.push(`· ${name}（已经打过了）`);
    continue;
  }
  const hits = out.split(old).length - 1;
  if (hits === 0) {
    console.error(`✗ 「${name}」对不上原文，整个文件没改。`);
    console.error('  先看一眼现在长什么样：');
    console.error(`      grep -n 'sendPushNotification' ${WAKE_FILE}`);
    process.exit(2);
  }
  if (hits > 1) {
    console.error(`✗ 「${name}」出现 ${hits} 次，不敢猜。整个文件没改。`);
    process.exit(2);
  }
  out = out.replace(old, rep);
  done.push(`· ${name}`);
}

let bridgeExists = false;
try {
  await access(BRIDGE_FILE);
  bridgeExists = true;
} catch {}

if (check) {
  console.log('✓ 能打上，文件没动：');
  console.log(`  · ${bridgeExists ? 'wake-bridge.mjs（已存在，会覆盖成最新版）' : '新增 wake-bridge.mjs'}`);
  done.forEach((d) => console.log(`  ${d}`));
  console.log('\n去掉 --check 就真改。');
  process.exit(0);
}

await writeFile(BRIDGE_FILE, BRIDGE, 'utf8');
await copyFile(WAKE_FILE, `${WAKE_FILE}.bak-wakebridge`);
await writeFile(WAKE_FILE, out, 'utf8');

console.log('✓ 改完了，wake_up.js 备份在 wake_up.js.bak-wakebridge：');
console.log(`  · ${bridgeExists ? 'wake-bridge.mjs（已更新）' : '新增 wake-bridge.mjs'}`);
done.forEach((d) => console.log(`  ${d}`));
console.log();
console.log('还差一步：把凭据路径写进 heartbeat 的 .env（可以和 vesper 用同一份文件）');
console.log(`    echo 'WAKE_BUNDLE_FILE=/root/vesper-phosphor/.secrets/wake-bundle.json' >> ${path.join(DIR, '.env')}`);
console.log();
console.log('然后重启：pm2 restart wake-up');
console.log();
console.log('验证：下次它自己醒来发消息时，锁屏只会显示「允朔 / 一条新消息送达～」，');
console.log('正文在 Aru 对话里。日志：pm2 logs wake-up --lines 0');
console.log();
console.log('退回：cp wake_up.js.bak-wakebridge wake_up.js && pm2 restart wake-up');
