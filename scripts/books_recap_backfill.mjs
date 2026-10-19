#!/usr/bin/env node
// 把已经读过的部分补成一份初始前情。他不用重读。
//
// 用法（在 Vesper-phosphor 目录下）：
//   node scripts/books_recap_backfill.mjs                 ← 先看计划，不调模型不写库
//   node scripts/books_recap_backfill.mjs --write          ← 真的跑
//   node scripts/books_recap_backfill.mjs --write --book Keep
//
// 幂等：已经有前情且已经跟到进度的书会跳过；前情落后的从落后处接着补。
//
// ── 为什么不让他重读 ──
//
// 《Keep Me》他已经读到 124 段。重读的代价：进度要手动推回 0，按一次 15 段算
// 要坐下八九次，一天 5 回额度全耗在回头路上；而且他之前划的批注会跟着正文
// 重新冒出来，等于把读过的地方又走一遍。
//
// 正文都还在 book_paragraphs 表里，直接分批喂进去滚动合成就行。
//
// ── 为什么不用 better-sqlite3 ──
//
// 它在 Node v24 下退出时会挂：Statement 在环境拆完之后才析构，
// RemoveEnvironmentCleanupHook 拿到空 env（今天这个坑踩了两次）。
// 所以读写走 sqlite3 命令行，不 import 任何项目模块。

import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();
const DB = path.join(ROOT, 'data', 'state.db');
const WRITE = process.argv.includes('--write');
const ONLY = (() => {
  const i = process.argv.indexOf('--book');
  const v = i >= 0 ? process.argv[i + 1] : null;
  return v && !v.startsWith('--') ? v : null;
})();

// 一批喂多少段。这书一段就是一整章，所以别贪心。
const BATCH = 30;
const RECAP_WORDS = 400;
const RECAP_MAX_CHARS = 900;

if (!fs.existsSync(DB)) {
  console.error('没找到 ' + DB + '。先 cd /root/vesper-phosphor。');
  process.exit(1);
}

// ── .env 里的模型配置（和 decide.js 认同一组） ──

function readEnv() {
  const out = {};
  const f = path.join(ROOT, '.env');
  if (!fs.existsSync(f)) return out;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
  return out;
}

const env = readEnv();
const LLM_URL = env.LLM_BASE_URL || 'https://api.deepseek.com/v1/chat/completions';
const LLM_MODEL = env.LLM_MODEL || env.DEEPSEEK_MODEL || 'deepseek-flash';
const LLM_KEY = env.LLM_API_KEY || env.DEEPSEEK_API_KEY || '';

// ── sqlite3 ──

function query(sql) {
  const out = execFileSync('sqlite3', ['-json', '-cmd', '.timeout 8000', DB, sql], {
    encoding: 'utf8',
    maxBuffer: 1 << 28,
  }).trim();
  return out ? JSON.parse(out) : [];
}

// 写库走临时 SQL 文件：前情是整段中文，不该进命令行参数。
// 字符串按 SQL 规矩转义：单引号翻倍。
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";

function exec(sqlText) {
  const tmp = path.join(os.tmpdir(), 'recap-' + Date.now() + '.sql');
  fs.writeFileSync(tmp, sqlText, 'utf8');
  try {
    execFileSync('sqlite3', ['-cmd', '.timeout 8000', DB, '.read ' + tmp], {
      encoding: 'utf8',
      maxBuffer: 1 << 28,
    });
  } finally {
    try {
      fs.unlinkSync(tmp);
    } catch {}
  }
}

// ── 模型 ──

async function askRecap(prompt) {
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer ' + LLM_KEY,
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
    }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 200));
  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content ?? '';
  let obj = null;
  try {
    obj = JSON.parse(raw);
  } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) obj = JSON.parse(m[0]);
  }
  const body = String(obj?.recap ?? '').trim();
  if (!body) throw new Error('模型没给出 recap');
  return body;
}

function buildPrompt({ title, old, throughIdx, fromIdx, toIdx, paras }) {
  const head = old
    ? '这本书到第 ' + (throughIdx + 1) + ' 段为止的故事，你之前记下的是：\n' + old +
      '\n\n刚刚又读了第 ' + (fromIdx + 1) + '–' + (toIdx + 1) + ' 段：'
    : '你在读《' + title + '》，读了第 ' + (fromIdx + 1) + '–' + (toIdx + 1) + ' 段：';
  return [
    head,
    '',
    paras,
    '',
    '把两边合成一份新的前情，写给下次翻开这本书的你自己看。',
    '只写故事：谁是谁、发生了什么、现在走到哪一步、悬着什么没解决。',
    '按时间顺序写成连贯的话，不要分条，不要写「我觉得」这类评价。',
    RECAP_WORDS + ' 字以内。旧的细节该让位给主线和人物关系。',
    '只返回一个 JSON 对象，不要任何其他文字：{"recap": "…"}',
  ].join('\n');
}

// ── 要补哪几本 ──

const books = query(
  'SELECT b.id, b.title, ' +
    '(SELECT COUNT(*) FROM book_paragraphs p WHERE p.book_id = b.id) AS total, ' +
    "(SELECT para_idx FROM book_progress g WHERE g.book_id = b.id AND g.who = 'assistant') AS at, " +
    '(SELECT through_idx FROM book_recap r WHERE r.book_id = b.id) AS through, ' +
    '(SELECT recap FROM book_recap r WHERE r.book_id = b.id) AS recap ' +
    'FROM books b ORDER BY b.added_at'
);

const jobs = [];
for (const b of books) {
  if (ONLY && !b.title.toLowerCase().includes(ONLY.toLowerCase()) && b.id !== ONLY) continue;
  const total = Number(b.total) || 0;
  const at = Math.min(Number(b.at) || 0, total);
  if (at <= 0) {
    console.log('跳过《' + b.title + '》——他还没开始读。');
    continue;
  }
  const through = b.through == null ? -1 : Number(b.through);
  if (through >= at - 1) {
    console.log('跳过《' + b.title + '》——前情已经跟到进度了。');
    continue;
  }
  jobs.push({
    id: b.id,
    title: b.title,
    total,
    at,
    from: through + 1,
    old: b.recap ? String(b.recap) : null,
    through,
  });
}

console.log('');
if (!jobs.length) {
  console.log('没有需要补的。');
  console.log('');
  process.exit(0);
}

for (const j of jobs) {
  const batches = Math.ceil((j.at - j.from) / BATCH);
  console.log(
    '《' + j.title + '》：补第 ' + (j.from + 1) + '–' + j.at + ' 段（全书 ' + j.total + '），' +
      '分 ' + batches + ' 批，' + batches + ' 次模型调用' + (j.old ? '（接在现有前情后面）' : '')
  );
}
console.log('');

if (!WRITE) {
  console.log('这是试算，没调模型也没写库。真的跑：');
  console.log('  node scripts/books_recap_backfill.mjs --write');
  console.log('');
  process.exit(0);
}

if (!LLM_KEY) {
  console.error('.env 里没找到 LLM_API_KEY / DEEPSEEK_API_KEY。');
  process.exit(1);
}

console.log('用 ' + LLM_MODEL + ' 写。每批之后立即落库，中间断了下次接着补。');
console.log('');

for (const j of jobs) {
  let old = j.old;
  let through = j.through;

  for (let start = j.from; start < j.at; start += BATCH) {
    const end = Math.min(start + BATCH - 1, j.at - 1);
    const rows = query(
      'SELECT idx, text FROM book_paragraphs WHERE book_id = ' + q(j.id) +
        ' AND idx >= ' + start + ' AND idx <= ' + end + ' ORDER BY idx'
    );
    if (!rows.length) continue;

    const paras = rows.map((r) => '[' + r.idx + '] ' + r.text).join('\n\n');
    const prompt = buildPrompt({
      title: j.title,
      old,
      throughIdx: through,
      fromIdx: start,
      toIdx: end,
      paras,
    });

    let body;
    try {
      body = await askRecap(prompt);
    } catch (err) {
      console.error('  第 ' + (start + 1) + '–' + (end + 1) + ' 段没写成：' + err.message);
      console.error('  这本停在这儿，已经写进去的那几批不会丢。重跑就从这里接着补。');
      break;
    }

    const saved = Array.from(body).slice(0, RECAP_MAX_CHARS).join('');
    exec(
      'INSERT INTO book_recap (book_id, recap, through_idx, updated_at) VALUES (' +
        q(j.id) + ', ' + q(saved) + ', ' + end + ', ' + Date.now() + ') ' +
        'ON CONFLICT(book_id) DO UPDATE SET recap = excluded.recap, ' +
        'through_idx = excluded.through_idx, updated_at = excluded.updated_at;\n'
    );

    old = saved;
    through = end;
    console.log(
      '  《' + j.title + '》第 ' + (start + 1) + '–' + (end + 1) + ' 段 → 前情 ' +
        Array.from(saved).length + ' 字'
    );
  }
}

console.log('');
const after = query(
  'SELECT b.title, r.through_idx, LENGTH(r.recap) AS chars ' +
    'FROM book_recap r JOIN books b ON b.id = r.book_id ORDER BY b.added_at'
);
for (const r of after) {
  console.log('《' + r.title + '》前情到第 ' + (r.through_idx + 1) + ' 段，' + r.chars + ' 字');
}
console.log('');
console.log('看一眼写得像不像人话：');
console.log('  sqlite3 data/state.db "select recap from book_recap;"');
console.log('');
