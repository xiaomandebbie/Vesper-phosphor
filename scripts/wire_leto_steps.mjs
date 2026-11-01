#!/usr/bin/env node
// 把 continueLeto 注册进 phosphor.js 的 registerContinuers。
// 服务器上这份 phosphor.js 是一层层 wire 脚本打出来的，和仓库不一样，
// 所以不写死锚点：自己找，形状认不出就把实际那几行打出来，不猜。
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/phosphor.js');
let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}
if (src.includes('continueLeto')) {
  console.log('已经注册过了，没事干。');
  process.exit(0);
}
let out = src;

const impRe = /^import \{[^}]*\} from '\.\/[a-z-]+-steps\.js';$/m;
const impHit = out.match(impRe);
if (!impHit) {
  console.error('停了：找不到任何 *-steps.js 的 import。实际这几行是：');
  console.error(out.split('\n').filter((l) => /-steps\.js|registerContinuers/.test(l)).join('\n') || '（一行都没有）');
  process.exit(2);
}
out = out.replace(impHit[0], `${impHit[0]}\nimport { continueLeto } from './leto-steps.js';`);
console.log(`import 加在：${impHit[0]}`);

const regRe = /registerContinuers\(\[/;
if (!regRe.test(out)) {
  console.error('停了：没有 registerContinuers([ 这个形状。实际是：');
  console.error(out.split('\n').filter((l) => l.includes('registerContinuers')).join('\n') || '（没有这一行）');
  process.exit(2);
}
out = out.replace(regRe, 'registerContinuers([\n  // Leto：读完要接着把话交回去（见 leto-steps.js）\n  continueLeto,');
console.log('注册：continueLeto 加进 registerContinuers');

fs.writeFileSync(`${FILE}.bak-letosteps`, src);
fs.writeFileSync(FILE, out);
console.log('\n写完了。备份在 phosphor.js.bak-letosteps');
