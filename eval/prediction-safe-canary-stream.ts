import { parseCodexEvents } from "../src/engines/codex.js";
import { digest, exact, freeze, integer, oneOf, same, text } from "./prediction-contract.js";
import { validateItemLifecycles } from "./prediction-canary-item-lifecycle.js";
import { observePredictionCliTokens } from "./prediction-cli-session.js";
import { privateByteBinding } from "./prediction-typed-evidence.js";

export const SAFE_CANARY_STREAM_BYTES = 4_194_304;
export const SAFE_CANARY_TOOLS = ["list_tree", "read_file", "search_text", "read_link"] as const;
export function parseSafeCanaryStatus(value: unknown) {
  const v = exact(value, ["status", "tools"], "safe canary status"), tools = exact(v.tools, SAFE_CANARY_TOOLS, "safe canary tools");
  const result = { status: oneOf(v.status, ["completed", "unable-to-complete"]), tools: {
    list_tree: oneOf(tools.list_tree, ["succeeded", "unavailable"]), read_file: oneOf(tools.read_file, ["succeeded", "unavailable"]),
    search_text: oneOf(tools.search_text, ["succeeded", "unavailable"]), read_link: oneOf(tools.read_link, ["refused-no-link", "literal-link-read", "unavailable"]) } };
  same(result.status === "completed", !Object.values(result.tools).includes("unavailable"), "canary status contradicts tool statuses");
  return freeze(result);
}

/** Raw JSONL and final text exist only in bounded memory. Every free-text field
 * is dropped or hashed; only the exact enum-only final status may be persisted.
 * This is a prospective protocol profile, not a claim of observed CLI support. */
export function reduceSafeCanaryStream(stdout: string) {
  if (typeof stdout !== "string" || Buffer.byteLength(stdout) > SAFE_CANARY_STREAM_BYTES) throw new Error("canary stream memory bound exceeded");
  const parsed = parseCodexEvents(stdout);
  if (parsed.malformedEventLines || parsed.events.length < 4 || parsed.events.length > 2048) throw new Error("incomplete or malformed canary event stream");
  const events = parsed.events as any[];
  same(events.filter(e => e.type === "thread.started").length, 1, "one thread start required");
  same(events.filter(e => e.type === "turn.started").length, 1, "one turn start required");
  same(events.filter(e => e.type === "turn.completed").length, 1, "one turn terminal required");
  same([events[0].type, events[1].type, events.at(-1).type], ["thread.started", "turn.started", "turn.completed"], "canary turn ordering mismatch");
  const projection = events.map((e, index) => {
    const type = oneOf(e.type, ["thread.started", "turn.started", "turn.completed", "item.started", "item.updated", "item.completed"]);
    if (type === "thread.started") { exact(e, ["type", "thread_id"], "thread event"); return { type, sessionSha256: digest(text(e.thread_id)) }; }
    if (type === "turn.started") { exact(e, ["type"], "turn start"); return { type }; }
    if (type === "turn.completed") {
      exact(e, ["type", "usage"], "turn terminal");
      exact(e.usage, ["input_tokens", "output_tokens", ...["cached_input_tokens", "reasoning_output_tokens"].filter(k => Object.hasOwn(e.usage, k))], "terminal usage");
      for (const value of Object.values(e.usage)) integer(value);
      if ((e.usage.cached_input_tokens ?? 0) > e.usage.input_tokens || (e.usage.reasoning_output_tokens ?? 0) > e.usage.output_tokens) throw new Error("inconsistent terminal token accounting");
      return { type, usageSha256: digest(e.usage) };
    }
    exact(e, ["type", "item"], "item event");
    const item = e.item, itemType = oneOf(item?.type, ["mcp_tool_call", "agent_message", "reasoning"]), idSha256 = digest(text(item.id));
    if (itemType === "mcp_tool_call") {
      exact(item, ["id", "type", "server", "tool", "arguments", ...["result", "status", "error"].filter(k => Object.hasOwn(item, k))], "read event");
      same(item.server, "source_read", "unregistered tool server"); const tool = oneOf(item.tool, SAFE_CANARY_TOOLS);
      if (type === "item.completed" && !Object.hasOwn(item, "result")) throw new Error("missing completed read result");
      return { type, itemType, idSha256, server: "source_read", tool, argumentsSha256: digest(item.arguments), resultSha256: digest(item.result ?? null) };
    }
    exact(item, ["id", "type", "text"], "non-I/O event"); text(item.text);
    if (itemType === "agent_message" && type === "item.completed" && index !== events.length - 2) throw new Error("final message must immediately precede turn terminal");
    return { type, itemType, idSha256, text: privateByteBinding(item.text) };
  });
  const calls = validateItemLifecycles(events);
  same([...new Set(calls.map(call => call.item.tool))].sort(), [...SAFE_CANARY_TOOLS].sort(), "all four repository capabilities must have terminal events");
  const final = events.filter(e => e.type === "item.completed" && e.item.type === "agent_message");
  if (final.length !== 1) throw new Error("exactly one completed final agent message required");
  let output: ReturnType<typeof parseSafeCanaryStatus>;
  try { output = parseSafeCanaryStatus(JSON.parse(final[0].item.text)); }
  catch { throw new Error("final canary status failed exact data policy"); }
  const tokens = observePredictionCliTokens(events, true);
  if (tokens.status !== "known") throw new Error("terminal usage unavailable");
  return freeze({ kind: "prediction-safe-canary-stream-v1", stream: privateByteBinding(stdout), projection, output, tokens,
    modelSessionSha256: projection[0]!.sessionSha256, providerAuthorized: false, executionReady: false });
}
