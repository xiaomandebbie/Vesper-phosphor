// 动态页日历下面那个「星星罐」入口，它的样式，以及行为卡片里「星星罐」三个字的标记。
//
// 单独一个文件是为了避开循环依赖：外框层（page-chrome.js）要把这几段拼进每一页，
// 而星星罐页面自己又要用外框层的菜单和转场。这个文件谁都不 import，所以两边都能安全地用它。
//
// 样式借了收藏入口那套（.fav-entry，在 flourish.js 里），只把星星的颜色和"未摘"时那圈光换掉。

export const STAR_ENTRY_CSS = `
  .star-entry .fav-stars { color: #d2719b; }
  .star-entry .fav-count.lit { color: var(--gold); }
  /* 有没摘的星星、而且现在是该提醒的时间：入口边上一圈淡粉的光 */
  .star-entry.lit { border-color: #f0cfe0;
    box-shadow: 0 1px 3px rgba(60, 30, 60, 0.08), 0 0 0 2px rgba(240, 207, 224, 0.5); }
  html[data-dark] .star-entry .fav-stars { color: #f6c3d8; }
  html[data-dark] .star-entry.lit { border-color: rgba(246, 195, 216, 0.5);
    box-shadow: 0 1px 3px rgba(10, 6, 20, 0.3), 0 0 0 2px rgba(246, 195, 216, 0.3); }

  /* 行为卡片里的「星星罐」：和卡片里的 Lutopia 论坛、OB 记忆库一个待遇（.act-place），
     只是颜色更暖一点——罐子里装的是星星，不是地方 */
  .act-jar { color: #b8860b; font-weight: 800; padding: 0 1px; border-radius: 2px;
    background: linear-gradient(transparent 60%, rgba(247, 168, 196, 0.42) 60%); }
  html[data-dark] .act-jar { color: #f8d27a;
    background: linear-gradient(transparent 60%, rgba(247, 168, 196, 0.3) 60%); }
`;

// 排在收藏那段后面跑。拉不到就不插，页面和原来一样——星星罐是附加的，
// 不能因为它坏了把动态页拖下水。
//
// 第二段把行为卡片正文里的「星星罐」包成 <b class="act-jar">。
// 本来该改 moments-page.js 里的 highlightPlaces，但那文件 46KB，为三个字重写不值；
// 这段本来就跟着外框层进每一页，效果一样。只改文本节点，不碰 HTML 结构。
export const STAR_ENTRY_SCRIPT = `(function () {
  // 行为卡片里的「星星罐」标成暖黄。只走文本节点，不用 innerHTML，
  // 避开把正文里的尖括号当成标签这类问题。
  (function markJar() {
    var cards = document.querySelectorAll('.moment.activity .content');
    for (var i = 0; i < cards.length; i++) {
      var walker = document.createTreeWalker(cards[i], NodeFilter.SHOW_TEXT, null);
      var hits = [];
      var node;
      while ((node = walker.nextNode())) {
        if (node.nodeValue && node.nodeValue.indexOf('\\u661f\\u661f\\u7f50') !== -1) hits.push(node);
      }
      for (var k = 0; k < hits.length; k++) {
        var t = hits[k];
        var parts = t.nodeValue.split('\\u661f\\u661f\\u7f50');
        var frag = document.createDocumentFragment();
        for (var p = 0; p < parts.length; p++) {
          if (parts[p]) frag.appendChild(document.createTextNode(parts[p]));
          if (p < parts.length - 1) {
            var b = document.createElement('b');
            b.className = 'act-jar';
            b.textContent = '\\u661f\\u661f\\u7f50';
            frag.appendChild(b);
          }
        }
        t.parentNode.replaceChild(frag, t);
      }
    }
  })();

  if (!window.fetch) return;
  if (!/^\\/moments\\/?$/.test(location.pathname)) return;

  fetch('/moments/star-jar.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.ok) return;
      if (document.querySelector('.star-entry')) return;
      var cal = document.querySelector('.cal-card');
      if (!cal) return;

      var count = Number(d.count) || 0;
      var unpicked = Number(d.unpicked) || 0;
      var lit = !!d.lit;

      var a = document.createElement('a');
      a.className = 'fav-entry star-entry' + (lit ? ' lit' : '');
      a.href = '/moments/star-jar';

      var mark = document.createElement('span');
      mark.className = 'fav-stars';
      mark.setAttribute('aria-hidden', 'true');
      mark.textContent = '\\u2726';
      var name = document.createElement('span');
      name.textContent = '\\u661f\\u661f\\u7f50';
      var note = document.createElement('span');
      note.className = 'fav-count' + (lit ? ' lit' : '');
      // 该提醒的时间里才说"未摘"，白天只报个数
      note.textContent = lit
        ? (unpicked > 1 ? '\\u6709 ' + unpicked + ' \\u9897\\u661f\\u661f\\u672a\\u6458 \\u2728' : '\\u6709\\u4e00\\u9897\\u661f\\u661f\\u672a\\u6458 \\u2728')
        : count + ' \\u9897';
      var go = document.createElement('span');
      go.className = 'fav-go';
      go.setAttribute('aria-hidden', 'true');
      go.textContent = '\\u203a';

      a.appendChild(mark);
      a.appendChild(name);
      a.appendChild(note);
      a.appendChild(go);

      // 插在收藏入口下面；收藏那段也是异步插的，还没来就跟在日历后面
      var fav = document.querySelector('.fav-entry:not(.star-entry)');
      var anchor = fav || cal;
      anchor.parentNode.insertBefore(a, anchor.nextSibling);
    })
    .catch(function () {});
})();`;
