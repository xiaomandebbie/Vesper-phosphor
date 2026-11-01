#!/usr/bin/env node
// 修大小写别名。
//
// 上一版在 connectAll() 里写 clients.Leto = clients.leto，那是拿当时的值做别名。
// 重连（reconnect）或者 connectAll 跑第二遍时，clients.leto 换成了新的 client，
// 而 clients.Leto 还指着旧的那个——已经 close 掉的。他偏偏一直写大写 "Leto"，
// 走的就是这条坏的，于是 executeAction 里抛错、被 catch 吞成 null。
//
// 改成在查表那一步按不区分大小写找真名，这样不管重连几次都对得上。
import fs from 'fs';
import path from 'path';

const FILE = path.resolve('src/mcp-manager.js');

// 1) 拆掉上一版那两行别名
const ALIAS_OLD = `      // 他自己写名字时大小写不定（2026-11-01 03:13 那次写的是 "Leto"，
      // 查表查不到就报 is not connected）。挂个别名，两种都认。
      connectors.Leto = connectors.leto;
      clients.Leto = clients.leto;
`;

// 2) withClient 查表前先把名字归一
const WITH_OLD = `async function withClient(name, fn) {
  let client = clients[name];`;

const WITH_NEW = `// 他写 server 名时大小写不定（"leto" / "Leto" 都出现过）。
// 在这里归一成登记时的真名，比挂别名可靠：别名是值的快照，
// 重连换掉 client 之后就指着废的那个了。
function realName(name) {
  const n = String(name ?? '');
  if (connectors[n]) return n;
  const lower = n.toLowerCase();
  return Object.keys(connectors).find((k) => k.toLowerCase() === lower) ?? n;
}

async function withClient(rawName, fn) {
  const name = realName(rawName);
  let client = clients[name];`;

let src;
try {
  src = fs.readFileSync(FILE, 'utf-8');
} catch (err) {
  console.error(`读不到 ${FILE}：${err.message}（要在仓库根目录跑）`);
  process.exit(1);
}

let out = src;

if (out.includes('function realName(')) {
  console.log('已经修过了，没事干。');
  process.exit(0);
}

if (out.includes(ALIAS_OLD)) {
  out = out.replace(ALIAS_OLD, '');
  console.log('拆掉：旧的两行别名');
} else {
  console.log('旧别名不在（可能手改过），跳过');
}

const n = out.split(WITH_OLD).length - 1;
if (n !== 1) {
  console.error(`停了：withClient 锚点找到 ${n} 处（指望 1 处）。没写任何文件。`);
  process.exit(2);
}
out = out.replace(WITH_OLD, WITH_NEW);
console.log('改了：withClient 查表前归一名字');

fs.writeFileSync(`${FILE}.bak-alias`, src);
fs.writeFileSync(FILE, out);
console.log('\n写完了。备份在 mcp-manager.js.bak-alias');
