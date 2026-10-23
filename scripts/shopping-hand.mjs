#!/usr/bin/env node
// 家里那只手 —— 跑在有登录态的那台机器上（不是 VPS）。
//
// ── 为什么要分成两台机器 ──
//
// 晨暮星（vesper / phosphor）住在 VPS 上：没有浏览器、没有淘宝登录态、IP 在机房。
// 拿它去点外卖就是给风控送人头。真正能买东西的是家里那间登录态长住的 Chrome，
// 所以那边起这个小服务，晨暮星隔着 HTTP 请它动手。
//
// 配对的关系：
//   VPS 上 src/shopping.js 的 hand()  ─HTTP→  这个服务  ─spawn→  order.js / 淘宝的手
//
// ── 钱在哪里停下来 ──
//
// 这个服务自己不碰支付密码。外卖那边（order.js）是否自己付，取决于小满在这台机器上
// 有没有填 PAY_PWD / ~/.takeout_pay——那是她自己的选择，这边不替她决定。
// 没填的话 order.js 会走到密码框前停下，回一个带「要支付密码」的死讯；
// 晨暮星那边把这个当成「待支付」，往 Aru 的对话里发一句让她自己付。
//
// ── 请求和回复的形状 ──
//
// 全部是 POST + JSON，带 x-shopping-hand-token 头（和 VPS 那边的 SHOPPING_HAND_TOKEN 同一个）。
//   POST /ping             → { ok, message }
//   POST /taobao/search    { keyword }                    → { ok, items:[{title,price,shop,url}] }
//   POST /taobao/detail    { url }                        → { ok, detail:{title,price,shop,skus,image} }
//   POST /taobao/chat      { url, message }               → { ok, replies:[…] }
//   POST /taobao/cart      { url, sku, qty }              → { ok, sku }
//   POST /taobao/order     { url, sku, qty, max, dry }    → { ok, 实付, 单号?, eta? }
//   POST /takeout/order    { kw, 店含, dish, 规格, qty, max, addr, dry } → order.js 那行 JSON 原文
//
// 死讯的形状跟 order.js 学：{ ok:false, 哪步, 为什么, 足迹:[…] }。
// 足迹永远随死讯带上（order.js 的坑七十）——它说「手坏了」的时候，先看足迹，别先看代码。
//
// ── 怎么跑 ──
//
//   # 1. 一间登录态长住的 Chrome（别接管日常那个）
//   open -na "Google Chrome" --args --remote-debugging-port=9222 \
//     --user-data-dir="$HOME/.shop-chrome" --window-position=2000,2000 --window-size=1280,900
//
//   # 2. 装依赖（只要 playwright-core，不下载浏览器）
//   npm i playwright-core
//
//   # 3. 起手
//   SHOPPING_HAND_TOKEN=跟VPS同一个 \
//   TAKEOUT_ORDER_JS=/path/to/ai-order-takeout/script/order.js \
//   node scripts/shopping-hand.mjs
//
// 只听 127.0.0.1；跟 VPS 之间用 SSH 反向隧道打通（见 docs/13-shopping.md）。
// 别把这个端口直接暴在公网上——它背后是一个登录着的淘宝。

import http from 'node:http';
import { spawn } from 'node:child_process';
import { taobao } from './shopping-taobao.mjs';

const PORT = Number(process.env.SHOPPING_HAND_PORT || 18030);
const HOST = process.env.SHOPPING_HAND_HOST || '127.0.0.1';
const TOKEN = String(process.env.SHOPPING_HAND_TOKEN ?? '').trim();
// 点外卖那支脚本（ai-order-takeout 的 script/order.js）。没填就没有外卖能力，淘宝照旧能跑。
const ORDER_JS = String(process.env.TAKEOUT_ORDER_JS ?? '').trim();
const NODE_BIN = process.env.TAKEOUT_NODE || process.execPath;
// 外卖一趟最多跑多久。它要搜店、进店、挑菜、凑起送、结算，慢是应该的
const TAKEOUT_TIMEOUT_MS = Number(process.env.TAKEOUT_TIMEOUT_MS || 240000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function tokenOk(req) {
  if (!TOKEN) return true; // 没配 token 就不校；只听本机时可以这样
  const given = String(req.headers['x-shopping-hand-token'] ?? '');
  if (given.length !== TOKEN.length) return false;
  let diff = 0;
  for (let i = 0; i < TOKEN.length; i++) diff |= given.charCodeAt(i) ^ TOKEN.charCodeAt(i);
  return diff === 0;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      // 这个端点收的都是几百字节的小 JSON，超过 64KB 就不对劲
      if (raw.length > 65536) reject(new Error('body too large'));
    });
    req.on('end', () => {
      if (!raw.trim()) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' ? v : {});
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

// 点外卖：直接把参数交给 order.js，把它吐的那行 JSON 原样带回去。
// 不重写那支脚本——它是在真实的店、真实的风控上摔了八十六跌才学会走路的形状。
// 它的参数名就是中文的（店含 / 规格 / 续付 / 只清车……），shopping-mcp 那边已经按这套名字传了。
function takeout(args) {
  return new Promise((resolve) => {
    if (!ORDER_JS) {
      return resolve({
        ok: false,
        哪步: '配置',
        为什么: '这台机器没配 TAKEOUT_ORDER_JS，点不了外卖。',
      });
    }
    const payload = JSON.stringify(args ?? {});
    log('takeout →', payload.slice(0, 200));
    const child = spawn(NODE_BIN, [ORDER_JS, payload], {
      cwd: ORDER_JS.replace(/\/[^/]+$/, ''),
      env: process.env,
    });
    let out = '';
    let err = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      child.kill('SIGKILL');
      resolve({ ok: false, 哪步: '超时', 为什么: `order.js 跑了超过 ${Math.round(TAKEOUT_TIMEOUT_MS / 1000)} 秒还没回来` });
    }, TAKEOUT_TIMEOUT_MS);
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, 哪步: '起脚本', 为什么: e.message });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      // order.js 全程吐一行 JSON。有时前面还有日志，所以从后往前找第一行能解的
      const lines = out.split('\n').map((l) => l.trim()).filter(Boolean).reverse();
      for (const line of lines) {
        if (!line.startsWith('{')) continue;
        try {
          const v = JSON.parse(line);
          if (v && typeof v === 'object') {
            log('takeout ←', v.ok ? `ok 实付 ${v['实付'] ?? '?'}` : `挂在 ${v['哪步'] ?? '?'}`);
            return resolve(v);
          }
        } catch {
          // 不是那行，继续往前找
        }
      }
      resolve({
        ok: false,
        哪步: '读回复',
        为什么: `order.js 没吐出能读的 JSON（退码 ${code}）`,
        足迹: [out.slice(-600), err.slice(-600)].filter(Boolean),
      });
    });
  });
}

const ROUTES = {
  '/ping': async () => {
    const t = await taobao.ping();
    const bits = [
      t.ok ? '淘宝的浏览器连上了' : `淘宝那边连不上：${t.message ?? '?'}`,
      ORDER_JS ? '外卖脚本已配' : '外卖脚本没配',
    ];
    return { ok: t.ok, message: bits.join('；') };
  },
  '/taobao/search': (a) => taobao.search(a),
  '/taobao/detail': (a) => taobao.detail(a),
  '/taobao/chat': (a) => taobao.chat(a),
  '/taobao/cart': (a) => taobao.cart(a),
  '/taobao/order': (a) => taobao.order(a),
  '/takeout/order': (a) => takeout(a),
};

// 一次只做一件事：那间 Chrome 就一个，两个请求同时动它就是互相抢页面。
// 排队而不是报错：晨暮星那边调用本来就是串行的，这里只是兜一道。
let chain = Promise.resolve();
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

const server = http.createServer(async (req, res) => {
  const send = (code, body) => {
    const text = JSON.stringify(body);
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
    res.end(text);
  };

  if (req.method !== 'POST') return send(405, { ok: false, message: 'POST only' });
  if (!tokenOk(req)) {
    log('token 不对，已拒');
    return send(401, { ok: false, message: 'unauthorized' });
  }

  const path = String(req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/ping';
  const route = ROUTES[path];
  if (!route) return send(404, { ok: false, message: `这只手没有 ${path}` });

  let args;
  try {
    args = await readBody(req);
  } catch (err) {
    return send(400, { ok: false, message: err.message });
  }

  try {
    const out = await serial(() => route(args));
    send(200, out ?? { ok: false, message: '没回东西' });
  } catch (err) {
    // 异常原文可能带着整页 DOM 或者她的链接，只回 message
    log('出错', path, err.message);
    send(200, { ok: false, 哪步: '手', 为什么: err.message });
  }
});

server.listen(PORT, HOST, () => {
  log(`购物的手在 http://${HOST}:${PORT}`);
  log(`token ${TOKEN ? '已配' : '没配（只听本机时可以）'}；外卖脚本 ${ORDER_JS || '没配'}`);
  log('慢一点。一天不要跑很多趟。撞上验证就停手交给人。');
});

const bye = () => {
  log('收工');
  server.close();
  taobao.close().finally(() => process.exit(0));
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
