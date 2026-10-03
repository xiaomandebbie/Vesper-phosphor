// 动态页上那几处「活起来」的细节：点赞不刷整页、一摹卡片和单张等宽、箭头不死板、换页像翻书。
//
// 全部从外框层盖进去（见 page-chrome.js），moments-page.js 一行没动 —— 它 50KB，能不碰就不碰。
// 所以这里的规则都是追着已有的类名写的，改动态页的结构时要回头看一眼这个文件。
//
// 没有 JavaScript 时一切照旧：点赞还是表单提交整页刷新，箭头还在两侧，换页没有翻书感。
// 开了「减弱动态效果」时不翻、不跳、不冒心，但点赞不刷页这个好处还留着。

export const FLOURISH_CSS = `
  /* ── 一摹动作卡片：和单张一样宽 ──
     病根是 .stack-row 左右各占了一个 36px 的箭头，所以带箭头的一摹比单张卡空了 72px。
     把箭头搬到底下、和圆点同一行（搬 DOM 在下面的脚本里），卡片就能占满整行。 */
  .act-stack.ready .stack-row { display: block; }
  .act-stack.ready .stack-viewport { width: 100%; }
  .stack-foot { display: none; }
  .act-stack.ready .stack-foot { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 10px; }
  .act-stack.ready .stack-foot .stack-dots { margin-top: 0; }

  /* ── 箭头：圆的，按下有回弹 ──
     之前是两个 26px 的 ‹ › 字符干巴巴立在那里，这不是字号的事 —— 是它不回应。
     现在：按下去缩一下、箭头往那个方向挪两像素；转完一圈回到头时轻轻摔一下。 */
  .act-stack.ready .stack-arrow {
    display: inline-flex; flex: none; align-items: center; justify-content: center;
    width: 34px; height: 34px; min-height: 34px; padding: 0;
    border-radius: 50%; background: none; color: var(--activity-ink);
    box-shadow: inset 0 0 0 1px var(--activity);
    transition: transform .18s cubic-bezier(.2, .8, .2, 1), background-color .18s ease, box-shadow .18s ease;
  }
  .stack-arrow svg { display: block; width: 15px; height: 15px;
    transition: transform .18s cubic-bezier(.2, .8, .2, 1); }
  .stack-arrow:hover { background: var(--hl); box-shadow: inset 0 0 0 1.5px var(--activity); }
  .stack-arrow:active { transform: scale(.86); }
  .stack-arrow[data-stack-prev]:active svg { transform: translateX(-2px); }
  .stack-arrow[data-stack-next]:active svg { transform: translateX(2px); }
  .stack-arrow.wrapped { animation: arrow-wrap .44s cubic-bezier(.2, .8, .2, 1); }
  @keyframes arrow-wrap { 45% { transform: scale(.9) rotate(-14deg); } }
  /* 圆点：当前那颗拉长成一条，过渡跟着卡片走 */
  .act-stack.ready .stack-dot { transition: width .3s cubic-bezier(.2, .8, .2, 1), background-color .3s ease; }

  /* ── 点赞：点下去就有反应，不等服务器、不刷整页 ── */
  .like-bar { position: relative; }
  .like-btn { transition: transform .2s cubic-bezier(.2, .8, .2, 1), color .2s ease; }
  .like-btn.beat { animation: like-beat .52s cubic-bezier(.2, .8, .2, 1); }
  @keyframes like-beat {
    0% { transform: scale(1); }
    28% { transform: scale(1.44); }
    52% { transform: scale(.9); }
    76% { transform: scale(1.1); }
    100% { transform: scale(1); }
  }
  /* 赞上去时冒几颗小心往上飘 */
  .like-pop { position: absolute; left: 16px; top: 50%; pointer-events: none;
    font-size: 11px; line-height: 1; color: var(--accent); opacity: 0;
    animation: like-pop 1s ease-out forwards; }
  @keyframes like-pop {
    0% { opacity: 0; transform: translate(0, 0) scale(.4); }
    22% { opacity: 1; }
    100% { opacity: 0; transform: translate(var(--dx, 0), -36px) scale(1.15); }
  }
  .like-names { transition: opacity .28s ease; }
  .like-names.fading { opacity: 0; }

  /* ── 换页像翻书 ──
     翻的是 main，不是整屏：底色和星星留在原地，像在桌面上翻过一页。
     以左边缘为轴翻出去，新页从右边翻进来。
     离场 620ms，比外框层 900ms 后才跳转稍短一点，所以翻完正好走。 */
  body { perspective: 1500px; perspective-origin: 50% 38%; }
  main { transform-origin: left center; backface-visibility: hidden;
    transition: transform .62s cubic-bezier(.4, 0, .25, 1), opacity .62s ease, filter .62s ease; }
  html.vp-turn-out main { transform: rotateY(-17deg) translateX(-7%) scale(.955);
    opacity: 0; filter: brightness(.8); }
  html.vp-turn-in main { animation: page-turn-in .66s cubic-bezier(.2, .8, .25, 1) both; }
  @keyframes page-turn-in {
    from { transform: rotateY(15deg) translateX(6%) scale(.955); opacity: 0; filter: brightness(.84); }
    to { transform: none; opacity: 1; filter: none; }
  }

  /* ── 日历下面的「我的收藏」入口 ── */
  .fav-entry { display: flex; align-items: center; gap: 10px; margin: -4px 0 14px;
    padding: 12px 16px; min-height: 44px; background: var(--card);
    border: 1px solid var(--line); border-radius: 14px;
    color: var(--ink); text-decoration: none; font-size: 14px;
    box-shadow: 0 1px 3px rgba(60, 30, 60, .08);
    transition: transform .16s ease, box-shadow .2s ease; }
  .fav-entry:active { transform: scale(.99); }
  .fav-entry .fav-stars { color: var(--gold); font-size: 13px; }
  .fav-entry .fav-count { margin-left: auto; color: var(--muted); font-size: 12.5px;
    font-variant-numeric: tabular-nums; }
  .fav-entry .fav-go { color: var(--muted); font-size: 15px; }

  /* ── 每条动态上的收藏星 ── */
  .fav-btn { background: none; border: 0; padding: 0; margin-left: 2px;
    min-width: 44px; min-height: 44px; font-size: 17px; line-height: 1;
    color: var(--muted); cursor: pointer;
    transition: transform .2s cubic-bezier(.2, .8, .2, 1), color .2s ease; }
  .fav-btn.on { color: var(--gold); }
  .fav-btn.spin { animation: fav-spin .5s cubic-bezier(.2, .8, .2, 1); }
  @keyframes fav-spin {
    0% { transform: scale(1) rotate(0); }
    40% { transform: scale(1.35) rotate(72deg); }
    100% { transform: scale(1) rotate(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    main, html.vp-turn-in main { transition: none; animation: none; }
    html.vp-turn-out main { transform: none; opacity: 0; filter: none; }
    .like-btn.beat, .fav-btn.spin, .stack-arrow.wrapped { animation: none; }
    .stack-arrow, .stack-arrow svg, .act-stack.ready .stack-dot, .fav-entry { transition: none; }
    .like-pop { display: none; }
  }
`;

// 排在 CHROME_SCRIPT 后面跑。进场的记号是 HEAD_SCRIPT 在 head 里打的（vp-turn-in），
// 所以和外框层那个星星转场互不干扰。
export const FLOURISH_SCRIPT = `(function () {
  var root = document.documentElement;
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // 进场翻书：动画跑完把记号去掉，不留在 <html> 上
  if (root.classList.contains('vp-turn-in')) {
    setTimeout(function () { root.classList.remove('vp-turn-in'); }, 700);
  }

  // 离场翻书：哪些链接该走转场已经由外框层判过了（它会 preventDefault，然后 900ms 后跳），
  // 这里不重复那套规则，只在它接管时跟着翻一下。
  // defaultPrevented 要等它的 listener 跑完才看得到，所以放到下一拍再读。
  document.addEventListener('click', function (e) {
    if (!e.target.closest || !e.target.closest('a[href]')) return;
    setTimeout(function () {
      if (e.defaultPrevented) root.classList.add('vp-turn-out');
    }, 0);
  });

  // ── 一摹动作卡片：箭头搬到底下 ──
  var CHEV = {
    prev: 'M15 5l-7 7 7 7',
    next: 'M9 5l7 7-7 7'
  };
  function chevron(dir) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"'
      + ' stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'
      + (dir < 0 ? CHEV.prev : CHEV.next) + '"></path></svg>';
  }

  document.querySelectorAll('[data-stack]').forEach(function (stack) {
    var prev = stack.querySelector('[data-stack-prev]');
    var next = stack.querySelector('[data-stack-next]');
    var dots = stack.querySelector('.stack-dots');
    if (!prev || !next || !dots) return;

    // 搬 DOM 不会丢 listener，所以上下翻的逻辑（moments-page.js 里的 STACK_SCRIPT）照旧用
    var foot = document.createElement('div');
    foot.className = 'stack-foot';
    dots.parentNode.insertBefore(foot, dots);
    foot.appendChild(prev);
    foot.appendChild(dots);
    foot.appendChild(next);

    prev.innerHTML = chevron(-1);
    next.innerHTML = chevron(1);

    // 转完一圈回到头时摔一下。当前是第几张看圆点，不碰那边的状态
    if (reduce) return;
    var all = [].slice.call(dots.querySelectorAll('.stack-dot'));
    var at = function () {
      for (var k = 0; k < all.length; k++) if (all[k].classList.contains('on')) return k;
      return -1;
    };
    [[prev, -1], [next, 1]].forEach(function (pair) {
      var btn = pair[0], dir = pair[1];
      btn.addEventListener('click', function () {
        var before = at();
        setTimeout(function () {
          var after = at();
          var wrapped = dir > 0 ? (before === all.length - 1 && after === 0) : (before === 0 && after === all.length - 1);
          if (!wrapped) return;
          btn.classList.remove('wrapped');
          void btn.offsetWidth;
          btn.classList.add('wrapped');
        }, 0);
      });
    });
  });

  // ── 点赞：不刷整页 ──
  // 先就地翻面（点下去就有反应），再把表单发出去；
  // 回来的是整页 HTML，只从里面取这条动态的「谁赞了」，名字就不用自己拼。
  // fetch / DOMParser 任一不在，或者请求失败，都退回整页提交。
  function popHearts(bar) {
    for (var i = 0; i < 3; i++) {
      var s = document.createElement('span');
      s.className = 'like-pop';
      s.setAttribute('aria-hidden', 'true');
      s.textContent = '\u2665';
      s.style.setProperty('--dx', (Math.random() * 22 - 11).toFixed(1) + 'px');
      s.style.animationDelay = (i * 0.09).toFixed(2) + 's';
      bar.appendChild(s);
      (function (el) { setTimeout(function () { el.remove(); }, 1400); })(s);
    }
  }

  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || !form.getAttribute) return;
    if (!/\\/like$/.test(form.getAttribute('action') || '')) return;
    if (!window.fetch || !window.DOMParser || !window.FormData) return;

    var bar = form.closest('.like-bar');
    var btn = form.querySelector('.like-btn');
    var art = form.closest('article');
    if (!bar || !btn || !art) return;

    e.preventDefault();
    var on = !btn.classList.contains('on');
    btn.classList.toggle('on', on);
    var glyph = btn.querySelector('span');
    if (glyph) glyph.textContent = on ? '\u2665' : '\u2661';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', on ? '取消点赞' : '点赞');
    btn.classList.remove('beat');
    void btn.offsetWidth;
    btn.classList.add('beat');
    if (on && !reduce) popHearts(bar);

    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      credentials: 'same-origin',
      headers: { Accept: 'text/html' }
    })
      .then(function (r) { if (!r.ok) throw new Error('like failed'); return r.text(); })
      .then(function (html) {
        var fresh = new DOMParser().parseFromString(html, 'text/html').getElementById(art.id);
        var freshBar = fresh && fresh.querySelector('.like-bar');
        if (!freshBar) return;
        var now = freshBar.querySelector('.like-names');
        var mine = bar.querySelector('.like-names');
        if (now && mine) { mine.textContent = now.textContent; }
        else if (now && !mine) { bar.appendChild(now); }
        else if (!now && mine) {
          mine.classList.add('fading');
          setTimeout(function () { mine.remove(); }, 300);
        }
      })
      .catch(function () {
        // 没发成功就别装作赞上了，退回表单提交让服务器说算
        form.submit();
      });
  });

  // ── 收藏 ──
  // 日历卡片下面插一个「我的收藏」入口，每条动态的点赞旁边插一颗星。
  // 收藏状态要问服务器（页面是服务端渲染的，HTML 里没这个信息），所以拉一次 ids。
  // 拉不到就不插，页面和原来一样 —— 收藏是附加的，不能因为它坏了把动态页拖下水。
  if (!window.fetch) return;
  var onMoments = /^\\/moments\\/?$/.test(location.pathname);

  fetch('/moments/favorites.json', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (data) {
      if (!data || !data.ok) return;
      var ids = {};
      (data.ids || []).forEach(function (id) { ids[String(id)] = 1; });

      // 入口：只在动态页主页插，跟在日历卡片后面
      var cal = document.querySelector('.cal-card');
      if (onMoments && cal && !document.querySelector('.fav-entry')) {
        var a = document.createElement('a');
        a.className = 'fav-entry';
        a.href = '/moments/favorites';
        a.innerHTML = '<span class="fav-stars" aria-hidden="true">\u2726<\/span>'
          + '<span>我的收藏<\/span>'
          + '<span class="fav-count">' + (data.count || 0) + ' 条<\/span>'
          + '<span class="fav-go" aria-hidden="true">\u203a<\/span>';
        cal.parentNode.insertBefore(a, cal.nextSibling);
      }

      // 每条 TA 发的动态：点赞旁边加一颗星。动作卡片没有点赞条，自然也不加
      document.querySelectorAll('article.moment.post').forEach(function (art) {
        var bar = art.querySelector('.like-bar');
        if (!bar || bar.querySelector('.fav-btn')) return;
        var id = (art.id || '').replace(/^m/, '');
        if (!/^\\d+$/.test(id)) return;
        var on = !!ids[id];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'fav-btn' + (on ? ' on' : '');
        btn.setAttribute('aria-pressed', String(on));
        btn.setAttribute('aria-label', on ? '从收藏里拿出来' : '收藏这条');
        btn.innerHTML = '<span aria-hidden="true">' + (on ? '\u2605' : '\u2606') + '<\/span>';
        btn.addEventListener('click', function () {
          var next = !btn.classList.contains('on');
          btn.classList.toggle('on', next);
          btn.setAttribute('aria-pressed', String(next));
          btn.setAttribute('aria-label', next ? '从收藏里拿出来' : '收藏这条');
          btn.querySelector('span').textContent = next ? '\u2605' : '\u2606';
          if (!reduce) { btn.classList.remove('spin'); void btn.offsetWidth; btn.classList.add('spin'); }
          fetch('/moments/' + id + '/favorite', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' }
          })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (d) {
              // 服务器说算：和我们猜的不一样就改回来
              if (!d || !d.ok || d.on === next) return;
              btn.classList.toggle('on', d.on);
              btn.setAttribute('aria-pressed', String(d.on));
              btn.querySelector('span').textContent = d.on ? '\u2605' : '\u2606';
            })
            .catch(function () {
              btn.classList.toggle('on', !next);
              btn.setAttribute('aria-pressed', String(!next));
              btn.querySelector('span').textContent = !next ? '\u2605' : '\u2606';
            });
        });
        bar.appendChild(btn);
      });
    })
    .catch(function () {});
})();`;
