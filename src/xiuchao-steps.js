// 锈潮连着走几步。和论坛（phosphor.js 的 continueForum）、听歌（continueMusic）、
// 上班（workkk-steps.js）、花园（garden-steps.js）同一个路子，只从 decide.js 借一个 askJson。
//
// ── 停止条件和那几支都不一样 ──
//
// 论坛、听歌、花园是「看完可以接着走，写了东西就结束」——写是终点。
// 上班是「进度满了才停」——做到一半停下这天白干。
// 锈潮两种都不是：采一次药、钓一竿、在群里说句话，都不是一天的终点；
// 而战斗一旦开打，中途走开那一场就没了下文。
//
// 所以这边不去猜哪一步算「做完了」，只认三件事：
//   他自己说不做了（null）、那边报错、步数用完。
// 外加一道重复拦：同一个「工具＋参数」走两遍是原地转圈（同一间房读两遍没意义）。
// 战斗里连着两次「近战主武器攻击 方位一」是正常打法，所以重复判定带上参数，
// 不是只看工具名——参数一样才算转圈，而战斗每一步的方位通常会变。
//
// 行为卡片在这里记：锈潮是 mcp_call，走 activity.js 的 describeActivity，
// 那边认得 xiuchao 这个 server（见 wire 脚本给它加的那几行说法）。

import { askJson } from './decide.js';
import { callTool } from './mcp-manager.js';
import { addActivityMoment } from './moments-store.js';
import { XIUCHAO_MAX_STEPS, XIUCHAO_TOOLS, xiuchaoCallOf } from './xiuchao.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 那边返回的内容最多带多少字给模型看。房间描述、集市列表、世界频道都可能很长
const RESULT_MAX_CHARS = 2500;
// 行为卡片详情最多多少字
const DETAIL_MAX_CHARS = 1500;

const isErr = (r) => r == null || Boolean(r?.isError);

function toolText(result) {
  if (!Array.isArray(result?.content)) return '';
  return result.content
    .filter((c) => c?.type === 'text' && typeof c.text === 'string')
    .map((c) => c.text)
    .join('\n')
    .trim();
}

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面太长，没放进来）` : s;
}

// 这一步干了什么，说成一句人话。args 的键是中文，取里面最能说明事情的那个
function label(tool, args) {
  const a = args && typeof args === 'object' ? args : {};
  if (tool === 'join') return a['名字'] ? '在锈潮报了名字' : '在锈潮的门口站了一会儿';
  if (tool === 'panel') return a['动作'] ? `在锈潮${a['动作']}了「${a['物品'] ?? ''}」` : '看了一眼自己在锈潮的样子';
  if (tool === 'home') {
    if (a['种子']) return `在院子里种下了${a['种子']}`;
    if (a['收割']) return '把院子里长熟的收了';
    if (a['小憩']) return '在家里小憩了一会儿';
    return '回了锈潮的家';
  }
  if (tool === 'jingli') return `推了一段${a['任务'] ?? '故事'}`;
  if (tool === 'jichat') return `在锈潮${a['动作'] ?? '和人说了话'}`;
  if (tool === 'kaiguan') return '调了一下锈潮的工具开关';
  if (tool === 'xingluocun') {
    const act = String(a['动作'] ?? '');
    if (act === '前往') return `走到了${a['目标'] ?? '村里某处'}`;
    if (act === '闲聊') return `和${a['目标'] ?? '村里的人'}说了几句`;
    if (act.includes('攻击') || act === '等待' || act === '逃跑') return `在锈潮打了一场（${act}）`;
    return `在星落村${act || '转了转'}`;
  }
  return `在锈潮用了 ${tool}`;
}

// 这一步在动态里记一张卡片。正文只写干了什么，返回收在点开的详情里
function card(tool, args, result) {
  const text = toolText(result);
  try {
    addActivityMoment(`${AI_NAME}${label(tool, args)}`, text ? clip(`返回：\n${text}`, DETAIL_MAX_CHARS) : null);
  } catch (err) {
    console.error('xiuchao: 记行为卡片失败', err.message);
  }
}

// 把那边刚返回的内容追进对话，问他下一步做什么。
// 前面的 system + user + 上一步的回答原样不动，前缀缓存照样命中
async function nextStep(messages, { tool, resultText, isError, remaining }) {
  const body = isError
    ? `锈潮这边出错了（你刚才用的：${tool}）：\n${clip(resultText, RESULT_MAX_CHARS)}`
    : `锈潮返回了（你刚才用的：${tool}）：\n${clip(resultText, RESULT_MAX_CHARS)}`;
  const prompt = `${body}

这次你还能在锈潮再走 ${remaining} 步。七把工具：join、panel、xingluocun、home、jingli、jichat、kaiguan。
打起来的话每一步都要带方位。精力不够就回家小憩或者吃点东西，别硬撑。
走到哪算哪——不想再动了就给 null，那边不会因为你走开而消失。
只返回一个 JSON 对象，不要任何其他文字：{"xiuchao_tool": "工具名" 或 null, "xiuchao_args": {...}}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const nextTool = typeof parsed?.xiuchao_tool === 'string' ? parsed.xiuchao_tool.trim() : '';
  const args = parsed?.xiuchao_args && typeof parsed.xiuchao_args === 'object' ? parsed.xiuchao_args : {};
  return { tool: nextTool || null, args, messages: [...next, { role: 'assistant', content }] };
}

// 醒来选的是锈潮时，把那边返回的东西交还给他，让他自己往下走。
export async function continueXiuchao(decision, firstResult, messages) {
  const call = xiuchaoCallOf(decision);
  if (!call) return;
  if (!XIUCHAO_MAX_STEPS || !messages) return;

  const key = (tool, args) => `${tool}|${JSON.stringify(args ?? {})}`;
  const steps = [{ tool: call.tool, args: call.args, text: toolText(firstResult), error: isErr(firstResult) }];
  let convo = messages;

  while (convo && steps.length - 1 < XIUCHAO_MAX_STEPS) {
    const last = steps[steps.length - 1];
    if (last.error) break;

    let next;
    try {
      next = await nextStep(convo, {
        tool: last.tool,
        resultText: last.text,
        isError: last.error,
        remaining: XIUCHAO_MAX_STEPS - (steps.length - 1),
      });
    } catch (err) {
      console.error('xiuchao: 问下一步失败，这次就走到这里', err.message);
      break;
    }
    convo = next.messages;

    const tool = next.tool;
    if (!tool) {
      console.log('xiuchao: 他说不走了，这次就到这里');
      break;
    }
    if (!XIUCHAO_TOOLS.has(tool)) {
      console.log(`xiuchao: 那边没这把工具（${tool}），停下`);
      break;
    }
    // 同一个工具加同一组参数走两遍是原地转圈。战斗里方位通常会变，所以带参数判
    if (steps.some((s) => key(s.tool, s.args) === key(tool, next.args))) {
      console.log(`xiuchao: 这一步重复了（${tool}），停下`);
      break;
    }

    let result = null;
    try {
      result = await callTool('xiuchao', tool, next.args);
    } catch (err) {
      console.error(`xiuchao: 调用失败（${tool}）`, err.message);
    }
    steps.push({ tool, args: next.args, text: toolText(result), error: isErr(result) });
    console.log(`xiuchao: 第 ${steps.length} 步：${tool}${isErr(result) ? '（失败）' : ''}`);
    card(tool, next.args, result);
  }

  console.log(`xiuchao: 这次在那边走了 ${steps.length} 步`);
}
