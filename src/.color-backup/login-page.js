// 登陆界面：没登录、或者在浏览器弹框里点了取消时看到的那一页。
//
// 之前这里是一行纯文字「需要登录」。现在跟着早晚两张脸走（见 sun-time.js），
// 白天是浅色的晨光，天黑了是深紫配星星 —— 还没进门就先看见这个地方此刻的样子。
//
// 两个分寸：
//   不带菜单 —— 还没登录，没必要把内部页面的路径摊出来；
//   不引任何要认证的资源（/media 这些都要登录），所以样式、星星全是内联的。
//
// 「再试一次」指回首页：浏览器会重新弹登录框。

import { FACE_CSS, FACE_SCRIPT } from './sun-time.js';

const STYLE = `
  :root { --ink: #2b2233; --muted: #665a70; --accent: #7a3e5d; --gold: #b7792f;
    --card: #fffdfb; --line: #eadfe6;
    --bg1: #efe7f4; --bg2: #f9f0ee; --bg3: #fdf8f2;
    --t1: #463a7c; --t2: #9b4a7a; --t3: #c4832f;
    --activity: #e6b652; --activity-ink: #8a5a14; --place: #9a6412;
    --card-soft: #f3eef2; --detail-bg: #fdf6e6; --hl: rgba(230, 182, 82, 0.38); }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body { margin: 0; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif;
    background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%);
    display: flex; align-items: center; justify-content: center; padding: 24px; }
  main { position: relative; z-index: 10; width: 100%; max-width: 340px; text-align: center; }

  /* 标题和站内一致：苹方超细、大字距。进门前后看到的是同一个名字 */
  .title { margin: 0; font-family: -apple-system, "PingFang SC", sans-serif;
    font-weight: 200; font-size: 34px; line-height: 1.3;
    letter-spacing: 0.62em; padding-left: 0.62em; color: var(--accent); }
  @supports ((-webkit-background-clip: text) or (background-clip: text)) {
    .title { background: linear-gradient(100deg, var(--t1) 0%, var(--t2) 52%, var(--t3) 100%);
      -webkit-background-clip: text; background-clip: text; color: transparent; }
  }
  .subtitle { margin: 10px 0 0; font-family: "Cormorant Garamond", "Didot", Georgia, serif;
    font-style: italic; font-size: 13px; letter-spacing: 0.3em; color: var(--muted); }

  .gate { margin: 28px 0 0; padding: 20px 18px; background: var(--card);
    border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); }
  .gate p { margin: 0; font-size: 14px; line-height: 1.75; color: var(--muted); }
  .gate .lock { display: block; margin-bottom: 10px; font-size: 20px; color: var(--gold); }
  .retry { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    min-height: 44px; margin-top: 16px; padding: 0 22px;
    background: var(--accent); color: #fff; text-decoration: none;
    border-radius: 12px; font-size: 15px;
    transition: transform 0.16s ease, opacity 0.2s ease; }
  .retry:active { transform: scale(0.98); opacity: 0.9; }
  .foot { margin: 18px 0 0; font-size: 11.5px; line-height: 1.7; color: var(--muted); opacity: 0.8; }

  /* 深底的时候：卡片压深，按钮改用深底色当字（--accent 在夜里是浅粉，再放白字就看不见） */
  html[data-dark] .retry { color: var(--bg1); }
  html[data-dark] .gate { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.32); }
  a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

export function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>晨暮星</title>
<script>${FACE_SCRIPT}</script>
<style>${STYLE}${FACE_CSS}</style>
</head>
<body>
<div class="sky" aria-hidden="true"></div>
<main>
  <h1 class="title">晨暮星</h1>
  <p class="subtitle">Vesper &#10022; Phosphor</p>
  <section class="gate">
    <span class="lock" aria-hidden="true">&#10038;</span>
    <p>这里要登录才能进。<br />填完用户名和密码就行。</p>
    <a class="retry" href="/">再试一次</a>
  </section>
  <p class="foot">点「再试一次」会重新弹出登录框</p>
</main>
</body>
</html>`;
}
