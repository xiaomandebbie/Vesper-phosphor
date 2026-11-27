// Leto 朋友圈评论的两道闸。挂在 mcp-manager.js 的 callTool 上，两条路都过得去
// （第一步走 actions/mcp-action.js，续步走 leto-steps.js，只在 callTool 汇合）。
//
// 2026-11-27 小满发现的病：同一条动态底下他攒了好几条评论。
// 两个根因，都在这里挡：
//
// 1) 正文参数叫 text。他照着自家 moment 动作的习惯写成 content，
//    Leto 回 -32602 Invalid params，他重写一遍再发——就成了两条。
//    这里直接把 content 挪到 text，报错和重写都不会发生。
// 2) note 只说「谁在哪条动态下 @ 了你」，没说「你回过没有」。
//    于是每醒一次他就再回一遍。这里记一本小账：同一条评论只回一次；
//    没指定回复对象的（顶楼评论）同一条动态 30 分钟内只留一条。
//
// 只认 leto_moment_comment，别的工具原样放行。

import fs from 'fs';
import path from 'path';

const TOOL = 'leto_moment_comment';

// 账本默认放在项目里的 data/，和 state.db 一个目录。
const LEDGER_PATH =
  process.env.LETO_COMMENT_LEDGER || path.join(process.cwd(), 'data', 'leto-comment-ledger.json');

// 回复过的那条评论 7 天内不再回；顶楼评论按 30 分钟算。
const REPLY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOPLEVEL_TTL_MS = 30 * 60 * 1000;

function readLedger() {
  try {
    const data = JSON.parse(fs.readFileSync(LEDGER_PATH, 'utf8'));
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

function writeLedger(ledger) {
  const now = Date.now();
  const kept = {};
  for (const [k, ts] of Object.entries(ledger)) {
    if (typeof ts === 'number' && now - ts < REPLY_TTL_MS) kept[k] = ts;
  }
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(kept), 'utf8');
  } catch (err) {
    console.error('leto-comment-guard: 写账本失败', err.message);
  }
}

// 回复某条评论按「动态+评论」算；顶楼评论按动态算。
function ledgerKey(args) {
  const moment = String(args?.moment_id ?? '').trim();
  if (!moment) return null;
  const reply = String(args?.reply_to_comment_id ?? '').trim();
  return reply ? `${moment}|${reply}` : `${moment}|*`;
}

function when(ts) {
  try {
    return new Date(ts).toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' });
  } catch {
    return '刚才';
  }
}

// 返回 { args: 整理后的参数, blocked: 要不要拦, reason: 拦下时给他看的话 }
export function prepareLetoComment(tool, args) {
  if (String(tool ?? '').trim() !== TOOL) return { args, blocked: false };

  const fixed = { ...(args && typeof args === 'object' && !Array.isArray(args) ? args : {}) };

  // 正文错写在 content 里就直接搬过去，别让 Leto 用 -32602 打回来再重写一遍。
  if (typeof fixed.text !== 'string' || !fixed.text.trim()) {
    if (typeof fixed.content === 'string' && fixed.content.trim()) {
      console.warn('leto-comment-guard: 正文写在了 content，已改填 text');
      fixed.text = fixed.content;
    }
  }
  delete fixed.content;

  const isReply = Boolean(String(fixed.reply_to_comment_id ?? '').trim());
  const key = ledgerKey(fixed);
  if (key) {
    const ts = readLedger()[key];
    const ttl = isReply ? REPLY_TTL_MS : TOPLEVEL_TTL_MS;
    if (typeof ts === 'number' && Date.now() - ts < ttl) {
      const reason = isReply
        ? `这条评论 ${when(ts)} 你已经回过了（${fixed.reply_to_comment_id}），这次没发出去。`
        : `这条动态 ${when(ts)} 你已经评论过一条了，这次没发出去。要接某个人的话，把 reply_to_comment_id 填成他那条评论的编号。`;
      return { args: fixed, blocked: true, reason };
    }
  }
  return { args: fixed, blocked: false };
}

// 发成功了才记账。失败了不记，下次还能重来。
export function recordLetoComment(tool, args, result) {
  if (String(tool ?? '').trim() !== TOOL) return;
  if (!result || result.isError) return;
  const key = ledgerKey(args);
  if (!key) return;
  const ledger = readLedger();
  ledger[key] = Date.now();
  writeLedger(ledger);
}
