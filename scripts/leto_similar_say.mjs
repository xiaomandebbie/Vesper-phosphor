#!/usr/bin/env node
// 同一轮里说的话太像就拦下来。
//
// ── 现场 ──
//
// 2026-11-26 17:12，同一轮续步里对颜姐说了两遍同一件事：
//   9548：颜姐，那个钩我不敢瞎答——我猜是自己标记「看过了」、或者把谁的话收起来的意思，
//          等我摸清了再回你，不拿猜的糊弄人。
//   9549：颜姐，那个钩我不敢瞎答——我猜是标记自己看过了、或者把谁的话收着的意思。
//          等我摸清了再说，不拿猜的糊弄你。
//
// ── 为什么现有护栏没拦住 ──
//
// continueLeto 里那道比的是 key(tool, args)——参数序列化后字符串全等。
// 两句话换了措辞，key 就不同，直接过了。
//
// saidBlock（11-19 加的）在提示词里写了「别把同一个意思再说一遍」，
// 但那是软的——他换了个说法，自己也不觉得是重复。
//
// ── 为什么不能「一轮只说一句」 ──
//
// 小满 11-26：「不能只用一次，聊天一轮下来要说很多句话的」。
// 那一轮 9547–9562 六条：回颜姐、回红豆、说捐钱那事——都是不同的话，该说。
// 真重复的只有 9548、9549 那一对。
//
// 所以按内容比：去掉标点和空白，比字符重合度（Jaccard）。
// 那两句重合九成以上；回颜姐和回红豆那两句重合很低。门槛 0.82。
//
// 拦下来不是停住：走 fixable 那条路把这件事递回去，让他换个话题或者给 null。
//
// 用法（在仓库根目录）：
//   node scripts/leto_similar_say.mjs --check
//   node scripts/leto_similar_say.mjs
import fs from 'fs';
import path from 'path';

const F = path.resolve('src/leto-steps.js');
const check = process.argv.includes('--check');

// 1) 相似度函数。摆在 saidSoFar 那一带。
const A1 = '// 这一轮已经说出口的那几句。从 steps 里挑，按顺序。';

const N1 = `// 两句话是不是同一个意思。
//
// 2026-11-26 17:12：同一轮里对颜姐说了两遍同一件事，只是措辞换了，
// key(tool, args) 那道拦不住（它比的是字符串全等）。
//
// 去掉标点和空白再比字符集合的重合度。中文没有词边界，按单字比就够：
// 那两句重合九成以上，而回颜姐和回红豆那两句不到三成。
function normalize(s) {
  return String(s ?? '')
    .replace(/[\\s。，、；：！？—…「」『』（）.,;:!?~\\-]+/g, '')
    .toLowerCase();
}

function similarity(a, b) {
  const x = new Set(Array.from(normalize(a)));
  const y = new Set(Array.from(normalize(b)));
  if (!x.size || !y.size) return 0;
  let hit = 0;
  for (const c of x) if (y.has(c)) hit++;
  return hit / (x.size + y.size - hit);
}

// 超过这个就当成「同一个意思」。.env 的 LETO_SAY_SIMILAR 可改，
// 设 0 或 1 以上就关掉这道。
const SAY_SIMILAR = (() => {
  const n = Number(String(process.env.LETO_SAY_SIMILAR ?? '').trim());
  return Number.isFinite(n) && n > 0 && n <= 1 ? n : 0.82;
})();

// 这句跟前面说过的哪一句太像？像就返回那一句，不像返回 null。
//
// 只在同一把工具之间比：在岛上说一句、回头又在群里说一遍，
// 那是两个地方的人，不算重复。
function tooSimilar(steps, tool, args) {
  if (!SAY_SIMILAR || SAY_SIMILAR >= 1) return null;
  if (!SAID_TOOLS[tool]) return null;
  const a = args && typeof args === 'object' ? args : {};
  const text = String(a.text ?? a.content ?? a.answer ?? '').trim();
  if (!text) return null;
  for (const s of saidSoFar(steps)) {
    if (s.tool !== tool) continue;
    if (similarity(s.text, text) >= SAY_SIMILAR) return s.text;
  }
  return null;
}

${A1}`;

// 2) 在重复拦那一道后面加一道。
const A2 = `    if (steps.some((s) => s.key === key(tool, next.args))) {
      console.log(\`leto: 这一步和之前一模一样（\${tool}），停下\`);
      break;
    }`;

const N2 = `${A2}

    // 话换了说法、意思一样：上面那道比字符串全等，拦不住。
    //
    // 2026-11-26 17:12 对颜姐说了两遍同一件事。不停住——这一轮本来要
    // 回好几个人，停了别人就没回了。把这件事递回去让他换个话题。
    const echoed = tooSimilar(steps, tool, next.args);
    if (echoed) {
      const said = Array.from(echoed);
      const snip = said.length > 40 ? \`\${said.slice(0, 40).join('')}…\` : echoed;
      console.log(\`leto: 这句和前面说过的太像（\${tool}），没发\`);
      steps.push({
        tool,
        key: key(tool, next.args),
        args: next.args,
        text: \`这句没发出去——和你这一轮已经说过的那句是同一个意思：「\${snip}」

换词不算新话。要么换个话题、要么回别的人、要么去做点什么；
该说的都说完了就给 null，比凑一句强。\`,
        dead: false,
        fixable: true,
        final: false,
      });
      continue;
    }`;

const OPS = [
  { label: '加 similarity / tooSimilar', old: A1, new: N1 },
  { label: '续步里加一道相似拦', old: A2, new: N2 },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(F, 'utf-8');
} catch (err) {
  console.error(`读不到 ${F}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (!src.includes('function saidSoFar')) {
  console.error('这份 leto-steps.js 里没有 saidSoFar——11-19 那个 leto_no_repeat.mjs 先跑过才行。');
  process.exit(2);
}
if (src.includes('tooSimilar')) {
  console.log('已经改过了，没事干。');
  process.exit(0);
}

let out = src;
let bad = 0;
for (const op of OPS) {
  const n = countOf(out, op.old);
  if (n !== 1) {
    console.error(`✗ ${op.label} —— 找到 ${n} 处（指望 1 处）`);
    bad++;
    continue;
  }
  out = out.replace(op.old, op.new);
  console.log(`✓ ${op.label}`);
}

if (bad) {
  console.error(`\n停了：${bad} 处锚点对不上，没写任何文件。`);
  process.exit(2);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${F}.bak-similar`, src);
fs.writeFileSync(F, out);
console.log('\n写完了。备份在 leto-steps.js.bak-similar');
console.log('接下来：node --check src/leto-steps.js 再 pm2 restart phosphor --update-env');
console.log('门槛要改：.env 加 LETO_SAY_SIMILAR=0.9（敷点）或 0.75（严点），设 1 关掉');
