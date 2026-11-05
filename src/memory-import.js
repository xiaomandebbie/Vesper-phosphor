// 一键导入 Aru 备份。
//
// 小满 2026-11-05：「这些我都懒得输入」「之后我在设置里一键导入这个备份」
//
// ── 字段名都是读出来的，不是猜的 ──
//
// 2026-11-05 我把她那份 .polarisarchive 里这六份 jsonl 都拆开读过了，
// 下面每一个 payload key 都是真实出现过的：
//
//   memory_entries          content, tagsJSON, source, createdAt, updatedAt
//   memory_reference_docs   title, summary, content, charCount, source
//   memory_events           title, synopsis, sourceConversationIdsJSON,
//                           recordedStartAt, recordedEndAt, revision, generator, metadataJSON
//   daily_summary_entries   content, recordedLocalDay, title, automaticRewriteAllowed, writer
//   world_book_entries      bookId, title, content, enabled, constantActive, caseSensitive,
//                           useRegex, position, priority, sortOrder, role,
//                           injectDepth, scanDepth, keywordsJSON,
//                           requiredKeywordsJSON, excludedKeywordsJSON
//   collaborator_prompts    compiledPrompt, collaboratorId
//
// world_books 的标题字段我没读到（那行被正文挤满了），所以下面按几个
// 常见名字依次试，都没有就用 id 开头几位当名字，并把该行真实的 key 打进日志。
// 不装作知道；日志里一看就能补准。
//
// ── 为什么自己读 zip ──
//
// package.json 里没有解压库，而且这份备份里 request_evidence.jsonl 单个 970 MB——
// 整包解开是疑难杂症。所以这儿自己解一遍 zip 目录，只把要的那六份
// seek 出来 inflate，其余一字不读。zlib 是 Node 自带的，不装任何东西。
//
// ── 为什么不用表单上传 ──
//
// multipart 要自己拆边界，1 GB 的文件拆错一字节就全废。
// 所以前端直接把 File 当 body 发上来（application/octet-stream），
// 这边 req.pipe 进文件。express 的 json/urlencoded 不认这个类型，不会插手。
//
// ── 幂等 ──
//
// 全部 INSERT OR REPLACE，用备份里的原 id。同一份备份导两次不会双份，
// 重导新备份就是把改过的那几条覆上。

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import db from './state.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const STAGE = path.join(DATA_DIR, 'import');
const MAX_BYTES = 6 * 1024 * 1024 * 1024;

// 要抽的那几份。别的（request_evidence / tool_results / tasks / messages）不读：
// 那是运行痕迹，不是记忆。
const WANTED = [
  'objects/memory_entries.jsonl',
  'objects/memory_reference_docs.jsonl',
  'objects/memory_events.jsonl',
  'objects/daily_summary_entries.jsonl',
  'objects/world_books.jsonl',
  'objects/world_book_entries.jsonl',
  'objects/collaborator_prompts.jsonl',
];

// ── zip ──

function findEOCD(fd, size) {
  const span = Math.min(66560, size);
  const buf = Buffer.alloc(span);
  fs.readSync(fd, buf, 0, span, size - span);
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      return {
        count: buf.readUInt16LE(i + 10),
        cdSize: buf.readUInt32LE(i + 12),
        cdOffset: buf.readUInt32LE(i + 16),
      };
    }
  }
  return null;
}

// 按名字把要的文件抽出来。返回 { 路径: Buffer }。
function extract(file, names) {
  const want = new Set(names);
  const out = {};
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  try {
    const eocd = findEOCD(fd, size);
    if (!eocd) throw new Error('这不像个 zip（找不到目录尾）');
    if (eocd.cdOffset === 0xffffffff) throw new Error('ZIP64 格式，这边还不认');

    const cd = Buffer.alloc(eocd.cdSize);
    fs.readSync(fd, cd, 0, eocd.cdSize, eocd.cdOffset);

    let p = 0;
    while (p + 46 <= cd.length) {
      if (cd.readUInt32LE(p) !== 0x02014b50) break;
      const method = cd.readUInt16LE(p + 10);
      const compSize = cd.readUInt32LE(p + 20);
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      const localAt = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nameLen).toString('utf8');
      p += 46 + nameLen + extraLen + commentLen;
      if (!want.has(name)) continue;

      // 本地头的 nameLen/extraLen 可能和目录里不一样，得重新读
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, localAt);
      if (lh.readUInt32LE(0) !== 0x04034b50) throw new Error(`${name} 的头不对`);
      const dataAt = localAt + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);

      const raw = Buffer.alloc(compSize);
      fs.readSync(fd, raw, 0, compSize, dataAt);
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    }
  } finally {
    fs.closeSync(fd);
  }
  return out;
}

// ── 解行 ──

function* rows(buf) {
  if (!buf) return;
  for (const line of buf.toString('utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (o?.payload) yield o;
    } catch {
      // 丢一行比整次导入崩掉好
    }
  }
}

const j = (raw, fb) => {
  if (!raw) return fb;
  try {
    const v = JSON.parse(raw);
    return v ?? fb;
  } catch {
    return fb;
  }
};
const ts = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : Date.now());
const s = (v) => String(v ?? '').trim();

// ── 写库 ──

function importAll(files) {
  const n = { entries: 0, docs: 0, cards: 0, journal: 0, books: 0, wbEntries: 0, prompt: 0 };
  const notes = [];

  const run = (sql, list) => {
    const st = db.prepare(sql);
    const tx = db.transaction((all) => {
      for (const args of all) st.run(...args);
    });
    tx(list);
  };

  // 条目
  {
    const list = [];
    for (const o of rows(files['objects/memory_entries.jsonl'])) {
      const p = o.payload;
      if (!s(p.content)) continue;
      list.push([s(o.id || p.id), s(p.content), JSON.stringify(j(p.tagsJSON, [])),
        s(p.source) || 'import', ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO memory_entries (id, content, tags, source, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?)', list);
    n.entries = list.length;
  }

  // 长期资料
  {
    const list = [];
    for (const o of rows(files['objects/memory_reference_docs.jsonl'])) {
      const p = o.payload;
      const title = s(p.title);
      if (!title) continue;
      const body = String(p.content ?? '');
      list.push([s(o.id || p.id), title, s(p.summary), body,
        Number(p.charCount) || Array.from(body).length, ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO memory_docs (id, title, summary, content, char_count, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?)', list);
    n.docs = list.length;
  }

  // 信息卡
  {
    const list = [];
    for (const o of rows(files['objects/memory_events.jsonl'])) {
      const p = o.payload;
      const subject = s(p.title);
      const synopsis = s(p.synopsis);
      if (!subject || !synopsis) continue;
      const src = j(p.sourceConversationIdsJSON, []);
      list.push([s(o.id || p.id), subject, synopsis, JSON.stringify(src), src.length,
        ts(p.recordedStartAt), ts(p.recordedEndAt), Number(p.revision) || 1,
        s(p.generator) || 'import', ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO memory_cards (id, subject, synopsis, source_ids, source_count,' +
      ' recorded_start_at, recorded_end_at, revision, generator, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', list);
    n.cards = list.length;
  }

  // 日记
  {
    const list = [];
    for (const o of rows(files['objects/daily_summary_entries.jsonl'])) {
      const p = o.payload;
      const day = s(p.recordedLocalDay);
      const body = s(p.content);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !body) continue;
      list.push([s(o.id || p.id), day, s(p.title), body,
        p.automaticRewriteAllowed === false ? 0 : 1, ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO memory_journal (id, day, title, content, auto_rewrite, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?)', list);
    n.journal = list.length;
  }

  // 世界书。标题字段名没验到，按几个常见名字试，都没有就把真实 key 打出来
  {
    const list = [];
    let reported = false;
    for (const o of rows(files['objects/world_books.jsonl'])) {
      const p = o.payload;
      const id = s(o.id || p.id);
      let title = s(p.title) || s(p.name) || s(p.bookName) || s(p.bookTitle) || s(p.displayName);
      if (!title) {
        title = `世界书 ${id.slice(0, 6)}`;
        if (!reported) {
          notes.push(`world_books 没找到标题字段，这行的 key：${Object.keys(p).join(', ')}`);
          reported = true;
        }
      }
      list.push([id, title, s(p.bookDescription || p.description),
        p.enabled === false ? 0 : 1, 4, 2000, Number(p.sortOrder) || 0,
        ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO world_books (id, title, description, enabled, scan_depth,' +
      ' token_budget, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', list);
    n.books = list.length;
  }

  // 世界书条目
  {
    const list = [];
    for (const o of rows(files['objects/world_book_entries.jsonl'])) {
      const p = o.payload;
      const body = s(p.content);
      const bookId = s(p.bookId);
      if (!body || !bookId) continue;
      list.push([s(o.id || p.id), bookId, s(p.title), body,
        p.enabled === false ? 0 : 1,
        p.constantActive ? 1 : 0,
        JSON.stringify(j(p.keywordsJSON, [])),
        JSON.stringify(j(p.requiredKeywordsJSON, [])),
        JSON.stringify(j(p.excludedKeywordsJSON, [])),
        p.caseSensitive ? 1 : 0,
        p.useRegex ? 1 : 0,
        s(p.position) || 'after_collaborator_prompt',
        p.injectDepth == null ? null : Number(p.injectDepth),
        p.scanDepth == null ? null : Number(p.scanDepth),
        Number(p.priority) || 0,
        Number(p.sortOrder) || 0,
        s(p.role) || 'system',
        ts(p.createdAt), ts(p.updatedAt)]);
    }
    run('INSERT OR REPLACE INTO world_book_entries (id, book_id, title, content, enabled,' +
      ' constant_active, keywords, required_keywords, excluded_keywords, case_sensitive, use_regex,' +
      ' position, inject_depth, scan_depth, priority, sort_order, role, created_at, updated_at)' +
      ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', list);
    n.wbEntries = list.length;
  }

  // 指令。备份里有几位协作者，取最长的那份——别的列进日志让她自己换
  {
    let best = null;
    const all = [];
    for (const o of rows(files['objects/collaborator_prompts.jsonl'])) {
      const text = s(o.payload.compiledPrompt);
      if (!text) continue;
      all.push({ who: s(o.payload.collaboratorId).slice(0, 8), len: Array.from(text).length });
      if (!best || text.length > best.text.length) best = { text, who: s(o.payload.collaboratorId) };
    }
    if (best) {
      db.prepare(
        "INSERT INTO memory_prompt (key, content, updated_at) VALUES ('main', ?, ?)" +
          ' ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
      ).run(best.text, Date.now());
      n.prompt = 1;
      notes.push(`指令用的是 ${best.who.slice(0, 8)} 那份（${Array.from(best.text).length} 字）。` +
        `备份里共 ${all.length} 份：${all.map((a) => `${a.who}/${a.len}字`).join('、')}`);
    }
  }

  return { counts: n, notes };
}

// ── 路由 ──

export function registerImportRoutes(app, { requireBasicAuth }) {
  fs.mkdirSync(STAGE, { recursive: true });

  // 文件当 body 直接发上来，pipe 进盘。不经 multipart。
  app.post('/memories/manage/import/upload', requireBasicAuth, (req, res) => {
    const dest = path.join(STAGE, 'incoming.polarisarchive');
    let got = 0;
    let dead = false;
    const out = fs.createWriteStream(dest);

    req.on('data', (c) => {
      got += c.length;
      if (got > MAX_BYTES && !dead) {
        dead = true;
        req.destroy();
        out.destroy();
        try {
          fs.rmSync(dest, { force: true });
        } catch {}
      }
    });

    req.pipe(out);

    out.on('finish', () => {
      if (dead) return;
      console.log(`import: 收到 ${(got / 1048576).toFixed(1)} MB`);
      let r;
      try {
        const files = extract(dest, WANTED);
        const missing = WANTED.filter((w) => !files[w]);
        r = importAll(files);
        if (missing.length) r.notes.push(`这几份备份里没有：${missing.join('、')}`);
      } catch (err) {
        console.error('import: 导入失败', err.message);
        return res.status(500).json({ error: err.message });
      } finally {
        // 应读完就删：那是 1 GB 的东西，没必要趖在盘上
        try {
          fs.rmSync(dest, { force: true });
        } catch {}
      }
      const c = r.counts;
      console.log(
        `import: 条目 ${c.entries} · 资料 ${c.docs} · 信息卡 ${c.cards} · 日记 ${c.journal}` +
          ` · 世界书 ${c.books}/${c.wbEntries} · 指令 ${c.prompt}`
      );
      for (const note of r.notes) console.log('import:', note);
      res.json({ ok: true, megabytes: Number((got / 1048576).toFixed(1)), ...r });
    });

    out.on('error', (err) => {
      console.error('import: 写不进盘', err.message);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  });

  console.log('import: 导入接口 /memories/manage/import/upload');
  return { enabled: true };
}
