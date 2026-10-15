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
// 抽出来的名字要像人话，因为它会原样注入给他看（「她正在做的事」那段）。三件事：
//   开工词分两类——「去/开始」只说明要动身，剥掉；「洗/改」本身就是在做的事，要留着。
//   动词后面的「个」「一下」没信息，剥掉：洗个头 → 洗头。
//   把字句重排成动宾：把那个 bug 改一下 → 改 bug。
// 这三条只改字面，不改认不认得出来；类别（doing.js 的 categoryOf）本来就按子串匹配，
// 改前改后都认得对。
//
// 判据写在下面几张表里。改这里之前先想清楚新规则会不会把「等下再说」认成开工——
// 那条是这套东西最容易塌的地方。

// 起始词：只说明「要开始做」，它们后面才是真正在做的事。抽事情名时剥掉。
const LEAD_VERBS = '去|来|开始|着手|动手|接着|继续|顺便|顺手';

// 实义动作词：这些词本身就是在做的事，前面不需要再跟「去」。
// 多字词放在前面：正则交替从左到右取第一个能匹配的。
const ACT_VERBS =
  '收拾|整理|处理|部署|重构|打扫|联系|核对|测试|检查|安装|写|改|修|洗|做|弄|搞|煮|炒|蒸|试|跑|查|调|接|发|建|装|清|刷|倒|拖|吹';

// 句首可以有的铺垫词：我、我先、我现在、那我这就……
const LEAD = '(?:那?我|咱|俺)?\\s*(?:就|先|现在|这就|马上|立刻|正在|在)?\\s*';

// 两条路。
// A：有起始词，后面跟什么都算——「我去超市」「我去洗个头」。
// B：没起始词，那么必须直接以实义动词或把/将开头——「我改个 bug」「我把头洗了」。
// B 不能放宽成「任意内容」，不然每句话都成开工句了。
const START_WITH_LEAD = new RegExp(`^${LEAD}(?:(?:${LEAD_VERBS})\\s*)+(.{1,40})$`);
const START_WITH_ACT = new RegExp(`^${LEAD}((?:${ACT_VERBS}|把|将).{0,40})$`);

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

// 把字句重排成动宾：「把那个 bug 改一下」→「改 bug」。
// 只在句尾真的是实义动词时生效；「洗头」「写代码」这种本来就是动宾的不动。
const BA_RE = new RegExp(
  `^(?:把|将)?\\s*(.{1,24}?)\\s*(${ACT_VERBS})(?:一?下|一?会儿?|完|好|了)*$`
);

function reorderBa(s) {
  const m = BA_RE.exec(s);
  if (!m) return s;
  // 宾语里的指示词没信息：那个筛选器 → 筛选器
  const obj = m[1].replace(/^(?:那|这)(?:个|些|条|件|篇)?/, '').trim();
  return obj ? `${m[2]}${obj}` : s;
}

// 抽出来的事情名要收干净
function tidy(what) {
  let s = String(what ?? '')
    .replace(/^[了的着]+/, '')
    .replace(/[了呀啊哦嗯~～。！!，,、\s]+$/g, '')
    .trim();

  s = reorderBa(s);

  // 动词后面的量词没信息：洗个头 → 洗头，整理一下房间 → 整理房间。
  // 要求后面还有东西（lookahead），不然「洗个」会被剥成「洗」。
  s = s.replace(/^(.{1,3}?)(?:一?个|一下|一会儿?|两下|一点儿?)(?=.)/, '$1');
  // 尾巴上的同类词
  s = s.replace(/(一下|一会儿?|一点|下)$/, '');

  return s.trim();
}

// 这句话是不是「我现在开始做某件事」。是就返回事情本身，不是就返回 null。
// text 应该是已经剥掉 <environment> 和 <sent_at> 的干净正文。
export function detectStart(text) {
  const s = String(text ?? '').trim();
  // 太长的句子里通常夹着别的意思，不当开工句
  if (!s || s.length > 60) return null;
  if (NOT_YET.test(s) || ASKING.test(s)) return null;

  // 去掉句首的「我」再判断主语，不然 OTHERS 对不上
  const body = s.replace(/^(?:那?我|咱|俺)\s*/, '');
  if (OTHERS.test(body)) return null;

  const m = START_WITH_LEAD.exec(s) ?? START_WITH_ACT.exec(s) ?? ONGOING_RE.exec(s);
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
