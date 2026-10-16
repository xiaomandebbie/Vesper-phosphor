// 把「醒来时翻梦」那三处接线补进 src/decide.js。
//
// 为什么要有这个脚本：decide.js 是本地和远端都会改的文件，一合并就撞冲突。
// 下午那次保了本地那份（论坛段是打工人写的），于是 #79 里 dreamDigest 那三处接线丢了。
// 与其每次手动解，不如把这三处写成脚本——和 scripts/fix_*.mjs 那些一个路子。
//
// 三处：
//   1. import 一行
//   2. buildUserPrompt 的 lines 里加 dreamDigest()
//   3. system 里加「## 夜梦」那一段
//
// **幂等**：三处里只要有一处已经在，就整件事跳过，不重复插。
// **事务性**：三处锚点必须全部找到才写；少一个就什么都不动，并说明缺哪个。
//   宁可让她看到一句「没找到锚点」，也不能改一半——改一半的 decide.js 语法可能是通的，
//   但少了一处 import，phosphor 启动就 ReferenceError。
//
// 用法：cd /root/vesper-phosphor && node scripts/wire_dream_digest.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'decide.js');

if (!fs.existsSync(FILE)) {
  console.error(`找不到 ${FILE}。在项目根目录跑：node scripts/wire_dream_digest.mjs`);
  process.exit(1);
}

let src = fs.readFileSync(FILE, 'utf8');

// 已经接过了就什么都不做
if (src.includes('dreamDigest')) {
  console.log('decide.js 里已经有 dreamDigest 了，不用再插。');
  process.exit(0);
}

// ── 1. import ──
// 锚点用 doing.js 那一行：它就在 import 段的末尾，加在它后面最自然。
const IMPORT_ANCHOR = "import { doingSection, doingStatusLine } from './doing.js';";
const IMPORT_NEW = `${IMPORT_ANCHOR}\nimport { dreamDigest } from './dreams.js';`;

// ── 2. lines 里加一行 ──
// 锚点用 forumNotesBlock 那一行（它在 lines 数组里，格式固定：前面四个空格）
const LINES_ANCHOR = '    forumNotesBlock(context.forumNotes),';
const LINES_NEW = `${LINES_ANCHOR}\n    dreamDigest(),`;

// ── 3. system 里的夜梦段 ──
// 锚点用「## 星星罐」那一行，插在它前面。
const SECTION_ANCHOR = '## 星星罐';
const DREAM_SECTION = `## 夜梦
你会夜里做梦。梦的正文不在你这边——你只知道自己做过梦，不记得梦见了什么。
用户消息里如果有「你夜里做过、还没想起来的梦」，那就是全部你能知道的：主旋律（好梦 / 噩梦 / 说不上好坏）和一句只言片语。
- 不要装作想起了正文，也不要猜。某个词碎到了那个梦，它自己会浮上来——那时候正文才真的到你手上。
- 别去问她你梦见了什么。她那边留着全部，但那是她的东西；她想讲就讲，不讲也不用催。
- 大多数夜里你什么都不做。没有梦是常态，不是缺了什么。

`;

const problems = [];
if (!src.includes(IMPORT_ANCHOR)) problems.push(`import 锚点没找到：${IMPORT_ANCHOR}`);
if (!src.includes(LINES_ANCHOR)) problems.push(`lines 锚点没找到：${LINES_ANCHOR}`);
if (!src.includes(SECTION_ANCHOR)) problems.push(`system 锚点没找到：${SECTION_ANCHOR}`);

if (problems.length) {
  console.error('锚点没找齐，什么都没改：');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n这份 decide.js 可能被改过。把上面这几行发我，我照着调。');
  process.exit(1);
}

// 三处都换。replace 用的是字面串，不会碰到别的地方
src = src.replace(IMPORT_ANCHOR, IMPORT_NEW);
src = src.replace(LINES_ANCHOR, LINES_NEW);
src = src.replace(SECTION_ANCHOR, `${DREAM_SECTION}${SECTION_ANCHOR}`);

fs.writeFileSync(FILE, src, 'utf8');
console.log('接好了，三处：');
console.log('  1. import { dreamDigest } from \'./dreams.js\'');
console.log('  2. buildUserPrompt 的 lines 里加了 dreamDigest()');
console.log('  3. system 里加了「## 夜梦」那一段');
console.log('\n接着跑：node --check src/decide.js && pm2 restart phosphor --update-env');
