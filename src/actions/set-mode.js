import { updateWakeState } from '../state.js';

// silent 故意不在这里——那等于 TA 从对方世界里彻底消失，
// 这个按钮不该由 TA 自己按下，只留给人工侧（数据库 / vesper 的 POST /wake/mode）。
const VALID_MODES = ['normal', 'low-frequency'];

// TA 自己决定改变非精确链的节律模式。
// 没有 Lifecycle（到期自动恢复）——按施工单的范围，设了就一直生效，
// 下次醒来它自己再决定要不要改回去。
export default async function setMode(detail) {
  let mode;
  try {
    const parsed = JSON.parse(detail);
    mode = parsed.mode;
  } catch (err) {
    mode = detail; // 容错：直接传字符串也行
  }

  if (!VALID_MODES.includes(mode)) {
    console.error(`setMode(): invalid mode "${mode}", ignoring`);
    return { ok: false, reason: 'invalid mode' };
  }

  updateWakeState({ mode });
  return { ok: true, mode };
}
