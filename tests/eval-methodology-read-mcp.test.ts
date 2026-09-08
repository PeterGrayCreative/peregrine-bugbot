import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startReviewReadMcpServer, REVIEW_READ_MCP_PROTOCOL, type ReviewReadMcpOptions } from "../eval/methodology-read-mcp.js";

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
}));

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
}));

test("request budget rejects further work after the configured number of POST messages", async () => fixture(async (service) => {
  const headers = await ready(service);
  assert.equal((await call(service.url, rpc("tools/list"), headers)).status, 200);
  assert.equal((await call(service.url, rpc("tools/list"), headers)).status, 429);
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
