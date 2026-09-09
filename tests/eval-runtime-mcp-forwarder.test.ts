import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { request } from "node:http";
import { networkInterfaces } from "node:os";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";
import test from "node:test";
// @ts-expect-error The runtime fixture is intentionally a built-in ESM module without a declaration file.
import * as forwarder from "../container/eval-runtime/methodology-mcp-forwarder.mjs";
const {
  METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST,
  parseMethodologyMcpForwarderAuditSnapshot,
  parseMethodologyMcpForwarderConfig,
  resolveHostGatewayAddress,
  startMethodologyMcpForwarder,
} = forwarder;

const token = "a".repeat(64);
const baseOptions = {
  host: "127.0.0.1",
  port: 0,
  token,
  upstreamPort: 43123,
  maxRequestBytes: 256,
  maxResponseBytes: 512,
  maxHeaderBytes: 8_192,
  requestTimeoutMs: 500,
  maxConnections: 4,
  maxRequests: 20,
};

type Reply = { status: number; headers: Record<string, string | string[] | undefined>; body: string };
type ForwardRequest = { method: string; hostname: string; port: number; path: string; headers: Readonly<Record<string, string>>; body: Buffer };

function call(url: string, options: { method?: string; body?: string | Buffer; headers?: Record<string, string> } = {}): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? "POST", agent: false, headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(options.body ?? "{}");
  });
}

async function fixture(
  callback: (request: { method: string; hostname: string; port: number; path: string; headers: Readonly<Record<string, string>>; body: Buffer }) => unknown,
  options: Record<string, unknown> = {},
) {
  const service = await startMethodologyMcpForwarder({ ...baseOptions, ...options, fixtureMode: true,
    fixtureRequest: async (request: ForwardRequest) => callback(request) as never });
  return service;
}

test("forwards only the exact POST endpoint and fixed upstream destination", async (t) => {
  const seen: unknown[] = [];
  const service = await fixture((request) => {
    seen.push(request);
    return { statusCode: 200, headers: { "content-type": "application/json", "x-upstream-secret": "omit" }, body: "{\"ok\":true}" };
  });
  t.after(() => service.close());
  const endpoint = new URL(service.url);
  const valid = await call(service.url, { headers: { "content-type": "application/json", "x-client-secret": "omit" }, body: "{}" });
  assert.equal(valid.status, 200);
  assert.equal(seen.length, 1);
  const target = seen[0] as { hostname: string; port: number; path: string; headers: Record<string, string> };
  assert.equal(target.hostname, METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST);
  assert.equal(target.port, baseOptions.upstreamPort);
  assert.equal(target.path, endpoint.pathname);
  assert.equal(target.headers.host, `${METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST}:${baseOptions.upstreamPort}`);
  assert.equal("x-client-secret" in target.headers, false);
  assert.equal("authorization" in target.headers, false);
  assert.equal((await call(`${endpoint.origin}${endpoint.pathname}/extra`, { headers: { "content-type": "application/json" } })).status, 404);
  assert.equal((await call(`${endpoint.origin}${endpoint.pathname}?x=1`, { headers: { "content-type": "application/json" } })).status, 404);
  assert.equal((await call(service.url, { method: "GET" })).status, 405);
  assert.equal((await call(service.url, { method: "DELETE" })).status, 405);
  assert.equal((await call(service.url, { headers: { Host: "attacker.invalid", "content-type": "application/json" } })).status, 403);
  assert.equal(seen.length, 1);
});

test("strips arbitrary headers, refuses redirects, and never performs a second request", async (t) => {
  let calls = 0;
  const service = await fixture(() => {
    calls++;
    return { statusCode: 302, headers: { location: "http://attacker.invalid/steal", "set-cookie": "secret=1" }, body: "redirect" };
  });
  t.after(() => service.close());
  const reply = await call(service.url, { headers: { "content-type": "application/json", authorization: "Bearer secret", cookie: "secret=1", "x-forwarded-host": "attacker.invalid" } });
  assert.equal(reply.status, 502);
  assert.equal(calls, 1);
  assert.equal(reply.headers.location, undefined);
  assert.equal(reply.headers["set-cookie"], undefined);
  assert.equal(JSON.stringify(service.auditSnapshot()).includes("attacker.invalid"), false);
});

test("bounds request and response bytes", async (t) => {
  let service = await fixture(() => ({ statusCode: 200, body: "ok" }), { maxRequestBytes: 4 });
  t.after(() => service.close());
  assert.equal((await call(service.url, { headers: { "content-type": "application/json" }, body: "12345" })).status, 413);
  await service.close();

  service = await fixture(() => ({ statusCode: 200, body: "1".repeat(65) }), { maxResponseBytes: 64 });
  t.after(() => service.close());
  assert.equal((await call(service.url, { headers: { "content-type": "application/json" } })).status, 502);
});

test("rejects non-JSON and upgrade-like requests before forwarding", async (t) => {
  let calls = 0;
  const service = await fixture(() => { calls++; return { statusCode: 200, body: "ok" }; });
  t.after(() => service.close());
  assert.equal((await call(service.url, { headers: { "content-type": "text/plain" } })).status, 415);
  await assert.rejects(() => call(service.url, { headers: { "content-type": "application/json", connection: "upgrade", upgrade: "websocket" } }), /socket hang up|reset|closed/i);
  assert.equal(calls, 0);
});

test("audit is ordered, sanitized, immutable, and seal waits for active work", async (t) => {
  let release: (() => void) | undefined;
  const service = await fixture(() => new Promise((resolve) => { release = () => resolve({ statusCode: 200, body: "ok" }); }));
  t.after(() => service.close());
  const pending = call(service.url, { headers: { "content-type": "application/json" }, body: "{}" });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.throws(() => service.sealAudit(), /active/);
  release!();
  await pending;
  const snapshot = service.sealAudit();
  assert.equal(snapshot.protocol, "methodology-mcp-forwarder-audit-v1");
  assert.equal(snapshot.sealed, true);
  assert.deepEqual(snapshot.events.map(({ sequence }: { sequence: number }) => sequence), [1]);
  assert.equal(JSON.stringify(snapshot).includes(token), false);
  assert.equal(JSON.stringify(snapshot).includes("{}"), false);
  assert.deepEqual(service.auditSnapshot(), snapshot);
  assert.equal(service.readiness().sealed, true);
  assert.throws(() => (snapshot.events as unknown as Array<unknown>).push({}), TypeError);
  assert.equal((await call(service.url, { headers: { "content-type": "application/json" } })).status, 404);
});

test("production configuration cannot substitute the upstream target", async () => {
  await assert.rejects(() => startMethodologyMcpForwarder({ ...baseOptions, upstreamUrl: "http://127.0.0.1:9/evil" } as never), /unsupported/);
  await assert.rejects(() => startMethodologyMcpForwarder({ ...baseOptions, upstreamHost: "127.0.0.1", fixtureMode: true, fixtureRequest: () => ({ statusCode: 200 }) } as never), /unsupported/);
  await assert.rejects(() => startMethodologyMcpForwarder({ ...baseOptions, fixtureRequest: () => ({ statusCode: 200 }) } as never), /fixture/);
});

test("production environment parsing is strict and never accepts target overrides", () => {
  const env = {
    MCP_FORWARDER_BIND_HOST: "127.0.0.1", MCP_FORWARDER_BIND_PORT: "43124", MCP_FORWARDER_TOKEN: token,
    MCP_FORWARDER_UPSTREAM_PORT: "43123", MCP_FORWARDER_MAX_REQUEST_BYTES: "256", MCP_FORWARDER_MAX_RESPONSE_BYTES: "512",
    MCP_FORWARDER_MAX_HEADER_BYTES: "8192", MCP_FORWARDER_REQUEST_TIMEOUT_MS: "500", MCP_FORWARDER_MAX_CONNECTIONS: "4",
    MCP_FORWARDER_MAX_REQUESTS: "20",
  };
  assert.equal(parseMethodologyMcpForwarderConfig(env).port, 43124);
  assert.throws(() => parseMethodologyMcpForwarderConfig({ ...env, MCP_FORWARDER_UPSTREAM_URL: "http://evil.invalid" }), /unknown/);
  assert.throws(() => parseMethodologyMcpForwarderConfig({ ...env, MCP_FORWARDER_BIND_PORT: "0" }), /out of bounds/);
  const fixtureOutput = execFileSync(process.execPath, [fileURLToPath(new URL("../container/eval-runtime/methodology-mcp-forwarder.mjs", import.meta.url)), "--fixture-config"], { encoding: "utf8" });
  assert.deepEqual(JSON.parse(fixtureOutput), { protocol: "methodology-mcp-forwarder-v1", upstreamHost: "host.docker.internal", tokenBytes: 32 });
});

test("pins one non-loopback gateway address and uses it for production-style HTTP", async (t) => {
  const address = Object.entries(networkInterfaces()).flatMap(([, entries]) => entries ?? [])
    .find((entry) => entry.family === "IPv4" && !entry.internal)?.address;
  if (!address) return t.skip("no non-loopback test address");
  let lookups = 0;
  const gatewayLookup = async () => { lookups++; return [{ address, family: 4 }]; };
  const fakeUpstream = createServer((req, res) => {
    assert.equal(req.headers.host, `${METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST}:${upstreamPort}`);
    res.writeHead(200, { "content-type": "application/json", "x-secret": "strip" });
    res.end("{\"production\":true}");
  });
  await new Promise<void>((resolve) => fakeUpstream.listen(0, address, resolve));
  const upstreamPort = (fakeUpstream.address() as { port: number }).port;
  const service = await startMethodologyMcpForwarder({ ...baseOptions, host: address, upstreamPort, fixtureMode: true, lookup: gatewayLookup });
  t.after(async () => { await service.close(); await new Promise<void>((resolve) => fakeUpstream.close(() => resolve())); });
  assert.equal(lookups, 1);
  // A later resolver change cannot affect the already-pinned HTTP destination.
  const reply = await call(service.url, { headers: { "content-type": "application/json", authorization: "secret" }, body: "{}" });
  assert.equal(reply.status, 200);
  assert.equal(lookups, 1);
  assert.equal(reply.headers["x-secret"], undefined);
  assert.deepEqual(await resolveHostGatewayAddress("ignored", async () => [{ address, family: 4 }]), { address, family: 4 });
  await assert.rejects(() => resolveHostGatewayAddress("ignored", async () => [{ address: "127.0.0.1", family: 4 }]), /one valid/);
});

test("rejects every textual IPv6 unspecified and loopback gateway form", async () => {
  for (const address of [
    "::", "0:0:0:0:0:0:0:0", "0000:0000:0000:0000:0000:0000:0000:0000",
    "::1", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001",
    "::ffff:127.0.0.1", "0:0:0:0:0:ffff:7f00:1", "::127.0.0.1",
  ]) {
    await assert.rejects(
      () => resolveHostGatewayAddress("ignored", async () => [{ address, family: 6 }]),
      /one valid/,
      address,
    );
  }
});

test("accepts compressed and expanded non-loopback IPv6 gateway addresses", async () => {
  assert.deepEqual(
    await resolveHostGatewayAddress("ignored", async () => [{ address: "172.18.0.1", family: 4 }]),
    { address: "172.18.0.1", family: 4 },
  );
  for (const address of ["2001:db8::1", "2001:0db8:0000:0000:0000:0000:0000:0001"]) {
    assert.deepEqual(
      await resolveHostGatewayAddress("ignored", async () => [{ address, family: 6 }]),
      { address, family: 6 },
    );
  }
});

test("closing destroys an active socket and audit snapshots reauthenticate", async (t) => {
  const service = await fixture(() => ({ statusCode: 200, body: "ok" }));
  t.after(() => service.close());
  const port = new URL(service.url).port;
  const socket = connect(Number(port), "127.0.0.1");
  socket.on("error", () => {});
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  socket.write("POST / HTTP/1.1\r\n");
  await service.close();
  await new Promise<void>((resolve) => socket.destroyed ? resolve() : socket.once("close", resolve));
  const service2 = await fixture(() => ({ statusCode: 200, body: "ok" }));
  t.after(() => service2.close());
  await call(service2.url, { headers: { "content-type": "application/json" } });
  assert.equal(service2.auditSnapshot().sealed, false);
  assert.throws(() => parseMethodologyMcpForwarderAuditSnapshot(service2.auditSnapshot()), /invalid/);
  const snapshot = service2.sealAudit();
  assert.deepEqual(parseMethodologyMcpForwarderAuditSnapshot(snapshot), snapshot);
  const altered = structuredClone(snapshot) as { snapshotSha256: string };
  altered.snapshotSha256 = "0".repeat(64);
  assert.throws(() => parseMethodologyMcpForwarderAuditSnapshot(altered), /digest/);
});

test("closing cancels and awaits hung upstream work before the audit is sealed", async () => {
  const service = await fixture(() => new Promise(() => {}), { requestTimeoutMs: 30_000 });
  const pending = call(service.url, { headers: { "content-type": "application/json" }, body: "{}" }).catch(() => undefined);
  await new Promise<void>((resolve) => {
    const check = () => service.readiness().activeWork === 1 ? resolve() : setTimeout(check, 2);
    check();
  });
  const started = Date.now();
  await service.close();
  assert.ok(Date.now() - started < 1_000);
  await pending;
  assert.deepEqual(service.readiness(), {
    schemaVersion: 1,
    protocol: "methodology-mcp-forwarder-v1",
    ready: false,
    sealed: false,
    activeWork: 0,
    activeConnections: 0,
  });
  const audit = service.sealAudit();
  assert.equal(audit.sealed, true);
  assert.equal(audit.events.some(({ code }: { code: string }) => code === "forwarder-closed"), true);
});
