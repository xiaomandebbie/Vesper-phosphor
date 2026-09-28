import fs from 'fs';
import path from 'path';
import { saveDiary } from '../state.js';

const MEDIA_DIR = process.env.MEDIA_DIR || '/opt/vesper/media';
const IMAGES_DIR = path.join(MEDIA_DIR, 'images');
const AUDIO_DIR = path.join(MEDIA_DIR, 'audio');

function ensureDirs() {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
}

function timestampName(ext) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}.${ext}`;
}

// TODO: 接入你选定的生图 API。返回 null 就代表"没生成"，diary() 会正确跳过，
// 不写占位图或空文件——宁可没有图，也不要放一张破图。
async function generateImage(prompt) {
  if (!prompt) return null;
  console.warn('generateImage(): 还没接生图API，跳过。prompt:', prompt);
  return null;

  // 接好之后大概长这样：
  // const res = await fetch('...你的生图API...', { ... });
  // if (!res.ok) return null;
  // const buffer = await res.arrayBuffer();
  // ensureDirs();
  // const filename = timestampName('png');
  // fs.writeFileSync(path.join(IMAGES_DIR, filename), Buffer.from(buffer));
  // return `/media/images/${filename}`;
}

// ElevenLabs 文字转语音。模型固定 eleven_v3，voice id 从 .env 读。
// 方括号标签（[breathing] / [whispers] 等）只有 eleven_v3 才会按语气演绎，
// 换成 eleven_multilingual_v2 会把标签原样念出来，别换模型。
async function generateAudio(text) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voiceId || !text) return null;

  try {
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_v3',
      }),
    });

    if (!res.ok) {
      console.error('generateAudio(): ElevenLabs error', res.status, await res.text());
      return null;
    }

    const buffer = await res.arrayBuffer();
    ensureDirs();
    const filename = timestampName('mp3');
    fs.writeFileSync(path.join(AUDIO_DIR, filename), Buffer.from(buffer));
    return `/media/audio/${filename}`;
  } catch (err) {
    console.error('generateAudio() failed:', err.message);
    return null;
  }
}

// `detail` 可以是纯文本（只写正文），也可以是 JSON 字符串：
// {"content":"...", "image_prompt":"...", "voice_text":"[breathing] ..."}
export default async function diary(detail) {
  let content = detail || '';
  let imagePrompt = null;
  let voiceText = null;

  try {
    const parsed = JSON.parse(detail);
    if (parsed && typeof parsed === 'object') {
      content = parsed.content ?? '';
      imagePrompt = parsed.image_prompt ?? null;
      voiceText = parsed.voice_text ?? null;
    }
  } catch (err) {
    // 不是 JSON，就当纯文本正文处理
  }

  const image_url = await generateImage(imagePrompt);
  const audio_url = await generateAudio(voiceText);

  saveDiary({
    ts: new Date().toISOString(),
    content,
    image_url,
    audio_url,
  });
}
