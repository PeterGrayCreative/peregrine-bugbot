#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { createServer, request as httpRequest } from "node:http";
import { isIP } from "node:net";
import { fileURLToPath } from "node:url";

/**
 * A deliberately boring HTTP/1.1 bridge for the methodology MCP endpoint.
 *
 * The bridge has one destination.  It does not implement a proxy URL, proxy
 * headers, redirects, CONNECT, upgrades, or a health endpoint.  The only
 * values that can vary at runtime are the bind authority, the capability
 * token, and the upstream port.
 */
export const METHODOLOGY_MCP_FORWARDER_PROTOCOL = "methodology-mcp-forwarder-v1";
export const METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL = "methodology-mcp-forwarder-audit-v1";
export const METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST = "host.docker.internal";

const MAX_HEADER_BYTES = 64 * 1024;
const MAX_BODY_BYTES = 50 * 1024 * 1024;
const MAX_TIMEOUT_MS = 120_000;
const ALLOWED_REQUEST_HEADERS = new Set([
  "accept", "content-type", "mcp-protocol-version", "mcp-session-id",
]);
const SAFE_METHODS = new Set(["POST"]);
const DENIAL_CODES = new Set([
  "absolute-form-not-supported", "content-encoding-not-supported",
  "content-type-not-supported", "connect-not-supported", "duplicate-header",
  "expect-not-supported", "forwarder-closed", "header-byte-limit",
  "host-not-allowed", "method-not-supported", "path-not-allowed",
  "request-byte-limit", "request-deadline", "request-limit",
  "request-unavailable", "upgrade-not-supported", "upstream-failure",
  "upstream-response-byte-limit", "upstream-redirect", "invalid-request",
]);

/** @typedef {{
 *   host: string, port: number, allowedHost?: string, token: string,
 *   upstreamPort: number, maxRequestBytes: number, maxResponseBytes: number,
 *   maxHeaderBytes: number, requestTimeoutMs: number, maxConnections: number,
 *   maxRequests: number, fixtureMode?: boolean, lookup?: Function,
 *   fixtureRequest?: (request: {method: string, hostname: string, port: number,
 *     path: string, headers: Readonly<Record<string, string>>, body: Buffer,
 *     timeoutMs: number}) => Promise<{statusCode: number, headers?: Record<string, string>, body?: Buffer|string}> | {statusCode: number, headers?: Record<string, string>, body?: Buffer|string}
 * }} MethodologyMcpForwarderOptions */

/**
 * Start the forwarder.  `fixtureRequest` is intentionally available only in
 * fixture mode: it receives the already-fixed destination and cannot provide
 * a destination of its own.  This keeps tests local without creating a
 * production SSRF escape hatch.
 *
 * @param {MethodologyMcpForwarderOptions} options
 */
export async function startMethodologyMcpForwarder(options) {
  const config = normalizeOptions(options);
  const pinnedGateway = config.fixtureRequest && !config.lookup ? null
    : await resolveHostGatewayAddress(METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST, config.lookup);
  const endpoint = `/mcp/${config.token}`;
  const upstreamHostHeader = `${METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST}:${config.upstreamPort}`;
  let allowedHost = config.allowedHost;

  let closed = false;
  let sealed = false;
  let sealedSnapshot;
  let requestSequence = 0;
  let observed = 0;
  let allowed = 0;
  let denied = 0;
  let forwarded = 0;
  let activeHandlers = 0;
  let closePromise;
  const activeWork = new Set();
  const shutdownController = new AbortController();
  const sockets = new Set();
  const pendingHeaders = new Set();
  const audit = [];

  const increment = (value) => value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
  const record = (decision, code) => {
    if (sealed) throw new Error("forwarder audit is sealed");
    const safeCode = DENIAL_CODES.has(code) || code === "forwarded" || code === "accepted" ? code : "internal";
    audit.push(Object.freeze({ sequence: ++requestSequence, decision, code: safeCode }));
  };
  const deny = (code) => {
    denied = increment(denied);
    record("deny", code);
  };
  const allow = (code = "forwarded") => {
    allowed = increment(allowed);
    if (code === "forwarded") forwarded = increment(forwarded);
    record("allow", code);
  };

  const makeSnapshot = () => {
    const body = {
      schemaVersion: 1,
      protocol: METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL,
      sealed,
      requests: Object.freeze({ observed, allowed, denied, forwarded, budgeted: Math.min(observed, config.maxRequests) }),
      events: Object.freeze(audit.slice()),
    };
    return Object.freeze({ ...body, snapshotSha256: createHash("sha256")
      .update(`${METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL}\0`).update(JSON.stringify(body)).digest("hex") });
  };

  const send = (response, status, body, headers = {}) => {
    if (response.writableEnded || response.destroyed) return;
    headers ??= {};
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body ?? "", "utf8");
    if (bytes.length > config.maxResponseBytes) {
      response.writeHead(502, safeResponseHeaders(Buffer.byteLength("{\"error\":\"Response unavailable\"}"), "application/json"));
      response.end("{\"error\":\"Response unavailable\"}");
      return;
    }
    response.writeHead(status, safeResponseHeaders(bytes.length, headers["content-type"], headers["mcp-session-id"]));
    response.end(bytes);
  };
  const sendError = (response, status, message) => send(response, status, JSON.stringify({ error: message }), { "content-type": "application/json" });

  const server = createServer({ maxHeaderSize: config.maxHeaderBytes, requestTimeout: config.requestTimeoutMs,
    headersTimeout: config.requestTimeoutMs }, (request, response) => {
    const socket = request.socket;
    pendingHeaders.delete(socket);
    if (sealed) {
      sendError(response, 404, "Forwarder is sealed");
      return;
    }
    activeHandlers++;
    const work = handle(request, response).catch(() => {
      if (!response.writableEnded && !response.destroyed) sendError(response, 502, "Request unavailable");
      deny("request-unavailable");
    }).finally(() => { activeHandlers--; activeWork.delete(work); });
    activeWork.add(work);
  });
  server.maxConnections = config.maxConnections;
  server.maxRequestsPerSocket = 1;

  server.on("connection", (socket) => {
    sockets.add(socket);
    pendingHeaders.add(socket);
    const deadline = setTimeout(() => {
      if (pendingHeaders.has(socket)) record("deny", "request-deadline");
      socket.destroy();
    }, config.requestTimeoutMs);
    deadline.unref();
    socket.once("close", () => {
      clearTimeout(deadline);
      sockets.delete(socket);
      pendingHeaders.delete(socket);
    });
  });
  server.on("clientError", (_error, socket) => {
    pendingHeaders.delete(socket);
    record("deny", "invalid-request");
    socket.destroy();
  });
  server.on("drop", () => record("deny", "request-limit"));
  server.on("upgrade", (_request, socket) => {
    pendingHeaders.delete(socket);
    record("deny", "upgrade-not-supported");
    socket.destroy();
  });
  server.on("connect", (_request, socket) => {
    pendingHeaders.delete(socket);
    record("deny", "connect-not-supported");
    socket.destroy();
  });
  server.on("checkContinue", (_request, response) => {
    if (sealed) return sendError(response, 404, "Forwarder is sealed");
    pendingHeaders.delete(_request.socket);
    observed = increment(observed);
    deny("expect-not-supported");
    sendError(response, 417, "Expect is not supported");
  });

  async function handle(request, response) {
    observed = increment(observed);
    if (closed) { deny("forwarder-closed"); sendError(response, 404, "Forwarder is closed"); return; }
    if (observed > config.maxRequests) { deny("request-limit"); sendError(response, 429, "Request limit reached"); return; }
    if (request.url !== endpoint) {
      deny(request.url?.startsWith("/") ? "path-not-allowed" : "absolute-form-not-supported");
      sendError(response, 404, "Endpoint not found"); return;
    }
    if (request.headers.host !== allowedHost) { deny("host-not-allowed"); sendError(response, 403, "Host is not allowed"); return; }
    if (!SAFE_METHODS.has(request.method ?? "")) { deny("method-not-supported"); response.setHeader("Allow", "POST"); sendError(response, 405, "Method not supported"); return; }
    if (hasDuplicateHeader(request, ["host", ...ALLOWED_REQUEST_HEADERS, "content-length", "content-encoding", "transfer-encoding"])) {
      deny("duplicate-header"); sendError(response, 400, "Duplicate header"); return;
    }
    if (request.headers.upgrade !== undefined || headerContainsToken(request.headers.connection, "upgrade")) {
      deny("upgrade-not-supported"); sendError(response, 400, "Upgrade is not supported"); return;
    }
    if (request.headers["content-encoding"] !== undefined || request.headers["transfer-encoding"] !== undefined && request.headers["transfer-encoding"] !== "chunked") {
      deny("content-encoding-not-supported"); sendError(response, 415, "Encoded requests are not supported"); return;
    }
    const contentType = request.headers["content-type"];
    if (typeof contentType !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)) {
      deny("content-type-not-supported"); sendError(response, 415, "JSON content is required"); return;
    }
    if (request.headers["content-length"] !== undefined && !validContentLength(request.headers["content-length"], config.maxRequestBytes)) {
      deny("request-byte-limit"); sendError(response, 413, "Request is too large"); return;
    }
    let body;
    try {
      body = await readBody(request, config.maxRequestBytes, config.requestTimeoutMs);
    } catch (error) {
      const code = error?.code === "request-byte-limit" ? "request-byte-limit"
        : error?.code === "deadline" ? "request-deadline" : "request-unavailable";
      deny(code);
      sendError(response, code === "request-byte-limit" ? 413 : code === "request-deadline" ? 408 : 400,
        code === "request-byte-limit" ? "Request is too large" : code === "request-deadline" ? "Request deadline exceeded" : "Request unavailable");
      return;
    }
    const headers = {
      host: upstreamHostHeader,
      accept: typeof request.headers.accept === "string" ? request.headers.accept : "application/json, text/event-stream",
      "content-type": contentType,
      "content-length": String(body.length),
      ...(typeof request.headers["mcp-protocol-version"] === "string" ? { "mcp-protocol-version": request.headers["mcp-protocol-version"] } : {}),
      ...(typeof request.headers["mcp-session-id"] === "string" ? { "mcp-session-id": request.headers["mcp-session-id"] } : {}),
      connection: "close",
    };
    const remaining = config.requestTimeoutMs;
    let upstream;
    try {
      const upstreamWork = config.fixtureRequest
        ? config.fixtureRequest(Object.freeze({ method: "POST", hostname: METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST,
          port: config.upstreamPort, path: endpoint, headers: Object.freeze({ ...headers }), body, timeoutMs: remaining }))
        : requestExactUpstream({ method: "POST", hostname: METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST,
          port: config.upstreamPort, path: endpoint, headers, body, timeoutMs: remaining, maxHeaderBytes: config.maxHeaderBytes,
          maxResponseBytes: config.maxResponseBytes, pinnedGateway, signal: shutdownController.signal });
      upstream = await withDeadline(upstreamWork, remaining, shutdownController.signal);
    } catch (error) {
      if (error?.code === "forwarder-closed") deny("forwarder-closed");
      else if (error?.code === "response-byte-limit") deny("upstream-response-byte-limit");
      else if (error?.code === "deadline") deny("request-deadline");
      else deny("upstream-failure");
      sendError(response, error?.code === "forwarder-closed" ? 503 : error?.code === "deadline" ? 504 : 502, "Upstream unavailable");
      return;
    }
    if (!upstream || !Number.isSafeInteger(upstream.statusCode) || upstream.statusCode < 100 || upstream.statusCode > 999) {
      deny("upstream-failure");
      sendError(response, 502, "Upstream unavailable");
      return;
    }
    const upstreamBody = Buffer.isBuffer(upstream.body) ? upstream.body : Buffer.from(upstream.body ?? "", "utf8");
    if (upstreamBody.length > config.maxResponseBytes) {
      deny("upstream-response-byte-limit");
      sendError(response, 502, "Upstream response rejected");
      return;
    }
    if (upstream.statusCode >= 300 && upstream.statusCode < 400) {
      deny("upstream-redirect");
      sendError(response, 502, "Upstream response rejected");
      return;
    }
    allow();
    send(response, upstream.statusCode, upstreamBody, upstream.headers);
  }

  await listen(server, config.port, config.host);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Forwarder listener has no TCP address");
  const boundAuthority = formatAuthority(config.host, address.port);
  const effectiveHost = allowedHost ?? boundAuthority;
  if (!isValidAuthority(effectiveHost)) {
    await closeServer(server, sockets);
    throw new Error("invalid allowedHost");
  }
  allowedHost = effectiveHost;

  return Object.freeze({
    protocol: METHODOLOGY_MCP_FORWARDER_PROTOCOL,
    url: `http://${boundAuthority}${endpoint}`,
    endpoint,
    boundHost: config.host,
    boundPort: address.port,
    upstreamPort: config.upstreamPort,
    readiness: () => Object.freeze({ schemaVersion: 1, protocol: METHODOLOGY_MCP_FORWARDER_PROTOCOL,
      ready: !closed && !sealed, sealed, activeWork: activeHandlers + pendingHeaders.size,
      activeConnections: sockets.size }),
    isReady: () => !closed && !sealed,
    auditSnapshot: () => sealedSnapshot ?? makeSnapshot(),
    sealAudit: () => {
      if (sealedSnapshot) return sealedSnapshot;
      if (activeHandlers !== 0 || pendingHeaders.size !== 0) throw new Error("forwarder audit cannot be sealed while work is active");
      sealed = true;
      sealedSnapshot = makeSnapshot();
      return sealedSnapshot;
    },
    close: () => {
      if (closePromise) return closePromise;
      closed = true;
      shutdownController.abort();
      closePromise = (async () => {
        await closeServer(server, sockets);
        await Promise.allSettled([...activeWork]);
      })();
      return closePromise;
    },
  });
}

export const createMethodologyMcpForwarder = startMethodologyMcpForwarder;

const ENV_NAMES = Object.freeze({
  host: "MCP_FORWARDER_BIND_HOST", port: "MCP_FORWARDER_BIND_PORT", allowedHost: "MCP_FORWARDER_ALLOWED_HOST",
  token: "MCP_FORWARDER_TOKEN", upstreamPort: "MCP_FORWARDER_UPSTREAM_PORT",
  maxRequestBytes: "MCP_FORWARDER_MAX_REQUEST_BYTES", maxResponseBytes: "MCP_FORWARDER_MAX_RESPONSE_BYTES",
  maxHeaderBytes: "MCP_FORWARDER_MAX_HEADER_BYTES", requestTimeoutMs: "MCP_FORWARDER_REQUEST_TIMEOUT_MS",
  maxConnections: "MCP_FORWARDER_MAX_CONNECTIONS", maxRequests: "MCP_FORWARDER_MAX_REQUESTS",
});

/** Parse only the explicit production environment contract; no credential or target overrides are accepted. */
export function parseMethodologyMcpForwarderConfig(env = process.env) {
  const prefix = "MCP_FORWARDER_";
  const accepted = new Set(Object.values(ENV_NAMES));
  for (const key of Object.keys(env)) if (key.startsWith(prefix) && !accepted.has(key)) throw new TypeError("unknown MCP_FORWARDER setting");
  const value = (key, required = true) => {
    const raw = env[key];
    if (raw === undefined || raw === "") {
      if (required) throw new TypeError("incomplete MCP_FORWARDER configuration");
      return undefined;
    }
    if (typeof raw !== "string" || /[\r\n\x00]/u.test(raw)) throw new TypeError("invalid MCP_FORWARDER setting");
    return raw;
  };
  const integer = (key, { min = 1, max = 50 * 1024 * 1024 } = {}) => {
    const raw = value(key);
    if (!/^[0-9]+$/u.test(raw)) throw new TypeError("MCP_FORWARDER number is invalid");
    const number = Number(raw);
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new TypeError("MCP_FORWARDER number is out of bounds");
    return number;
  };
  const config = {
    host: value(ENV_NAMES.host),
    port: integer(ENV_NAMES.port, { min: 1, max: 65535 }),
    token: value(ENV_NAMES.token),
    upstreamPort: integer(ENV_NAMES.upstreamPort, { max: 65535 }),
    maxRequestBytes: integer(ENV_NAMES.maxRequestBytes),
    maxResponseBytes: integer(ENV_NAMES.maxResponseBytes),
    maxHeaderBytes: integer(ENV_NAMES.maxHeaderBytes, { min: 1024, max: MAX_HEADER_BYTES }),
    requestTimeoutMs: integer(ENV_NAMES.requestTimeoutMs, { max: MAX_TIMEOUT_MS }),
    maxConnections: integer(ENV_NAMES.maxConnections, { max: 1024 }),
    maxRequests: integer(ENV_NAMES.maxRequests, { max: 1_000_000 }),
  };
  const configuredAllowedHost = value(ENV_NAMES.allowedHost, false);
  if (configuredAllowedHost !== undefined) config.allowedHost = configuredAllowedHost;
  return Object.freeze(config);
}

export const parseConfig = parseMethodologyMcpForwarderConfig;

export function parseMethodologyMcpForwarderAuditSnapshot(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      value.schemaVersion !== 1 || value.protocol !== METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL ||
      value.sealed !== true ||
      !value.requests || typeof value.requests !== "object" || !Array.isArray(value.events) ||
      typeof value.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(value.snapshotSha256)) {
    throw new TypeError("invalid methodology MCP forwarder audit");
  }
  const requestKeys = ["observed", "allowed", "denied", "forwarded", "budgeted"];
  if (Object.keys(value.requests).length !== requestKeys.length || requestKeys.some((key) =>
    !Number.isSafeInteger(value.requests[key]) || value.requests[key] < 0)) throw new TypeError("invalid forwarder audit counts");
  if (value.requests.allowed + value.requests.denied > value.requests.observed || value.requests.budgeted > value.requests.observed) {
    throw new TypeError("inconsistent forwarder audit counts");
  }
  const events = value.events.map((event, index) => {
    if (!event || typeof event !== "object" || Object.keys(event).length !== 3 || !Number.isSafeInteger(event.sequence) ||
        event.sequence !== index + 1 ||
        (event.decision !== "allow" && event.decision !== "deny") ||
        !(DENIAL_CODES.has(event.code) || event.code === "forwarded" || event.code === "accepted")) {
      throw new TypeError("invalid forwarder audit event");
    }
    return Object.freeze({ sequence: event.sequence, decision: event.decision, code: event.code });
  });
  const body = { schemaVersion: 1, protocol: METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL, sealed: true,
    requests: Object.freeze({ ...value.requests }), events: Object.freeze(events) };
  const digest = createHash("sha256").update(`${METHODOLOGY_MCP_FORWARDER_AUDIT_PROTOCOL}\0`).update(JSON.stringify(body)).digest("hex");
  if (digest !== value.snapshotSha256) throw new TypeError("forwarder audit digest mismatch");
  return Object.freeze({ ...body, snapshotSha256: digest });
}

function normalizeOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error("invalid forwarder configuration");
  const allowed = new Set(["host", "port", "allowedHost", "token", "upstreamPort", "maxRequestBytes", "maxResponseBytes",
    "maxHeaderBytes", "requestTimeoutMs", "maxConnections", "maxRequests", "fixtureMode", "fixtureRequest", "lookup"]);
  if (Object.keys(options).some((key) => !allowed.has(key))) throw new Error("unsupported forwarder configuration");
  for (const key of ["host", "token", "upstreamPort", "maxRequestBytes", "maxResponseBytes", "maxHeaderBytes",
    "requestTimeoutMs", "maxConnections", "maxRequests"]) if (!(key in options)) throw new Error("incomplete forwarder configuration");
  if (typeof options.host !== "string" || !isIP(options.host)) throw new Error("invalid forwarder host");
  if (!Number.isSafeInteger(options.port) || options.port < 0 || options.port > 65535) throw new Error("invalid forwarder port");
  if (typeof options.token !== "string" || !/^[a-f0-9]{64}$/.test(options.token)) throw new Error("invalid MCP capability token");
  if (!Number.isSafeInteger(options.upstreamPort) || options.upstreamPort < 1 || options.upstreamPort > 65535) throw new Error("invalid upstream port");
  if (options.allowedHost !== undefined && !isValidAuthority(options.allowedHost)) throw new Error("invalid allowedHost");
  for (const key of ["maxRequestBytes", "maxResponseBytes", "maxHeaderBytes", "requestTimeoutMs", "maxConnections", "maxRequests"]) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1) throw new Error(`invalid ${key}`);
  }
  if (options.maxRequestBytes > MAX_BODY_BYTES || options.maxResponseBytes > MAX_BODY_BYTES || options.maxHeaderBytes > MAX_HEADER_BYTES || options.requestTimeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("forwarder limit is too large");
  }
  if (options.maxResponseBytes < 64 || options.maxHeaderBytes < 1024) throw new Error("forwarder limit is too small");
  if (!Number.isSafeInteger(options.maxConnections) || options.maxConnections > 1024 || !Number.isSafeInteger(options.maxRequests) || options.maxRequests > 1_000_000) throw new Error("forwarder limit is too large");
  if (options.fixtureRequest !== undefined && (options.fixtureMode !== true || typeof options.fixtureRequest !== "function")) throw new Error("fixture transport requires fixtureMode");
  if (options.lookup !== undefined && (options.fixtureMode !== true || typeof options.lookup !== "function")) throw new Error("fixture lookup requires fixtureMode");
  if (options.fixtureMode === true && options.fixtureRequest === undefined && options.lookup === undefined) throw new Error("fixture transport is missing");
  return { ...options, allowedHost: options.allowedHost?.toLowerCase() };
}

function isValidAuthority(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 255 || /[\r\n]/.test(value)) return false;
  try {
    const parsed = new URL(`http://${value}`);
    return parsed.host === value.toLowerCase() && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash;
  } catch { return false; }
}

function formatAuthority(host, port) { return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`; }

/** Resolve once and pin the Docker host-gateway address for the process lifetime. */
export async function resolveHostGatewayAddress(host = METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST, lookup = dnsLookup) {
  let answers;
  try {
    const result = lookup.length >= 3
      ? new Promise((resolve, reject) => lookup(host, { all: true, verbatim: true }, (error, value) => error ? reject(error) : resolve(value)))
      : lookup(host, { all: true, verbatim: true });
    answers = await Promise.resolve(result);
  } catch {
    throw new Error("host gateway could not be resolved");
  }
  if (!Array.isArray(answers)) throw new Error("host gateway lookup returned no addresses");
  const addresses = [...new Set(answers.map((answer) => typeof answer === "string" ? answer : answer?.address))];
  if (addresses.length !== 1 || !isValidGatewayAddress(addresses[0])) throw new Error("host gateway must resolve to one valid address");
  return Object.freeze({ address: addresses[0], family: isIP(addresses[0]) });
}

function isValidGatewayAddress(address) {
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a !== 0 && a !== 127 && !(a === 169 && b === 254) && a < 224;
  }
  if (family !== 6) return false;
  const words = ipv6Words(address);
  if (!words) return false;
  const value = ipv6Value(words);
  if (value === 0n || value === 1n) return false;
  const normalized = address.toLowerCase();
  return !normalized.startsWith("fe80:") && !normalized.startsWith("ff") &&
    !isIpv4LoopbackMapping(words);
}

function ipv6Words(address) {
  let input = address.toLowerCase();
  if (input.includes("%")) return null;
  if (input.includes(".")) {
    const colon = input.lastIndexOf(":");
    const ipv4 = ipv4Number(input.slice(colon + 1));
    if (ipv4 === null || colon < 1) return null;
    input = `${input.slice(0, colon)}:${(ipv4 >>> 16).toString(16)}:${(ipv4 & 0xffff).toString(16)}`;
  }
  const halves = input.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (left.some((part) => !/^[0-9a-f]{1,4}$/u.test(part)) ||
      right.some((part) => !/^[0-9a-f]{1,4}$/u.test(part))) return null;
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null;
  return [...left, ...Array(missing).fill("0"), ...right].map((part) => Number.parseInt(part, 16));
}

function ipv4Number(value) {
  const parts = value.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d+$/u.test(part) || part.length > 3 || Number(part) > 255)) return null;
  return parts.reduce((number, part) => number * 256 + Number(part), 0);
}

function ipv6Value(words) {
  return words.reduce((value, word) => value * 65_536n + BigInt(word), 0n);
}

function isIpv4LoopbackMapping(words) {
  const isMapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const isCompatible = words.slice(0, 6).every((word) => word === 0);
  if (!isMapped && !isCompatible) return false;
  const ipv4FirstOctet = words[6] >>> 8;
  return ipv4FirstOctet === 127;
}

function hasDuplicateHeader(request, names) {
  const wanted = new Set(names);
  const counts = new Map();
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    const name = request.rawHeaders[index]?.toLowerCase();
    if (wanted.has(name)) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return [...counts.values()].some((count) => count > 1);
}

function headerContainsToken(value, token) {
  return typeof value === "string" && value.split(",").some((item) => item.trim().toLowerCase() === token);
}

function validContentLength(value, maximum) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return false;
  const length = Number(value);
  return Number.isSafeInteger(length) && length <= maximum;
}

function readBody(request, maximum, timeoutMs) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let settled = false;
    const timer = setTimeout(() => finish(Object.assign(new Error("deadline"), { code: "deadline" })), timeoutMs);
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      request.removeListener("data", onData);
      request.removeListener("end", onEnd);
      request.removeListener("error", onError);
      request.removeListener("aborted", onError);
      if (error) { request.pause(); reject(error); } else resolve(Buffer.concat(chunks, size));
    };
    const onData = (chunk) => {
      size += chunk.length;
      if (size > maximum) finish(Object.assign(new Error("request too large"), { code: "request-byte-limit" }));
      else chunks.push(chunk);
    };
    const onEnd = () => finish();
    const onError = () => finish(Object.assign(new Error("request unavailable"), { code: "request-unavailable" }));
    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
    request.on("aborted", onError);
  });
}

function requestExactUpstream({ method, hostname, port, path, headers, body, timeoutMs, maxHeaderBytes, maxResponseBytes, pinnedGateway, signal }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    const request = httpRequest({ protocol: "http:", hostname, port, path, method, headers, agent: false, signal,
      maxHeaderSize: maxHeaderBytes, joinDuplicateHeaders: false,
      lookup: (_name, options, callback) => options.all
        ? callback(null, [{ address: pinnedGateway.address, family: pinnedGateway.family }])
        : callback(null, pinnedGateway.address, pinnedGateway.family) }, (response) => {
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          response.destroy();
          finish(Object.assign(new Error("upstream response too large"), { code: "response-byte-limit" }));
        } else chunks.push(chunk);
      });
      response.on("end", () => {
        if (settled) return;
        const contentType = typeof response.headers["content-type"] === "string" ? response.headers["content-type"] : undefined;
        const session = typeof response.headers["mcp-session-id"] === "string" ? response.headers["mcp-session-id"] : undefined;
        finish(null, { statusCode: response.statusCode ?? 502, headers: { ...(contentType ? { "content-type": contentType } : {}), ...(session ? { "mcp-session-id": session } : {}) }, body: Buffer.concat(chunks, size) });
      });
      response.on("error", () => finish(Object.assign(new Error("upstream failure"), { code: "upstream-failure" })));
    });
    request.setTimeout(timeoutMs, () => { request.destroy(Object.assign(new Error("deadline"), { code: "deadline" })); });
    request.on("error", (error) => finish(error));
    request.end(body);
  });
}

function withDeadline(value, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve(result);
    };
    const onAbort = () => finish(Object.assign(new Error("forwarder closed"), { code: "forwarder-closed" }));
    const timer = setTimeout(() => finish(Object.assign(new Error("deadline"), { code: "deadline" })), timeoutMs);
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(value).then((result) => finish(undefined, result), (error) => finish(error));
  });
}

function safeResponseHeaders(length, contentType, sessionId) {
  const headers = { Connection: "close", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Content-Length": length };
  if (typeof contentType === "string" && /^(?:application\/json|text\/event-stream)(?:\s*;[^\r\n]*)?$/iu.test(contentType)) headers["Content-Type"] = contentType;
  if (typeof sessionId === "string" && /^[A-Za-z0-9._~-]{1,256}$/u.test(sessionId)) headers["Mcp-Session-Id"] = sessionId;
  return headers;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

async function closeServer(server, sockets) {
  const socketClosures = [...sockets].map((socket) => new Promise((resolve) => {
    socket.once("close", resolve);
    socket.destroy();
  }));
  const serverClosure = new Promise((resolve) => server.close(() => resolve()));
  await Promise.all([serverClosure, ...socketClosures]);
}

/** A tiny deterministic CLI fixture for smoke tests; it never uses credentials or the network. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === "--fixture-config") {
    process.stdout.write(`${JSON.stringify({ protocol: METHODOLOGY_MCP_FORWARDER_PROTOCOL, upstreamHost: METHODOLOGY_MCP_FORWARDER_UPSTREAM_HOST, tokenBytes: 32 })}\n`);
  } else if (process.argv[2] === "--serve" || process.argv[2] === undefined) {
    runProductionCli();
  } else {
    process.stderr.write("methodology MCP forwarder failed\n");
    process.exitCode = 1;
  }
}

async function runProductionCli() {
  let service;
  try {
    service = await startMethodologyMcpForwarder(parseMethodologyMcpForwarderConfig());
    process.stdout.write(`${JSON.stringify({ status: "ready", protocol: METHODOLOGY_MCP_FORWARDER_PROTOCOL, ready: true,
      host: service.boundHost, port: service.boundPort })}\n`);
    let stopping = false;
    const shutdown = async () => {
      if (stopping) return;
      stopping = true;
      try {
        await service.close();
        const audit = service.sealAudit();
        process.stdout.write(`${JSON.stringify({ status: "sealed", protocol: METHODOLOGY_MCP_FORWARDER_PROTOCOL, audit })}\n`);
      } catch {
        process.stderr.write("methodology MCP forwarder failed\n");
        process.exitCode = 1;
      }
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
  } catch {
    process.stderr.write("methodology MCP forwarder failed\n");
    process.exitCode = 1;
  }
}
