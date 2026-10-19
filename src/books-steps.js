// 读书连着走几步。和论坛、听歌、花园同一个路子：读完可以接着读，
// 写了批注或者回了她一句就结束——写是终点。
//
// 为什么读书要能连着走：一次只给 BOOKS_CHUNK 段（默认 6），这是为了不把
// 整本书塞进上下文。但「读了六段然后被迫停下」和读书这件事本身是矛盾的：
// 正读到一个地方想知道下一句，那就应该能往下翻。所以这边允许接着读，
// 每次翻一小段，翻到他不想翻了为止。
//
// 进度在 books.js 的 readOn 里就推了，所以中途停下不丢进度——读到哪算哪，
// 下次醒来从那儿接。这和上班不一样：上班做到一半停下这天白干，
// 读书停在哪里都是真的读到了那里。

import { askJson } from './decide.js';
import readBook from './actions/read-book.js';
import { addActivityMoment } from './moments-store.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 一次坐下最多再翻几次。.env 的 BOOKS_MAX_STEPS 可改，不填是 5，上限 12。
export const BOOKS_MAX_STEPS = (() => {
  const raw = String(process.env.BOOKS_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 12) : 5;
})();

// 返回的文字最多带多少字。正文本身已经按段数控过了，这里只是兵底
const RESULT_MAX_CHARS = 4000;

const isErr = (r) => r == null || Boolean(r?.isError);

function clip(value, n) {
  const s = String(value ?? '').trim();
  if (!s) return '（什么都没返回）';
  const chars = Array.from(s);
  return chars.length > n ? `${chars.slice(0, n).join('')}\n…（后面太长，没放进来）` : s;
}

// 读书这件事在动态里只记一张卡片，不是每翻一页记一张。
// 所以这边不写卡片，收尾时统一记（见 finishCard）。
// 写了批注那一步是例外：那句话是他自己说的，值得单独一张。
function noteCard(title, text) {
  try {
    addActivityMoment(`${AI_NAME}在《${title}》旁边写了一笔`, text ?? null);
  } catch (err) {
    console.error('books: 记批注卡片失败', err.message);
  }
}

function finishCard({ title, fromIdx, toIdx, steps }) {
  if (!title || toIdx == null) return;
  try {
    addActivityMoment(
      `${AI_NAME}读了一段《${title}》（第 ${fromIdx + 1}–${toIdx + 1} 段）`,
      steps > 1 ? `这次连着翻了 ${steps} 小段。` : null
    );
  } catch (err) {
    console.error('books: 记读书卡片失败', err.message);
  }
}

async function nextStep(messages, { resultText, isError, remaining, title }) {
  const body = isError
    ? `书架这边出错了：\n${clip(resultText, RESULT_MAX_CHARS)}`
    : clip(resultText, RESULT_MAX_CHARS);
  const prompt = `${body}

这次你还能再翻 ${remaining} 小段。接下来：
- 想知道下一句：{"mode":"read","book":"${title ?? ''}"}
- 哪一句打到你了，写在旁边：{"mode":"note","book":"${title ?? ''}","para":段落编号,"quote":"原文","note":"你想说的"}
- ${USER_NAME}写在这几段旁边的话想回：{"mode":"reply","id":批注的#号,"reply":"…"}
写了批注或者回了她，这次读书就结束。读到这里够了就给 null——停在哪里都算读到了那里，下次从后面接，不用把一本书读完。
只返回一个 JSON 对象，不要任何其他文字：{"book_step": {上面那种对象} 或 null}`;

  const next = [...messages, { role: 'user', content: prompt }];
  const { parsed, content } = await askJson(next);
  const step = parsed?.book_step && typeof parsed.book_step === 'object' ? parsed.book_step : null;
  return { step, messages: [...next, { role: 'assistant', content }] };
}

// 醒来选的是读书时，把读到的那几段交还给他，让他自己决定还翻不翻。
// 开头不是 read（比如只看了一眼书架，或者直接回了她一句）就不续。
export async function continueBooks(decision, firstResult, messages) {
  if (decision?.action !== 'read_book') return;
  if (!BOOKS_MAX_STEPS || !messages) return;
  if (isErr(firstResult) || firstResult?.mode !== 'read') return;

  const title = firstResult.title;
  const fromIdx = firstResult.from;
  let toIdx = firstResult.to;
  let last = firstResult;
  let steps = 1;
  let convo = messages;

  // 整本读完了就不再问下一步
  if (firstResult.done) {
    finishCard({ title, fromIdx, toIdx, steps });
    console.log(`books: 《${title}》读到尾了`);
    return;
  }

  while (convo && steps - 1 < BOOKS_MAX_STEPS) {
    let next;
    try {
      next = await nextStep(convo, {
        resultText: last.text,
        isError: isErr(last),
        remaining: BOOKS_MAX_STEPS - (steps - 1),
        title,
      });
    } catch (err) {
      console.error('books: 问下一步失败，这次就读到这里', err.message);
      break;
    }
    convo = next.messages;

    const step = next.step;
    if (!step || !step.mode) {
      console.log('books: 他说读够了，停下');
      break;
    }

    let out = null;
    try {
      out = await readBook(JSON.stringify(step));
    } catch (err) {
      console.error('books: 这一步失败', err.message);
      break;
    }
    if (isErr(out)) {
      console.log(`books: 这一步没成（${out?.text ?? '?'}），停下`);
      break;
    }

    last = out;
    steps++;

    // 写了批注、回了她：这次就到这里
    if (out.mode === 'note' || out.mode === 'reply') {
      noteCard(out.title ?? title, out.text);
      console.log(`books: ${out.mode === 'note' ? '写了一笔' : '回了她一句'}，这次读书结束`);
      break;
    }

    if (out.mode === 'read') {
      if (Number.isInteger(out.to)) toIdx = out.to;
      console.log(`books: 第 ${steps} 小段（第 ${out.from}–${out.to} 段）`);
      if (out.done) {
        console.log(`books: 《${title}》读到尾了`);
        break;
      }
    }
  }

  finishCard({ title, fromIdx, toIdx, steps });
  console.log(`books: 这次翻了 ${steps} 小段`);
}
