#!/usr/bin/env node
// 把 WORKKK 装到本机，并打两个本机补丁。
//
// ── 为什么必须打补丁 ──
//
// 一、鉴权。workkk 的 /mcp 强制 OAuth 2.1。token 存在进程内存里，24 小时过期，
//     重启就清空。自动唤醒那条路上没人能去过授权页（那要浏览器点「允许」），
//     所以给它加一个从环境变量读的固定 token。服务只监听 127.0.0.1，外面进不来。
//
// 二、存档路径。它写死 /data/game_state.json，那是 Railway Volume 的挂载点。
//     本机跑的话存档会掉在根目录，改成可配。
//
// ── 关于这个项目 ──
//
// workkk 是谢之舟（zhizhou-xiee）写的，AGPL-3.0-or-later，带署名条款：
// 源码和运行界面都要保留作者署名与源码链接，改了要注明。
// 所以这里**只在本机打补丁，不动仓库**，界面上那行署名一个字不改。
//
// ── 用法 ──
//
//   cd /root/vesper-phosphor && node scripts/setup_workkk.mjs
//
// 可以反复跑：已经 clone 过就拉更新，已经打过补丁就跳过，进程跑着就重启。
// 跑完它会把该加进 .env 的几行打印出来。
//
// ── 2026-10-16 加的超时 ──
//
// 第一版没有超时，国内 clone github 和 pip 拉包都可能挂很久不动，看着像死了。
// 现在每一步都有上限，超时就报错停下（不会静静地吊在那里），并告诉下一步做什么。
// pip 走清华镜像；clone 先试直连、再试 gh-proxy。

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const DIR = process.env.WORKKK_DIR || '/opt/workkk';
const PORT = process.env.WORKKK_PORT || '8000';
const VENV = path.join(DIR, '.venv');
const ENV_FILE = path.join(DIR, '.env');
const ECOSYSTEM = path.join(DIR, 'ecosystem.workkk.cjs');
const STATE_FILE = path.join(DIR, 'data', 'game_state.json');

// 每一步的上限。超了就抛错停下，不会吊在那里。
const T_CLONE = 300_000;   // 5 分钟（国内 clone 慢，但 5 分钟还下不完就不该等了）
const T_GIT = 120_000;     // 2 分钟
const T_PIP = 600_000;     // 10 分钟（装依赖最慢的一步）
const T_QUICK = 120_000;

const log = (s = '') => console.log(s);
const sh = (cmd, timeout = T_QUICK, opts = {}) => {
  log(`\n$ ${cmd}`);
  try {
    execSync(cmd, { stdio: 'inherit', timeout, ...opts });
  } catch (err) {
    if (err.killed || err.signal === 'SIGTERM') {
      throw new Error(`这一步超过 ${Math.round(timeout / 1000)} 秒没跑完，已经停下来了。`);
    }
    throw err;
  }
};

// ── 1. 拉代码 ────────────────────────────────────────────────────────────

log('【1/5】拉代码（国内可能慢，最多等 5 分钟）');

const CLONE_URLS = [
  'https://gh-proxy.com/https://github.com/xiaomandebbie/work-game.git',
  'https://github.com/xiaomandebbie/work-game.git',
];

if (fs.existsSync(path.join(DIR, '.git'))) {
  log(`已经 clone 过（${DIR}），拉一下更新`);
  sh(`git -C ${DIR} fetch --all && git -C ${DIR} reset --hard origin/main`, T_GIT);
} else {
  // 上次可能留了半个目录（比如上一次被 Ctrl+C 打断）。git clone 不接受非空目录，先清掉。
  if (fs.existsSync(DIR)) {
    log(`${DIR} 已经存在但不是完整的仓库，清掉重来`);
    fs.rmSync(DIR, { recursive: true, force: true });
  }
  let ok = false;
  let lastErr = null;
  for (const url of CLONE_URLS) {
    try {
      log(`试着从 ${url.split('/')[2]} 拉…`);
      sh(`git clone --depth 1 ${url} ${DIR}`, T_CLONE);
      ok = true;
      break;
    } catch (err) {
      lastErr = err;
      log(`这个地址没成（${err.message}），换下一个`);
      fs.rmSync(DIR, { recursive: true, force: true });
    }
  }
  if (!ok) {
    console.error(`\n两个地址都没拉下来：${lastErr?.message}`);
    console.error('手动拉一次，再重跑这个脚本：');
    console.error(`  git clone --depth 1 https://gh-proxy.com/https://github.com/xiaomandebbie/work-game.git ${DIR}`);
    process.exit(1);
  }
}

// ── 2. 打补丁 ────────────────────────────────────────────────────────────
//
// reset --hard 之后补丁会被抹掉，所以每次都要重打。两处都做成幂等的：
// 先查有没有已经打过的痕迹，有就跳过；锚点找不到就整件事停下，绝不写半个。

log('\n【2/5】打本机补丁');

const MAIN = path.join(DIR, 'main.py');
if (!fs.existsSync(MAIN)) {
  console.error(`找不到 ${MAIN}，这个仓库的结构跟预期不一样。什么都没动。`);
  process.exit(1);
}
let src = fs.readFileSync(MAIN, 'utf8');
let patchedCount = 0;

// 补丁一：_auth() 多认一个本机 token
if (src.includes('MCP_LOCAL_TOKEN')) {
  log('补丁一（本机 token）已经在了，跳过');
} else {
  const anchor = [
    'def _auth(req: Request) -> None:',
    '    h = req.headers.get("Authorization", "")',
    '    if not h.startswith("Bearer "):',
  ].join('\n');
  if (!src.includes(anchor)) {
    console.error('找不到 _auth 的锚点。main.py 可能被改过，什么都没动。');
    process.exit(1);
  }
  const patched = [
    'def _auth(req: Request) -> None:',
    '    # ── 本机部署改造（2026-10-16，允朔）─────────────────────────────',
    '    # 原来的 OAuth 流程要求先跑一遍授权页拿 token，而那个 token 24 小时',
    '    # 过期、进程重启就清空。自动唤醒那条路上没人能去过授权页，所以这里',
    '    # 多认一个从环境变量读的固定 token。服务只监听 127.0.0.1，外面进不来。',
    '    # 改动的只有这一个函数，其余源码未动。',
    '    _local = os.getenv("MCP_LOCAL_TOKEN", "")',
    '    if _local and req.headers.get("Authorization", "") == f"Bearer {_local}":',
    '        return',
    '    h = req.headers.get("Authorization", "")',
    '    if not h.startswith("Bearer "):',
  ].join('\n');
  src = src.replace(anchor, patched);
  patchedCount++;
}

// 补丁二：存档路径可配
if (src.includes('WORKKK_STATE_FILE')) {
  log('补丁二（存档路径）已经在了，跳过');
} else {
  const anchor = '_STATE_FILE = "/data/game_state.json"';
  if (!src.includes(anchor)) {
    console.error('找不到存档路径那一行。main.py 可能被改过，什么都没动。');
    process.exit(1);
  }
  src = src.replace(
    anchor,
    [
      '# ── 本机部署改造（2026-10-16，允朔）：存档路径可配，默认仍在 /data ──',
      '_STATE_FILE = os.getenv("WORKKK_STATE_FILE", "/data/game_state.json")',
    ].join('\n')
  );
  patchedCount++;
}

if (patchedCount) {
  fs.writeFileSync(MAIN, src, 'utf8');
  log(`补丁打好了（${patchedCount} 处）：_auth() 认 MCP_LOCAL_TOKEN，存档路径读 WORKKK_STATE_FILE`);
}

// ── 3. token ─────────────────────────────────────────────────────────────

log('\n【3/5】准备 token');

let token = '';
if (fs.existsSync(ENV_FILE)) {
  const m = fs.readFileSync(ENV_FILE, 'utf8').match(/^MCP_LOCAL_TOKEN=(.+)$/m);
  if (m) token = m[1].trim();
}
if (!token) {
  token = crypto.randomBytes(24).toString('base64url');
  fs.writeFileSync(ENV_FILE, `MCP_LOCAL_TOKEN=${token}\n`, 'utf8');
  log(`生成了本机 token，写在 ${ENV_FILE}`);
} else {
  log(`沿用已有的本机 token（${ENV_FILE}）`);
}

// ── 4. venv 和依赖 ───────────────────────────────────────────────────────
//
// 用 venv 而不是直接 pip install：新版 Debian / CentOS 会拿 PEP 668 拦下来
// （externally-managed-environment），在系统 Python 里装包会被拒。
//
// pip 走清华镜像：国内直连 pypi.org 拉 fastapi + uvicorn 常常要等很久，
// 看着像卡死了。镜像快得多。万一镜像没有某个包，退回官方源再试一次。

log('\n【4/5】建环境装依赖（最慢的一步，最多等 10 分钟）');

if (!fs.existsSync(VENV)) {
  log(`建 venv：${VENV}`);
  sh(`python3 -m venv ${VENV}`, T_QUICK);
}

const MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple';
sh(`${VENV}/bin/pip install -q --upgrade pip -i ${MIRROR}`, T_QUICK);
try {
  sh(`${VENV}/bin/pip install -q -r ${DIR}/requirements.txt -i ${MIRROR} --timeout 60`, T_PIP);
} catch (err) {
  log(`镜像没成（${err.message}），退回官方源再试一次`);
  sh(`${VENV}/bin/pip install -q -r ${DIR}/requirements.txt --timeout 60`, T_PIP);
}

// ── 5. 起进程 ────────────────────────────────────────────────────────────
//
// 用 pm2 托管，和 vesper 那几个一样。ecosystem 文件生成在 work-game 目录里，
// 不进仓库——它是本机部署的产物，不该跟着源码走。

log('\n【5/5】起进程');

fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });

fs.writeFileSync(
  ECOSYSTEM,
  `// 本机部署产物（setup_workkk.mjs 生成），不进仓库。
module.exports = {
  apps: [
    {
      name: 'workkk',
      cwd: '${DIR}',
      script: '${VENV}/bin/uvicorn',
      args: 'main:app --host 127.0.0.1 --port ${PORT}',
      interpreter: 'none',
      env: {
        MCP_LOCAL_TOKEN: '${token}',
        WORKKK_STATE_FILE: '${STATE_FILE}',
      },
      exp_backoff_restart_delay: 1000,
      time: true,
    },
  ],
};
`,
  'utf8'
);

try {
  sh(`pm2 start ${ECOSYSTEM} --update-env`, T_QUICK);
} catch {
  sh('pm2 restart workkk --update-env', T_QUICK);
}
sh('pm2 save', T_QUICK);

// ── 自检 ────────────────────────────────────────────────────────────────
//
// 拿那个固定 token 直接打一次 /mcp 的 initialize。这一步过了，
// 说明「本机免鉴权」真的生效了，不用等到自动唤醒那天才发现连不上。

log('\n等它起来…');
await new Promise((r) => setTimeout(r, 3000));
let passed = false;
try {
  const res = await fetch(`http://127.0.0.1:${PORT}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'setup-check', version: '1' },
      },
    }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  if (res.ok) {
    passed = true;
    log(`\n✅ 自检通过：/mcp 认这个 token（HTTP ${res.status}）`);
  } else {
    log(`\n⚠️ 自检没过：HTTP ${res.status}`);
    log(text.slice(0, 300));
  }
} catch (err) {
  log(`\n⚠️ 自检没连上：${err.message}`);
  log('进程可能还在起。等十秒看 pm2 logs workkk --lines 30 --nostream');
}

// ── 打印该加进 .env 的行 ──────────────────────────────────────────────

log('\n──────────────────────────────────────────────');
log('把下面这三行加到 /root/vesper-phosphor/.env：\n');
log(`WORKKK_MCP_URL=http://127.0.0.1:${PORT}/mcp`);
log(`WORKKK_MCP_TOKEN=${token}`);
log(`WORKKK_PAGE_URL=http://127.0.0.1:${PORT}`);
log('\n（前两行给我连 MCP 用，第三行是「小游戏」页面转发用。）');
if (!passed) {
  log('\n自检没过，先别加 .env。把 pm2 logs workkk 最后几行发我。');
}
log('──────────────────────────────────────────────');
