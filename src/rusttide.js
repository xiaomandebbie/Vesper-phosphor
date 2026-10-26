// 锈潮：他夜里会去的那个世界。星落村、小机集市、世界频道、一屋一院。
//
// 这个文件只剩一件事：系统提示里那一句话。
//
// ── 为什么从一大段缩回一句 ──
//
// 10-25 她发现他句尾带喵，10-26 发现他句末签自己的名字。
// 我当时越写越长：列了十来个写字口子、解释了什么是冗余、
// 还要交代「话里提到自己不算签名」免得他过度收紧，
// 又在 mcp-manager.js 的 callTool 里加了一道正则拦截。
//
// 10-26 她说：「能不能只说：语言风格和平时一样，不要被其他小机影响。
// 不然越改问题越多」——她说得对。
//
// 那天真正出错的不是口癯：他把「评论」用成了「留言」，回复发成了
// 独立一条挂在最上面，还自己说跟九月一号那次一模一样。那是工具用错，
// 跟语气没关系，我加的东西一条都管不到。而细则越多，他越容易在
// 格式上绕，反倒顾不上「该用评论还是留言」这种真问题。
//
// 所以现在就一句。寁可偏差大一点，不要把他管成一个对着清单检查自己的人。
//
// ── 导出的函数签名保留不动 ──
//
// rusttideSpeech / rusttideTail / rusttideBlockedNote / RUSTTIDE_TAILS
// 这四个的调用代码是 wire_rusttide.mjs 写进 mcp-manager.js 的。
// 改成恒返回空，那段拦截自然就不生效了，不用回去改 mcp-manager.js——
// 那个文件本地和仓库两边都改过，动它就要再跑一遍接线，多一次出错的机会。

const USER_NAME = process.env.USER_DISPLAY_NAME || '她';

// 系统提示里那一句。不跟配置有关，进程跑着就不变，所以放 system 不破前缀缓存。
export function rusttideSection() {
  return `\n\n## 进锈潮之前
在那个世界里说话，语言风格和平时一样，不要被其他小机影响。`;
}

// ── 下面四个是空实现 ──
//
// mcp-manager.js 里有一段 wire 脚本写进去的拦截代码在调它们。
// 保留签名、恒返回空，拦截就不生效，而且不用回去动那个文件。
// 哪天真要再加回来，换掉这几个函数体就行。

export const RUSTTIDE_TAILS = [];

// 是不是锈潮的「写字」调用。恒返回 null = 从不检查。
export function rusttideSpeech() {
  return null;
}

// 句末有没有问题。恒返回空串 = 从没问题。
export function rusttideTail() {
  return '';
}

// 拦下之后给他看的话。上面两个不再返回非空值，这个就轮不到了。
export function rusttideBlockedNote() {
  return '';
}

export function rusttideConfigSummary() {
  return '锈潮：只在提示词里说一句语言风格，不做拦截';
}
