// 主页下半部分那些动作卡。
//
// 小满 2026-11-04：「动作卡片这里加一份」——聊天页那份留着不动，
// 主页再摆一份。不是搬，是另一份。
//
// ── 叠成一摞（2026-11-04）──
//
// 叠法照搬动态页原来那套（见 commit 89cfc2f 之前的 moments-page.js）：
// 连着的两张，只有「同一件事」且「没隔多远」才叠。
// 光是时间近不够——一次醒来可能先逛论坛再听歌，那是两件事。
// moments 表里没存工具名，所以从正文认（activityTag）；
// activity.js 里那套说法是写死的，认得准，老卡片也一样能认。
//
// ── 为什么原来只能翻到一点点 ──
//
// 我上一版写死了「最近七天、最多六张」，而且是拿整段时间再滤 kind——
// 跟 moments-posts.js 里记下的那个坑一模一样：配额全花在窗口里了。
// 现在自己一条 SQL，WHERE 进查询，并且真分页（LIMIT ? OFFSET ?）。
//
// 颜色全走 var()：主页是灰阶的，写死原来那个暖黄框就跟不上。

import db from './state.js';
import { tidyActivityContent, tidyActivityDetail } from './actions/activity.js';

// 一页摆几摞。多了把主页挤成一条长账单
const PER_PAGE = 12;
// 和同一摞里最新那张相差不超过这么久就叠在一起。
// 一次醒来逛论坛连走几步，前后一般就一两分钟（和动态页原来同一个值）
const STACK_WINDOW_MS = 5 * 60 * 1000;

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 行动卡的正文是「MM-DD HH:mm\n做了什么」两行（和 chat-page.js 同一个拆法）
function splitCard(raw) {
  const text = tidyActivityContent(raw);
  const nl = text.indexOf('\n');
  if (nl < 0) return { when: '', body: text.trim() };
  return { when: text.slice(0, nl).trim(), body: text.slice(nl + 1).trim() };
}

// 这张卡是哪一件事。照搬动态页原来那份，改它的时候要两边一起改
function activityTag(content) {
  const s = String(content ?? '');
  if (/Lutopia|论坛/.test(s)) return 'forum';
  if (/记忆库|存入了一条记忆|OB /.test(s)) return 'memory';
  if (/在听什么|搜了搜歌|点了一首歌|歌词|批注本|评论区|认真听了|歌单|网易云|点歌台/.test(s)) {
    return 'music';
  }
  if (/共读|书架|读到第|《/.test(s)) return 'books';
  if (/花园/.test(s)) return 'garden';
  if (/上班|workkk/i.test(s)) return 'workkk';
  if (/锈潮/.test(s)) return 'xiuchao';
  if (/小酒馆|自斟|调了一杯/.test(s)) return 'proof';
  if (/钱包/.test(s)) return 'wallet';
  if (/星星罐|摇了摇/.test(s)) return 'jar';
  if (/节律/.test(s)) return 'mode';
  // 「TA 刚刚用了 X 的 Y」这种兜底写法，把 X 当成分组依据
  const m = /用了 (\S+) 的/.exec(s);
  if (m) return `srv:${m[1]}`;
  return 'other';
}

// 连着的同一件事归成一摞
function intoStacks(rows) {
  const out = [];
  for (const m of rows) {
    const last = out[out.length - 1];
    if (
      last &&
      activityTag(last[0].content) === activityTag(m.content) &&
      Math.abs(last[0].ts - m.ts) <= STACK_WINDOW_MS
    ) {
      last.push(m);
      continue;
    }
    out.push([m]);
  }
  return out;
}

function cardInner(m, inStack) {
  const { when, body } = splitCard(m.content);
  const detail = tidyActivityDetail(m.detail);
  const head = `<span class="act-when">${escapeHtml(when)}</span><span class="act-body">${escapeHtml(body)}</span>`;
  // 有详情的点开能看，没详情的就是一行字，不给它假的展开箭头
  const inner = detail
    ? `<details class="act-fold">
        <summary>${head}<i class="act-more" aria-hidden="true">\u25be</i><span class="sr-only">，展开详情</span></summary>
        <div class="act-detail">${escapeHtml(detail)}</div>
      </details>`
    : head;
  return `<article class="act${inStack ? ' act-item' : ''}" id="home-m${m.id}">${inner}</article>`;
}

// 一摞。只有一张就照常显示。
// 摞里从早到晚排，一开始停在最新那张；没有 JavaScript 时一张张排开
function renderStack(items) {
  if (items.length === 1) return cardInner(items[0], false);
  const ordered = [...items].reverse();
  const n = ordered.length;
  const dots = ordered.map((_, k) => `<i class="act-dot${k === n - 1 ? ' on' : ''}"></i>`).join('');
  return `<section class="act-stack" data-act-stack aria-label="同一件事的 ${n} 个行动">
    <div class="act-vp">${ordered.map((m) => cardInner(m, true)).join('')}</div>
    <div class="act-foot">
      <button type="button" class="act-arrow" data-act-prev aria-label="上一个行动"><span aria-hidden="true">\u2039</span></button>
      <span class="act-dots" aria-hidden="true">${dots}</span>
      <button type="button" class="act-arrow" data-act-next aria-label="下一个行动"><span aria-hidden="true">\u203a</span></button>
    </div>
    <p class="sr-only" aria-live="polite" data-act-live></p>
  </section>`;
}

// page 从 1 开始。多抽一条用来知道还有没有更早的，不单独数一遍
export function renderActivityStrip(page = 1) {
  const p = Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1;
  let rows;
  try {
    rows = stmt(
      "SELECT id, ts, content, detail FROM moments WHERE kind = 'activity' ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?"
    ).all(PER_PAGE + 1, (p - 1) * PER_PAGE);
  } catch (err) {
    console.error('home page: 读不到动作卡', err.message);
    return '';
  }
  const more = rows.length > PER_PAGE;
  if (more) rows.pop();
  if (!rows.length) {
    // 第一页就是空的：真的还没做过什么，整段不显示。
    // 翻过头了给一条路回第一页，不要让她卡在空页上
    return p > 1
      ? '<section class="act-strip"><p class="act-end">没有更早的了。<a href="/home">回到最近</a></p></section>'
      : '';
  }

  const stacks = intoStacks(rows).map(renderStack).join('');
  const nav = [];
  if (p > 1) {
    const prev = p - 1;
    nav.push(`<a href="${prev === 1 ? '/home' : `/home?act=${prev}`}">\u2039 更新</a>`);
  }
  if (more) nav.push(`<a href="/home?act=${p + 1}">更早 \u203a</a>`);

  return `<section class="act-strip" aria-label="做过的事">
    <h2 class="act-title">做过的事${p > 1 ? `（第 ${p} 页）` : ''}</h2>
    ${stacks}
    ${nav.length ? `<p class="act-nav">${nav.join('<span aria-hidden="true"> · </span>')}</p>` : ''}
  </section>`;
}

export const ACTIVITY_STRIP_CSS = `
  .act-strip { margin: 26px 0 0; }
  .act-title { margin: 0 4px 10px; font-size: 13px; font-weight: 500; letter-spacing: 0.14em;
    color: var(--muted, #5e5e5e); }
  .act { margin-bottom: 10px; padding: 12px 14px; border-radius: 14px;
    background: var(--card, #fdfdfd); border: 1px solid var(--line, #e2e2e2);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); }
  .act-when { display: block; font-size: 11px; letter-spacing: 0.05em; color: var(--muted, #5e5e5e);
    font-variant-numeric: tabular-nums; }
  .act-body { display: block; margin-top: 3px; font-size: 14px; line-height: 1.55;
    color: var(--ink, #252525); word-break: break-word; }
  .act-fold > summary { list-style: none; cursor: pointer; position: relative; padding-right: 20px; }
  .act-fold > summary::-webkit-details-marker { display: none; }
  .act-more { position: absolute; right: 0; top: 50%; margin-top: -8px; font-style: normal;
    font-size: 12px; color: var(--gold, #818181); transition: transform 0.2s ease; }
  .act-fold[open] .act-more { transform: rotate(180deg); }
  .act-detail { margin-top: 9px; padding: 10px 12px; border-radius: 10px;
    background: var(--card-soft, #f2f2f2); color: var(--ink, #252525);
    font-size: 12.5px; line-height: 1.6; white-space: pre-wrap; word-break: break-word;
    max-height: 300px; overflow-y: auto; }

  /* 一摞。没有 JavaScript 时 .ready 加不上，于是一张张排开，
     所以跟叠有关的规则全挂在 .ready 下面 */
  .act-stack { margin-bottom: 10px; }
  .act-stack .act { margin-bottom: 0; }
  .act-stack .act + .act { margin-top: 10px; }
  .act-foot { display: none; }
  .act-stack.ready .act-item[hidden] { display: none; }
  .act-stack.ready .act-vp { position: relative; padding-bottom: 8px; }
  /* 后面露出两层卡边，让人看得出这是一摞 */
  .act-stack.ready .act-vp::before, .act-stack.ready .act-vp::after {
    content: ''; position: absolute; height: 18px; border: 1px solid var(--line, #e2e2e2);
    border-top: none; border-radius: 0 0 14px 14px; background: var(--card, #fdfdfd); }
  .act-stack.ready .act-vp::before { left: 7px; right: 7px; bottom: 3px; z-index: 1; }
  .act-stack.ready .act-vp::after { left: 14px; right: 14px; bottom: -1px; z-index: 0; opacity: 0.55; }
  .act-stack.ready .act-item { position: relative; z-index: 2; }
  .act-stack.ready .act-foot { display: flex; align-items: center; justify-content: center;
    gap: 10px; margin-top: 12px; }
  .act-arrow { min-width: 36px; min-height: 36px; padding: 0; border: 0; border-radius: 10px;
    background: none; color: var(--gold, #818181); font-size: 20px; line-height: 1; cursor: pointer; }
  .act-arrow:active { background: var(--card-soft, #f2f2f2); }
  .act-dots { display: inline-flex; align-items: center; gap: 5px; }
  .act-dot { width: 5px; height: 5px; border-radius: 3px; background: var(--line, #e2e2e2);
    transition: width 0.25s ease, background-color 0.25s ease; }
  .act-dot.on { width: 14px; background: var(--gold, #818181); }

  .act-nav { display: flex; justify-content: center; gap: 4px; margin: 16px 0 0; font-size: 13px; }
  .act-nav a { min-height: 44px; display: inline-flex; align-items: center; padding: 0 10px;
    color: var(--accent, #4d4d4d); text-decoration: none; }
  .act-end { margin: 0; text-align: center; font-size: 13px; color: var(--muted, #5e5e5e); }
  .act-end a { margin-left: 6px; color: var(--accent, #4d4d4d); }
  @media (prefers-reduced-motion: reduce) { .act-more, .act-dot { transition: none; } }
`;

// 一摞里只露一张，左右箭头 / 左右滑动轮换，到头了从另一头接上。
// 报错也只是退回一张张排开，不影响页面其他部分
export const ACTIVITY_STRIP_SCRIPT = `(function () {
  document.querySelectorAll('[data-act-stack]').forEach(function (stack) {
    var items = [].slice.call(stack.querySelectorAll('.act-item'));
    if (items.length < 2) return;
    stack.classList.add('ready');
    var dots = [].slice.call(stack.querySelectorAll('.act-dot'));
    var live = stack.querySelector('[data-act-live]');
    var vp = stack.querySelector('.act-vp');
    var i = items.length - 1;
    function show(n) {
      n = (n + items.length) % items.length;
      items.forEach(function (el, k) { el.hidden = k !== n; });
      dots.forEach(function (d, k) { d.classList.toggle('on', k === n); });
      if (live && n !== i) live.textContent = '第 ' + (n + 1) + ' 个，共 ' + items.length + ' 个';
      i = n;
    }
    stack.querySelector('[data-act-prev]').addEventListener('click', function () { show(i - 1); });
    stack.querySelector('[data-act-next]').addEventListener('click', function () { show(i + 1); });
    var x0 = null, y0 = null;
    vp.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY;
    }, { passive: true });
    vp.addEventListener('touchend', function (e) {
      if (x0 === null) return;
      var t = e.changedTouches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      x0 = y0 = null;
      if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) show(i + (dx < 0 ? 1 : -1));
    });
    show(i);
  });
})();`;
