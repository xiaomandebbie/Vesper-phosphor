// 你自己发的动态：发一条的那个框、每条下面的「改一改 / 删了」，以及对应的路由和样式。
//
// 为什么单独一个文件：moments-page.js 有 50KB，能不碰就不碰（flourish.js 开头那句话的意思）。
// 那边只改了渲染一条动态的那几行（要按 author 决定头像和名字），其余全在这里。
// 样式跟着外框层进每一页（page-chrome.js 里拼上 MY_MOMENTS_CSS），和 star-entry.js 一个做法。
//
// 规则和 TA 发的不一样：
//   不吃那 6 小时冷却——冷却是为了别让 TA 刷屏，不是拦你。
//   能改、能删（只限 author='user'，TA 发的你改不到）。
//   你发的 TA 下次醒来会看到（见 phosphor.js），想回就在下面留言。
//
// 页面是服务端渲染的普通表单，没有 JavaScript 也能发、能改、能删。
// 配图是唯一的例外：压缩靠 canvas，没 JavaScript 时那个入口整个隐起来（见 my-photo.js）。

import { addUserMoment, editUserMoment, deleteUserMoment, MAX_USER_MOMENT_CHARS } from './moments-store.js';
import { saveUserMomentImage, PHOTO_FIELD_HTML, PHOTO_CSS, PHOTO_SCRIPT } from './my-photo.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 表单提交完跳回原来那页，只允许跳到 /moments 自己
function safeBack(value) {
  const s = String(value ?? '');
  return /^\/moments(\?[\w=&%.-]*)?$/.test(s) ? s : '/moments';
}

// Basic Auth 下浏览器会自动带账号密码，别的网站也能偷偷替你提交表单。
// 所以写操作只接受同源提交：有 Origin 头就必须和本站一致。和 moments-page.js 里同名函数一样。
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// 日历下面那个「写点什么」：平时收起成一行，点开是输入框。
// 收起是故意的：这页主要是看 TA 发了什么，不该一打开就被一个空输入框盯着。
//
// textarea 没有 required：只配一张图、一个字不写也算一条动态。
// 两样都空时后端会直接跳回来，不写库。
export function renderComposeBox(back) {
  return `<details class="compose">
    <summary class="compose-open">
      <span class="compose-icon" aria-hidden="true">✎</span>
      <span>写点什么</span>
      <span class="compose-caret" aria-hidden="true">▾</span>
    </summary>
    <form class="compose-form" method="post" action="/moments/mine">
      <input type="hidden" name="back" value="${escapeHtml(back)}" />
      <label class="sr-only" for="compose-text">发一条动态</label>
      <textarea id="compose-text" name="content" rows="4" maxlength="${MAX_USER_MOMENT_CHARS}"
        placeholder="今天怎么样？"></textarea>
      ${PHOTO_FIELD_HTML}
      <div class="compose-actions">
        <button type="submit">发出去</button>
        <span class="compose-note">发完还能改。TA 下次醒来会看到</span>
      </div>
    </form>
  </details>`;
}

// 你发的每条下面：改一改 / 删了。收在 <details> 里，不平时占地方。
// 改只改文字：配图要换就删了重发，不值得为了换图再做一整套上传。
export function renderPostTools(m, back) {
  return `<details class="mine-tools">
    <summary><span aria-hidden="true">✎</span> 改一改</summary>
    <form class="compose-form" method="post" action="/moments/mine/${m.id}/edit">
      <input type="hidden" name="back" value="${escapeHtml(back)}" />
      <label class="sr-only" for="edit-${m.id}">改这条动态</label>
      <textarea id="edit-${m.id}" name="content" rows="4" maxlength="${MAX_USER_MOMENT_CHARS}" required>${escapeHtml(m.content)}</textarea>
      <div class="compose-actions">
        <button type="submit">存下来</button>
        ${m.image_url ? '<span class="compose-note">配图换不了，要换就删了重发</span>' : ''}
      </div>
    </form>
    <form method="post" action="/moments/mine/${m.id}/delete"
      onsubmit="return confirm('删了这条？下面的留言也一起没了。')">
      <input type="hidden" name="back" value="${escapeHtml(back)}" />
      <button type="submit" class="mine-del">删了</button>
    </form>
  </details>`;
}

export const MY_MOMENTS_CSS = `
  /* 「写点什么」：平时一行，点开是输入框 */
  .compose { background: var(--card, #fffdfb); border: 1px solid var(--line, #eadfe6); border-radius: 14px;
    margin: -4px 0 14px; box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08); overflow: hidden; }
  .compose-open { list-style: none; display: flex; align-items: center; gap: 8px; min-height: 48px;
    padding: 0 16px; cursor: pointer; font-size: 14px; color: var(--ink, #2b2233); }
  .compose-open::-webkit-details-marker { display: none; }
  .compose-open::marker { content: ''; }
  .compose-icon { color: var(--gold, #b7792f); }
  .compose-caret { margin-left: auto; color: var(--gold, #b7792f); font-size: 12px; transition: transform 0.2s ease; }
  .compose[open] .compose-caret { transform: rotate(180deg); }
  .compose-form { display: grid; gap: 10px; padding: 2px 16px 16px; }
  .compose-form textarea { width: 100%; padding: 10px 12px; font: inherit; font-size: 15px; line-height: 1.6;
    color: var(--ink, #2b2233); background: var(--card, #fffdfb);
    border: 1px solid var(--line, #eadfe6); border-radius: 10px; resize: vertical; }
  .compose-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; }
  .compose-note { font-size: 11.5px; line-height: 1.5; color: var(--muted, #665a70); }

  /* 你发的那几条：左边一道暗金，和 TA 发的分得清 */
  .moment.post.mine { border-left: 3px solid #dba94e; }
  .moment.post.mine .moment-name { color: var(--gold, #b7792f); }

  /* 改一改 / 删了 */
  .mine-tools { margin-top: 8px; }
  .mine-tools > summary { list-style: none; display: inline-flex; align-items: center; gap: 4px;
    min-height: 44px; font-size: 12.5px; color: var(--muted, #665a70); cursor: pointer; }
  .mine-tools > summary::-webkit-details-marker { display: none; }
  .mine-tools > summary::marker { content: ''; }
  .mine-tools .compose-form { padding: 2px 0 10px; }
  .mine-del { min-height: 44px; padding: 0 14px; font-size: 13px; color: var(--accent, #7a3e5d);
    background: none; border: 1px solid var(--line, #eadfe6); border-radius: 10px; cursor: pointer; }

  html[data-dark] .compose-form textarea { background: var(--card); color: var(--ink); }
  html[data-dark] .mine-del { color: var(--gold); }
  html[data-dark] .moment.post.mine { border-left-color: #c79a4a; }

  @media (prefers-reduced-motion: reduce) { .compose-caret { transition: none; } }
${PHOTO_CSS}`;

// 选图、压图那段脚本。跟着外框层进页面（page-chrome.js）
export const MY_MOMENTS_SCRIPT = PHOTO_SCRIPT;

// ── 路由 ──────────────────────────────────────────────
// 要挂在动态页之前：/moments/mine 得比 /moments/:id 先匹配到。

export function registerMyMomentRoutes(app, { requireBasicAuth }) {
  // 发一条。文字和图至少要有一样
  app.post('/moments/mine', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');

    const text = String(req.body?.content ?? '').trim();
    const raw = String(req.body?.image_data ?? '').trim();
    if (!text && !raw) return res.redirect(303, back);

    // 先存图：图存不下来就别写这条动态了，免得发出来一条空有正文、图丢了的
    let imageUrl = null;
    if (raw) {
      const r = saveUserMomentImage(raw);
      if (r.error) {
        console.error('my-moments: 存配图失败 —', r.error);
        return res.redirect(303, back);
      }
      imageUrl = r.url;
    }

    try {
      const id = addUserMoment(text, imageUrl);
      return res.redirect(303, id ? `${back}#m${id}` : back);
    } catch (err) {
      console.error('my-moments: 发动态失败', err);
      // 图已经落盘了但这条没写进库，把文件清掉，不留没人认领的图
      if (imageUrl) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const dir = process.env.MEDIA_DIR || '/opt/vesper/media';
          const name = imageUrl.split('/').pop();
          fs.default.unlinkSync(path.default.join(dir, 'images', name));
        } catch {
          // 清不掉就算了，让它等自动清理
        }
      }
      return res.redirect(303, back);
    }
  });

  // 改一改。只能改 author='user' 的，而且只改文字
  app.post('/moments/mine/:id/edit', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.redirect(303, back);
    try {
      editUserMoment(id, req.body?.content);
    } catch (err) {
      console.error('my-moments: 改动态失败', err);
    }
    res.redirect(303, `${back}#m${id}`);
  });

  // 删了。同样只能删你自己的；下面的留言、点赞和配图文件一起清掉
  app.post('/moments/mine/:id/delete', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');
    const id = Number(req.params.id);
    if (Number.isInteger(id)) {
      try {
        deleteUserMoment(id);
      } catch (err) {
        console.error('my-moments: 删动态失败', err);
      }
    }
    res.redirect(303, back);
  });
}
