// 购物页 /shopping：心愿单和购物记录是同一串东西，按状态分组排下来。
//
// 「待支付」排在最上面并且单独一张醒目的卡：那是唯一需要她现在动手的事。
// 其他按 待收货 → 待下单 → 已请示 → 想要 → 已完成 → 取消了 排。
//
// 和其他页一样是服务端渲染，没有 JavaScript 也能看、也能改状态（普通 form 提交）。
// 标题用 page-title.js 那一套（三颗星 + 晨暮星 + 「Shopping ✦ 购物」），大小和心绪、日记、梦境一样；
// 早晚四张脸、右上角菜单、星星转场都从 page-chrome.js 拿，所以天黑了它跟着变。
//
// 钱的那一步不在这一页：这边只是记账和改状态，点「去付款」是跳到商品或订单页自己付。

import {
  STATUS,
  STATUS_LABEL,
  STATUS_ORDER,
  KIND_LABEL,
  OPEN_STATUS,
  yuan,
  listItems,
  getItem,
  setStatus,
  removeItem,
  counts,
  listChats,
  addChat,
  monthStats,
  notifyPendingPay,
  handEnabled,
  MAX_PRICE,
  DAILY_ORDERS,
  ordersToday,
  MAX_CHAT_CHARS,
} from './shopping.js';
import { formatDateTime } from './wall-time.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 商品链接只放行 http(s)，别让 javascript: 这种进到 href 里
function safeUrl(value) {
  const v = String(value ?? '').trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(v) ? v : '';
}

const KIND_ICON = { taobao: '✦', takeout: '✧' };

// 下一步能改成哪几个状态。按钮只给真正用得上的那几个，不把七个全排出来
const NEXT = {
  want: ['asked', 'to_order', 'canceled'],
  asked: ['to_order', 'to_pay', 'canceled'],
  to_order: ['to_pay', 'canceled'],
  to_pay: ['to_receive', 'done', 'canceled'],
  to_receive: ['done', 'canceled'],
  done: ['to_receive'],
  canceled: ['want'],
};

function amountText(it) {
  if (!it.price_cents) return '';
  const qty = it.qty || 1;
  const total = it.price_cents * qty;
  return qty > 1 ? `¥${yuan(it.price_cents)} ×${qty} = ¥${yuan(total)}` : `¥${yuan(total)}`;
}

function renderItem(it, { detailed = false } = {}) {
  const url = safeUrl(it.url);
  const amount = amountText(it);
  const img = safeUrl(it.image);
  const title = escapeHtml(it.title);
  const head = url
    ? `<a class="item-title" href="${escapeHtml(url)}" target="_blank" rel="noopener">${title}</a>`
    : `<span class="item-title">${title}</span>`;
  const meta = [
    `<span class="kind">${KIND_ICON[it.kind] ?? '✦'} ${KIND_LABEL[it.kind] ?? it.kind}</span>`,
    it.shop ? `<span>${escapeHtml(it.shop)}</span>` : '',
    it.sku ? `<span>${escapeHtml(it.sku)}</span>` : '',
    it.order_no ? `<span>单号 ${escapeHtml(it.order_no)}</span>` : '',
    it.eta ? `<span>${escapeHtml(it.eta)}</span>` : '',
  ]
    .filter(Boolean)
    .join('<span class="dot" aria-hidden="true">·</span>');

  const reason = it.reason
    ? `<p class="reason"><span class="who">${escapeHtml(AI_NAME)}：</span>${escapeHtml(it.reason)}</p>`
    : '';
  const note = it.note ? `<p class="note">${escapeHtml(it.note)}</p>` : '';

  const buttons = (NEXT[it.status] ?? [])
    .map(
      (s) =>
        `<button type="submit" name="status" value="${s}" class="btn${
          s === 'canceled' ? ' btn-quiet' : ''
        }">${STATUS_LABEL[s]}</button>`
    )
    .join('');
  const payLink =
    url && it.status === 'to_pay'
      ? `<a class="btn btn-pay" href="${escapeHtml(url)}" target="_blank" rel="noopener">去付款</a>`
      : '';
  const detailLink = detailed ? '' : `<a class="btn btn-quiet" href="/shopping/${it.id}">详情</a>`;

  return `<article class="item s-${it.status}">
    ${img ? `<img class="thumb" src="${escapeHtml(img)}" alt="" loading="lazy" />` : ''}
    <div class="item-body">
      <div class="item-head">${head}${amount ? `<span class="price">${amount}</span>` : ''}</div>
      ${meta ? `<p class="meta">${meta}</p>` : ''}
      ${reason}
      ${note}
      <p class="when">#${it.id} · ${escapeHtml(formatDateTime(it.updated_at).slice(5))}</p>
      <form class="acts" method="post" action="/shopping/${it.id}/status">${buttons}</form>
      ${payLink || detailLink ? `<p class="links">${payLink}${detailLink}</p>` : ''}
    </div>
  </article>`;
}

function renderPending(items) {
  if (!items.length) return '';
  const lines = items
    .map((it) => {
      const url = safeUrl(it.url);
      const amount = amountText(it);
      return `<li>
        <span class="p-title">${escapeHtml(it.title)}</span>
        ${amount ? `<span class="p-price">${amount}</span>` : ''}
        ${url ? `<a class="btn btn-pay" href="${escapeHtml(url)}" target="_blank" rel="noopener">去付款</a>` : ''}
        <form method="post" action="/shopping/${it.id}/status" class="p-form">
          <button type="submit" name="status" value="to_receive" class="btn">付好了</button>
        </form>
      </li>`;
    })
    .join('');
  return `<section class="card pay" aria-labelledby="pay-title">
    <h2 id="pay-title" class="section-title">等你付钱的 ${items.length} 笔</h2>
    <ul class="pay-list">${lines}</ul>
    <p class="pay-note">付款这一步永远在你手里——${escapeHtml(AI_NAME)}只走到这里就停下。</p>
  </section>`;
}

function renderFilters(current) {
  const c = counts();
  const tabs = [
    { key: '', label: '全部' },
    { key: 'open', label: '进行中' },
    ...STATUS_ORDER.map((s) => ({ key: s, label: STATUS_LABEL[s] })),
  ];
  return `<nav class="tabs" aria-label="按状态筛">${tabs
    .map((t) => {
      const n =
        t.key === 'open'
          ? OPEN_STATUS.reduce((s, k) => s + (c[k] ?? 0), 0)
          : t.key
            ? c[t.key] ?? 0
            : null;
      const on = (current || '') === t.key;
      return `<a class="tab${on ? ' on' : ''}" href="${
        t.key ? `/shopping?status=${t.key}` : '/shopping'
      }"${on ? ' aria-current="page"' : ''}>${t.label}${n ? `<small>${n}</small>` : ''}</a>`;
    })
    .join('')}</nav>`;
}

function renderMoney() {
  const m = monthStats();
  const bits = [
    `${m.month} 记下 ${m.count} 件·¥${yuan(m.spentCents)}${m.budgetCents ? ` / 预算 ¥${yuan(m.budgetCents)}` : ''}`,
    MAX_PRICE ? `单件上限 ¥${MAX_PRICE.toFixed(2)}` : '',
    DAILY_ORDERS ? `今天 ${ordersToday()}/${DAILY_ORDERS} 单` : '',
    handEnabled() ? '' : '还没配本机的手，现在只能记不能买',
  ].filter(Boolean);
  return `<ul class="chips">${bits.map((b) => `<li class="chip">${escapeHtml(b)}</li>`).join('')}</ul>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6;
    --track: #f3e9ef; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink); font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, #efe7f4 0%, #f9f0ee 55%, #fdf8f2 100%); }
  body::before { content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 0;
    background-image:
      radial-gradient(1.5px 1.5px at 12% 18%, rgba(230, 182, 82, 0.9) 50%, transparent 51%),
      radial-gradient(1px 1px at 78% 9%, rgba(215, 121, 159, 0.8) 50%, transparent 51%),
      radial-gradient(2px 2px at 88% 36%, rgba(230, 182, 82, 0.7) 50%, transparent 51%),
      radial-gradient(1px 1px at 30% 62%, rgba(215, 121, 159, 0.7) 50%, transparent 51%),
      radial-gradient(1.5px 1.5px at 64% 78%, rgba(230, 182, 82, 0.8) 50%, transparent 51%),
      radial-gradient(1px 1px at 8% 88%, rgba(155, 74, 122, 0.6) 50%, transparent 51%),
      radial-gradient(1px 1px at 94% 70%, rgba(230, 182, 82, 0.8) 50%, transparent 51%); }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 22px 16px 48px; }
  .title { margin: 0; }
  .mood-line { margin: 12px auto 0; max-width: 90%; font-size: 13px; line-height: 1.5; color: var(--muted); }
  .mood-line .mood-label { color: var(--accent); margin-right: 4px; }
  .card { background: var(--card); border-radius: 16px; padding: 16px; margin-bottom: 14px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .section-title { font-size: 15px; margin: 0 0 10px; color: var(--accent); letter-spacing: 0.1em; }
  .notice { font-size: 14px; line-height: 1.6; border-left: 4px solid var(--gold); }

  /* 等你付钱的那几笔：唯一醒目的一张 */
  .pay { border: 1px solid #f0d9a6; background: linear-gradient(180deg, #fff8ea 0%, var(--card) 70%); }
  .pay-list { list-style: none; margin: 0; padding: 0; }
  .pay-list li { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 0;
    border-bottom: 1px solid var(--line); }
  .pay-list li:last-child { border-bottom: none; }
  .p-title { flex: 1; min-width: 8em; font-size: 15px; }
  .p-price { font-family: Georgia, "Times New Roman", serif; font-weight: 700; color: #8a5a14; }
  .p-form { margin: 0; }
  .pay-note { margin: 10px 0 0; font-size: 12px; color: var(--muted); }

  .chips { list-style: none; margin: -4px 0 14px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; }
  .chip { font-size: 12px; padding: 5px 12px; border-radius: 999px; background: #fff6e3; color: #6b4513;
    border: 1px solid #f0d9a6; }

  .tabs { display: flex; gap: 6px; overflow-x: auto; -webkit-overflow-scrolling: touch; margin: 0 0 14px;
    padding-bottom: 4px; }
  .tabs::-webkit-scrollbar { height: 3px; }
  .tabs::-webkit-scrollbar-thumb { background: #e3d2de; border-radius: 3px; }
  .tab { flex: none; display: inline-flex; align-items: center; gap: 4px; min-height: 34px; padding: 0 12px;
    border-radius: 999px; font-size: 13px; text-decoration: none; color: var(--muted); background: var(--card);
    border: 1px solid var(--line); white-space: nowrap; }
  .tab.on { color: #fff; background: var(--accent); border-color: var(--accent); }
  .tab small { font-size: 11px; opacity: 0.8; }

  .group-title { display: flex; align-items: center; gap: 8px; margin: 18px 4px 8px; font-size: 13px;
    letter-spacing: 0.12em; color: var(--accent); }
  .group-title::after { content: ''; flex: 1; height: 1px; background: var(--line); }

  .item { display: flex; gap: 12px; background: var(--card); border-radius: 16px; padding: 14px; margin-bottom: 10px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); border-left: 4px solid var(--c1, #e58fb1); }
  .s-to_pay { --c1: #e6b652; }
  .s-to_receive { --c1: #e9a162; }
  .s-to_order { --c1: #e38fb8; }
  .s-asked { --c1: #c4a2e0; }
  .s-want { --c1: #e58fb1; }
  .s-done { --c1: #a8c3a0; }
  .s-canceled { --c1: #c9bfc6; }
  .thumb { flex: none; width: 64px; height: 64px; border-radius: 12px; object-fit: cover; background: #f6eef3; }
  .item-body { flex: 1; min-width: 0; }
  .item-head { display: flex; align-items: baseline; gap: 10px; }
  .item-title { flex: 1; min-width: 0; font-size: 15px; font-weight: 600; color: var(--ink); text-decoration: none; }
  a.item-title:hover { color: var(--accent); }
  .price { font-family: Georgia, "Times New Roman", serif; font-weight: 700; white-space: nowrap; }
  .meta { margin: 6px 0 0; font-size: 12px; color: var(--muted); display: flex; flex-wrap: wrap; gap: 4px;
    align-items: center; }
  .meta .dot { opacity: 0.5; }
  .kind { color: var(--accent); }
  .reason { margin: 8px 0 0; font-size: 14px; line-height: 1.6; }
  .reason .who { color: var(--accent); }
  .note { margin: 6px 0 0; font-size: 13px; color: var(--muted); line-height: 1.6; }
  .when { margin: 8px 0 0; font-size: 11px; color: #a597ab; }

  .acts, .links { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
  .btn { display: inline-flex; align-items: center; min-height: 32px; padding: 0 12px; border-radius: 999px;
    font-size: 13px; font-family: inherit; text-decoration: none; cursor: pointer;
    color: #fff; background: var(--accent); border: 1px solid var(--accent); }
  .btn:active { opacity: 0.85; }
  .btn-quiet { color: var(--muted); background: #fff; border-color: var(--line); }
  .btn-pay { color: #5a3a05; background: #ffd98a; border-color: #f0c96a; }
  .btn:focus-visible, .tab:focus-visible, a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

  /* 详情页的客服对话 */
  .chat { list-style: none; margin: 0; padding: 0; }
  .chat li { margin-bottom: 10px; display: flex; }
  .chat .bubble { max-width: 80%; padding: 9px 13px; border-radius: 14px; font-size: 14px; line-height: 1.6; }
  .chat .me { margin-left: auto; }
  .chat .me .bubble { background: #f6eef3; border-top-right-radius: 4px; }
  .chat .them .bubble { background: #fff6e3; border-top-left-radius: 4px; }
  .chat .w { display: block; font-size: 11px; color: #a597ab; margin-top: 4px; }
  .say { display: flex; gap: 8px; margin: 12px 0 0; }
  .say input { flex: 1; min-width: 0; min-height: 38px; padding: 0 12px; border-radius: 12px; font: inherit;
    font-size: 14px; color: var(--ink); background: #fff; border: 1px solid var(--line); }
  .say input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

  .empty { font-size: 14px; color: var(--muted); line-height: 1.7; }
  .back { display: inline-block; margin: 0 0 12px; font-size: 13px; color: var(--accent); text-decoration: none; }
  .danger { margin-top: 14px; }
  .danger .btn { color: #8a3a3a; background: #fff; border-color: #e6c6c6; }
  .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
${PAGE_TITLE_CSS}`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><main>${renderMenu('/shopping')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

function hero(note) {
  return renderPageTitle('Shopping', '购物', {
    note: note ? `<p class="mood-line"><span class="mood-label">现在：</span>${escapeHtml(note)}</p>` : '',
  });
}

function renderList(status, kind) {
  const c = counts();
  const openBits = STATUS_ORDER.filter((s) => OPEN_STATUS.includes(s) && c[s]).map(
    (s) => `${STATUS_LABEL[s]} ${c[s]}`
  );
  const note = openBits.length ? openBits.join('、') : '没有待办的';

  const items = listItems({ status: status || undefined, kind: kind || undefined, limit: 200 });
  // 待支付那张卡只在「全部」「进行中」「待支付」这三种视图下出现
  const showPending = !status || status === 'open' || status === 'to_pay';
  const pending = showPending ? items.filter((i) => i.status === 'to_pay') : [];

  const groups = STATUS_ORDER.map((s) => {
    const rows = items.filter((i) => i.status === s);
    if (!rows.length) return '';
    return `<h2 class="group-title">${STATUS_LABEL[s]}<span class="sr-only">，${rows.length} 件</span></h2>
      ${rows.map((it) => renderItem(it)).join('')}`;
  }).join('');

  const body = items.length
    ? groups
    : `<div class="card empty">这里还空着。${escapeHtml(AI_NAME)}逛到喜欢的东西就会收进来，你也可以跟他说「帮我点一杯冰美式」。</div>`;

  return layout(
    '购物 · 晨暮星',
    `${hero(note)}
    ${renderPending(pending)}
    ${renderMoney()}
    ${renderFilters(status)}
    ${body}`
  );
}

function renderDetail(it) {
  const chats = listChats(it.id, 60);
  const bubbles = chats.length
    ? `<ul class="chat">${chats
        .map((m) => {
          const me = m.who !== 'seller';
          const who = m.who === 'seller' ? '店家' : m.who === 'user' ? USER_NAME : AI_NAME;
          return `<li class="${me ? 'me' : 'them'}"><span class="bubble">${escapeHtml(
            m.content
          )}<span class="w">${escapeHtml(who)} · ${escapeHtml(formatDateTime(m.ts).slice(5))}</span></span></li>`;
        })
        .join('')}</ul>`
    : `<p class="empty">还没和店家说过话。</p>`;

  return layout(
    `${it.title} · 购物`,
    `${hero(STATUS_LABEL[it.status] ?? it.status)}
    <a class="back" href="/shopping">← 回购物清单</a>
    ${renderItem(it, { detailed: true })}
    <section class="card" aria-labelledby="chat-title">
      <h2 id="chat-title" class="section-title">和店家说过的话</h2>
      ${bubbles}
      <form class="say" method="post" action="/shopping/${it.id}/chat">
        <input type="text" name="content" maxlength="${MAX_CHAT_CHARS}" placeholder="记一句（你自己问到的回复也可以记在这）" aria-label="记一句" />
        <button type="submit" class="btn">记下</button>
      </form>
    </section>
    <form class="danger" method="post" action="/shopping/${it.id}/delete">
      <button type="submit" class="btn">从清单里删掉这一件</button>
    </form>`
  );
}

export function registerShoppingRoutes(app, { requireBasicAuth }) {
  app.get('/shopping', requireBasicAuth, (req, res) => {
    try {
      const status = String(req.query.status ?? '').trim();
      const kind = String(req.query.kind ?? '').trim();
      res.set('Cache-Control', 'no-store');
      res.send(
        renderList(
          status === 'open' || STATUS.includes(status) ? status : '',
          kind === 'taobao' || kind === 'takeout' ? kind : ''
        )
      );
    } catch (err) {
      console.error('shopping page: 渲染失败', err);
      res
        .status(500)
        .send(layout('出错了', '<div class="card notice" role="alert">购物页出错了，看一下 vesper 的日志。</div>'));
    }
  });

  app.get('/shopping/:id', requireBasicAuth, (req, res) => {
    const it = getItem(req.params.id);
    if (!it) {
      return res.status(404).send(layout('没找到', '<div class="card notice">清单里没有这一件。</div>'));
    }
    res.set('Cache-Control', 'no-store');
    res.send(renderDetail(it));
  });

  // 改状态。改成待支付时也往对话里提醒一句（不等巡检）
  app.post('/shopping/:id/status', requireBasicAuth, (req, res) => {
    const status = String(req.body?.status ?? '').trim();
    const it = getItem(req.params.id);
    if (!it || !STATUS.includes(status)) return res.redirect(303, '/shopping');
    const marked = setStatus(it.id, status);
    if (status === 'to_pay' && marked) {
      notifyPendingPay(marked, { force: true }).catch((err) =>
        console.error('shopping page: 待支付提醒没发出去', err.message)
      );
    }
    const from = String(req.get('referer') ?? '');
    res.redirect(303, from.includes(`/shopping/${it.id}`) ? `/shopping/${it.id}` : '/shopping');
  });

  app.post('/shopping/:id/chat', requireBasicAuth, (req, res) => {
    const it = getItem(req.params.id);
    if (!it) return res.redirect(303, '/shopping');
    addChat({ itemId: it.id, who: 'user', content: req.body?.content });
    res.redirect(303, `/shopping/${it.id}`);
  });

  app.post('/shopping/:id/delete', requireBasicAuth, (req, res) => {
    removeItem(req.params.id);
    res.redirect(303, '/shopping');
  });

  return { enabled: true, hand: handEnabled() };
}
