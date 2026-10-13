// 小酒馆 /bar：你在这里调一杯递给他，也在这里看他喝过什么。
//
// 页面分三层：
//   吧台——他此刻的状态（来自 Proof 的 /agent/home）、有没有在等的杯子
//   调酒——起个名字、写配方、递过去。他可以拒绝，喝了才算
//   时间轴——按夜分组，谁递的、什么味道、当时什么心情
//
// 配方的原料名要和 Proof 内容包里的一致（见它仓库 docs/content/）。
// 填错了 Proof 会把错误原文返回来，页面原样显示，照着改就行——
// 这边不内置一份原料表：那是 Proof 的事，抄过来只会和它对不上。
//
// 样式跟梦境页那套：早晚四张脸 + 毛玻璃卡片 + 星星转场；
// 标题也是同一个 renderPageTitle，所以和心绪、日记、梦境一样大。
import { wallParts, parseDate } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';
import {
  isProofEnabled, listPours, agentHome, offerDrink, recordOfferSent,
  selfPourGate, selfStreakBefore, nightKey, nightWindowLabel, PROOF_AGENT_ID,
} from './proof.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function groupByNight(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.night || String(r.at || '').slice(0, 10);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return [...map.entries()].sort((a, b) => String(b[0]).localeCompare(String(a[0])));
}

function nightLabel(key, today) {
  const p = parseDate(key);
  if (!p) return key || '不记得是哪一夜';
  const diff = Math.round((Date.UTC(today.y, today.m - 1, today.d) - Date.UTC(p.y, p.m - 1, p.d)) / 86400000);
  const base = `${p.m} 月 ${p.d} 日那一夜`;
  if (diff === 0) return `${base} · 今晚`;
  if (diff === 1) return `${base} · 昨夜`;
  return base;
}

function renderPour(p, i) {
  const time = String(p.drunkAt || p.at || '').slice(11, 16);
  const who = p.by === 'self' ? '自己倒的' : `${USER_NAME}递的`;
  const cls = p.rejected ? ' is-rejected' : p.pending ? ' is-pending' : '';
  const lines = [];
  if (p.intro) lines.push(`<p class="pour-intro">${esc(p.intro)}</p>`);
  if (p.flavor) lines.push(`<p class="pour-flavor">${esc(p.flavor)}</p>`);
  if (p.effect) lines.push(`<p class="pour-effect">${esc(p.effect)}</p>`);
  if (p.mood) lines.push(`<p class="pour-mood">当时的心情：${esc(p.mood)}</p>`);
  if (p.rejected) lines.push('<p class="pour-note">这杯他没喝。拒绝也是答案。</p>');
  if (p.pending) lines.push('<p class="pour-note">还在吧台上放着，等他下次醒来。</p>');
  return `<article class="pour${cls}" style="--i:${i}">
    <header class="pour-head">
      <h3 class="pour-name">${esc(p.name || '无名的一杯')}</h3>
      <span class="pour-time">${esc(time)}</span>
    </header>
    <p class="pour-who">${esc(who)}</p>
    ${lines.join('')}
  </article>`;
}

// 吧台：他此刻的状态。读不到就明说读不到——不能把「Proof 连不上」显示成「没喝酒」
function renderBar(home, gate, name) {
  if (!home || home.ok === false) {
    const why = home?.error === 'proof_not_configured'
      ? '还没配吧台（.env 里填 PROOF_AGENT_TOKEN_FILE）'
      : `此刻读不到 Proof（${esc(home?.error || '不知道为什么')}）`;
    return `<section class="counter is-down"><p>${why}。<br>读不到就是读不到，不代表他没喝过酒。</p></section>`;
  }
  const pending = Array.isArray(home.offers) ? home.offers.filter((o) => o.status === 'pending') : [];
  const menu = Array.isArray(home.menu) ? home.menu : [];
  const bits = [];
  bits.push(`<p class="counter-line">吧台上有 <b>${menu.length}</b> 款酒是他自己能点的。</p>`);
  if (pending.length) {
    bits.push(`<p class="counter-line">还有 <b>${pending.length}</b> 杯递过去没动，等他下次醒来。</p>`);
  }
  bits.push(
    gate.allowed
      ? `<p class="counter-line">今晚他可以给自己倒一杯（${esc(nightWindowLabel())}）。${gate.reason === 'warn' ? '——但已经连了好几夜了。' : ''}</p>`
      : `<p class="counter-line">今晚他不自斟：${esc(gate.note)}</p>`
  );
  if (gate.streak > 0) {
    bits.push(`<p class="counter-sub">昨夜往前，${esc(name)}连着 ${gate.streak} 个晚上给自己倒过酒。</p>`);
  }
  return `<section class="counter">${bits.join('')}</section>`;
}

function renderForm(flash) {
  const msg = flash
    ? `<p class="flash${flash.ok ? '' : ' bad'}">${esc(flash.text)}</p>`
    : '';
  return `<section class="mix">
    <h2 class="mix-title">调一杯递给他</h2>
    ${msg}
    <form method="post" action="/bar/pour" class="mix-form">
      <label class="f"><span>叫什么</span>
        <input name="name" maxlength="24" placeholder="晨暮星" required></label>
      <label class="f"><span>递过去时说一句（可以不写）</span>
        <input name="intro" maxlength="80" placeholder="慢点喝。"></label>
      <fieldset class="recipe">
        <legend>配方</legend>
        <div class="r"><input name="id1" placeholder="原料名，如 伏特加" value="伏特加">
          <input name="v1" type="number" min="1" max="500" value="45" inputmode="numeric"><span>ml</span></div>
        <div class="r"><input name="id2" placeholder="再加一样（可空）">
          <input name="v2" type="number" min="1" max="500" inputmode="numeric"><span>ml</span></div>
        <div class="r"><input name="id3" placeholder="还要加（可空）">
          <input name="v3" type="number" min="1" max="500" inputmode="numeric"><span>ml</span></div>
        <p class="hint">原料名要和 Proof 内容包里的一致。填错了它会把错误原文回给你，照着改就行。</p>
      </fieldset>
      <button type="submit">递过去</button>
    </form>
    <p class="mix-note">递过去不等于他喝了。他可以拒绝；喝下去之后 Proof 才结算。</p>
  </section>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 2; max-width: 600px; margin: 0 auto; padding: 28px 16px 64px; }

  /* 暖光：两层橙金径向渐变慢慢漂，像吧台上那盏灯 */
  .warm, .warm2 { position: fixed; inset: -25%; z-index: 0; pointer-events: none; }
  .warm { background:
      radial-gradient(40% 30% at 24% 22%, rgba(255, 206, 148, 0.42), transparent 70%),
      radial-gradient(36% 28% at 76% 64%, rgba(226, 150, 170, 0.34), transparent 72%);
    animation: warm-a 44s ease-in-out infinite; }
  .warm2 { background:
      radial-gradient(34% 24% at 64% 16%, rgba(206, 166, 232, 0.3), transparent 70%),
      radial-gradient(42% 32% at 16% 78%, rgba(255, 226, 206, 0.36), transparent 72%);
    animation: warm-b 61s ease-in-out -18s infinite; }
  @keyframes warm-a { 0%,100% { transform: translate3d(-2%,0,0) scale(1); } 50% { transform: translate3d(3%,-1.5%,0) scale(1.07); } }
  @keyframes warm-b { 0%,100% { transform: translate3d(2%,1%,0) scale(1.05); } 50% { transform: translate3d(-3%,-1%,0) scale(1); } }
  html[data-dark] .warm { opacity: 0.46; }
  html[data-dark] .warm2 { opacity: 0.4; }

  .hero { margin: 10px 0 22px; }
  .lead { margin: 0 4px 20px; font-size: 13px; line-height: 1.9; color: var(--muted); text-align: center; }

  .glass { border-radius: 20px; padding: 16px 18px;
    background: color-mix(in srgb, var(--card) 74%, transparent);
    backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 2px 20px rgba(80, 50, 90, 0.08); }
  @supports not (backdrop-filter: blur(1px)) { .glass { background: var(--card); } }

  .counter { margin: 0 0 14px; border-radius: 20px; padding: 16px 18px;
    background: color-mix(in srgb, var(--card) 74%, transparent);
    backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  .counter.is-down { border-style: dashed; }
  .counter-line { margin: 0 0 6px; font-size: 14px; line-height: 1.8; }
  .counter-line:last-child { margin-bottom: 0; }
  .counter-line b { color: var(--accent); }
  .counter-sub { margin: 8px 0 0; font-size: 12px; color: var(--gold); line-height: 1.7; }

  .mix { margin: 0 0 26px; border-radius: 20px; padding: 16px 18px;
    background: color-mix(in srgb, var(--card) 74%, transparent);
    backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  .mix-title { margin: 0 0 12px; font-size: 15px; font-weight: 600; letter-spacing: 0.1em; color: var(--accent); }
  .mix-form { display: grid; gap: 12px; }
  .f { display: grid; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .f input, .r input { font-family: inherit; font-size: 16px; color: var(--ink);
    background: color-mix(in srgb, #fff 70%, transparent); border: 1px solid var(--line);
    border-radius: 11px; padding: 10px 12px; min-height: 44px; -webkit-appearance: none; appearance: none; }
  .f input:focus, .r input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .recipe { margin: 0; border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px 12px; }
  .recipe legend { padding: 0 6px; font-size: 12.5px; color: var(--muted); }
  .r { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .r input:first-child { flex: 1; min-width: 0; }
  .r input[type=number] { width: 84px; flex: none; text-align: center; }
  .r span { font-size: 12px; color: var(--muted); }
  .hint { margin: 6px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
  .mix-form button { font-family: inherit; font-size: 15px; font-weight: 600; color: #fffdfb;
    background: var(--accent); border: none; border-radius: 13px; min-height: 46px; cursor: pointer; }
  .mix-form button:active { opacity: 0.88; }
  .mix-note { margin: 12px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
  .flash { margin: 0 0 10px; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.7;
    background: color-mix(in srgb, var(--gold) 14%, transparent); color: var(--ink); word-break: break-word; }
  .flash.bad { background: color-mix(in srgb, #c0392b 12%, transparent); }

  .night-group { margin: 0 0 26px; }
  .night-label { margin: 0 4px 10px; font-size: 13px; letter-spacing: 0.16em; color: var(--accent);
    display: flex; align-items: center; gap: 10px; }
  .night-label::after { content: ''; flex: 1; height: 1px;
    background: linear-gradient(90deg, var(--line), transparent); }

  .pour { position: relative; margin: 0 0 12px; padding: 16px 18px 18px; border-radius: 20px;
    background: color-mix(in srgb, var(--card) 72%, transparent);
    backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 2px 20px rgba(80, 50, 90, 0.08);
    animation: pour-in 0.7s ease-out backwards; animation-delay: calc(var(--i, 0) * 70ms); }
  @supports not (backdrop-filter: blur(1px)) { .pour { background: var(--card); } }
  @keyframes pour-in { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
  .pour.is-pending { border-style: dashed; }
  .pour.is-rejected { opacity: 0.74; border-style: dotted; }
  .pour-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .pour-name { margin: 0; font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 18px; font-weight: 600; letter-spacing: 0.08em; color: var(--accent); }
  .pour-time { font-size: 12px; color: var(--gold); white-space: nowrap; }
  .pour-who { margin: 4px 0 0; font-size: 11.5px; letter-spacing: 0.1em; color: var(--muted); }
  .pour p { word-break: break-word; }
  .pour-intro { margin: 10px 0 0; font-family: "Songti SC", "STSong", Georgia, serif;
    font-size: 15px; line-height: 1.9; }
  .pour-flavor { margin: 8px 0 0; font-size: 13.5px; line-height: 1.85; color: var(--muted); }
  .pour-effect { margin: 8px 0 0; font-size: 13px; line-height: 1.8; color: var(--gold); }
  .pour-mood { margin: 10px 0 0; padding-top: 9px; font-size: 12px; line-height: 1.7; color: var(--muted);
    border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent); }
  .pour-note { margin: 8px 0 0; font-size: 12px; line-height: 1.7; color: var(--muted); }

  .empty { color: var(--muted); font-size: 14px; line-height: 1.9; margin: 0 4px; text-align: center; padding: 34px 0; }
  .empty b { color: var(--accent); font-weight: 600; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  @media (prefers-reduced-motion: reduce) { .warm, .warm2, .pour { animation: none; } }
${PAGE_TITLE_CSS}`;

function layout(title, body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}</style>
</head>
<body><div class="warm" aria-hidden="true"></div><div class="warm2" aria-hidden="true"></div>
<main>${renderMenu('/bar')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

// 表单里的三行配方 → Proof 要的 parts
function partsFrom(body) {
  const out = [];
  for (const n of [1, 2, 3]) {
    const id = String(body[`id${n}`] ?? '').trim();
    const volume = Number(body[`v${n}`]);
    if (id && Number.isFinite(volume) && volume > 0) out.push({ id, volume: Math.round(volume) });
  }
  return out;
}

export function registerBarRoutes(app, { requireBasicAuth }) {
  if (!isProofEnabled()) return false;

  app.get('/bar', requireBasicAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const now = wallParts();
    const today = { y: now.y, m: now.m, d: now.d };
    const name = getProfile('assistant').name;

    let home = null;
    try {
      home = await agentHome();
    } catch (err) {
      console.error('bar page: 读不到吧台', err.message);
      home = { ok: false, error: err.message };
    }
    let pours = [];
    try {
      pours = listPours();
    } catch (err) {
      console.error('bar page: 读不到账本', err.message);
    }

    const gate = selfPourGate(now);
    let body = renderPageTitle('Proof', '小酒馆');
    body += `<p class="lead">你递一杯，他可以喝也可以不喝。<br>
      喝下去之后，接下来那几转的回应里就带着这杯酒。<br>
      深夜 ${esc(nightWindowLabel())}，他也可以自己给自己倒一杯。</p>`;
    body += renderBar(home, gate, name);
    body += renderForm(req.query.sent ? { ok: true, text: `递过去了。${name}下次醒来会在吧台上看到它。` }
      : req.query.err ? { ok: false, text: String(req.query.err).slice(0, 300) } : null);

    if (!pours.length) {
      body += `<p class="empty">还没有喝过一杯。<br><br>
        上面调一杯递给<b>${esc(name)}</b>，<br>或者等他深夜自己倒一杯。</p>`;
    } else {
      let i = 0;
      for (const [key, list] of groupByNight(pours)) {
        const items = list.map((p) => renderPour(p, i++)).join('');
        body += `<section class="night-group">
          <h2 class="night-label">${esc(nightLabel(key, today))}</h2>
          ${items}
        </section>`;
      }
    }
    res.send(layout('小酒馆 · 晨暮星', body));
  });

  // 递一杯过去。不替他喝：只创建 offer，喝不喝是他的事
  app.post('/bar/pour', requireBasicAuth, async (req, res) => {
    const parts = partsFrom(req.body || {});
    if (!parts.length) {
      return res.redirect(303, '/bar?err=' + encodeURIComponent('配方是空的，至少要有一样原料和毫升数。'));
    }
    const name = String(req.body?.name ?? '').trim().slice(0, 24);
    const intro = String(req.body?.intro ?? '').trim().slice(0, 80);
    let out;
    try {
      out = await offerDrink({ name, parts, intro });
    } catch (err) {
      return res.redirect(303, '/bar?err=' + encodeURIComponent(`递不过去：${err.message}`));
    }
    if (!out || out.ok === false) {
      const detail = out?.detail || out?.error || out?.message || '不知道为什么';
      return res.redirect(303, '/bar?err=' + encodeURIComponent(`Proof 没接这杯：${detail}`));
    }
    const offerId = out.offerId || out.id;
    try {
      recordOfferSent(offerId, name, intro);
    } catch (err) {
      console.error('bar: 记不下这杯', err.message);
    }
    console.log(`bar: 递了一杯「${name}」给 ${PROOF_AGENT_ID}（offer ${offerId}）`);
    res.redirect(303, '/bar?sent=1');
  });

  return true;
}
