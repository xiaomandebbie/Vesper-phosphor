import bark from './bark.js';
import moment from './moment.js';
import mcpAction from './mcp-action.js';
import ombreBrain from './ombre-brain.js';
import setMode from './set-mode.js';
import { describeActivity, describeActivityDetail } from './activity.js';
import { addActivityMoment } from '../moments-store.js';

const actions = {
  bark,
  moment,
  // 旧名兼容：日记已经换成动态，模型偶尔还写 diary 时照样按动态发
  diary: moment,
  mcp_call: mcpAction,
  ombre_brain: ombreBrain,
  set_mode: setMode,
  noop: async () => {},
};

export async function executeAction(decision) {
  const fn = actions[decision.action] || actions.noop;
  let result;
  try {
    result = await fn(decision.action_detail);
  } catch (err) {
    console.error(`executeAction(): action "${decision.action}" failed:`, err.message);
    return null;
  }

  // 推送、发动态以外的行动（逛论坛、翻记忆、调节律），在动态里记一笔，点开能看详情。
  // 行为记录不占"6 小时一条"的动态间隔。
  try {
    const text = describeActivity(decision, result);
    if (text) addActivityMoment(text, describeActivityDetail(decision, result));
  } catch (err) {
    console.error('executeAction(): 记录行为动态失败', err.message);
  }
  return result;
}
