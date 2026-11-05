// 「模型 · 连接 · 通知」那个页面。
//
// 小满 2026-11-05：「我的主模型能不能直接改底层，像我在 aru 拉出来是 aru-chat，
// 我想能改 aru-chat 的底层模型，现在是 deepseek 以后可以改为其他供应商」
// 「连模型要更改 token 呀」
//
// ── aru-chat 是什么 ──
//
// 它不是模型名，是 vesper-gateway 上的一条线路名（见 gateway.js 的 routingTable）。
// Aru 那边填的「自定义服务」只看到这个名字；底层连谁、用哪个模型、拿哪把 key，
// 全由 CLIENT_UPSTREAM_BASE_URL / _MODEL / _API_KEY 决定。
//
// 所以换供应商 = 换这一组三个。token 当然一起换 —— 她说得对，
// 换了供应商还用旧 key 一定 401。页面上这三个摆在一起，就是为了别漏。
//
// ── 为什么是列表 → 点进去 ──
//
// 照她给的 Aru 截图：功能模型是一页列表，每项带状态，点进去配具体的。
// 这样一页上不会堆二十个输入框，而且每组各自保存、各自重启，互不影响。
//
// ── 保存完重启谁 ──
//
// 这些变量是进程启动时读的，改 .env 不会自己生效。每个变量标了该重启哪几个
// 进程（见 env-store.js 的 FIELDS），所以按钮上写的是具体的进程名。
//
// 不无脑重启三个：phosphor 重启会打断他正在走的那一轮唤醒。
//
// vesper 自己通常不用重启 —— 这个页面每次都重新读 .env 文件，
// 不靠进程里那份 process.env。真要重启 vesper 时得先把响应发出去再动手，
// 不然当前这个请求会被自己掐断。
//
// ── 测试连接 ──
//
// 真的发一次请求，但 max_tokens=1，花掉的钱可以忽略。
// 生图和语音不真生成：那两个一次就是真金白银，只验地址能不能连上、
// key 的形状对不对。

import { exec } from 'node:child_process';
import { FIELDS, GROUPS, readFields, writeFields, canEdit } from './env-store.js';
import { renderMenu, HEAD_SCRIPT, CHROME_CSS, CHROME_SCRIPT } from './page-chrome.js';
import { renderTabs, TABS_CSS } from './tabs.js';

const PREFIX = '/me/models';
// 只许重启这三个。写死，不从请求里取进程名
const PROCESSES = new Set(['vesper', 'vesper-gateway', 'phosphor']);

function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const groupById = (id) => GROUPS.find((g) => g.id === id);

// 这一组配好了没有：三件套（地址/模型/key）都齐才算
function groupState(g, vals) {
  const need = g.keys.filter((k) => FIELDS[k]?.kind !== 'select' && !/TIMEOUT|SIZE/.test(k));
  const got = need.filter((k) => vals[k]?.set);
  if (!got.length) return { label: '没配', cls: 'off' };
  if (got.length < need.length) return { label: '缺一项', cls: 'warn' };
  return { label: '已配置', cls: 'ok' };
}

// ── 个人页上那一行 ──
// 用 me-page.js 自己的 .row 类名，和后台日志、收藏长得一样
export function renderModelsRow() {
  let done = 0;
  try {
    const vals = readFields();
    done = GROUPS.filter((g) => groupState(g, vals).cls === 'ok').length;
  } catch {
    done = 0;
  }
  return `<a class="row" href="${PREFIX}">
    <div class="row-in">
      <span class="row-name">模型 · 连接 · 通知</span>
      <span class="row-what">聊天和唤醒走哪条线路、生图语音接谁，以及通知</span>
    </div>
    <span class="row-val">${done}/${GROUPS.length}</span>
    <span class="row-go" aria-hidden="true">›</span>
  </a>`;
}

const STYLE = `
  :root { --ink: #252525; --muted: #5e5e5e; --accent: #4d4d4d; --gold: #818181;
    --card: #fdfdfd; --card-soft: #f2f2f2; --line: #e2e2e2; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; color: var(--ink);
    font-family: -apple-system, "PingFang SC", "Helvetica Neue", sans-serif; }
  main { position: relative; z-index: 1; max-width: 600px; margin: 0 auto; padding: 18px 16px 48px; }
  .hero { text-align: center; margin: 6px 0 18px; }
  .title { margin: 0; font-size: 24px; font-weight: 200; letter-spacing: 0.28em; padding-left: 0.28em;
    color: #3a3a3a; }
  .sect { margin: 22px 2px 10px; font-size: 12px; letter-spacing: 0.16em; color: var(--muted); }
  .row { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; padding: 14px 16px;
    background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); color: inherit; text-decoration: none; }
  .row:active { background: var(--card-soft); }
  .row-in { flex: 1; min-width: 0; }
  .row-name { display: block; font-size: 15px; font-weight: 600; color: var(--accent); }
  .row-what { display: block; margin-top: 4px; font-size: 12px; line-height: 1.6; color: var(--muted); }
  .row-go { flex: none; color: var(--gold); font-size: 18px; }
  .tag { flex: none; font-size: 11px; border-radius: 999px; padding: 2px 10px; border: 1px solid var(--line); }
  .tag.ok { color: var(--accent); background: var(--card-soft); }
  .tag.warn { color: #8a6a1a; background: #f8f1df; border-color: #ecdfc2; }
  .tag.off { color: #a0a0a0; }
  .field { display: grid; gap: 6px; margin-bottom: 14px; }
  .field label { font-size: 13px; color: var(--muted); }
  .field .k { font-size: 10.5px; color: #a8a8a8; letter-spacing: 0.04em; }
  input, select { width: 100%; padding: 10px 12px; font: inherit; font-size: 16px; color: var(--ink);
    background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
  input:focus, select:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  .hint { margin: 0; font-size: 11.5px; line-height: 1.6; color: var(--muted); }
  .hint code { padding: 1px 5px; border-radius: 5px; font-size: 11px; background: var(--card-soft); }
  .card { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 16px; margin-bottom: 14px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
  .status { margin: 12px 2px 0; min-height: 1.3em; font-size: 13px; line-height: 1.7; color: var(--accent);
    white-space: pre-wrap; }
  .acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  button { min-height: 42px; padding: 0 18px; border: 0; border-radius: 12px;
    background: var(--accent); color: #fff; font-size: 14px; cursor: pointer; }
  button:active { opacity: 0.85; }
  button[disabled] { opacity: 0.5; cursor: default; }
  button.ghost { background: none; color: var(--accent); border: 1px solid var(--line); }
  .back { display: inline-flex; align-items: center; min-height: 44px; margin-top: 18px;
    font-size: 13px; color: var(--accent); text-decoration: none; }
  a:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
`;

function layout(title, body, script = '') {
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${escapeHtml(title)} · 晨暮星</title>
<script>${HEAD_SCRIPT}<\/script>
<style>${CHROME_CSS}${TABS_CSS}${STYLE}</style>
</head>
<body><main>${renderMenu('/me')}${body}</main>
${renderTabs('/me')}
<script>${script}${CHROME_SCRIPT}<\/script></body>
</html>`;
}

// ── 列表页 ──

function listPage() {
  const vals = readFields();
  const row = (g) => {
    const st = groupState(g, vals);
    const model = g.keys.find((k) => /_MODEL$/.test(k));
    const now = model && vals[model]?.value ? vals[model].value : '';
    return `<a class="row" href="${PREFIX}/${g.id}">
      <div class="row-in">
        <span class="row-name">${escapeHtml(g.name)}</span>
        <span class="row-what">${escapeHtml(now || g.what)}</span>
      </div>
      <span class="tag ${st.cls}">${st.label}</span>
      <span class="row-go" aria-hidden="true">›</span>
    </a>`;
  };

  const main = GROUPS.filter((g) => ['chat', 'decide', 'dream', 'fallback'].includes(g.id));
  const feat = GROUPS.filter((g) => !['chat', 'decide', 'dream', 'fallback'].includes(g.id));

  return layout(
    '模型 · 连接',
    `<header class="hero"><h1 class="title">模型</h1></header>
    <p class="sect">主模型</p>
    ${main.map(row).join('')}
    <p class="hint" style="margin:0 2px 0">Aru 里那个 <code>aru-chat</code> 走的是「聊天」这条。
      它只是网关上的一个名字，底层连谁由这条线路的地址、模型、token 决定 ——
      换供应商三个一起换。</p>
    <p class="sect">功能模型</p>
    ${feat.map(row).join('')}
    <p class="sect">通知</p>
    <a class="row" href="/me/push">
      <div class="row-in">
        <span class="row-name">PWA 通知</span>
        <span class="row-what">他发动态、做了事的时候给你一条通知</span>
      </div>
      <span class="row-go" aria-hidden="true">›</span>
    </a>
    <a class="back" href="/me">‹ 回个人</a>`
  );
}

// ── 某一组的详情页 ──

function fieldHtml(key, cur) {
  const spec = FIELDS[key];
  const label = {
    CLIENT_UPSTREAM_BASE_URL: '供应商地址',
    CLIENT_UPSTREAM_MODEL: '底层模型',
    CLIENT_UPSTREAM_API_KEY: 'API Key',
    DECIDE_UPSTREAM_BASE_URL: '供应商地址',
    DECIDE_UPSTREAM_MODEL: '底层模型',
    DECIDE_UPSTREAM_API_KEY: 'API Key',
    DREAM_LLM_BASE_URL: '完整接口地址',
    DREAM_LLM_MODEL: '模型',
    DREAM_LLM_API_KEY: 'API Key',
    LLM_BASE_URL: '完整接口地址',
    LLM_MODEL: '模型',
    LLM_API_KEY: 'API Key',
    DEEPSEEK_API_KEY: '兜底 API Key',
    IMAGE_API_URL: '完整接口地址',
    IMAGE_MODEL: '模型',
    IMAGE_API_KEY: 'API Key',
    IMAGE_API_FORMAT: '接口格式',
    IMAGE_SIZE: '图片尺寸',
    IMAGE_TIMEOUT_MS: '超时（毫秒）',
    ELEVENLABS_API_KEY: 'API Key',
    ELEVENLABS_VOICE_ID: '音色 id',
    ELEVENLABS_MODEL: '模型',
  }[key] || key;

  const id = `f-${key}`;
  let input;
  if (spec.kind === 'select') {
    const opts = spec.options
      .map((o) => `<option value="${escapeHtml(o)}"${cur.value === o ? ' selected' : ''}>${escapeHtml(o)}</option>`)
      .join('');
    input = `<select id="${id}" name="${key}">${opts}</select>`;
  } else if (spec.kind === 'secret') {
    // 不回显原文，只说有没有、尾四位是什么。空着提交 = 不改
    const ph = cur.set ? `已经有了，末尾 ${cur.tail}（空着就不改）` : '还没填';
    input = `<input id="${id}" name="${key}" type="password" placeholder="${escapeHtml(ph)}"
      autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" />`;
  } else {
    input = `<input id="${id}" name="${key}" type="${spec.kind === 'number' ? 'number' : 'text'}"
      value="${escapeHtml(cur.value)}" autocomplete="off" autocapitalize="none"
      autocorrect="off" spellcheck="false" />`;
  }

  return `<div class="field">
    <label for="${id}">${escapeHtml(label)} <span class="k">${key}</span></label>
    ${input}
    ${spec.hint ? `<p class="hint">${escapeHtml(spec.hint)}</p>` : ''}
  </div>`;
}

const DETAIL_SCRIPT = `(function () {
  var form = document.querySelector('[data-env-form]');
  if (!form) return;
  var gid = form.getAttribute('data-env-form');
  var status = document.querySelector('[data-env-status]');
  var saveBtn = document.querySelector('[data-env-save]');
  var testBtn = document.querySelector('[data-env-test]');

  function say(m) { if (status) status.textContent = m || ''; }

  function collect() {
    var out = {};
    form.querySelectorAll('input, select').forEach(function (el) {
      if (!el.name) return;
      // 密码框空着 = 不改，不要把空值发上去把现有 key 洗掉
      if (el.type === 'password' && !el.value) return;
      out[el.name] = el.value;
    });
    return out;
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    }).then(function (r) { return r.json().catch(function () { return {}; }); });
  }

  if (testBtn) {
    testBtn.addEventListener('click', function () {
      testBtn.disabled = true;
      say('在连一下看看…');
      // 测的是框里现在填的值，不是已保存的 —— 这样能先试再存
      post('${PREFIX}/' + gid + '/test', collect())
        .then(function (r) {
          testBtn.disabled = false;
          say(r.error ? '连不上：' + r.error : r.message || '通了。');
        })
        .catch(function (e) {
          testBtn.disabled = false;
          say('没测成：' + (e && e.message ? e.message : String(e)));
        });
    });
  }

  saveBtn.addEventListener('click', function () {
    saveBtn.disabled = true;
    say('在写 .env…');
    post('${PREFIX}/' + gid, collect())
      .then(function (r) {
        if (r.error) { saveBtn.disabled = false; return say('没存成：' + r.error); }
        if (!r.changed || !r.changed.length) { saveBtn.disabled = false; return say('没什么改动。'); }
        say('存好了：' + r.changed.join('、')
          + (r.backup ? '\\n（旧的备份成 ' + r.backup + '）' : '')
          + (r.restart && r.restart.length ? '\\n正在重启 ' + r.restart.join('、') + '…' : ''));
        if (!r.restart || !r.restart.length) { saveBtn.disabled = false; return; }
        return post('${PREFIX}/restart', { targets: r.restart }).then(function (rr) {
          saveBtn.disabled = false;
          if (rr.error) return say('存好了，但重启没成：' + rr.error + '\\n在服务器上手动跑：pm2 restart ' + r.restart.join(' ') + ' --update-env');
          say('存好了，' + (rr.restarted || []).join('、') + ' 已经重启。新设置现在生效了。');
        });
      })
      .catch(function (e) {
        saveBtn.disabled = false;
        say('没存成：' + (e && e.message ? e.message : String(e)));
      });
  });
})();`;

function detailPage(g) {
  const vals = readFields();
  const canTest = ['chat', 'decide', 'dream', 'fallback'].includes(g.id);
  const note =
    g.id === 'chat'
      ? `<p class="hint">Aru 里填的那个 <code>aru-chat</code> 就是这条线路。改完这三个，
         它背后连的供应商和模型就换了 —— 名字不用动，Aru 那边不用重新配。</p>`
      : '';

  return layout(
    g.name,
    `<header class="hero"><h1 class="title">${escapeHtml(g.name)}</h1></header>
    <div class="card">
      <p class="hint" style="margin-bottom:14px">${escapeHtml(g.what)}</p>
      ${note}
      <form data-env-form="${escapeHtml(g.id)}" onsubmit="return false">
        ${g.keys.map((k) => fieldHtml(k, vals[k])).join('')}
      </form>
      <div class="acts">
        <button type="button" data-env-save>保存并重启</button>
        ${canTest ? '<button type="button" class="ghost" data-env-test>测试连接</button>' : ''}
      </div>
      <p class="status" role="status" data-env-status></p>
    </div>
    <p class="hint">API Key 那一栏空着提交就是不改。要清空得专门填 <code>__clear__</code> ——
      得是个明确的动作，不能是「没填」。</p>
    <a class="back" href="${PREFIX}">‹ 回模型</a>`,
    DETAIL_SCRIPT
  );
}

// ── 测试连接 ──
// 用框里现在填的值，没填的拿已存的补上 —— 这样能先试再存。
// max_tokens=1：真发一次请求，但花掉的钱可以忽略。

function mergeForTest(g, body) {
  const saved = readFields();
  const out = {};
  for (const k of g.keys) {
    const given = String(body?.[k] ?? '').trim();
    out[k] = given || (FIELDS[k].kind === 'secret' ? '' : saved[k].value);
  }
  return out;
}

async function testChatLine(g, vals) {
  const pick = (suffix) => g.keys.find((k) => k.endsWith(suffix));
  const baseKey = pick('_BASE_URL');
  const modelKey = pick('_MODEL');
  const keyKey = pick('_API_KEY');

  const base = String(vals[baseKey] ?? '').trim();
  const model = String(vals[modelKey] ?? '').trim();
  // key 没在框里填就读已存的原文（readFields 不给原文，这里单独读一次）
  let apiKey = String(vals[keyKey] ?? '').trim();
  if (!apiKey) {
    apiKey = String(process.env[keyKey] ?? '').trim() || String(process.env.DEEPSEEK_API_KEY ?? '').trim();
  }

  if (!base) return { error: `${baseKey} 是空的` };
  if (!model) return { error: `${modelKey} 是空的` };
  if (!apiKey) return { error: `${keyKey} 是空的，而且兜底的 DEEPSEEK_API_KEY 也没有` };

  // 两种写法：网关那两条线路只写域名，做梦和兜底那两条是完整地址
  const url = /\/chat\/completions$/.test(base) ? base : `${base.replace(/\/+$/, '')}/v1/chat/completions`;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1 }),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    return { error: `连不上 ${url}：${err.message}` };
  }

  const text = (await res.text()).slice(0, 300);
  if (res.ok) return { ok: true, message: `通了。${url} 认这个 model，返回 ${res.status}。` };
  if (res.status === 401 || res.status === 403) {
    return { error: `地址对，但 key 不行（${res.status}）。换供应商要连 token 一起换。` };
  }
  if (res.status === 404) {
    return { error: `${res.status}：地址或模型名不对。这条线路${/\/chat\/completions$/.test(base) ? '要完整地址' : '只写域名、不带 /v1'}。` };
  }
  return { error: `${res.status}：${text}` };
}

async function testGroup(g, body) {
  const vals = mergeForTest(g, body);
  if (['chat', 'decide', 'dream', 'fallback'].includes(g.id)) return testChatLine(g, vals);
  return { error: '这一组不支持测试（生图和语音一测就是真金白银，只能存完直接用）' };
}

// ── 重启 ──
// 进程名只认 PROCESSES 里那三个，不从请求里拼命令。
// 带 --update-env：不带的话 .env 改了不生效（和 Proof 那两个 TTL 同一类坑）。

function restartProcesses(targets) {
  const list = [...new Set(targets)].filter((t) => PROCESSES.has(t));
  if (!list.length) return Promise.resolve({ ok: true, restarted: [] });

  // 重启 vesper 会掐断当前这个请求，所以它排最后、延后动手
  const self = list.includes('vesper');
  const others = list.filter((t) => t !== 'vesper');

  const run = (names) =>
    new Promise((resolve) => {
      if (!names.length) return resolve({ ok: true });
      const cmd = `pm2 restart ${names.join(' ')} --update-env`;
      exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
        if (err) {
          console.error('env: 重启失败', cmd, String(stderr || err.message).slice(0, 300));
          return resolve({ error: String(stderr || err.message).slice(0, 200) });
        }
        console.log(`env: 重启了 ${names.join('、')}`);
        resolve({ ok: true });
      });
    });

  return run(others).then((r) => {
    if (self) {
      // 先把响应发出去，再重启自己
      setTimeout(() => run(['vesper']), 1500);
    }
    return r.error ? { error: r.error } : { ok: true, restarted: list };
  });
}

export function registerEnvRoutes(app, { requireBasicAuth }) {
  app.get(PREFIX, requireBasicAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      res.send(listPage());
    } catch (err) {
      console.error('env: 渲染列表页失败', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  // 重启要挂在 /:id 之前，不然 restart 会被当成一个组 id
  app.post(`${PREFIX}/restart`, requireBasicAuth, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    const targets = Array.isArray(req.body?.targets) ? req.body.targets.map(String) : [];
    try {
      res.json(await restartProcesses(targets));
    } catch (err) {
      console.error('env: 重启出错', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.get(`${PREFIX}/:id`, requireBasicAuth, (req, res) => {
    const g = groupById(String(req.params.id));
    if (!g) return res.status(404).send('没有这一组');
    res.set('Cache-Control', 'no-store');
    try {
      res.send(detailPage(g));
    } catch (err) {
      console.error('env: 渲染详情页失败', err);
      res.status(500).send('这页出错了，看一下 vesper 的日志。');
    }
  });

  app.post(`${PREFIX}/:id/test`, requireBasicAuth, async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    const g = groupById(String(req.params.id));
    if (!g) return res.status(404).json({ error: '没有这一组' });
    try {
      res.json(await testGroup(g, req.body));
    } catch (err) {
      console.error('env: 测试失败', err);
      res.status(500).json({ error: err.message });
    }
  });

  app.post(`${PREFIX}/:id`, requireBasicAuth, (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ error: '请求来源不对' });
    const g = groupById(String(req.params.id));
    if (!g) return res.status(404).json({ error: '没有这一组' });

    // 只收这一组里的字段，别的一概不理
    const patch = {};
    for (const k of g.keys) {
      if (!canEdit(k)) continue;
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, k)) patch[k] = req.body[k];
    }
    if (!Object.keys(patch).length) return res.json({ ok: true, changed: [], restart: [] });

    try {
      res.json(writeFields(patch));
    } catch (err) {
      console.error('env: 保存失败', err);
      res.status(500).json({ error: err.message });
    }
  });

  console.log(`env: 模型设置页 ${PREFIX}`);
}