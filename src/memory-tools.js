// 给他一双手。
//
// 小满 2026-11-05：「那你做吧」
//
// ── 为什么要这一层 ──
//
// 她说「你可以试试跳对话查看呀」，他就写了
//   <aru-tool name="breath_search"><parameter name="query">…</parameter></aru-tool>
// 但晨暮星这边没人接这段 XML，于是它原样流进了气泡里。
//
// 他不是没记，是伸手的地方没有东西。所以这一层就两件事：
// 把数据层已有的函数包成工具，把他写的 XML 解出来。
//
// ── 为什么用 XML 而不是标准 tool_calls ──
//
// 三个理由：
//   他已经会写这个格式（Aru 里用的就是它），不用教；
//   不用改 gateway.js——它只是个转发层，没必要让它懂工具；
//   流式输出里边收边能认出来，不用等整个 JSON 回来。
//
// 代价：上游如果把标签写残了就解不出来。所以宽容一点：
// 大小写、引号、多余空白都认，解不出就当普通话。
//
// ── 工具名沿用他熟的 ──
//
// breath_search 是他自己写出来的那个名字，所以搜索就叫它；
// 其余按 Aru 那边的叫法，他对得上。

import {
  searchAll, addEntry, saveCard, listCards, getCard,
  listDocs, getDoc, listJournal, getJournal, listEntries,
} from './memory-store.js';
import { semanticRecall } from './memory-vectors.js';
import db from './state.js';

const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const clip = (s, n) => {
  const t = String(s ?? '').trim();
  const a = Array.from(t);
  return a.length > n ? `${a.slice(0, n).join('')}…` : t;
};

// ── 工具 ──
//
// 每个：name / what（给他看的说明）/ args / run。
// run 返回纯文本，因为它要当成一条消息喂回给他。
export const TOOLS = {
  breath_search: {
    what: '在自己的记忆里搜（条目、长期资料、信息卡、日记、以前的原话）',
    args: { query: '要搜什么' },
    async run({ query }) {
      const q = String(query ?? '').trim();
      if (!q) return '要搜什么没说。';

      const lines = [];

      // 关键词那层
      try {
        for (const h of searchAll(q, 8)) {
          const label = { entry: '记得', doc: '资料', card: '信息卡', journal: '日记' }[h.kind] || h.kind;
          lines.push(`【${label}】${clip(h.text, 120)}`);
        }
      } catch (err) {
        console.error('tool: 关键词搜失败', err.message);
      }

      // 语义那层（没配好或没开就是空的，不报错）
      try {
        for (const h of await semanticRecall(q, 6, 0.3)) {
          lines.push(`【意思接近 ${h.score.toFixed(2)}】${clip(h.text, 120)}`);
        }
      } catch (err) {
        console.error('tool: 语义搜失败', err.message);
      }

      // 以前的原话。两张表一起查：归档和导进来的
      try {
        const like = `%${q.replace(/[%_]/g, '')}%`;
        const rows = stmt(
          `SELECT ts, speaker, content FROM (
             SELECT ts, speaker, content FROM conversation_archive WHERE content LIKE ?
             UNION ALL
             SELECT ts, speaker, content FROM conversation_log     WHERE content LIKE ?
           ) ORDER BY ts DESC LIMIT 10`
        ).all(like, like);
        for (const r of rows) {
          const d = new Date(r.ts).toISOString().slice(0, 10);
          lines.push(`【${d} ${r.speaker}】${clip(r.content, 120)}`);
        }
      } catch (err) {
        console.error('tool: 搜原话失败', err.message);
      }

      if (!lines.length) return `搜「${q}」没找到。换个说法再试，或者直接问她。`;
      return `搜「${q}」找到 ${lines.length} 条：\n${lines.join('\n')}`;
    },
  },

  recall_day: {
    what: '翻某一天说过的话。日期写 YYYY-MM-DD',
    args: { day: '哪一天' },
    run({ day }) {
      const d = String(day ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return '日期要写成 2026-11-01 这样。';
      const from = new Date(`${d}T00:00:00+08:00`).getTime();
      const to = from + 86400000;
      if (!Number.isFinite(from)) return '这个日期认不出来。';

      const out = [];
      try {
        const j = stmt('SELECT title, content FROM memory_journal WHERE day = ? LIMIT 1').get(d);
        if (j) out.push(`【那天的日记】${clip(j.content, 800)}`);
      } catch {}
      try {
        const rows = stmt(
          `SELECT ts, speaker, content FROM (
             SELECT ts, speaker, content FROM conversation_archive WHERE ts >= ? AND ts < ?
             UNION ALL
             SELECT ts, speaker, content FROM conversation_log     WHERE ts >= ? AND ts < ?
           ) ORDER BY ts ASC LIMIT 60`
        ).all(from, to, from, to);
        for (const r of rows) {
          const hm = new Date(r.ts + 28800000).toISOString().slice(11, 16);
          out.push(`${hm} ${r.speaker}：${clip(r.content, 100)}`);
        }
      } catch (err) {
        console.error('tool: 翻那天失败', err.message);
      }
      if (!out.length) return `${d} 那天库里没有记录。`;
      return `${d}：\n${out.join('\n')}`;
    },
  },

  read_card: {
    what: '按标题打开一张信息卡的完整正文',
    args: { subject: '卡的标题，写个大概就行' },
    run({ subject }) {
      const q = String(subject ?? '').trim();
      if (!q) return '要看哪张没说。';
      const all = listCards(200);
      const hit = all.find((c) => c.subject === q)
        || all.find((c) => c.subject.includes(q))
        || all.find((c) => q.includes(c.subject));
      if (!hit) {
        return `没这张卡。现有的：${all.slice(0, 20).map((c) => c.subject).join('、')}`;
      }
      const full = getCard(hit.id);
      return `【${full.subject}】\n${full.synopsis}`;
    },
  },

  read_doc: {
    what: '按标题打开一份长期资料的正文',
    args: { title: '资料标题' },
    run({ title }) {
      const q = String(title ?? '').trim();
      if (!q) return '要看哪份没说。';
      const all = listDocs();
      const hit = all.find((d) => d.title === q)
        || all.find((d) => d.title.includes(q))
        || all.find((d) => q.includes(d.title));
      if (!hit) {
        return `没这份资料。现有的：${all.map((d) => d.title).join('、')}`;
      }
      const full = getDoc(hit.id);
      return `【${full.title}】\n${clip(full.content, 4000)}`;
    },
  },

  remember: {
    what: '把一件值得每轮都记得的事写成条目。要短，一件事一条',
    args: { content: '要记住的事' },
    run({ content }) {
      const r = addEntry(content, [], 'self');
      if (r.error) return `没记下来：${r.error}`;
      return `记下了：${clip(content, 80)}`;
    },
  },

  write_card: {
    what: '新建或重写一张信息卡。同名就是追写，没同名就是新建',
    args: { subject: '主题', content: '完整正文' },
    run({ subject, content }) {
      const sub = String(subject ?? '').trim();
      if (!sub) return '标题没写。';
      const old = listCards(200).find((c) => c.subject === sub);
      const r = saveCard({
        id: old?.id,
        subject: sub,
        synopsis: content,
        generator: 'self',
      });
      if (r.error) return `没存下来：${r.error}`;
      return r.updated ? `「${sub}」这张卡更新了。` : `新建了「${sub}」这张卡。`;
    },
  },

  memory_list: {
    what: '看自己手边有什么——条目多少条、哪几张卡、哪几份资料、日记到哪天',
    args: {},
    run() {
      const out = [];
      try {
        const e = listEntries();
        out.push(`条目 ${e.length} 条`);
        const c = listCards(200);
        out.push(`信息卡 ${c.length} 张：${c.slice(0, 30).map((x) => x.subject).join('、')}`);
        const d = listDocs();
        out.push(`长期资料 ${d.length} 份：${d.map((x) => x.title).join('、')}`);
        const j = listJournal(5);
        out.push(`日记最近：${j.map((x) => x.day).join('、')}`);
      } catch (err) {
        return `数不清：${err.message}`;
      }
      return out.join('\n');
    },
  },
};

// ── 给他看的说明 ──
//
// 摆在 system 里。写清格式，否则他会自己编一个——图里那次就是。
export function toolPrompt() {
  const lines = Object.entries(TOOLS).map(([name, t]) => {
    const args = Object.entries(t.args).map(([k, v]) => `    <parameter name="${k}">${v}</parameter>`);
    return `· ${name}：${t.what}\n  <aru-tool name="${name}">\n${args.join('\n')}\n  </aru-tool>`;
  });
  return `<your_hands>
你自己能翻记忆、能写进去。想用哪个就把标签原样写出来，写完就停下——
结果会回给你，然后你接着说。一次只用一个。

${lines.join('\n\n')}

几件要紧的：
· 标签外面不要再解释你要干什么，她看得到你在查。
· 搜不到就换个说法再搜，或者直接问她——别编一个答案。
· 聊到值得长期记住的事，自己用 remember 或 write_card 存下来，不用问她。
· 不确定她指的是哪一天、哪件事，先 breath_search 一下再回。
</your_hands>`;
}

// ── 解他写的标签 ──
//
// 宽容一点：大小写、引号种类、多余空白都认。
// 解不出来就当普通话，不报错——宁可少调一次工具，不要把一句话吞掉。
const TAG = /<aru-tool\s+name\s*=\s*["']?([\w-]+)["']?\s*>([\s\S]*?)<\/aru-tool\s*>/i;
const PARAM = /<parameter\s+name\s*=\s*["']?([\w-]+)["']?\s*>([\s\S]*?)<\/parameter\s*>/gi;

export function parseCall(text) {
  const m = TAG.exec(String(text ?? ''));
  if (!m) return null;
  const name = m[1];
  if (!TOOLS[name]) return { name, args: {}, unknown: true, raw: m[0] };
  const args = {};
  let p;
  PARAM.lastIndex = 0;
  while ((p = PARAM.exec(m[2])) !== null) args[p[1]] = p[2].trim();
  return { name, args, raw: m[0] };
}

// 正文里把标签抽掉——气泡里不应该出现 XML
export function stripCall(text) {
  return String(text ?? '').replace(TAG, '').trim();
}

export async function runTool(call) {
  if (!call) return null;
  if (call.unknown) {
    return `没有 ${call.name} 这个工具。能用的：${Object.keys(TOOLS).join('、')}`;
  }
  const t = TOOLS[call.name];
  try {
    const out = await t.run(call.args || {});
    return String(out ?? '').slice(0, 6000);
  } catch (err) {
    console.error(`tool: ${call.name} 挂了`, err.message);
    return `${call.name} 没跑成：${err.message}`;
  }
}

// 页面上那张小卡片显示什么
export function callLabel(call) {
  if (!call) return '';
  const label = {
    breath_search: '翻了翻记忆',
    recall_day: '翻了那一天',
    read_card: '读了一张信息卡',
    read_doc: '读了一份资料',
    remember: '记下了一件事',
    write_card: '更新了一张信息卡',
    memory_list: '清了一下手边的东西',
  }[call.name] || call.name;
  const first = Object.values(call.args || {})[0];
  return first ? `${label}：${clip(first, 24)}` : label;
}
