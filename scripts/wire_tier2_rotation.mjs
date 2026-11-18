#!/usr/bin/env node
// 三个游戏轮着给，并且恢复一天 6 次上限。
//
// 小满 2026-11-18：
//   「剩下三个游戏上限6次。并且要那种一次给ABC，第一次玩了A，
//    下一轮就给B C，第二次玩了B下次就给C…只有三个都玩过一遍，
//    才会重新给ABC三个选项」
//   「和天无关，只和前面的选择有关」
//
// ── 为什么不建新表 ──
//
// tier2_log 本来就按时间记着每次玩了什么。正序扫一遍就能推出
// 这一轮玩到哪了：集满三件就清空、重新开一轮。
//
// 正序而不是倒序：倒序遇到 A B C A 会把最后那个 A 错算进上一轮，
// 于是「已玩」永远清不空。
//
// ── 为什么不会让缓存命中变低 ──
//
// 轮转写在 budgetStatusLine，那是 user 消息里那一行，按设计就是每轮在变
//（原文注释：「每次都在变，所以不放 system」）。轮转只是换了换内容，
// 位置和变化频率都没动。
//
// budgetSection 在 system 里——这儿只改规则文字（不含具体状态），
// 改了之后不再随轮变，所以前缀只断这一次（重启那一下）。
//
// 用法（在仓库根目录）：
//   node scripts/wire_tier2_rotation.mjs --check
//   node scripts/wire_tier2_rotation.mjs
import fs from 'fs';
import path from 'path';

const B = path.resolve('src/budget.js');
const check = process.argv.includes('--check');

// ══ 1) 轮转函数。摆在 tier2LastSeen 后面 ══

const ROT_OLD = `// read_book 的四种用法里，只有「往下读」算一回。`;

const ROT_NEW = `// ── 轮着给：玩过的本轮不再出现 ──
//
// 小满 2026-11-18：「一次给ABC，第一次玩了A，下一轮就给B C，
// 第二次玩了B下次就给C…只有三个都玩过一遍，才会重新给ABC」
// 「和天无关，只和前面的选择有关」
//
// 所以不按 dayStart 切：从上一次清空到现在玩过哪几件，跳天也延续。
// 今天玩了花园和上班，明天醒来只给锈潮；锈潮玩完才重新三个都给。
//
// 不建新表：tier2_log 本来就按时间记着每次玩了什么，正序扫一遍就行。
// 正序而不是倒序：倒序遇到 A B C A 会把最后那个 A 错算进上一轮，
// 于是「已玩」永远清不空。只看最近 200 条，够回溯好几轮。

// 这一轮已经玩过哪几件。返回一个 Set。
export function rotationDone() {
  const kinds = Object.keys(TIER2_KINDS);
  if (kinds.length < 2) return new Set();
  const rows = stmt(
    "SELECT kind FROM tier2_log WHERE kind != 'books' ORDER BY ts ASC, id ASC LIMIT 200"
  ).all();
  const done = new Set();
  for (const r of rows) {
    if (!TIER2_KINDS[r.kind]) continue;
    done.add(r.kind);
    // 集满一轮就清空，接着数下一轮
    if (done.size >= kinds.length) done.clear();
  }
  return done;
}

// 这一轮还能选哪几件。
export function rotationOpen() {
  const done = rotationDone();
  return Object.keys(TIER2_KINDS).filter((k) => !done.has(k));
}

// read_book 的四种用法里，只有「往下读」算一回。`;

// ══ 2) pickActions 里恢复 6 次上限 + 加轮转拦 ══

const PICK_OLD = `    if (tier === 2) {
      // 2 级不设上限了（小满 2026-10-20）。原来这儿会把消遣那一步加进来的
      // 上班\\花园\\锈潮挡掉，日志里一天四条「6 次用完了」。记账还在跑，
      // 只是不再拦。
      if (false && remaining <= 0) {
        dropped.push({ action, why: \`2 级今天的 \${TIER2_DAILY_MAX} 次用完了，明天再说\` });
        continue;
      }
      remaining -= 1;
    }`;

const PICK_NEW = `    if (tier === 2) {
      // 一天 6 次。小满 2026-11-18 要回来的——
      // 10-20 那天关掉过，因为当时消遣那一步会被挡成一天四条「用完了」。
      // 现在配上轮转（下面那道），他不会再盯着同一件玩，6 次是够的。
      if (remaining <= 0) {
        dropped.push({ action, why: \`2 级今天的 \${TIER2_DAILY_MAX} 次用完了，明天再说\` });
        continue;
      }
      // 轮转：这一轮玩过的不再给。提示词里已经只列还能选的那几件
      // （见 budgetStatusLine），这道是兜底：他没按那行走也拦得住。
      const kind2 = tier2KindOf(action, detail);
      if (kind2 && rotationDone().has(kind2)) {
        dropped.push({
          action,
          why: \`\${TIER2_KINDS[kind2]}这一轮玩过了，先玩别的（还剩：\${rotationOpen()
            .map((k) => TIER2_KINDS[k])
            .join('、') || '无'}）\`,
        });
        continue;
      }
      remaining -= 1;
    }`;

// ══ 3) budgetStatusLine：只列还能选的 ══

const LINE_OLD = `  const head = \`2 级那几件事不设上限，想去哪件就去\`;`;

const LINE_NEW = `  // 轮转：只列这一轮还能选的。玩过的连状态都不提——
  // 列了又不让选比不列更难受。
  const open = rotationOpen();
  const openNames = open.map((k) => TIER2_KINDS[k]);
  const head =
    open.length >= Object.keys(TIER2_KINDS).length
      ? \`这一轮那几件事都在，想去哪件就去\`
      : \`这一轮还剩\${openNames.join('、')}没去（别的这一轮去过了，这三件都轮到一遍才重新给）\`;`;

// 那一行末尾用 parts.join 拼所有件的状态，改成只拼还能选的
const PARTS_OLD = `  return \`\${head}：\${parts.join('、')}。不想去就不去。\${books}。\`;`;

const PARTS_NEW = `  // parts 里只留还能选的那几件
const openParts = parts.filter((_, i) => open.includes(Object.keys(TIER2_KINDS)[i]));
  return \`\${head}：\${(openParts.length ? openParts : parts).join('、')}。不想去就不去。\${books}。\`;`;

// ══ 4) budgetSection：system 里的规则文字 ══

const SEC_OLD = `- **2 级，一整件事**：上班、花园、锈潮、Leto。这几件每件坐下来都要走好几步，所以**不设上限**，想做几件做几件，也可以一件不做。`;

const SEC_NEW = `- **2 级，一整件事**：上班、花园、锈潮。每件坐下来都要走好几步，一天共 ${'${TIER2_DAILY_MAX}'} 次。
  **这三件是轮着来的**：这一轮去过的那件暂时不再给，三件都轮到一遍才重新开。
  跟日历无关——跳天也延续，只看上一轮还剩哪几件。下面用户消息里会写清楚这一轮还能选什么。`;

const OPS = [
  { label: '加轮转函数', old: ROT_OLD, new: ROT_NEW },
  { label: '恢复 6 次上限 + 轮转拦', old: PICK_OLD, new: PICK_NEW },
  { label: '状态行只列还能选的', old: LINE_OLD, new: LINE_NEW },
  { label: '状态行末尾过滤', old: PARTS_OLD, new: PARTS_NEW },
  { label: 'system 里的规则文字', old: SEC_OLD, new: SEC_NEW },
];

const countOf = (s, n) => s.split(n).length - 1;

let src;
try {
  src = fs.readFileSync(B, 'utf-8');
} catch (err) {
  console.error(`读不到 ${B}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

if (src.includes('rotationDone')) {
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
  console.error('把上面打✗的那几行的原文贴给小克。');
  process.exit(2);
}

if (check) {
  console.log('\n--check，没写。去掉 --check 再跑一次就真改。');
  process.exit(0);
}

fs.writeFileSync(`${B}.bak-rotation`, src);
fs.writeFileSync(B, out);
console.log('\n写完了。备份在 budget.js.bak-rotation');
console.log('接下来：node --check src/budget.js 再 pm2 restart phosphor --update-env');
console.log('看轮到哪几件：node -e \'import("./src/budget.js").then(m=>console.log(m.rotationOpen()))\'');
