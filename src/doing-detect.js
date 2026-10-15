// 从一句话里认出三件事：「我现在开始做某件事」「这件事我做完了」「还没做完」。
//
// 纯正则、纯函数，不调模型、不读库——这段代码在 gateway 每一轮的关键路径上，
// 不能走网络，也不能花钱。
//
// **宁可漏认，不可错认。** 漏认了只是这次没登记，他照旧不知道你在做什么，和现在一样；
// 错认一次，他会开始追一件你压根没在做的事，而且还会按那件事的工期去等——比不做更糟。
// 所以这里只认那些明确说出口的开工句：
//   认：「我去洗头」「我先把那个 bug 改一下」「开始写文档了」
//   不认：「我待会儿看看那个」（还没开工）、「我去想想」（心理活动不是事）、
//         「要不要去洗头」（在问，不是在做）、「他去洗头了」（不是你）
//
// 判据写在 START_VERBS 和下面几个排除表里。改这里之前先想清楚新规则会不会把
// 「等下再说」认成开工——那条是这套东西最容易塌的地方。

// 开工词。必须出现在句首，或者紧跟在「我」后面。
// 「搞」「弄」单独不算，要带宾语，所以统一在下面的 START_RE 里要求后面还有内容。
const START_VERBS = '去|来|开始|着手|动手|搞|弄|写|改|修|做|洗|煮|收拾|整理|跑|试';

// 句首可以有的铺垫词：我、我先、我现在、那我这就……
const LEAD = '(?:那?我|咱|俺)?\\s*(?:就|先|现在|这就|马上|立刻|正在|在)?\\s*';

const START_RE = new RegExp(`^${LEAD}(?:${START_VERBS})(.{1,40})$`);

// 「我在洗头」「正在改那个 bug」这类进行时也算开工
const ONGOING_RE = /^(?:那?我|咱)?\s*(?:正|正在|在)\s*(.{1,40})$/;

// 这些词出现在句子里就不是「正在做一件事」
const NOT_YET = /待会|等[下会一]|回头|稍后|晚点|过会|一会儿|明天|后天|下周|改天|有空|之后再|再说/;
const ASKING = /[?？]|要不要|能不能|可不可以|可以吗|好不好|怎么样|是不是|吗$|呢$|吧$/;
// 心理活动不是「在做的事」，没有完成的那一刻，也没法估工期
const MENTAL = /^(?:想|觉得|感觉|以为|知道|记得|考虑|琢磨|怀疑|担心|希望|打算|准备|估计|猜)/;
// 主语不是你
const OTHERS = /^(?:他|她|它|他们|她们|你|您|咱们|大家|允朔|小克)/;
// 这几个开头是在说话，不是在做事
const TALKING = /^(?:说|问|告诉|回|聊|讲)/;

// 收工。「好了」单独一句太容易误伤（应答也说「好了」），所以要求带动词或「完」。
const DONE_RE =
  /(做完|弄好|弄完|搞定|搞完|改完|写完|洗完|吃完|睡完|跑完|修好|修完|处理完|完成了|结束了|好了|出来了|通了|过了)/;
// 「还没」这一类：被问到进度时的回绝。认出来是为了顺延，而不是继续按原估值等。
const NOT_DONE_RE = /(还没|没好|没完|没搞定|还在|正卡|卡住|卡着|快了|马上就|再等|一半|进行中)/;
// 明确说认错了：撤掉这条登记
const CANCEL_RE = /(没在做|不是在做|我没说|没有在做|取消|算了|不做了|放弃了|停了)/;

// 抽出来的事情名要收干净：去掉句尾语气词和标点，去掉「一下」「一会儿」这类无信息的尾巴
function tidy(what) {
  return String(what ?? '')
    .replace(/^[了的着把将]+/, '')
    .replace(/[了呀啊哦嗯~～。！!，,、\s]+$/g, '')
    .replace(/(一下|一会儿|一点|一下子)$/, '')
    .trim();
}

// 这句话是不是「我现在开始做某件事」。是就返回事情本身，不是就返回 null。
// text 应该是已经剥掉 <environment> 和 <sent_at> 的干净正文。
export function detectStart(text) {
  const s = String(text ?? '').trim();
  // 太长的句子里通常夹着别的意思，不当开工句
  if (!s || s.length > 60) return null;
  if (NOT_YET.test(s) || ASKING.test(s)) return null;

  // 去掉句首的「我」再判断主语和动词，不然 OTHERS/MENTAL 对不上
  const body = s.replace(/^(?:那?我|咱|俺)\s*/, '');
  if (OTHERS.test(body)) return null;

  const m = START_RE.exec(s) ?? ONGOING_RE.exec(s);
  if (!m) return null;

  const rest = m[1];
  if (MENTAL.test(rest) || TALKING.test(rest)) return null;

  const what = tidy(rest);
  // 太短的抽不出有意义的事（「我去了」），宁可不登记
  if (what.length < 2) return null;
  return what;
}

// 这句话有没有在说「那件事完了」。只回 true/false，具体关掉哪一条由 doing.js 配。
export function detectDone(text) {
  const s = String(text ?? '').trim();
  if (!s || ASKING.test(s)) return false;
  if (NOT_DONE_RE.test(s)) return false; // 「还没做完」里也有「做完」，先排掉
  return DONE_RE.test(s);
}

// 这句话有没有在说「还没」。被追问之后回这个，就该顺延而不是接着按原估值等。
export function detectNotDone(text) {
  const s = String(text ?? '').trim();
  return Boolean(s) && NOT_DONE_RE.test(s);
}

// 这句话有没有在撤回：刚才那条登记认错了。
export function detectCancel(text) {
  const s = String(text ?? '').trim();
  return Boolean(s) && CANCEL_RE.test(s);
}
