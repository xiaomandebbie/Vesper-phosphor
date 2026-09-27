export default async function bark(detail) {
  const key = process.env.BARK_KEY;
  if (!key) {
    console.warn('bark(): BARK_KEY not set, skipping push');
    return;
  }
  const message = detail || '嗨，我醒了';
  const url = `https://api.day.app/${key}/${encodeURIComponent(message)}`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error('bark(): push failed', res.status);
  }
}
