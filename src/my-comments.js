// 删掉你自己留的那条留言：库里的删除、留言那行里的「删」、它的样式和路由。
//
// 单独一个文件的理由和 my-moments.js 一样：moments-page.js 50KB，能不碰就不碰。
// 那边只多了一个 import 和 renderComment 里的一行调用。
//
// 规则跟着「你发的动态」那套走：
//   只能删 author='user' 的，TA 留的你删不到（和改、删动态一个口径）；
//   挂在它下面的回复（包括回复的回复）一起清掉 —— 留着会变成一条写着
//   「回复 TA」却找不到上文的孤儿。删整条动态时本来也是连留言一起删的，同一个道理。
//
// 页面是服务端渲染的普通表单，没有 JavaScript 也能删。confirm 是锦上添花：
// 没有 JavaScript 时不问一句就直接删，所以按钮写的是「删」而不是别的词，
// 点下去该发生什么一眼就知道。

import db from './state.js';

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 表单提交完跳回原来那页，只允许跳到 /moments 自己。和 my-moments.js 里同名函数一样
function safeBack(value) {
  const s = String(value ?? '');
  return /^\/moments(\?[\w=&%.-]*)?$/.test(s) ? s : '/moments';
}

// Basic Auth 下浏览器会自动带账号密码，别的网站也能偷偷替你提交表单。
// 所以写操作只接受同源提交：有 Origin 头就必须和本站一致。
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// 预编译语句缓存，和 state.js / moments-store.js 一个做法
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 删你自己那条，连它下面整串回复一起。
// 子树里可能有 TA 的回复，会跟着一起没 —— 删整条动态时本来也是这样。
// reply_to 理论上不会成环，还是按 id 去重兜一道，免得这里转不出来。
const deleteUserCommentTx = db.transaction((id) => {
  const row = stmt("SELECT id, moment_id FROM moment_comments WHERE id = ? AND author = 'user'").get(id);
  if (!row) return null;
  const kids = stmt('SELECT id FROM moment_comments WHERE reply_to = ?');
  const doomed = [row.id];
  for (let i = 0; i < doomed.length; i++) {
    for (const k of kids.all(doomed[i])) {
      if (!doomed.includes(k.id)) doomed.push(k.id);
    }
  }
  const del = stmt('DELETE FROM moment_comments WHERE id = ?');
  for (const cid of doomed) del.run(cid);
  return { momentId: row.moment_id, removed: doomed.length };
});

// 删掉了返回 { momentId, removed }；不是你的留言、或者本来就没有，返回 null
export function deleteUserComment(id) {
  if (!Number.isInteger(id)) return null;
  return deleteUserCommentTx(id);
}

// 留言那一行里的「删」，和「↩️ 回复」并排。只给你自己留的那几条
export function renderCommentTools(c, back) {
  return `<form class="cm-del" method="post" action="/moments/comments/${c.id}/delete"
    onsubmit="return confirm('删了这条留言？挂在它下面的回复也一起没了。')">
    <input type="hidden" name="back" value="${escapeHtml(back)}" />
    <button type="submit" aria-label="删掉我的这条留言"><span aria-hidden="true">删</span></button>
  </form>`;
}

export const MY_COMMENTS_CSS = `
  /* 「删」：和旁边的「↩️ 回复」一样小、一样灰，不抢眼。
     留言区本来就挤，这里不给它描边，也不给它颜色 */
  .cm-del { display: inline; margin: 0; }
  .cm-del button { min-height: 32px; padding: 6px 8px; margin: 0; border: 0; border-radius: 8px;
    font-size: 12px; line-height: 1; color: var(--muted, #665a70); background: none; cursor: pointer; }
  .cm-del button:active { background: rgba(122, 62, 93, 0.08); }
  /* sun-time.js 里有一条 html[data-dark] button { color: var(--bg1) }，
     夜里会把这个「删」刷成底色看不见（和点赞那颗心踩过同一个坑），这里拎出来给色 */
  html[data-dark] .cm-del button { color: var(--muted); }
`;

// ── 路由 ──────────────────────────────────
// /moments/comments/:id/delete 是四段，和 /moments/:id/comments（三段）、
// /moments/mine/:id/edit（四段但第二段是字面 mine）都不会撞上。

export function registerMyCommentRoutes(app, { requireBasicAuth }) {
  app.post('/moments/comments/:id/delete', requireBasicAuth, (req, res) => {
    const back = safeBack(req.body?.back);
    if (!sameOrigin(req)) return res.status(403).send('请求来源不对');
    const id = Number(req.params.id);
    let momentId = null;
    if (Number.isInteger(id)) {
      try {
        momentId = deleteUserComment(id)?.momentId ?? null;
      } catch (err) {
        console.error('my-comments: 删留言失败', err);
      }
    }
    // 跳回那条动态，不是跳回页首
    res.redirect(303, momentId ? `${back}#m${momentId}` : back);
  });
}
