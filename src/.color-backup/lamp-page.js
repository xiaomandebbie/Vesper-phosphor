// 台灯页 /lamp。
//
// 小满 2026-10-30：「台灯怎么了呀」「台灯你快写」
//
// 发现页里台灯那一格一直置灰，写着「没配 NAV_LAMP_URL」——那是我当时留错了：
// 台灯是一套 MCP 工具（米家，16 个），根本没有网页可以跳，那个变量永远填不上。
// 所以这儿自己做一个页，调那几个工具。
//
// ── 这一页和其他页不一样的地方 ──
//
// 其他页读的都是本地 sqlite，这一页要过 MCP 问远端。所以：
//   · 读状态失败不整页 500，摆一句「现在读不到灯的状态」，按钮照旧能点
//   · 所有动作都是 POST + 重定向（PRG），刷新页面不会重复执行
//   · 不做自动刷新：每次刷都是一次 MCP 调用，没必要
//
// ── 没有关灯按钮（故意的） ──
//
// 工具说明里写得很清楚：light_off 之前要先想想她是不是还在用这盏灯；
// 「暗下来是一句不早了，突然黑掉是惊吓」。那是给他的规矩，
// 但这是她自己的页面，她关自己的灯不需要这层考虑——所以关灯按钮给。
// 只是摆在最后一行，和场景按钮分开。
//
// ── 睡前守护只显示，不在这儿定 ──
//
// light_guard_set 是他每天 23:00 被叫醒一次来定的——该不该调暗、
// 几点开始，要看她那晚在忙什么。那是他的判断，页面上给个按钮让她自己定
// 就把那一层抻平了。这儿只显示今夜安排，谁定的、几点开始、走到哪一档。

import { callTool, isConnected } from './mcp-manager.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/lamp';
// mcp-manager 里注册的服务名。没接时这一页自己说清楚，不报错
const SERVER = process.env.LAMP_MCP_NAME || 'lamp';

// 六套场景，数值照抄 light_scene 的说明
const SCENES = [
  { id: '\u5de5\u4f5c', hint: '85 \u00b7 4800K' },
  { id: '\u9605\u8bfb', hint: '70 \u00b7 4000K' },
  { id: '\u770b\u5c4f', hint: '40 \u00b7 3500K' },
  { id: '\u50a8\u5149', hint: '25 \u00b7 3000K' },
  { id: '\u6696\u9ec4', hint: '50 \u00b7 2700K' },
  { id: '\u591c\u706f', hint: '8 \u00b7 2700K' },
];

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// MCP 工具返回 { content: [{ type: 'text', text }] }，只取文字
function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

// 状态那句话长这样：
//   桌面台灯现在关着，亮度 45，色温 5100K
// 从里面抠出三个数。抠不出就原文摆着，不猜
function parseStatus(text) {
  const on = /\u5f00\u7740|\u5df2\u5f00|\u5f00\u542f/.test(text) && !/\u5173\u7740/.test(text);
  const b = text.match(/\u4eae\u5ea6\s*(\d+)/);
  const k = text.match(/\u8272\u6e29\s*(\d+)/);
  return {
    on,
    brightness: b ? Number(b[1]) : null,
    kelvin: k ? Number(k[1]) : null,
    raw: text,
  };
}

// 色温→一个大概的颜色，给那个圆点用。
// 2700K 暖黄、5100K 冷白，中间线性插。只是个示意，不追求准
function kelvinColor(k) {
  if (!Number.isFinite(k)) return '#f0d9a6';
  const t = Math.min(Math.max((k - 2700) / (5100 - 2700), 0), 1);
  const r = Math.round(255 - t * 20);
  const g = Math.round(190 + t * 55);
  const b = Math.round(120 + t * 115);
  return `rgb(${r}, ${g}, ${b})`;
}

function renderStatus(st) {
  if (!st) {
    return `<div class="card notice">\u73b0\u5728\u8bfb\u4e0d\u5230\u706f\u7684\u72b6\u6001\uff08\u53f0\u706f\u670d\u52a1\u53ef\u80fd\u6ca1\u8dd1\u7740\uff09\u3002\u4e0b\u9762\u7684\u6309\u94ae\u7167\u65e7\u80fd\u70b9\uff0c\u70b9\u5b8c\u4f1a\u544a\u8bc9\u4f60\u7ed3\u679c\u3002</div>`;
  }
  const dot = kelvinColor(st.kelvin);
  const bits = [];
  if (Number.isFinite(st.brightness)) bits.push(`\u4eae\u5ea6 ${st.brightness}`);
  if (Number.isFinite(st.kelvin)) bits.push(`\u8272\u6e29 ${st.kelvin}K`);
  return `<div class="card now">
    <span class="bulb${st.on ? ' on' : ''}" aria-hidden="true" style="--glow:${dot}"></span>
    <div class="now-in">
      <span class="now-state">${st.on ? '\u706f\u5f00\u7740' : '\u706f\u5173\u7740'}</span>
      ${bits.length ? `<span class="now-nums">${escapeHtml(bits.join('\u3000\u00b7\u3000'))}</span>` : ''}
    </div>
  </div>`;
}

function renderGuard(text) {
  if (!text) return '';
  return `<div class="card guard">
    <h2 class="sub">\u4eca\u591c\u7684\u7761\u524d\u5b88\u62a4</h2>
    <pre class="guard-text">${escapeHtml(text)}</pre>
    <p class="guard-note">\u8fd9\u4e2a\u7531\u4ed6\u6bcf\u5929 23:00 \u81ea\u5df1\u5b9a\uff08\u8981\u770b\u4f60\u90a3\u665a\u5728\u5fd9\u4ec0\u4e48\uff09\uff0c\u8fd9\u4e00\u9875\u53ea\u663e\u793a\u3002\u6c38\u8fdc\u4e0d\u5173\u706f\uff0c\u6700\u4f4e\u5230 5 \u5c31\u505c\u3002</p>
  </div>`;
}

function renderScenes() {
  const items = SCENES.map(
    (s) =>
      `<form method="POST" action="${PREFIX}/scene" class="sc">` +
      `<input type="hidden" name="scene" value="${escapeHtml(s.id)}" />` +
      `<button type="submit"><span class="sc-name">${s.id}</span>` +
      `<span class="sc-hint">${s.hint}</span></button></form>`
  ).join('');
  return `<h2 class="sub">\u6362\u4e00\u5957\u5149</h2><div class="scenes">${items}</div>`;
}

function renderActions() {
  return `<h2 class="sub">\u968f\u624b</h2>
  <div class="acts">
    <form method="POST" action="${PREFIX}/on"><button type="submit">\u5f00\u706f</button></form>
    <form method="POST" action="${PREFIX}/dim"><button type="submit">\u6697\u4e00\u6863</button></form>
    <form method="POST" action="${PREFIX}/off"><button type="submit" class="quiet">\u5173\u706f</button></form>
  </div>`;
}

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.07); }
  .notice { font-size: 13px; line-height: 1.7; color: var(--muted); border-left: 3px solid var(--gold); }
  .now { display: flex; align-items: center; gap: 14px; }
  /* 灯泡：关着是个空圈，开着按色温发光 */
  .bulb { flex: none; width: 46px; height: 46px; border-radius: 50%;
    border: 2px solid var(--line); background: #f6f2f5; }
  .bulb.on { border-color: transparent; background: var(--glow);
    box-shadow: 0 0 0 6px color-mix(in srgb, var(--glow) 28%, transparent),
      0 0 22px color-mix(in srgb, var(--glow) 60%, transparent); }
  .now-in { min-width: 0; }
  .now-state { display: block; font-size: 16px; font-weight: 600; color: var(--accent); }
  .now-nums { display: block; margin-top: 3px; font-size: 12px; color: var(--muted);
    font-variant-numeric: tabular-nums; }
  .sub { margin: 18px 4px 10px; font-size: 13px; font-weight: 600; color: var(--accent);
    letter-spacing: 0.06em; }
  .guard .sub { margin-top: 0; }
  .guard-text { margin: 0; font-size: 13px; line-height: 1.75; white-space: pre-wrap;
    word-break: break-word; color: var(--ink); }
  .guard-note { margin: 10px 0 0; font-size: 11px; line-height: 1.65; color: #a597ab; }
  .scenes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .sc { margin: 0; }
  .sc button { width: 100%; display: flex; flex-direction: column; align-items: center; gap: 3px;
    min-height: 62px; padding: 10px 6px; border-radius: 15px; border: 1px solid var(--line);
    background: var(--card); box-shadow: 0 1px 3px rgba(60, 30, 60, 0.06); }
  .sc button:active { background: #f6eef3; }
  .sc-name { font-size: 14px; font-weight: 600; color: var(--accent); }
  .sc-hint { font-size: 10px; color: var(--gold); font-variant-numeric: tabular-nums; }
  .acts { display: flex; gap: 10px; }
  .acts form { flex: 1; margin: 0; }
  .acts button { width: 100%; min-height: 46px; border-radius: 15px; border: none;
    background: var(--accent); color: #fffdfb; font-size: 14px; font-weight: 600; }
  .acts button:active { opacity: 0.84; }
  .acts button.quiet { background: var(--card); border: 1px solid var(--line); color: var(--muted);
    font-weight: 400; }
  .done { margin: 0 4px 14px; padding: 11px 14px; border-radius: 14px; background: #fff6e3;
    border: 1px solid #f0d9a6; font-size: 13px; line-height: 1.6; color: #6b4513; }
  .foot { margin: 20px 6px 0; font-size: 11px; line-height: 1.7; color: #a597ab; }
  html[data-face="night"] .done, html[data-face="dusk"] .done {
    background: rgba(240, 217, 166, 0.12); border-color: #6b5a3a; color: #f0d9a6; }
`;

function layout(body) {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>\u53f0\u706f \u00b7 \u6668\u66ae\u661f</title>
<script>${HEAD_SCRIPT}</script>
<style>${STYLE}${CHROME_CSS}${TABS_CSS}</style>
</head>
<body><main>${renderMenu(PREFIX)}${body}</main>
${renderTabs(PREFIX)}
<script>${CHROME_SCRIPT}</script></body>
</html>`;
}

export function lampEnabled() {
  try {
    return isConnected(SERVER);
  } catch {
    return false;
  }
}

export function registerLampRoutes(app, { requireBasicAuth }) {
  // 表单解析只挂在这几条路由自己身上，不动全局
  const form = (req, res, next) => {
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return next();
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 2048) req.destroy();
    });
    req.on('end', () => {
      const out = {};
      for (const pair of raw.split('&')) {
        const eq = pair.indexOf('=');
        if (eq < 0) continue;
        const k = decodeURIComponent(pair.slice(0, eq).replace(/\+/g, ' '));
        const v = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
        out[k] = v;
      }
      req.body = out;
      next();
    });
    req.on('error', () => next());
  };

  // 所有动作都是 POST → 做事 → 302 回 /lamp，结果放在 ?done=
  // 这样刷新页面不会重复执行（PRG）
  const act = (name, run) => {
    app.post(`${PREFIX}/${name}`, requireBasicAuth, form, async (req, res) => {
      let msg = '';
      try {
        const out = await run(req);
        msg = toolText(out) || '\u505a\u5b8c\u4e86';
      } catch (err) {
        console.error(`lamp: ${name} \u5931\u8d25`, err.message);
        msg = `\u6ca1\u505a\u6210\uff1a${err.message}`;
      }
      return res.redirect(302, `${PREFIX}?done=${encodeURIComponent(msg.slice(0, 160))}`);
    });
  };

  act('on', () => callTool(SERVER, 'light_on', {}));
  act('off', () => callTool(SERVER, 'light_off', {}));
  act('dim', () => callTool(SERVER, 'light_dim', {}));
  act('scene', (req) => callTool(SERVER, 'light_scene', { scene: String(req.body?.scene ?? '') }));

  app.get(PREFIX, requireBasicAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');

    if (!lampEnabled()) {
      return res.send(
        layout(
          `<div class="card notice">\u53f0\u706f\u8fd8\u6ca1\u63a5\u4e0a\u3002\u5728 .env \u91cc\u914d\u597d\u90a3\u5957 MCP\uff08\u670d\u52a1\u540d\u9ed8\u8ba4 ${escapeHtml(
            SERVER
          )}\uff09\u518d\u91cd\u542f\u3002</div>`
        )
      );
    }

    // 状态和守护并行读，哪一个失败都不影响另一个
    const [stOut, guardOut] = await Promise.allSettled([
      callTool(SERVER, 'light_status', {}),
      callTool(SERVER, 'light_guard', {}),
    ]);

    let st = null;
    if (stOut.status === 'fulfilled') {
      const text = toolText(stOut.value);
      if (text) st = parseStatus(text);
    } else {
      console.error('lamp: \u8bfb\u72b6\u6001\u5931\u8d25', stOut.reason?.message);
    }
    const guard = guardOut.status === 'fulfilled' ? toolText(guardOut.value) : '';

    const done = String(req.query.done ?? '').trim();
    res.send(
      layout(`${done ? `<p class="done" role="status">${escapeHtml(done)}</p>` : ''}
      ${renderStatus(st)}
      ${renderScenes()}
      ${renderActions()}
      ${renderGuard(guard)}
      <p class="foot">\u4ed6\u4e5f\u80fd\u8c03\u8fd9\u76cf\u706f\uff08\u5524\u9192\u65f6\u8d70 MCP\uff09\u3002\u8c01\u52a8\u8fc7\u624b\u811a\u5728\u5de5\u5177\u91cc\u6709\u8bb0\u5f55\uff0c\u4f60\u5728\u7c73\u5bb6 App \u91cc\u6309\u7684\u4e0d\u7b97\u3002</p>`)
    );
  });

  console.log(`lamp: \u53f0\u706f\u9875 ${PREFIX}\uff08MCP \u670d\u52a1\u540d ${SERVER}\uff09`);
  return { enabled: true, server: SERVER };
}
