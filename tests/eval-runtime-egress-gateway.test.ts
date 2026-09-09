import { strict as assert } from "node:assert";
import { PassThrough } from "node:stream";
import { connect as netConnect } from "node:net";
import { test } from "node:test";
// @ts-expect-error The runtime fixture is intentionally a built-in ESM module without a declaration file.
import * as gateway from "../container/eval-runtime/egress-gateway.mjs";

const {
  createAudit,
  createGateway,
  decideClientHello,
  decideConnect,
  isPublicAddress,
  lookupPublicAddresses,
  normalizeAuthority,
  parseAuditSnapshot,
  parseClientHello,
  parseConfig,
  runFixture,
} = gateway;

const ALLOW = ["api.example.com:443", "mcp.example.com:443"];
function clientHello(host: string): Buffer {
  const name = Buffer.from(host);
  const entry = Buffer.alloc(3 + name.length);
  entry[0] = 0;
  entry.writeUInt16BE(name.length, 1);
  name.copy(entry, 3);
  const list = Buffer.alloc(2 + entry.length);
  list.writeUInt16BE(entry.length, 0);
  entry.copy(list, 2);
  const sni = Buffer.alloc(4 + list.length);
  sni.writeUInt16BE(0, 0);
  sni.writeUInt16BE(list.length, 2);
  list.copy(sni, 4);
  const ext = Buffer.alloc(2 + sni.length);
  ext.writeUInt16BE(sni.length, 0);
  sni.copy(ext, 2);
  const body = Buffer.alloc(34 + 1 + 2 + 2 + 1 + 2 + ext.length);
  body.writeUInt16BE(0x0303, 0);
  let p = 34;
  body[p++] = 0;
  body.writeUInt16BE(2, p);
  p += 2;
  body.writeUInt16BE(0x1301, p);
  p += 2;
  body[p++] = 1;
  body[p++] = 0;
  ext.copy(body, p);
  const hs = Buffer.alloc(4 + body.length);
  hs[0] = 1;
  hs.writeUIntBE(body.length, 1, 3);
  body.copy(hs, 4);
  const record = Buffer.alloc(5 + hs.length);
  record[0] = 22;
  record[1] = 3;
  record[2] = 3;
  record.writeUInt16BE(hs.length, 3);
  hs.copy(record, 5);
  return record;
}

test("authority policy rejects wildcard, trailing dot, userinfo, literals, whitespace, and non-443", () => {
  assert.equal(
    normalizeAuthority("api.example.com:443"),
    "api.example.com:443"
  );
  for (const value of [
    "*.example.com:443",
    "api.example.com.:443",
    "API.EXAMPLE.COM:443",
    "user:pass@api.example.com:443",
    "127.0.0.1:443",
    "[::1]:443",
    "api.example.com:80",
    "127.1:443",
    "api.example.com:443\n",
  ])
    assert.throws(() => normalizeAuthority(value));
});
test("config is strict and bounded", () => {
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: ALLOW.join(","),
    EGRESS_MAX_CONNECTIONS: "2",
    EGRESS_MAX_REQUESTS: "3",
    EGRESS_MAX_HEADER_BYTES: "1024",
    EGRESS_MAX_TUNNEL_BYTES: "4096",
    EGRESS_DEADLINE_MS: "100",
    EGRESS_MAX_CLIENT_HELLO_BYTES: "2048",
  });
  assert.equal(config.maxRequests, 3);
  assert.equal(config.maxClientHelloBytes, 2048);
  assert.throws(() =>
    parseConfig({
      EGRESS_ALLOWED_AUTHORITIES: ALLOW.join(","),
      EGRESS_UNKNOWN: "secret",
    })
  );
});
test("public address policy rejects special IPv4 and IPv6 ranges", () => {
  const rejected = [
    // IPv4 special-purpose, private, documentation, benchmarking, and
    // multicast/reserved ranges.
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.1.1",
    "172.16.0.1",
    "192.0.2.1",
    "192.31.196.1",
    "192.52.193.1",
    "192.168.1.1",
    "192.175.48.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    // IPv4-mapped and dotted-IPv4 forms must not smuggle a private address
    // through an otherwise globally routable IPv6 prefix.
    "::ffff:8.8.8.8",
    "::ffff:127.0.0.1",
    "2001:4860::10.0.0.1",
    "2001:4860::127.0.0.1",
    // IPv6 unspecified, loopback, ULA, link-local, multicast, and reserved
    // transition/documentation/benchmarking prefixes.
    "::",
    "::1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "3fff::1",
    "2001:2::1",
    "2001:1::1",
    "2001:3::1",
    "2001:4:112::1",
    "2001:10::1",
    "2001:20::1",
    "2001:30::1",
    "2001:1ff::1",
    "2002:7f00:1::1",
    "2001:0000:4136:e378:8000:63bf:3fff:fdd2",
    "64:ff9b::c000:0201",
    "64:ff9b:1::c000:0201",
    "100::1",
    "100:0:0:1::1",
    "2620:4f:8000::1",
    "5f00::1",
  ];
  for (const address of rejected)
    assert.equal(isPublicAddress(address), false, address);
  for (const address of [
    "8.8.8.8",
    "1.1.1.1",
    "2001:4860:4860::8888",
    "2001:4860::8.8.8.8",
    "2000:ffff:ffff::1",
    "2001:200::1",
    "2620:4f:7fff::1",
    "2620:4f:8001::1",
  ])
    assert.equal(isPublicAddress(address), true, address);
});
test("DNS checks every record and pins a deterministic address", async () => {
  assert.deepEqual(
    await lookupPublicAddresses("api.example.com", async () => [
      { address: "8.8.8.8" },
      { address: "2001:4860:4860::8888" },
    ]),
    ["2001:4860:4860::8888", "8.8.8.8"].sort((a, b) => a.localeCompare(b))
  );
  await assert.rejects(() =>
    lookupPublicAddresses("api.example.com", async () => [
      { address: "8.8.8.8" },
      { address: "10.0.0.1" },
    ])
  );
});
test("TLS ClientHello requires valid TLS and exact SNI", () => {
  const hello = clientHello("api.example.com");
  assert.equal(parseClientHello(hello).status, "valid");
  assert.equal(
    decideClientHello({ buffer: hello, authority: "api.example.com:443" })
      .allowed,
    true
  );
  assert.equal(
    decideClientHello({
      buffer: clientHello("other.example.com"),
      authority: "api.example.com:443",
    }).reason,
    "sni-mismatch"
  );
  assert.equal(
    decideClientHello({
      buffer: Buffer.from("GET / HTTP/1.1\r\n"),
      authority: "api.example.com:443",
    }).reason,
    "not-tls"
  );
  assert.equal(parseClientHello(hello.subarray(0, 8)).status, "need-more");
});
test("CONNECT decision is allowlisted only and ordinary/SOCKS/WebSocket forms are denied", () => {
  const allowedAuthorities = new Set(ALLOW);
  assert.equal(
    decideConnect({ authority: "api.example.com:443", allowedAuthorities })
      .allowed,
    true
  );
  for (const authority of [
    "api.example.com:80",
    "SOCKS5",
    "api.example.com:443/",
    "api.example.com:443:443",
  ])
    assert.equal(
      decideConnect({ authority, allowedAuthorities }).allowed,
      false
    );
  assert.equal(
    runFixture("connect", {
      authority: "other.example.com:443",
      allowedAuthorities: ALLOW,
    }).allowed,
    false
  );
});
test("audit is sanitized, deeply frozen, hashed, and seals only while idle", () => {
  const active = { requests: 1, sockets: 0 };
  const audit = createAudit(() => active);
  assert.throws(() => audit.seal(), /active/);
  active.requests = 0;
  audit.record({
    kind: "connect\n",
    decision: "deny",
    reason: "bad\nreason",
    authority: "api.example.com:443",
    payload: "secret",
  });
  const snapshot = audit.snapshot();
  assert.equal(Object.isFrozen(audit), true);
  assert.equal(snapshot[0].reason, "bad?reason");
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot[0]), true);
  assert.equal(JSON.stringify(snapshot).includes("secret"), false);
  const sealed = audit.seal();
  assert.equal(sealed.sha256.length, 64);
  assert.deepEqual(parseAuditSnapshot(sealed), sealed);
  const altered = structuredClone(sealed);
  altered.sha256 = "0".repeat(64);
  assert.throws(() => parseAuditSnapshot(altered), /digest/);
  assert.throws(() => audit.record({ kind: "x" }), /sealed/);
});
test("gateway denies real HTTP and uses injected DNS/connect only after valid ClientHello", async () => {
  const seen: Array<{ host: string; port: number; family: number }> = [];
  let upstreamBytes = Buffer.alloc(0);
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: "api.example.com:443",
    EGRESS_MAX_REQUESTS: "2",
    EGRESS_DEADLINE_MS: "500",
  });
  const connect = (options: { host: string; port: number; family: number }) => {
    seen.push(options);
    const socket = new PassThrough();
    socket.on("data", (chunk) => {
      upstreamBytes = Buffer.concat([upstreamBytes, chunk]);
    });
    queueMicrotask(() => socket.emit("connect"));
    return socket;
  };
  const gateway = createGateway(config, {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect,
  });
  await new Promise<void>((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve)
  );
  const address = gateway.server.address();
  assert.equal(
    (await fetch(`http://127.0.0.1:${address.port}/`, { method: "GET" }))
      .status,
    405
  );
  const client = netConnect(address.port, "127.0.0.1");
  let received = Buffer.alloc(0);
  client.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  await new Promise<void>((resolve) => client.once("connect", resolve));
  client.write("CONNECT api.example.com:443 HTTP/1.1\r\nHost: gateway\r\n\r\n");
  await new Promise<void>((resolve) => {
    const check = () =>
      /200 Connection Established/.test(received.toString("latin1"))
        ? resolve()
        : setTimeout(check, 2);
    check();
  });
  const hello = clientHello("api.example.com");
  client.write(hello);
  await new Promise<void>((resolve) => setTimeout(resolve, 40));
  assert.deepEqual(seen[0], { host: "8.8.8.8", port: 443, family: 4 });
  assert.ok(upstreamBytes.subarray(0, hello.length).equals(hello));
  const clientClosed = new Promise<void>((resolve) =>
    client.once("close", resolve)
  );
  client.destroy();
  await Promise.race([
    clientClosed,
    new Promise<void>((resolve) => setTimeout(resolve, 50)),
  ]);
  await gateway.close();
  assert.equal(gateway.state.activeRequests, 0);
  assert.equal(gateway.state.activeSockets, 0);
  assert.equal(gateway.seal().sealed, true);
});
test("gateway rejects mismatched and non-TLS handshakes before DNS/connect", async () => {
  const calls: string[] = [];
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: "api.example.com:443",
    EGRESS_DEADLINE_MS: "300",
  });
  const gateway = createGateway(config, {
    lookup: async () => {
      calls.push("dns");
      return [{ address: "8.8.8.8", family: 4 }];
    },
    connect: () => {
      calls.push("connect");
      throw new Error("must not connect");
    },
  });
  await new Promise<void>((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve)
  );
  const address = gateway.server.address();
  for (const payload of [
    clientHello("other.example.com"),
    Buffer.from("GET / HTTP/1.1\r\n"),
  ]) {
    const client = netConnect(address.port, "127.0.0.1");
    client.resume();
    const closed = new Promise<void>((resolve) =>
      client.once("close", resolve)
    );
    await new Promise<void>((resolve) => client.once("connect", resolve));
    client.write(
      "CONNECT api.example.com:443 HTTP/1.1\r\nHost: gateway\r\n\r\n"
    );
    client.write(payload);
    await closed;
  }
  assert.deepEqual(calls, []);
  await gateway.close();
  assert.equal(gateway.state.activeRequests, 0);
  assert.equal(gateway.state.activeSockets, 0);
  assert.equal(gateway.seal().sealed, true);
});
test("hung DNS is cut off by the hard deadline and leaves no active state", async () => {
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: "api.example.com:443",
    EGRESS_DEADLINE_MS: "100",
  });
  const gateway = createGateway(config, {
    lookup: async () => new Promise(() => {}),
    connect: () => {
      throw new Error("must not connect");
    },
  });
  await new Promise<void>((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve)
  );
  const address = gateway.server.address();
  const client = netConnect(address.port, "127.0.0.1");
  client.resume();
  const closed = new Promise<void>((resolve) => client.once("close", resolve));
  await new Promise<void>((resolve) => client.once("connect", resolve));
  client.write("CONNECT api.example.com:443 HTTP/1.1\r\nHost: gateway\r\n\r\n");
  client.write(clientHello("api.example.com"));
  await closed;
  assert.equal(gateway.state.activeRequests, 0);
  assert.equal(gateway.state.activeSockets, 0);
  await gateway.close();
  assert.equal(gateway.seal().sealed, true);
});
test("close awaits hung connect teardown and is idempotent", async () => {
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: "api.example.com:443",
    EGRESS_DEADLINE_MS: "300",
  });
  let upstream: PassThrough | undefined;
  const gateway = createGateway(config, {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect: () => {
      const socket = new PassThrough();
      upstream = socket;
      return socket;
    },
  });
  await new Promise<void>((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve)
  );
  const address = gateway.server.address();
  const client = netConnect(address.port, "127.0.0.1");
  let received = Buffer.alloc(0);
  client.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  client.resume();
  await new Promise<void>((resolve) => client.once("connect", resolve));
  client.write("CONNECT api.example.com:443 HTTP/1.1\r\nHost: gateway\r\n\r\n");
  await new Promise<void>((resolve) => {
    const check = () =>
      /200 Connection Established/.test(received.toString("latin1"))
        ? resolve()
        : setTimeout(check, 2);
    check();
  });
  client.write(clientHello("api.example.com"));
  await new Promise<void>((resolve) => {
    const check = () => (upstream ? resolve() : setTimeout(check, 2));
    check();
  });
  const first = gateway.close();
  const second = gateway.close();
  assert.strictEqual(first, second);
  await Promise.all([first, second]);
  assert.ok(upstream);
  assert.equal(upstream.destroyed, true);
  assert.equal(gateway.state.activeRequests, 0);
  assert.equal(gateway.state.activeSockets, 0);
  assert.equal(gateway.seal().sealed, true);
});
test("close awaits delayed upstream socket teardown before sealing", async () => {
  const config = parseConfig({
    EGRESS_ALLOWED_AUTHORITIES: "api.example.com:443",
    EGRESS_DEADLINE_MS: "500",
  });
  let upstream: PassThrough | undefined;
  const gateway = createGateway(config, {
    lookup: async () => [{ address: "8.8.8.8", family: 4 }],
    connect: () => {
      const socket = new PassThrough();
      upstream = socket;
      const destroy = socket.destroy.bind(socket);
      socket.destroy = () => {
        setTimeout(() => destroy(), 30);
        return socket;
      };
      queueMicrotask(() => socket.emit("connect"));
      return socket;
    },
  });
  await new Promise<void>((resolve) =>
    gateway.server.listen(0, "127.0.0.1", resolve)
  );
  const address = gateway.server.address();
  const client = netConnect(address.port, "127.0.0.1");
  let received = Buffer.alloc(0);
  client.on("data", (chunk) => {
    received = Buffer.concat([received, chunk]);
  });
  client.resume();
  await new Promise<void>((resolve) => client.once("connect", resolve));
  client.write("CONNECT api.example.com:443 HTTP/1.1\r\nHost: gateway\r\n\r\n");
  await new Promise<void>((resolve) => {
    const check = () =>
      /200 Connection Established/.test(received.toString("latin1"))
        ? resolve()
        : setTimeout(check, 2);
    check();
  });
  client.write(clientHello("api.example.com"));
  await new Promise<void>((resolve) => {
    const check = () =>
      gateway.state.activeSockets >= 2 ? resolve() : setTimeout(check, 2);
    check();
  });
  const startedAt = Date.now();
  await gateway.close();
  assert.ok(upstream);
  assert.ok(Date.now() - startedAt >= 20);
  assert.equal(upstream.destroyed, true);
  assert.equal(gateway.state.activeRequests, 0);
  assert.equal(gateway.state.activeSockets, 0);
  assert.equal(gateway.seal().sealed, true);
});
test("fixture policy and audit modes remain offline", () => {
  assert.deepEqual(runFixture("address", { address: "127.0.0.1" }), {
    address: "127.0.0.1",
    public: false,
  });
  assert.equal(
    runFixture("audit", {
      events: [{ kind: "connect", decision: "deny", reason: "no" }],
      seal: true,
    }).sha256.length,
    64
  );
});
