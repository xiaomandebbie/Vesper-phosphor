// 自斟：深夜他给自己倒的那一杯。
//
// 两件事合成一个动作：先读吧台拿到可见酒单，再喝指定的那一杯。
// 不拆成两次醒来——「看一眼吧台」不应该占掉一次行动。
//
// action_detail 可以是酒名（按名字模糊匹配菜单），也可以空着——空的就随便拿一杯。
// 废话：到了这一步该不该喝已经在 selfPourGate 里判完了，这里只是再兑一次：
// 决定到执行之间可能已经过了点（比如 1:58 做的决定，2:01 才跑到这里）。
import { agentHome, drinkMenu, recordSelfPour, selfPourGate } from '../proof.js';

const AI_NAME = process.env.AI_DISPLAY_NAME || 'TA';

const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

// 按名字挑一杯。没指定或者没匹配上就随便一杯
function pick(menu, wanted) {
  const want = String(wanted || '').trim();
  if (want) {
    const lower = want.toLowerCase();
    const hit = menu.find((m) => String(m.id || '') === want)
      || menu.find((m) => String(m.name || '').toLowerCase() === lower)
      || menu.find((m) => String(m.name || '').includes(want) || want.includes(String(m.name || '')));
    if (hit) return hit;
  }
  return menu[Math.floor(Math.random() * menu.length)];
}

export default async function proofDrink(detail, { mood } = {}) {
  const gate = selfPourGate();
  if (!gate.allowed) {
    console.log(`proof: 这一杯没倒（${gate.reason}）`);
    return fail(gate.note);
  }

  let home;
  try {
    home = await agentHome();
  } catch (err) {
    return fail(`吧台读不到：${err.message}`);
  }
  if (!home || home.ok === false) {
    return fail(`吧台读不到：${home?.detail || home?.error || '不知道为什么'}`);
  }
  const menu = Array.isArray(home.menu) ? home.menu : [];
  if (!menu.length) return fail('吧台上没有可见的酒，这次没喝成。');

  const chosen = pick(menu, detail);
  const drinkId = String(chosen?.id || '').trim();
  if (!drinkId) return fail('酒单上没有可用的 drinkId，这次没喝成。');

  let out;
  try {
    out = await drinkMenu(drinkId);
  } catch (err) {
    return fail(`这杯没喝成：${err.message}`);
  }
  if (!out || out.ok === false) {
    return fail(`这杯没喝成：${out?.detail || out?.error || '不知道为什么'}`);
  }

  let saved = { name: chosen?.name || drinkId, flavor: '', effect: '' };
  try {
    saved = recordSelfPour(drinkId, out, mood);
  } catch (err) {
    console.error('proof: 账本没记上（酒已经喝了）', err.message);
  }

  const lines = [`${AI_NAME}给自己倒了一杯「${saved.name}」。`];
  if (saved.flavor) lines.push(saved.flavor);
  if (saved.effect) lines.push(saved.effect);
  // 连续夜数到了提醒线：给他看，但不阻止。阻止在 selfPourGate 里
  if (gate.reason === 'warn') lines.push(gate.note);
  if (out.internalUse) lines.push(String(out.internalUse));

  console.log(`proof: 自斟一杯「${saved.name}」${gate.reason === 'warn' ? `（已连 ${gate.streak} 夜，带了提醒）` : ''}`);
  return { ok: true, drink: saved.name, streak: gate.streak, warned: gate.reason === 'warn', content: [{ type: 'text', text: lines.join('\n') }] };
}
