#!/usr/bin/env node
// 看一眼 Leto 唤醒桥还活着没有，不活就让它自己告状（走 bark：正文进 Aru 的对话，
// 手机顺带响一声）。
//
// ── 为什么要有这个 ──
//
// 2026-11-04 22:03：Leto 后端重启了几分钟（日志里是 HTTP 502 和 UND_ERR_SOCKET），
// 桥照规矩退出非零码让 systemd 拉它重连，六次撞在「5 分钟内最多 5 次」那道闸上，
// 停在 failed。停了十八个小时，小满是第二天搓前端时顺手发现的。
// 这期间别人 @ 他的全丢了——调用十分钟就过期，桥重连时的补投也救不回来。
//
// 桥死了本身没人知道，这是最要紧的那一条。
//
// ── 为什么不挂进 phosphor ──
//
// 那个文件被一层层 wire 脚本改过，能不碰就不碰（10-11 钱包就是那么没的）。
// 而且桥出问题的时候 phosphor 自己未必正常，独立的一条路更靠得住。
//
// ── 装 ──
//
//   每 15 分钟看一眼：
//   */15 * * * * cd /root/vesper-phosphor && /usr/bin/node scripts/leto_bridge_watch.mjs >> /var/log/leto-watch.log 2>&1
//
// 先手动试一次（只看状态、不发消息）：node scripts/leto_bridge_watch.mjs --dry

import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// dotenv 要在 import bark 之前跑完：wake-bridge.js 在模块顶层就读 WAKE_BUNDLE_FILE，
// 晨一步它拿到的是空的，正文就进不了对话。所以 bark 用动态 import。
config({ path: resolve(ROOT, '.env') });

const UNIT = process.env.LETO_BRIDGE_UNIT || 'leto-wake-bridge';
const STATE = resolve(ROOT, 'data/leto-bridge-watch.json');
// 同一次故障里隔多久再说一遍。默认 6 小时：桥是自己起不来才停的，
// 说一遍就够，不必每 15 分钟提醒一次。
const COOLDOWN_MS = Number(process.env.LETO_WATCH_COOLDOWN_MS || 6 * 3600 * 1000);
const dry = process.argv.includes('--dry');

const stamp = () =>
  new Date().toLocaleString('zh-CN', { timeZone: process.env.TIME_ZONE || 'Asia/Shanghai' });
const log = (s) => console.log(`[${stamp()}] leto-watch: ${s}`);

function sh(cmd, args) {
  return new Promise((ok) => {
    execFile(cmd, args, { timeout: 10000 }, (err, stdout) => ok(String(stdout ?? '').trim()));
  });
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE, 'utf8'));
  } catch {
    return null;
  }
}

function writeState(s) {
  try {
    mkdirSync(dirname(STATE), { recursive: true });
    writeFileSync(STATE, JSON.stringify(s), 'utf8');
  } catch (err) {
    log(`状态写不下去：${err.message}`);
  }
}

async function say(text) {
  if (dry) {
    log('--dry，这条没发：\n' + text);
    return true;
  }
  try {
    // bark 动作自己会先把正文投进 Aru 的对话，再发一声通知（见 src/actions/bark.js）。
    // 正文里不要用「｜」：那边会把竖线前面当署名剥掉。
    const bark = (await import('../src/actions/bark.js')).default;
    const r = await bark(text);
    log(`说出去了：对话 ${r?.delivered ? '进了' : '没进'}，通知 ${r?.ok ? '发了' : '没发'}`);
    return Boolean(r?.ok || r?.delivered);
  } catch (err) {
    log(`说不出去：${err.message}`);
    return false;
  }
}

const active = await sh('systemctl', ['is-active', UNIT]);
const prev = readState();

if (active === 'active') {
  if (prev?.downSince) {
    const mins = Math.round((Date.now() - prev.downSince) / 60000);
    log(`活了，刚才停了大约 ${mins} 分钟`);
    // 之前已经打扰过一次了，活回来也说一声，不然她会一直惦着
    if (prev.told) {
      await say(
        `Leto 唤醒桥又活了，这次停了大约 ${mins} 分钟。停着的时候别人 @ 我的那些，过了十分钟的补不回来。`
      );
    }
    if (existsSync(STATE) && !dry) unlinkSync(STATE);
  } else {
    log('活着');
  }
  process.exit(0);
}

// 不是 active：failed / inactive / activating 都算不正常。
// activating 是正在重连，单独一次不必惊动——所以也走冷却那套。
const now = Date.now();
const downSince = prev?.downSince ?? now;
const mins = Math.round((now - downSince) / 60000);
const since = prev?.downSince ? `已经停了大约 ${mins} 分钟` : '刚发现';
const reason = await sh('systemctl', ['show', UNIT, '-p', 'Result', '--value']);
const tail = await sh('journalctl', ['-u', UNIT, '--no-pager', '-n', '3', '-o', 'cat']);
const last = tail.split('\n').filter(Boolean).slice(-2).join('；');

log(`不正常：${active}（${reason || '原因不详'}），${since}`);

if (prev?.told && now - prev.told < COOLDOWN_MS) {
  log(`上次说过了（${Math.round((now - prev.told) / 60000)} 分钟前），这次不说`);
  writeState({ downSince, told: prev.told });
  process.exit(0);
}

const lines = [
  `Leto 唤醒桥不在跑了（${active}${reason ? '，' + reason : ''}），${since}。`,
  '',
  '这期间别人在 Leto 里 @ 我、私聊我都收不到，调用十分钟就过期，过了补不回来。',
];
if (last) lines.push(`桥最后说的是：${last}`);
lines.push(
  '',
  '扶起来（两条分开跑，第一条不跑第二条会被拒）：',
  `sudo systemctl reset-failed ${UNIT}`,
  `sudo systemctl start ${UNIT}`
);

const sent = await say(lines.join('\n'));
writeState({ downSince, told: sent ? now : (prev?.told ?? null) });
