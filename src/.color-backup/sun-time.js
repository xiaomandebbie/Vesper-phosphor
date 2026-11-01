// 早晚两张脸：页面的底色按「这里」真实的日出日落走，不按系统时间、也不按时区的整点。
// 长沙十月六点多就日落了，要是照时区切，晚上七点还亮着晨光，那就假了。
//
// 四个相位：
//   dawn 晨 — 日出前 50 分钟到日出后 30 分钟。浅、亮，一点暖光。
//   day  日 — 白天。
//   dusk 暮 — 日落前 45 分钟到日落后 55 分钟。暖光退下去，紫色压上来。
//   night夜 — 深紫压下来，星在最上面。
// 晨和暮是过渡段，带一个 0→1 的进度 t。
//
// 颜色分两类走，这是被坑过一次后定的规矩：
//   底色（bg1〜bg3）连续插值，所以有「正在日落」的感觉；
//   文字和卡片色在过渡的中点整组翻面，不插值。
// 因为文字色一插值，中段就是中灰字配中灰底，谁也看不清。翻面只发生一次，
// body 上有 1.2s 的 color 过渡兑着，不生硬。
//
// 底色暗的那几张脸会在 <html> 上打 data-dark，所有深色覆盖跟它走。
// 不按四张脸穷举：暮色渐变到哪一刻该翻成浅字，由颜色自己说。
//
// 服务端渲染首屏时就把当前的脸算好内联进去（不闪白），页面打开后自己按分钟重算。

const rad = Math.PI / 180;

// 位置：默认长沙。想换地方在 .env 里填 VESPER_LAT / VESPER_LON
export const LAT = Number(process.env.VESPER_LAT ?? 28.228);
export const LON = Number(process.env.VESPER_LON ?? 112.939);

// 过渡有多长（分钟）。想让日出日落的感觉更长就把这几个数字调大
const DAWN_BEFORE = 50, DAWN_AFTER = 30;
const DUSK_BEFORE = 45, DUSK_AFTER = 55;

// ── 天文 ──────────────────────────────────────────────────────────────────
// NOAA sunrise equation。只用标准库，不引第三方包。
// 太阳中心高度取 -0.833°（下边缘擦地平线 + 大气折射），和通常说的「日出日落」一致。

function jdMidnightUT(y, m, d) {
  if (m <= 2) { y -= 1; m += 12; }
  const A = Math.floor(y / 100), B = Math.floor(A / 4), C = 2 - A + B;
  const E = Math.floor(365.25 * (y + 4716)), F = Math.floor(30.6001 * (m + 1));
  return C + d + E + F - 1524.5;
}

const jdToMs = (jd) => (jd - 2440587.5) * 86400000;

// 某个日历日的日出、日落（毫秒时间戳）。
// 极昼极夜（高纬度）没有日出日落，polar 会是 'day' 或 'night'，调用方按常亮/常暗处理。
export function sunTimes(y, m, d, lat = LAT, lon = LON) {
  const n = Math.round(jdMidnightUT(y, m, d) + 0.5 - 2451545.0);
  const Jstar = n + 0.0009 - lon / 360;
  const M = (357.5291 + 0.98560028 * Jstar) % 360;
  const Mr = M * rad;
  const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
  const lam = (M + C + 180 + 102.9372) % 360;
  const lr = lam * rad;
  const Jtr = 2451545.0 + Jstar + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
  const dec = Math.asin(Math.sin(lr) * Math.sin(23.4397 * rad));
  const phi = lat * rad;
  const cw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
  if (cw > 1) return { riseMs: null, setMs: null, polar: 'night' };
  if (cw < -1) return { riseMs: null, setMs: null, polar: 'day' };
  const w = Math.acos(cw) / rad;
  return { riseMs: jdToMs(Jtr - w / 360), setMs: jdToMs(Jtr + w / 360), polar: null };
}

// ── 相位 ──────────────────────────────────────────────────────────────────

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// 这一刻在 TIME_ZONE 下算哪一天。日出日落要按当地的日历日取，不能用 UTC 的那天
function wallYMD(ms, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const o = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return { y: +o.year, m: +o.month, d: +o.day };
}

// 当下是哪张脸。face: dawn | day | dusk | night；t 只在 dawn / dusk 有意义（0→1 的过渡进度）
export function faceAt(ms = Date.now(), { lat = LAT, lon = LON, tz = process.env.TIME_ZONE || 'Asia/Shanghai' } = {}) {
  const w = wallYMD(ms, tz);
  const t = sunTimes(w.y, w.m, w.d, lat, lon);
  if (t.polar) return { face: t.polar === 'day' ? 'day' : 'night', t: 0, riseMs: null, setMs: null };
  const { riseMs, setMs } = t;
  const dawnFrom = riseMs - DAWN_BEFORE * 60000, dawnTo = riseMs + DAWN_AFTER * 60000;
  const duskFrom = setMs - DUSK_BEFORE * 60000, duskTo = setMs + DUSK_AFTER * 60000;
  if (ms >= dawnFrom && ms < dawnTo) {
    return { face: 'dawn', t: clamp01((ms - dawnFrom) / (dawnTo - dawnFrom)), riseMs, setMs };
  }
  if (ms >= duskFrom && ms < duskTo) {
    return { face: 'dusk', t: clamp01((ms - duskFrom) / (duskTo - duskFrom)), riseMs, setMs };
  }
  if (ms >= dawnTo && ms < duskFrom) return { face: 'day', t: 0, riseMs, setMs };
  return { face: 'night', t: 0, riseMs, setMs };
}

// ── 四张脸的颜色 ──────────────────────────────────────────────────────────
// 每个键都是一条 CSS 变量，键名就是变量名（`ink` → `--ink`）。
// 三个数字是 rgb，四个是 rgba。star 是数字：夜空星点的透明度，白天 0，入夜 1。
// dark 是这张脸的底算不算暗 —— 暗的话 <html> 上打 data-dark，深色覆盖跟着生效。
//
// activity / activity-ink / place / card-soft / detail-bg / hl 这几个是动态页里原本写死的颜色：
// 动作卡的白底、深棕色的「在哪做的」、批注展开后的浅黄底、评论区的浅粉底。
// 它们之前没跟着换，所以夜里深字落在白底上、或者浅字落在白底上，都糊。

const PALETTE = {
  night: {
    dark: true,
    bg1: [34, 27, 60], bg2: [48, 33, 72], bg3: [58, 38, 74],
    ink: [243, 238, 250], muted: [196, 184, 212], accent: [236, 176, 206],
    gold: [240, 200, 128], card: [60, 47, 82], line: [96, 78, 118],
    t1: [198, 180, 248], t2: [240, 174, 212], t3: [246, 206, 140],
    activity: [226, 183, 106], 'activity-ink': [246, 214, 152], place: [250, 224, 158],
    'card-soft': [68, 53, 92], 'detail-bg': [72, 56, 96], hl: [226, 183, 106, 0.26],
    star: 1,
  },
  dawn: {
    dark: false,
    bg1: [252, 228, 226], bg2: [253, 238, 226], bg3: [255, 249, 240],
    ink: [62, 44, 56], muted: [128, 102, 116], accent: [178, 86, 110],
    gold: [198, 134, 52], card: [255, 253, 250], line: [240, 222, 226],
    t1: [128, 96, 168], t2: [196, 94, 128], t3: [224, 150, 60],
    activity: [233, 190, 110], 'activity-ink': [148, 96, 28], place: [158, 104, 24],
    'card-soft': [250, 240, 240], 'detail-bg': [255, 248, 233], hl: [233, 190, 110, 0.36],
    star: 0,
  },
  day: {
    dark: false,
    bg1: [239, 231, 244], bg2: [249, 240, 238], bg3: [253, 248, 242],
    ink: [43, 34, 51], muted: [102, 90, 112], accent: [122, 62, 93],
    gold: [183, 121, 47], card: [255, 253, 251], line: [234, 223, 230],
    t1: [70, 58, 124], t2: [155, 74, 122], t3: [196, 131, 47],
    activity: [230, 182, 82], 'activity-ink': [138, 90, 20], place: [154, 100, 18],
    'card-soft': [243, 238, 242], 'detail-bg': [253, 246, 230], hl: [230, 182, 82, 0.38],
    star: 0,
  },
  dusk: {
    dark: true,
    bg1: [86, 54, 100], bg2: [150, 76, 102], bg3: [214, 134, 94],
    ink: [252, 244, 242], muted: [224, 204, 206], accent: [250, 192, 168],
    gold: [250, 206, 134], card: [92, 60, 98], line: [132, 94, 122],
    t1: [230, 204, 252], t2: [252, 186, 180], t3: [252, 216, 148],
    activity: [246, 198, 124], 'activity-ink': [252, 226, 168], place: [252, 228, 164],
    'card-soft': [102, 68, 106], 'detail-bg': [106, 70, 110], hl: [246, 198, 124, 0.28],
    star: 0.55,
  },
};

// 底色和星点透明度连续插值；其余（文字、卡片、边框）在中点整组翻面
const FADE_KEYS = ['bg1', 'bg2', 'bg3'];

const lerp = (a, b, k) => a + (b - a) * k;

// stops 是一串关键色，t 在整串上走 0→1
function blend(stops, t) {
  const n = stops.length - 1;
  const x = clamp01(t) * n;
  const i = Math.min(Math.floor(x), n - 1);
  const k = x - i;
  const A = stops[i], B = stops[i + 1];
  const side = k < 0.5 ? A : B;      // 文字色：跟近的那边，不插值
  const out = { dark: side.dark };
  for (const key of Object.keys(A)) {
    if (key === 'dark') continue;
    if (key === 'star') { out.star = lerp(A.star, B.star, k); continue; }
    out[key] = FADE_KEYS.includes(key)
      ? A[key].map((v, j) => Math.round(lerp(v, B[key][j], k)))
      : side[key];
  }
  return out;
}

// 当前这一刻该用的那套颜色
export function paletteFor(face, t = 0) {
  if (face === 'dawn') return blend([PALETTE.night, PALETTE.dawn, PALETTE.day], t);
  if (face === 'dusk') return blend([PALETTE.day, PALETTE.dusk, PALETTE.night], t);
  return PALETTE[face] || PALETTE.day;
}

const cssColor = (c) => (c.length > 3 ? `rgba(${c[0]},${c[1]},${c[2]},${c[3]})` : `rgb(${c[0]},${c[1]},${c[2]})`);

// 一串 `--x: ...;`，内联到 <html style> 上。页面里的 :root 变量照旧用，值由这里给
export function faceVars(face, t = 0) {
  const p = paletteFor(face, t);
  const out = [];
  for (const key of Object.keys(p)) {
    if (key === 'dark') continue;
    out.push(key === 'star' ? `--star:${p.star.toFixed(3)}` : `--${key}:${cssColor(p[key])}`);
  }
  return out.join(';');
}

// 服务端渲染要往 <html> 上挂的东西：
//   data-face 给 CSS 挑规则，data-dark 让深色覆盖生效，style 给首屏颜色
export function faceAttrs(ms = Date.now()) {
  const f = faceAt(ms);
  const p = paletteFor(f.face, f.t);
  return ` data-face="${f.face}"${p.dark ? ' data-dark' : ''} style="${faceVars(f.face, f.t)}"`;
}

// ── 页面那一侧 ────────────────────────────────────────────────────────────

// 夜空的星点：铺在最上面一层，不挡点击。整层透明度是 --star，白天 0，整层看不见。
// 拆成三层：本体是中等大小的一批，::before 是密一点的小星，::after 是几颗大的。
// 三层周期不同、起始错开，所以是一闪一闪地亮，不是整片一起呼吸。
// 注意：本体的 opacity 是 --star，不能拿来做动画（一动画就把 --star 盖掉，白天也会冒星），
// 所以本体闪的是亮度，两个伪元素闪的是自己的透明度。
export const FACE_CSS = `
  body { background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%);
    transition: background 1.2s linear, color 1.2s linear; }
  .sky { position: fixed; inset: 0; z-index: 9; pointer-events: none; opacity: var(--star, 0);
    transition: opacity 1.6s linear;
    filter: drop-shadow(0 0 5px rgba(255, 238, 190, 0.75));
    background-repeat: no-repeat;
    background-image:
      radial-gradient(2.4px 2.4px at 12% 14%, #fff 48%, transparent 52%),
      radial-gradient(2.2px 2.2px at 43% 19%, #fff 48%, transparent 52%),
      radial-gradient(2.6px 2.6px at 71% 11%, #fff3d0 48%, transparent 52%),
      radial-gradient(2.3px 2.3px at 88% 24%, #ffe9b8 48%, transparent 52%),
      radial-gradient(2.5px 2.5px at 24% 37%, #fff 48%, transparent 52%),
      radial-gradient(2.2px 2.2px at 62% 44%, #fff6dc 48%, transparent 52%),
      radial-gradient(2.4px 2.4px at 92% 52%, #fff 48%, transparent 52%);
    animation: sky-a 4.2s ease-in-out infinite; }
  .sky::before, .sky::after { content: ''; position: absolute; inset: 0; background-repeat: no-repeat; }
  .sky::before {
    background-image:
      radial-gradient(1.8px 1.8px at 28% 7%, #ffe9b8 48%, transparent 52%),
      radial-gradient(1.6px 1.6px at 54% 26%, #fff 48%, transparent 52%),
      radial-gradient(1.9px 1.9px at 7% 29%, #fff 48%, transparent 52%),
      radial-gradient(1.7px 1.7px at 37% 48%, #ffeec4 48%, transparent 52%),
      radial-gradient(1.6px 1.6px at 79% 35%, #fff 48%, transparent 52%),
      radial-gradient(1.8px 1.8px at 66% 61%, #fff 48%, transparent 52%),
      radial-gradient(1.7px 1.7px at 16% 58%, #fff6dc 48%, transparent 52%),
      radial-gradient(1.6px 1.6px at 48% 69%, #fff 48%, transparent 52%);
    animation: sky-b 5.6s ease-in-out -1.9s infinite; }
  .sky::after {
    filter: drop-shadow(0 0 8px rgba(255, 230, 170, 0.9));
    background-image:
      radial-gradient(3.4px 3.4px at 19% 9%, #fff 46%, transparent 52%),
      radial-gradient(3.1px 3.1px at 58% 16%, #fff6dc 46%, transparent 52%),
      radial-gradient(3.3px 3.3px at 84% 40%, #fff 46%, transparent 52%),
      radial-gradient(3px 3px at 33% 57%, #ffe9b8 46%, transparent 52%),
      radial-gradient(3.2px 3.2px at 73% 73%, #fff 46%, transparent 52%);
    animation: sky-c 7.4s ease-in-out -3.6s infinite; }
  @keyframes sky-a { 0%, 100% { filter: drop-shadow(0 0 4px rgba(255, 238, 190, 0.6)) brightness(0.8); }
    50% { filter: drop-shadow(0 0 7px rgba(255, 238, 190, 0.95)) brightness(1.45); } }
  @keyframes sky-b { 0%, 100% { opacity: 0.32; } 45% { opacity: 1; } }
  @keyframes sky-c { 0%, 100% { opacity: 0.55; } 60% { opacity: 1; } }

  /* 底色暗的时候：把那些写死的白底、浅粉底、深棕字全换成跟着脸走的色。
     这整段比各页 STYLE 里的规则排得晚，而且多一层 html[data-dark]，所以盖得住 */
  html[data-dark] .moment.activity { background: var(--card); }
  html[data-dark] .act-stack.ready .stack-viewport::before,
  html[data-dark] .act-stack.ready .stack-viewport::after { background: var(--card); }
  html[data-dark] .activity-detail .detail { background: var(--detail-bg); }
  html[data-dark] .comments, html[data-dark] .voice-gone { background: var(--card-soft); }
  html[data-dark] .act-place { color: var(--place);
    background: linear-gradient(transparent 60%, var(--hl) 60%); }
  html[data-dark] .expand-hint, html[data-dark] .stack-arrow { color: var(--activity-ink); }
  html[data-dark] .stack-dot { background: var(--line); }
  html[data-dark] .stack-dot.on { background: var(--activity); }
  html[data-dark] .wake-line { background: var(--card); color: var(--gold); }
  html[data-dark] input { background: var(--card); color: var(--ink); border-color: var(--line); }
  html[data-dark] .vp-menu-panel { background: var(--card); color: var(--ink); border-color: var(--line); }
  html[data-dark] .vp-menu-panel a { color: var(--ink); }
  html[data-dark] .vp-menu-panel a:hover, html[data-dark] .vp-menu-panel a:focus-visible { background: var(--line); }
  html[data-dark] .vp-menu-btn { color: var(--accent); }
  html[data-dark] .vp-menu-fixed .vp-menu-btn { background: var(--card); }
  html[data-dark] .vp-menu-soon, html[data-dark] .vp-menu-soon small { color: var(--muted); }
  html[data-dark] img.avatar { background: var(--line); }
  /* 暗底上 accent 是浅粉，再放白字就看不见了：按钮和选中的那天改用深底色当字 */
  html[data-dark] button { color: var(--bg1); }
  html[data-dark] .day.selected { color: var(--bg1); }
  html[data-dark] .day.selected .dot { background: var(--bg1); }
  /* 深底上原来那层浅投影看不见，压重一点才有卡片感 */
  html[data-dark] .card, html[data-dark] .moment { box-shadow: 0 1px 4px rgba(0, 0, 0, 0.32); }
  @media (prefers-reduced-motion: reduce) {
    .sky, .sky::before, .sky::after { animation: none; }
    body { transition: none; }
  }
`;

// 页面自己按分钟重算。跨过日出日落那一刻会自己换过去，不用刷新。
// 过渡段里每 30 秒挪一点，平时每分钟看一眼就够。
export const FACE_SCRIPT = `(function () {
  var LAT = ${LAT}, LON = ${LON}, TZ = ${JSON.stringify(process.env.TIME_ZONE || 'Asia/Shanghai')};
  var DAWN_B = ${DAWN_BEFORE}, DAWN_A = ${DAWN_AFTER}, DUSK_B = ${DUSK_BEFORE}, DUSK_A = ${DUSK_AFTER};
  var P = ${JSON.stringify(PALETTE)};
  var FADE = ${JSON.stringify(FADE_KEYS)};
  var rad = Math.PI / 180;
  function jdMid(y, m, d) {
    if (m <= 2) { y -= 1; m += 12; }
    var A = Math.floor(y / 100), B = Math.floor(A / 4), C = 2 - A + B;
    return C + d + Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) - 1524.5;
  }
  function sun(y, m, d) {
    var n = Math.round(jdMid(y, m, d) + 0.5 - 2451545);
    var J = n + 0.0009 - LON / 360;
    var M = (357.5291 + 0.98560028 * J) % 360, Mr = M * rad;
    var C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) + 0.0003 * Math.sin(3 * Mr);
    var lr = ((M + C + 180 + 102.9372) % 360) * rad;
    var Jtr = 2451545 + J + 0.0053 * Math.sin(Mr) - 0.0069 * Math.sin(2 * lr);
    var dec = Math.asin(Math.sin(lr) * Math.sin(23.4397 * rad)), phi = LAT * rad;
    var cw = (Math.sin(-0.833 * rad) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    var ms = function (jd) { return (jd - 2440587.5) * 86400000; };
    if (cw > 1) return { polar: 'night' };
    if (cw < -1) return { polar: 'day' };
    var w = Math.acos(cw) / rad;
    return { rise: ms(Jtr - w / 360), set: ms(Jtr + w / 360) };
  }
  function ymd(ms) {
    try {
      var p = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date(ms)).reduce(function (o, x) { o[x.type] = x.value; return o; }, {});
      return { y: +p.year, m: +p.month, d: +p.day };
    } catch (e) {
      var dt = new Date(ms);
      return { y: dt.getFullYear(), m: dt.getMonth() + 1, d: dt.getDate() };
    }
  }
  function face(ms) {
    var w = ymd(ms), s = sun(w.y, w.m, w.d);
    if (s.polar) return { f: s.polar === 'day' ? 'day' : 'night', t: 0 };
    var da = s.rise - DAWN_B * 60000, db = s.rise + DAWN_A * 60000;
    var ua = s.set - DUSK_B * 60000, ub = s.set + DUSK_A * 60000;
    var cl = function (x) { return x < 0 ? 0 : x > 1 ? 1 : x; };
    if (ms >= da && ms < db) return { f: 'dawn', t: cl((ms - da) / (db - da)) };
    if (ms >= ua && ms < ub) return { f: 'dusk', t: cl((ms - ua) / (ub - ua)) };
    if (ms >= db && ms < ua) return { f: 'day', t: 0 };
    return { f: 'night', t: 0 };
  }
  // 底色插值，文字色在中点整组翻面 —— 和服务端同一套规矩
  function blend(stops, t) {
    var n = stops.length - 1;
    var x = (t < 0 ? 0 : t > 1 ? 1 : t) * n;
    var i = Math.min(Math.floor(x), n - 1);
    var k = x - i, A = stops[i], B = stops[i + 1];
    var side = k < 0.5 ? A : B;
    var out = { dark: side.dark }, key;
    for (key in A) {
      if (key === 'dark') continue;
      if (key === 'star') { out.star = A.star + (B.star - A.star) * k; continue; }
      out[key] = FADE.indexOf(key) >= 0
        ? A[key].map(function (v, j) { return Math.round(v + (B[key][j] - v) * k); })
        : side[key];
    }
    return out;
  }
  function pal(f, t) {
    if (f === 'dawn') return blend([P.night, P.dawn, P.day], t);
    if (f === 'dusk') return blend([P.day, P.dusk, P.night], t);
    return P[f] || P.day;
  }
  var root = document.documentElement;
  function apply() {
    var c = face(Date.now()), p = pal(c.f, c.t), key;
    root.setAttribute('data-face', c.f);
    if (p.dark) root.setAttribute('data-dark', ''); else root.removeAttribute('data-dark');
    for (key in p) {
      if (key === 'dark') continue;
      if (key === 'star') { root.style.setProperty('--star', (+p.star).toFixed(3)); continue; }
      var v = p[key];
      root.style.setProperty('--' + key, v.length > 3
        ? 'rgba(' + v[0] + ',' + v[1] + ',' + v[2] + ',' + v[3] + ')'
        : 'rgb(' + v[0] + ',' + v[1] + ',' + v[2] + ')');
    }
    return c.f === 'dawn' || c.f === 'dusk' ? 30000 : 60000;
  }
  var timer;
  function loop() { clearTimeout(timer); timer = setTimeout(function () { loop(); }, apply()); }
  loop();
  // 手机息屏放回口袋再掏出来，可能已经天黑了，回到前台立刻重算
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loop(); });
})();`;
