// 只导入允朔的聊天记录。
//
// 小满 2026-11-05：「我还想导入允朔的之前的聊天记录，但是不要其他两个协作者的」
//
// ── 为什么必须分两步 ──
//
// 我把备份拆开读过了：messages.jsonl 里 **没有** collaboratorId，
// 只有 conversationId。协作者 id 在 conversations.jsonl 里。
//
// 所以顺序是死的：
//   1. 先传 conversations——记下每个对话属于谁
//   2. 再传 messages——按那张表判归属，不是允朔的直接丢
//
// 反过来做就全部丢光。前端那边也按这个顺序排。
//
// 允朔是 851F7E63-A594-4B53-9E1F-932ABCA24A24（备份里读到的）。
// 但不写死：导入时她在页面上选，所以这边按传上来的 keep 判。
//
// ── 导进哪里 ──
//
// conversation_archive——state.js 里那张「平时不读，翻旧账时才查」的表。
// 两万多条旧话不该进 conversation_log：那张表是「最近说的话」，
// 网关每轮追写、phosphor 拿它算密度，災进两万条历史就全乱了。
//
// 归档表里的话照样能被召回：context.js 的跳天锚点查 log + archive，
// 搜旧账也查它。
//
// ── 幂等 ──
//
// 归档表没有唯一约束，所以自己建一张 imported_messages 记已经进过的
// 消息 id。导两次不会双份，断了接着跑也安全。

import express from 'express';
import db from './state.js';

// 对话→协作者。只在导入时用，存着是为了下次增量导还认得出。
db.exec(`
CREATE TABLE IF NOT EXISTS imported_conversations (
  id TEXT PRIMARY KEY,
  collaborator_id TEXT,
  title TEXT,
  created_at INTEGER
);

CREATE TABLE IF NOT EXISTS imported_chat (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  speaker TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ic_conv ON imported_chat (conversation_id, ts);

CREATE TABLE IF NOT EXISTS imported_messages (
  id TEXT PRIMARY KEY,
  imported_at INTEGER NOT NULL
);
`);

const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const s = (v) => String(v ?? '').trim();
const ts = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : 0);

const USER_NAME = process.env.USER_DISPLAY_NAME || 'user';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'assistant';

// ── 第一步：对话属于谁 ──

function putConversations(rows) {
  const st = stmt(
    'INSERT OR REPLACE INTO imported_conversations (id, collaborator_id, title, created_at)' +
      ' VALUES (?, ?, ?, ?)'
  );
  let n = 0;
  for (const o of rows) {
    const p = o?.payload;
    if (!p) continue;
    const id = s(o.id || p.id);
    if (!id) continue;
    st.run(id, s(p.collaboratorId), s(p.title), ts(p.createdAt));
    n++;
  }
  return n;
}

// 协作者名单：页面上要让她选哪一位。
// 顺带数每位有多少个对话，不用猜哪个 id 是允朔。
export function collaboratorList() {
  try {
    return stmt(
      'SELECT collaborator_id AS id, COUNT(*) AS conversations,' +
        ' MIN(created_at) AS first_at, MAX(created_at) AS last_at' +
        ' FROM imported_conversations WHERE collaborator_id != \'\'' +
        ' GROUP BY collaborator_id ORDER BY conversations DESC'
    ).all();
  } catch {
    return [];
  }
}

// ── 第二步：消息 ──
//
// keep 是要留的协作者 id。没传就什么都不写——
// 宁可导不进来，也不要把三个人的话搀成一锅。
function putMessages(rows, keep) {
  if (!keep) return { n: 0, skipped: rows.length, reason: '没说要哪一位' };

  const owner = stmt('SELECT collaborator_id FROM imported_conversations WHERE id = ?');
  const seen = stmt('SELECT 1 AS yes FROM imported_messages WHERE id = ?');
  const mark = stmt('INSERT OR REPLACE INTO imported_messages (id, imported_at) VALUES (?, ?)');
  // 四列：archived_at 是 NOT NULL（state.js:65）。
  // ts 是当时说这句话的时间，archived_at 是搬进来的时间，两回事。
  // 多写一份带对话编号的：归档表没有那一列，没它就没法按窗分组。
  const putIC = stmt(
    'INSERT OR REPLACE INTO imported_chat (id, conversation_id, ts, speaker, content)'
      + ' VALUES (?, ?, ?, ?, ?)'
  );
  const put = stmt(
    'INSERT INTO conversation_archive (ts, speaker, content, archived_at) VALUES (?, ?, ?, ?)'
  );

  const now = Date.now();
  let n = 0;
  let skipped = 0;
  let dup = 0;

  for (const o of rows) {
    const p = o?.payload;
    if (!p) continue;
    const id = s(o.id || p.id);
    const content = s(p.content);
    const role = s(p.role);
    const when = ts(p.createdAt);
    if (!id || !content || !when) continue;
    // 工具轮和系统消息不要：那不是他们说的话
    if (role !== 'user' && role !== 'assistant') continue;

    const cid = s(p.conversationId);
    const who = cid ? s(owner.get(cid)?.collaborator_id) : '';
    if (who !== keep) {
      skipped++;
      continue;
    }

    // 这一句在 seen 检查之前：第一版已经进了归档的那两万条，
    // 重跑时归档要跳过，但这张表得补上。
    putIC.run(id, cid, when, role === 'user' ? USER_NAME : AI_NAME, content);

    if (seen.get(id)) {
      dup++;
      continue;
    }

    put.run(when, role === 'user' ? USER_NAME : AI_NAME, content, now);
    mark.run(id, now);
    n++;
  }

  return { n, skipped, dup };
}

export function archiveCount() {
  try {
    return stmt('SELECT COUNT(*) AS c FROM conversation_archive').get().c;
  } catch {
    return 0;
  }
}

// 删掉导进来的那些。只删自己导的：按 imported_messages 里的时间戳认不准，
// 所以这儿干脉一点——清标记表，归档表留着。要真清得自己上服务器。
// （删关系里的原话不应该藏在一个网页按钮后面。）
export function forgetImportMarks() {
  try {
    stmt('DELETE FROM imported_messages').run();
    return { ok: true };
  } catch (err) {
    return { error: err.message };
  }
}

export function registerChatImportRoutes(app, { requireBasicAuth }) {
  const bigJson = express.json({ limit: '2mb' });

  app.post('/memories/manage/import/chat', requireBasicAuth, bigJson, (req, res) => {
    const step = s(req.body?.step);
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) return res.status(400).json({ error: 'rows 不是数组' });

    try {
      if (step === 'conversations') {
        const n = db.transaction(() => putConversations(rows))();
        return res.json({ ok: true, n });
      }
      if (step === 'messages') {
        const keep = s(req.body?.keep);
        const r = db.transaction(() => putMessages(rows, keep))();
        return res.json({ ok: true, ...r });
      }
      return res.status(400).json({ error: `不认识的步骤：${step}` });
    } catch (err) {
      console.error('chat-import: 这批没写进去', err.message);
      return res.status(500).json({ error: err.message });
    }
  });

  // 对话传完之后，页面问一下有哪几位协作者
  app.get('/memories/manage/import/who', requireBasicAuth, (req, res) => {
    res.json({ list: collaboratorList(), archived: archiveCount() });
  });

  console.log('import: 聊天记录导入 /memories/manage/import/chat');
  return { enabled: true };
}
