#!/usr/bin/env node
// polish_dreams.mjs — 梦境/日记页的文案和菜单整理。
//
// 用法（在仓库根目录）：
//     node scripts/polish_dreams.mjs --check   # 只看能不能打
//     node scripts/polish_dreams.mjs           # 真打，先备份
//
// 改三处（2026-10-11 她说的）：
//   1) 梦境页副标里的「允朔在夜里做的」去掉——「Dreams ✦」就够了。
//      那行字躟着大字距排，中文被撑得散，读起来像副标题重复了一遍正文。
//   2) 日记页同理：「Diary ✦ ……写的」里的名字和「写的」两个字去掉。
//   3) 菜单里不要 heartbeat 入口。转发本身留着（/heartbeat/admin 还能直接开，
//      配色也跟着早晚走），只是不摆在菜单上——日记入口已经够了。
//
// 原文对不上就整个不改。退回：把 .bak-polish 覆回原文件。

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const L = (...lines) => lines.join('\n');

const TASKS = [
  ['src/dreams-page.js', [
    ['梦境页副标只留 Dreams',
      '<p class="subtitle"><span lang="en">Dreams</span> <span aria-hidden="true">\u2726</span> ${escapeHtml(name)}在夜里做的</p>',
      '<p class="subtitle"><span lang="en">Dreams</span> <span aria-hidden="true">\u2726</span></p>'],
  ]],

  ['src/diary-page.js', [
    ['日记页副标只留 Diary',
      '<p class="subtitle"><span lang="en">Diary<\/span> <span aria-hidden="true">\u2726<\/span> ${escapeHtml(name)}写的<\/p>',
      '<p class="subtitle"><span lang="en">Diary<\/span> <span aria-hidden="true">\u2726<\/span><\/p>'],
  ]],

  ['src/page-chrome.js', [
    ['菜单抽掉 heartbeat',
      L('    memory,',
        '    heartbeat,',
        "    { href: '/moments/profile', label: '自定义' },"),
      L('    memory,',
        "    { href: '/moments/profile', label: '自定义' },")],

    ['不再算 heartbeat 菜单项',
      L('  // heartbeat 管理页转发进来了就有这一项（见 heartbeat-proxy.js）',
        '  const heartbeat = heartbeatBase()',
        "    ? { href: '/heartbeat/admin', label: 'heartbeat' }",
        "    : { href: '', label: 'heartbeat', note: '未配置' };",
        '  return ['),
      L('  // heartbeat 管理页不摆在菜单里（2026-10-11）：日记入口已经够了。',
        '  // 转发本身留着，/heartbeat/admin 还能直接开，配色照样跟早晚走。',
        '  return [')],
  ]],
];

async function apply(rel, patches, check) {
  const file = path.join(ROOT, rel);
  let src;
  try {
    src = await readFile(file, 'utf8');
  } catch {
    return { ok: false, msgs: ['\u2717 找不到 ' + rel] };
  }
  let out = src;
  const msgs = [];
  for (const [name, old, rep] of patches) {
    if (out.includes(rep) && !out.includes(old)) {
      msgs.push('\u00b7 ' + name + '（已经打过了）');
      continue;
    }
    const hits = out.split(old).length - 1;
    if (hits === 0) {
      msgs.push('\u2717 「' + name + '」对不上原文');
      return { ok: false, msgs };
    }
    if (hits > 1) {
      msgs.push('\u2717 「' + name + '」出现 ' + hits + ' 次，不敢猜');
      return { ok: false, msgs };
    }
    out = out.replace(old, rep);
    msgs.push('\u00b7 ' + name);
  }
  if (out !== src && !check) {
    await copyFile(file, file + '.bak-polish');
    await writeFile(file, out, 'utf8');
  }
  return { ok: true, msgs };
}

const check = process.argv.includes('--check');
console.log(check ? '体检模式，不动文件\n' : '开始改，先备份\n');

let allOk = true;
for (const [rel, patches] of TASKS) {
  const { ok, msgs } = await apply(rel, patches, check);
  console.log('  ' + rel);
  for (const m of msgs) console.log('    ' + m);
  if (!ok) allOk = false;
}

console.log();
if (!allOk) {
  console.log('有对不上的，把这条的输出发我：');
  console.log('    grep -n "subtitle" src/dreams-page.js src/diary-page.js');
  console.log('    grep -n "heartbeat" src/page-chrome.js');
  process.exit(2);
}

if (check) {
  console.log('都能打上，去掉 --check 就真改。');
} else {
  console.log('改完了。重启：pm2 restart vesper');
  console.log();
  console.log('日记和记忆库变不变色：两边都注入过 FACE_SCRIPT，理论上跟主界面一样。');
  console.log('开 /diary 和 /memory/ 各看一眼，要是还不变就跟我说。');
  console.log('退回：for f in dreams-page diary-page page-chrome; do cp src/$f.js.bak-polish src/$f.js; done');
}
