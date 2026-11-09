// src/dreams-ombre.js
// 梦在 Ombre 里的两层：做梦那一刻只留一条事件记录（时间戳加一句话）；
// 被想起来之后，再把整段梦写回同一条桶。
// 附加层，任何一步失败只打日志，不拖住做梦，也不拖住「想起来」。

import { callTool, isConnected } from './mcp-manager.js';

const SERVER = 'ombre-brain';

function texts(res) {
  const out = [];
  if (!res) return out;
  if (typeof res === 'string') return [res];
  if (Array.isArray(res.content)) {
    for (const p of res.content) if (p && typeof p.text === 'string') out.push(p.text);
  }
  if (res.structuredContent) { try { out.push(JSON.stringify(res.structuredContent)); } catch (e) {} }
  if (!out.length) { try { out.push(JSON.stringify(res)); } catch (e) {} }
  return out;
}

function bucketIdOf(res) {
  if (!res || typeof res !== 'object') return null;
  if (typeof res.bucket_id === 'string') return res.bucket_id;
  if (res.structuredContent) { const i = bucketIdOf(res.structuredContent); if (i) return i; }
  for (const t of texts(res)) {
    const m = t.match(/bucket_id"?\s*[:=]\s*"?([0-9a-zA-Z_-]+)/);
    if (m) return m[1];
  }
  return null;
}

function contentOf(d, hit, recalledAt) {
  const L = [];
  L.push('【梦】' + (d.title || '没标题的梦'));
  const tone = [d.tone, d.intensity].filter(Boolean).join(' ');
  if (tone) L.push('调子 ' + tone);
  const at = d.createdAt || d.at;
  if (at) L.push('做的时辰 ' + at);
  if (recalledAt) L.push('想起来的时辰 ' + recalledAt);
  if (hit) L.push('被这句勾起来：' + hit);
  if (Array.isArray(d.triggers) && d.triggers.length) L.push('触发词 ' + d.triggers.join('、'));
  const body = d.fragment || d.body || d.text || '';
  if (body) { L.push(''); L.push(body); }
  return L.join('\n').trim();
}

export async function rememberDreamEvent(at) {
  if (!isConnected(SERVER)) return null;
  try {
    const res = await callTool(SERVER, 'hold', {
      content: at + ' 做了一个梦。',
      domain: 'dream',
      tags: '梦',
      importance: 3,
      why_remembered: '知道那一夜有过什么，不知道是什么',
    });
    const id = bucketIdOf(res);
    if (!id) console.error('dream-ombre: 事件写进去了，但没读出 bucket id（这个梦以后改不回去）');
    return id;
  } catch (err) {
    console.error('dream-ombre: 事件记录没写进去', err && err.message);
    return null;
  }
}

export function revealDreamInOmbre(d, hit = '', recalledAt = '') {
  if (!d || !d.ombreId || !isConnected(SERVER)) return;
  try {
    Promise.resolve(callTool(SERVER, 'trace', { bucket_id: d.ombreId, content: contentOf(d, hit, recalledAt) }))
      .then(() => console.log('dream-ombre: 「' + (d.title || '梦') + '」写回记忆库了'))
      .catch((err) => console.error('dream-ombre: 写回记忆库失败（梦本身还在）', err && err.message));
  } catch (err) {
    console.error('dream-ombre: 写回记忆库失败（梦本身还在）', err && err.message);
  }
}
