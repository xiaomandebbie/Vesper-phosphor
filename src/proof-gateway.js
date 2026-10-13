// 网关这一侧的小酒馆：每轮把 Proof 的状态追到输入末尾，并在断片期间真的把那段
// 从模型可见的输入里拿走。
//
// 为什么不开 Proof 自己的 Gateway：
//   它和我们做的是同一件事（挡在客户端和上游之间改写输入）。套两层网关要再改一次
//   base_url、再交一份上游 key。晨暮星本来就有 vesper-gateway，所以做在这边。
//   Proof 那边只跑 HTTP 服务和 MCP，PROOF_GATEWAY_ENABLED 保持关着。
//
// 断片能不能真断，取决于客户端每轮是不是把完整 messages 交上来：
//   交上来了，我们就能把那几条摘掉，模型根本看不到（硬断片）。
//   只交 previous_response_id 这种上游托管历史的，我们删不掉上游已经存的东西。
//   所以不谎：没法硬过滤时只打一行警告，不假装已经断了。
//
// 断片的规矩（小满 2026-10-12 定的，和梦境那套对齐）：
//   留痕——摘掉的那段位置上留一句「这里有一段记不清了」。他知道空了一块，不知道空的是什么。
//   关键词唤醒——之后谁提到那段里的词，就闪回一个画面（一句），不是整段回来。
//   到点恢复——Proof 算出的 restoreAt 到了，这段就放回模型输入里。
//
// 账本里只存指纹、时间和几个关键词，不存正文。正文一直在客户端交上来的
// messages 里（小满这边永远看得见），所以恢复和闪回都从当下那条原文里取。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { turnContext, isProofEnabled } from './proof.js';

const env = (k) => String(process.env[k] ?? '').trim();

const DATA_DIR = env('PROOF_DATA_DIR') || env('VESPER_DATA_DIR') || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'proof-blackout.json');

// 指纹账本最多记多少条。超了从最早的开始扔——轮到那么旧的消息，断片早过去了
const MAX_SEEN = 2000;
// 闪回的那一句最长多少字
const FLASH_CHARS = 40;

const MARKER = '（这里有一段记不清了。）';

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      seen: j.seen && typeof j.seen === 'object' ? j.seen : {},
      episodes: Array.isArray(j.episodes) ? j.episodes : [],
    };
  } catch {
    return { seen: {}, episodes: [] };
  }
}

function save(db) {
  // 账本太长就从最早的开始剪
  const keys = Object.keys(db.seen);
  if (keys.length > MAX_SEEN) {
    keys.sort((a, b) => db.seen[a] - db.seen[b]);
    for (const k of keys.slice(0, keys.length - MAX_SEEN)) delete db.seen[k];
  }
  // 已经恢复完、超过七天的断片段不必再留
  const cutoff = Date.now() - 7 * 86400000;
  db.episodes = db.episodes.filter((e) => e.open || !e.closedAt || e.closedAt > cutoff);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${DB_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(db, null, 1), 'utf8');
    fs.renameSync(tmp, DB_FILE);
  } catch (err) {
    console.error('proof-gateway: 断片账本写不下来', err.message);
  }
}

// OpenAI 格式的 content 有两种写法，数组时只取文字
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
      .map((p) => p.text)
      .join('\n');
  }
  return '';
}

const fingerprint = (m) =>
  crypto.createHash('sha1').update(`${m.role}|${textOf(m.content)}`).digest('hex').slice(0, 16);

// 太常见的字：含这些字的短词不当关键词，不然第二句话就把整段碰出来了
const COMMON = new Set('的了是在我你他她它这那个就都也不很有和跟把被让从到着过吗吧呢啊嘵什么怎么么要能会做说看想知道事情东西时候今天昨天明天现在'.split(''));
const hasCommon = (s) => [...s].some((c) => COMMON.has(c));

// 从一段话里挑几个足够具体的词。没有分词器，所以是启发式的：
//   标点间的短语（二到六字）直接用；长句子切成二、三字片段，并把含常用字的扔掉。
//   挑不准也不要紧：没挑中就是这段没被闪回，到点还是会恢复。
function keywords(text) {
  const out = new Set();
  const s = String(text ?? '');
  for (const run of s.match(/[\u4e00-\u9fa5]{2,}/g) || []) {
    if (run.length <= 6) {
      if (!hasCommon(run)) out.add(run);
      continue;
    }
    for (let n = 3; n >= 2; n--) {
      for (let i = 0; i + n <= run.length; i++) {
        const g = run.slice(i, i + n);
        if (!hasCommon(g)) out.add(g);
      }
    }
  }
  for (const w of s.match(/[A-Za-z][A-Za-z0-9_-]{2,}/g) || []) out.add(w.toLowerCase());
  // 长的在前：越具体的词越值得当触发词
  return [...out].sort((a, b) => b.length - a.length).slice(0, 12);
}

// 闪回的那一句：取第一句，最多 FLASH_CHARS 字
function flashOf(text) {
  const first = String(text ?? '').split(/(?<=[。！？\n])/)[0] || String(text ?? '');
  const chars = [...first.trim()];
  return chars.length > FLASH_CHARS ? `${chars.slice(0, FLASH_CHARS).join('')}…` : chars.join('');
}

// Proof 各版本字段名不完全一样，挨个兜
function readBlackout(ctx) {
  const b = ctx?.blackout || {};
  const active = Boolean(b.active ?? ctx?.blackoutActive);
  const restoreAt = Number(b.restoreAt ?? ctx?.restoreAt ?? 0) || 0;
  return { active, soft: b.soft !== false, restoreAt };
}

// 状态追在最后一条 user 消息末尾。追在末尾是为了尽量别动 system 和前面的历史，
// 上游的前缀缓存还能命中；但状态本身会增加输入 token，以上游 usage 为准。
function injectState(messages, ctx) {
  const text = String(ctx?.context?.text ?? '').trim();
  if (!text) return messages;
  const label = String(ctx?.context?.label ?? '[Proof 状态]');
  const states = Array.isArray(ctx.objectiveStates) ? ctx.objectiveStates.filter(Boolean) : [];
  const block =
    `\n\n${label}\n${text}` +
    (states.length ? `\n客观状态：${states.join('、')}` : '') +
    '\n（这是饮品对你的推动力。让它自然改变你的注意、选择、反应和表达方式，而不是成为回答的主题。）';

  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') {
      const out = [...messages];
      out[i] = { ...m, content: `${m.content}${block}` };
      return out;
    }
    if (Array.isArray(m.content)) {
      const out = [...messages];
      out[i] = { ...m, content: [...m.content, { type: 'text', text: block.trimStart() }] };
      return out;
    }
  }
  // 整串里没有 user 消息（不应该发生），那就往后面接一条
  return [...messages, { role: 'user', content: block.trimStart() }];
}

// 断片过滤。返回改写后的 messages
function applyBlackout(messages, ctx) {
  const bo = readBlackout(ctx);
  const db = load();
  const now = Date.now();

  // 先登记这一轮看到的每条消息第一次出现的时间
  const fps = messages.map((m) => fingerprint(m));
  for (const fp of fps) if (!db.seen[fp]) db.seen[fp] = now;

  let episode = db.episodes.find((e) => e.open);

  if (bo.active) {
    if (!episode) {
      episode = { id: `b${now.toString(36)}`, open: true, startedAt: now, restoreAt: bo.restoreAt || 0, hidden: {} };
      db.episodes.push(episode);
      console.log(`proof-gateway: 断片开始${bo.soft ? '（Proof 说软断片，我们这边照样硬过滤）' : ''}`);
    }
    if (bo.restoreAt) episode.restoreAt = bo.restoreAt;
    // 断片开始之后才第一次出现的消息，就是这段里的
    messages.forEach((m, i) => {
      const fp = fps[i];
      if (db.seen[fp] < episode.startedAt) return;
      if (m.role !== 'user' && m.role !== 'assistant') return;
      if (!episode.hidden[fp]) episode.hidden[fp] = { at: db.seen[fp], keys: keywords(textOf(m.content)), flashed: false };
    });
  } else if (episode) {
    // Proof 说清醒了（到点或者 reset）——这段放回去
    episode.open = false;
    episode.closedAt = now;
    const n = Object.keys(episode.hidden).length;
    console.log(`proof-gateway: 断片结束，${n} 条恢复到模型输入里`);
    episode = null;
  }

  if (!episode || !Object.keys(episode.hidden).length) {
    save(db);
    return messages;
  }

  // 最后一条没被摘掉的 user 消息：它里的词用来判判该不该闪回
  let probe = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    if (episode.hidden[fps[i]]) continue;
    probe = textOf(messages[i].content);
    break;
  }

  const out = [];
  let markerPlaced = false;
  let dropped = 0;
  let flashed = 0;

  messages.forEach((m, i) => {
    const hit = episode.hidden[fps[i]];
    if (!hit) {
      out.push(m);
      return;
    }
    const key = probe ? hit.keys.find((w) => w && probe.includes(w)) : null;
    if (key) {
      // 被词碎到了：闪回一个画面，不是整段回来
      hit.flashed = true;
      flashed++;
      out.push({
        role: m.role,
        content: `（那段记不清的里面有一下浮上来了——刚才那句话里的「${key}」碎到了它：${flashOf(textOf(m.content))}。只有这一下，前后还是空的。）`,
      });
      return;
    }
    dropped++;
    if (!markerPlaced) {
      markerPlaced = true;
      out.push({ role: m.role, content: MARKER });
    }
  });

  save(db);
  if (dropped || flashed) {
    console.log(
      `proof-gateway: 断片中，这轮从模型输入里摘掉 ${dropped} 条${flashed ? `，闪回 ${flashed} 条` : ''}`
    );
  }
  return out;
}

// 网关每轮调这一个。没配小酒馆就原样返回；读不到 Proof 也原样转发，只打一行警告——
// 「读不到状态」不能假装成「现在没喝酒」。
export async function applyProof(messages) {
  if (!isProofEnabled() || !Array.isArray(messages) || !messages.length) return messages;

  let ctx;
  try {
    ctx = await turnContext();
  } catch (err) {
    console.warn('proof-gateway: 读不到 Proof 状态，原样转发：', err.message);
    return messages;
  }
  if (!ctx || ctx.ok === false) {
    console.warn(`proof-gateway: 读不到 Proof 状态，原样转发：${ctx?.detail || ctx?.error || '不知道为什么'}`);
    return messages;
  }

  let out = messages;
  try {
    out = applyBlackout(out, ctx);
  } catch (err) {
    console.error('proof-gateway: 断片过滤出错，这轮不过滤', err.message);
    out = messages;
  }

  // 宿主侧自动投递：只有真有状态且还在生效时才追
  if (ctx.hasState && ctx.active) {
    try {
      out = injectState(out, ctx);
    } catch (err) {
      console.error('proof-gateway: 状态没注入进去', err.message);
    }
  }
  return out;
}

export function blackoutSummary() {
  if (!isProofEnabled()) return '';
  const db = load();
  const open = db.episodes.find((e) => e.open);
  if (!open) return '断片：此刻没有';
  const n = Object.keys(open.hidden).length;
  return `断片：进行中，已摘掉 ${n} 条${open.restoreAt ? `，预计 ${new Date(open.restoreAt).toLocaleString()} 恢复` : ''}`;
}
