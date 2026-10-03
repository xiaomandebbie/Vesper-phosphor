// 早晚两张脸：页面的底色按「这里」真实的日出日落走，不按系统时间、也不按时区的整点。
// 长沙十月六点多就日落了，要是照时区切，晚上七点还亮着晨光，那就假了。
//
// 四个相位：
//   dawn 晨 — 日出前 50 分钟到日出后 30 分钟。浅、亮，一点暖光。
//   day  日 — 白天。
//   dusk 暮 — 日落前 45 分钟到日落后 55 分钟。暖光退下去，紫色压上来。
//   night夜 — 深紫压下来，星在最上面。
// 晨和暮是过渡段，带一个 0→1 的进度 t，颜色在三个关键色之间真的渐变过去，
// 所以有「正在日出」「正在日落」的感觉，不是啪一下换皮。
//
// 服务端渲染首屏时就把当前的脸算好内联进去（不闪白），页面打开后自己按分钟重算，
// 跨过日出日落那一刻会自己换过去，不用刷新、也没有手动开关。

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
// 每个键都是一条 CSS 变量。晨、暮是过渡段：前半截从夜/日渐变到晨/暮的最浓处，
// 后半截再渐变到日/夜，所以暖光在中段最足。
//
// star 是夜空星点的透明度 —— 白天是 0（看不见），入夜升到 1，「星在最上面」。

const PALETTE = {
  night: {
    bg1: [38, 30, 66], bg2: [52, 36, 78], bg3: [63, 42, 80],
    ink: [240, 234, 246], muted: [185, 172, 200], accent: [226, 166, 196],
    gold: [226, 183, 106], card: [54, 42, 74], line: [84, 68, 104],
    t1: [196, 178, 246], t2: [232, 166, 204], t3: [240, 198, 132],
    star: 1,
  },
  dawn: {
    bg1: [252, 228, 226], bg2: [253, 238, 226], bg3: [255, 249, 240],
    ink: [62, 44, 56], muted: [128, 102, 116], accent: [178, 86, 110],
    gold: [198, 134, 52], card: [255, 253, 250], line: [240, 222, 226],
    t1: [128, 96, 168], t2: [196, 94, 128], t3: [224, 150, 60],
    star: 0,
  },
  day: {
    bg1: [239, 231, 244], bg2: [249, 240, 238], bg3: [253, 248, 242],
    ink: [43, 34, 51], muted: [102, 90, 112], accent: [122, 62, 93],
    gold: [183, 121, 47], card: [255, 253, 251], line: [234, 223, 230],
    t1: [70, 58, 124], t2: [155, 74, 122], t3: [196, 131, 47],
    star: 0,
  },
  dusk: {
    bg1: [92, 58, 104], bg2: [152, 78, 104], bg3: [214, 134, 94],
    ink: [250, 240, 238], muted: [214, 192, 196], accent: [246, 184, 160],
    gold: [246, 198, 124], card: [86, 56, 92], line: [124, 86, 116],
    t1: [226, 198, 250], t2: [250, 178, 174], t3: [250, 210, 140],
    star: 0.55,
  },
};

const lerp = (a, b, k) => a + (b - a) * k;

function mixPalette(a, b, k) {
  const out = {};
  for (const key of Object.keys(a)) {
    out[key] = Array.isArray(a[key])
      ? a[key].map((v, i) => Math.round(lerp(v, b[key][i], k)))
      : lerp(a[key], b[key], k);
  }
  return out;
}

// 当前这一刻该用的那套颜色。晨、暮各自分两段插值，中段最浓
export function paletteFor(face, t = 0) {
  if (face === 'dawn') {
    return t < 0.5
      ? mixPalette(PALETTE.night, PALETTE.dawn, t / 0.5)
      : mixPalette(PALETTE.dawn, PALETTE.day, (t - 0.5) / 0.5);
  }
  if (face === 'dusk') {
    return t < 0.5
      ? mixPalette(PALETTE.day, PALETTE.dusk, t / 0.5)
      : mixPalette(PALETTE.dusk, PALETTE.night, (t - 0.5) / 0.5);
  }
  return PALETTE[face] || PALETTE.day;
}

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// 一串 `--x: ...;`，内联到 <html style> 上。页面里的 :root 变量照旧用，值由这里给
export function faceVars(face, t = 0) {
  const p = paletteFor(face, t);
  return [
    `--bg1:${rgb(p.bg1)}`, `--bg2:${rgb(p.bg2)}`, `--bg3:${rgb(p.bg3)}`,
    `--ink:${rgb(p.ink)}`, `--muted:${rgb(p.muted)}`, `--accent:${rgb(p.accent)}`,
    `--gold:${rgb(p.gold)}`, `--card:${rgb(p.card)}`, `--line:${rgb(p.line)}`,
    `--t1:${rgb(p.t1)}`, `--t2:${rgb(p.t2)}`, `--t3:${rgb(p.t3)}`,
    `--star:${p.star.toFixed(3)}`,
  ].join(';');
}

// 服务端渲染要往 <html> 上挂的东西：data-face 给 CSS 挑规则，style 给首屏颜色
export function faceAttrs(ms = Date.now()) {
  const f = faceAt(ms);
  return ` data-face="${f.face}" style="${faceVars(f.face, f.t)}"`;
}

// ── 页面那一侧 ────────────────────────────────────────────────────────────

// 夜空的星点：铺在最上面一层，不挡点击。白天 --star 是 0，整层看不见。
// 开了「减弱动态效果」就不呼吸，只是静静亮着。
export const FACE_CSS = `
  body { background: linear-gradient(180deg, var(--bg1) 0%, var(--bg2) 55%, var(--bg3) 100%);
    transition: background 1.2s linear, color 1.2s linear; }
  .sky { position: fixed; inset: 0; z-index: 9; pointer-events: none; opacity: var(--star, 0);
    transition: opacity 1.6s linear;
    background-image:
      radial-gradient(1.6px 1.6px at 12% 14%, #fff 50%, transparent 52%),
      radial-gradient(1.4px 1.4px at 28% 7%, #ffe9b8 50%, transparent 52%),
      radial-gradient(1.2px 1.2px at 43% 19%, #fff 50%, transparent 52%),
      radial-gradient(1.7px 1.7px at 58% 9%, #fff3d0 50%, transparent 52%),
      radial-gradient(1.3px 1.3px at 71% 22%, #fff 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 86% 12%, #ffe9b8 50%, transparent 52%),
      radial-gradient(1.2px 1.2px at 94% 28%, #fff 50%, transparent 52%),
      radial-gradient(1.4px 1.4px at 7% 33%, #fff 50%, transparent 52%),
      radial-gradient(1.1px 1.1px at 35% 38%, #ffeec4 50%, transparent 52%),
      radial-gradient(1.3px 1.3px at 64% 34%, #fff 50%, transparent 52%),
      radial-gradient(1.2px 1.2px at 79% 42%, #fff 50%, transparent 52%),
      radial-gradient(1.5px 1.5px at 20% 48%, #fff6dc 50%, transparent 52%);
    animation: sky-breathe 7s ease-in-out infinite; }
  @keyframes sky-breathe { 0%, 100% { filter: brightness(1); } 50% { filter: brightness(1.35); } }
  /* 夜里把卡片和输入框一起压深，不然白卡片浮在深紫上太刺眼 */
  html[data-face="night"] input, html[data-face="dusk"] input,
  html[data-face="night"] .vp-menu-panel, html[data-face="dusk"] .vp-menu-panel {
    background: var(--card); color: var(--ink); border-color: var(--line); }
  html[data-face="night"] .vp-menu-btn, html[data-face="dusk"] .vp-menu-btn { color: var(--accent); }
  html[data-face="night"] .vp-menu-panel a, html[data-face="dusk"] .vp-menu-panel a { color: var(--ink); }
  html[data-face="night"] .vp-menu-panel a:hover, html[data-face="dusk"] .vp-menu-panel a:hover { background: var(--line); }
  html[data-face="night"] .wake-line, html[data-face="dusk"] .wake-line { background: var(--card); color: var(--gold); }
  html[data-face="night"] img.avatar, html[data-face="dusk"] img.avatar { background: var(--line); }
  @media (prefers-reduced-motion: reduce) {
    .sky { animation: none; }
    body { transition: none; }
  }
`;

// 页面自己按分钟重算。跨过日出日落那一刻会自己换过去，不用刷新。
// 过渡段里每 30 秒挪一点，平时每分钟看一眼就够。
export const FACE_SCRIPT = `(function () {
  var LAT = ${LAT}, LON = ${LON}, TZ = ${JSON.stringify(process.env.TIME_ZONE || 'Asia/Shanghai')};
  var DAWN_B = ${DAWN_BEFORE}, DAWN_A = ${DAWN_AFTER}, DUSK_B = ${DUSK_BEFORE}, DUSK_A = ${DUSK_AFTER};
  var P = ${JSON.stringify(PALETTE)};
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
  function mix(a, b, k) {
    var o = {}, key;
    for (key in a) {
      o[key] = a[key].length
        ? [0, 1, 2].map(function (i) { return Math.round(a[key][i] + (b[key][i] - a[key][i]) * k); })
        : a[key] + (b[key] - a[key]) * k;
    }
    return o;
  }
  function pal(f, t) {
    if (f === 'dawn') return t < 0.5 ? mix(P.night, P.dawn, t / 0.5) : mix(P.dawn, P.day, (t - 0.5) / 0.5);
    if (f === 'dusk') return t < 0.5 ? mix(P.day, P.dusk, t / 0.5) : mix(P.dusk, P.night, (t - 0.5) / 0.5);
    return P[f] || P.day;
  }
  var root = document.documentElement;
  var KEYS = ['bg1', 'bg2', 'bg3', 'ink', 'muted', 'accent', 'gold', 'card', 'line', 't1', 't2', 't3'];
  function apply() {
    var c = face(Date.now()), p = pal(c.f, c.t);
    root.setAttribute('data-face', c.f);
    KEYS.forEach(function (k) {
      root.style.setProperty('--' + k, 'rgb(' + p[k][0] + ',' + p[k][1] + ',' + p[k][2] + ')');
    });
    root.style.setProperty('--star', (+p.star).toFixed(3));
    return c.f === 'dawn' || c.f === 'dusk' ? 30000 : 60000;
  }
  var timer;
  function loop() { clearTimeout(timer); timer = setTimeout(function () { loop(); }, apply()); }
  loop();
  // 手机息屏放回口袋再掏出来，可能已经天黑了，回到前台立刻重算
  document.addEventListener('visibilitychange', function () { if (!document.hidden) loop(); });
})();`;
