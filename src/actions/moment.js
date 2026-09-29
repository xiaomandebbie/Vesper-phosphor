// 发一条动态（替代原来的日记）。
// 正文必填；image_prompt 选填，配了生图就真的生成一张图；voice_text 选填，配了 ElevenLabs 就生成语音。
// 两条动态之间至少隔 MOMENT_MIN_INTERVAL_HOURS 小时（默认 6）。逛论坛、翻记忆这类行为记录不算。
import fs from 'fs';
import path from 'path';
import { addMoment } from '../state.js';
import { getLastPostTs } from '../moments-store.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const IMAGES_DIR = path.join(MEDIA_DIR, 'images');
const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');

const IMAGE_API_URL = (process.env.IMAGE_API_URL || '').trim();
const IMAGE_API_KEY = (process.env.IMAGE_API_KEY || '').trim();
const IMAGE_MODEL = (process.env.IMAGE_MODEL || '').trim();
const IMAGE_API_FORMAT = (process.env.IMAGE_API_FORMAT || 'openai').trim().toLowerCase();
const IMAGE_SIZE = (process.env.IMAGE_SIZE || '1024x1024').trim();
const IMAGE_TIMEOUT_MS = Number(process.env.IMAGE_TIMEOUT_MS) || 180000;

export const isImageEnabled = () => Boolean(IMAGE_API_URL && IMAGE_API_KEY && IMAGE_MODEL);
export const isVoiceEnabled = () =>
  Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);

// 两条动态最少隔多久。填 0 就是不限制。
export const MOMENT_MIN_INTERVAL_HOURS = (() => {
  const raw = process.env.MOMENT_MIN_INTERVAL_HOURS;
  const h = Number(raw);
  return raw !== undefined && raw !== '' && Number.isFinite(h) && h >= 0 ? h : 6;
})();

// 距离下一条动态可以发还要等几毫秒，0 就是现在就能发
export function momentWaitMs(now = Date.now()) {
  const last = getLastPostTs();
  if (!last) return 0;
  return Math.max(0, last + MOMENT_MIN_INTERVAL_HOURS * 3600000 - now);
}

function timestampName(ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}.${ext}`;
}

function extFromType(contentType) {
  if (/jpe?g/i.test(contentType)) return 'jpg';
  if (/webp/i.test(contentType)) return 'webp';
  return 'png';
}

function saveImage(buffer, ext) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  const filename = timestampName(ext);
  fs.writeFileSync(path.join(IMAGES_DIR, filename), buffer);
  return `/media/images/${filename}`;
}

// 生成失败一律返回 null：动态照发，只是没图。
async function generateImage(prompt) {
  if (!prompt) return null;
  if (!isImageEnabled()) {
    console.warn('moment: 没配生图（IMAGE_API_URL / IMAGE_API_KEY / IMAGE_MODEL），这条动态不配图');
    return null;
  }
  const body =
    IMAGE_API_FORMAT === 'siliconflow'
      ? { model: IMAGE_MODEL, prompt, image_size: IMAGE_SIZE, batch_size: 1 }
      : { model: IMAGE_MODEL, prompt, n: 1, ...(IMAGE_SIZE ? { size: IMAGE_SIZE } : {}) };
  try {
    const res = await fetch(IMAGE_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${IMAGE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error('moment: 生图失败', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    const data = await res.json();
    const item = data?.data?.[0] ?? data?.images?.[0];
    if (item?.b64_json) return saveImage(Buffer.from(item.b64_json, 'base64'), 'png');
    if (item?.url) {
      const img = await fetch(item.url, { signal: AbortSignal.timeout(60000) });
      if (!img.ok) {
        console.error('moment: 下载生成的图片失败', img.status);
        return null;
      }
      return saveImage(Buffer.from(await img.arrayBuffer()), extFromType(img.headers.get('content-type') || ''));
    }
    console.error('moment: 生图接口没返回图片', JSON.stringify(data).slice(0, 300));
    return null;
  } catch (err) {
    console.error('moment: 生图失败', err.message);
    return null;
  }
}

// ElevenLabs 文字转语音。模型固定 eleven_v3：只有它认 [breathing] / [whispers] 这类标签。
async function generateAudio(text) {
  if (!text || !isVoiceEnabled()) return null;
  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}`, {
      method: 'POST',
      headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: 'eleven_v3' }),
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      console.error('moment: ElevenLabs error', res.status, (await res.text()).slice(0, 300));
      return null;
    }
    fs.mkdirSync(AUDIO_DIR, { recursive: true });
    const filename = timestampName('mp3');
    fs.writeFileSync(path.join(AUDIO_DIR, filename), Buffer.from(await res.arrayBuffer()));
    return `/media/audio/${filename}`;
  } catch (err) {
    console.error('moment: 生成语音失败', err.message);
    return null;
  }
}

// `detail` 可以是纯文本（只写正文），也可以是 JSON 字符串：
// {"content":"...", "image_prompt":"...", "voice_text":"[breathing] ..."}
export default async function moment(detail) {
  let content = typeof detail === 'string' ? detail : '';
  let imagePrompt = null;
  let voiceText = null;
  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === 'object') {
      content = typeof parsed.content === 'string' ? parsed.content : '';
      imagePrompt = typeof parsed.image_prompt === 'string' ? parsed.image_prompt.trim() : null;
      voiceText = typeof parsed.voice_text === 'string' ? parsed.voice_text.trim() : null;
    }
  } catch {
    // 不是 JSON，就当纯文本正文处理
  }

  content = content.trim();
  if (!content && !imagePrompt) {
    console.warn('moment: 正文和配图都是空的，不发');
    return { ok: false, reason: 'empty' };
  }

  // 先查间隔再生成图片和语音，免得白花钱
  const wait = momentWaitMs();
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60000);
    console.warn(`moment: 距上一条动态不到 ${MOMENT_MIN_INTERVAL_HOURS} 小时，还要等 ${minutes} 分钟，这次不发`);
    return { ok: false, reason: 'cooldown', wait_minutes: minutes };
  }

  const [image_url, audio_url] = await Promise.all([generateImage(imagePrompt), generateAudio(voiceText)]);
  const id = addMoment({ content, image_url, audio_url });
  return { ok: true, id, content, has_image: Boolean(image_url), has_audio: Boolean(audio_url) };
}
