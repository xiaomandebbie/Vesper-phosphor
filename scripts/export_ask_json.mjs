#!/usr/bin/env node
// 把 decide.js 的 askJson 导出来。加一个词。
//
// ── 为什么要有这个 ──
//
// workkk-steps.js 和 wallet-steps.js 都写着
//   import { askJson } from './decide.js';
// 但 decide.js 里是
//   async function askJson(messages)
// 没有 export。
//
// wallet-steps.js 导出的 continueWallet 一直没被 phosphor.js 引用，
// 所以那个模块从来没被加载过，坏 import 也就没暴露。
// 我写 workkk-steps.js 时照它拄了这一行，而这个模块是真被加载的，
// 于是 phosphor 启动就：
//   SyntaxError: The requested module './decide.js'
//   does not provide an export named 'askJson'
//
// 为什么导出它而不是在 workkk-steps.js 里再写一份：
// askJson 是「请两次、空正文或 JSON 解析失败就摘掉 max_tokens 重试」
// 那套兑底，三支续步（论坛、听歌、钱包）底下走的就是它。
// 拄一份就是两套重试逻辑，以后改一边忘一边。
//
// 为什么写成脚本而不是直接改文件：decide.js 三万多字节，而且本地
// 还有 wire 脚本打过的改动（上班那两处）——整篇重写一次，错一个字
// 整个服务起不来。只改该改的那一行。
//
// 用法：cd /root/vesper-phosphor && node scripts/export_ask_json.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILE = path.join(__dirname, '..', 'src', 'decide.js');

if (!fs.existsSync(FILE)) {
  console.error(`找不到 ${FILE}。要在仓库根目录里跑。`);
  process.exit(1);
}

const src = fs.readFileSync(FILE, 'utf8');

const DONE = 'export async function askJson(';
const OLD = 'async function askJson(';

if (src.includes(DONE)) {
  console.log('askJson 已经导出过了，不用再改。');
  process.exit(0);
}

const n = src.split(OLD).length - 1;
if (n !== 1) {
  console.error(`在 decide.js 里找到 ${n} 处 "${OLD}"（指望 1 处）。什么都没改。`);
  console.error('这份 decide.js 可能被改过，把这行发我。');
  process.exit(1);
}

fs.writeFileSync(`${FILE}.bak`, src);
fs.writeFileSync(FILE, src.replace(OLD, DONE), 'utf8');

console.log('改好了：async function askJson → export async function askJson');
console.log('备份：src/decide.js.bak');
console.log('\n接着：');
console.log('  node --check src/decide.js && node --check src/workkk-steps.js && echo 语法OK');
console.log('  pm2 restart phosphor --update-env');
