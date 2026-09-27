import bark from './bark.js';
import diary from './diary.js';
import mcpAction from './mcp-action.js';
import ombreBrain from './ombre-brain.js';
import setMode from './set-mode.js';

const actions = {
  bark,
  diary,
  mcp_call: mcpAction,
  ombre_brain: ombreBrain,
  set_mode: setMode,
  noop: async () => {},
};

export async function executeAction(decision) {
  const fn = actions[decision.action] || actions.noop;
  try {
    return await fn(decision.action_detail);
  } catch (err) {
    console.error(`executeAction(): action "${decision.action}" failed:`, err.message);
    return null;
  }
}
