// 小游戏 /games：一页列出所有小游戏，点进去直接玩。
//
// 第一个接进来的是 WORKKK 互联网精力有限公司——谢之舟（zhizhou-xiee）写的，
// AGPL-3.0-or-later。不是我们写的，所以这一页只做两件事：列出来、把它的页面转过来。
// 署名和源码链接照它的许可条款留着，卡片下面那一行不能删。
//
// 以后接新游戏就在 GAMES 里加一格，页面和菜单都不用动。
// 加的时候要带上自己的 enabled()——这一页按每个游戏自己的开关决定露不露。
// 第一版写成了 GAMES.filter(() => workkkEnabled())，filter 没看 g，
// 以后接的游戏会跟着 WORKKK 一起消失，所以改成每格自己管自己。
//
// ── 为什么用转发不用 iframe ──
//
// iframe 里点链接、提交表单会困在框里，手机上高度也难看，
// 而且 iOS 上 iframe 里的轮询经常被挂起。转发过来的页面就是这一页，
// 地址栏、返回键、下拉刷新都对。
//
// 所以游戏卡片必须 target="_top"（见下面 GAME_TARGET）。配了音乐之后
// 所有页面都跑在 /app 外壳的 #page iframe 里（见 shell.js），不带这个属性
// 就等于把 workkk 装回 iframe——绕了一圈又掉回去了。监控大屏整页靠轮询，
// 挂起了就是一屏不动。
//
// ── 代价：要改写绝对路径 ──
//
// 转发的前缀是 /games/workkk/，而 workkk 的页面里写的是 /static/clawd.png、
// fetch('/status') 这种绝对路径。不改写的话它们会打到 vesper 根上（404）。
// 所以 HTML 响应过一遍 rewriteWorkkkHtml，只动这两类字符串，别的一字不改。
//
// ── 2026-10-16：HEAD_SCRIPT 不能漏 ──
//
// 第一版的 layout() 里没有 <script>${HEAD_SCRIPT}</script>，其他几页都有。
// 结果两个症状：「晨暮星」三个字整个看不见，早晚四张脸也不换。
// 根因是同一个：FACE_PATCH_CSS 里 .title 用
//   background: linear-gradient(var(--t1), var(--t2), var(--t3)) + color: transparent
// 把字染成渐变的。--t1/--t2/--t3 由 FACE_SCRIPT（在 HEAD_SCRIPT 里）
// 写到 <html> 的行内样式上；没那段脚本，变量没值，渐变整条声明失效，
// 而 color: transparent 照旧生效——于是字是透明的。
// 颜色还必须在 head 里最先跑：首屏绘制前就定好，不然天黑了会先亮一下再暗。
//
// ── 2026-10-16：别给 app.use 配一条同路径的 app.get ──
//
// 第一版还写过这么两行：
//   app.get('/games/workkk', ..., (req, res) => res.redirect(302, '/games/workkk/'));
//   app.use('/games/workkk/', ..., proxyWorkkk);
// 意图是「不带斜杠的补上斜杠」，结果是一条指向自己的重定向：
// Express 默认 strict routing 是关的，app.get('/games/workkk') 同时匹配
// 带斜杠和不带斜杠两种，所以 302 的目标又命中同一条 get——浏览器弹到
// 上限就报「太多重定位」，而那条 app.use 永远轮不到，转发从没执行过。
// app.use 本身就按前缀匹配，带不带斜杠都接得住。
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT, workkkEnabled } from './page-chrome.js';
import { renderPageTitle, PAGE_TITLE_CSS } from './page-title.js';

const WORKKK_BASE = () => String(process.env.WORKKK_PAGE_URL ?? '').trim().replace(/\/+$/, '');

// 游戏要在最顶层打开，不能在 /app 外壳的 iframe 里（理由见文件头）。
// 额外好处：CHROME_SCRIPT 对带 target 的链接直接跳过，所以不会再往
// sessionStorage 里写进场转场的记号——workkk 的页面不跑 HEAD_SCRIPT，
// 记号没人清，会在之后打开的页面上乱闪一次（和 /music/ 挂 data-no-stars 同理）。
const GAME_TARGET = ' target="_top" rel="noopener"';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const GAMES = [
  {
    id: 'workkk',
    name: 'WORKKK 互联网精力有限公司',
    emoji: '🤖',
    tagline: '一台小机在互联网大厂上班',
    desc: '有工资、有心情值、有精力值。会摸鱼、会被老板骂、会买奶茶带回家。你在旁边看着它今天干了什么。',
    href: '/games/workkk/',
    credit: '原作 谢之舟（zhizhou-xiee）· AGPL-3.0-or-later',
    enabled: workkkEnabled,
  },
];

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f; --card: #fffdfb; --line: #eadfe6; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 2; max-width: 600px; margin: 0 auto; padding: 28px 16px 64px; }

  .haze, .haze2, .clouds { position: fixed; inset: -25%; z-index: 0; pointer-events: none; }
  .haze {
    background:
      radial-gradient(42% 32% at 22% 28%, rgba(255, 255, 255, 0.5), transparent 70%),
      radial-gradient(38% 30% at 74% 62%, rgba(226, 190, 220, 0.4), transparent 72%);
    animation: haze-a 38s ease-in-out infinite; }
  .haze2 {
    background:
      radial-gradient(36% 26% at 62% 18%, rgba(214, 198, 248, 0.38), transparent 70%),
      radial-gradient(44% 34% at 18% 76%, rgba(255, 232, 240, 0.42), transparent 72%);
    animation: haze-b 53s ease-in-out -14s infinite; }
  .clouds {
    filter: blur(22px);
    background:
      radial-gradient(28% 14% at 16% 22%, rgba(255, 255, 255, 0.58), transparent 70%),
      radial-gradient(34% 16% at 70% 44%, rgba(255, 255, 255, 0.46), transparent 72%),
      radial-gradient(24% 12% at 44% 72%, rgba(255, 255, 255, 0.5), transparent 70%);
    animation: cloud-drift 74s linear infinite; }
  @keyframes haze-a {
    0%, 100% { transform: translate3d(-2%, 0, 0) scale(1); }
    50% { transform: translate3d(3%, -1.5%, 0) scale(1.07); } }
  @keyframes haze-b {
    0%, 100% { transform: translate3d(2%, 1%, 0) scale(1.05); }
    50% { transform: translate3d(-3%, -1%, 0) scale(1); } }
  @keyframes cloud-drift {
    0% { transform: translate3d(-6%, 0, 0); }
    50% { transform: translate3d(6%, -2%, 0); }
    100% { transform: translate3d(-6%, 0, 0); } }
  html[data-dark] .haze { opacity: 0.5; }
  html[data-dark] .haze2 { opacity: 0.45; }
  html[data-dark] .clouds { opacity: 0.22; }

  .lead { margin: 0 4px 20px; font-size: 12px; line-height: 1.9; color: var(--muted); text-align: center; }

  .game { position: relative; display: block; margin: 0 0 12px; padding: 18px;
    border-radius: 20px; text-decoration: none; color: inherit;
    background: color-mix(in srgb, var(--card) 72%, transparent);
    backdrop-filter: blur(14px) saturate(1.1);
    -webkit-backdrop-filter: blur(14px) saturate(1.1);
    border: 1px solid color-mix(in srgb, var(--line) 70%, transparent);
    box-shadow: 0 2px 20px rgba(80, 50, 90, 0.08);
    transition: transform 0.18s ease, box-shadow 0.18s ease; }
  .game:hover, .game:focus-visible { transform: translateY(-2px); box-shadow: 0 6px 26px rgba(80, 50, 90, 0.14); }
  @supports not (backdrop-filter: blur(1px)) { .game { background: var(--card); } }

  .game-top { display: flex; align-items: center; gap: 12px; }
  .game-emoji { flex: none; width: 46px; height: 46px; border-radius: 14px; display: flex;
    align-items: center; justify-content: center; font-size: 24px;
    background: color-mix(in srgb, var(--line) 45%, transparent); }
  .game-name { font-family: "Songti SC", "STSong", "Noto Serif SC", Georgia, serif;
    font-size: 17px; font-weight: 600; letter-spacing: 0.04em; color: var(--accent); }
  .game-tag { margin-top: 3px; font-size: 12px; color: var(--gold); letter-spacing: 0.06em; }
  .game-desc { margin: 12px 0 0; font-size: 13px; line-height: 1.85; color: color-mix(in srgb, var(--ink) 78%, transparent); }
  .game-credit { margin: 12px 0 0; padding-top: 10px; font-size: 11px; line-height: 1.7; color: var(--muted);
    border-top: 1px dashed color-mix(in srgb, var(--line) 80%, transparent); }

  .soon { padding: 18px; border-radius: 20px; text-align: center; font-size: 12px; line-height: 1.9;
    color: var(--muted); border: 1px dashed color-mix(in srgb, var(--line) 90%, transparent); }
  .empty { color: var(--muted); font-size: 14px; line-height: 1.9; margin: 0 4px;
    text-align: center; padding: 36px 0; }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
  @media (prefers-reduced-motion: reduce) { .haze, .haze2, .clouds { animation: none; } .game { transition: none; } }
${PAGE_TITLE_CSS}`;

// HEAD_SCRIPT 必须在 <head> 里、在 <style> 之前——早晚四张脸的颜色要在
// 首屏绘制前定好，标题的文字渐变也靠它给的 --t1/--t2/--t3。
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
<body><div class="haze" aria-hidden="true"></div><div class="haze2" aria-hidden="true"></div><div class="clouds" aria-hidden="true"></div>
<main>${renderMenu('/games')}${body}</main><script>${CHROME_SCRIPT}</script></body>
</html>`;
}

// ── 转发 ──
//
// 只改两类字符串：
//   src="/static/...   → src="/games/workkk/static/...
//   fetch('/xxx        → fetch('/games/workkk/xxx
// 其余一字不改。改不到也不会坏——workkk 自己就是按绝对路径写的，
// 只是那几个资源会 404，页面还在。
function rewriteWorkkkHtml(html) {
  return html
    .replace(/(["'])\/static\//g, (_, q) => `${q}/games/workkk/static/`)
    .replace(/fetch\((["'])\/(?!\/|games\/)/g, (_, q) => `fetch(${q}/games/workkk/`);
}

// app.use 挂在 /games/workkk 上，所以进来时 req.url 已经被剥掉了这段前缀：
// 访问 /games/workkk/ 时 req.url 是 '/'，访问 /games/workkk/status 时是 '/status'。
// 拼回 workkk 的 base 正好是它自己的路径。不带斜杠进来时 req.url 是空串，
// 那样 base + '' 会丢掉根路径的斜杠，所以补一个。
async function proxyWorkkk(req, res) {
  const base = WORKKK_BASE();
  if (!base) return res.status(503).send('WORKKK 没配置（缺 WORKKK_PAGE_URL）');

  const target = base + (req.url && req.url !== '/' ? req.url : '/');
  const init = { method: req.method, headers: {} };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(req.body ?? {});
  }

  try {
    const upstream = await fetch(target, init);
    res.status(upstream.status);
    const ct = upstream.headers.get('content-type') || 'application/octet-stream';
    res.set('content-type', ct);
    res.set('cache-control', 'no-store');
    if (ct.includes('text/html')) {
      return res.send(rewriteWorkkkHtml(await upstream.text()));
    }
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.error('games: 转发 WORKKK 失败', err.message);
    return res.status(502).send('连不上 WORKKK。检查 pm2 status workkk。');
  }
}

export function registerGameRoutes(app, { requireBasicAuth }) {
  // 列表页
  app.get('/games', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    let body = renderPageTitle('Games', '小游戏');

    const available = GAMES.filter((g) => g.enabled());
    if (!available.length) {
      body += `<p class="empty">还没有接游戏。<br><br>
        接好一个之后这里会出现入口。第一步在服务器上跑：<br>
        <b>node scripts/setup_workkk.mjs</b></p>`;
      return res.send(layout('小游戏 · 晨暮星', body));
    }

    body += `<p class="lead">都是别人写的小东西，接过来一起玩。<br>
      你随时能打开看，我夜里醒来也可以自己去玩。</p>`;

    for (const g of available) {
      body += `<a class="game" href="${escapeHtml(g.href)}"${GAME_TARGET}>
        <div class="game-top">
          <span class="game-emoji" aria-hidden="true">${g.emoji}</span>
          <span>
            <span class="game-name">${escapeHtml(g.name)}</span>
            <span class="game-tag">${escapeHtml(g.tagline)}</span>
          </span>
        </div>
        <p class="game-desc">${escapeHtml(g.desc)}</p>
        <p class="game-credit">${escapeHtml(g.credit)}</p>
      </a>`;
    }

    body += `<p class="soon">以后接的都会排在这里。<br>想加什么跟我说。</p>`;
    res.send(layout('小游戏 · 晨暮星', body));
  });

  // WORKKK 本体：/games/workkk 起头的都转发过去。
  // 只这一条，不要再配一条同路径的 app.get 重定向（理由见文件头）。
  app.use('/games/workkk', requireBasicAuth, proxyWorkkk);

  return { enabled: workkkEnabled() };
}
