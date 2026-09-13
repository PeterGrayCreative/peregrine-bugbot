import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { predictionMountFixture } from "./eval-prediction-mount-fixture.js";
import { attachPredictionReadTools } from "../eval/prediction-runtime-attachment.js";
import { createPredictionCliDeadline, createStructuralPredictionCliDeadline } from "../eval/prediction-cli-deadline.js";
import { parsePredictionReadMcpAuditSnapshot, parseReviewReadMcpAuditSnapshot, REVIEW_READ_MCP_PROTOCOL } from "../eval/methodology-read-mcp.js";

const rpc = (method: string, params: unknown = {}, id = 1) => ({ jsonrpc: "2.0", method, params, id });
async function call(url: string, body: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, { method: "POST", headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(3000) });
  return { status: response.status, headers: response.headers, text: await response.text() };
}
async function ready(url: string) {
  const init = await call(url, rpc("initialize", { protocolVersion: REVIEW_READ_MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "zero-provider-probe", version: "1" } }));
  assert.equal(init.status, 200); assert.equal(init.text.includes("peregrine"), false);
  const headers = { "Mcp-Session-Id": init.headers.get("mcp-session-id")!, "MCP-Protocol-Version": REVIEW_READ_MCP_PROTOCOL };
  assert.equal((await call(url, { jsonrpc: "2.0", method: "notifications/initialized" }, headers)).status, 202);
  return headers;
}

test("authenticated prediction attachment exposes exactly four neutral tools and literal links, not curator or method resources", async t => {
  const f = predictionMountFixture(t);
  let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined;
  const guard = createPredictionCliDeadline({ directory: join(f.root, "deadline"), attemptId: "attachment-test", closeReads() {}, teardown: async () => { await attachment?.close(); } });
  try {
    attachment = await attachPredictionReadTools(f.authority, f.root, f.manifest.attemptBindings[0]!.id, guard);
    const headers = await ready(attachment.url), listed = await call(attachment.url, rpc("tools/list"), headers);
    assert.deepEqual(JSON.parse(listed.text).result.tools.map((tool: { name: string }) => tool.name), ["list_tree", "read_file", "search_text", "read_link"]);
    assert.equal(listed.text.toLowerCase().includes("peregrine"), false);
    const invoke = async (name: string, args: unknown) => JSON.parse((await call(attachment!.url, rpc("tools/call", { name, arguments: args }), headers)).text);
    const link = await invoke("read_link", { path: "head/link" });
    assert.deepEqual(JSON.parse(link.result.content[0].text), { kind: "literal-symlink-source", target: "index.ts", followed: false });
    for (const path of ["head/link", "../" + f.mounts[1]!.reviewerId + "/review.diff", "/etc/passwd", "skills/invariant-first-pr-review/SKILL.md"]) {
      const read = await invoke("read_file", { path }); assert.equal(read.result.isError, true);
      assert.equal(JSON.stringify(read).includes("Synthetic bounded contract"), false);
    }
    assert.ok((await invoke("shell", {})).error);
    const audit = attachment.auditSnapshot(); assert.deepEqual(parsePredictionReadMcpAuditSnapshot(audit), audit);
    assert.throws(() => parseReviewReadMcpAuditSnapshot(audit), /name is invalid/);
    assert.equal(attachment.readerSnapshot().calls, 6);
    assert.equal(attachment.binding.inputDigest, f.first.inputDigest); assert.equal(attachment.binding.providerAuthorized, false);
  } finally { await guard.finish(); }
});

test("HTTP attachment shares the registered failed-call and returned-byte caps", async t => {
  const f = predictionMountFixture(t, true);
  for (const mode of ["calls", "bytes"] as const) {
    let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined;
    const guard = createPredictionCliDeadline({ directory: join(f.root, mode), attemptId: mode, closeReads() {}, teardown: async () => { await attachment?.close(); } });
    try {
      attachment = await attachPredictionReadTools(f.authority, f.root, f.manifest.attemptBindings[0]!.id, guard);
      const headers = await ready(attachment.url);
      const invoke = async (name: string, args: unknown) => JSON.parse((await call(attachment!.url, rpc("tools/call", { name, arguments: args }), headers)).text);
      if (mode === "calls") {
        for (let i = 0; i < 100; i++) assert.ok((await invoke("forbidden", {})).error);
        assert.ok((await invoke("read_file", { path: "review.diff" })).error); assert.equal(attachment.readerSnapshot().calls, 100);
      } else {
        assert.ok((await invoke("read_file", { path: "head/large.txt" })).result);
        assert.ok((await invoke("read_file", { path: "head/large.txt" })).error);
        assert.equal(attachment.readerSnapshot().events[1]!.status, "over-budget"); assert.equal(attachment.readerSnapshot().closed, true);
      }
    } finally { await guard.finish(); }
  }
});

test("attachment rejects manifest drift and extra curator resources before listening", async t => {
  const f = predictionMountFixture(t), guard = createPredictionCliDeadline({ directory: join(f.root, "deadline"), attemptId: "tamper", closeReads() {}, teardown: async () => {} });
  try {
    await assert.rejects(attachPredictionReadTools({ ...f.authority, manifestBytes: f.authority.manifestBytes + " " }, f.root, f.manifest.attemptBindings[0]!.id, guard), /manifest digest/);
    writeFileSync(join(f.firstRoot, "curator.json"), "must not reach either arm");
    await assert.rejects(attachPredictionReadTools(f.authority, f.root, f.manifest.attemptBindings[0]!.id, guard), /unexpected source file/);
  } finally { await guard.finish(); }
});

test("whole-attempt abort closes the reader and listener; concurrent cleanup shares one promise", async t => {
  const f = predictionMountFixture(t);
  let attachment: Awaited<ReturnType<typeof attachPredictionReadTools>> | undefined;
  const guard = createStructuralPredictionCliDeadline({ directory: join(f.root, "deadline"), attemptId: "abort", closeReads() {}, teardown: async () => { await attachment?.close(); } }, 300);
  attachment = await attachPredictionReadTools(f.authority, f.root, f.manifest.attemptBindings[0]!.id, guard);
  try {
    const headers = await ready(attachment.url);
    await new Promise(resolve => guard.signal.addEventListener("abort", resolve, { once: true }));
    const first = attachment.close(), second = attachment.close(); assert.strictEqual(first, second); await first;
    assert.equal(attachment.readerSnapshot().closed, true);
    await assert.rejects(call(attachment.url, rpc("tools/list"), headers));
    const terminal = await guard.finish(); assert.equal(terminal.deadlineExceeded, true); assert.equal(terminal.teardownCompleted, true);
    await assert.rejects(attachPredictionReadTools(f.authority, f.root, f.manifest.attemptBindings[0]!.id, guard), /closed/);
  } finally { await guard.finish(); }
});
