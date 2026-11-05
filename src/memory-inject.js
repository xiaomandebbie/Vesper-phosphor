// 记忆怎么进这一轮。
//
// 小满 2026-11-05：「注入逻辑也一样」「不会的地方可以参考 Polaris」
//
// 所以这一层不是我想的，是按 Polaris 自己讲的那套做的。三条最要紧：
//
// 1. 条目记忆和世界书由用户控制，不计入每轮上限。
//    她自己写进去的东西不应该被算法剪掉——她写就是要带。
//
// 2. 记忆目录、自动召回、最近整理的材料三者合计不超上限（默认 6000），
//    超了先减自动召回——因为目录是「有什么可翻」的全图，缺一块就不知道
//    自己还记得什么；召回少几条只是这一轮想起来的少一点。
//
// 3. 每轮都在变的那部分放在最后一句话之前，不放开头。
//    开头放了，前面所有固定内容的前缀缓存每轮全废——贵且慢。
//
// ── 整个顺序 ──
//
//   世界书：角色定义前
//   指令（系统提示词）
//   世界书：角色定义后
//   条目记忆（每一轮都在）
//   世界书：环境信息之后
//   世界书：对话上方
//   —— 历史消息 ——        ← 按深度插入的落在这里面
//   世界书：对话下方
//   记忆目录 + 自动召回 + 最近日记
//   最新的那句话
//
// ── 召回现在是关键词的 ──
//
// Polaris 说得清楚：只用关键词也能跳对话召回，语义向量是在这之上多一层。
// 所以先把关键词这层做通、现在就能用；向量索引是下一步，
// 接口留在 recall() 里面，到时候换掉那一段就行。

import {
  getSettings,
  getPrompt,
  listEntries as listMemoryEntries,
  listCards,
  listDocs,
  recentJournal,
  searchAll,
} from './memory-store.js';
import { selectEntries, groupByPosition, roughTokens } from './world-books.js';

// 拼一条消息。世界书条目自带 role（system / user / assistant）。
const msg = (role, content) => ({ role, content });

function wbBlock(entries) {
  return entries.map((e) => msg(e.role || 'system', e.content));
}

// ── 条目记忆：每一轮都带，不计预算 ──
function entriesBlock() {
  const rows = listMemoryEntries();
  if (!rows.length) return null;
  const lines = rows.map((r) => `- ${r.content}`).join('\n');
  return msg(
    'system',
    '<memory_entries>\n这几件是你一直记得的事，直接当作你知道的事来用：\n' +
      lines +
      '\n</memory_entries>'
  );
}

// ── 记忆目录：只摆标题 ──
//
// 「把信息卡标题放在协作者手边，聊到相关的人和事时，它会先翻开看一眼再回答」
// ——她手机上那个开关的说明。所以这里只给标题，不给正文。
function directoryText(settings) {
  const parts = [];
  if (settings.maps_information_cards === '1') {
    const cards = listCards(80);
    if (cards.length) {
      parts.push(
        '信息卡（按主题整理的背景，聊到哪一项就把它翻开看）：\n' +
          cards.map((c) => `- ${c.subject}`).join('\n')
      );
    }
  }
  if (settings.maps_long_term_references === '1') {
    const docs = listDocs();
    if (docs.length) {
      parts.push(
        '长期资料（需要的时候再读正文）：\n' + docs.map((d) => `- ${d.title}`).join('\n')
      );
    }
  }
  return parts.length ? parts.join('\n\n') : '';
}

// ── 自动召回 ──
//
// 线索是她最新那句话。命中的信息卡给正文（标题命中就带正文，
// 这是信息卡跟长期资料的区别），其余给摘要。
function recall(query, settings) {
  if (settings.cross_conversation_recall !== '1') return '';
  const q = String(query ?? '').trim();
  if (!q) return '';

  const topK = Math.min(Math.max(1, Number(settings.recall_top_k) || 6), 20);
  let hits = [];
  try {
    hits = searchAll(q, topK);
  } catch (err) {
    console.error('memory: 这轮没召回成', err.message);
    return '';
  }
  if (!hits.length) return '';

  const lines = [];
  for (const h of hits) {
    if (h.kind === 'card') {
      // 信息卡命中：带正文。太长的切一切，剩下的她问起来时自己翻。
      const body = String(h.text ?? '');
      lines.push(`【信息卡】${body}`);
    } else if (h.kind === 'journal') {
      lines.push(`【${h.text} 的日记】这天的记录里有关的内容`);
    } else if (h.kind === 'doc') {
      lines.push(`【资料】${h.text}`);
    } else {
      lines.push(`【记得】${h.text}`);
    }
  }
  return lines.join('\n');
}

// ── 最近几篇日记 ──
function journalText(settings) {
  const n = Math.min(Math.max(0, Number(settings.recent_journal_count) || 0), 10);
  if (!n) return '';
  const rows = recentJournal(n);
  if (!rows.length) return '';
  return rows
    .map((r) => `【${r.day}】\n${String(r.content ?? '').trim()}`)
    .join('\n\n');
}

// 把三块收进预算。超了先减自动召回，再减日记，最后才动目录。
function fitBudget({ directory, recalled, journal }, budget) {
  const cost = (s) => (s ? roughTokens(s) : 0);
  let dir = directory;
  let rec = recalled;
  let jnl = journal;

  const total = () => cost(dir) + cost(rec) + cost(jnl);
  if (total() <= budget) return { dir, rec, jnl, trimmed: [] };

  const trimmed = [];

  // 先剥召回：按行从后往前去
  if (rec) {
    const lines = rec.split('\n');
    while (lines.length && total() > budget) {
      lines.pop();
      rec = lines.join('\n');
    }
    if (!lines.length) {
      rec = '';
      trimmed.push('召回');
    } else if (rec !== recalled) {
      trimmed.push('召回（部分）');
    }
  }

  // 还超就减日记，从最老的那篇开始扣
  if (total() > budget && jnl) {
    const blocks = jnl.split('\n\n');
    while (blocks.length > 1 && total() > budget) {
      blocks.shift();
      jnl = blocks.join('\n\n');
    }
    if (total() > budget) {
      jnl = '';
      trimmed.push('日记');
    } else if (jnl !== journal) {
      trimmed.push('日记（少几篇）');
    }
  }

  // 目录最后才动——它是「自己还记得什么」的全图，缺了最伤
  if (total() > budget && dir) {
    const lines = dir.split('\n');
    while (lines.length && total() > budget) {
      lines.pop();
      dir = lines.join('\n');
    }
    trimmed.push('目录（没列完）');
  }

  return { dir, rec, jnl, trimmed };
}

// 把三块拼成一条消息。摆在最新那句话之前。
function recallMessage(query, settings) {
  const budget = Math.min(Math.max(500, Number(settings.recall_budget) || 6000), 32000);
  const raw = {
    directory: directoryText(settings),
    recalled: recall(query, settings),
    journal: journalText(settings),
  };
  if (!raw.directory && !raw.recalled && !raw.journal) return null;

  const { dir, rec, jnl, trimmed } = fitBudget(raw, budget);
  const parts = [];
  if (dir) parts.push(`<memory_directory>\n${dir}\n</memory_directory>`);
  if (rec) parts.push(`<recalled>\n这几件是你刚刚自然想起来的：\n${rec}\n</recalled>`);
  if (jnl) parts.push(`<recent_days>\n${jnl}\n</recent_days>`);
  if (!parts.length) return null;

  if (trimmed.length) console.log(`memory: 每轮上限 ${budget}，这轮省了 ${trimmed.join('、')}`);
  return msg('system', parts.join('\n\n'));
}

// ── 对外就这一个 ──
//
// history 是 [{role, content}]（不含系统提示词、不含本轮要说的话）。
// text 是本轮要说的话。fallbackSystem 是 memory_prompt 空着时用的底（见 chat-bus.js）。
export function buildMessages({ history = [], text = '', fallbackSystem = '' } = {}) {
  const settings = getSettings();

  // 扫关键词的范围：最近几条 + 本轮这句
  const recentTexts = [...history.map((m) => String(m.content ?? '')), String(text ?? '')];

  let wb = { };
  try {
    wb = groupByPosition(selectEntries(recentTexts));
  } catch (err) {
    console.error('memory: 世界书这轮没生效', err.message);
    wb = {};
  }
  const at = (key) => wbBlock(wb[key] || []);

  const out = [];

  // 1. 角色定义前
  out.push(...at('before_collaborator_prompt'));

  // 2. 指令。没写就用 chat-bus 给的底
  const prompt = String(getPrompt() || '').trim() || String(fallbackSystem || '').trim();
  if (prompt) out.push(msg('system', prompt));

  // 3. 角色定义后
  out.push(...at('after_collaborator_prompt'));

  // 4. 条目记忆
  const entries = entriesBlock();
  if (entries) out.push(entries);

  // 5. 环境信息之后
  out.push(...at('environment_top'));

  // 6. 对话上方
  out.push(...at('chat_top'));

  // 7. 历史。按深度插入的落在里面
  const body = [...history];
  for (const e of wb.at_depth || []) {
    const d = Math.max(0, Number(e.inject_depth) || 0);
    const at_i = Math.max(0, body.length - d);
    body.splice(at_i, 0, msg(e.role || 'system', e.content));
  }
  out.push(...body);

  // 8. 对话下方
  out.push(...at('chat_bottom'));

  // 9. 每轮在变的那块——摆在最后一句话前面，前面那些还能吃到缓存
  const rc = recallMessage(text, settings);
  if (rc) out.push(rc);

  // 10. 本轮要说的话
  out.push(msg('user', String(text ?? '').trim()));

  return out;
}

// 谁被带进来了。页面上要显示「这一轮带了什么」时用。
export function explain({ history = [], text = '' } = {}) {
  const settings = getSettings();
  const recentTexts = [...history.map((m) => String(m.content ?? '')), String(text ?? '')];
  let picked = [];
  try {
    picked = selectEntries(recentTexts);
  } catch {
    picked = [];
  }
  return {
    worldBook: picked.map((e) => ({
      book: e.book.title,
      title: e.title || '（没标题）',
      why: e.why,
      position: e.position,
      tokens: roughTokens(e.content),
    })),
    entryCount: listMemoryEntries().length,
    budget: Number(settings.recall_budget) || 6000,
  };
}
