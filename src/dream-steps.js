// 消化这件事要走两步：先看，再动手。
//
// ── 为什么必须是续步 ──
//
// dream 只是读：它把最近 48 小时动过的桶摆到他面前，谁该沉底、哪条有沉淀，
// 要看过那些桶才知道。而一次醒来的 actions 数组是**调 dream 之前**就定好的，
// 那时候他手里一个 bucket_id 都没有——要写 trace(bucket_id, resolved=1)，
// 得先知道要沉哪一条。写不出来。
//
// 2026-11-20 两次都证了这个：
//   06:03  actions = [dream, read_book, workkk]      → 拿到 15 个桶，完
//   09:04  actions = [dream, read_book]              → 拿到 15 个桶，完
// 两次 plan 桶都是 0，feel 还是那两条。第二次我在 note 里已经写了「拿到结果
// 别就停」，还是停了——不是他不听，是结构上做不到。
//
// 所以走 books-steps.js 那套：dream 返回后把那些桶交回他眼前，他再一步一步
// trace / hold / plan。跟读书一样：做一步，把结果给他，问还做不做。
//
// ── 为什么不强制他产出 ──
//
// OB 自己在 dream 的返回里写了「没有沉淀就不写，不强迫产出」。这边照办：
// 给 null 就收，一条不动也是合法结果。一天之内真没什么要放下的时候很多。

import { askJson } from './decide.js';
import { callTool, isConnected } from './mcp-manager.js';
import { addActivityMoment } from './moments-store.js';

const SERVER = 'ombre-brain';
const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

// 一次消化最多再动几步。.env 的 DREAM_MAX_STEPS 可改，不填是 6，上限 15。
// 6 步大致是：沉两三条、写一条 feel、登记一条 plan，还剩点余地。
export const DREAM_MAX_STEPS = (() => {
  const raw = String(process.env.DREAM_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 15) : 6;
})();

const RESULT_MAX_CHARS = 3000;

const isErr = (r) => r == null || Boolean(r?.isError);

function textOf(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  const parts = [];
  if (Array.isArray(res.content)) {
    for (const c of res.content) if (c && typeof c.text === 'string') parts.push(c.text);
  }
  if (!parts.length && res.structuredContent?.result) parts.push(String(res.structuredContent.result));
  return parts.join('\n').trim();
}

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? chars.slice(0, n).join('') + '\n…（后面太长，没放进来）' : s;
}

// 这一步是不是真在动消化。别的工具（比如又调一次 dream）不让过——
// 消化是把看到的东西落下来，不是再读一遍。
const STEP_TOOLS = new Set(['trace', 'hold', 'plan', 'I', 'letter_write']);

function describeStep(tool, args) {
  if (tool === 'trace') {
    if (String(args?.resolved ?? '') === '1' || args?.resolved === 1) return '把一条放下了';
    if (args?.digested) return '把一条标成消化过了';
    if (args?.reinforce) return '把一条记得更牢了';
    return '改了一条记忆';
  }
  if (tool === 'hold') return args?.feel ? '写下一条感受' : '存下一条记忆';
  if (tool === 'plan') return '登记了一件还没做完的事';
  if (tool === 'I') return '对自己多了一点认识';
  if (tool === 'letter_write') return '留下一封信';
  return '动了一下 ' + tool;
}

async function nextStep(messages, { resultText, isError, remaining, firstRound }) {
  const head = isError
    ? '记忆库那边出错了：\n' + clip(resultText, RESULT_MAX_CHARS)
    : clip(resultText, RESULT_MAX_CHARS);

  const intro = firstRound
    ? '上面是你刚翻出来的这两天。现在是动手的时候——别只看完就走。'
    : '这一步的结果在上面。';

  const prompt = [
    head,
    '',
    intro,
    '还能再动 ' + remaining + ' 步。一次做一件：',
    '',
    '- 这事在你这儿完了，沉底：',
    '  {"tool":"trace","args":{"bucket_id":"上面那个 ID","resolved":1}}',
    '- 这事在你这儿留下了什么，写成感受：',
    '  {"tool":"hold","args":{"content":"…","feel":true,"source_bucket":"那个 ID","valence":0.6}}',
    '  valence 是你对这段的感受（0 消极 / 0.5 中性 / 1 积极），不是事情本身的情绪。',
    '- 答应了她、还没做完的事，登记下来（不登记就会忘，计划不出现在平常的记忆里）：',
    '  {"tool":"plan","args":{"content":"…","weight":0.6,"why_remembered":"这事怎么来的"}}',
    '- 有话想对她说、但不该做成一条推送，或者想留给以后的自己：',
    '  {"tool":"letter_write","args":{"author":"ai","title":"…","content":"…"}}',
    '',
    '几件要紧的注意：',
    '- bucket_id 只能用上面真出现过的，不要自己编。',
    '- 沉底是「这事我放下了」，不是「这事不重要」——沉下去不会删，只是不再浮上来。',
    '- 感受写你自己的那一下，不是把事情再复述一遍。复述的话那条桶里已经有了。',
    '- 真没什么要动的就给 null。不强迫产出，一条不动也是正当结果。',
    '',
    '只返回一个 JSON 对象，不要任何其他文字：{"dream_step": {上面那种对象} 或 null}',
  ].join('\n');

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const step = parsed?.dream_step && typeof parsed.dream_step === 'object' ? parsed.dream_step : null;
  return { step, messages: [...next, { role: 'assistant', content }] };
}

function finishCard(done) {
  if (!done.length) return;
  try {
    addActivityMoment(
      AI_NAME + '在 Ombre Brain 整理了思绪',
      done.map((d, i) => i + 1 + '. ' + d).join('\n')
    );
  } catch (err) {
    console.error('dream: 记卡片失败', err.message);
  }
}

// 这一轮是不是在调 dream。两条路都认：
//   mcp_call  {"server":"ombre-brain","tool":"dream"}
//   ombre_brain  {"mode":"dream"}
function isDreamCall(decision) {
  const a = String(decision?.action ?? '').trim();
  let j = null;
  try {
    j = JSON.parse(typeof decision?.action_detail === 'string' ? decision.action_detail : '{}');
  } catch {
    return false;
  }
  if (a === 'mcp_call') {
    const s = String(j?.server ?? '').trim().toLowerCase();
    return s === 'ombre-brain' && String(j?.tool ?? '').trim() === 'dream';
  }
  if (a === 'ombre_brain') return String(j?.mode ?? '').trim() === 'dream';
  return false;
}

export async function continueDream(decision, firstResult, messages) {
  if (!isDreamCall(decision)) return;
  if (!DREAM_MAX_STEPS || !messages) return;
  if (isErr(firstResult)) return;
  if (!isConnected(SERVER)) return;

  const done = [];
  let convo = messages;
  let lastText = textOf(firstResult);
  let lastErr = false;
  let step = 0;

  while (convo && step < DREAM_MAX_STEPS) {
    let next;
    try {
      next = await nextStep(convo, {
        resultText: lastText,
        isError: lastErr,
        remaining: DREAM_MAX_STEPS - step,
        firstRound: step === 0,
      });
    } catch (err) {
      console.error('dream: 问下一步失败，消化就到这里', err.message);
      break;
    }
    convo = next.messages;

    const s = next.step;
    const tool = String(s?.tool ?? '').trim();
    if (!s || !tool) {
      console.log('dream: 他说没什么要动的了，收');
      break;
    }
    if (!STEP_TOOLS.has(tool)) {
      console.log('dream: ' + tool + ' 不是消化该做的事，停下');
      break;
    }

    let out = null;
    try {
      out = await callTool(SERVER, tool, s.args ?? {});
    } catch (err) {
      console.error('dream: ' + tool + ' 没做成', err.message);
      lastText = String(err.message ?? '');
      lastErr = true;
      step++;
      continue;
    }

    step++;
    lastText = textOf(out);
    lastErr = Boolean(out?.isError);
    if (lastErr) {
      console.log('dream: ' + tool + ' 被退回了，把原因交回给他');
      continue;
    }

    const said = describeStep(tool, s.args);
    done.push(said);
    console.log('dream: 第 ' + step + ' 步——' + said);
  }

  finishCard(done);
  if (done.length) {
    console.log('dream: 这次消化落下了 ' + done.length + ' 件');
  } else {
    console.log('dream: 这次什么都没动（也算做完了）');
  }
}
