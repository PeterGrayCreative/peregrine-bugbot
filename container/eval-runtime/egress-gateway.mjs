#!/usr/bin/env node

import { createHash } from "node:crypto";
import { promises as dns } from "node:dns";
import { createServer as createHttpServer } from "node:http";
import { isIP, connect as netConnect } from "node:net";
import { domainToASCII, pathToFileURL } from "node:url";

export const EGRESS_GATEWAY_PROTOCOL = "egress-gateway-v1";
export const EGRESS_GATEWAY_AUDIT_PROTOCOL = "egress-gateway-audit-v1";
const ENV_KEYS = new Set([
  "EGRESS_ALLOWED_AUTHORITIES",
  "EGRESS_BIND_HOST",
  "EGRESS_BIND_PORT",
  "EGRESS_MAX_CONNECTIONS",
  "EGRESS_MAX_REQUESTS",
  "EGRESS_MAX_HEADER_BYTES",
  "EGRESS_MAX_TUNNEL_BYTES",
  "EGRESS_DEADLINE_MS",
  "EGRESS_MAX_CLIENT_HELLO_BYTES",
]);
const DEFAULTS = Object.freeze({
  bindHost: "127.0.0.1",
  bindPort: 0,
  maxConnections: 32,
  maxRequests: 64,
  maxHeaderBytes: 16 * 1024,
  maxTunnelBytes: 16 * 1024 * 1024,
  deadlineMs: 15_000,
  maxClientHelloBytes: 64 * 1024,
});

function fail(message) {
  throw new TypeError(message);
}
function integer(value, name, { min = 1, max = 100_000_000, fallback } = {}) {
  if (value === undefined || value === "") {
    if (fallback !== undefined) return fallback;
    fail(`${name} is required`);
  }
  if (typeof value !== "string" || !/^[0-9]+$/u.test(value))
    fail(`${name} must be an integer`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max)
    fail(`${name} is out of bounds`);
  return number;
}
function assertNoUnknownEnvironment(env) {
  for (const key of Object.keys(env))
    if (key.startsWith("EGRESS_") && !ENV_KEYS.has(key))
      fail(`unknown egress setting: ${key}`);
}

/** Normalize one exact, lower-case DNS authority. Wildcards and URL syntax are never accepted. */
export function normalizeAuthority(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255)
    fail("authority is invalid");
  if (/[[\]@/?#%\s\x00-\x1f\x7f]/u.test(value))
    fail("authority contains forbidden characters");
  const colon = value.indexOf(":");
  if (colon <= 0 || colon !== value.lastIndexOf(":"))
    fail("authority must be a DNS host and port");
  const rawHost = value.slice(0, colon);
  if (value.slice(colon + 1) !== "443")
    fail("authority port must be exactly 443");
  if (
    rawHost !== rawHost.toLowerCase() ||
    rawHost.startsWith(".") ||
    rawHost.endsWith(".") ||
    rawHost.includes("..") ||
    rawHost.includes("*")
  )
    fail("authority host is ambiguous");
  if (isIP(rawHost) !== 0) fail("IP literal authorities are not allowed");
  const host = domainToASCII(rawHost);
  if (!host || host.length > 253 || !/^[a-z0-9.-]+$/u.test(host))
    fail("authority host is not a lower-case DNS name");
  const labels = host.split(".");
  if (
    labels.length < 2 ||
    labels.some(
      (label) =>
        label.length === 0 ||
        label.length > 63 ||
        label.startsWith("-") ||
        label.endsWith("-") ||
        !/^[a-z0-9-]+$/u.test(label)
    ) ||
    labels.every((label) => /^[0-9]+$/u.test(label))
  )
    fail("authority host is not a DNS name");
  return `${host}:443`;
}
export function parseAllowlist(value) {
  const entries = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(",")
    : [];
  if (entries.length === 0) fail("EGRESS_ALLOWED_AUTHORITIES is required");
  const values = entries.map((entry) => {
    if (
      typeof entry !== "string" ||
      entry.trim() !== entry ||
      entry.length === 0
    )
      fail("allowlist entries must be exact authorities");
    return normalizeAuthority(entry);
  });
  if (new Set(values).size !== values.length)
    fail("allowlist contains duplicates");
  return new Set(values);
}
export function parseConfig(env = process.env) {
  assertNoUnknownEnvironment(env);
  const config = {
    allowedAuthorities: parseAllowlist(env.EGRESS_ALLOWED_AUTHORITIES),
    bindHost: env.EGRESS_BIND_HOST ?? DEFAULTS.bindHost,
    bindPort: integer(env.EGRESS_BIND_PORT, "EGRESS_BIND_PORT", {
      min: 0,
      max: 65_535,
      fallback: DEFAULTS.bindPort,
    }),
    maxConnections: integer(
      env.EGRESS_MAX_CONNECTIONS,
      "EGRESS_MAX_CONNECTIONS",
      { max: 1_024, fallback: DEFAULTS.maxConnections }
    ),
    maxRequests: integer(env.EGRESS_MAX_REQUESTS, "EGRESS_MAX_REQUESTS", {
      max: 100_000,
      fallback: DEFAULTS.maxRequests,
    }),
    maxHeaderBytes: integer(
      env.EGRESS_MAX_HEADER_BYTES,
      "EGRESS_MAX_HEADER_BYTES",
      { min: 1_024, max: 1_048_576, fallback: DEFAULTS.maxHeaderBytes }
    ),
    maxTunnelBytes: integer(
      env.EGRESS_MAX_TUNNEL_BYTES,
      "EGRESS_MAX_TUNNEL_BYTES",
      { max: 256 * 1024 * 1024, fallback: DEFAULTS.maxTunnelBytes }
    ),
    deadlineMs: integer(env.EGRESS_DEADLINE_MS, "EGRESS_DEADLINE_MS", {
      min: 100,
      max: 300_000,
      fallback: DEFAULTS.deadlineMs,
    }),
    maxClientHelloBytes: integer(
      env.EGRESS_MAX_CLIENT_HELLO_BYTES,
      "EGRESS_MAX_CLIENT_HELLO_BYTES",
      { min: 1_024, max: 1_048_576, fallback: DEFAULTS.maxClientHelloBytes }
    ),
  };
  if (
    typeof config.bindHost !== "string" ||
    config.bindHost.length === 0 ||
    config.bindHost.length > 253 ||
    !/^[a-zA-Z0-9.:[\]-]+$/u.test(config.bindHost) ||
    /[\r\n\x00]/u.test(config.bindHost)
  )
    fail("EGRESS_BIND_HOST is invalid");
  return Object.freeze(config);
}

function ipv4Number(value) {
  const parts = value.split(".");
  if (
    parts.length !== 4 ||
    parts.some(
      (part) => !/^[0-9]+$/u.test(part) || part.length > 3 || Number(part) > 255
    )
  )
    return null;
  return parts.reduce((number, part) => number * 256 + Number(part), 0);
}
function in4(number, start, end) {
  return number >= start && number <= end;
}
function isPublicIpv4Number(number) {
  return !(
    in4(number, 0x00000000, 0x00ffffff) ||
    in4(number, 0x0a000000, 0x0affffff) ||
    in4(number, 0x64400000, 0x647fffff) ||
    in4(number, 0x7f000000, 0x7fffffff) ||
    in4(number, 0xa9fe0000, 0xa9feffff) ||
    in4(number, 0xac100000, 0xac1fffff) ||
    in4(number, 0xc0000000, 0xc00000ff) ||
    in4(number, 0xc0000200, 0xc00002ff) ||
    in4(number, 0xc01fc400, 0xc01fc4ff) ||
    in4(number, 0xc034c100, 0xc034c1ff) ||
    in4(number, 0xc0586300, 0xc05863ff) ||
    in4(number, 0xc0a80000, 0xc0a8ffff) ||
    in4(number, 0xc0af3000, 0xc0af30ff) ||
    in4(number, 0xc6120000, 0xc613ffff) ||
    in4(number, 0xc6336400, 0xc63364ff) ||
    in4(number, 0xcb007100, 0xcb0071ff) ||
    in4(number, 0xe0000000, 0xffffffff)
  );
}
function ipv6Words(value) {
  let input = value.toLowerCase();
  if (input.includes("%")) return null;
  if (input.includes(".")) {
    const colon = input.lastIndexOf(":");
    const v4 = ipv4Number(input.slice(colon + 1));
    if (v4 === null || colon < 1) return null;
    input = `${input.slice(0, colon)}:${(v4 >>> 16).toString(16)}:${(
      v4 & 0xffff
    ).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (
    left.some((part) => !/^[0-9a-f]{1,4}$/u.test(part)) ||
    right.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))
  )
    return null;
  const missing = 8 - left.length - right.length;
  if (
    (halves.length === 1 && missing !== 0) ||
    (halves.length === 2 && missing < 1)
  )
    return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) =>
    Number.parseInt(part, 16)
  );
}
function ipv6Value(words) {
  return words.reduce((value, word) => value * 65_536n + BigInt(word), 0n);
}
function starts6(words, prefix, bits) {
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ipv6Value(words) & mask) === (prefix & mask);
}
const V6 = Object.freeze({
  // IPv4-mapped addresses are ::ffff:0:0/96. Keep this 128-bit value
  // aligned with starts6's most-significant-bit prefix comparison.
  mapped: 0x00000000000000000000ffff00000000n,
  uniqueLocal: 0xfc000000000000000000000000000000n,
  linkLocal: 0xfe800000000000000000000000000000n,
  multicast: 0xff000000000000000000000000000000n,
  documentation: 0x20010db8000000000000000000000000n,
  documentationV2: 0x3fff0000000000000000000000000000n,
  ietfAssignments: 0x20010000000000000000000000000000n,
  nat64: 0x0064ff9b000000000000000000000000n,
  nat64NetworkSpecific: 0x0064ff9b000100000000000000000000n,
  discardOnly: 0x01000000000000000000000000000000n,
  dummyPrefix: 0x01000000000000000001000000000000n,
  sixToFour: 0x20020000000000000000000000000000n,
  directDelegationAs112: 0x2620004f800000000000000000000000n,
  srv6Sids: 0x5f000000000000000000000000000000n,
});
export function isPublicAddress(address) {
  if (typeof address !== "string") return false;
  const family = isIP(address);
  if (family === 4) {
    const number = ipv4Number(address);
    return number !== null && isPublicIpv4Number(number);
  }
  if (family !== 6) return false;
  const embeddedIpv4 = address.includes(".")
    ? ipv4Number(address.slice(address.lastIndexOf(":") + 1))
    : null;
  if (address.includes(".") && embeddedIpv4 === null) return false;
  // A dotted IPv4 tail is an alternate representation of the final 32 bits.
  // Reject it when those bits name a non-public IPv4 address, even when the
  // surrounding IPv6 prefix is otherwise globally routable.
  if (embeddedIpv4 !== null && !isPublicIpv4Number(embeddedIpv4)) return false;
  const words = ipv6Words(address);
  if (!words || words.length !== 8) return false;
  const value = ipv6Value(words);
  if (
    value === 0n ||
    value === 1n ||
    starts6(words, V6.uniqueLocal, 7) ||
    starts6(words, V6.linkLocal, 10) ||
    starts6(words, V6.multicast, 8) ||
    starts6(words, V6.mapped, 96) ||
    starts6(words, V6.documentation, 32) ||
    starts6(words, V6.documentationV2, 20) ||
    starts6(words, V6.ietfAssignments, 23) ||
    starts6(words, V6.nat64, 96) ||
    starts6(words, V6.nat64NetworkSpecific, 48) ||
    starts6(words, V6.discardOnly, 64) ||
    starts6(words, V6.dummyPrefix, 64) ||
    starts6(words, V6.sixToFour, 16) ||
    starts6(words, V6.directDelegationAs112, 48) ||
    starts6(words, V6.srv6Sids, 16)
  )
    return false;
  return (words[0] & 0xe000) === 0x2000;
}
function resolveLookup(host, lookup) {
  if (lookup.length >= 3)
    return new Promise((resolve, reject) =>
      lookup(host, { all: true, verbatim: true }, (error, value) =>
        error ? reject(error) : resolve(value)
      )
    );
  return Promise.resolve(lookup(host, { all: true, verbatim: true }));
}
export async function lookupPublicAddresses(
  host,
  lookup = (name, options) => dns.lookup(name, options)
) {
  const answers = await resolveLookup(host, lookup);
  if (!Array.isArray(answers) || answers.length === 0)
    fail("DNS returned no addresses");
  const addresses = answers.map((answer) =>
    typeof answer === "string" ? answer : answer?.address
  );
  if (
    addresses.some(
      (address) => typeof address !== "string" || !isPublicAddress(address)
    )
  )
    fail("DNS answer is not public");
  return [...new Set(addresses)].sort((a, b) => a.localeCompare(b));
}
export async function resolvePinnedAddress(host, lookup) {
  const addresses = await lookupPublicAddresses(host, lookup);
  const address = addresses[0];
  return Object.freeze({ address, family: isIP(address), addresses });
}
function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error("deadline")), ms);
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() =>
    clearTimeout(timer)
  );
}
export async function resolvePinnedAddressWithDeadline(host, lookup, ms) {
  return withDeadline(resolvePinnedAddress(host, lookup), ms);
}

export function decideConnect({ authority, allowedAuthorities }) {
  try {
    const normalized = normalizeAuthority(authority);
    const allowed = (
      allowedAuthorities instanceof Set
        ? allowedAuthorities
        : new Set(allowedAuthorities ?? [])
    ).has(normalized);
    return {
      allowed,
      authority: normalized,
      reason: allowed ? "allowlisted" : "not-allowlisted",
    };
  } catch (error) {
    return {
      allowed: false,
      reason: error instanceof Error ? error.message : "invalid-authority",
    };
  }
}
function u16(buffer, offset) {
  return buffer.readUInt16BE(offset);
}
function u24(buffer, offset) {
  return (
    buffer[offset] * 65_536 + buffer[offset + 1] * 256 + buffer[offset + 2]
  );
}
/** Parse enough TLS framing to require one complete ClientHello and one SNI name. */
export function parseClientHello(
  input,
  maxBytes = DEFAULTS.maxClientHelloBytes
) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? []);
  if (buffer.length > maxBytes)
    return { status: "reject", reason: "client-hello-bound" };
  if (buffer.length < 1) return { status: "need-more" };
  if (buffer[0] !== 22) return { status: "reject", reason: "not-tls" };
  let offset = 0;
  const handshake = [];
  while (offset < buffer.length) {
    if (buffer.length - offset < 5) return { status: "need-more" };
    const type = buffer[offset];
    const major = buffer[offset + 1];
    const minor = buffer[offset + 2];
    const length = u16(buffer, offset + 3);
    if (type !== 22 || major !== 3 || minor < 1 || minor > 4)
      return { status: "reject", reason: "invalid-tls-record" };
    if (length > maxBytes)
      return { status: "reject", reason: "client-hello-bound" };
    if (buffer.length - offset < 5 + length) return { status: "need-more" };
    handshake.push(buffer.subarray(offset + 5, offset + 5 + length));
    offset += 5 + length;
    const combined = Buffer.concat(handshake);
    if (combined.length < 4) continue;
    if (combined[0] !== 1)
      return { status: "reject", reason: "not-client-hello" };
    const helloLength = u24(combined, 1);
    if (helloLength > maxBytes)
      return { status: "reject", reason: "client-hello-bound" };
    if (combined.length < 4 + helloLength) continue;
    const body = combined.subarray(4, 4 + helloLength);
    if (body.length < 34)
      return { status: "reject", reason: "malformed-client-hello" };
    let p = 34;
    if (p + 1 > body.length)
      return { status: "reject", reason: "malformed-client-hello" };
    const sessionLength = body[p];
    p += 1 + sessionLength;
    if (p + 2 > body.length)
      return { status: "reject", reason: "malformed-client-hello" };
    const ciphersLength = u16(body, p);
    p += 2 + ciphersLength;
    if (p + 1 > body.length)
      return { status: "reject", reason: "malformed-client-hello" };
    const compressionLength = body[p];
    p += 1 + compressionLength;
    if (p + 2 > body.length)
      return { status: "reject", reason: "malformed-client-hello" };
    const extensionsLength = u16(body, p);
    p += 2;
    if (p + extensionsLength > body.length)
      return { status: "reject", reason: "malformed-client-hello" };
    const end = p + extensionsLength;
    const names = [];
    while (p + 4 <= end) {
      const extensionType = u16(body, p);
      const extensionLength = u16(body, p + 2);
      p += 4;
      if (p + extensionLength > end)
        return { status: "reject", reason: "malformed-client-hello" };
      if (extensionType === 0) {
        if (extensionLength < 2)
          return { status: "reject", reason: "malformed-sni" };
        let n = p + 2;
        const listEnd = p + 2 + u16(body, p);
        if (listEnd !== p + extensionLength)
          return { status: "reject", reason: "malformed-sni" };
        while (n + 3 <= listEnd) {
          const nameType = body[n];
          const nameLength = u16(body, n + 1);
          n += 3;
          if (n + nameLength > listEnd)
            return { status: "reject", reason: "malformed-sni" };
          if (nameType === 0)
            names.push(body.subarray(n, n + nameLength).toString("utf8"));
          n += nameLength;
        }
        if (n !== listEnd) return { status: "reject", reason: "malformed-sni" };
      }
      p += extensionLength;
    }
    if (
      p !== end ||
      names.length !== 1 ||
      !names[0] ||
      /[\x00-\x1f\x7f\s]/u.test(names[0])
    )
      return { status: "reject", reason: "missing-or-ambiguous-sni" };
    return { status: "valid", serverName: names[0], consumed: offset };
  }
  return { status: "need-more" };
}
export function decideClientHello({ buffer, authority, maxBytes }) {
  const result = parseClientHello(buffer, maxBytes);
  if (result.status !== "valid") return { allowed: false, ...result };
  const host = authority.slice(0, authority.lastIndexOf(":"));
  if (result.serverName !== host)
    return {
      allowed: false,
      status: "reject",
      reason: "sni-mismatch",
      serverName: result.serverName,
    };
  return { allowed: true, ...result };
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}
function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
function sanitize(value, length) {
  return String(value ?? "unknown")
    .replace(/[\x00-\x1f\x7f]/gu, "?")
    .slice(0, length);
}
/** Append-only runner-owned audit; the sealed snapshot authenticates its exact event bytes. */
export function createAudit(getActive = () => ({ requests: 0, sockets: 0 })) {
  let sequence = 0;
  let sealed = false;
  let sealedSnapshot;
  const events = [];
  const makeSealedSnapshot = () => {
    const body = {
      schemaVersion: 1,
      protocol: EGRESS_GATEWAY_AUDIT_PROTOCOL,
      events: events.map((event) => ({ ...event })),
    };
    return deepFreeze({
      ...body,
      sealed: true,
      sha256: digest(
        `${EGRESS_GATEWAY_AUDIT_PROTOCOL}\0${JSON.stringify(body)}`
      ),
    });
  };
  return Object.freeze({
    get active() {
      return Object.freeze({ ...getActive() });
    },
    record(event) {
      if (sealed) throw new Error("audit is sealed");
      const safe = {
        seq: ++sequence,
        kind: sanitize(event?.kind, 32),
        decision: event?.decision === "allow" ? "allow" : "deny",
        reason: sanitize(event?.reason, 96),
      };
      if (event?.authority) safe.authorityDigest = digest(event.authority);
      events.push(deepFreeze(safe));
      return safe;
    },
    snapshot() {
      return deepFreeze(events.map((event) => ({ ...event })));
    },
    seal() {
      if (sealedSnapshot) return sealedSnapshot;
      const active = getActive();
      if (active.requests !== 0 || active.sockets !== 0)
        throw new Error("audit cannot be sealed while active");
      sealed = true;
      sealedSnapshot = makeSealedSnapshot();
      return sealedSnapshot;
    },
    get sealed() {
      return sealed;
    },
  });
}

/** Verify a sealed audit before accepting it as evidence from another process. */
export function parseAuditSnapshot(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.schemaVersion !== 1 ||
    value.protocol !== EGRESS_GATEWAY_AUDIT_PROTOCOL ||
    value.sealed !== true ||
    !Array.isArray(value.events) ||
    typeof value.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(value.sha256)
  ) {
    throw new TypeError("invalid egress gateway audit");
  }
  const events = value.events.map((event, index) => {
    const keys = Object.keys(event ?? {}).sort();
    const hasAuthority = Object.hasOwn(event ?? {}, "authorityDigest");
    const expectedKeys = hasAuthority
      ? ["authorityDigest", "decision", "kind", "reason", "seq"]
      : ["decision", "kind", "reason", "seq"];
    if (
      !event ||
      typeof event !== "object" ||
      JSON.stringify(keys) !== JSON.stringify(expectedKeys) ||
      !Number.isSafeInteger(event.seq) ||
      event.seq < 1 ||
      event.seq !== index + 1 ||
      typeof event.kind !== "string" ||
      event.kind.length === 0 ||
      event.kind.length > 32 ||
      /[\x00-\x1f\x7f]/u.test(event.kind) ||
      typeof event.reason !== "string" ||
      event.reason.length === 0 ||
      event.reason.length > 96 ||
      /[\x00-\x1f\x7f]/u.test(event.reason) ||
      (event.decision !== "allow" && event.decision !== "deny") ||
      (hasAuthority && !/^[a-f0-9]{64}$/u.test(event.authorityDigest))
    ) {
      throw new TypeError("invalid egress gateway audit event");
    }
    return Object.freeze({ ...event });
  });
  const body = {
    schemaVersion: 1,
    protocol: EGRESS_GATEWAY_AUDIT_PROTOCOL,
    events,
  };
  const expected = digest(
    `${EGRESS_GATEWAY_AUDIT_PROTOCOL}\0${JSON.stringify(body)}`
  );
  if (expected !== value.sha256)
    throw new TypeError("egress gateway audit digest mismatch");
  return deepFreeze({ ...body, sealed: true, sha256: expected });
}
function response(res, status, text = "denied") {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(text, "utf8");
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    connection: "close",
  });
  res.end(body);
}
function abort(socket) {
  if (socket && !socket.destroyed) socket.destroy();
}

export function createGateway(config, dependencies = {}) {
  const lookup =
    dependencies.lookup ?? ((name, options) => dns.lookup(name, options));
  const connect = dependencies.connect ?? netConnect;
  const state = {
    activeRequests: 0,
    totalRequests: 0,
    closed: false,
    sockets: new Set(),
    upstreams: new Set(),
    operations: new Set(),
    teardowns: new Set(),
  };
  const audit =
    dependencies.audit ??
    createAudit(() => ({
      requests: state.activeRequests,
      sockets: state.sockets.size + state.upstreams.size,
    }));
  const trackOperation = (operation) => {
    let tracked;
    tracked = Promise.resolve(operation).finally(() =>
      state.operations.delete(tracked)
    );
    // The operation is still awaited by close; this prevents an unhandled
    // rejection if it finishes before shutdown begins.
    tracked.catch(() => {});
    state.operations.add(tracked);
    return tracked;
  };
  const waitForSocketClose = (socket) => {
    if (!socket || typeof socket.once !== "function") return Promise.resolve();
    return new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      socket.once("close", done);
      if (socket.destroyed) queueMicrotask(done);
    });
  };
  const trackTeardown = (socket) => {
    const teardown = waitForSocketClose(socket);
    state.teardowns.add(teardown);
    teardown.finally(() => state.teardowns.delete(teardown)).catch(() => {});
    return teardown;
  };
  const trackSocket = (socket) => {
    state.sockets.add(socket);
    socket.once("close", () => state.sockets.delete(socket));
    trackTeardown(socket);
    if (state.closed) abort(socket);
  };
  const trackUpstream = (socket) => {
    state.upstreams.add(socket);
    socket.once("close", () => state.upstreams.delete(socket));
    const teardown = trackTeardown(socket);
    if (state.closed) abort(socket);
    return teardown;
  };
  const destroyAll = async () => {
    for (const socket of state.sockets) abort(socket);
    for (const socket of state.upstreams) abort(socket);
    while (state.operations.size > 0 || state.teardowns.size > 0) {
      await Promise.allSettled([
        ...state.operations,
        ...state.teardowns,
      ]);
    }
  };
  async function handleConnect(req, client, head) {
    if (state.closed || client.destroyed) {
      abort(client);
      return;
    }
    client.setTimeout(0);
    state.activeRequests += 1;
    trackSocket(client);
    let finished = false;
    let timer;
    let upstream;
    const startedAt = Date.now();
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      state.activeRequests = Math.max(0, state.activeRequests - 1);
      state.sockets.delete(client);
      if (upstream) {
        state.upstreams.delete(upstream);
        abort(upstream);
      }
    };
    client.once("close", finish);
    timer = setTimeout(() => {
      abort(client);
      abort(upstream);
      finish();
    }, config.deadlineMs);
    if (client.destroyed) {
      finish();
      return;
    }
    const deny = (status, reason) => {
      audit.record({
        kind: "connect",
        decision: "deny",
        reason,
        authority: req.url,
      });
      if (!client.destroyed) {
        client.write(
          `HTTP/1.1 ${status} Denied\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`
        );
        client.destroy();
      }
      finish();
    };
    const decision = decideConnect({
      authority: req.url,
      allowedAuthorities: config.allowedAuthorities,
    });
    if (!decision.allowed) {
      deny(403, decision.reason);
      return;
    }
    if (state.totalRequests > config.maxRequests) {
      deny(429, "request-bound");
      return;
    }
    if (state.sockets.size > config.maxConnections) {
      deny(429, "connection-bound");
      return;
    }
    client.write(
      "HTTP/1.1 200 Connection Established\r\nConnection: keep-alive\r\n\r\n"
    );
    client.pause();
    let buffered = Buffer.alloc(0);
    let started = false;
    const remaining = () =>
      Math.max(1, config.deadlineMs - (Date.now() - startedAt));
    const establish = async (helloBytes) => {
      if (helloBytes.length > config.maxTunnelBytes) {
        audit.record({
          kind: "connect",
          decision: "deny",
          reason: "tunnel-bound",
          authority: decision.authority,
        });
        abort(client);
        finish();
        return;
      }
      try {
        const pinned = await resolvePinnedAddressWithDeadline(
          decision.authority.slice(0, -4),
          lookup,
          remaining()
        );
        if (finished) return;
        try {
          const candidate = connect({
            host: pinned.address,
            port: 443,
            family: pinned.family,
          });
          // net.connect returns its socket synchronously. Avoid inserting a
          // microtask before attaching the connect listener, while still
          // bounding promise-returning test or adapter implementations.
          upstream =
            candidate && typeof candidate.then === "function"
              ? await withDeadline(candidate, remaining())
              : candidate;
        } catch {
          throw new Error("connection-failed");
        }
        if (finished || state.closed) {
          const upstreamClosed = waitForSocketClose(upstream);
          abort(upstream);
          await upstreamClosed;
          return;
        }
        if (!upstream || typeof upstream.once !== "function")
          throw new Error("connection-failed");
        const upstreamClosed = trackUpstream(upstream);
        upstream.once("connect", () => {
          if (finished) return;
          audit.record({
            kind: "connect",
            decision: "allow",
            reason: "connected",
            authority: decision.authority,
          });
          let bytes = helloBytes.length;
          const counted = (chunk) => {
            bytes += chunk.length;
            if (bytes > config.maxTunnelBytes) {
              audit.record({
                kind: "connect",
                decision: "deny",
                reason: "tunnel-bound",
                authority: decision.authority,
              });
              abort(client);
              abort(upstream);
              finish();
            }
          };
          upstream.on("data", counted);
          client.on("data", counted);
          if (helloBytes.length) upstream.write(helloBytes);
          client.pipe(upstream);
          upstream.pipe(client);
          client.resume();
        });
        upstream.once("error", () => {
          abort(client);
          finish();
        });
        upstream.once("close", finish);
        upstream.setTimeout?.(remaining(), () => {
          abort(client);
          abort(upstream);
          finish();
        });
        await upstreamClosed;
      } catch (error) {
        if (finished) return;
        const reason =
          error?.message === "connection-failed"
            ? "connection-failed"
            : "dns-deadline-or-private";
        audit.record({
          kind: "connect",
          decision: "deny",
          reason,
          authority: decision.authority,
        });
        abort(client);
        finish();
      }
    };
    const onData = (chunk) => {
      if (started || finished) return;
      buffered = Buffer.concat([buffered, chunk]);
      if (
        buffered.length > config.maxClientHelloBytes ||
        buffered.length > config.maxTunnelBytes
      ) {
        audit.record({
          kind: "connect",
          decision: "deny",
          reason: "client-hello-bound",
          authority: decision.authority,
        });
        abort(client);
        finish();
        return;
      }
      const hello = decideClientHello({
        buffer: buffered,
        authority: decision.authority,
        maxBytes: config.maxClientHelloBytes,
      });
      if (!hello.allowed) {
        if (hello.status === "need-more") return;
        audit.record({
          kind: "connect",
          decision: "deny",
          reason: hello.reason,
          authority: decision.authority,
        });
        abort(client);
        finish();
        return;
      }
      started = true;
      client.off("data", onData);
      client.pause();
      trackOperation(establish(buffered));
    };
    client.on("data", onData);
    if (head.length) onData(head);
    else client.resume();
  }
  const server = createHttpServer(
    {
      maxHeaderSize: config.maxHeaderBytes,
      requestTimeout: config.deadlineMs,
      headersTimeout: config.deadlineMs,
    },
    (req, res) => {
      if (
        (req.url === "/healthz" || req.url === "/readyz") &&
        (req.method === "GET" || req.method === "HEAD")
      ) {
        response(
          res,
          state.closed ? 503 : 200,
          state.closed ? "not ready" : "ok"
        );
        return;
      }
      state.totalRequests += 1;
      const limited = state.totalRequests > config.maxRequests;
      audit.record({
        kind: "http",
        decision: "deny",
        reason: limited ? "request-bound" : "connect-only",
        authority: "http",
      });
      response(res, limited ? 429 : 405);
    }
  );
  server.maxConnections = config.maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on("connect", (req, client, head) => {
    state.totalRequests += 1;
    trackOperation(handleConnect(req, client, head));
  });
  server.on("connection", (socket) => {
    trackSocket(socket);
    socket.setTimeout(config.deadlineMs, () => abort(socket));
  });
  server.on("clientError", (_error, socket) => {
    audit.record({
      kind: "http",
      decision: "deny",
      reason: "invalid-request",
      authority: "http",
    });
    abort(socket);
  });
  server.on("upgrade", (_req, socket) => {
    audit.record({
      kind: "http",
      decision: "deny",
      reason: "upgrade-not-supported",
      authority: "http",
    });
    abort(socket);
  });
  let closePromise;
  const close = () => {
    if (closePromise) return closePromise;
    state.closed = true;
    closePromise = (async () => {
      await destroyAll();
      server.closeAllConnections?.();
      server.closeIdleConnections?.();
      await new Promise((resolve) => server.close(() => resolve()));
      await destroyAll();
      if (state.activeRequests !== 0 || state.sockets.size || state.upstreams.size)
        throw new Error("gateway close left active work");
    })();
    return closePromise;
  };
  return Object.freeze({
    protocol: EGRESS_GATEWAY_PROTOCOL,
    server,
    audit,
    get state() {
      return Object.freeze({
        activeRequests: state.activeRequests,
        activeSockets: state.sockets.size + state.upstreams.size,
        totalRequests: state.totalRequests,
        closed: state.closed,
      });
    },
    close,
    seal: () => audit.seal(),
    auditSnapshot: () => (audit.sealed ? audit.seal() : audit.snapshot()),
  });
}

export function runFixture(mode, input) {
  if (mode === "policy")
    return {
      authorities: [...parseAllowlist(input.authorities ?? input)].sort(),
    };
  if (mode === "address")
    return { address: input.address, public: isPublicAddress(input.address) };
  if (mode === "connect")
    return decideConnect({
      authority: input.authority,
      allowedAuthorities: parseAllowlist(input.allowedAuthorities),
    });
  if (mode === "tls")
    return decideClientHello({
      buffer: Buffer.from(input.bytesBase64, "base64"),
      authority: input.authority,
      maxBytes: input.maxBytes,
    });
  if (mode === "audit") {
    const audit = createAudit();
    for (const event of input.events ?? []) audit.record(event);
    return input.seal ? audit.seal() : { events: audit.snapshot() };
  }
  if (mode === "dns")
    return lookupPublicAddresses(input.host, async () => input.answers);
  fail(`unsupported fixture mode: ${mode}`);
}
function fixtureModeFor(argument) {
  return argument === "--policy-fixture"
    ? "policy"
    : argument === "--public-address-fixture" ||
      argument === "--address-fixture"
    ? "address"
    : argument === "--decision-fixture" || argument === "--connect-fixture"
    ? "connect"
    : argument === "--tls-fixture"
    ? "tls"
    : argument === "--audit-fixture"
    ? "audit"
    : argument === "--dns-fixture"
    ? "dns"
    : argument?.startsWith("--fixture-")
    ? argument.slice("--fixture-".length)
    : null;
}
async function main() {
  const [argument, ...extra] = process.argv.slice(2);
  const fixtureMode = fixtureModeFor(argument);
  if (fixtureMode) {
    if (extra.length) fail("fixture mode does not accept extra arguments");
    let text = "";
    for await (const chunk of process.stdin) text += chunk;
    process.stdout.write(
      `${JSON.stringify(runFixture(fixtureMode, JSON.parse(text)))}\n`
    );
    return;
  }
  if (argument !== undefined) fail("unknown egress gateway argument");
  const config = parseConfig();
  const gateway = createGateway(config);
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    try {
      await gateway.close();
      const audit = gateway.seal();
      process.stdout.write(
        `${JSON.stringify({ status: "sealed", protocol: EGRESS_GATEWAY_PROTOCOL, audit })}\n`
      );
    } catch {
      process.stderr.write("egress gateway failed\n");
      process.exitCode = 1;
    }
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  gateway.server.listen(config.bindPort, config.bindHost, () => {
    const address = gateway.server.address();
    process.stdout.write(
      `${JSON.stringify({
        status: "ready",
        protocol: EGRESS_GATEWAY_PROTOCOL,
        host: config.bindHost,
        port:
          typeof address === "object" && address
            ? address.port
            : config.bindPort,
      })}\n`
    );
  });
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url)
  void main().catch(() => {
    process.stderr.write("egress gateway failed\n");
    process.exitCode = 1;
  });
export const parseGatewayConfig = parseConfig;
export const normalizeConnectAuthority = normalizeAuthority;
export const classifyPublicAddress = isPublicAddress;
export const resolveAllPublicAddresses = lookupPublicAddresses;
export const decideConnectAuthority = decideConnect;
