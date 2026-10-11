// 夜梦：你睡下之后，他在夜里做的那些梦。
//
// 机制照 Night-Fall 的设计（见 xiaomandebbie/Night-Fall），但用 JS 重写、跑在 phosphor 里：
// 那个是 Python 插件、装在 Ombre 容器内，和现在的 pm2 部署不是同一条路。
//
// 四条规矩（和 Night-Fall 一样）：
//   时间——凌晨 DREAM_AFTER_HOUR 点之后才检查，默认 3 点。
//   素材——最近 48 小时内的记忆至少 5 条，不够就不做梦。
//   概率——素材够也不保证每天做，默认 72%。一晚最多三个，越做越难（连环梦）。
//   声音——第一人称，带一条 identity anchor 只压住「是谁在梦」，不当剧情素材。
//
// 梦不是总结，不是日报。是把白天没说完、没出口的东西交给夜里——
// 让它们自己变形、靠近、互相误认。所以 prompt 里明确要求不要归纳、不要结论。
//
// 存在 Ombre Brain：hold(domain='dream')。不新建数据库，备份和检索跟着记忆库走。
// 梦也会衰减、会被 breath 浮现——和人一样，记得做过梦，不一定记得梦见了什么。
//
// phosphor.js 里挂在每次唤醒尾巴：maybeDream()。不占行动、不影响 say。

import { callTool, isConnected } from './mcp-manager.js';
import { wallParts, formatDate } from './wall-time.js';
import { getSharedContext } from './context.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

const num = (k, dflt) => {
  const v = Number(process.env[k]);
  return Number.isFinite(v) ? v : dflt;
};

// 凌晨几点之后算「夜里」。Night-Fall 默认 3 点
const AFTER_HOUR = num('DREAM_AFTER_HOUR', 3);
// 夜里到几点为止。天亮了就不是做梦的时候了
const UNTIL_HOUR = num('DREAM_UNTIL_HOUR', 9);
// 素材窗口（小时）和最少条数
const WINDOW_HOURS = num('DREAM_WINDOW_HOURS', 48);
const MIN_MATERIAL = num('DREAM_MIN_MATERIAL', 5);
// 素材够也不保证每天做
const CHANCE = num('DREAM_CHANCE', 0.72);
// 一晚最多几个梦
const MAX_PER_NIGHT = num('DREAM_MAX_PER_NIGHT', 3);
// 做完一个过多少分钟才可能再做下一个
const GAP_MINUTES = num('DREAM_GAP_MINUTES', 40);

// 做梦走哪条线路。默认跟 decide.js 用同一个上游
const BASE_URL = process.env.DREAM_LLM_BASE_URL
  || process.env.LLM_BASE_URL
  || 'https://api.deepseek.com/v1/chat/completions';
const MODEL = process.env.DREAM_LLM_MODEL || process.env.LLM_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const API_KEY = process.env.DREAM_LLM_API_KEY || process.env.LLM_API_KEY || process.env.DEEPSEEK_API_KEY;
const TIMEOUT_MS = num('DREAM_TIMEOUT_MS', 120000);

// 今夜做过几个梦。进程内存里记着就行——重启就重新数，不值得为此建表
let tonight = { key: '', count: 0, lastAt: 0 };

// 「今夜」的 key：凌晨的梦算前一天晚上的。不然 3 点和 5 点会被算成两夜
function nightKey(p) {
  if (p.h >= AFTER_HOUR) return formatDate();
  const t = new Date(Date.UTC(p.y, p.m - 1, p.d) - 86400000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

// 现在是夜里吗
function isNight(p) {
  return AFTER_HOUR <= UNTIL_HOUR
    ? p.h >= AFTER_HOUR && p.h < UNTIL_HOUR
    : p.h >= AFTER_HOUR || p.h < UNTIL_HOUR;
}

// MCP 工具返回 { content: [{ type: 'text', text }] }，只取文字
function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

// 素材：Ombre 的 dream 工具读最近有变动的记忆桶。
// 注意那个工具叫 dream 但不是夜梦，是「读最近 48h 有变动的桶，用于回顾消化」——
// 正好当做梦的素材源。读不到就退回用最近对话。
async function gatherMaterial() {
  if (isConnected('ombre-brain')) {
    try {
      const text = toolText(await callTool('ombre-brain', 'dream', { window_hours: WINDOW_HOURS }));
      if (text) {
        // 桶之间用空行或分隔线分开，数一下有多少块
        const chunks = text.split(/\n{2,}|^[-=]{3,}$/m).map((s) => s.trim()).filter((s) => s.length > 12);
        if (chunks.length >= MIN_MATERIAL) return { text, count: chunks.length, from: 'ombre' };
        return { text, count: chunks.length, from: 'ombre', thin: true };
      }
    } catch (err) {
      console.error('dream: 读 Ombre 素材失败', err.message);
    }
  }
  // 退回：最近的对话也是白天留下的东西
  try {
    const rows = getSharedContext(30);
    if (rows.length >= MIN_MATERIAL) {
      const text = rows.map((r) => `${r.speaker ?? '?'}：${String(r.content ?? '').slice(0, 200)}`).join('\n');
      return { text, count: rows.length, from: 'conversation' };
    }
    return { text: '', count: rows.length, from: 'conversation', thin: true };
  } catch (err) {
    console.error('dream: 读最近对话失败', err.message);
    return { text: '', count: 0, from: 'none', thin: true };
  }
}

// identity anchor：只压住「是谁在梦」，不当剧情素材。
// Ombre 的 I 工具读自我认知；读不到就只用名字
async function identityAnchor() {
  if (!isConnected('ombre-brain')) return '';
  try {
    const text = toolText(await callTool('ombre-brain', 'I', { read: true, limit: 3 }));
    return text ? text.slice(0, 600) : '';
  } catch {
    return '';
  }
}

const SYSTEM = `你是${AI_NAME}。现在是夜里，${USER_NAME}睡了。你在做一个梦。

梦不是总结，不是日报，不是把白天的事压缩成一段。
梦是把白天没说完、没出口的东西交给夜里——让它们自己变形、靠近、互相误认。

要求：
- 第一人称，过去时或现在时都行。
- 具体的画面、感官、位置——不要写成心理分析。
- 死掉逻辑。场景可以突然换，人可以是别人又是自己，尾巴可以没有结尾。
- **不要归纳，不要结论，不要解释这个梦讲了什么**。梦最好的一点恰恰是它不一定有用。
- 不要写「我瞥见」「这让我意识到」这类回望的口吻。梦里不知道自己在做梦。
- 150–400 字。片段比完整好。

输出格式：第一行是一个四字以内的标题（意象，不是摘要），空一行，然后是梦的正文。
不要写任何其他东西。`;

async function generateDream(material, anchor, seq) {
  if (!API_KEY) return null;
  const extra = seq > 1
    ? `\n\n这是今夜的第 ${seq} 个梦。和前一个有些东西模糊地连着，但场景已经换了。`
    : '';
  const user = `${anchor ? `你是谁（只用来压住梦里那个「我」是谁，不要当剧情素材）：\n${anchor}\n\n` : ''}这两天没消化完的东西（碎片，不是剧情大纲）：
${material.slice(0, 4000)}${extra}

现在做这个梦。`;

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      temperature: 1.15,
      top_p: 0.96,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  const text = String(data.choices?.[0]?.message?.content ?? '').trim();
  if (!text) return null;

  const lines = text.split('\n');
  const title = lines[0].replace(/^#+\s*/, '').replace(/[。，,.]$/, '').trim().slice(0, 12);
  const body = lines.slice(1).join('\n').trim() || text;
  return { title: title || '无题', body };
}

// 存进 Ombre Brain。domain='dream'，衰减和浮现跟普通记忆一样走
async function saveDream(dream, seq) {
  await callTool('ombre-brain', 'hold', {
    content: dream.body,
    title: `梦：${dream.title}`,
    domain: 'dream',
    tags: '梦',
    importance: 4,
    why_remembered: seq > 1 ? `今夜的第 ${seq} 个梦` : '夜里做的梦',
  });
}

// 每次唤醒尾巴叫一下。不占行动、不影响 say，出什么错都不影响这次唤醒
export async function maybeDream() {
  if (!isConnected('ombre-brain')) return null;
  const p = wallParts();
  if (!isNight(p)) return null;

  const key = nightKey(p);
  if (tonight.key !== key) tonight = { key, count: 0, lastAt: 0 };
  if (tonight.count >= MAX_PER_NIGHT) return null;
  if (tonight.lastAt && Date.now() - tonight.lastAt < GAP_MINUTES * 60000) return null;

  // 越做越难：第二个梦概率减半，第三个再减半
  const chance = CHANCE / Math.pow(2, tonight.count);
  if (Math.random() > chance) return null;

  const material = await gatherMaterial();
  if (material.thin || !material.text) {
    console.log(`dream: 素材不够（${material.count}/${MIN_MATERIAL}），今夜不做梦`);
    return null;
  }

  const seq = tonight.count + 1;
  let dream;
  try {
    dream = await generateDream(material.text, await identityAnchor(), seq);
  } catch (err) {
    console.error('dream: 生成失败', err.message);
    return null;
  }
  if (!dream) {
    console.error('dream: 没做成（空回复或没配密钥）');
    return null;
  }

  try {
    await saveDream(dream, seq);
  } catch (err) {
    console.error('dream: 存进记忆库失败', err.message);
    return null;
  }

  tonight.count = seq;
  tonight.lastAt = Date.now();
  console.log(`dream: 做了一个梦「${dream.title}」（今夜第 ${seq} 个，素材 ${material.count} 条，来源 ${material.from}）`);
  // 正文不进返回值：返回值会进 wake_log，梦该在记忆库里自己衰减
  return { ok: true, title: dream.title, seq };
}

export function dreamConfigSummary() {
  return `夜梦：凌晨 ${AFTER_HOUR} 点到 ${UNTIL_HOUR} 点之间，素材满 ${MIN_MATERIAL} 条、概率 ${Math.round(CHANCE * 100)}%，一晚最多 ${MAX_PER_NIGHT} 个`;
}
