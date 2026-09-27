import { callTool, isConnected } from '../mcp-manager.js';

// Ombre Brain's real tool names (per 允朔's spec, 2026-09-26):
//   breath()                -> wake up and see what surfaces, no args
//   breath_search(query,..) -> keyword/semantic recall
//   feel(query)             -> recall past feelings tied to a topic
//   hold(content, ...)      -> write one memory (only when something is
//                              genuinely worth keeping long-term)
//
// `detail` is expected to be a JSON string, one of:
//   {"mode":"breath"}
//   {"mode":"search","query":"..."}
//   {"mode":"feel","query":"..."}
//   {"mode":"hold","content":"...","title":"...","domain":"...","importance":0.x}
//
// Default (no detail, or unparsable detail) is "breath" — the cheapest,
// lowest-token way to see what's currently surfacing.
export default async function ombreBrain(detail) {
  if (!isConnected('ombre-brain')) {
    console.warn('ombreBrain(): ombre-brain MCP not connected, skipping');
    return;
  }

  let parsed;
  try {
    parsed = detail ? JSON.parse(detail) : { mode: 'breath' };
  } catch (err) {
    // Not JSON — treat it as free text to hold, since that's the only
    // action that takes a bare content string.
    parsed = { mode: 'hold', content: detail };
  }

  switch (parsed.mode) {
    case 'search':
      return callTool('ombre-brain', 'breath_search', { query: parsed.query });

    case 'feel':
      return callTool('ombre-brain', 'feel', { query: parsed.query });

    case 'hold':
      // Only call this when the decision engine has genuinely decided
      // something is worth long-term memory — not for routine wake-ups.
      return callTool('ombre-brain', 'hold', {
        content: parsed.content,
        title: parsed.title,
        domain: parsed.domain,
        tags: parsed.tags,
        importance: parsed.importance,
        feel: parsed.feel,
      });

    case 'breath':
    default:
      return callTool('ombre-brain', 'breath', {});
  }
}
