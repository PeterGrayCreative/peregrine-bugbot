import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parseReviewReadMcpAuditSnapshot,
  startReviewReadMcpServer,
  REVIEW_READ_MCP_PROTOCOL,
  type ReviewReadMcpOptions,
} from "../eval/methodology-read-mcp.js";

const OPTIONS: ReviewReadMcpOptions = { maxRequestBytes: 4096, maxResponseBytes: 4096,
  requestTimeoutMs: 3000, maxConnections: 4, maxRequests: 100 };
const READ_LIMITS = { maxIndexEntries: 20, maxFileBytes: 10_000, maxOutputBytes: 20_000,
  maxSearchMatches: 10, excludedNamespaces: ["private"] };
type Service = Awaited<ReturnType<typeof startReviewReadMcpServer>>;
type Reply = { status: number; text: string; headers: Record<string, string | string[] | undefined> };
async function fixture(run: (service: Service, root: string) => Promise<void>, options: Partial<ReviewReadMcpOptions> = {}) {
  const root = mkdtempSync(join(tmpdir(), "methodology-read-mcp-"));
  writeFileSync(join(root, "source.ts"), "const literal = '[a.*]';\n");
  writeFileSync(join(root, "large.ts"), '"'.repeat(4000));
  let service: Service | undefined;
  try { service = await startReviewReadMcpServer(root, READ_LIMITS, { ...OPTIONS, ...options }); await run(service, root); }
  finally { await service?.close(); rmSync(root, { recursive: true, force: true }); }
}
function rpc(method: string, params?: unknown, id: number | string = 1) {
  return { jsonrpc: "2.0", id, method, ...(params === undefined ? {} : { params }) };
}
function call(url: string, message?: unknown, headers: Record<string, string> = {}, method = "POST"): Promise<Reply> {
  return rawCall(url, message === undefined ? "" : JSON.stringify(message), headers, method);
}
function rawCall(url: string, body: string | Buffer, headers: Record<string, string> = {}, method = "POST"): Promise<Reply> {
  return new Promise((resolveReply, reject) => {
    const req = request(url, { method, agent: false, headers: {
      "Accept": "application/json, text/event-stream", "Content-Type": "application/json", ...headers,
    } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolveReply({ status: res.statusCode!, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(body);
  });
}
function deferredCall(url: string, message: unknown, headers: Record<string, string>): {
  finish(): void;
  reply: Promise<Reply>;
} {
  const body = JSON.stringify(message);
  let finishRequest: (() => void) | undefined;
  const reply = new Promise<Reply>((resolveReply, reject) => {
    const req = request(url, { method: "POST", agent: false, headers: {
      "Accept": "application/json, text/event-stream", "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body), ...headers,
    } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolveReply({ status: res.statusCode!, headers: res.headers,
        text: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body.slice(0, 1));
    let finished = false;
    finishRequest = () => {
      if (finished) throw new Error("deferred request already finished");
      finished = true;
      req.end(body.slice(1));
    };
  });
  return { reply, finish: () => finishRequest!() };
}
async function waitForObservedRequests(service: Service, count: number): Promise<void> {
  for (let attempt = 0; attempt < 1000; attempt++) {
    if (service.auditSnapshot().requests.observed === count) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(`MCP service did not observe ${count} requests`);
}
async function initialize(service: Service, version = REVIEW_READ_MCP_PROTOCOL) {
  const reply = await call(service.url, rpc("initialize", { protocolVersion: version,
    capabilities: {}, clientInfo: { name: "synthetic-client", version: "1" } }));
  assert.equal(reply.status, 200);
  assert.equal(JSON.parse(reply.text).result.protocolVersion, REVIEW_READ_MCP_PROTOCOL);
  assert.match(String(reply.headers["mcp-session-id"]), /^[a-f0-9]{64}$/);
  return { "Mcp-Session-Id": String(reply.headers["mcp-session-id"]), "MCP-Protocol-Version": REVIEW_READ_MCP_PROTOCOL };
}
async function ready(service: Service) {
  const headers = await initialize(service);
  const initialized = await call(service.url, { jsonrpc: "2.0", method: "notifications/initialized" }, headers);
  assert.equal(initialized.status, 202);
  assert.equal(initialized.text, "");
  return headers;
}

test("single-session HTTP lifecycle discovers and calls only the three read tools", async () => fixture(async (service) => {
  assert.match(new URL(service.url).pathname, /^\/mcp\/[a-f0-9]{64}$/);
  const headers = await ready(service);
  const listed = await call(service.url, rpc("tools/list"), headers);
  assert.equal(listed.status, 200);
  const definitions = JSON.parse(listed.text).result.tools;
  assert.deepEqual(definitions.map((tool: { name: string }) => tool.name), ["list_tree", "read_file", "search_text"]);
  assert.ok(definitions.every((tool: { inputSchema: { additionalProperties: boolean } }) => tool.inputSchema.additionalProperties === false));
  const read = await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }), headers);
  const result = JSON.parse(read.text).result;
  assert.equal(result.isError, false);
  assert.equal(JSON.parse(result.content[0].text).text, "const literal = '[a.*]';\n");
  const search = await call(service.url, rpc("tools/call", { name: "search_text", arguments: { query: "[a.*]" } }), headers);
  assert.equal(JSON.parse(JSON.parse(search.text).result.content[0].text).matches[0].path, "source.ts");
  assert.deepEqual(JSON.parse((await call(service.url, rpc("ping"), headers)).text).result, {});
  const cancelled = await call(service.url, { jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: 9 } }, headers);
  assert.equal(cancelled.status, 202);
  assert.equal(cancelled.text, "");
  assert.equal((await call(service.url, undefined, headers, "GET")).status, 405);
  assert.equal((await call(service.url, undefined, headers, "DELETE")).status, 405);
  const snapshot = service.auditSnapshot();
  assert.deepEqual(snapshot.requests, { observed: 9, budgeted: 7, parsed: 7, denied: 2 });
  assert.deepEqual(snapshot.sessions, { attempted: 1, initialized: 1, ready: 1, denied: 0 });
  assert.deepEqual(snapshot.tools, { attempted: 2, complete: 2, incomplete: 0, denied: 0 });
  assert.deepEqual(snapshot.toolCalls.map(({ name, status }) => ({ name, status })), [
    { name: "read_file", status: "complete-for-indexed-export" },
    { name: "search_text", status: "complete-for-indexed-export" },
  ]);
  assert.deepEqual(snapshot.transportFailures, [{ code: "method-not-supported", count: 2 }]);
}));

test("audit snapshots are immutable, deterministic, bounded, and omit arguments and source", async () => fixture(async (service, root) => {
  const headers = await ready(service);
  const secretQuery = "[a.*]";
  const missingPath = "not-present-private-name.ts";
  const secretToolName = "private-super-secret-tool";
  assert.equal((await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/call", { name: "search_text", arguments: { query: secretQuery } }), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: missingPath } }), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: root } }), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/call", { name: secretToolName, arguments: {} }), headers)).status, 200);
  assert.equal((await call(service.url, rpc("ping"), { ...headers, Host: "secret-host.invalid" })).status, 403);

  const snapshot = service.auditSnapshot();
  assert.deepEqual(snapshot.tools, { attempted: 5, complete: 2, incomplete: 1, denied: 2 });
  assert.deepEqual(snapshot.toolCalls.map(({ name, status, incompleteCodes }) => ({ name, status, incompleteCodes })), [
    { name: "read_file", status: "complete-for-indexed-export", incompleteCodes: [] },
    { name: "search_text", status: "complete-for-indexed-export", incompleteCodes: [] },
    { name: "read_file", status: "incomplete", incompleteCodes: ["unindexed-path"] },
    { name: "read_file", status: "denied", incompleteCodes: [] },
    { name: "unrecognized", status: "denied", incompleteCodes: [] },
  ]);
  assert.ok(snapshot.toolCalls.every((item) => /^[a-f0-9]{64}$/.test(item.resultSha256)));
  assert.deepEqual(snapshot.incompleteResultCodes, [{ code: "unindexed-path", count: 1 }]);
  assert.deepEqual(snapshot.denialCodes, [
    { code: "host-not-allowed", count: 1 },
    { code: "invalid-tool-arguments", count: 1 },
    { code: "invalid-tool-call", count: 1 },
  ]);
  assert.deepEqual(snapshot.transportFailures, [{ code: "host-not-allowed", count: 1 }]);
  assert.deepEqual(service.auditSnapshot(), snapshot);

  const serialized = JSON.stringify(snapshot);
  for (const forbidden of [root, "source.ts", secretQuery, missingPath, secretToolName, "secret-host.invalid", "const literal"]) {
    assert.ok(!serialized.includes(forbidden));
  }
  const { snapshotSha256, ...body } = snapshot;
  assert.equal(snapshotSha256, createHash("sha256").update("review-read-mcp-audit-snapshot-v1\0")
    .update(JSON.stringify(body)).digest("hex"));
  assert.throws(() => { (snapshot.requests as { observed: number }).observed = 999; }, TypeError);
  assert.throws(() => { (snapshot.toolCalls as unknown as unknown[]).push({}); }, TypeError);
}));

test("persisted audit parser reauthenticates counts, ordering, codes, and digest", async () => fixture(async (service) => {
  const headers = await ready(service);
  await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }), headers);
  await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "missing.ts" } }), headers);
  await call(service.url, rpc("tools/call", { name: "not-a-tool", arguments: {} }), headers);
  const snapshot = service.auditSnapshot();
  assert.deepEqual(parseReviewReadMcpAuditSnapshot(snapshot), snapshot);

  const changedDigest = structuredClone(snapshot) as unknown as { snapshotSha256: string };
  changedDigest.snapshotSha256 = "f".repeat(64);
  assert.throws(() => parseReviewReadMcpAuditSnapshot(changedDigest), /digest mismatch/);

  const changedCounts = structuredClone(snapshot) as unknown as { tools: { complete: number } };
  changedCounts.tools.complete += 1;
  assert.throws(() => parseReviewReadMcpAuditSnapshot(changedCounts), /tools do not match toolCalls/);

  const changedOrder = structuredClone(snapshot) as unknown as { toolCalls: unknown[] };
  [changedOrder.toolCalls[0], changedOrder.toolCalls[1]] = [changedOrder.toolCalls[1]!, changedOrder.toolCalls[0]!];
  assert.throws(() => parseReviewReadMcpAuditSnapshot(changedOrder), /not in unique request order/);

  const changedCode = structuredClone(snapshot) as unknown as { incompleteResultCodes: Array<{ code: string }> };
  changedCode.incompleteResultCodes[0]!.code = "caller-defined-code";
  assert.throws(() => parseReviewReadMcpAuditSnapshot(changedCode), /invalid or noncanonical/);

  const changedDenials = structuredClone(snapshot) as unknown as { denialCodes: Array<{ count: number }> };
  changedDenials.denialCodes[0]!.count += 1;
  assert.throws(() => parseReviewReadMcpAuditSnapshot(changedDenials), /denialCodes do not match denied requests/);
}));

test("concurrent tool audits and snapshot digests follow request arrival, not body completion", async () => {
  async function capture(reverseCompletion: boolean) {
    let captured: ReturnType<Service["auditSnapshot"]> | undefined;
    await fixture(async (service) => {
      const firstHeaders = await ready(service);
      const secondHeaders = await ready(service);
      const initialObserved = service.auditSnapshot().requests.observed;
      const first = deferredCall(service.url,
        rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }, 10), firstHeaders);
      await waitForObservedRequests(service, initialObserved + 1);
      const second = deferredCall(service.url,
        rpc("tools/call", { name: "search_text", arguments: { query: "[a.*]" } }, 20), secondHeaders);
      await waitForObservedRequests(service, initialObserved + 2);
      if (reverseCompletion) {
        second.finish();
        assert.equal((await second.reply).status, 200);
        first.finish();
        assert.equal((await first.reply).status, 200);
      } else {
        first.finish();
        assert.equal((await first.reply).status, 200);
        second.finish();
        assert.equal((await second.reply).status, 200);
      }
      captured = service.auditSnapshot();
    }, { maxSessions: 2 });
    assert.ok(captured);
    return captured;
  }

  const arrivalOrder = await capture(false);
  const reversedCompletion = await capture(true);
  assert.deepEqual(reversedCompletion.toolCalls.map(({ sequence, name }) => ({ sequence, name })), [
    { sequence: 5, name: "read_file" },
    { sequence: 6, name: "search_text" },
  ]);
  assert.deepEqual(reversedCompletion.toolCalls, arrivalOrder.toolCalls);
  assert.equal(reversedCompletion.snapshotSha256, arrivalOrder.snapshotSha256);
});

test("sealing rejects active work and prevents later audit mutation", async () => {
  await fixture(async (service) => {
    const headers = await ready(service);
    const initialObserved = service.auditSnapshot().requests.observed;
    const pending = deferredCall(service.url,
      rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }), headers);
    await waitForObservedRequests(service, initialObserved + 1);
    assert.throws(() => service.sealAudit(), /requests are active/);
    pending.finish();
    assert.equal((await pending.reply).status, 200);
    const sealedAfterCompletion = service.sealAudit();
    assert.equal(sealedAfterCompletion.tools.complete, 1);
  });

  await fixture(async (service) => {
    const headers = await ready(service);
    await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "source.ts" } }), headers);
    const address = new URL(service.url);
    const incompleteHeaders = connect(Number(address.port), address.hostname);
    incompleteHeaders.on("error", () => {});
    await new Promise<void>((resolveConnect) => incompleteHeaders.once("connect", resolveConnect));
    incompleteHeaders.write("POST / HTTP/1.1\r\n");
    const sealed = service.sealAudit();
    assert.equal((await call(service.url, rpc("ping"), headers)).status, 404);
    await new Promise<void>((resolveClose) => incompleteHeaders.once("close", resolveClose));
    assert.deepEqual(service.auditSnapshot(), sealed);
    assert.equal(service.sealAudit(), sealed);
  }, { requestTimeoutMs: 50 });
});

test("initialization negotiates the pinned version and tool execution requires the initialized session", async () => fixture(async (service) => {
  assert.equal((await call(service.url, rpc("tools/list"))).status, 400);
  const headers = await initialize(service, "2024-11-05");
  const early = await call(service.url, rpc("tools/list"), headers);
  assert.equal(JSON.parse(early.text).error.code, -32600);
  assert.equal((await call(service.url, rpc("tools/list"), { ...headers, "Mcp-Session-Id": "wrong" })).status, 404);
  assert.equal((await call(service.url, rpc("tools/list"))).status, 400);
  assert.equal((await call(service.url, rpc("tools/list"), { "Mcp-Session-Id": headers["Mcp-Session-Id"] })).status, 400);
  assert.equal((await call(service.url, rpc("tools/list"), { ...headers, "MCP-Protocol-Version": "2024-11-05" })).status, 400);
  const duplicate = await call(service.url, rpc("initialize", { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
    capabilities: {}, clientInfo: { name: "other", version: "1" } }));
  assert.equal(duplicate.status, 409);
}));

test("two-worker attempts may use two isolated sessions and freeze Docker host authorization", async () => fixture(async (service) => {
  const port = new URL(service.url).port;
  service.authorizeHost(`host.docker.internal:${port}`);
  const first = await ready(service);
  const second = await ready(service);
  assert.notEqual(first["Mcp-Session-Id"], second["Mcp-Session-Id"]);
  assert.equal((await call(service.url, rpc("tools/list"), first)).status, 200);
  assert.equal((await call(service.url, rpc("tools/list"), second)).status, 200);
  const third = await call(service.url, rpc("initialize", { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
    capabilities: {}, clientInfo: { name: "third", version: "1" } }));
  assert.equal(third.status, 409);
  assert.throws(() => service.authorizeHost(`other.invalid:${port}`), /frozen/);
}, { maxSessions: 2 }));

test("Host, Origin and capability endpoint checks precede every protocol method", async () => fixture(async (service) => {
  const message = rpc("initialize", { protocolVersion: REVIEW_READ_MCP_PROTOCOL, capabilities: {}, clientInfo: { name: "x", version: "1" } });
  assert.equal((await call(service.url, message, { Host: "attacker.invalid" })).status, 403);
  assert.equal((await call(service.url, message, { Origin: "https://attacker.invalid" })).status, 403);
  assert.equal((await call(service.url, undefined, { Origin: "null" }, "GET")).status, 403);
  const other = new URL(service.url); other.pathname = "/mcp/not-the-capability";
  assert.equal((await call(other.toString(), message)).status, 404);
  assert.equal((await call(service.url, message, { Accept: "application/json" })).status, 406);
  assert.equal((await call(service.url, message, { Accept: "application/json;q=0, text/event-stream" })).status, 406);
  assert.equal((await call(service.url, message, { "Content-Type": "text/plain" })).status, 415);
  assert.equal((await call(service.url, message, { "Content-Encoding": "gzip" })).status, 415);
}));

test("explicit allowed Origin is accepted without broadening Host or endpoint access", async () => fixture(async (service) => {
  const reply = await call(service.url, rpc("initialize", { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
    capabilities: {}, clientInfo: { name: "x", version: "1" } }), { Origin: "https://client.example" });
  assert.equal(reply.status, 200);
}, { allowedOrigins: ["https://client.example"] }));

test("invalid messages and tool arguments produce bounded errors without host paths", async () => fixture(async (service, root) => {
  assert.equal(JSON.parse((await rawCall(service.url, "{")).text).error.code, -32700);
  assert.equal(JSON.parse((await rawCall(service.url, Buffer.from([0xc3, 0x28]))).text).error.code, -32700);
  assert.equal(JSON.parse((await call(service.url, [rpc("initialize")])).text).error.code, -32600);
  assert.equal(JSON.parse((await call(service.url, { jsonrpc: "2.0", id: null, method: "initialize" })).text).error.code, -32600);
  const headers = await ready(service);
  for (const message of [rpc("resources/list"), rpc("prompts/list"), rpc("shell/exec"),
    rpc("tools/call", { name: "shell", arguments: {} }),
    rpc("tools/call", { name: "read_file", arguments: { path: root } }),
    rpc("tools/call", { name: "read_file", arguments: { path: "../outside" } }),
    rpc("tools/call", { name: "read_file", arguments: { path: ".git/config" } }),
    rpc("tools/call", { name: "list_tree", arguments: { command: "pwd" } })]) {
    const reply = await call(service.url, message, headers);
    assert.ok(JSON.parse(reply.text).error);
    assert.ok(!reply.text.includes(root));
    assert.ok(!reply.text.includes("node:"));
    assert.ok(Buffer.byteLength(reply.text) <= OPTIONS.maxResponseBytes);
  }
  const unavailable = await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "missing" } }), headers);
  assert.equal(JSON.parse(unavailable.text).result.isError, true);
}));

test("request bytes, response wrapper bytes and per-run request count are enforced", async () => fixture(async (service) => {
  assert.equal((await rawCall(service.url, "x".repeat(5000))).status, 413);
  const headers = await ready(service);
  const reply = await call(service.url, rpc("tools/call", { name: "read_file", arguments: { path: "large.ts" } }), headers);
  assert.ok(Buffer.byteLength(reply.text) <= OPTIONS.maxResponseBytes);
  const result = JSON.parse(reply.text).result;
  assert.equal(result.isError, true);
  assert.ok(JSON.parse(result.content[0].text).limitations.includes("transport-response-byte-limit"));
  const snapshot = service.auditSnapshot();
  assert.deepEqual(snapshot.incompleteResultCodes, [{ code: "transport-response-byte-limit", count: 1 }]);
  assert.deepEqual(snapshot.transportFailures, [{ code: "request-byte-limit", count: 1 }]);
  assert.deepEqual(snapshot.toolCalls.map(({ status, incompleteCodes }) => ({ status, incompleteCodes })), [
    { status: "incomplete", incompleteCodes: ["transport-response-byte-limit"] },
  ]);
}));

test("request budget rejects further work after the configured number of POST messages", async () => fixture(async (service) => {
  const headers = await ready(service);
  assert.equal((await call(service.url, rpc("tools/list"), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/list"), headers)).status, 429);
  const snapshot = service.auditSnapshot();
  assert.deepEqual(snapshot.requests, { observed: 4, budgeted: 3, parsed: 3, denied: 1 });
  assert.deepEqual(snapshot.denialCodes, [{ code: "request-limit", count: 1 }]);
  assert.deepEqual(snapshot.transportFailures, [{ code: "request-limit", count: 1 }]);
}, { maxRequests: 3 }));

test("absolute connection deadline closes incomplete headers and maxConnections rejects extra sockets", async () => fixture(async (service) => {
  const address = new URL(service.url);
  const first = connect(Number(address.port), address.hostname);
  first.on("error", () => {});
  await new Promise<void>((resolveConnect) => first.once("connect", resolveConnect));
  first.write("POST / HTTP/1.1\r\n");
  const second = connect(Number(address.port), address.hostname);
  second.on("error", () => {});
  await new Promise<void>((resolveClose, reject) => {
    const watchdog = setTimeout(() => { first.destroy(); second.destroy(); reject(new Error("connection limits were not enforced")); }, 2000);
    second.once("close", () => { clearTimeout(watchdog); resolveClose(); });
  });
  await new Promise<void>((resolveClose) => { if (first.destroyed) resolveClose(); else first.once("close", resolveClose); });
}, { maxConnections: 1, requestTimeoutMs: 100 }));
