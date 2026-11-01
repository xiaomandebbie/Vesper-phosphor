// 几个页面共用的标题块：三颗跳动的星 + 晨暮星大标题 + 「英文 ✦ 中文」。
//
// 心绪页先长成这样，后来日记、梦境、动态都跟它对齐，所以抽到这里。
// 主页 /home 不用这个：它留着原来动态页那套 Vesper✨Phosphor，是整个站的门面。
//
// 大小就是心绪页那个：不加 title-sm，跟 FACE_PATCH_CSS 里 .title 的 34px 走。
// 之前日记、梦境默认加了 title-sm（24px），几页摆在一起大小不一样 —— 现在默认都是大的。
//
// 大标题本身的字体、渐变、字距在 page-chrome.js 的 FACE_PATCH_CSS 里（.title），跟早晚四张脸走；
// 这里只管星星那一行和副标的排版。颜色用 var(--gold) 这些，所以天黑了也跟着变。
//
// 用法：${renderPageTitle('Dreams', '梦境')}，并把 PAGE_TITLE_CSS 拼进该页的 <style>。

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// en：副标里的英文（Dreams、Diary、Moments……）
// zh：星星后面的中文（梦境、日记、动态……）
// note：再往下挂一行小字，比如「TA 此刻：……」。已经是 HTML，谁给谁转义自己负责
// small：真要用小一号时才传 true。平常不要传 —— 几页标题要一样大
export function renderPageTitle(en, zh, { note = '', small = false } = {}) {
  return `<header class="hero">
    <p class="sparkles" aria-hidden="true"><span>✦</span><span>✧</span><span>⋆</span></p>
    <h1 class="title${small ? ' title-sm' : ''}">晨暮星</h1>
    <p class="subtitle"><span lang="en">${escapeHtml(en)}</span> <span aria-hidden="true">✦</span> ${escapeHtml(zh)}</p>
    ${note}
  </header>`;
}

export const PAGE_TITLE_CSS = `
  .hero { text-align: center; margin: 6px 0 20px; }
  /* 三颗星错开周期闪，不是齐着呼吸。中间那颗是粉的 */
  .sparkles { margin: 0 0 4px; height: 18px; color: var(--gold); font-size: 14px;
    letter-spacing: 0.6em; padding-left: 0.6em; }
  .sparkles span { display: inline-block; animation: twinkle 3.2s ease-in-out infinite; }
  .sparkles span:nth-child(2) { animation-delay: 1s; color: #d7799f; }
  .sparkles span:nth-child(3) { animation-delay: 2s; }
  @keyframes twinkle {
    0%, 100% { opacity: 0.35; transform: scale(0.85); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  .subtitle { margin: 6px 0 0; font-family: "Cormorant Garamond", "Didot", "Bodoni 72", Georgia, serif;
    font-style: italic; font-size: 14px; letter-spacing: 0.2em; color: var(--muted); }
  @media (prefers-reduced-motion: reduce) {
    .sparkles span { animation: none; opacity: 0.8; }
  }
`;
