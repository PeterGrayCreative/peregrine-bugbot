import { same } from "./prediction-contract.js";
const fail = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

/** Shared by historical assessment and the prospective in-memory reducer. */
export function validateItemLifecycles(events: any[]) {
  const items = new Map<string, { type: string; identity: unknown; completed: boolean }>(), calls: any[] = [];
  for (const event of events) {
    if (!event.type.startsWith("item.")) continue;
    const item = event.item;
    fail(typeof item.id === "string" && item.id.length > 0, "tool lifecycle requires a unique id");
    const identity = { server: item.server, tool: item.tool, arguments: item.arguments };
    let owner = items.get(item.id);
    if (owner) {
      same(item.type, owner.type, "tool lifecycle changed capability type");
      fail(event.type !== "item.started" && !owner.completed, "tool lifecycle duplicate start or terminal disposition");
      if (item.type === "mcp_tool_call") same(identity, owner.identity, "tool lifecycle identity mismatch");
    } else {
      fail(event.type === "item.started" || item.type === "agent_message" && event.type === "item.completed", "tool lifecycle missing start");
      owner = { type: item.type, identity, completed: false }; items.set(item.id, owner);
    }
    if (event.type === "item.completed") {
      owner.completed = true;
      if (item.type === "mcp_tool_call") {
        fail((item.status === undefined || item.status === "completed") && (item.error === undefined || item.error === null), "tool disposition failed or unknown");
        calls.push(event);
      }
    }
  }
  fail([...items.values()].every(item => item.completed), "tool lifecycle has unfinished items before turn terminal");
  return calls;
}
