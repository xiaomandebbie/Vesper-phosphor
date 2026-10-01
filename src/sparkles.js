// 点击星星：在所有页面点一下，从手指下冒出星星。
// - 三种样子：金星迸散（默认）、一颗一闪、粉星飘落，也可以关掉。在「自定义」页选，记在这台设备上（localStorage）。
//   动态、日记、心绪、记忆库、音乐、外壳都是同一个域名，选一次各页都生效。
// - 星星画在一层不接收点击的浮层上，不挡任何按钮；只听 pointerdown，不拦原本的点击。
//   同时最多 48 颗，连点也不卡。系统开了「减弱动态效果」就不显示。
// - 怎么加到各页：一个中间件包住 res.send / res.end，整页 HTML 的 </body> 前塞一段脚本。
//   记忆库和音乐是转发别人的页面（res.end），我们自己的页面走 res.send，两条路都管。
//   要在 vesper.js 里最先挂，比记忆库、音乐转发都早。

const KEY = 'vp-sparkle';
const MARK = 'id="vp-sparkle"';

const SPARKLE_SCRIPT = `(function () {
  if (window.__vpSparkle) return;
  window.__vpSparkle = true;
  var KEY = '${KEY}';
  var STYLES = ['burst', 'twinkle', 'drift', 'off'];
  var STAR = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.6 6.1 6.6.6-5 4.4 1.5 6.5L12 16.7 6.3 20.1l1.5-6.5-5-4.4 6.6-.6z"/></svg>';
  var reduce = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var layer = null, alive = 0, MAX = 48;
  var PALETTE = {
    burst: [['#ffd45c', 'rgba(255,212,92,.75)'], ['#f6c46a', 'rgba(246,196,106,.65)'], ['#fff1b8', 'rgba(255,230,150,.75)']],
    twinkle: [['#ffd45c', 'rgba(255,212,92,.8)']],
    drift: [['#f2a7c3', 'rgba(242,167,195,.65)'], ['#e88db0', 'rgba(232,141,176,.55)'], ['#ffd45c', 'rgba(255,212,92,.65)']]
  };
  function current() {
    var v = '';
    try { v = localStorage.getItem(KEY) || ''; } catch (e) {}
    return STYLES.indexOf(v) >= 0 ? v : 'burst';
  }
  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function at(x, y, dx, dy, s, r) { return 'translate(' + (x + dx) + 'px,' + (y + dy) + 'px) scale(' + s + ') rotate(' + r + 'deg)'; }
  function ensureLayer() {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;pointer-events:none;z-index:2147483000;overflow:hidden;';
    (document.body || document.documentElement).appendChild(layer);
    return layer;
  }
  function spark(x, y, size, color, frames, duration, delay) {
    if (alive >= MAX) return;
    var el = document.createElement('span');
    if (!el.animate) return;
    alive++;
    el.innerHTML = STAR;
    el.style.cssText = 'position:absolute;left:0;top:0;width:' + size + 'px;height:' + size + 'px;margin:' + (-size / 2) + 'px 0 0 ' + (-size / 2) + 'px;' +
      'color:' + color[0] + ';filter:drop-shadow(0 0 6px ' + color[1] + ');will-change:transform,opacity;opacity:0;pointer-events:none;';
    el.firstChild.style.cssText = 'display:block;width:100%;height:100%;';
    ensureLayer().appendChild(el);
    var a = el.animate(frames, { duration: duration, delay: delay || 0, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'both' });
    a.onfinish = a.oncancel = function () { el.remove(); alive--; };
  }
  var EFFECTS = {
    burst: function (x, y) {
      var n = 7;
      for (var i = 0; i < n; i++) {
        var ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
        var dist = 30 + Math.random() * 26;
        var dx = Math.cos(ang) * dist, dy = Math.sin(ang) * dist, r = (Math.random() - 0.5) * 90;
        spark(x, y, 14 + Math.random() * 10, pick(PALETTE.burst), [
          { transform: at(x, y, 0, 0, 0.2, 0), opacity: 0 },
          { transform: at(x, y, dx * 0.6, dy * 0.6, 1, r * 0.5), opacity: 1, offset: 0.35 },
          { transform: at(x, y, dx, dy, 0.4, r), opacity: 0 }
        ], 680 + Math.random() * 200);
      }
    },
    twinkle: function (x, y) {
      spark(x, y - 6, 30, PALETTE.twinkle[0], [
        { transform: at(x, y - 6, 0, 0, 0.2, -30), opacity: 0 },
        { transform: at(x, y - 6, 0, -8, 1.1, 0), opacity: 1, offset: 0.4 },
        { transform: at(x, y - 6, 0, -14, 0.5, 25), opacity: 0 }
      ], 700);
    },
    drift: function (x, y) {
      for (var i = 0; i < 6; i++) {
        var dx = (Math.random() - 0.5) * 80, fall = 50 + Math.random() * 50, r = (Math.random() - 0.5) * 160;
        spark(x, y, 13 + Math.random() * 10, pick(PALETTE.drift), [
          { transform: at(x, y, 0, 0, 0.3, 0), opacity: 0 },
          { transform: at(x, y, dx * 0.4, -18, 1, r * 0.3), opacity: 1, offset: 0.25 },
          { transform: at(x, y, dx, fall, 0.6, r), opacity: 0 }
        ], 950 + Math.random() * 300, i * 40);
      }
    }
  };
  function play(x, y, style) {
    var s = style || current();
    if (reduce || !EFFECTS[s]) return;
    EFFECTS[s](x, y);
  }
  window.vpSparkle = { play: play, current: current };
  document.addEventListener('pointerdown', function (e) {
    if (e.button > 0) return;
    if (e.target && e.target.closest && e.target.closest('[data-no-sparkle]')) return;
    play(e.clientX, e.clientY);
  }, true);
})();`;

const TAG = `<script ${MARK}>${SPARKLE_SCRIPT}</script>`;

// 「自定义」页的选择卡片。点选项时不冒旧样子的星星（data-no-sparkle），选中后当场放一下新样子
const OPTIONS = [
  ['burst', '金星迸散'],
  ['twinkle', '一颗一闪'],
  ['drift', '粉星飘落'],
  ['off', '关掉'],
];
const CARD = `<section class="card" id="sparkle">
  <h2 class="section-title">点击星星</h2>
  <div role="radiogroup" aria-label="点击星星的样子" data-no-sparkle style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
    ${OPTIONS.map(
      ([v, label]) =>
        `<label style="display:flex;align-items:center;gap:8px;min-height:44px;padding:0 12px;border:1px solid #eadfe6;border-radius:12px;background:#fff;font-size:14px;cursor:pointer;"><input type="radio" name="vp-sparkle" value="${v}" style="width:20px;height:20px;margin:0;padding:0;accent-color:#7a3e5d;" />${label}</label>`
    ).join('')}
  </div>
  <p style="margin:10px 0 0;font-size:12px;line-height:1.6;color:#665a70;">在哪一页点一下都会冒星星。只记在这台设备上；系统开了「减弱动态效果」时不显示。</p>
</section>
<script>(function () {
  var KEY = '${KEY}', v = 'burst';
  try { v = localStorage.getItem(KEY) || 'burst'; } catch (e) {}
  var boxes = document.querySelectorAll('input[name="vp-sparkle"]');
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].value === v) boxes[i].checked = true;
    boxes[i].addEventListener('change', function (e) {
      var t = e.target;
      try { localStorage.setItem(KEY, t.value); } catch (err) {}
      if (window.vpSparkle && t.value !== 'off') {
        var r = t.parentNode.getBoundingClientRect();
        window.vpSparkle.play(r.left + r.width / 2, r.top + r.height / 2, t.value);
      }
    });
  }
})();</script>`;

function inject(html) {
  if (html.includes(MARK)) return html;
  const i = html.toLowerCase().lastIndexOf('</body>');
  return i >= 0 ? html.slice(0, i) + TAG + html.slice(i) : html;
}

function addCard(html) {
  if (html.includes('id="sparkle"')) return html;
  const i = html.lastIndexOf('</main>');
  return i >= 0 ? html.slice(0, i) + CARD + html.slice(i) : html;
}

export function registerSparkles(app) {
  app.use((req, res, next) => {
    // 我们自己的页面：res.send(整页 HTML)。先改好再交给 Express，它会按改过的内容算 Content-Length
    const send = res.send.bind(res);
    res.send = (body) => {
      if (typeof body === 'string' && /<\/body>/i.test(body)) {
        let out = body;
        if (req.method === 'GET' && req.path === '/moments/profile' && res.statusCode === 200) out = addCard(out);
        return send(inject(out));
      }
      return send(body);
    };
    // 转发的页面（记忆库、音乐）：res.end(整页 HTML)。已经定了 Content-Length 的不动，音频这类流式内容不是字符串也不动
    const end = res.end.bind(res);
    res.end = (chunk, ...rest) => {
      if (
        typeof chunk === 'string' &&
        !res.getHeader('content-length') &&
        String(res.getHeader('content-type') || '').includes('text/html')
      ) {
        chunk = inject(chunk);
      }
      return end(chunk, ...rest);
    };
    next();
  });
}
