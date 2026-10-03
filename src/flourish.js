// 动态页上那几处「活起来」的细节：点赞不刷整页、一摹卡片滑着翻、夜里的心和星是浅粉的。
//
// 全部从外框层盖进去（见 page-chrome.js），moments-page.js 一行没动 —— 它 50KB，能不碰就不碰。
// 所以这里的规则都是追着已有的类名写的，改动态页的结构时要回头看一眼这个文件。
//
// 没有 JavaScript 时一切照旧：点赞还是表单提交整页刷新，一摹卡片一张张排开。
// 开了「减弱动态效果」时不跳、不冒心，但点赞不刷页这个好处还留着。

export const FLOURISH_CSS = `
  /* ── 夜里的心和星：浅粉 ──
     之前发暗是个误伤：sun-time.js 里有一条 html[data-dark] button { color: var(--bg1) }，
     本意是让深底上的「发送」按钮别放白字，结果一网打尽把点赞、收藏也刷成了深底色。
     这里排在它后面，把这两颗拎出来单独给色。 */
  html[data-dark] { --heart: #f7bcd4; --heart-soft: #f9d2e2; --fav: #f6c3d8; }
  html[data-dark] .like-btn { color: var(--heart); }
  html[data-dark] .like-pop { color: var(--heart-soft); }
  html[data-dark] .fav-btn { color: var(--muted); }
  html[data-dark] .fav-btn.on { color: var(--fav); }
  html[data-dark] .fav-entry .fav-stars { color: var(--fav); }

  /* ── 一摹动作卡片：滑着翻，和单张一样宽 ──
     等宽的病根是 .stack-row 左右各占了一个 36px 的箭头，比单张卡空了 72px。
     箭头现在收起来了，滑动切卡 —— 但没删，只是藏成只有键盘和读屏能用：
     用键盘的人没法滑，按钮还得给他们留着（而且删了就要改 moments-page.js）。 */
  .act-stack.ready .stack-row { display: block; }
  .act-stack.ready .stack-viewport { width: 100%; touch-action: pan-y; }
  .act-stack.ready .stack-arrow {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  /* 键盘 Tab 到它时再露出来，不然没法知道焦点在哪 */
  .act-stack.ready .stack-arrow:focus-visible {
    position: static; width: auto; height: auto; min-height: 44px; padding: 0 10px;
    margin: 0; overflow: visible; clip: auto;
    color: var(--activity-ink); background: var(--hl); border-radius: 10px; }

  /* 底下一行：圆点 + 「滑动看其他」。只有一摹是多张时才出现 */
  .stack-foot { display: none; }
  .act-stack.ready .stack-foot { display: flex; align-items: center; justify-content: center;
    gap: 10px; margin-top: 10px; }
  .act-stack.ready .stack-foot .stack-dots { margin-top: 0; }
  .stack-hint { font-size: 11px; letter-spacing: 0.05em; color: var(--muted); opacity: 0.75; }
  /* 翻过一次之后就不必再提示了 */
  .act-stack.swiped .stack-hint { opacity: 0; transition: opacity .4s ease; }
  /* 圆点：当前那颗拉长成一条，过渡跟着卡片走。点圆点也能跳 */
  .act-stack.ready .stack-dots { gap: 7px; }
  .act-stack.ready .stack-dot { transition: width .3s cubic-bezier(.2, .8, .2, 1), background-color .3s ease; }
  .act-stack.ready .stack-dot-btn { background: none; border: 0; padding: 7px 3px; margin: -7px 0;
    line-height: 0; cursor: pointer; }

  /* 滑动时卡片跟着手指挪一点，松手弹回来 */
  .act-stack.ready .stack-item { transition: transform .26s cubic-bezier(.2, .8, .2, 1); }
  .act-stack.dragging .stack-item { transition: none; }

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
    .like-btn.beat, .fav-btn.spin { animation: none; }
    .act-stack.ready .stack-dot, .act-stack.ready .stack-item, .fav-entry { transition: none; }
    .like-pop { display: none; }
  }
`;

// 排在 CHROME_SCRIPT 后面跑。
export const FLOURISH_SCRIPT = `(function () {
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // ── 一摹动作卡片：滑动切卡 ──
  // 上下翻的逻辑在 moments-page.js 的 STACK_SCRIPT 里，它绑在那两个箭头按钮上，
  // 也已经支持滑动（touchstart/touchend，40px 门槛）。所以这里不重写逻辑，
  // 只做两件事：把箭头搬到底下（并且藏成只给键盘用），以及给滑动加上跟手的位移和提示。
  // 要翻哪张就替用户点一下那个隐起来的按钮，状态还是那边说算，不会两套。
  document.querySelectorAll('[data-stack]').forEach(function (stack) {
    var prev = stack.querySelector('[data-stack-prev]');
    var next = stack.querySelector('[data-stack-next]');
    var dots = stack.querySelector('.stack-dots');
    var vp = stack.querySelector('.stack-viewport');
    if (!prev || !next || !dots || !vp) return;

    // 搬 DOM 不会丢 listener，所以 STACK_SCRIPT 绑的那些照旧生效
    var foot = document.createElement('div');
    foot.className = 'stack-foot';
    dots.parentNode.insertBefore(foot, dots);
    foot.appendChild(prev);
    foot.appendChild(dots);
    foot.appendChild(next);
    var hint = document.createElement('span');
    hint.className = 'stack-hint';
    hint.setAttribute('aria-hidden', 'true');
    hint.textContent = '滑动看其他';
    foot.appendChild(hint);
    foot.appendChild(next);

    // 点圆点也能跳：差几步就点几次那个隐起来的箭头，走近路
    var all = [].slice.call(dots.querySelectorAll('.stack-dot'));
    var at = function () {
      for (var k = 0; k < all.length; k++) if (all[k].classList.contains('on')) return k;
      return -1;
    };
    all.forEach(function (dot, k) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'stack-dot-btn';
      btn.setAttribute('aria-label', '第 ' + (k + 1) + ' 个行动');
      dot.parentNode.insertBefore(btn, dot);
      btn.appendChild(dot);
      btn.addEventListener('click', function () {
        var from = at();
        if (from < 0 || from === k) return;
        var n = all.length;
        var fwd = (k - from + n) % n;
        var back = (from - k + n) % n;
        var btnToHit = fwd <= back ? next : prev;
        var times = Math.min(fwd, back);
        for (var i = 0; i < times; i++) btnToHit.click();
      });
    });

    // 滑动时卡片跟着手指挪，松手弹回来。
    // 真正切不切卡还是 STACK_SCRIPT 判（它在 touchend 里看位移），
    // 这里只管手感，所以两边不会打打。
    if (reduce) return;
    var x0 = null, y0 = null, lock = null;
    var items = function () { return [].slice.call(stack.querySelectorAll('.stack-item')); };
    var shift = function (dx) {
      items().forEach(function (el) {
        if (!el.hidden) el.style.transform = dx ? 'translateX(' + dx + 'px)' : '';
      });
    };
    vp.addEventListener('touchstart', function (e) {
      var t = e.touches[0];
      x0 = t.clientX; y0 = t.clientY; lock = null;
    }, { passive: true });
    vp.addEventListener('touchmove', function (e) {
      if (x0 === null) return;
      var t = e.touches[0];
      var dx = t.clientX - x0, dy = t.clientY - y0;
      // 先分清是横拖还是竖滚，定了就不换，不然滚页时卡片会跟着抖
      if (lock === null && Math.abs(dx) + Math.abs(dy) > 8) {
        lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
        if (lock === 'x') stack.classList.add('dragging');
      }
      if (lock !== 'x') return;
      // 跟手但打个折，再加上限，看起来像带着阻力
      var k = dx * 0.42;
      shift(Math.max(-56, Math.min(56, k)));
    }, { passive: true });
    var done = function () {
      if (x0 === null) return;
      x0 = y0 = null;
      if (lock === 'x') {
        stack.classList.add('swiped');
        stack.classList.remove('dragging');
        // 松手先弹回原位；STACK_SCRIPT 要是判定该切卡，它自己的进场动画接上
        shift(0);
      }
      lock = null;
    };
    vp.addEventListener('touchend', done);
    vp.addEventListener('touchcancel', done);
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
