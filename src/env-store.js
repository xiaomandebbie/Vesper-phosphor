// 改 .env 的那一层：读当前值、写回去、哪些能改。
//
// 小满 2026-11-05：「分为主模型和功能模型（生图、语音…）我可以直接在
// 里面配置，一键更新 env」
//
// ── 白名单，不是黑名单 ──
//
// .env 里七十多个变量，这个页面只改下面 FIELDS 里列出的那几个。
// 其他一概不碰。
//
// 特别是这几个永远不进白名单：
//   VESPER_BASIC_USER / VESPER_BASIC_PASS——网页能改登录密码是个坏主意：
//     改错了你就进不来了，而且这个页面本身靠它护着
//   GATEWAY_API_KEY——改了聊天客户端立刻连不上
//   REPORT_STATUS_API_KEY——改了 iOS 快捷指令上报就断了
//   VAPID_*——改了所有订阅全废，要重新开一遍通知
//   各种 _TOKEN / _SECRET
//
// ── 改完要重启谁 ──
//
// 这些变量是进程启动时读的，改 .env 不会自己生效。所以每个变量标了
// 该重启哪几个进程，页面上就能显示「保存并重启 phosphor」这种具体按钮。
//
// pm2 restart 必须带 --update-env，不带的话 .env 改了不生效——
// 和 Proof 那两个 TTL 是同一类坑，踩过不止一次。
//
// ── 写盘怎么不弄坏 ──
//
// 先写 .env.tmp 再 rename：rename 在同一个文件系统上是原子的，
// 写一半掉电也不会留下一个残的 .env。
//
// 每次改之前备份到 .env.bak.<时间戳>，只留最近十份。
//
// 注释、空行、没动的变量全部原样保留：.env 里那些注释是几个月踩坑
// 踩出来的，不能被一次网页保存洗掉。

import fs from 'fs';
import path from 'path';

const ENV_FILE = path.join(process.cwd(), '.env');
const KEEP_BACKUPS = 10;

// 哪些能改。
// kind 决定输入框：secret 不回显原文、空着就是不改；
// url / text / number 是普通输入；select 给几个固定选项。
// restart 是改完该重启哪几个进程。
export const FIELDS = {
  // 主模型：聊天那条线
  CLIENT_UPSTREAM_BASE_URL: { kind: 'url', restart: ['vesper-gateway'], hint: '只写域名，不带 /v1' },
  CLIENT_UPSTREAM_API_KEY: { kind: 'secret', restart: ['vesper-gateway'] },
  CLIENT_UPSTREAM_MODEL: { kind: 'text', restart: ['vesper-gateway'] },

  // 主模型：他醒来做决定那条线
  DECIDE_UPSTREAM_BASE_URL: { kind: 'url', restart: ['vesper-gateway'], hint: '只写域名，不带 /v1' },
  DECIDE_UPSTREAM_API_KEY: { kind: 'secret', restart: ['vesper-gateway'] },
  DECIDE_UPSTREAM_MODEL: { kind: 'text', restart: ['vesper-gateway'] },

  // 两条线路的 key 都空着时用这个兜底
  DEEPSEEK_API_KEY: { kind: 'secret', restart: ['vesper-gateway', 'phosphor'], hint: '上面两条线路的 key 空着时用这个' },

  // 做梦那条线。不填就跟着下面的 LLM_*
  DREAM_LLM_BASE_URL: { kind: 'url', restart: ['phosphor'], hint: '要完整地址，带 /v1/chat/completions' },
  DREAM_LLM_API_KEY: { kind: 'secret', restart: ['phosphor'] },
  DREAM_LLM_MODEL: { kind: 'text', restart: ['phosphor'] },

  // 零散用途的兜底线路
  LLM_BASE_URL: { kind: 'url', restart: ['phosphor'], hint: '要完整地址，带 /v1/chat/completions' },
  LLM_API_KEY: { kind: 'secret', restart: ['phosphor'] },
  LLM_MODEL: { kind: 'text', restart: ['phosphor'] },

  // 功能模型：生图
  IMAGE_API_URL: { kind: 'url', restart: ['phosphor'], hint: '完整地址，带 /v1/images/generations' },
  IMAGE_API_KEY: { kind: 'secret', restart: ['phosphor'] },
  IMAGE_MODEL: { kind: 'text', restart: ['phosphor'] },
  IMAGE_API_FORMAT: { kind: 'select', options: ['openai', 'siliconflow'], restart: ['phosphor'] },
  IMAGE_SIZE: {
    kind: 'select',
    options: ['1024x1024', '1024x1536', '1536x1024', '768x1024', '1024x768'],
    restart: ['phosphor'],
  },
  IMAGE_TIMEOUT_MS: { kind: 'number', restart: ['phosphor'] },

  // 功能模型：语音
  ELEVENLABS_API_KEY: { kind: 'secret', restart: ['phosphor'] },
  ELEVENLABS_VOICE_ID: { kind: 'text', restart: ['phosphor'], hint: '音色 id，在它后台 Voice Library 复制' },
  ELEVENLABS_MODEL: { kind: 'text', restart: ['phosphor'], hint: '不填是 eleven_v3' },
};

// 哪些属于哪一组。页面按这个分区，和她图里那个结构一致
export const GROUPS = [
  {
    id: 'chat',
    name: '聊天',
    what: '你在聊天里跟他说话走这条线',
    keys: ['CLIENT_UPSTREAM_BASE_URL', 'CLIENT_UPSTREAM_MODEL', 'CLIENT_UPSTREAM_API_KEY'],
  },
  {
    id: 'decide',
    name: '醒来做决定',
    what: '他自己醒来、选这次做什么走这条线',
    keys: ['DECIDE_UPSTREAM_BASE_URL', 'DECIDE_UPSTREAM_MODEL', 'DECIDE_UPSTREAM_API_KEY'],
  },
  {
    id: 'dream',
    name: '做梦',
    what: '夜里造梦走这条。空着就跟着下面那条兜底线',
    keys: ['DREAM_LLM_BASE_URL', 'DREAM_LLM_MODEL', 'DREAM_LLM_API_KEY'],
  },
  {
    id: 'fallback',
    name: '兜底线路',
    what: '没单独配的那些零散用途走它',
    keys: ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY', 'DEEPSEEK_API_KEY'],
  },
  {
    id: 'image',
    name: '生图',
    what: '动态配图走哪条供应商线路',
    keys: ['IMAGE_API_URL', 'IMAGE_MODEL', 'IMAGE_API_KEY', 'IMAGE_API_FORMAT', 'IMAGE_SIZE', 'IMAGE_TIMEOUT_MS'],
  },
  {
    id: 'voice',
    name: '语音',
    what: '动态配音走 ElevenLabs',
    keys: ['ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID', 'ELEVENLABS_MODEL'],
  },
];

// 这几个即使哪天有人把它们写进 FIELDS 也不改。双重保险。
const NEVER = new Set([
  'VESPER_BASIC_USER',
  'VESPER_BASIC_PASS',
  'VESPER_SESSION_SECRET',
  'GATEWAY_API_KEY',
  'REPORT_STATUS_API_KEY',
  'VAPID_PUBLIC_KEY',
  'VAPID_PRIVATE_KEY',
  'VAPID_SUBJECT',
]);

export function canEdit(key) {
  return (
    Object.prototype.hasOwnProperty.call(FIELDS, key) &&
    !NEVER.has(key) &&
    !/_TOKEN$|_SECRET$|_PASS$|_USER$/.test(key)
  );
}

// 读 .env 原文。没文件返回空串，不抛——页面还要能打开
function readRaw() {
  try {
    return fs.readFileSync(ENV_FILE, 'utf8');
  } catch {
    return '';
  }
}

// 解成 { 变量名: 值 }。只认 KEY=value，注释和空行跳过。
// 值两边的引号脱掉：.env 里两种写法都有
function parse(raw) {
  const out = {};
  for (const line of String(raw).split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

// 页面要显示的当前值。
// secret 不往前端发原文，只说有没有、最后四位是什么——
// 那四位是为了换 key 之后能看出真的换成了。
export function readFields() {
  const env = parse(readRaw());
  const out = {};
  for (const [key, spec] of Object.entries(FIELDS)) {
    const raw = env[key] ?? '';
    out[key] =
      spec.kind === 'secret'
        ? { set: Boolean(raw), tail: raw ? raw.slice(-4) : '', value: '' }
        : { set: Boolean(raw), value: raw };
  }
  return out;
}

// 读 .env 里当前生效的原文，包括 key 原文。
//
// 和 readFields 的分工：readFields 是发给页面的，所以故意不给 key 原文；
// 这个函数只在服务器内部用——存线路预设时要把「现在这套」整组存下来，
// 不带 key 的预设换回去一定 401，等于没存。
//
// 返回值不要直接 res.json 出去。
//
// 只返回真正有值的字段：空值不进预设，不然「这一项当时是空的」和
// 「这一项没记」就分不开了。
export function readRawValues(keys) {
  const env = parse(readRaw());
  const out = {};
  for (const k of keys ?? Object.keys(FIELDS)) {
    if (!Object.prototype.hasOwnProperty.call(FIELDS, k)) continue;
    const v = String(env[k] ?? '').trim();
    if (v) out[k] = v;
  }
  return out;
}

// 这次改完该重启哪几个进程
export function restartTargets(keys) {
  const set = new Set();
  for (const k of keys) {
    for (const p of FIELDS[k]?.restart ?? []) set.add(p);
  }
  return [...set];
}

// 值里有空格、# 或引号时加双引号：dotenv 认这个，
// 不加的话 # 后面的东西会被当成注释切掉。
function quote(v) {
  const s = String(v ?? '');
  if (!s) return '';
  return /[\s#"']/.test(s) ? `"${s.replace(/"/g, '\\"')}"` : s;
}

// 按行改。没动的行原样不动，没出现过的变量追到最后。
function applyLines(raw, patch) {
  const keys = new Set(Object.keys(patch));
  const lines = String(raw).split('\n');
  const seen = new Set();

  const out = lines.map((line) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return line;
    const eq = t.indexOf('=');
    if (eq <= 0) return line;
    const k = t.slice(0, eq).trim();
    if (!keys.has(k)) return line;
    seen.add(k);
    return `${k}=${quote(patch[k])}`;
  });

  const missing = [...keys].filter((k) => !seen.has(k));
  if (missing.length) {
    if (out.length && out[out.length - 1].trim()) out.push('');
    out.push('# 下面这几行是从「模型 · 连接 · 通知」那个页面加的');
    for (const k of missing) out.push(`${k}=${quote(patch[k])}`);
  }
  return out.join('\n');
}

// 备份。只留最近 KEEP_BACKUPS 份，不然这个目录会被 .env.bak.* 塞满
function backup() {
  const dir = path.dirname(ENV_FILE);
  const name = `.env.bak.${Date.now()}`;
  try {
    fs.copyFileSync(ENV_FILE, path.join(dir, name));
  } catch (err) {
    // 没 .env 也能写，备份失败不阻止保存
    console.warn('env: 备份没成', err.message);
    return '';
  }
  try {
    const olds = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith('.env.bak.'))
      .sort();
    while (olds.length > KEEP_BACKUPS) {
      fs.rmSync(path.join(dir, olds.shift()), { force: true });
    }
  } catch {}
  return name;
}

// 写回去。
//
// patch 里不在白名单的 key 直接拒，不是默默跳过——
// 静静忽略会让人以为保存成功了。
//
// secret 传空字符串 = 不改（页面上那个框本来就是空的）。
// 要清空得传 __clear__——得是个明确的动作，不能是「没填」。
export function writeFields(patch) {
  const bad = Object.keys(patch).filter((k) => !canEdit(k));
  if (bad.length) return { error: `这几个不允许从网页改：${bad.join('、')}` };

  const raw = readRaw();
  const now = parse(raw);

  const final = {};
  for (const [k, v] of Object.entries(patch)) {
    const spec = FIELDS[k];
    const s = String(v ?? '').trim();
    if (spec.kind === 'secret' && !s) continue;
    final[k] = s === '__clear__' ? '' : s;
  }

  const changed = Object.keys(final).filter((k) => (now[k] ?? '') !== final[k]);
  if (!changed.length) return { ok: true, changed: [], restart: [], note: '没什么改动' };

  const bak = backup();
  const next = applyLines(raw, final);

  // 先写 tmp 再 rename：rename 是原子的，写一半掉电不会留下残 .env
  const tmp = `${ENV_FILE}.tmp`;
  try {
    fs.writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(tmp, ENV_FILE);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    console.error('env: 写不进去', err.message);
    return { error: `写不进去：${err.message}` };
  }

  console.log(`env: 改了 ${changed.join('、')}${bak ? `（备份 ${bak}）` : ''}`);
  return { ok: true, changed, restart: restartTargets(changed), backup: bak };
}
