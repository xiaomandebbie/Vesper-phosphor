import { callTool } from '../mcp-manager.js';

// `detail` is expected to be a JSON string like:
// {"server":"forum","tool":"search","args":{"keyword":"..."}}
export default async function mcpAction(detail) {
  let parsed;
  try {
    parsed = JSON.parse(detail);
  } catch (err) {
    console.error('mcpAction(): could not parse action_detail as JSON:', detail);
    return;
  }
  const { server, tool, args } = parsed;
  if (!server || !tool) {
    console.error('mcpAction(): missing server or tool in', parsed);
    return;
  }
  return callTool(server, tool, args || {});
}
