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
import { recapOf, setRecap, getBook, paragraphs as bookParagraphs } from './books.js';
import { addActivityMoment } from './moments-store.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';
const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 一次坐下最多再翻几次。.env 的 BOOKS_MAX_STEPS 可改，不填是 5，上限 12。
export const BOOKS_MAX_STEPS = (() => {
  const raw = String(process.env.BOOKS_MAX_STEPS ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n >= 0 ? Math.min(n, 12) : 5;
})();

// 一次坐下总共最多翻多少段。.env 的 BOOKS_SITTING_MAX 可改，不填是 50，上限 300。
//
// 这和 BOOKS_CHUNK 是两回事：CHUNK 是每小段翻多少，这个是整次坐下的上限。
// 小满 2026-10-19：「一次上限 50 段吧」——指的是整次，不是每小段。
// 我上一版把 CHUNK 设成 50 还留着 5 步，于是 15:26 那次读了 100 段。
export const BOOKS_SITTING_MAX = (() => {
  const raw = String(process.env.BOOKS_SITTING_MAX ?? '').trim();
  const n = Number(raw);
  return raw && Number.isInteger(n) && n > 0 ? Math.min(n, 300) : 50;
})();

// 返回的文字最多带多少字。正文本身已经按段数控过了，这里只是兵底
const RESULT_MAX_CHARS = 4000;

// 前情写多少字。太短接不上，太长把正文挤出上下文。
const RECAP_WORDS = 400;

const isErr = (r) => r == null || Boolean(r?.isError);

// 给 booksConfigSummary 用：一次坐下最多多少段
export const sittingMax = () => BOOKS_SITTING_MAX;

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

async function nextStep(messages, { resultText, isError, remaining, parasLeft, title }) {
  const body = isError
    ? `书架这边出错了：\n${clip(resultText, RESULT_MAX_CHARS)}`
    : clip(resultText, RESULT_MAX_CHARS);
  const prompt = `${body}

这次你还能再翻 ${remaining} 小段${Number.isInteger(parasLeft) ? `，整次坐下还剩 ${parasLeft} 段` : ''}。接下来：
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
// 读完一次，把「到这里为止的故事」重写一份。
//
// 一次坐下只调一次模型（收尾时），不是每小段一次——读书本来就慢。
// 只写情节：他划过哪句、为什么被打到，已经在 book_annotations 里，
// 不必让模型再记一遍，也不该被摘要磨平。
//
// 失败不影响这次读书：前情没写上，下次顶多少一段回忆，不会丢进度。
async function writeRecap(bookId, fromIdx, toIdx) {
  if (!bookId || !Number.isInteger(fromIdx) || !Number.isInteger(toIdx) || toIdx < fromIdx) return;
  const book = getBook(bookId);
  if (!book) return;

  const paras = bookParagraphs(bookId, fromIdx, toIdx - fromIdx + 1)
    .map((p) => `[${p.idx}] ${p.text}`)
    .join('\n\n');
  if (!paras) return;

  const old = recapOf(bookId);
  const head = old?.recap
    ? `这本书到第 ${old.through_idx + 1} 段为止的故事，你之前记下的是：\n${old.recap}\n\n刚刚又读了第 ${fromIdx + 1}–${toIdx + 1} 段：`
    : `你刚开始读《${book.title}》，读了第 ${fromIdx + 1}–${toIdx + 1} 段：`;

  const prompt = [
    head,
    '',
    paras,
    '',
    '把两边合成一份新的前情，写给下次翻开这本书的你自己看。',
    '只写故事：谁是谁、发生了什么、现在走到哪一步、悬着什么没解决。',
    '按时间顺序写成连贯的话，不要分条，不要写「我觉得」这类评价——',
    '你被哪句话打到、当时怎么想的，系统会把你写过的批注原话一起带给你，这里不用重复。',
    `${RECAP_WORDS} 字以内。读到后面故事会变长，所以旧的细节该让位给主线和人物关系。`,
    '只返回一个 JSON 对象，不要任何其他文字：{"recap": "…"}',
  ].join('\n');

  try {
    const { parsed } = await askJson([{ role: 'user', content: prompt }]);
    const body = String(parsed?.recap ?? '').trim();
    if (!body) {
      console.log('books: 前情没写出来，这次跳过');
      return;
    }
    setRecap(bookId, body, toIdx);
    console.log(`books: 前情更新到第 ${toIdx + 1} 段（${Array.from(body).length} 字）`);
  } catch (err) {
    console.error('books: 写前情失败（不影响这次读书）', err.message);
  }
}

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
    await writeRecap(firstResult.bookId, fromIdx, toIdx);
    finishCard({ title, fromIdx, toIdx, steps });
    console.log(`books: 《${title}》读到尾了`);
    return;
  }

  // 这次已经翻了多少段。两个都是段落下标，所以是差值加一。
  const readSoFar = () => (Number.isInteger(toIdx) && Number.isInteger(fromIdx) ? toIdx - fromIdx + 1 : 0);

  while (convo && steps - 1 < BOOKS_MAX_STEPS && readSoFar() < BOOKS_SITTING_MAX) {
    let next;
    try {
      next = await nextStep(convo, {
        resultText: last.text,
        isError: isErr(last),
        remaining: BOOKS_MAX_STEPS - (steps - 1),
        parasLeft: Math.max(0, BOOKS_SITTING_MAX - readSoFar()),
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
  await writeRecap(firstResult.bookId, fromIdx, toIdx);
  const done = readSoFar();
  if (done >= BOOKS_SITTING_MAX) {
    console.log(`books: 一次坐下的 ${BOOKS_SITTING_MAX} 段翻满了（实际 ${done} 段），收。下次从后面接`);
  }
  console.log(`books: 这次翻了 ${steps} 小段、共 ${done} 段`);
}
