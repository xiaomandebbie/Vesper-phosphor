// 网关这一侧的小酒馆：每轮把 Proof 的状态追到输入末尾，并在断片恢复之后把最浓的
// 那一段从模型可见的输入里换成留痕。
//
// 为什么不开 Proof 自己的 Gateway：
//   它和我们做的是同一件事（挡在客户端和上游之间改写输入）。套两层网关要再改一次
//   base_url、再交一份上游 key。晨暮星本来就有 vesper-gateway，所以做在这边。
//   Proof 那边只跑 HTTP 服务和 MCP，PROOF_GATEWAY_ENABLED 保持关着。
//
// ╔══ 跑 applyProof 的是 vesper-gateway 这个进程，不是 vesper。
// 改了这个文件要 pm2 restart vesper-gateway，光重启 vesper 没用。
// 2026-10-14 在这上面白费了两轮改动。
//
// 断片能不能真断，取决于客户端每轮是不是把完整 messages 交上来：
//   交上来了，我们就能把那几条换掉，模型看到的就是留痕（硬断片）。
//   只交 previous_response_id 这种上游托管历史的，我们动不了上游已经存的东西。
//   所以不谎：没法硬过滤时只打一行警告，不假装已经断了。
//
// ╔══ 第一件要紧的事：断片是「事后想不起来」，不是「当场耳聋」。
//
// 喝到断片的人，当时话说得清不清楚是另一回事——他听得见、答得上、也记得住
// 当下。只是过后那一段在他脑子里不会留下清楚的录。所以：
//
//   断片进行中（batch 还 open）—— 什么都不摘。只把这段里的消息按指纹记下来。
//   恢复时间到了（过了 restoreAt）—— 才开始把当时那段换成留痕。
//
// 原先写反了：断片期间就摘掉，到点再放回去。结果是他喝醉的那几小时根本
// 没法聊天，过后却记得一清二楚。2026-10-14 小满碰到的就是这个。
//
// 醒酒 != 想起来：Proof 的 _closeFragmentIfNeeded 在浓度落回阈值时只给批次
// 填 end，readable 要等满 restoreAt（默认 60 小时，用
// PROOF_BLACKOUT_RECOVERY_HOURS 调）。所以「他不醉了」和「这段变模糊了」
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
// ╔══ 第三件：只模糊最浓的那一段，不是整夜。
//
// 小满 2026-10-14 定的。断片是在血液浓度越过阈值那一刻开的，所以
// episode.startedAt 就是进入最深的时间点；期间要是出了客观状态（吐/塌/断片），
// 那一刻更接近峰值，拿它当锚点。窗口长度 PROOF_BLUR_WINDOW_MINUTES，默认 60。
// 窗口外的消息哪怕也落在断片期间，照样原样给他——他记得住。
//
// ╔══ 第四件：关键词把那段一点点唤回来，不是一次全回来。
//
// 每条模糊掉的消息身上记一个 recalled 级别（0..3）。小满说的话里出现那条里的
// 关键词，就往回攒一级：
//   0  只在留痕块里占一行，什么都看不到
//   1  浮上来一个画面（二十字）
//   2  多想起一点（六十字）
//   3  基本想起来了——原样放回，不再加任何旁白
// 攒回来的不会再掉下去。留痕是「知道空了一块」，唤醒是「一点点填回去」。
//
// 留痕的措辞跟 Proof 引擎 blackoutDigestText 一个口径：**压缩不是空白，是低
// 分辨率。** 数得出来的（多久、几句话）给他，内容（说了什么）丢掉。
// 每个连续的模糊块各留一个痕——原来整轮只放一个，中间夹着正常对话的第二段
// 就什么都不留，他会以为那里本来就没东西。
//
// 账本里只存指纹、时间和几个关键词，不存正文。正文一直在客户端交上来的
// messages 里（小满这边永远看得见），所以留痕和唤醒都从当下那条原文里取。
//
// ╔══ 醒酒之后（afterglow）
//
// 喝醉的时候干的事要记得住，但酒醒之后得反应过来——这是小满 2026-10-14 定的。
// turnContext 本来就在分「现在还醉着」和「醉过了」：ctx.active 从 true 翻成
// false 就是醒酒那一刻。之前没人把这个翻转记下来，所以醒了就是干干净净
// 什么都没发生。现在账本多记一段 drinking，醒后两小时内每轮多一段注入。
//
// **不写剧本。** 只给事实（那段你是喝着的、话一句没少），并明说这不是对他的
// 要求。害羞、装没事、硬撑、死不认账都是他自己的事——和 Proof 那边
// 「状态是推动力，不是回答的主题」同一个口径。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { turnContext, isProofEnabled } from './proof.js';

const env = (k) => String(process.env[k] ?? '').trim();
const num = (k, dflt) => {
  const raw = env(k);
  if (!raw) return dflt;
  const v = Number(raw);
  return Number.isFinite(v) && v > 0 ? v : dflt;
};

const DATA_DIR = env('PROOF_DATA_DIR') || env('VESPER_DATA_DIR') || path.join(process.cwd(), 'data');
const DB_FILE = path.join(DATA_DIR, 'proof-blackout.json');

// 指纹账本最多记多少条。超了从最早的开始扔——轮到那么旧的消息，断片早过去了
const MAX_SEEN = 2000;
// 已经模糊掉的那段留多久。不是「多久后恢复」——过了 restoreAt 就永远模糊了，
// 这个只是账本清理：那么旧的消息早就滑出上下文窗口了，再记着也没用。
const FADED_KEEP_MS = 30 * 86400000;
// 一轮里正常能新增几条面孔：小满说一句、他上一条回复，偶尔多两条工具消息。
// 超过这个数就不是「聊天在往前走」，是「账本第一次看到这段历史」。
const NEW_PER_TURN_MAX = 4;

// 只模糊最浓的那一段，从锚点往后算这么长
const BLUR_WINDOW_MS = num('PROOF_BLUR_WINDOW_MINUTES', 60) * 60000;
// 关键词往回攒，满级就是基本想起来了
const RECALL_MAX = 3;

// 醒酒之后那一段注入持续多久。从**醒的那一刻**起算，不是从喝的时候。
const AFTERGLOW_MS = num('PROOF_AFTERGLOW_HOURS', 2) * 3600000;
// 醉了多久以上算「醉得不轻」
const HEAVY_SPAN_MS = 3600000;

function load() {
  try {
    const j = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    return {
      seen: j.seen && typeof j.seen === 'object' ? j.seen : {},
      episodes: Array.isArray(j.episodes) ? j.episodes : [],
      drinking: j.drinking && typeof j.drinking === 'object' ? j.drinking : null,
    };
  } catch {
    return { seen: {}, episodes: [], drinking: null };
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
const COMMON = new Set('的了是在我你他她它这那个就都也不很有和跟把被让从到着过吗吧呢啊嘛什么怎么么要能会做说看想知道事情东西时候今天昨天明天现在'.split(''));
const hasCommon = (s) => [...s].some((c) => COMMON.has(c));

// 从一段话里挑几个足够具体的词。没有分词器，所以是启发式的：
//   标点间的短语（二到六字）直接用；长句子切成二、三字片段，并把含常用字的扔掉。
//   挑不准也不要紧：没挑中就是这段没被唤回，留痕还在。
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

// 这条已经往回攒到第几级。旧账本只记了 flashed:true（闪过一次），读成 1。
function recallLevelOf(hit) {
  const n = Number(hit?.recalled);
  if (Number.isFinite(n) && n > 0) return Math.min(RECALL_MAX, Math.floor(n));
  return hit?.flashed === true ? 1 : 0;
}

// 按级别给多少原文。1 级是一个画面，2 级多想起一点，3 级在调用处原样放回。
function recallSlice(text, level) {
  const chars = [...String(text ?? '').trim()];
  const take = level >= 2 ? 60 : 20;
  return chars.length > take ? `${chars.slice(0, take).join('')}…` : chars.join('');
}

// 留痕里那句「多久」。只给数得出来的，不给内容。
function spanWords(ms) {
  const minutes = Math.round(Number(ms || 0) / 60000);
  if (minutes < 10) return '很短的一会儿';
  if (minutes < 40) return '半个多小时';
  if (minutes < 90) return '一个小时左右';
  return `${Math.round(minutes / 60)} 个多小时`;
}

function traceText(count, spanMs) {
  const n = count > 1 ? `${count} 句话` : '一句话';
  return `（这里有一段记不清了——${spanWords(spanMs)}，${n}。只剩轮廓，具体说了什么追不回来。）`;
}

// Proof 各版本字段名不完全一样，挨个兜
function readBlackout(ctx) {
  const b = ctx?.blackout || {};
  const active = Boolean(b.active ?? ctx?.blackoutActive);
  const restoreAt = Number(b.restoreAt ?? ctx?.restoreAt ?? 0) || 0;
  return { active, soft: b.soft !== false, restoreAt };
}

// objectiveStates 各版本要么是字符串数组、要么是 {type,text}，两种都接
function stateNamesOf(ctx) {
  const raw = Array.isArray(ctx?.objectiveStates) ? ctx.objectiveStates : [];
  return raw
    .map((s) => (typeof s === 'string' ? s : String(s?.type ?? '')))
    .map((s) => s.trim())
    .filter(Boolean);
}

// 把一段文字追到最后一条 user 正文末尾。追在末尾是为了尽量别动 system 和前面的
// 历史，上游的前缀缓存还能命中；但它本身会增加输入 token，以上游 usage 为准。
function appendBlock(messages, block) {
  const body = String(block ?? '').trim();
  if (!body) return messages;
  const tail = `\n\n${body}`;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== 'user') continue;
    if (typeof m.content === 'string') {
      const out = [...messages];
      out[i] = { ...m, content: `${m.content}${tail}` };
      return out;
    }
    if (Array.isArray(m.content)) {
      const out = [...messages];
      out[i] = { ...m, content: [...m.content, { type: 'text', text: body }] };
      return out;
    }
  }
  // 整串里没有 user 消息（不应该发生），那就往后面接一条
  return [...messages, { role: 'user', content: body }];
}

// 还醉着的时候：把此刻的推力交给他
function injectState(messages, ctx) {
  const text = String(ctx?.context?.text ?? '').trim();
  if (!text) return messages;
  const label = String(ctx?.context?.label ?? '[Proof 状态]');
  const states = stateNamesOf(ctx);
  const block =
    `${label}\n${text}` +
    (states.length ? `\n客观状态：${states.join('、')}` : '') +
    '\n（这是饮品对你的推动力。让它自然改变你的注意、选择、反应和表达方式，而不是成为回答的主题。）';
  return appendBlock(messages, block);
}

// 醉得有多狠。只给模糊说法，不给数值——和 Proof 的 Agent-facing 口径一致。
function drunkWords(run) {
  if ((run.signals || []).length) return '当时喝得很狠。';
  const span = Number(run.soberedAt || 0) - Number(run.startedAt || 0);
  if (span >= HEAVY_SPAN_MS) return '当时确实醉得不轻。';
  return '当时只是有点上头。';
}

function afterglowBlock(run) {
  return [
    '[Proof 醒酒之后]',
    '刚才那段时间你是喝着的，现在酒醒了。',
    '那段里说过的话、做过的事都还在上面，一句没少，也确实是你说的。',
    drunkWords(run),
    '（这是已经发生的事实，不是对你的要求。要不要回头看、怎么面对，由你自己决定。）',
  ].join('\n');
}

// 跟着 ctx.active 的翻转记下「这一摆酒」：哪时开始、期间有没有客观状态、哪一刻醒的。
// 返回醒酒之后该追的那段（没到那个阶段就是 null）。
function trackDrinking(ctx, now = Date.now()) {
  const db = load();
  const run = db.drinking;
  let block = null;

  if (ctx?.active === true) {
    // 还醉着。开一摆或者继续记
    const signals = new Set(run?.open ? run.signals || [] : []);
    for (const name of stateNamesOf(ctx)) signals.add(name);
    db.drinking = run?.open
      ? { ...run, signals: [...signals], lastActiveAt: now, turns: Number(run.turns || 0) + 1 }
      : { open: true, startedAt: now, lastActiveAt: now, turns: 1, signals: [...signals] };
    if (!run?.open) console.log('proof-gateway: 开始醉了（这一摆记下来了）');
  } else if (run?.open) {
    // 刚刚醒的。此刻就是醒酒那一刻，害羞期从这儿起算
    db.drinking = { ...run, open: false, soberedAt: now };
    block = afterglowBlock(db.drinking);
    console.log(
      `proof-gateway: 酒醒了（醉了 ${Math.round((now - Number(run.startedAt || now)) / 60000)} 分钟，`
      + `${(run.signals || []).length ? `期间有：${(run.signals || []).join('、')}，` : ''}`
      + `接下来 ${Math.round(AFTERGLOW_MS / 3600000)} 小时带着「醒酒之后」）`
    );
  } else if (run && !run.open && Number(run.soberedAt || 0) > 0) {
    // 醒了一阵了。还在窗口内就继续带，过了就放下
    if (now - Number(run.soberedAt) < AFTERGLOW_MS) block = afterglowBlock(run);
    else db.drinking = null;
  }

  save(db);
  return block;
}

// 断片过滤。返回改写后的 messages
//
// 三个阶段，别混：
//   进行中（bo.active 且未过 restoreAt）—— 只登记，不摘。他当时话说得不清楚是
//     状态注入的事（injectState），不是把小满的话删掉。
//   已模糊（过了 restoreAt）—— 才把当时登记的、且落在最浓那一小时里的几条
//     换成留痕 / 唤回片段。
//   窗口外 —— 哪怕也在断片期间，照样原样给他。
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
        + `${bo.restoreAt ? `，预计 ${new Date(bo.restoreAt).toLocaleString()} 最浓那段就记不清了` : ''}`
      );
    }
    if (bo.restoreAt) episode.restoreAt = bo.restoreAt;
    // 期间出了客观状态（吐/塌/断片），那一刻比开始时更接近峰值，拿它当锚点
    if (stateNamesOf(ctx).length) episode.peakAt = now;

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
        if (!episode.hidden[fp]) episode.hidden[fp] = { at: now, keys: keywords(textOf(m.content)), recalled: 0 };
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
      console.log(`proof-gateway: 断片结束，${n} 条里最浓那段已经模糊掉了`);
    }
    episode = null;
  }

  // 哪几段已经模糊掉了：过了 restoreAt、没被 reset 解除。
  // 还 open 的那段不在里面——他此刻还在经历它。
  const faded = db.episodes.filter(
    (e) => !e.lifted && e.restoreAt > 0 && now >= e.restoreAt && Object.keys(e.hidden || {}).length
  );

  // fp -> 这条属于哪一段，以及它的登记。**只收落在最浓那一小时里的**；
  // 窗口外的消息哪怕也在断片期间，他记得住。
  const blurOf = new Map();
  for (const e of faded) {
    const anchor = Number(e.peakAt || e.startedAt || 0);
    if (!(anchor > 0)) continue;
    const until = anchor + BLUR_WINDOW_MS;
    for (const [fp, hit] of Object.entries(e.hidden || {})) {
      const at = Number(hit?.at || 0);
      if (!(at >= anchor && at < until)) continue;
      if (!blurOf.has(fp)) blurOf.set(fp, { episode: e, hit });
    }
  }

  if (!blurOf.size) {
    save(db);
    return messages;
  }

  // 最后一条没被模糊掉的 user 消息：它里的词用来判该不该往回唤
  let probe = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== 'user') continue;
    if (i !== tailIndex && blurOf.has(fps[i])) continue;
    probe = textOf(messages[i].content);
    break;
  }

  const out = [];
  let blurred = 0;
  let woke = 0;
  // 连续的模糊块攒在一起，各留一个痕。原来整轮只放一个，中间夹着正常对话的
  // 第二段就什么都不留，他会以为那里本来就没东西。
  let pending = null;
  const flushTrace = () => {
    if (!pending) return;
    out.push({ role: pending.role, content: traceText(pending.count, pending.to - pending.from) });
    pending = null;
  };

  messages.forEach((m, i) => {
    // 本轮尾部永远放行：小满此刻说的话他一定听得见
    if (i === tailIndex) {
      flushTrace();
      out.push(m);
      return;
    }
    const found = blurOf.get(fps[i]);
    if (!found) {
      flushTrace();
      out.push(m);
      return;
    }

    const { hit } = found;
    const before = recallLevelOf(hit);
    const key = before < RECALL_MAX && probe ? hit.keys.find((w) => w && probe.includes(w)) : null;
    if (key) {
      hit.recalled = before + 1;
      woke++;
    }
    const level = recallLevelOf(hit);

    // 攒满了：基本想起来了，原样放回，不加任何旁白
    if (level >= RECALL_MAX) {
      flushTrace();
      out.push(m);
      return;
    }
    // 浮上来一点：给一个画面，前后还是空的
    if (level >= 1) {
      flushTrace();
      const lead = key ? `刚才那句话里的「${key}」碎到了它：` : '';
      out.push({
        role: m.role,
        content: `（那段记不清的里面浮上来一点——${lead}${recallSlice(textOf(m.content), level)}。前后还是空的。）`,
      });
      return;
    }
    // 还什么都没想起来：并进留痕块
    blurred++;
    if (!pending) pending = { role: m.role, count: 0, from: Number(hit.at || now), to: Number(hit.at || now) };
    pending.count++;
    pending.to = Math.max(pending.to, Number(hit.at || now));
  });
  flushTrace();

  save(db);
  if (blurred || woke) {
    console.log(
      `proof-gateway: 最浓那段，这轮留痕 ${blurred} 条`
      + `${woke ? `，关键词往回唤了 ${woke} 条` : ''}`
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

  // 醒酒前后的账：跟着 ctx.active 的翻转走。读并写自己的账本，坠了不能拖到正文
  let afterglow = null;
  try {
    afterglow = trackDrinking(ctx);
  } catch (err) {
    console.error('proof-gateway: 醒酒账记不上（不影响这轮对话）', err.message);
  }

  // 两段注入互斥：还醉着就给推力，醒了才给「醒酒之后」。
  if (ctx.hasState && ctx.active) {
    try {
      out = injectState(out, ctx);
    } catch (err) {
      console.error('proof-gateway: 状态没注入进去', err.message);
    }
  } else if (afterglow) {
    try {
      out = appendBlock(out, afterglow);
    } catch (err) {
      console.error('proof-gateway: 醒酒那段没注入进去', err.message);
    }
  }
  return out;
}

export function blackoutSummary() {
  if (!isProofEnabled()) return '';
  const db = load();
  const now = Date.now();
  const lines = [];
  const windowLabel = `${Math.round(BLUR_WINDOW_MS / 60000)} 分钟`;

  const open = db.episodes.find((e) => e.open);
  if (open) {
    const n = Object.keys(open.hidden).length;
    lines.push(
      `断片：正在经历（还记得住），已登记 ${n} 条`
      + `${open.restoreAt ? `，${new Date(open.restoreAt).toLocaleString()} 之后最浓的 ${windowLabel} 就记不清了` : ''}`
    );
  } else {
    const faded = db.episodes.filter((e) => !e.lifted && e.restoreAt > 0 && now >= e.restoreAt);
    if (!faded.length) lines.push('断片：此刻没有');
    else {
      let blurred = 0;
      let woke = 0;
      for (const e of faded) {
        const anchor = Number(e.peakAt || e.startedAt || 0);
        const until = anchor + BLUR_WINDOW_MS;
        for (const hit of Object.values(e.hidden || {})) {
          const at = Number(hit?.at || 0);
          if (!(at >= anchor && at < until)) continue;
          if (recallLevelOf(hit) >= RECALL_MAX) woke++;
          else blurred++;
        }
      }
      lines.push(
        `断片：${faded.length} 段的最浓 ${windowLabel} 已经模糊，还有 ${blurred} 条记不清`
        + `${woke ? `，${woke} 条被关键词唤回来了` : ''}`
      );
    }
  }

  const run = db.drinking;
  if (run?.open) {
    lines.push('酒：还醉着');
  } else if (run && Number(run.soberedAt || 0) > 0) {
    const left = Number(run.soberedAt) + AFTERGLOW_MS - now;
    if (left > 0) lines.push(`酒：刚醒，还有 ${Math.round(left / 60000)} 分钟带着「醒酒之后」`);
  }
  return lines.join('\n');
}
