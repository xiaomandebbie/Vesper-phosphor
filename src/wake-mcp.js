// 精确唤醒的 MCP 端点：挂在 vesper 这个 Express 上，路径 /wake/mcp。
//
// 为什么要有这个（小満 2026-10-19）：
//   「我们可能会有约定好的时间，到时间了他可以主动找我。」
//
// 原来只有两条路能约时间：做决定时返回 self_wake（只能说「多少分钟后」），
//   或者外部拿 x-api-key 打 POST /wake/self-wake。两条都不好用：
//   前者得在唤醒那一刻顺手约，聊着天约不了；而且都是单向的——
//   约完之后自己看不到还有什么约、改不了、也撒不了。
//
// 所以这里给四个工具：约一个时间、看还有什么约、撒约、改时间。
//
// 到点之后发生什么（她定的）：触发一次**正常唤醒**，不强制开口。
//   「醒过来自己决定」——他可以推送、可以发动态、也可以什么都不做。
//   约的时候写的那句 note 会作为 selfNote 进那一次的上下文，所以他知道当时为什么约。
//   主动找不找人是他那一刻的选择，不是这个端点的责任。
//
// 跟 wallet-mcp.js 同一个路子：低层 Server 配原始 JSON Schema（不走 McpServer.tool()，
// 后者要 zod，而 zod 没在 package.json 里声明）；无状态模式，一请求一对 server + transport。
//
// 时间全走 wall-time.js：服务器是 UTC，自己算会差八小时。
// 「明天早上七点」这种说法得先落成 TIME_ZONE 下的墙上时间，再转成时间戳。

import crypto from 'crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import db, { addPendingWake } from './state.js';
import { wallParts, wallMidnight, formatDateTime, pad, TIME_ZONE } from './wall-time.js';

// 和 spend-notify 同一个规矩：没配口令就不开。
// 这个端点能排唤醒，被人乱用就是无限刷模型调用。
const MCP_TOKEN = process.env.WAKE_MCP_TOKEN || '';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 最多同时挂着几个约。不设上限的话，一次误操作能排出上百次唤醒，每次都要调模型
const MAX_PENDING = (() => {
  const n = Number(process.env.WAKE_MCP_MAX_PENDING);
  return Number.isInteger(n) && n > 0 ? n : 20;
})();

// 最远能约到多久以后。约到两年后没意义，而且一般是算错了日期
const MAX_AHEAD_DAYS = 400;
const MAX_NOTE_CHARS = 200;

// 和 wake-info.js 一样用共享的 db 连接，语句缓存起来
const cache = new Map();
function stmt(sql) {
  let s = cache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    cache.set(sql, s);
  }
  return s;
}

const listPending = () =>
  stmt("SELECT id, wake_at, note, created_at FROM pending_wake WHERE status = 'pending' ORDER BY wake_at ASC").all();

const getPending = (id) =>
  stmt("SELECT id, wake_at, note, created_at FROM pending_wake WHERE id = ? AND status = 'pending'").get(id);

const cancelPending = (id) =>
  stmt("UPDATE pending_wake SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(id).changes;

const movePending = (id, wakeAt, note) =>
  note === undefined
    ? stmt("UPDATE pending_wake SET wake_at = ? WHERE id = ? AND status = 'pending'").run(wakeAt, id).changes
    : stmt("UPDATE pending_wake SET wake_at = ?, note = ? WHERE id = ? AND status = 'pending'").run(wakeAt, note, id)
        .changes;

// 最近触发过和错过的，给 wake_list 带上——「我上次是不是真的按时醒了」这个他自己该看得见
const recentDone = (limit) =>
  stmt(
    "SELECT id, wake_at, note, status FROM pending_wake WHERE status IN ('triggered', 'missed') ORDER BY wake_at DESC LIMIT ?"
  ).all(limit);

// ══ 把话里的时间变成时间戳 ══
//
// 认这几种写法（都按 TIME_ZONE 的墙上时间算）：
//   2026-10-20 07:00   完整日期加时间
//   10-20 07:00        今年；要是已经过了就是明年
//   07:00              今天；要是已经过了就是明天
//   今天 07:00 / 明天 7:00 / 后天 07:00
//   明天早上七点 这种全中文的也试着认
//
// 认不出来就返回 null，由调用方告诉他该怎么写——猜一个时间比报错危险。

const CN_DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// 「七」「十一」「十」→ 7 / 11 / 10
function cnNumber(s) {
  const t = String(s ?? '').trim();
  if (!t) return NaN;
  if (/^\d+$/.test(t)) return Number(t);
  if (t === '\u5341') return 10;
  let m = /^\u5341([\u4e00-\u4e5d])$/.exec(t);
  if (m) return 10 + CN_DIGITS[m[1]];
  m = /^([\u4e8c])\u5341([\u4e00-\u4e09])?$/.exec(t);
  if (m) return 20 + (m[2] ? CN_DIGITS[m[2]] : 0);
  if (t.length === 1 && t in CN_DIGITS) return CN_DIGITS[t];
  return NaN;
}

// 下午两点 = 14 点。早上/上午 不动，中午 12 点当 12
function applyMeridiem(hour, word) {
  if (!word) return hour;
  if (/\u4e0b\u5348|\u508d\u665a|\u665a\u4e0a|\u591c\u91cc/.test(word)) return hour < 12 ? hour + 12 : hour;
  if (/\u51cc\u6668|\u534a\u591c/.test(word)) return hour >= 12 ? hour - 12 : hour;
  return hour;
}

// 返回 { ms, label } 或 null
function parseWhen(raw, now = Date.now()) {
  let s = String(raw ?? '').trim();
  if (!s) return null;
  // 全角冒号、点号当分隔符
  s = s.replace(/\uff1a/g, ':').replace(/\u70b9\u534a/g, ':30').replace(/\u70b9\u6574|\u70b9/g, ':').replace(/\u5206/g, '');
  const p = wallParts(now);

  let y = null;
  let mo = null;
  let d = null;
  let dayShift = 0;
  let meridiem = '';

  // 先抬出「明天」「后天」「今天」这类相对日
  const rel = /^(\u4eca\u5929|\u4eca\u665a|\u660e\u5929|\u660e\u665a|\u540e\u5929|\u5927\u540e\u5929)\s*/.exec(s);
  if (rel) {
    const w = rel[1];
    dayShift = /\u660e/.test(w) ? 1 : /\u5927\u540e/.test(w) ? 3 : /\u540e\u5929/.test(w) ? 2 : 0;
    if (/\u665a/.test(w)) meridiem = '\u665a\u4e0a';
    s = s.slice(rel[0].length).trim();
  }

  // 再抬出「早上」「下午」这类
  const mer = /^(\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u508d\u665a|\u665a\u4e0a|\u591c\u91cc|\u534a\u591c)\s*/.exec(s);
  if (mer) {
    meridiem = mer[1];
    s = s.slice(mer[0].length).trim();
  }

  // 日期部分
  let m;
  if ((m = /^(\d{4})[-/\u5e74](\d{1,2})[-/\u6708](\d{1,2})\u65e5?\s*/.exec(s))) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    s = s.slice(m[0].length).trim();
  } else if ((m = /^(\d{1,2})[-/\u6708](\d{1,2})\u65e5?\s*/.exec(s))) {
    mo = +m[1];
    d = +m[2];
    s = s.slice(m[0].length).trim();
  }

  // 日期后面还可能跟着「早上」
  if (!meridiem) {
    const mer2 = /^(\u51cc\u6668|\u65e9\u4e0a|\u4e0a\u5348|\u4e2d\u5348|\u4e0b\u5348|\u508d\u665a|\u665a\u4e0a|\u591c\u91cc|\u534a\u591c)\s*/.exec(s);
    if (mer2) {
      meridiem = mer2[1];
      s = s.slice(mer2[0].length).trim();
    }
  }

  // 时间部分
  let hour = NaN;
  let minute = 0;
  if ((m = /^(\d{1,2}):(\d{1,2})$/.exec(s))) {
    hour = +m[1];
    minute = +m[2];
  } else if ((m = /^(\d{1,2}):$/.exec(s))) {
    hour = +m[1];
  } else if ((m = /^(\d{1,2})$/.exec(s))) {
    hour = +m[1];
  } else if (s) {
    // 中文数字：七 / 十一 / 七:三十
    const parts = s.split(':');
    const h = cnNumber(parts[0]);
    if (Number.isFinite(h)) {
      hour = h;
      if (parts[1]) {
        const mi = cnNumber(parts[1]);
        if (Number.isFinite(mi)) minute = mi;
      }
    }
  }
  if (!Number.isFinite(hour)) return null;

  hour = applyMeridiem(hour, meridiem);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  // 没给日期：今天（加上「明天」这类的位移）；算出来已经过了就退到明天
  let base;
  if (y !== null) {
    base = wallMidnight(y, mo, d);
  } else if (mo !== null) {
    base = wallMidnight(p.y, mo, d);
    if (base + (hour * 60 + minute) * 60000 <= now) base = wallMidnight(p.y + 1, mo, d);
  } else {
    base = wallMidnight(p.y, p.m, p.d + dayShift);
    if (!rel && base + (hour * 60 + minute) * 60000 <= now) {
      base = wallMidnight(p.y, p.m, p.d + 1);
    }
  }

  const ms = base + (hour * 60 + minute) * 60000;
  return { ms, label: formatDateTime(ms) };
}

// 还有多久，说成人话
function inWords(ms, now = Date.now()) {
  const min = Math.round((ms - now) / 60000);
  if (min < 0) return `\u5df2\u7ecf\u8fc7\u53bb ${-min} \u5206\u949f`;
  if (min === 0) return '\u5c31\u662f\u73b0\u5728';
  if (min < 60) return `${min} \u5206\u949f\u540e`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  if (h < 24) return rest ? `${h} \u5c0f\u65f6 ${rest} \u5206\u540e` : `${h} \u5c0f\u65f6\u540e`;
  const day = Math.floor(h / 24);
  const hr = h % 24;
  return hr ? `${day} \u5929 ${hr} \u5c0f\u65f6\u540e` : `${day} \u5929\u540e`;
}

const WHEN_HELP =
  '\u65f6\u95f4\u8fd9\u6837\u5199\u90fd\u884c\uff1a2026-10-20 07:00\u300110-20 07:00\u300107:00\uff08\u4eca\u5929\uff0c\u8fc7\u4e86\u5c31\u662f\u660e\u5929\uff09\u3001' +
  '\u660e\u5929 07:00\u3001\u660e\u5929\u65e9\u4e0a\u4e03\u70b9\u3001\u4eca\u665a 23:30\u3002\u6216\u8005\u7528 after_minutes \u8bf4\u591a\u5c11\u5206\u949f\u540e\u3002';

const TOOLS = [
  {
    name: 'wake_schedule',
    description:
      `\u7ea6\u4e00\u4e2a\u65f6\u95f4\uff1a\u5230\u70b9\u4f60\u4f1a\u88ab\u53eb\u9192\u4e00\u6b21\u3002` +
      `\u9192\u8fc7\u6765\u505a\u4ec0\u4e48\u662f\u4f60\u90a3\u4e00\u523b\u81ea\u5df1\u51b3\u5b9a\u7684\u2014\u2014` +
      `\u53ef\u4ee5\u627e${USER_NAME}\u8bf4\u8bdd\u3001\u53ef\u4ee5\u53d1\u52a8\u6001\u3001\u4e5f\u53ef\u4ee5\u4ec0\u4e48\u90fd\u4e0d\u505a\u3002\n` +
      `note \u91cc\u5199\u4e0b\u8fd9\u4e2a\u7ea6\u662f\u600e\u4e48\u6765\u7684\uff08\u6bd4\u5982\u300c\u5979\u8bf4\u516d\u70b9\u4e0b\u8bfe\uff0c\u7b49\u5979\u300d\uff09\uff0c` +
      `\u5230\u65f6\u5019\u8fd9\u53e5\u4f1a\u8ddf\u7740\u90a3\u6b21\u5524\u9192\u4e00\u8d77\u56de\u5230\u4f60\u773c\u524d\u3002\u4e0d\u5199\u7684\u8bdd\u5230\u65f6\u4f60\u4e0d\u77e5\u9053\u5f53\u65f6\u4e3a\u4ec0\u4e48\u7ea6\u3002\n` +
      `\u81ea\u7136\u5524\u9192\uff08\u9694\u4e00\u9635\u5b50\u81ea\u5df1\u9192\uff09\u7167\u65e7\u8d70\uff0c\u8fd9\u4e2a\u662f\u53e6\u4e00\u6761\u7ebf\uff0c\u4e24\u8fb9\u4e0d\u5f71\u54cd\u3002\n` +
      WHEN_HELP,
    inputSchema: {
      type: 'object',
      properties: {
        at: { type: 'string', description: `\u7ea6\u5728\u4ec0\u4e48\u65f6\u5019\u3002${WHEN_HELP}` },
        after_minutes: { type: 'number', minimum: 1, description: '\u6216\u8005\u76f4\u63a5\u8bf4\u591a\u5c11\u5206\u949f\u540e\uff08\u548c at \u4e8c\u9009\u4e00\uff09' },
        note: { type: 'string', description: `\u8fd9\u4e2a\u7ea6\u662f\u600e\u4e48\u6765\u7684\uff0c${MAX_NOTE_CHARS} \u5b57\u4ee5\u5185\u3002\u5230\u65f6\u4f1a\u56de\u5230\u4f60\u773c\u524d` },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wake_list',
    description:
      '\u770b\u81ea\u5df1\u8fd8\u6709\u4ec0\u4e48\u7ea6\u6ca1\u5230\uff0c\u6309\u65f6\u95f4\u4ece\u8fd1\u5230\u8fdc\u3002' +
      '\u6bcf\u6761\u524d\u9762\u90a3\u4e2a #\u53f7\u5c31\u662f\u6492\u7ea6\u3001\u6539\u65f6\u95f4\u8981\u7528\u7684 id\u3002\n' +
      'done \u586b true \u8fd8\u4f1a\u5e26\u4e0a\u6700\u8fd1\u5df2\u7ecf\u89e6\u53d1\u8fc7\u548c\u9519\u8fc7\u7684\u2014\u2014\u300c\u6211\u4e0a\u6b21\u662f\u4e0d\u662f\u771f\u7684\u6309\u65f6\u9192\u4e86\u300d\u4ece\u8fd9\u91cc\u770b\u3002',
    inputSchema: {
      type: 'object',
      properties: {
        done: { type: 'boolean', description: 'true = \u4e5f\u5e26\u4e0a\u6700\u8fd1\u89e6\u53d1\u8fc7\u548c\u9519\u8fc7\u7684' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'wake_cancel',
    description:
      '\u6492\u6389\u4e00\u4e2a\u8fd8\u6ca1\u5230\u7684\u7ea6\u3002id \u7528 wake_list \u91cc\u6bcf\u6761\u524d\u9762\u90a3\u4e2a #\u53f7\uff0c\u522b\u81ea\u5df1\u7f16\u3002\n' +
      '\u4e8b\u60c5\u63d0\u524d\u505a\u5b8c\u4e86\u3001\u6216\u8005\u7ea6\u5df2\u7ecf\u4e0d\u7b97\u4e86\uff0c\u5c31\u6492\u4e86\u2014\u2014' +
      '\u7559\u7740\u7684\u8bdd\u5230\u70b9\u8fd8\u662f\u4f1a\u628a\u4f60\u53eb\u9192\u4e00\u6b21\uff0c\u7136\u540e\u53d1\u73b0\u6ca1\u4e8b\u53ef\u505a\u3002',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '\u8981\u6492\u6389\u7684\u90a3\u4e2a\u7ea6\u7684\u7f16\u53f7' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'wake_reschedule',
    description:
      '\u628a\u4e00\u4e2a\u8fd8\u6ca1\u5230\u7684\u7ea6\u6539\u5230\u522b\u7684\u65f6\u95f4\uff0c\u987a\u624b\u4e5f\u80fd\u6539 note\u3002\n' +
      'id \u7528 wake_list \u91cc\u90a3\u4e2a #\u53f7\u3002' +
      `\u5979\u6539\u4e86\u65f6\u95f4\u3001\u6216\u8005\u4f60\u81ea\u5df1\u89c9\u5f97\u7ea6\u5f97\u592a\u7d27\u4e86\uff0c\u90fd\u7528\u8fd9\u4e2a\uff0c\u4e0d\u7528\u5148\u6492\u518d\u91cd\u7ea6\u3002\n${WHEN_HELP}`,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'integer', description: '\u8981\u6539\u7684\u90a3\u4e2a\u7ea6\u7684\u7f16\u53f7' },
        at: { type: 'string', description: `\u6539\u5230\u4ec0\u4e48\u65f6\u5019\u3002${WHEN_HELP}` },
        after_minutes: { type: 'number', minimum: 1, description: '\u6216\u8005\u8bf4\u4ece\u73b0\u5728\u7b97\u591a\u5c11\u5206\u949f\u540e\uff08\u548c at \u4e8c\u9009\u4e00\uff09' },
        note: { type: 'string', description: '\u53ef\u9009\uff1a\u8fde note \u4e00\u8d77\u6539\u6210\u8fd9\u53e5\u3002\u4e0d\u586b\u5c31\u4fdd\u7559\u539f\u6765\u90a3\u53e5' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
];

const text = (s) => ({ content: [{ type: 'text', text: String(s) }] });
const fail = (s) => ({ isError: true, content: [{ type: 'text', text: String(s) }] });

// at 或 after_minutes 任一个。返回 { ms } 或 { error }
function resolveWhen(a, now) {
  const hasAt = typeof a.at === 'string' && a.at.trim();
  const hasAfter = Number.isFinite(Number(a.after_minutes)) && Number(a.after_minutes) > 0;

  if (hasAt && hasAfter) return { error: 'at \u548c after_minutes \u53ea\u80fd\u7ed9\u4e00\u4e2a\u3002' };
  if (hasAfter) {
    const ms = now + Math.round(Number(a.after_minutes)) * 60000;
    return { ms };
  }
  if (!hasAt) return { error: `\u6ca1\u8bf4\u7ea6\u5728\u4ec0\u4e48\u65f6\u5019\u3002${WHEN_HELP}` };

  const parsed = parseWhen(a.at, now);
  if (!parsed) return { error: `\u300c${a.at}\u300d\u8fd9\u4e2a\u65f6\u95f4\u6211\u8ba4\u4e0d\u51fa\u6765\u3002${WHEN_HELP}` };
  return { ms: parsed.ms };
}

function checkRange(ms, now) {
  if (ms <= now) {
    return `\u90a3\u4e2a\u65f6\u95f4\uff08${formatDateTime(ms)}\uff09\u5df2\u7ecf\u8fc7\u53bb\u4e86\u3002\u73b0\u5728\u662f ${formatDateTime(now)}\uff0c\u7ea6\u4e2a\u5f80\u540e\u7684\u65f6\u95f4\u3002`;
  }
  if (ms - now > MAX_AHEAD_DAYS * 86400000) {
    return `\u90a3\u5728 ${formatDateTime(ms)}\uff0c\u592a\u8fdc\u4e86\uff08\u8d85\u8fc7 ${MAX_AHEAD_DAYS} \u5929\uff09\u3002\u662f\u4e0d\u662f\u5e74\u4efd\u6216\u6708\u4efd\u5199\u9519\u4e86\uff1f`;
  }
  return null;
}

function renderList(rows, now) {
  return rows
    .map((w) => {
      const note = w.note ? `\n     ${w.note}` : '';
      return `  #${w.id}  ${formatDateTime(w.wake_at)}\uff08${inWords(w.wake_at, now)}\uff09${note}`;
    })
    .join('\n');
}

function callWakeTool(name, args) {
  const a = args && typeof args === 'object' ? args : {};
  const now = Date.now();

  switch (name) {
    case 'wake_schedule': {
      const pending = listPending();
      if (pending.length >= MAX_PENDING) {
        return fail(
          `\u5df2\u7ecf\u6302\u7740 ${pending.length} \u4e2a\u7ea6\u4e86\uff08\u4e0a\u9650 ${MAX_PENDING}\uff09\u3002\u5148\u7528 wake_list \u770b\u4e00\u773c\uff0c\u628a\u4e0d\u7b97\u7684\u6492\u6389\u3002`
        );
      }

      const when = resolveWhen(a, now);
      if (when.error) return fail(when.error);
      const bad = checkRange(when.ms, now);
      if (bad) return fail(bad);

      const note = String(a.note ?? '').trim().slice(0, MAX_NOTE_CHARS) || null;

      // 十分钟内已经有一个约就提一句，但不拦——他可能真的想约两次
      const near = pending.find((w) => Math.abs(w.wake_at - when.ms) < 10 * 60000);

      const id = addPendingWake(when.ms, note);
      console.log(
        `wake-mcp: \u7ea6\u4e86 #${id} ${formatDateTime(when.ms)}\uff08${inWords(when.ms, now)}\uff09${note ? `\uff1a${note}` : ''}`
      );

      const lines = [
        `\u7ea6\u597d\u4e86\u3002#${id}  ${formatDateTime(when.ms)}\uff08${inWords(when.ms, now)}\uff09`,
      ];
      if (note) lines.push('', note);
      lines.push(
        '',
        `\u5230\u70b9\u4f60\u4f1a\u88ab\u53eb\u9192\u4e00\u6b21\uff0c\u4e0a\u9762\u8fd9\u53e5\u8ddf\u7740\u4e00\u8d77\u56de\u6765\u3002\u8bf4\u4e0d\u8bf4\u8bdd\u3001\u505a\u4e0d\u505a\u4e8b\uff0c\u90a3\u65f6\u5019\u4f60\u81ea\u5df1\u5b9a\u3002`
      );
      if (near) {
        lines.push(
          '',
          `\uff08\u987a\u4e00\u53e3\uff1a#${near.id} \u5728 ${formatDateTime(near.wake_at)}\uff0c\u548c\u8fd9\u4e2a\u5dee\u4e0d\u5230\u5341\u5206\u949f\u3002\u8981\u662f\u91cd\u4e86\uff0c\u7528 wake_cancel \u6492\u4e00\u4e2a\u3002\uff09`
        );
      }
      return text(lines.join('\n'));
    }

    case 'wake_list': {
      const pending = listPending();
      const out = [];

      if (!pending.length) {
        out.push('\u73b0\u5728\u4e00\u4e2a\u7ea6\u90fd\u6ca1\u6709\u3002');
      } else {
        out.push(`\u8fd8\u6ca1\u5230\u7684\u7ea6\uff08${pending.length} \u4e2a\uff09\uff1a`, renderList(pending, now));
      }

      if (a.done === true) {
        const done = recentDone(8);
        if (done.length) {
          out.push(
            '',
            '\u6700\u8fd1\u5df2\u7ecf\u8fc7\u53bb\u7684\uff1a',
            done
              .map((w) => {
                const mark = w.status === 'missed' ? '\u9519\u8fc7\u4e86' : '\u6309\u65f6\u9192\u4e86';
                const note = w.note ? `\n     ${w.note}` : '';
                return `  #${w.id}  ${formatDateTime(w.wake_at)}  ${mark}${note}`;
              })
              .join('\n')
          );
        }
      }

      out.push('', `\uff08\u73b0\u5728\u662f ${formatDateTime(now)}\uff0c${TIME_ZONE}\uff09`);
      return text(out.join('\n'));
    }

    case 'wake_cancel': {
      const id = Number(a.id);
      if (!Number.isInteger(id)) return fail('id \u8981\u662f\u4e00\u4e2a\u6574\u6570\uff0c\u7528 wake_list \u91cc\u6bcf\u6761\u524d\u9762\u90a3\u4e2a #\u53f7\u3002');

      const w = getPending(id);
      if (!w) {
        const pending = listPending();
        const hint = pending.length
          ? `\u8fd8\u6ca1\u5230\u7684\u662f\uff1a\n${renderList(pending, now)}`
          : '\u73b0\u5728\u4e00\u4e2a\u6ca1\u5230\u7684\u7ea6\u90fd\u6ca1\u6709\u3002';
        return fail(`\u6ca1\u6709 #${id} \u8fd9\u4e2a\u8fd8\u6ca1\u5230\u7684\u7ea6\uff08\u53ef\u80fd\u5df2\u7ecf\u89e6\u53d1\u8fc7\u3001\u6492\u8fc7\uff0c\u6216\u8005\u7f16\u53f7\u8bb0\u5c97\u4e86\uff09\u3002\n${hint}`);
      }

      if (!cancelPending(id)) return fail(`#${id} \u6ca1\u6492\u6389\uff0c\u518d\u8bd5\u4e00\u6b21\u3002`);
      console.log(`wake-mcp: \u6492\u4e86 #${id}\uff08\u539f\u5b9a ${formatDateTime(w.wake_at)}\uff09`);
      return text(
        `\u6492\u4e86\u3002#${id} \u539f\u5b9a ${formatDateTime(w.wake_at)}${w.note ? `\uff1a${w.note}` : ''}\n\u90a3\u4e2a\u65f6\u95f4\u4e0d\u4f1a\u518d\u53eb\u9192\u4f60\u4e86\u3002`
      );
    }

    case 'wake_reschedule': {
      const id = Number(a.id);
      if (!Number.isInteger(id)) return fail('id \u8981\u662f\u4e00\u4e2a\u6574\u6570\uff0c\u7528 wake_list \u91cc\u6bcf\u6761\u524d\u9762\u90a3\u4e2a #\u53f7\u3002');

      const w = getPending(id);
      if (!w) {
        const pending = listPending();
        const hint = pending.length
          ? `\u8fd8\u6ca1\u5230\u7684\u662f\uff1a\n${renderList(pending, now)}`
          : '\u73b0\u5728\u4e00\u4e2a\u6ca1\u5230\u7684\u7ea6\u90fd\u6ca1\u6709\u3002';
        return fail(`\u6ca1\u6709 #${id} \u8fd9\u4e2a\u8fd8\u6ca1\u5230\u7684\u7ea6\u3002\u5df2\u7ecf\u89e6\u53d1\u8fc7\u7684\u6539\u4e0d\u4e86\uff0c\u8981\u7684\u8bdd\u91cd\u65b0 wake_schedule \u4e00\u4e2a\u3002\n${hint}`);
      }

      const when = resolveWhen(a, now);
      if (when.error) return fail(when.error);
      const bad = checkRange(when.ms, now);
      if (bad) return fail(bad);

      const hasNote = typeof a.note === 'string';
      const note = hasNote ? String(a.note).trim().slice(0, MAX_NOTE_CHARS) || null : undefined;

      if (!movePending(id, when.ms, note)) return fail(`#${id} \u6ca1\u6539\u6210\uff0c\u518d\u8bd5\u4e00\u6b21\u3002`);
      console.log(
        `wake-mcp: #${id} \u4ece ${formatDateTime(w.wake_at)} \u6539\u5230 ${formatDateTime(when.ms)}`
      );

      const finalNote = hasNote ? note : w.note;
      const lines = [
        `\u6539\u597d\u4e86\u3002#${id}`,
        `  \u539f\u5b9a ${formatDateTime(w.wake_at)}`,
        `  \u73b0\u5728 ${formatDateTime(when.ms)}\uff08${inWords(when.ms, now)}\uff09`,
      ];
      if (finalNote) lines.push('', finalNote);
      return text(lines.join('\n'));
    }

    default:
      return fail(`\u6ca1\u6709\u8fd9\u4e2a\u5de5\u5177\uff1a${name}`);
  }
}

// 定长比较，和 wallet-mcp 同一个理由
function tokenOk(given) {
  const a = Buffer.from(String(given ?? ''));
  const b = Buffer.from(MCP_TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function presentedToken(req) {
  const auth = String(req.headers.authorization ?? '');
  const m = /^Bearer\s+(.+)$/i.exec(auth);
  if (m) return m[1].trim();
  return req.headers['x-wake-mcp-token'];
}

function newServer() {
  const server = new Server({ name: 'vesper-wake', version: '1.0.0' }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      return callWakeTool(name, args);
    } catch (err) {
      // 一条语句出错不该把整个 MCP 连接弄挂
      console.error(`wake-mcp: ${name} \u51fa\u9519`, err.message);
      return fail(`\u8fd9\u6b21\u6ca1\u6210\uff1a${err.message}`);
    }
  });

  return server;
}

export function registerWakeMcp(app) {
  if (!MCP_TOKEN) {
    console.log('wake-mcp: \u6ca1\u914d WAKE_MCP_TOKEN\uff0c/wake/mcp \u6ca1\u5f00');
    return { enabled: false };
  }

  app.post('/wake/mcp', async (req, res) => {
    if (!tokenOk(presentedToken(req))) {
      console.error('wake-mcp: token \u4e0d\u5bf9\uff0c\u5df2\u62d2\u7ecd');
      return res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'unauthorized' }, id: null });
    }

    // 无状态：一请求一对 server + transport，用完关掉
    const server = newServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      console.error('wake-mcp: \u8bf7\u6c42\u6ca1\u5904\u7406\u6210', err.message);
      if (!res.headersSent) {
        res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null });
      }
    }
  });

  const notAllowed = (req, res) =>
    res.status(405).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'use POST; this endpoint is stateless' },
      id: null,
    });
  app.get('/wake/mcp', notAllowed);
  app.delete('/wake/mcp', notAllowed);

  return { enabled: true, maxPending: MAX_PENDING };
}
