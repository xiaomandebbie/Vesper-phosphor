// 一键导入 Aru 备份。
//
// 小满 2026-11-05：「这些我都懒得输入」「一直卡着不动呢」
//
// ── 为什么不传整包 ──
//
// 第一版是把整个 .polarisarchive 当 body 传上来。两层都不行：
//   她那份备份一个多 G（request_evidence.jsonl 单个 970 MB），手机走 5G 上传要很久；
//   nginx 默认 client_max_body_size 是 1 MB，直接 413。
//
// 所以改成：**浏览器里解包**。zip 的目录在文件尾部，File.slice() 只读要的那几段，
// 用 DecompressionStream('deflate-raw') 展开，再把文本分小批发上来。
//
// 记忆那七份加起来 1.7 MB，1 GB 的部分一个字节都不走网。
//
// 每批 60 KB：vesper.js 里的全局 express.json() 没设 limit，默认就是 100 KB。
// 超了会在进我这儿之前就被打成 PayloadTooLargeError——所以留一截余量。
//
// ── 字段名都是读出来的，不是猜的 ──
//
// 2026-11-05 我把这六份 jsonl 都拆开读过，下面每个 key 都真实出现过：
//
//   memory_entries          content, tagsJSON, source, createdAt, updatedAt
//   memory_reference_docs   title, summary, content, charCount, source
//   memory_events           title, synopsis, sourceConversationIdsJSON,
//                           recordedStartAt, recordedEndAt, revision, generator
//   daily_summary_entries   content, recordedLocalDay, title, automaticRewriteAllowed
//   world_book_entries      bookId, title, content, enabled, constantActive, caseSensitive,
//                           useRegex, position, priority, sortOrder, role,
//                           injectDepth, scanDepth, keywordsJSON,
//                           requiredKeywordsJSON, excludedKeywordsJSON
//   collaborator_prompts    compiledPrompt, collaboratorId
//
// world_books 的标题字段没读到（那行被正文挤满了），所以按几个常见名字依次试，
// 都没有就用 id 前六位当名字，并把该行真实的 key 打进日志。不装作知道。
//
// ── 幂等 ──
//
// 全部 INSERT OR REPLACE，用备份里的原 id。同一份备份导两次不会双份，
// 重导新备份就是把改过的那几条覆上。中间断了重新跑也安全。

import db from './state.js';

// 前端要抽的文件 → 这边的 kind。别的（messages / request_evidence /
// tool_results / tasks）不读：那是运行痕迹，不是记忆。
export const PARTS = [
  ['entries', 'objects/memory_entries.jsonl', '条目记忆'],
  ['docs', 'objects/memory_reference_docs.jsonl', '长期资料'],
  ['cards', 'objects/memory_events.jsonl', '信息卡'],
  ['journal', 'objects/daily_summary_entries.jsonl', '日记'],
  ['books', 'objects/world_books.jsonl', '世界书'],
  ['wbentries', 'objects/world_book_entries.jsonl', '世界书条目'],
  ['prompt', 'objects/collaborator_prompts.jsonl', '指令'],
];

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

// 一批进来的行。rows 是已经 JSON.parse 过的对象数组。
const WRITERS = {
  entries(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO memory_entries (id, content, tags, source, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    for (const o of rows) {
      const p = o.payload;
      if (!p || !s(p.content)) continue;
      st.run(s(o.id || p.id), s(p.content), JSON.stringify(j(p.tagsJSON, [])),
        s(p.source) || 'import', ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  docs(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO memory_docs (id, title, summary, content, char_count, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    for (const o of rows) {
      const p = o.payload;
      if (!p || !s(p.title)) continue;
      const body = String(p.content ?? '');
      st.run(s(o.id || p.id), s(p.title), s(p.summary), body,
        Number(p.charCount) || Array.from(body).length, ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  cards(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO memory_cards (id, subject, synopsis, source_ids, source_count,' +
        ' recorded_start_at, recorded_end_at, revision, generator, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    for (const o of rows) {
      const p = o.payload;
      if (!p || !s(p.title) || !s(p.synopsis)) continue;
      const src = j(p.sourceConversationIdsJSON, []);
      st.run(s(o.id || p.id), s(p.title), s(p.synopsis), JSON.stringify(src), src.length,
        ts(p.recordedStartAt), ts(p.recordedEndAt), Number(p.revision) || 1,
        s(p.generator) || 'import', ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  journal(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO memory_journal (id, day, title, content, auto_rewrite, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    for (const o of rows) {
      const p = o.payload;
      if (!p) continue;
      const day = s(p.recordedLocalDay);
      const body = s(p.content);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !body) continue;
      st.run(s(o.id || p.id), day, s(p.title), body,
        p.automaticRewriteAllowed === false ? 0 : 1, ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  books(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO world_books (id, title, description, enabled, scan_depth,' +
        ' token_budget, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    let told = false;
    for (const o of rows) {
      const p = o.payload;
      if (!p) continue;
      const id = s(o.id || p.id);
      let title = s(p.title) || s(p.name) || s(p.bookName) || s(p.bookTitle) || s(p.displayName);
      if (!title) {
        title = `世界书 ${id.slice(0, 6)}`;
        if (!told) {
          console.log(`import: world_books 没找到标题字段，这行的 key：${Object.keys(p).join(', ')}`);
          told = true;
        }
      }
      st.run(id, title, s(p.bookDescription || p.description),
        p.enabled === false ? 0 : 1, 4, 2000, Number(p.sortOrder) || 0,
        ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  wbentries(rows) {
    const st = db.prepare(
      'INSERT OR REPLACE INTO world_book_entries (id, book_id, title, content, enabled,' +
        ' constant_active, keywords, required_keywords, excluded_keywords, case_sensitive, use_regex,' +
        ' position, inject_depth, scan_depth, priority, sort_order, role, created_at, updated_at)' +
        ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    );
    let n = 0;
    for (const o of rows) {
      const p = o.payload;
      if (!p || !s(p.content) || !s(p.bookId)) continue;
      st.run(s(o.id || p.id), s(p.bookId), s(p.title), s(p.content),
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
        ts(p.createdAt), ts(p.updatedAt));
      n++;
    }
    return n;
  },

  // 备份里有几位协作者，取最长的那份，其余列进日志让她自己换
prompt(rows) {
    let best = null;
    const all = [];
    for (const o of rows) {
      const text = s(o.payload?.compiledPrompt);
      if (!text) continue;
      all.push(`${s(o.payload.collaboratorId).slice(0, 8)}/${Array.from(text).length}字`);
      if (!best || text.length > best.text.length) best = { text, who: s(o.payload.collaboratorId) };
    }
    if (!best) return 0;
    db.prepare(
      "INSERT INTO memory_prompt (key, content, updated_at) VALUES ('main', ?, ?)" +
        ' ON CONFLICT(key) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at'
    ).run(best.text, Date.now());
    console.log(`import: 指令用 ${best.who.slice(0, 8)} 那份（${Array.from(best.text).length} 字）。` +
      `备份里共 ${all.length} 份：${all.join('、')}`);
    return 1;
  },
};

// ── 前端脚本 ──
//
// 注意：这整段在下面的模板字符串里，所以里面不能出现 ${ 和反引号。
// 字符串一律用单引号拼接。
const SCRIPT = `
(function () {
  var fileEl = document.getElementById('f');
  var goEl = document.getElementById('go');
  var stEl = document.getElementById('st');
  var PARTS = ` + JSON.stringify(PARTS) + `;

  function say(m) { stEl.textContent = m || ''; }
  function add(m) { stEl.textContent = stEl.textContent + '\\n' + m; }

  if (typeof DecompressionStream === 'undefined') {
    say('这个浏览器不会解压（没有 DecompressionStream）。换 Safari 或者跟小克说一声。');
    goEl.disabled = true;
    return;
  }

  fileEl.addEventListener('change', function () {
    var f = fileEl.files && fileEl.files[0];
    goEl.disabled = !f;
    if (f) say(f.name + '\\n' + (f.size / 1048576).toFixed(0) + ' MB。只会读里面记忆那几份，大头不动。');
  });

  function u16(b, i) { return b[i] | (b[i + 1] << 8); }
  function u32(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] * 16777216)) >>> 0; }

  function slice(f, start, len) {
    return f.slice(start, start + len).arrayBuffer().then(function (ab) {
      return new Uint8Array(ab);
    });
  }

  // zip 的目录在尾部。只读最后 64 KB 找它。
  function findCD(f) {
    var span = Math.min(66560, f.size);
    return slice(f, f.size - span, span).then(function (b) {
      for (var i = b.length - 22; i >= 0; i--) {
        if (u32(b, i) === 101010256) {
          return { size: u32(b, i + 12), at: u32(b, i + 16) };
        }
      }
      return null;
    });
  }

  function inflate(u8) {
    var ds = new DecompressionStream('deflate-raw');
    var stream = new Blob([u8]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) {
      return new TextDecoder('utf-8').decode(ab);
    });
  }

  function post(kind, rows) {
    return fetch('/memories/manage/import/batch', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: kind, rows: rows })
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'HTTP ' + r.status }; });
    });
  }

  // 按字节分批：全局 express.json() 默认只收 100 KB，所以 60 KB 一批。
  function sendText(kind, text) {
    var lines = text.split('\\n');
    var batch = [];
    var bytes = 0;
    var done = 0;
    var chain = Promise.resolve();

    function flush() {
      if (!batch.length) return;
      var mine = batch;
      batch = [];
      bytes = 0;
      chain = chain.then(function () {
        return post(kind, mine).then(function (d) {
          if (d && d.error) throw new Error(d.error);
          done += (d && d.n) || 0;
        });
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (!t) continue;
      var o = null;
      try { o = JSON.parse(t); } catch (e) { continue; }
      if (!o || !o.payload) continue;
      batch.push(o);
      bytes += t.length;
      if (bytes > 60000) flush();
    }
    flush();
    return chain.then(function () { return done; });
  }

  goEl.addEventListener('click', function () {
    var f = fileEl.files && fileEl.files[0];
    if (!f) return;
    goEl.disabled = true;
    say('正在读备份目录…');

    findCD(f).then(function (cd) {
      if (!cd) throw new Error('这不像个 zip（找不到目录尾）');
      if (cd.at === 4294967295) throw new Error('ZIP64 格式，这边还不认');
      return slice(f, cd.at, cd.size);
    }).then(function (cd) {
      // 走一遍目录，只记下要的那几份在哪
      var want = {};
      for (var k = 0; k < PARTS.length; k++) want[PARTS[k][1]] = PARTS[k][0];
      var found = {};
      var p = 0;
      while (p + 46 <= cd.length) {
        if (u32(cd, p) !== 33639248) break;
        var method = u16(cd, p + 10);
        var compSize = u32(cd, p + 20);
        var nameLen = u16(cd, p + 28);
        var extraLen = u16(cd, p + 30);
        var cmtLen = u16(cd, p + 32);
        var localAt = u32(cd, p + 42);
        var name = new TextDecoder('utf-8').decode(cd.subarray(p + 46, p + 46 + nameLen));
        p += 46 + nameLen + extraLen + cmtLen;
        if (want[name]) found[want[name]] = { method: method, size: compSize, at: localAt };
      }
      return found;
    }).then(function (found) {
      say('目录读到了。开始一份份抽——大头不动。');
      var chain = Promise.resolve();
      var total = {};

      PARTS.forEach(function (part) {
        var kind = part[0];
        var label = part[2];
        chain = chain.then(function () {
          var hit = found[kind];
          if (!hit) { add(label + '：备份里没有'); return; }
          add(label + '：解包中…');
          // 本地头的 nameLen/extraLen 可能和目录里不一样，得重新读
          return slice(f, hit.at, 30).then(function (lh) {
            var dataAt = hit.at + 30 + u16(lh, 26) + u16(lh, 28);
            return slice(f, dataAt, hit.size);
          }).then(function (raw) {
            return hit.method === 0
              ? new TextDecoder('utf-8').decode(raw)
              : inflate(raw);
          }).then(function (text) {
            return sendText(kind, text);
          }).then(function (n) {
            total[kind] = n;
            var cur = stEl.textContent.split('\\n');
            cur[cur.length - 1] = label + '：' + n + ' 条';
            stEl.textContent = cur.join('\\n');
          });
        });
      });

      return chain.then(function () {
        goEl.disabled = false;
        add('');
        add('导完了。去「指令」和「条目」那几栈看看。');
      });
    }).catch(function (e) {
      goEl.disabled = false;
      add('');
      add('没导成：' + (e && e.message ? e.message : String(e)));
    });
  });
})();
`;

function page() {
  return '<!DOCTYPE html>\n' +
    '<html lang="zh"><head>\n' +
    '<meta charset="UTF-8" />\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />\n' +
    '<title>导入备份 · 晨暮星</title>\n' +
    '<style>\n' +
    'body{margin:0;min-height:100vh;color:#252525;background:#f7f7f7;' +
    'font-family:-apple-system,"PingFang SC","Helvetica Neue",sans-serif}\n' +
    'main{max-width:600px;margin:0 auto;padding:22px 16px 60px}\n' +
    'h1{margin:6px 0 16px;font-size:22px;font-weight:200;letter-spacing:.26em;' +
    'padding-left:.26em;text-align:center;color:#3a3a3a}\n' +
    '.card{background:#fdfdfd;border:1px solid #e2e2e2;border-radius:16px;padding:16px;' +
    'margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05)}\n' +
    'input[type=file]{width:100%;padding:10px 0;font:inherit;font-size:15px}\n' +
    'button{min-height:44px;padding:0 20px;border:0;border-radius:12px;background:#4d4d4d;' +
    'color:#fff;font-size:15px;width:100%}\n' +
    'button[disabled]{opacity:.45}\n' +
    '.hint{margin:10px 0 0;font-size:11.5px;line-height:1.7;color:#5e5e5e}\n' +
    '.st{margin:14px 0 0;font-size:13px;line-height:1.85;color:#4d4d4d;white-space:pre-wrap;' +
    'font-variant-numeric:tabular-nums}\n' +
    'a.back{display:inline-flex;min-height:44px;align-items:center;font-size:13px;color:#4d4d4d}\n' +
    '</style></head>\n' +
    '<body><main>\n' +
    '<h1>导入备份</h1>\n' +
    '<div class="card">\n' +
    '<input type="file" id="f" accept=".polarisarchive,.zip" />\n' +
    '<p class="hint">选 Aru 导出的 .polarisarchive。在手机上解包，' +
    '只把记忆那七份（约 1.7 MB）传上来——聚天记录和运行痕迹那一 G 不走网。</p>\n' +
    '<p class="hint">按原 id 写库，导两次不会双份；中间断了重新跑也安全。' +
    '过程里别切页面。</p>\n' +
    '</div>\n' +
    '<div class="card">\n' +
    '<button id="go" disabled>导入</button>\n' +
    '<p class="st" id="st" role="status"></p>\n' +
    '</div>\n' +
    '<a class="back" href="/memories/manage">‹ 回记忆</a>\n' +
    '</main>\n' +
    '<script>' + SCRIPT + '<\/script>\n' +
    '</body></html>';
}

export function registerImportRoutes(app, { requireBasicAuth }) {
  app.get('/memories/manage/import', requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.send(page());
  });

  app.post('/memories/manage/import/batch', requireBasicAuth, (req, res) => {
    const kind = String(req.body?.kind ?? '');
    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    const writer = WRITERS[kind];
    if (!writer) return res.status(400).json({ error: `不认识的类别：${kind}` });
    if (!rows) return res.status(400).json({ error: 'rows 不是数组' });
    try {
      // 一批一个事务：快，而且中间挂了不会留半条
      const n = db.transaction(() => writer(rows))();
      res.json({ ok: true, n });
    } catch (err) {
      console.error(`import: ${kind} 这批没写进去`, err.message);
      res.status(500).json({ error: err.message });
    }
  });

  console.log('import: 导入页 /memories/manage/import（手机上解包）');
  return { enabled: true };
}
