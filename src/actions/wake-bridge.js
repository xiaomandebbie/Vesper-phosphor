// 把一段话投进 Aru 的对话，而不是只弹一个通知。
//
// 走的是 Aru Host 的 wake-bridge：正文要用 sender-bundle 里的密钥加密再发。
// 加密方式和 Aevella/aru-host 的 src/notifications/wake-send.mjs 一模一样
// （AES-256-GCM，nonce 12 字节，密文后面接 auth tag，整体 base64）。
// 那边要是换了格式，这里也得跟着换，不然 Host 会拒收。
//
// 凭据不放仓库里：sender-bundle 是一份 JSON，路径写在 .env 的 WAKE_BUNDLE_FILE。
// 它等于"以你的名义往她手机投消息"的钥匙，别提交、别截图、别贴进聊天。
import fs from 'fs';
import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';

const BUNDLE_FILE = (process.env.WAKE_BUNDLE_FILE || '').trim();
const BUNDLE_INLINE = (process.env.WAKE_BUNDLE || '').trim();
const TIMEOUT_MS = Number(process.env.WAKE_SUBMIT_TIMEOUT_MS || 15000);

let cached = null;

export function isWakeBridgeEnabled() {
  return Boolean(BUNDLE_FILE || BUNDLE_INLINE);
}

// 读一次就记住。换了 bundle 要重启 phosphor 才生效——省得每次醒来都读盘。
function loadBundle() {
  if (cached) return cached;
  const raw = BUNDLE_FILE ? fs.readFileSync(BUNDLE_FILE, 'utf8') : BUNDLE_INLINE;
  const bundle = JSON.parse(raw);
  if (bundle?.schema !== 'aru.wake-bridge.sender-bundle.v2') {
    throw new Error(`sender-bundle 的 schema 不认识：${bundle?.schema}`);
  }
  const key = Buffer.from(bundle.encryptionKey ?? '', 'base64');
  if (key.length !== 32) throw new Error('sender-bundle 里的 encryptionKey 不是 32 字节');
  cached = { ...bundle, key };
  return cached;
}

function seal(bundle, content, eventId) {
  const payload = Buffer.from(
    JSON.stringify({
      schema: 'aru.wake-bridge.payload.v2',
      eventId,
      triggerId: bundle.triggerId,
      content,
    }),
    'utf8'
  );
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', bundle.key, nonce);
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()]);
  return Buffer.concat([nonce, ciphertext, cipher.getAuthTag()]).toString('base64');
}

// 投一段话。成功返回 { ok: true, eventId }；没配或投失败返回 { ok: false, reason }。
// 这里不抛错：调用方（bark 动作）还要接着发通知，不能被这里带崩。
export async function submitWakeEvent(content) {
  if (!isWakeBridgeEnabled()) return { ok: false, reason: 'WAKE_BUNDLE_FILE not set' };
  const text = String(content ?? '').trim();
  if (!text) return { ok: false, reason: 'content is empty' };
  try {
    const bundle = loadBundle();
    const eventId = randomUUID();
    const res = await fetch(bundle.submitURL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${bundle.submitToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        schema: 'aru.wake-bridge.sealed-event.v1',
        eventId,
        sealedPayload: seal(bundle, text, eventId),
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };
    return { ok: true, eventId };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}
