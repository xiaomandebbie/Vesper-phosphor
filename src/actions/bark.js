// 返回 { ok, message }，phosphor 据此判断推送有没有真的发出去，
// 发出去了才写进共享时间线（见 timeline.js）。
export default async function bark(detail) {
  const key = process.env.BARK_KEY;
  if (!key) {
    console.warn('bark(): BARK_KEY not set, skipping push');
    return { ok: false, reason: 'BARK_KEY not set' };
  }
  const message = detail || '嗨，我醒了';
  const url = `https://api.day.app/${key}/${encodeURIComponent(message)}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) {
      console.error('bark(): push failed', res.status);
      return { ok: false, reason: `HTTP ${res.status}` };
    }
    return { ok: true, message };
  } catch (err) {
    console.error('bark(): push failed', err.message);
    return { ok: false, reason: err.message };
  }
}
