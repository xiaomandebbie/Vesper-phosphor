// PWA 推送：VAPID 密钥、订阅表、发送。
//
// 小满 2026-11-05：「帮我做好 PWA 通知，以后允朔发动态就发通知「允朔更新了动态」，
// 动作就写动作名」
//
// 整条链路：他做了事 → 服务端用 VAPID 私钥加密 → 发给苹果推送服务（APNs）
// → 苹果戳到手机上 → service worker 弹通知。
//
// ── 要准备的东西 ──
//
//   1. 一对 VAPID 密钥：`npx web-push generate-vapid-keys`
//      公钥放前端（随便公开），私钥放 .env（泄了就是别人能冒充你的服务器发推送）
//   2. 订阅表：endpoint 做主键，存 p256dh 和 auth 两把子钥
//   3. 发送：web-push 这个包
//   4. service worker 里的 push 事件（在 pwa.js 里，和 manifest 摆在一起）
//
// ── iOS 的硬条件 ──
//
//   · 必须是装到主屏幕的 PWA。Safari 标签页里永远收不到
//   · iOS 16.4 以上
//   · manifest 要有 display: standalone（pwa.js 里已经是）
//   · 通知权限只弹一次。拒了就得去系统设置里手动开，没有第二次机会
//     → 所以权限请求挂在「模型·连接·通知」里的那个开关上，进页不弹
//
// ── 几个定下来的做法 ──
//
// 没配密钥整套不开，不报错——和小酒馆、台灯同一个口径。
//
// 发失败不重试、不阻塞：推送是附加的，他做的事本身已经成立，
// 不该因为 APNs 一时连不上就拖住唤醒那一轮。
//
// 404 / 410 = 订阅死了（卸了 PWA、清了网站数据），直接删。
// 不删的话每次都往一个空号打电话，日志里全是废话。

import db from './state.js';

const env = (k) => String(process.env[k] ?? '').trim();

// 密钥读一次就存着：每次读 .env 没意义，pm2 restart 才会变
const PUBLIC_KEY = env('VAPID_PUBLIC_KEY');
const PRIVATE_KEY = env('VAPID_PRIVATE_KEY');
// web-push 要一个联系方式（mailto: 或 https://），推送服务出问题时找你。
// 没填用一个占位的，不影响发送
const SUBJECT = env('VAPID_SUBJECT') || 'mailto:vesper@localhost';

db.exec(`
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER,
  last_err TEXT
);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

// 配好了没有。没配时设置页那个开关置灰并写明差哪两个变量
export function isPushConfigured() {
  return Boolean(PUBLIC_KEY && PRIVATE_KEY);
}

// 前端订阅要的公钥
export function publicKey() {
  return PUBLIC_KEY;
}

export function countSubs() {
  try {
    return stmt('SELECT COUNT(*) AS c FROM push_subs').get().c;
  } catch {
    return 0;
  }
}

// 记下一个订阅。同一个 endpoint 再来就更新子钥（子钥会变）
export function saveSub({ endpoint, p256dh, auth }) {
  const e = String(endpoint ?? '').trim();
  const p = String(p256dh ?? '').trim();
  const a = String(auth ?? '').trim();
  if (!/^https:\/\//.test(e) || !p || !a) return { error: '订阅信息不完整' };
  try {
    stmt(
      `INSERT INTO push_subs (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth, last_err = NULL`
    ).run(e, p, a, Date.now());
    return { ok: true, count: countSubs() };
  } catch (err) {
    console.error('push: 订阅存不下来', err.message);
    return { error: err.message };
  }
}

export function dropSub(endpoint) {
  try {
    return stmt('DELETE FROM push_subs WHERE endpoint = ?').run(String(endpoint ?? '')).changes > 0;
  } catch {
    return false;
  }
}

export function dropAllSubs() {
  try {
    return stmt('DELETE FROM push_subs').run().changes;
  } catch {
    return 0;
  }
}

// web-push 是可选依赖：没装就不开推送，别让整个 vesper 起不来。
// 动态 import，只在真要发的时候加载一次
let webpushPromise = null;
async function getWebpush() {
  if (!webpushPromise) {
    webpushPromise = import('web-push')
      .then((m) => {
        const wp = m.default ?? m;
        wp.setVapidDetails(SUBJECT, PUBLIC_KEY, PRIVATE_KEY);
        return wp;
      })
      .catch((err) => {
        console.error('push: 没装 web-push（npm i web-push），推送不开', err.message);
        return null;
      });
  }
  return webpushPromise;
}

// 发一条。谁都不该 await 它的结果——详见文件头。
//
// title：通知的标题（「允朔更新了动态」这类）
// body：正文，可以空
// url：点通知跳哪里，默认主页
export async function sendPush({ title, body = '', url = '/home', tag = '' }) {
  if (!isPushConfigured()) return { skipped: 'no-keys' };
  const t = String(title ?? '').trim();
  if (!t) return { skipped: 'no-title' };

  let subs;
  try {
    subs = stmt('SELECT endpoint, p256dh, auth FROM push_subs').all();
  } catch (err) {
    console.error('push: 读不到订阅', err.message);
    return { error: err.message };
  }
  if (!subs.length) return { skipped: 'no-subs' };

  const webpush = await getWebpush();
  if (!webpush) return { skipped: 'no-web-push' };

  const payload = JSON.stringify({ title: t, body: String(body ?? ''), url, tag });
  let sent = 0;
  let gone = 0;

  for (const s of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        // TTL 1 小时：手机关着超过这么久，这条就不必再弹了
        { TTL: 3600 }
      );
      sent++;
      stmt('UPDATE push_subs SET last_ok_at = ?, last_err = NULL WHERE endpoint = ?').run(Date.now(), s.endpoint);
    } catch (err) {
      const code = err?.statusCode;
      // 订阅死了（卸了 PWA、清了网站数据），删掉不再试
      if (code === 404 || code === 410) {
        dropSub(s.endpoint);
        gone++;
        continue;
      }
      console.error(`push: 发失败（${code ?? '?'}）`, String(err?.message ?? err).slice(0, 200));
      try {
        stmt('UPDATE push_subs SET last_err = ? WHERE endpoint = ?')
          .run(`${code ?? '?'}: ${String(err?.message ?? err).slice(0, 200)}`, s.endpoint);
      } catch {}
    }
  }

  if (sent || gone) console.log(`push: 「${t}」发了 ${sent} 台${gone ? `，清了 ${gone} 个死订阅` : ''}`);
  return { sent, gone };
}

// 不等结果的版本。唤醒链里用这个：发不出去不影响他做完的那件事
export function pushAsync(opts) {
  if (!isPushConfigured()) return;
  sendPush(opts).catch((err) => console.error('push: 发送出错', err.message));
}

export function pushConfigSummary() {
  if (!isPushConfigured()) return 'PWA 通知：未配置（缺 VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY）';
  const n = countSubs();
  return `PWA 通知：已配置，${n ? `${n} 台设备订阅着` : '还没有设备订阅'}`;
}
