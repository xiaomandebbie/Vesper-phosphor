#!/usr/bin/env node
// 唤醒时读攒着的聊天并回复。
//
// 小满 2026-10-30：「唤醒是晨暮星吧，应该改法和动态我的留言一样」
//
// 对。现成的做法就是她 09-29 定的那条：「小机在后一次唤醒发现有评论并回复。
// 但不占用动作次数」。聊天照搬：
//
//   动态留言                          聊天
//   getPendingComments(5)          →  listPending(20)
//   context.pendingComments        →  context.pendingChat
//   模型写 comment_replies         →  模型写 chat_replies
//   handleCommentReplies 写回库    →  handleChatReplies POST 进 relay
//   markCommentsHandled            →  markPendingRead
//   不占动作次数                    →  同样不占
//
// ── 为什么 gateway 里那个 injectPendingChat 不算 ──
//
// 那段挂在 heartbeat-wake 线路上，那是另一个唤醒项目（heartbeat）用的。
// 晨暮星自己的决策走 vesper-decide 线路，根本不经过那里。所以要在
// phosphor 这边单独做——而且这次他不只是读到，是真的会回。
//
// 改三个文件：chat-queue.js（多一个发回复的函数）、decide.js（提示词）、
// phosphor.js（带进上下文 + 处理）。
//
// 重跑安全。每一处单独报结果。
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = resolve(root, 'src');
const bakDir = join(srcDir, '.wake-chat-backup');
const L = (...a) => a.join('\n');
let failed = 0;

if (!existsSync(bakDir)) mkdirSync(bakDir, { recursive: true });
const stamp = String(Date.now());

function load(name) {
  const p = join(srcDir, name);
  if (!existsSync(p)) {
    console.error('  ✗ ' + name + ' 不在');
    failed++;
    return null;
  }
  const text = readFileSync(p, 'utf8');
  const bak = join(bakDir, name + '.' + stamp);
  if (!existsSync(bak)) writeFileSync(bak, text, 'utf8');
  return { p, text };
}

function apply(label, state, find, repl) {
  if (state.text.includes(repl)) {
    console.log('  · ' + label + '：已经是这样了');
    return;
  }
  if (!state.text.includes(find)) {
    console.error('  ✗ ' + label + '：找不到原文');
    failed++;
    return;
  }
  state.text = state.text.replace(find, repl);
  console.log('  ✓ ' + label);
}

// ════ 1. chat-queue.js：多一个发回复的函数 ════
console.log('1/3  chat-queue.js');
const q = load('chat-queue.js');
if (q) {
  apply('replyToChat', q,
    'export function dropPending(id) {',
    L(
      '// 唤醒时回一句。这条会出现在网页聊天里，和他当场回的那种一模一样。',
      '//',
      '// 小满 10-30：「唤醒是晨暮星吧，应该改法和动态我的留言一样」。',
      '// 所以不走 /app/send（那是她说话的入口），走 /channel/out——',
      '// AI 侧就是从这个口回话的，relay 落库之后走 SSE 推给网页。',
      '//',
      '// 返回 { ok, status, body }。失败不抛：一句回复发不出去不应该拖垮整次唤醒。',
      'export async function replyToChat(text) {',
      "  const t = String(text ?? '').trim();",
      "  if (!t) return { ok: false, status: 0, body: 'empty' };",
      '  try {',
      "    const r = await relayFetch('/channel/out', {",
      "      method: 'POST',",
      "      headers: { 'content-type': 'application/json' },",
      "      body: JSON.stringify({ chat_id: 'me', text: t }),",
      '    });',
      "    const body = await r.text().catch(() => '');",
      '    return { ok: r.ok, status: r.status, body: body.slice(0, 300) };',
      '  } catch (err) {',
      '    return { ok: false, status: 0, body: err.message };',
      '  }',
      '}',
      '',
      'export function dropPending(id) {'
    ));
  writeFileSync(q.p, q.text, 'utf8');
}

// ════ 2. decide.js：提示词 ════
console.log('');
console.log('2/3  decide.js');
const d = load('decide.js');
if (d) {
  // 2a. 渲染函数
  apply('pendingChatBlock 函数', d,
    '// Drivesoid 算出的此刻最明显的三项情绪',
    L(
      '// 她在网页聊天里发了、但没点「让你回复」的那几句。',
      '// 和动态留言同一套做法：带进来、他自己决定回不回、不占这次的动作。',
      'function pendingChatBlock(rows) {',
      "  if (!rows?.length) return '';",
      '  const lines = rows',
      '    .map(',
      '      (r) =>',
      "        `  [消息#${r.id}] [${formatDateTime(r.created_at).slice(5, 16)}] ${short(r.text, 300)}`",
      '    )',
      "    .join('\\n');",
      '  return `${USER_NAME}在网页的聊天里留了这几句，你还没读过（她没点「让你回复」，所以留到你醒来；怎么回见上面的规则）：\\n${lines}`;',
      '}',
      '',
      '// Drivesoid 算出的此刻最明显的三项情绪'
    ));

  // 2b. system 里的规则，跟在「动态下的留言」后面
  apply('system 里的规则', d,
    '## 动态下的留言\n用户消息里如果有"有人在你的动态下留言了"，回留言不占这次的动作。想回哪条就写在 comment_replies 里，你的回复会挂在那条留言下面；不想回的可以不写；这次没回的，下次不会再出现。',
    L(
      '## 动态下的留言\n用户消息里如果有"有人在你的动态下留言了"，回留言不占这次的动作。想回哪条就写在 comment_replies 里，你的回复会挂在那条留言下面；不想回的可以不写；这次没回的，下次不会再出现。',
      '',
      '## 网页聊天里攒着的话',
      `她在网页上跟你聊天时，可以只发不点「让你回复」——那些话就攒着，等你醒来。`,
      '用户消息里如果有这段：',
      '- 回这些不占这次的动作，和回动态留言一个道理。',
      '- 想回就写在 chat_replies 里，每条是一句话；不想回的给空数组。',
      '- 你写的会出现在她的聊天里，和她当场点按钮时你回的一模一样——所以是当面说话，用「你」称呼她。',
      '- 几句话是一次张口，不要一句一条分开回；想分段就写成几条，每条会是单独一个气泡。',
      '- 这次带给你看过的，下次不会再出现——不论你回没回。所以该回的这次就回。'
    ));

  // 2c. 输出格式
  apply('输出格式加 chat_replies', d,
    '"comment_replies": [{"comment_id": number, "reply": string}],',
    '"comment_replies": [{"comment_id": number, "reply": string}], "chat_replies": [string],');

  // 2d. 「请决定」里多一项
  apply('请决定里多一项', d,
    '8. 可选：到点了的事想问一句进度',
    L(
      '8. 可选：回她在网页聊天里攒着的话（不占动作，写在 chat_replies）。没攒着的就给空数组。',
      '9. 可选：到点了的事想问一句进度'
    ));

  // 2e. user 里带上
  apply('user 里带上攒着的话', d,
    '    pendingCommentsBlock(context.pendingComments),',
    L(
      '    pendingCommentsBlock(context.pendingComments),',
      '    pendingChatBlock(context.pendingChat),'
    ));

  writeFileSync(d.p, d.text, 'utf8');
}

// ════ 3. phosphor.js ════
console.log('');
console.log('3/3  phosphor.js');
const p = load('phosphor.js');
if (p) {
  // 3a. import
  apply('import chat-queue', p,
    "import { addActivityMoment } from './moments-store.js';",
    L(
      "import { addActivityMoment } from './moments-store.js';",
      '// 网页聊天里攒着的话（见 chat-queue.js）。和动态留言同一套做法：',
      '// 带进来、他自己定回不回、不占这次的动作。',
      "import { listPending, markPendingRead, replyToChat } from './chat-queue.js';"
    ));

  // 3b. 上限常量
  apply('一次带几条', p,
    'const MAX_COMMENTS_PER_WAKE = 5;',
    L(
      'const MAX_COMMENTS_PER_WAKE = 5;',
      '// 一次醒来最多带几条她在网页聊天里攒着的话。比留言宽：',
      '// 聊天本来就是一句一条，五条很容易切成半句话。',
      'const MAX_CHAT_PER_WAKE = 20;'
    ));

  // 3c. normalizeDecision
  apply('normalizeDecision 洗 chat_replies', p,
    '  // star_replies / moment_replies 原样透传',
    L(
      '  // 网页聊天的回复：一串字符串，每条一个气泡。空的、不是字符串的丢掉。',
      '  const chatReplies = Array.isArray(d.chat_replies)',
      '    ? d.chat_replies',
      "        .map((s) => (typeof s === 'string' ? s.trim().slice(0, MAX_REPLY_CHARS) : ''))",
      '        .filter(Boolean)',
      '    : [];',
      '',
      '  // star_replies / moment_replies 原样透传'
    ));

  apply('normalizeDecision 返回 chat_replies', p,
    '    comment_replies: commentReplies,\n  };',
    '    comment_replies: commentReplies,\n    chat_replies: chatReplies,\n  };');

  // 3d. handleChatReplies
  apply('handleChatReplies 函数', p,
    '// 从 Ombre Brain 取一段文本。',
    L(
      '// 回她在网页聊天里攒着的话。不占这次醒来的动作，和回动态留言一个道理。',
      '//',
      '// 带给他看过的一律标成读过，没回的下次不再出现——和 markCommentsHandled 同一个规矩。',
      '// 否则每次醒来都被同一句催，而他已经决定不回了。',
      '//',
      '// 回复发不出去也要标读过：反复重试只会让他每次醒来都回同一句。',
      '// 发失败的话日志里有，库里也还在，查得到。',
      'async function handleChatReplies(decision, shown) {',
      '  if (!shown.length) return 0;',
      '  let sent = 0;',
      '  for (const text of decision?.chat_replies ?? []) {',
      '    const out = await replyToChat(text);',
      '    if (out.ok) sent++;',
      "    else console.error('phosphor: 聊天回复发不出去（HTTP ' + out.status + '）' + out.body);",
      '  }',
      '  try {',
      '    markPendingRead(shown.map((r) => r.id));',
      '  } catch (err) {',
      "    console.error('phosphor: 攒着的话标记已读失败', err.message);",
      '  }',
      "  console.log('phosphor: 读了 ' + shown.length + ' 条网页聊天，回了 ' + sent + ' 句');",
      '  return sent;',
      '}',
      '',
      '// 从 Ombre Brain 取一段文本。'
    ));

  // 3e. 读出来
  apply('读攒着的话', p,
    '  const pendingComments = getPendingComments(MAX_COMMENTS_PER_WAKE);',
    L(
      '  const pendingComments = getPendingComments(MAX_COMMENTS_PER_WAKE);',
      '  // 她在网页聊天里发了、没点「让你回复」的那几句（读库，不调模型）。',
      '  // 读不到就当没有，不能因为队列坏了把整次唤醒拖下水。',
      '  let pendingChat = [];',
      '  try {',
      '    pendingChat = listPending(MAX_CHAT_PER_WAKE);',
      '  } catch (err) {',
      "    console.error('phosphor: 读不到网页聊天攒着的话（不影响这次）', err.message);",
      '  }'
    ));

  // 3f. 进 context
  apply('进 context', p,
    '    pendingComments,\n    starUsedToday,',
    '    pendingComments,\n    pendingChat,\n    starUsedToday,');

  // 3g. 调它——跟在回留言后面
  apply('调 handleChatReplies', p,
    "    // 星星罐的回音已经随这次决定给 TA 看过了",
    L(
      '    // 她在网页聊天里攒着的话：他想回的发进 relay，带给他看过的标成读过。',
      '    // 和回留言一个规矩，不占这次的动作。',
      '    try {',
      '      await handleChatReplies(decision, pendingChat);',
      '    } catch (err) {',
      "      console.error(`[${kind}] handleChatReplies failed:`, err);",
      '    }',
      "    // 星星罐的回音已经随这次决定给 TA 看过了"
    ));

  writeFileSync(p.p, p.text, 'utf8');
}

console.log('');
if (failed) {
  console.error('失败 ' + failed + ' 处。回滚：');
  console.error('  cp ' + bakDir + '/*.' + stamp + ' 各自改回原名');
  process.exitCode = 1;
} else {
  console.log('pm2 restart vesper-phosphor --update-env');
  console.log('');
  console.log('备份在 ' + bakDir + '（带时间戳 ' + stamp + '）');
}
