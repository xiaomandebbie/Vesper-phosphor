// 小酒馆 /bar：你在这里调一杯递给他，也在这里看他喝过什么。
//
// 页面分四层：
//   吧台——他此刻的状态（来自 Proof 的 /agent/home）、有没有在等的杯子
//   调酒——起个名字、写配方、递过去。他可以拒绝，喝了才算
//   酒架——原料清单和经典配方，点一下直接填进表单
//   时间轴——按夜分组，谁递的、什么味道、当时什么心情
//
// 调酒和酒架都是 <details>，默认收着（小满 2026-10-13 定：版面太长，
// 历史记录要翻好久才看到）。和批注、日历、星星罐那几处一个做法。
// 递完或者出错时自动张开（open），不然看不到那句回执。
//
// 原料表和配方是从 Proof 内容包（docs/content/原料表.md）抄过来的一份快捷清单，
// 只为了不用记名字。**真正的判定在 Proof 那边**：它换了内容包，这里就可能对不上，
// 填错了它会把错误原文回给我们，页面原样显示。所以这份清单是「提示」，不是「校验」。
import { wallParts, parseDate } from './wall-time.js';
import { getProfile } from './moments-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';
import {
  isProofEnabled, listPours, agentHome, offerDrink, recordOfferSent,
  selfPourGate, nightWindowLabel, reconcileOffers, PROOF_AGENT_ID,
} from './proof.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 配方表单最多几行。长岛冰茶要 7 样，所以留 8
const MAX_PARTS = 8;

// ══ 酒架：抄自 Proof 示例内容包的 25 项原料 ══
// note 写风味，让你知道它大概是什么味；不写的就是它本来没特征
const SHELF = [
  {
    group: '基酒',
    items: [
      { id: '金酒', abv: 43, ml: 60, note: '杜松子 · 柑橘皮 · 芔荜' },
      { id: '伏特加', abv: 40, ml: 45, note: '没有风味——这是它的特征' },
      { id: '白朗姆', abv: 40, ml: 45, note: '青草 · 淡糖蜜' },
      { id: '黑朗姆', abv: 40, ml: 60, note: '糖蜜 · 橡木 · 香草' },
      { id: '龙舌兰', abv: 40, ml: 45, note: '青草 · 胡椒 · 湿泥土' },
      { id: '威士忌', abv: 43, ml: 60, note: '泥煤 · 海盐 · 烧过的绳子' },
    ],
  },
  {
    group: '加香酒',
    items: [
      { id: '甜味美思', abv: 16, ml: 30, note: '香草 · 丁香 · 果干' },
      { id: '干味美思', abv: 18, ml: 10, note: '洋甘菊 · 白胡椒' },
      { id: '金巴利', abv: 25, ml: 30, note: '苦橙 · 龙胆根' },
    ],
  },
  {
    group: '利口酒',
    items: [
      { id: '橙皮利口酒', abv: 40, ml: 20, note: '橙皮 · 蜜' },
      { id: '咖啡利口酒', abv: 20, ml: 20, note: '咖啡 · 糖蜜（带咖啡因）' },
      { id: '苦艾酒', abv: 68, ml: 30, note: '茶芘 · 苦艾 · 药草——很烈' },
    ],
  },
  {
    group: '酿造酒',
    items: [
      { id: '清酒', abv: 15, ml: 90, note: '米 · 甜瓜 · 淡花香' },
      { id: '啤酒', abv: 5, ml: 330, note: '面包皮 · 干草 · 柠檬皮' },
      { id: '红葰萄酒', abv: 13, ml: 150, note: '黑莓 · 橡木 · 皮革' },
    ],
  },
  {
    group: '软饮与混合料',
    items: [
      { id: '汤力水', abv: 0, ml: 120, note: '奶宁的苦（带气泡）' },
      { id: '苏打水', abv: 0, ml: 120, note: '只有气泡，没有味道' },
      { id: '可乐', abv: 0, ml: 120, note: '焦糖 · 肉桂 · 橙皮' },
      { id: '青柠汁', abv: 0, ml: 20, note: '青柠' },
      { id: '柠檬汁', abv: 0, ml: 20, note: '柠檬' },
      { id: '糖浆', abv: 0, ml: 15, note: '蔗糖，粘稠' },
      { id: '浓缩咖啡', abv: 0, ml: 30, note: '咖啡 · 焦糖 · 一点酸（带咖啡因）' },
    ],
  },
  {
    group: '其他',
    items: [
      { id: '苦精', abv: 44, ml: 1, note: '按滴计，推「苦」和「香」' },
      { id: '盐', abv: 0, ml: 1, note: '杯口用' },
      { id: '水', abv: 0, ml: 120, note: '稀释是一等公民：降度数、降浓度' },
      { id: '冰', abv: 0, ml: 30, note: '同上' },
    ],
  },
];

// 16 杯成品。点一下整张表单都填好
const RECIPES = [
  { name: '马天尼', parts: [['金酒', 60], ['干味美思', 10]], note: '搅拌。冷、硬、干' },
  { name: '尼格罗尼', parts: [['金酒', 30], ['金巴利', 30], ['甜味美思', 30]], note: '搅拌。苦甲开头，甜收尾' },
  { name: '金汤力', parts: [['金酒', 45], ['汤力水', 120]], note: '加冰。最好入口的一杯' },
  { name: '玛格丽特', parts: [['龙舌兰', 50], ['橙皮利口酒', 20], ['青柠汁', 20]], note: '盐边。酸、烈、清醒' },
  { name: 'Espresso Martini', parts: [['伏特加', 40], ['咖啡利口酒', 20], ['浓缩咖啡', 30]], note: '酒精加咖啡因，醉着但清醒' },
  {
    name: '长岛冰茶',
    parts: [['金酒', 15], ['伏特加', 15], ['白朗姆', 15], ['龙舌兰', 15], ['橙皮利口酒', 15], ['柠檬汁', 20], ['可乐', 120]],
    note: '看着像冰茶。五种烈酒，很危险',
  },
  { name: '威士忌', parts: [['威士忌', 60]], note: '纯饮' },
  { name: '黑朗姆加冰', parts: [['黑朗姆', 60], ['冰', 30]], note: '' },
  { name: '龙舌兰', parts: [['龙舌兰', 45]], note: '纯饮' },
  { name: '伏特加', parts: [['伏特加', 45]], note: '纯饮。没有风味的那一杯' },
  { name: '金酒', parts: [['金酒', 60]], note: '纯饮' },
  { name: '清酒', parts: [['清酒', 90]], note: '温的' },
  { name: '啤酒', parts: [['啤酒', 330]], note: '一罐' },
  { name: '红葰萄酒', parts: [['红葰萄酒', 150]], note: '一杯' },
  { name: '苦艾酒兜水', parts: [['苦艾酒', 30], ['水', 120]], note: '传统兑水。小心' },
  { name: '白开水', parts: [['水', 200]], note: '真的只是水。但名字可以随你写' },
];

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
  const who = p.by === 'self' ? '自己倒的' : p.by === 'chat' ? '聊天里自己点的' : `${USER_NAME}递的`;
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

// 配方表单。前三行默认露着，剩下的点「再加一样」或者选了经典配方才展开
function renderRows() {
  const rows = [];
  for (let n = 1; n <= MAX_PARTS; n++) {
    const hidden = n > 3 ? ' is-extra' : '';
    const dv = n === 1 ? ' value="伏特加"' : '';
    const dvol = n === 1 ? ' value="45"' : '';
    rows.push(
      `<div class="r${hidden}" data-row="${n}">` +
      `<input name="id${n}" data-id="${n}" placeholder="原料名"${dv} autocomplete="off">` +
      `<input name="v${n}" data-v="${n}" type="number" min="1" max="999" inputmode="numeric" placeholder="ml"${dvol}>` +
      `<span>ml</span></div>`
    );
  }
  return rows.join('');
}

// 酒架：原料片 + 经典配方。都是 <details>，默认收着
function renderShelf() {
  const groups = SHELF.map((g) => {
    const chips = g.items
      .map(
        (it) =>
          `<button type="button" class="chip" data-ing="${esc(it.id)}" data-ml="${it.ml}"` +
          ` title="${esc(it.note)}">${esc(it.id)}<small>${it.abv ? `${it.abv}%` : '无酒精'}</small></button>`
      )
      .join('');
    return `<div class="shelf-group"><h4>${esc(g.group)}</h4><div class="chips">${chips}</div></div>`;
  }).join('');

  const recipes = RECIPES.map((r) => {
    const sum = r.parts.map(([id, ml]) => `${id} ${ml}`).join(' + ');
    return (
      `<button type="button" class="recipe" data-recipe="${esc(JSON.stringify(r.parts))}" data-name="${esc(r.name)}">` +
      `<span class="recipe-name">${esc(r.name)}</span>` +
      `<span class="recipe-parts">${esc(sum)}</span>` +
      (r.note ? `<span class="recipe-note">${esc(r.note)}</span>` : '') +
      `</button>`
    );
  }).join('');

  return `<section class="shelf">
    <details class="sh" id="shRecipes">
      <summary>🍸 经典配方（点一下直接填好）</summary>
      <div class="recipes">${recipes}</div>
      <p class="hint">名字不会自动填——起个只有你们懂的名字比照搬好。</p>
    </details>
    <details class="sh">
      <summary>🧴 原料架（点一下加进配方）</summary>
      ${groups}
      <p class="hint">长按或悬停能看到风味。水和冰也是正经原料：它们降度数、改质地。</p>
    </details>
    <details class="sh">
      <summary>✨ 两杯藏起来的</summary>
      <p class="secret">内容包里有两杯不在酒单上，要配方碋到条件才出来——
        光起这个名字没用。</p>
      <p class="secret"><b>五彩斑斓的黑</b>：风味散得足够开。一堆互不相干的东西全倒进去试试。</p>
      <p class="secret"><b>heaven</b>：所有成分都得是烈酒（ABV ≥ 35%），且不能有任何零度的东西——
        连水和冰都不行。</p>
      <p class="hint">这两条是 Proof 内容包里写明的，不是猜的。具体阈值以它那边为准。</p>
    </details>
  </section>`;
}

// 调酒台。整块收进 <details>：平时只一行，往下就是时间轴。
// 刚递完或者出错时自动张开，不然看不到回执
function renderForm(flash) {
  const msg = flash ? `<p class="flash${flash.ok ? '' : ' bad'}">${esc(flash.text)}</p>` : '';
  return `<details class="mix sh" id="mixBox"${flash ? ' open' : ''}>
    <summary>🍹 调一杯递给他</summary>
    ${msg}
    <form method="post" action="/bar/pour" class="mix-form" id="mixForm">
      <label class="f"><span>叫什么</span>
        <input name="name" id="drinkName" maxlength="24" placeholder="晨暮星" required autocomplete="off"></label>
      <label class="f"><span>递过去时说一句（可以不写）</span>
        <input name="intro" maxlength="80" placeholder="慢点喝。" autocomplete="off"></label>
      <fieldset class="recipe-box">
        <legend>配方</legend>
        <div id="rows">${renderRows()}</div>
        <div class="row-ops">
          <button type="button" id="addRow">＋ 再加一样</button>
          <button type="button" id="clearRows">清空</button>
        </div>
        <p class="hint">原料名要和 Proof 内容包里的一致。填错了它会把错误原文回给你，照着改就行。</p>
      </fieldset>
      <button type="submit" class="go">递过去</button>
    </form>
    <p class="mix-note">递过去不等于他喝了。他可以拒绝；喝下去之后 Proof 才结算。</p>
  </details>`;
}

// 点原料片、点经典配方、加行、清空。没有 JavaScript 时表单照样能手填
const FORM_SCRIPT = `(function () {
  var form = document.getElementById('mixForm');
  if (!form) return;
  var rows = Array.prototype.slice.call(document.querySelectorAll('#rows .r'));
  var mixBox = document.getElementById('mixBox');

  function idInput(row) { return row.querySelector('input[data-id]'); }
  function volInput(row) { return row.querySelector('input[data-v]'); }

  // 第一个原料名还空着的行；都满了就把下一个隐着的露出来
  function firstEmpty() {
    for (var i = 0; i < rows.length; i++) {
      if (!idInput(rows[i]).value.trim()) {
        rows[i].classList.remove('is-extra');
        return rows[i];
      }
    }
    return null;
  }

  function showUpTo(n) {
    for (var i = 0; i < rows.length; i++) {
      if (i < n) rows[i].classList.remove('is-extra');
    }
  }

  // 选了原料或配方就把调酒台张开，不然填进去也看不见
  function openMix() {
    if (mixBox && !mixBox.open) mixBox.open = true;
  }

  document.addEventListener('click', function (e) {
    // 原料片：加进第一个空行，带上它的常用量
    var chip = e.target.closest ? e.target.closest('.chip') : null;
    if (chip) {
      openMix();
      var row = firstEmpty();
      if (!row) return;
      idInput(row).value = chip.getAttribute('data-ing') || '';
      volInput(row).value = chip.getAttribute('data-ml') || '';
      return;
    }

    // 经典配方：整张表单重填。名字不动——起名字是你的事
    var rec = e.target.closest ? e.target.closest('.recipe') : null;
    if (rec) {
      var parts;
      try { parts = JSON.parse(rec.getAttribute('data-recipe') || '[]'); }
      catch (err) { return; }
      openMix();
      for (var i = 0; i < rows.length; i++) {
        idInput(rows[i]).value = '';
        volInput(rows[i]).value = '';
      }
      showUpTo(Math.max(3, parts.length));
      for (var j = 0; j < parts.length && j < rows.length; j++) {
        idInput(rows[j]).value = parts[j][0];
        volInput(rows[j]).value = parts[j][1];
      }
      var nameBox = document.getElementById('drinkName');
      if (nameBox && !nameBox.value.trim()) nameBox.setAttribute('placeholder', rec.getAttribute('data-name') || '');
      // 填完滚到表单，不用自己找
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
  });

  var add = document.getElementById('addRow');
  if (add) add.onclick = function () {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].classList.contains('is-extra')) {
        rows[i].classList.remove('is-extra');
        var box = idInput(rows[i]);
        if (box) box.focus();
        return;
      }
    }
  };

  var clear = document.getElementById('clearRows');
  if (clear) clear.onclick = function () {
    for (var i = 0; i < rows.length; i++) {
      idInput(rows[i]).value = '';
      volInput(rows[i]).value = '';
      if (i >= 3) rows[i].classList.add('is-extra');
    }
  };
})();`;

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

  .counter, .mix, .shelf { margin: 0 0 14px; border-radius: 20px; padding: 16px 18px;
    background: color-mix(in srgb, var(--card) 74%, transparent);
    backdrop-filter: blur(14px) saturate(1.1); -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent); }
  @supports not (backdrop-filter: blur(1px)) { .counter, .mix, .shelf, .pour { background: var(--card); } }
  .counter.is-down { border-style: dashed; }
  .counter-line { margin: 0 0 6px; font-size: 14px; line-height: 1.8; }
  .counter-line:last-child { margin-bottom: 0; }
  .counter-line b { color: var(--accent); }
  .counter-sub { margin: 8px 0 0; font-size: 12px; color: var(--gold); line-height: 1.7; }

  /* 调酒台收起时就是一行，所以内边距比其他卡片稍紧 */
  .mix { padding: 4px 18px; }
  .mix[open] { padding: 10px 18px 16px; }
  .mix-form { display: grid; gap: 12px; margin-top: 4px; }
  .f { display: grid; gap: 5px; font-size: 12.5px; color: var(--muted); }
  .f input, .r input { font-family: inherit; font-size: 16px; color: var(--ink);
    background: color-mix(in srgb, #fff 70%, transparent); border: 1px solid var(--line);
    border-radius: 11px; padding: 10px 12px; min-height: 44px; -webkit-appearance: none; appearance: none; }
  .f input:focus, .r input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .recipe-box { margin: 0; border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px 12px; }
  .recipe-box legend { padding: 0 6px; font-size: 12.5px; color: var(--muted); }
  .r { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
  .r.is-extra { display: none; }
  .r input:first-child { flex: 1; min-width: 0; }
  .r input[type=number] { width: 84px; flex: none; text-align: center; }
  .r span { font-size: 12px; color: var(--muted); }
  .row-ops { display: flex; gap: 8px; margin: 2px 0 0; }
  .row-ops button { font-family: inherit; font-size: 13px; color: var(--accent);
    background: color-mix(in srgb, var(--accent) 8%, transparent); border: 1px solid color-mix(in srgb, var(--accent) 22%, transparent);
    border-radius: 10px; padding: 7px 12px; min-height: 36px; cursor: pointer; }
  .row-ops button:active { opacity: 0.8; }
  .hint { margin: 6px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
  .go { font-family: inherit; font-size: 15px; font-weight: 600; color: #fffdfb;
    background: var(--accent); border: none; border-radius: 13px; min-height: 46px; cursor: pointer; }
  .go:active { opacity: 0.88; }
  .mix-note { margin: 12px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); }
  .flash { margin: 6px 0 10px; padding: 10px 12px; border-radius: 12px; font-size: 13px; line-height: 1.7;
    background: color-mix(in srgb, var(--gold) 14%, transparent); color: var(--ink); word-break: break-word; }
  .flash.bad { background: color-mix(in srgb, #c0392b 12%, transparent); }

  /* 收起来的那几块：调酒台、配方、原料架、隐藏款 */
  .sh { margin: 0 0 8px; }
  .shelf .sh:last-of-type { margin-bottom: 0; }
  .sh > summary { list-style: none; cursor: pointer; font-size: 14px; font-weight: 600; color: var(--accent);
    padding: 11px 2px; display: flex; align-items: center; gap: 6px; -webkit-tap-highlight-color: transparent; }
  .sh > summary::-webkit-details-marker { display: none; }
  .sh > summary::after { content: '▸'; margin-left: auto; font-size: 11px; color: var(--gold); transition: transform 0.2s; }
  .sh[open] > summary::after { transform: rotate(90deg); }
  .shelf-group { margin: 4px 0 12px; }
  .shelf-group h4 { margin: 0 0 7px; font-size: 12px; font-weight: 600; letter-spacing: 0.1em; color: var(--muted); }
  .chips { display: flex; flex-wrap: wrap; gap: 7px; }
  .chip { font-family: inherit; font-size: 13.5px; color: var(--ink); cursor: pointer;
    background: color-mix(in srgb, #fff 62%, transparent); border: 1px solid var(--line);
    border-radius: 999px; padding: 7px 13px; min-height: 38px; display: inline-flex; align-items: baseline; gap: 5px; }
  .chip:active { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .chip small { font-size: 10.5px; color: var(--gold); }
  .recipes { display: grid; gap: 7px; margin: 4px 0 2px; }
  .recipe { font-family: inherit; text-align: left; cursor: pointer; display: grid; gap: 3px;
    background: color-mix(in srgb, #fff 62%, transparent); border: 1px solid var(--line);
    border-radius: 13px; padding: 11px 13px; }
  .recipe:active { background: color-mix(in srgb, var(--accent) 10%, transparent); }
  .recipe-name { font-family: "Songti SC", "STSong", Georgia, serif; font-size: 15.5px; font-weight: 600; color: var(--accent); }
  .recipe-parts { font-size: 12px; color: var(--muted); line-height: 1.6; word-break: break-word; }
  .recipe-note { font-size: 11.5px; color: var(--gold); }
  .secret { margin: 0 0 8px; font-size: 12.5px; line-height: 1.8; color: var(--muted); }
  .secret b { color: var(--accent); }

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
  a:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
<main>${renderMenu('/bar')}${body}</main>
<script>${CHROME_SCRIPT}</script>
<script>${FORM_SCRIPT}</script></body>
</html>`;
}

// 表单里的配方 → Proof 要的 parts
function partsFrom(body) {
  const out = [];
  for (let n = 1; n <= MAX_PARTS; n++) {
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

    // 他喝不喝是在聊天里定的，晨暮星收不到通知。所以每次打开先跟 Proof 对一次账。
    // 对不上就保持原样，不影响这一页渲染
    try {
      await reconcileOffers();
    } catch (err) {
      console.error('bar page: 对账失败（账本保持原样）', err.message);
    }

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
    body += renderForm(
      req.query.sent
        ? { ok: true, text: `递过去了。${name}下次醒来会在吧台上看到它。` }
        : req.query.err
          ? { ok: false, text: String(req.query.err).slice(0, 300) }
          : null
    );
    body += renderShelf();

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
    console.log(`bar: 递了一杯「${name}」给 ${PROOF_AGENT_ID}（offer ${offerId}，${parts.length} 样原料）`);
    res.redirect(303, '/bar?sent=1');
  });

  return true;
}
