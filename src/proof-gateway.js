// 网关这一侧的小酒馆：每轮把 Proof 的状态追到输入末尾，并在断片恢复之后把那段
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
// ╔══ 最要紧的一件事：断片是「事后想不起来」，不是「当场耳聂」。
//
// 喝到断片的人，当时话说得清不清楚是另一回事——他听得见、答得上、也记得住
// 当下。只是过后那一段在他脑子里不会留下清楚的录。所以：
//
//   断片进行中（batch 还 open）—— 什么都不摘。只把这段里的消息按指纹记下来。
//   恢复时间到了（过了 restoreAt）—— 才开始把当时那段换成留痕。
//
// 原先写反了：断片期间就摘掉，到点再放回去。结果是他喝醒的那几小时根本
// 没法聊天，过后却记得一清二楚。2026-10-14 小满碰到的就是这个。
//
// 醒酒 != 想起来：Proof 的 _closeFragmentIfNeeded 在浓度落回阁值时只给批次
// 填 end，readable 要等满 restoreAt（默认 60 小时，用
// PROOF_BLACKOUT_RECOVERY_HOURS 调）。所以「他不量了」和「这段变模糊了」
// 是两个时间点，episode 上分开存：closedAt 和 restoreAt。
//
// ╔══ 第二件要紧的事：账本不认识的历史，一条都不登记。
//
// 登记靠的是「这条消息第一次出现在 startedAt 之后」。但账本刚建立、或者被人
// 清空过时，整段历史会在同一轮里被一次性盖上「现在」的章——全部大于
// startedAt，于是整段过去被当成「断片期间发生的」入表。
// （小满的账本里三十多条指纹时间戳一模一样，就是这个。）
//
// 所以改成只看「本轮才第一次见到」，并且一轮里新面孔超过 NEW_PER_TURN_MAX 就
// 说明账本根本不认识这段历史，宁可一条都不登。和 Proof transform.mjs 的
// 「未见过的历史：无法证明在窗口内 → 放行」同一条 fail-open。
//
// 由此也得出一条运维规矩：**清账本时不能清 seen。**
// 老指纹带着老时间戳留着，新断片才能正确地把它们排除在外。要清只清 episodes。
//
// 断片的规矩（小满 2026-10-12 定的，和梦境那套对齐）：
//   留痕——摘掉的那段位置上留一句「这里有一段记不清了」。他知道空了一块，不知道空的是什么。
//   关键词唤醒——之后谁提到那段里的词，就闪回一个画面（一句），不是整段回来。
//
// 账本里只存指纹、时间和几个关键词，不存正文。正文一直在客户端交上来的
// messages 里（小满这边永远看得见），所以留痕和闪回都从当下那条原文里取。
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
// 已经模糊掉的那段留多久。不是「多久后恢复」——过了 restoreAt 就永远模糊了，
// 这个只是账本清理：那么旧的消息早就滴出上下文窗口了，再记着也没用。
const FADED_KEEP_MS = 30 * 86400000;
// 一轮里正常能新增几条面孔：小满说一句、他上一条回复，偶尔多两条工具消息。
// 超过这个数就不是「聊天在往前走」，是「账本第一次看到这段历史」。
const NEW_PER_TURN_MAX = 4;

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
  // 很久以前那些已经模糊掉的段不必再留（只是清账本，不是「想起来了」）
  const cutoff = Date.now() - FADED_KEEP_MS;
  db.episodes = db.episodes.filter((e) => e.open || !e.restoreAt || e.restoreAt > cutoff);
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

// 太常见的字：含这些字的短词不当关键词，不然第二句话就把整段碎出来了
const COMMON = new Set('的了是在我你他她它这那个就都也不很有和跟把被让从到着过吗吧呢啊嘩什么怎么么要能会做说看想知道事情东西时候今天昨天明天现在'.split(''));
const hasCommon = (s) => [...s].some((c) => COMMON.has(c));

// 从一段话里挑几个足够具体的词。没有分词器，所以是启发式的：
//   标点间的短语（二到六字）直接用；长句子切成二、三字片段，并把含常用字的扔掉。
//   挑不准也不要紧：没挑中就是这段没被闪回，留痕还在。
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
//
// 两个阶段，别混：
//   进行中（bo.active 且未过 restoreAt）—— 只登记，不摘。他当时话说得不清楚是
//     状态注入的事（injectState），不是把小满的话删掉。
//   已模糊（过了 restoreAt）—— 才把当时登记的那几条换成留痕 / 闪回。
function applyBlackout(messages, ctx) {
  const bo = readBlackout(ctx);
  const db = load();
  const now = Date.now();

  // 本轮尾部永远放行。和 Proof transform.mjs 的「当前轮消息：本轮放行」同一条规矩——
  // 先经历，之后才记不清。不加这条，小满正在说的话会当轮就消失。
  const tailIndex = messages.length - 1;

  // 登记这一轮看到的每条消息第一次出现的时间，并记下哪几条是本轮才第一次见到的。
  // freshFps 是唯一可信的「这条是新发生的」信号；db.seen 的时间戳本身不是——
  // 账本刚建立时它会把整段历史都标成「现在」。
  const fps = messages.map((m) => fingerprint(m));
  const freshFps = new Set();
  for (const fp of fps) {
    if (db.seen[fp]) continue;
    db.seen[fp] = now;
    freshFps.add(fp);
  }

  let episode = db.episodes.find((e) => e.open);

  if (bo.active) {
    if (!episode) {
      episode = { id: `b${now.toString(36)}`, open: true, startedAt: now, restoreAt: bo.restoreAt || 0, hidden: {} };
      db.episodes.push(episode);
      console.log(
        `proof-gateway: 断片开始${bo.soft ? '（Proof 说软断片，我们这边等恢复时间到了再硬过滤）' : ''}`
        + `${bo.restoreAt ? `，预计 ${new Date(bo.restoreAt).toLocaleString()} 这段就记不清了` : ''}`
      );
    }
    if (bo.restoreAt) episode.restoreAt = bo.restoreAt;

    // 只登记本轮才第一次见到的。而且——这一轮新面孔太多就说明账本根本
    // 不认识这段历史（刚建、被清、或者换了个窗口），那就一条都不登。
    // 宁可漏掉一段真断片，不能把整段过去误判成「断片期间发生的」。
    if (freshFps.size > NEW_PER_TURN_MAX) {
      console.warn(
        `proof-gateway: 这轮有 ${freshFps.size} 条消息是第一次见（账本不认识这段历史），`
        + '一条都不登记。只有往后正常往前走的对话会进这段断片。'
      );
    } else {
      messages.forEach((m, i) => {
        const fp = fps[i];
        if (!freshFps.has(fp)) return;
        if (m.role !== 'user' && m.role !== 'assistant') return;
        if (!episode.hidden[fp]) episode.hidden[fp] = { at: now, keys: keywords(textOf(m.content)), flashed: false };
      });
    }
  } else if (episode) {
    // Proof 说不在断片期了。这条路径只有一种情况：reset——
    // liftBlackouts 把批次全置为可读，那就是「这晚不算」，整段不再模糊。
    // 自然到点走不到这里：Proof 的 blackoutVisibility 在 restoreAt 之前恒为 active，
    // 到点后转为不 active，而我们要的正好是「到点后开始模糊」——所以判定放在下面
    // 按 episode.restoreAt 做，不依赖 bo.active。
    episode.open = false;
    episode.closedAt = now;
    const stillPending = episode.restoreAt > now;
    const n = Object.keys(episode.hidden).length;
    if (stillPending) {
      console.log(`proof-gateway: 断片被解除（reset），${n} 条不再模糊`);
      episode.lifted = true;
    } else {
      console.log(`proof-gateway: 断片结束，${n} 条已经模糊掉了`);
    }
    episode = null;
  }

  // 哪几段已经模糊掉了：过了 restoreAt、没被 reset 解除。
  // 还 open 的那段不在里面——他此刻还在经历它。
  const faded = db.episodes.filter(
    (e) => !e.lifted && e.restoreAt > 0 && now >= e.restoreAt && Object.keys(e.hidden || {}).length
  );

  if (!faded.length) {
    save(db);
    return messages;
  }

  // fp -> 该条属于哪一段已模糊的记录
  const fadedOf = new Map();
  for (const e of faded) {
    for (const [fp, hit] of Object.entries(e.hidden)) {
      if (!fadedOf.has(fp)) fadedOf.set(fp, { episode: e, hit });
    }
  }

  // 最后一条没被摘掉的 user 消息：它里的词用来判该不该闪回
  let probe = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    if (i !== tailIndex && fadedOf.has(fps[i])) continue;
    probe = textOf(messages[i].content);
    break;
  }

  const out = [];
  let markerPlaced = false;
  let dropped = 0;
  let flashed = 0;

  messages.forEach((m, i) => {
    // 本轮尾部永远放行：小满此刻说的话他一定听得见
    if (i === tailIndex) {
      out.push(m);
      return;
    }
    const found = fadedOf.get(fps[i]);
    if (!found) {
      out.push(m);
      return;
    }
    const { hit } = found;
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
      `proof-gateway: 已模糊的段，这轮从模型输入里摘掉 ${dropped} 条${flashed ? `，闪回 ${flashed} 条` : ''}`
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
  const now = Date.now();
  const open = db.episodes.find((e) => e.open);
  if (open) {
    const n = Object.keys(open.hidden).length;
    return `断片：正在经历（还记得住），已登记 ${n} 条`
      + `${open.restoreAt ? `，${new Date(open.restoreAt).toLocaleString()} 之后这段就记不清了` : ''}`;
  }
  const faded = db.episodes.filter((e) => !e.lifted && e.restoreAt > 0 && now >= e.restoreAt);
  if (!faded.length) return '断片：此刻没有';
  const n = faded.reduce((sum, e) => sum + Object.keys(e.hidden || {}).length, 0);
  return `断片：${faded.length} 段已经模糊，共 ${n} 条记不清了`;
}
