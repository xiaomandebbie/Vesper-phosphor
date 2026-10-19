#!/usr/bin/env node
// 最后两件事。
//
// 一、书架卡只显示他读到哪里，小满那条线没显示
//    小满 2026-10-19：「现在共读只登记他的进度了不登记我的进度」
//
//    写入一直是好的（book_progress 里 who='user' 的行一直在更新，
//    POST /api/progress 也正常进来）。是 description 那段只取了 'assistant'，
//    所以她那条根本没发给前端。两条一起发就行，前端不用改。
//
// 二、1 级五件事抢同一个座位
//    小满：「他唤醒看了音乐和书，还是没看论坛」
//
//    论坛、听歌、钱包、批注本、小酒馆全是 1 级，而「每级最多一件」——
//    他选了音乐，论坛那一刻就被 dropped 掉了。不是他不想去，是程序不让。
//    上一轮给 1 级补了状态行，让他看见了这五件事，但座位还是一个。
//
//    所以把 taken 从 Set 换成计数，并给 1 级单独设上限 2。其他级不动：
//    2 级一件（一整件事本来就费力气），3 级一件（会惊动她的别扑过来两下）。
//    .env 里可以用 TIER1_PER_WAKE 改成别的数。
//
// 两个文件分属不同进程，分开重启：
//   books-page.js → 网页路由 → pm2 restart vesper
//   budget.js     → 唤醒循环 → pm2 restart phosphor
//
// 跑法（在 /root/vesper-phosphor 下）：
//   node scripts/finish_shelf_and_tier1.mjs
//   pm2 restart vesper phosphor --update-env
//
// 找不到锚点就整个文件还原并把周围原文打出来，不乱改。重复跑安全。

import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';

const ROOT = process.cwd();

// ── 一、书架卡两条进度线 ──

const OLD_DESC = `    description: (() => {
      if (!total) return '';
      const his = progressOf(b.id, 'assistant');
      const at = Math.min(his.para_idx, total);
      if (!at) return \`\${AI_DISPLAY} \u8fd8\u6ca1\u5f00\u59cb\u8bfb\`;
      return \`\${AI_DISPLAY} \u8bfb\u5230 \${Math.round((at / total) * 100)}% \uff08\u7b2c \${at} \u6bb5\uff09\`;
    })(),`;

const NEW_DESC = `    // 两条线一起发（2026-10-19：原来只取了 assistant，所以书架卡上看不到她读到哪里。
    // 写入一直是好的，是这儿没把她那条发给前端）
    description: (() => {
      if (!total) return '';
      const line = (p, name) => {
        const at = Math.min(p?.para_idx ?? 0, total);
        if (!at) return \`\${name} \u8fd8\u6ca1\u5f00\u59cb\u8bfb\`;
        return \`\${name} \u8bfb\u5230 \${Math.round((at / total) * 100)}%\uff08\u7b2c \${at} \u6bb5\uff09\`;
      };
      return [line(hers, USER_DISPLAY), line(progressOf(b.id, 'assistant'), AI_DISPLAY)].join('\u3000\u00b7\u3000');
    })(),`;

// ── 二、1 级放开到两件 ──

const OLD_TAKEN = '  const taken = new Set();';
const NEW_TAKEN = `  // 每级做了几件。2026-10-19：原来是 Set，一级就一个座位。
  // 但 1 级挂着五件事（论坛、听歌、钱包、批注本、小酒馆），他选了音乐，
  // 论坛那一刻就进不来了——不是他不想去，是程序不让。所以改成计数，
  // 1 级单独放到两件，其他级维持一件。
  const taken = new Map();
  const TIER1_PER_WAKE = (() => {
    const n = Number(String(process.env.TIER1_PER_WAKE ?? '').trim());
    return Number.isInteger(n) && n > 0 ? Math.min(n, 5) : 2;
  })();
  const capOf = (t) => (t === 1 ? TIER1_PER_WAKE : 1);`;

const OLD_CHECK = `    if (tier > 0 && taken.has(tier)) {`;
const NEW_CHECK = `    if (tier > 0 && (taken.get(tier) ?? 0) >= capOf(tier)) {`;

const OLD_ADD = '    if (tier > 0) taken.add(tier);';
const NEW_ADD = '    if (tier > 0) taken.set(tier, (taken.get(tier) ?? 0) + 1);';

// ── 干活 ──

function patch(rel, edits, extras = []) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) {
    console.error(`✗ 找不到 ${rel}`);
    return false;
  }
  const bak = `${file}.bak-finish`;
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  const before = fs.readFileSync(file, 'utf8');
  let src = before;
  let changed = 0;

  for (const e of edits) {
    if (src.includes(e.done)) {
      console.log(`· 已经改过，跳过：${rel} — ${e.what}`);
      continue;
    }
    const n = src.split(e.find).length - 1;
    if (n !== 1) {
      console.error(`\n✗ ${rel} — ${e.what}：原文出现 ${n} 次，应该只有 1 次。整个文件不改。`);
      console.error('  我找的是：');
      console.error(e.find.split('\n').map((l) => `    ${l}`).join('\n'));
      const lines = before.split('\n');
      const probe = e.probe ?? e.find.split('\n')[0].trim();
      const i = lines.findIndex((l) => l.includes(probe));
      if (i >= 0) {
        console.error(`\n  ${rel} 第 ${i + 1} 行附近实际是：`);
        for (let k = Math.max(0, i - 2); k < Math.min(lines.length, i + 14); k++) {
          console.error(`    ${k + 1}: ${lines[k]}`);
        }
      }
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    src = src.replace(e.find, e.replacement);
    console.log(`✓ ${rel} — ${e.what}`);
    changed += 1;
  }

  // 补充声明（比如 USER_DISPLAY）：文件里没有才加
  for (const x of extras) {
    if (src.includes(x.probe)) continue;
    const n = src.split(x.find).length - 1;
    if (n !== 1) {
      console.error(`\n✗ ${rel} — ${x.what}：锚点出现 ${n} 次。整个文件不改。`);
      fs.writeFileSync(file, before, 'utf8');
      return false;
    }
    src = src.replace(x.find, x.replacement);
    console.log(`✓ ${rel} — ${x.what}`);
    changed += 1;
  }

  if (!changed) return true;
  fs.writeFileSync(file, src, 'utf8');
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    console.log(`✓ 语法通过：${rel}`);
  } catch (err) {
    console.error(`✗ ${rel} 语法不过，已还原：`);
    console.error(String(err.stderr ?? err.message).slice(-600));
    fs.writeFileSync(file, before, 'utf8');
    return false;
  }
  return true;
}

const okBooks = patch(
  'src/books-page.js',
  [
    {
      what: '书架卡把两条进度线都发给前端',
      done: 'line(hers, USER_DISPLAY)',
      find: OLD_DESC,
      replacement: NEW_DESC,
      probe: 'description: (() =>',
    },
  ],
  [
    {
      what: '补上 USER_DISPLAY 声明',
      probe: 'const USER_DISPLAY',
      find: "const PREFIX = '/books';",
      replacement:
        "const PREFIX = '/books';\n\n// 书架卡上两条进度线各自的名字（2026-10-19）\nconst USER_DISPLAY = process.env.USER_DISPLAY_NAME || '\u5979';",
    },
  ]
);

const okBudget = patch('src/budget.js', [
  {
    what: '每级改成计数，1 级放开到两件',
    done: 'TIER1_PER_WAKE',
    find: OLD_TAKEN,
    replacement: NEW_TAKEN,
    probe: 'const taken =',
  },
  {
    what: '上限判断改成比计数',
    done: '>= capOf(tier)',
    find: OLD_CHECK,
    replacement: NEW_CHECK,
    probe: 'taken.has(tier)',
  },
  {
    what: '记下这级又做了一件',
    done: 'taken.set(tier,',
    find: OLD_ADD,
    replacement: NEW_ADD,
    probe: 'taken.add(tier)',
  },
]);

console.log('');
if (okBooks && okBudget) {
  console.log('两件都成了。接着：');
  console.log('  pm2 restart vesper phosphor --update-env');
  console.log('然后强刷 /books 看书架卡，等他醒一次看 1 级能不能做两件。');
} else {
  console.log('有没成的（上面打了它周围的实际原文）。没成的那个文件已经原样还原，没改坏东西。');
  console.log('成了的那个还是要重启对应进程才生效。');
  process.exitCode = 1;
}
