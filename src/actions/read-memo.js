// 翻批注本：从点歌台的批注本里随机翻出一首歌，看看当时在那首歌旁边写了什么。
//
// 和 shake_jar 是同一路子：只翻出来看，不写入、不修改批注。
// 但它占一次行动：回头读两个人在歌边上写过的话，本身就是这次醒来做的那件事。
//
// 为什么需要它：她在网页上写批注是不会发通知的（music.py 的 _handle_music_memory_save
// 写完就结束，没有任何推送通道）。所以只能 TA 主动翻 —— 是去读她留下的东西，
// 而不是被提示音追着。
//
// 签名两边分得开：她在网页上写的硬编码是 anko（client/index.html 里 sm-save-btn 那段），
// TA 用 MCP 写的签名自己填。notedBy 记着是谁最后落的笔。
//
// 行为卡片在这里自己写，不走 activity.js 的 describeActivity：
// 那边对未知动作返回 null，正好不会重复记一张。卡片正文只写翻了批注本和歌名，
// 具体写过什么在点开的详情里。

import { addActivityMoment } from '../moments-store.js';
import { musicPlayerBase } from '../music-proxy.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 她在网页上写批注时的硬编码签名，用来分辨是谁落的笔
const HER_SIGNATURE = 'anko';

// 详情里批注正文最多这么长，超过就截
const MAX_NOTE_CHARS = 1200;

function clip(text, n = MAX_NOTE_CHARS) {
  const chars = Array.from(String(text ?? '').trim());
  return chars.length > n ? `${chars.slice(0, n).join('')}…` : chars.join('');
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`;
}

// 批注本读取：GET /music/memory 不带 id 返回全部，形如 { ok, memories: { songId: entry } }。
// 走 MUSIC_PLAYER_URL 直连播放器，带 X-Music-Gateway 头免 token（和 music-proxy.js 一样）。
async function fetchMemories() {
  const base = musicPlayerBase();
  if (!base) return null;
  const gateway = String(process.env.MUSIC_GATEWAY_TOKEN ?? '').trim() || 'music-gateway';
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(`${base}/music/memory`, {
      headers: { 'X-Music-Gateway': gateway },
      signal: ac.signal,
    });
    if (!res.ok) {
      console.error(`read_memo: 批注本没翻开，HTTP ${res.status}`);
      return null;
    }
    const data = await res.json();
    return data?.memories && typeof data.memories === 'object' ? data.memories : {};
  } catch (err) {
    console.error('read_memo: 连不上播放器', err.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 只要真的写过东西的条目：有批注、有听感、或者分享过句子。
// 光有听歌计数的不算 —— 那是听过，不是写过。
function hasWriting(entry) {
  return Boolean(
    String(entry?.notes ?? '').trim()
    || String(entry?.feeling ?? '').trim()
    || (Array.isArray(entry?.favoriteLines) && entry.favoriteLines.length),
  );
}

export default async function readMemo() {
  const memories = await fetchMemories();
  if (!memories) return null;

  const written = Object.values(memories).filter(hasWriting);
  if (!written.length) {
    console.log('read_memo: 批注本还是空的，没人写过东西');
    return null;
  }

  const pick = written[Math.floor(Math.random() * written.length)];
  const title = String(pick.name ?? '').trim() || `song ${pick.songId}`;
  const artist = String(pick.artist ?? '').trim();

  // 卡片正文：翻了批注本，带一个歌名。具体写过什么不摊在表面
  const text = `${AI_NAME}翻了翻批注本，读到「${title}」那一页`;

  // 详情：这首歌、最后是谁落的笔、写了什么、分享过哪几句
const lines = [artist ? `${title} — ${artist}` : title];

  const notedBy = String(pick.notedBy ?? '').trim();
  const notedAt = formatDate(pick.notedAt);
  if (notedBy) {
    const who = notedBy === HER_SIGNATURE ? USER_NAME : notedBy;
    lines.push(`上次落笔：${who}${notedAt ? `，${notedAt}` : ''}`);
  }

  const notes = String(pick.notes ?? '').trim();
  if (notes) lines.push('', clip(notes));

  const feeling = String(pick.feeling ?? '').trim();
  if (feeling) lines.push('', `听感：${clip(feeling, 400)}`);

  const favorites = Array.isArray(pick.favoriteLines)
    ? pick.favoriteLines.filter((l) => String(l ?? '').trim())
    : [];
  if (favorites.length) {
    lines.push('', '分享过的句子：');
    favorites.slice(0, 8).forEach((l) => lines.push(`「${String(l).trim()}」`));
  }

  const tags = Array.isArray(pick.tags) ? pick.tags.filter(Boolean) : [];
  if (tags.length) lines.push('', `标签：${tags.join('、')}`);

  const counts = [];
  if (pick.listenCount > 0) counts.push(`听过 ${pick.listenCount} 次`);
  if (pick.togetherCount > 0) counts.push(`一起听完 ${pick.togetherCount} 次`);
  if (counts.length) lines.push('', counts.join('·'));

  try {
    addActivityMoment(text, lines.join('\n'));
  } catch (err) {
    console.error('read_memo: 记行为卡片失败', err.message);
  }

  console.log(`read_memo: 翻到「${title}」（批注本里有 ${written.length} 首写过东西）`);
  // 批注正文不进返回值：返回值会进 wake_log，她写的话不该漏到那里去
  return { ok: true, songId: pick.songId, title, total: written.length };
}
