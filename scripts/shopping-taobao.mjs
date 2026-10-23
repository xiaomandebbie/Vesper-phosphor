// 淘宝那只手。被 scripts/shopping-hand.mjs 调用。
//
// ── 这支代码是个起点，不是成品 ──
//
// 外卖那支（ai-order-takeout 的 order.js）是在真实的店、真实的风控上摔了
// 八十六跌才学会走路的形状，所以那边直接委派、一字不改。淘宝这边没有那么一支
// 现成的，所以这里写的是框架：CDP 接管浏览器、真鲠标点、每步留足迹、
// 撞登录墙就停手。选择器在 SELECTORS 里集中放着——淘宝改版就改这一处，
// 注释里写了怎么用 ai-order-takeout 的 hand.js（慢手）自己重新找。
//
// 前十趟大概还要摔。摔的时候先看足迹，别先看代码。
//
// ── 钱在哪里停 ──
//
// order() 走到结算页、读出实付金额就停。不碰密码框，不存支付密码。
// 这是硬的，不由配置开关控制。
//
// ── 掉登录了怎么回来（纯手机 + VPS 的关键） ──
//
// VPS 上没有你能看的屏幕。所以 loginQR() 把浏览器带到登录页、把二维码截成图，
// 由 shopping-mcp 当成图片发进聊天，你用手机淘宝扫一下。二维码 1-2 分钟过期，
// 过期了再叫一次。这是整个纯手机方案里唯一能把登录态补回来的路。
//
// ── 风控礼仪（别跳过） ──
//
// 慢。每步之间随机停一下。必须有头（headless 直接甄验证；VPS 上用 Xvfb 假屏幕）。
// UA 一个字别改。撞上登录墙或人机验证就停手——验证不是让你绕的，是让你停的。
//
// 依赖：npm i playwright-core（不下载浏览器，接管已开的那间）

import { chromium } from 'playwright-core';

const CDP = process.env.TAOBAO_CDP || process.env.SHOP_CDP || 'http://127.0.0.1:9222';
// 每步之间随机停多少毫秒。别调小。
const SLOW_MIN = Number(process.env.TAOBAO_SLOW_MIN || 700);
const SLOW_MAX = Number(process.env.TAOBAO_SLOW_MAX || 1800);

let browser = null;
let page = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const breathe = () => sleep(SLOW_MIN + Math.random() * (SLOW_MAX - SLOW_MIN));

// ── 选择器：淘宝改版只改这一处 ──
//
// 每一项都是一组备选，按顺序试，谁先命中用谁。都不中就报「没找到」并带上足迹。
// 重新找的办法（和 ai-order-takeout 的 hand.js 同一个路子）：
//   1. 把那间 Chrome 的窗口挪回屏幕，手动走一遍该走的流程；
//   2. 在要点的东西上右键「检查」，看它的 class / 文字；
//   3. 优先用文字（text=）而不是哈希 class——淘宝的 class 名每次发版都变，
//      文字不怎么变。
const SELECTORS = {
  // 搜索结果里的一个商品卡
  searchItem: ['[class*="Content--contentInner"] > div', '.items .item', '[data-category="auctions"]'],
  itemTitle: ['[class*="Title--title"]', '.title', 'a[title]'],
  itemPrice: ['[class*="Price--priceInt"]', '.price strong', '.g_price'],
  itemShop: ['[class*="ShopInfo--shopName"]', '.shopname', '.shop a'],
  itemLink: ['a[href*="item.htm"]', 'a[href*="detail.tmall"]'],
  // 详情页
  detailTitle: ['h1', '[class*="ItemTitle--mainTitle"]', '.tb-main-title'],
  detailPrice: ['[class*="Price--priceText"]', '[class*="highlightPrice"]', '.tb-rmb-num'],
  detailShop: ['[class*="ShopName--shopName"]', '.tb-shop-name', '.slogo-shopname'],
  detailSku: ['[class*="ValueItem--valueItem"]', '.tb-sku .tb-prop li a', '[class*="SkuContent"] [class*="valueItem"]'],
  detailImage: ['[class*="PicGallery"] img', '#J_ImgBooth', '.tb-booth img'],
  addCart: ['text=加入购物车', '#J_LinkBasket', '[class*="addCart"]'],
  buyNow: ['text=立即购买', '#J_LinkBuy', '[class*="buyNow"]'],
  // 客服
  contactSeller: ['text=联系客服', 'text=客服', '[class*="contact"]'],
  chatInput: ['textarea[class*="input"]', '.chat-input textarea', 'textarea'],
  chatSend: ['text=发送', 'button[class*="send"]'],
  chatBubble: ['[class*="message"] [class*="text"]', '.msg-content', '[class*="bubble"]'],
  // 结算页
  orderTotal: ['[class*="realPay"]', '#J_ActualFee', '.total-amount'],
  submitOrder: ['text=提交订单', '#submitOrderPC_1', '[class*="submitOrder"]'],
  // 登录页的二维码。淘宝用 canvas 画它，所以 canvas 放在前面
  loginQR: ['#login canvas', '[class*="qrcode"] canvas', 'canvas', '[class*="qrcode-img"]', '#J_QRCodeImg img'],
  // 二维码周围那一块（截图连着「手机淘宝扫一扫」那行字一起截，你看得明白些）
  loginBox: ['#login', '[class*="login-box"]', '[class*="qrcode"]'],
};

// 登录墙 / 人机验证的迹象。认到就停手。
const WALL_HINTS = [
  '请登录',
  '亲，请登录',
  '滑动验证',
  '安全验证',
  '验证码',
  '点击进行验证',
  'login.taobao.com',
  'Access Denied',
];

// ── 浏览器 ──

async function connect(trace) {
  if (browser && browser.isConnected?.()) return browser;
  trace.push(`连浏览器 ${CDP}`);
  browser = await chromium.connectOverCDP(CDP, { timeout: 10000 });
  return browser;
}

// 复用同一个标签页：每次开新页会堆出一堆标签，而且更像脚本
async function getPage(trace) {
  await connect(trace);
  if (page && !page.isClosed()) return page;
  const ctx = browser.contexts()[0];
  if (!ctx) throw new Error('那间浏览器里没有上下文，它真的开着吗');
  const pages = ctx.pages().filter((p) => !p.isClosed());
  page = pages.find((p) => /taobao\.com|tmall\.com/.test(p.url())) ?? pages[0] ?? (await ctx.newPage());
  page.setDefaultTimeout(20000);
  return page;
}

export async function closeBrowser() {
  try {
    // 只断开 CDP，不关浏览器
    await browser?.close();
  } catch {
    // 关不掉就算了
  }
  browser = null;
  page = null;
}

// ── 小工具 ──

const fail = (step, why, trace) => ({ ok: false, '哪步': step, '为什么': why, '足迹': trace });

async function pick(scope, keys, { timeout = 6000 } = {}) {
  for (const sel of keys) {
    const loc = scope.locator(sel).first();
    try {
      await loc.waitFor({ state: 'attached', timeout });
      if (await loc.count()) return loc;
    } catch {
      // 这个不中，试下一个
    }
  }
  return null;
}

async function textOf(scope, keys) {
  const loc = await pick(scope, keys, { timeout: 2000 });
  if (!loc) return '';
  try {
    return String((await loc.innerText()) ?? '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// 撞墙了没有。撞了就回一句话，谁调用谁负责停手
async function hitWall(p) {
  const url = p.url();
  if (/login\.taobao\.com|login\.tmall\.com/.test(url)) return '被带到登录页了（登录态掉了）';
  let body = '';
  try {
    body = String(await p.locator('body').innerText({ timeout: 3000 })).slice(0, 3000);
  } catch {
    return null;
  }
  const hit = WALL_HINTS.find((h) => body.includes(h));
  return hit ? `页面上出现了「${hit}」（登录或人机验证）` : null;
}

// 真鲠标点：先滚到眼前，停一下，再点
async function humanClick(loc) {
  await loc.scrollIntoViewIfNeeded();
  await breathe();
  await loc.click({ timeout: 10000 });
}

async function goto(p, url, trace) {
  trace.push(`去 ${url.slice(0, 120)}`);
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await breathe();
  const wall = await hitWall(p);
  if (wall) throw new Error(wall);
}

const priceOf = (s) => {
  const m = String(s ?? '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
};

// ── 动作 ──

async function ping() {
  const trace = [];
  try {
    const p = await getPage(trace);
    const url = p.url();
    trace.push(`当前在 ${url.slice(0, 100)}`);
    return { ok: true, message: `浏览器连上了，当前页：${url.slice(0, 100) || '空白页'}`, '足迹': trace };
  } catch (err) {
    return fail('连浏览器', `${err.message}（CDP ${CDP} 不可达？浏览器带着 --remote-debugging-port 开着吗）`, trace);
  }
}

// 把浏览器带到登录页，把二维码截成 PNG。
// 返回 { ok:true, png:<base64> }，由 shopping-mcp 当成图片发进聊天。
// 已经登着的时候不截，直接说本来就登着——免得你白扫一次。
async function loginQR() {
  const trace = [];
  try {
    const p = await getPage(trace);

    // 先看是不是本来就登着：去一下个人中心，没被踢回登录页就是登着的
    trace.push('先查现在是不是登着');
    await p.goto('https://i.taobao.com/my_taobao.htm', {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    }).catch(() => {});
    await breathe();
    if (!/login\.taobao\.com|login\.tmall\.com/.test(p.url())) {
      trace.push(`停在 ${p.url().slice(0, 80)}，没被踢回登录页`);
      return { ok: true, logged_in: true, message: '本来就登着，不用扫。', '足迹': trace };
    }

    trace.push('被踢回登录页了，去拿二维码');
    await p.goto('https://login.taobao.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await breathe();

    // 二维码是 canvas 画的，得等它真的画出来
    const qr = await pick(p, SELECTORS.loginQR, { timeout: 20000 });
    if (!qr) {
      return fail(
        '拿二维码',
        '登录页上没找到二维码（可能默认落在账号密码那个标签，或者选择器该改了）',
        trace
      );
    }
    await qr.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(1200); // canvas 画完要一点时间，截早了是空白

    // 连着周围那块截（带上「手机淘宝扫一扫」那行字）；没认出来就只截二维码
    const box = (await pick(p, SELECTORS.loginBox, { timeout: 3000 })) ?? qr;
    let shot;
    try {
      shot = await box.screenshot({ type: 'png', timeout: 15000 });
    } catch {
      shot = await qr.screenshot({ type: 'png', timeout: 15000 });
    }
    const png = Buffer.from(shot).toString('base64');
    trace.push(`截到了，${Math.round(png.length / 1024)}KB`);

    return {
      ok: true,
      logged_in: false,
      png,
      message: '二维码截好了。用手机淘宝扫一下，大概 1-2 分钟过期，过期了再叫一次。',
      '足迹': trace,
    };
  } catch (err) {
    return fail('拿二维码', err.message, trace);
  }
}

async function search({ keyword }) {
  const trace = [];
  try {
    const p = await getPage(trace);
    await goto(p, `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`, trace);

    const cards = await pick(p, SELECTORS.searchItem, { timeout: 15000 });
    if (!cards) return fail('搜店', '搜索结果里一个商品卡都没认出来（选择器该改了）', trace);

    // 滚两屏把怀加载的那批逗出来
    for (let i = 0; i < 2; i++) {
      await p.mouse.wheel(0, 900);
      await breathe();
    }

    const items = [];
    for (const sel of SELECTORS.searchItem) {
      const all = p.locator(sel);
      const n = Math.min(await all.count(), 20);
      if (!n) continue;
      trace.push(`用 ${sel} 认出 ${n} 个`);
      for (let i = 0; i < n; i++) {
        const card = all.nth(i);
        const title = await textOf(card, SELECTORS.itemTitle);
        if (!title) continue;
        const link = await pick(card, SELECTORS.itemLink, { timeout: 500 });
        let url = '';
        try {
          url = link ? String((await link.getAttribute('href')) ?? '') : '';
        } catch {
          url = '';
        }
        if (url.startsWith('//')) url = `https:${url}`;
        items.push({
          title,
          price: priceOf(await textOf(card, SELECTORS.itemPrice)),
          shop: (await textOf(card, SELECTORS.itemShop)) || undefined,
          url: url || undefined,
        });
      }
      if (items.length) break;
    }

    if (!items.length) return fail('搜店', '卡认出来了但一个标题都读不到', trace);
    return { ok: true, items, '足迹': trace };
  } catch (err) {
    return fail('搜店', err.message, trace);
  }
}

async function detail({ url }) {
  const trace = [];
  try {
    const p = await getPage(trace);
    await goto(p, url, trace);

    const title = await textOf(p, SELECTORS.detailTitle);
    if (!title) return fail('进店', '详情页读不到标题（没加载出来或选择器该改了）', trace);

    // 规格：最多抠 24 个，多了对他也没用
    const skus = [];
    const skuLoc = await pick(p, SELECTORS.detailSku, { timeout: 4000 });
    if (skuLoc) {
      for (const sel of SELECTORS.detailSku) {
        const all = p.locator(sel);
        const n = Math.min(await all.count(), 24);
        if (!n) continue;
        for (let i = 0; i < n; i++) {
          const t = String((await all.nth(i).innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
          if (t && !skus.includes(t)) skus.push(t);
        }
        if (skus.length) break;
      }
    }

    let image = '';
    const img = await pick(p, SELECTORS.detailImage, { timeout: 2000 });
    if (img) image = String((await img.getAttribute('src').catch(() => '')) ?? '');
    if (image.startsWith('//')) image = `https:${image}`;

    return {
      ok: true,
      detail: {
        title,
        price: priceOf(await textOf(p, SELECTORS.detailPrice)),
        shop: (await textOf(p, SELECTORS.detailShop)) || undefined,
        skus,
        image: image || undefined,
      },
      '足迹': trace,
    };
  } catch (err) {
    return fail('进店', err.message, trace);
  }
}

// 选规格：sku 文案要和页面上的字一模一样（先用 detail 查）。
// 多组规格用空格或顿号分开：「大杯 冰」
async function pickSku(p, sku, trace) {
  const wants = String(sku ?? '')
    .split(/[\s、,，/]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const picked = [];
  for (const want of wants) {
    let hit = null;
    for (const sel of SELECTORS.detailSku) {
      const loc = p.locator(sel).filter({ hasText: want }).first();
      if (await loc.count().catch(() => 0)) {
        hit = loc;
        break;
      }
    }
    if (!hit) {
      trace.push(`规格「${want}」在页上找不到`);
      throw new Error(`规格「${want}」和页面上的字对不上。先用看详情查真实的规格文案。`);
    }
    await humanClick(hit);
    picked.push(want);
    trace.push(`选了规格「${want}」`);
  }
  return picked.join(' ');
}

async function cart({ url, sku, qty }) {
  const trace = [];
  try {
    const p = await getPage(trace);
    await goto(p, url, trace);

    let picked = '';
    if (sku) picked = await pickSku(p, sku, trace);
    if (qty && qty > 1) trace.push(`数量 ${qty}（页面上没改，默认 1）`);

    const btn = await pick(p, SELECTORS.addCart, { timeout: 8000 });
    if (!btn) return fail('加购', '页上没找到「加入购物车」（该选规格先？或者选择器改了）', trace);
    await humanClick(btn);
    trace.push('点了加入购物车');
    await breathe();

    const wall = await hitWall(p);
    if (wall) return fail('加购', wall, trace);

    return { ok: true, sku: picked || undefined, message: '加进购物车了', '足迹': trace };
  } catch (err) {
    return fail('加购', err.message, trace);
  }
}

// 走到结算页、读出实付就停。不管 dry 是 true 还是 false，都不付款——这是硬的。
async function order({ url, sku, qty, max, dry }) {
  const trace = [];
  try {
    const p = await getPage(trace);
    await goto(p, url, trace);

    const title = await textOf(p, SELECTORS.detailTitle);
    let picked = '';
    if (sku) picked = await pickSku(p, sku, trace);
    if (qty && qty > 1) trace.push(`数量 ${qty}（页面上没改，默认 1）`);

    const buy = await pick(p, SELECTORS.buyNow, { timeout: 8000 });
    if (!buy) return fail('下单', '页上没找到「立即购买」', trace);
    await humanClick(buy);
    trace.push('点了立即购买');
    await p.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
    await breathe();

    const wall = await hitWall(p);
    if (wall) return fail('结算', wall, trace);

    const totalText = await textOf(p, SELECTORS.orderTotal);
    const paid = priceOf(totalText);
    trace.push(`结算页读到「${totalText || '?'}」`);
    if (paid == null) return fail('结算', '结算页读不出实付金额，所以停下了（宁可不买也不能盲买）', trace);

    if (max != null && paid > Number(max)) {
      return fail('闸', `实付 ¥${paid} 超过上限 ¥${max}，没提交。`, trace);
    }

    if (dry) {
      trace.push('试跑：读到金额就收手，没提交');
      return { ok: true, '实付': paid, title: title || undefined, sku: picked || undefined, dry: true, '足迹': trace };
    }

    const submit = await pick(p, SELECTORS.submitOrder, { timeout: 8000 });
    if (!submit) return fail('下单', '结算页没找到「提交订单」', trace);
    await humanClick(submit);
    trace.push('点了提交订单');
    await p.waitForLoadState('domcontentloaded', { timeout: 45000 }).catch(() => {});
    await breathe();

    // 到这里就是付款页了。停手。不找密码框，不填，不点。
    trace.push('单已生成，停在付款前');
    return {
      ok: true,
      '实付': paid,
      title: title || undefined,
      sku: picked || undefined,
      '为什么': '单生成了，要支付密码——这一步留给人。',
      '足迹': trace,
    };
  } catch (err) {
    return fail('下单', err.message, trace);
  }
}

// 和客服说一句。千牛是个独立的聊天窗，每次改版都不一样，
// 所以这支是整个文件里最脆的一段。找不到输入框就诚实报没找到，
// 不要假装发出去了——模型会把假消息当真的转述给小满。
async function chat({ url, message }) {
  const trace = [];
  try {
    const p = await getPage(trace);
    await goto(p, url, trace);

    const entry = await pick(p, SELECTORS.contactSeller, { timeout: 8000 });
    if (!entry) return fail('找客服', '详情页上没找到「联系客服」入口', trace);

    // 千牛一般开新窗口
    const ctx = p.context();
    const popupWait = ctx.waitForEvent('page', { timeout: 20000 }).catch(() => null);
    await humanClick(entry);
    trace.push('点了联系客服');
    const popup = await popupWait;
    const chatPage = popup ?? p;
    if (popup) {
      trace.push('客服窗口开在新标签里');
      await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
    }
    await breathe();

    const wall = await hitWall(chatPage);
    if (wall) return fail('找客服', wall, trace);

    const input = await pick(chatPage, SELECTORS.chatInput, { timeout: 15000 });
    if (!input) {
      return fail('说话', '客服窗里没找到输入框，这句话没发出去（千牛改版了）', trace);
    }

    await input.click();
    // 一个字一个字敲，不是粘贴
    await input.type(String(message), { delay: 60 + Math.random() * 80 });
    trace.push(`敲了 ${String(message).length} 个字`);
    await breathe();

    const send = await pick(chatPage, SELECTORS.chatSend, { timeout: 4000 });
    if (send) await humanClick(send);
    else await input.press('Enter');
    trace.push('发出去了');

    // 等店家回。最多等二十多秒，没回就诚实说没回
    await sleep(6000);
    const replies = [];
    for (let round = 0; round < 4 && !replies.length; round++) {
      for (const sel of SELECTORS.chatBubble) {
        const all = chatPage.locator(sel);
        const n = await all.count().catch(() => 0);
        if (!n) continue;
        // 只看最后几条，而且跳掉和我们刚发的一模一样的
        for (let i = Math.max(0, n - 4); i < n; i++) {
          const t = String((await all.nth(i).innerText().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
          if (t && t !== String(message).trim() && !replies.includes(t)) replies.push(t);
        }
        if (replies.length) break;
      }
      if (!replies.length) await sleep(5000);
    }
    trace.push(`读到 ${replies.length} 条回复`);

    return { ok: true, replies: replies.slice(0, 5), '足迹': trace };
  } catch (err) {
    return fail('问客服', err.message, trace);
  }
}

export const taobao = { ping, loginQR, search, detail, chat, cart, order, close: closeBrowser };
