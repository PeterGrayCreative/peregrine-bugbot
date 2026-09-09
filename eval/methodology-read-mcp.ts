import { createHash, randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { isIP, type Socket } from "node:net";
import { createReviewReadTools, type ReviewReadToolLimits } from "./methodology-read-tools.js";

export const REVIEW_READ_MCP_PROTOCOL = "2025-06-18";
export const REVIEW_READ_MCP_BOUNDARY = "Experimental single-client HTTP adapter for an authenticated immutable export on an isolated network. The random endpoint and session are limited capabilities, not strong authentication or credential containment. Transport deadlines cannot preempt synchronous filesystem operations.";
// Pinned protocol sources: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
// https://modelcontextprotocol.io/specification/2025-06-18/basic/lifecycle
// https://modelcontextprotocol.io/specification/2025-06-18/server/tools

export interface ReviewReadMcpOptions {
  host?: string;
  port?: number;
  /** Exact HTTP Host authorities, including port. Defaults to the bound authority. */
  allowedHosts?: string[];
  /** Exact serialized HTTP(S) origins. An Origin header is denied by default. */
  allowedOrigins?: string[];
  maxRequestBytes: number;
  maxResponseBytes: number;
  requestTimeoutMs: number;
  maxConnections: number;
  maxRequests: number;
  /** Distinct initialized reviewer sessions allowed before shutdown. Defaults to one. */
  maxSessions?: number;
}
export type ReviewReadMcpAuditToolName = "list_tree" | "read_file" | "search_text" | "unrecognized";
export type ReviewReadMcpAuditToolStatus = "complete-for-indexed-export" | "incomplete" | "denied";
export interface ReviewReadMcpAuditCodeCount {
  readonly code: string;
  readonly count: number;
}
export interface ReviewReadMcpAuditToolCall {
  readonly sequence: number;
  readonly name: ReviewReadMcpAuditToolName;
  readonly status: ReviewReadMcpAuditToolStatus;
  readonly resultSha256: string;
  readonly incompleteCodes: readonly string[];
}
/**
 * Runner-owned, bounded evidence about use of the neutral source reader. Raw
 * tool arguments and results are deliberately absent: the audit carries only
 * allowlisted codes and domain-separated digests.
 */
export interface ReviewReadMcpAuditSnapshot {
  readonly schemaVersion: 1;
  readonly protocol: "review-read-mcp-audit-v1";
  readonly requests: Readonly<{
    observed: number;
    budgeted: number;
    parsed: number;
    denied: number;
  }>;
  readonly sessions: Readonly<{
    attempted: number;
    initialized: number;
    ready: number;
    denied: number;
  }>;
  readonly tools: Readonly<{
    attempted: number;
    complete: number;
    incomplete: number;
    denied: number;
  }>;
  readonly toolCalls: readonly ReviewReadMcpAuditToolCall[];
  readonly incompleteResultCodes: readonly ReviewReadMcpAuditCodeCount[];
  readonly denialCodes: readonly ReviewReadMcpAuditCodeCount[];
  readonly transportFailures: readonly ReviewReadMcpAuditCodeCount[];
  readonly snapshotSha256: string;
}
type RpcId = string | number;
type RpcMessage = { jsonrpc: "2.0"; id?: RpcId; method: string; params?: Record<string, unknown> };
type ToolResult = {
  status: "complete-for-indexed-export" | "incomplete";
  limitations: string[];
};
const PATH_SCHEMA = { type: "string", maxLength: 4096, description: "Relative path within the exported source tree." };
const TOOL_DEFINITIONS = [
  { name: "list_tree", description: "List indexed source files and directories, with explicit scope limitations.",
    inputSchema: { type: "object", properties: { path: PATH_SCHEMA }, additionalProperties: false } },
  { name: "read_file", description: "Read one UTF-8 source file within the configured byte limits.",
    inputSchema: { type: "object", properties: { path: { ...PATH_SCHEMA, minLength: 1 } }, required: ["path"], additionalProperties: false } },
  { name: "search_text", description: "Find lines containing a literal single-line string in exported source files.",
    inputSchema: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 1024 }, path: PATH_SCHEMA },
      required: ["query"], additionalProperties: false } },
];
const INCOMPLETE_RESULT_CODES = new Set([
  "binary-content",
  "directory-unavailable",
  "entry-unavailable",
  "excluded-namespace",
  "export-changed",
  "file-byte-limit",
  "file-unavailable",
  "index-entry-limit",
  "invalid-utf8",
  "not-a-directory",
  "not-a-file",
  "output-byte-limit",
  "search-match-limit",
  "transport-response-byte-limit",
  "unindexed-path",
  "unsupported-entry-name",
  "unsupported-file-type",
]);
const DENIAL_CODES = new Set([
  "accept-not-supported",
  "content-type-not-supported",
  "duplicate-routing-header",
  "endpoint-not-found",
  "expect-not-supported",
  "handler-failure",
  "host-not-allowed",
  "initialization-not-ready",
  "initialized-session-required",
  "invalid-initialization",
  "invalid-request",
  "invalid-tool-arguments",
  "invalid-tool-call",
  "method-not-found",
  "method-not-supported",
  "negotiated-protocol-required",
  "notification-not-supported",
  "origin-not-allowed",
  "pagination-not-supported",
  "parse-error",
  "request-body-deadline",
  "request-body-unavailable",
  "request-byte-limit",
  "request-deadline",
  "request-limit",
  "server-closed",
  "session-already-ready",
  "session-limit",
  "session-not-found",
  "transport-response-byte-limit",
  "unsupported-protocol",
]);
const TRANSPORT_FAILURE_CODES = new Set([
  "accept-not-supported",
  "client-error",
  "connection-deadline",
  "connection-limit",
  "content-type-not-supported",
  "duplicate-routing-header",
  "endpoint-not-found",
  "expect-not-supported",
  "handler-failure",
  "host-not-allowed",
  "initialized-session-required",
  "method-not-supported",
  "negotiated-protocol-required",
  "notification-not-supported",
  "origin-not-allowed",
  "request-body-deadline",
  "request-body-unavailable",
  "request-byte-limit",
  "request-deadline",
  "request-limit",
  "server-closed",
  "session-already-ready",
  "session-not-found",
  "transport-response-byte-limit",
  "unsupported-protocol",
]);

/** One initialization per server lifetime. Close and create a fresh service for
 * another client/run. No SSE, outgoing requests, resources, prompts, or shell. */
export async function startReviewReadMcpServer(exportRoot: string, readLimits: ReviewReadToolLimits,
  options: ReviewReadMcpOptions): Promise<{
    url: string;
    authorizeHost(authority: string): void;
    replaceAuthorizedHosts(authorities: readonly string[]): void;
    auditSnapshot(): ReviewReadMcpAuditSnapshot;
    sealAudit(): ReviewReadMcpAuditSnapshot;
    close(): Promise<void>;
  }> {
  if (!fields(options, ["maxRequestBytes", "maxResponseBytes", "requestTimeoutMs", "maxConnections", "maxRequests"],
    ["host", "port", "allowedHosts", "allowedOrigins", "maxSessions"])) throw new Error("invalid MCP configuration");
  for (const key of ["maxRequestBytes", "maxResponseBytes", "requestTimeoutMs", "maxConnections", "maxRequests"] as const) {
    if (!Number.isSafeInteger(options[key]) || options[key] < 1 || options[key] > 100_000_000) throw new Error("invalid MCP limit");
  }
  const maxSessions = options.maxSessions ?? 1;
  if (!Number.isSafeInteger(maxSessions) || maxSessions < 1 || maxSessions > 2) throw new Error("invalid MCP session limit");
  if (options.maxResponseBytes < 4096) throw new Error("MCP response limit must be at least 4096 bytes");
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 0;
  if (!isIP(host) || !Number.isSafeInteger(port) || port < 0 || port > 65535) throw new Error("invalid MCP bind address");
  if (host !== "127.0.0.1" && host !== "::1" && !options.allowedHosts?.length) throw new Error("non-loopback binding requires explicit allowedHosts");
  const allowedHosts = options.allowedHosts === undefined ? new Set<string>() : authorities(options.allowedHosts);
  const allowedOrigins = new Set<string>();
  if (options.allowedOrigins !== undefined) {
    if (!Array.isArray(options.allowedOrigins)) throw new Error("invalid allowedOrigins");
    for (const origin of options.allowedOrigins) {
      if (typeof origin !== "string") throw new Error("invalid allowedOrigins");
      const parsed = new URL(origin);
      if (!/^https?:$/.test(parsed.protocol) || parsed.origin !== origin) throw new Error("invalid allowedOrigins");
      allowedOrigins.add(origin);
    }
  }
  const limits = { ...options };
  const tools = createReviewReadTools(exportRoot, readLimits);
  const endpoint = `/mcp/${randomBytes(32).toString("hex")}`;
  const sessions = new Map<string, "initializing" | "ready">();
  let closed = false;
  let auditSealed = false;
  let sealedAuditSnapshot: ReviewReadMcpAuditSnapshot | undefined;
  let activeHandlers = 0;
  let requests = 0;
  const audit = {
    requests: { observed: 0, budgeted: 0, parsed: 0, denied: 0 },
    sessions: { attempted: 0, initialized: 0, ready: 0, denied: 0 },
    tools: { attempted: 0, complete: 0, incomplete: 0, denied: 0 },
    toolCalls: [] as ReviewReadMcpAuditToolCall[],
    incompleteResultCodes: new Map<string, number>(),
    denialCodes: new Map<string, number>(),
    transportFailures: new Map<string, number>(),
  };
  const sockets = new Set<Socket>();

  const increment = (value: number): number => value < Number.MAX_SAFE_INTEGER ? value + 1 : value;
  const count = (values: Map<string, number>, code: string): void => {
    values.set(code, increment(values.get(code) ?? 0));
  };
  const observeRequest = (): number => {
    audit.requests.observed = increment(audit.requests.observed);
    return audit.requests.observed;
  };
  const deny = (code: string, transport = false): void => {
    audit.requests.denied = increment(audit.requests.denied);
    count(audit.denialCodes, code);
    if (transport) count(audit.transportFailures, code);
  };
  const recordTransportFailure = (code: string): void => {
    if (!auditSealed) count(audit.transportFailures, code);
  };
  const safeToolName = (value: unknown): ReviewReadMcpAuditToolName =>
    value === "list_tree" || value === "read_file" || value === "search_text" ? value : "unrecognized";
  const toolDigest = (value: unknown): string => createHash("sha256")
    .update("review-read-mcp-tool-result-v1\0").update(JSON.stringify(value)).digest("hex");
  const recordTool = (sequence: number, name: unknown, status: ReviewReadMcpAuditToolStatus, digestValue: unknown,
    incompleteCodes: readonly string[] = []): void => {
    audit.tools.attempted = increment(audit.tools.attempted);
    audit.tools[status === "complete-for-indexed-export" ? "complete" : status] =
      increment(audit.tools[status === "complete-for-indexed-export" ? "complete" : status]);
    const codes = [...new Set(incompleteCodes.filter((code) => INCOMPLETE_RESULT_CODES.has(code)))].sort();
    for (const code of codes) count(audit.incompleteResultCodes, code);
    audit.toolCalls.push(Object.freeze({ sequence, name: safeToolName(name), status,
      resultSha256: toolDigest(digestValue), incompleteCodes: Object.freeze(codes) }));
  };
  const denyTool = (sequence: number, message: RpcMessage, code: string): void => {
    if (message.method !== "tools/call") return;
    recordTool(sequence, message.params?.name, "denied", { status: "denied", code });
  };
  const snapshot = (): ReviewReadMcpAuditSnapshot => {
    const body = {
      schemaVersion: 1 as const,
      protocol: "review-read-mcp-audit-v1" as const,
      requests: Object.freeze({ ...audit.requests }),
      sessions: Object.freeze({ ...audit.sessions }),
      tools: Object.freeze({ ...audit.tools }),
      toolCalls: Object.freeze([...audit.toolCalls]
        .sort((left, right) => left.sequence - right.sequence)
        .map((item) => Object.freeze({ ...item,
          incompleteCodes: Object.freeze([...item.incompleteCodes]) }))),
      incompleteResultCodes: codeCounts(audit.incompleteResultCodes),
      denialCodes: codeCounts(audit.denialCodes),
      transportFailures: codeCounts(audit.transportFailures),
    };
    return Object.freeze({ ...body, snapshotSha256: createHash("sha256")
      .update("review-read-mcp-audit-snapshot-v1\0").update(JSON.stringify(body)).digest("hex") });
  };

  function send(res: ServerResponse, status: number, body?: unknown, sessionId?: string) {
    if (res.writableEnded || res.destroyed) return;
    let encoded = body === undefined ? "" : JSON.stringify(body);
    if (Buffer.byteLength(encoded) > limits.maxResponseBytes) {
      status = 500;
      encoded = JSON.stringify(rpcError(null, -32603, "Response exceeds configured byte limit"));
      deny("transport-response-byte-limit", true);
    }
    res.writeHead(status, { "Connection": "close", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      ...(encoded ? { "Content-Type": "application/json" } : {}), "Content-Length": Buffer.byteLength(encoded),
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) });
    res.end(encoded);
  }
  function transportError(res: ServerResponse, status: number, message: string, code?: string) {
    if (code) deny(code, true);
    send(res, status, { error: message });
  }
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: limits.requestTimeoutMs,
    headersTimeout: limits.requestTimeoutMs }, (req, res) => {
    if (auditSealed) {
      send(res, 404, { error: "Session not found" });
      return;
    }
    activeHandlers++;
    void handle(req, res)
      .catch(() => transportError(res, 500, "Request could not be processed", "handler-failure"))
      .finally(() => { activeHandlers--; });
  });
  server.maxConnections = limits.maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on("connection", (socket) => {
    sockets.add(socket);
    // Absolute connection lifetime also bounds trickled headers before the
    // request callback exists. Normal responses close their connection.
    const deadline = setTimeout(() => { recordTransportFailure("connection-deadline"); socket.destroy(); }, limits.requestTimeoutMs);
    deadline.unref();
    socket.on("close", () => { clearTimeout(deadline); sockets.delete(socket); });
  });
  server.on("clientError", (_error, socket) => { recordTransportFailure("client-error"); socket.destroy(); });
  server.on("drop", () => recordTransportFailure("connection-limit"));
  server.on("checkContinue", (_req, res) => {
    if (auditSealed) {
      send(res, 404, { error: "Session not found" });
      return;
    }
    observeRequest();
    transportError(res, 417, "Expect is not supported", "expect-not-supported");
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const requestSequence = observeRequest();
    const started = performance.now();
    for (const header of ["host", "origin", "mcp-session-id", "mcp-protocol-version"]) {
      if (req.rawHeaders.filter((_value, index) => index % 2 === 0 && req.rawHeaders[index]!.toLowerCase() === header).length > 1) {
        transportError(res, 400, "Duplicate routing header", "duplicate-routing-header"); return;
      }
    }
    if (typeof req.headers.host !== "string" || !allowedHosts.has(req.headers.host.toLowerCase())) {
      transportError(res, 403, "Host is not allowed", "host-not-allowed"); return;
    }
    if (req.headers.origin !== undefined && (typeof req.headers.origin !== "string" || !allowedOrigins.has(req.headers.origin))) {
      transportError(res, 403, "Origin is not allowed", "origin-not-allowed"); return;
    }
    if (req.url !== endpoint) { transportError(res, 404, "Endpoint not found", "endpoint-not-found"); return; }
    if (closed) { transportError(res, 404, "Session not found", "server-closed"); return; }
    const suppliedSession = req.headers["mcp-session-id"];
    if (suppliedSession !== undefined && (typeof suppliedSession !== "string" || !sessions.has(suppliedSession))) {
      transportError(res, 404, "Session not found", "session-not-found"); return;
    }
    const version = req.headers["mcp-protocol-version"];
    if (version !== undefined && version !== REVIEW_READ_MCP_PROTOCOL) {
      transportError(res, 400, "Unsupported protocol version", "unsupported-protocol"); return;
    }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); transportError(res, 405, "Method not supported", "method-not-supported"); return; }
    if (!accepts(req.headers.accept, "application/json") || !accepts(req.headers.accept, "text/event-stream")) {
      transportError(res, 406, "Accept must include application/json and text/event-stream", "accept-not-supported"); return;
    }
    if (typeof req.headers["content-type"] !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"]) ||
        req.headers["content-encoding"] !== undefined) { transportError(res, 415, "Expected uncompressed UTF-8 JSON", "content-type-not-supported"); return; }
    if (++requests > limits.maxRequests) { transportError(res, 429, "Run request limit reached", "request-limit"); return; }
    audit.requests.budgeted = increment(audit.requests.budgeted);
    let bytes: Buffer;
    try { bytes = await readBody(req, limits.maxRequestBytes, limits.requestTimeoutMs); }
    catch (error) {
      transportError(res, error instanceof BodyError ? error.status : 400, "Request body unavailable or exceeds limits",
        error instanceof BodyError && error.status === 413 ? "request-byte-limit" :
          error instanceof BodyError && error.status === 408 ? "request-body-deadline" : "request-body-unavailable"); return;
    }
    if (performance.now() - started >= limits.requestTimeoutMs) { transportError(res, 408, "Request deadline exceeded", "request-deadline"); return; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { deny("parse-error"); send(res, 400, rpcError(null, -32700, "Parse error")); return; }
    if (!fields(raw, ["jsonrpc", "method"], ["id", "params"]) || raw.jsonrpc !== "2.0" ||
        typeof raw.method !== "string" || raw.method.length > 128 ||
        (Object.hasOwn(raw, "id") && !validId(raw.id)) ||
        (Object.hasOwn(raw, "params") && !object(raw.params))) {
      deny("invalid-request"); send(res, 400, rpcError(null, -32600, "Invalid request")); return;
    }
    audit.requests.parsed = increment(audit.requests.parsed);
    const message = raw as RpcMessage;
    const params = message.params ?? {};
    const id = message.id;
    if (message.method === "initialize" && id !== undefined) {
      audit.sessions.attempted = increment(audit.sessions.attempted);
      if (suppliedSession !== undefined || sessions.size >= maxSessions) {
        audit.sessions.denied = increment(audit.sessions.denied); deny("session-limit");
        send(res, 409, rpcError(id, -32600, "Session already initialized")); return;
      }
      if (!fields(params, ["protocolVersion", "capabilities", "clientInfo"], ["_meta"]) ||
          typeof params.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion) ||
          !object(params.capabilities) || !object(params.clientInfo) ||
          typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
        audit.sessions.denied = increment(audit.sessions.denied); deny("invalid-initialization");
        send(res, 200, rpcError(id, -32602, "Invalid initialization parameters")); return;
      }
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, "initializing");
      audit.sessions.initialized = increment(audit.sessions.initialized);
      send(res, 200, { jsonrpc: "2.0", id, result: { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
        capabilities: { tools: {} }, serverInfo: { name: "source-read-tools", version: "0.1.0" } } }, sessionId);
      return;
    }
    if (suppliedSession === undefined) {
      denyTool(requestSequence, message, "initialized-session-required");
      transportError(res, 400, "Initialized session is required", "initialized-session-required"); return;
    }
    if (version !== REVIEW_READ_MCP_PROTOCOL) {
      denyTool(requestSequence, message, "negotiated-protocol-required");
      transportError(res, 400, "Negotiated protocol header is required", "negotiated-protocol-required"); return;
    }
    const state = sessions.get(suppliedSession)!;
    if (id === undefined) {
      if (message.method === "notifications/initialized" && fields(params, [], ["_meta"])) {
        if (state !== "initializing") { transportError(res, 409, "Session already initialized", "session-already-ready"); return; }
        sessions.set(suppliedSession, "ready");
        audit.sessions.ready = increment(audit.sessions.ready);
        send(res, 202); return;
      }
      if (state === "ready" && message.method === "notifications/cancelled" &&
          fields(params, ["requestId"], ["reason", "_meta"]) && validId(params.requestId) &&
          (params.reason === undefined || typeof params.reason === "string")) { send(res, 202); return; }
      transportError(res, 400, "Notification is not supported in this state", "notification-not-supported"); return;
    }
    if (message.method === "ping" && fields(params, [], ["_meta"])) { send(res, 200, { jsonrpc: "2.0", id, result: {} }); return; }
    if (state !== "ready") {
      denyTool(requestSequence, message, "initialization-not-ready"); deny("initialization-not-ready");
      send(res, 200, rpcError(id, -32600, "Initialization notification is required")); return;
    }
    if (message.method === "tools/list") {
      if (!fields(params, [], ["_meta"])) {
        deny("pagination-not-supported");
        send(res, 200, rpcError(id, -32602, "Pagination is not supported")); return;
      }
      send(res, 200, { jsonrpc: "2.0", id, result: { tools: TOOL_DEFINITIONS } }); return;
    }
    if (message.method !== "tools/call") { deny("method-not-found"); send(res, 200, rpcError(id, -32601, "Method not found")); return; }
    if (!fields(params, ["name"], ["arguments", "_meta"]) || typeof params.name !== "string" ||
        !TOOL_DEFINITIONS.some((tool) => tool.name === params.name) ||
        (params.arguments !== undefined && !object(params.arguments))) {
      deny("invalid-tool-call"); recordTool(requestSequence, params.name, "denied", { status: "denied", code: "invalid-tool-call" });
      send(res, 200, rpcError(id, -32602, "Invalid tool call")); return;
    }
    let result;
    try {
      const args = params.arguments ?? {};
      result = params.name === "list_tree" ? tools.list_tree(args) : params.name === "read_file"
        ? tools.read_file(args as { path: string }) : tools.search_text(args as { query: string; path?: string });
    } catch {
      deny("invalid-tool-arguments"); recordTool(requestSequence, params.name, "denied", { status: "denied", code: "invalid-tool-arguments" });
      send(res, 200, rpcError(id, -32602, "Tool arguments or source path are invalid")); return;
    }
    if (performance.now() - started >= limits.requestTimeoutMs) {
      recordTool(requestSequence, params.name, "denied", { status: "denied", code: "request-deadline" });
      transportError(res, 408, "Request deadline exceeded", "request-deadline"); return;
    }
    let response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result.status === "incomplete" } };
    let responseCompacted = false;
    if (Buffer.byteLength(JSON.stringify(response)) > limits.maxResponseBytes) {
      responseCompacted = true;
      response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({
        status: "incomplete", truncated: true, limitations: [...new Set([...result.limitations, "transport-response-byte-limit"])],
        unavailable: [{ path: "", reason: "transport-response-byte-limit" }],
      }) }], isError: true } };
    }
    const toolResult = result as ToolResult;
    const incompleteCodes = responseCompacted
      ? [...toolResult.limitations, "transport-response-byte-limit"] : toolResult.limitations;
    recordTool(requestSequence, params.name, responseCompacted ? "incomplete" : toolResult.status, response.result, incompleteCodes);
    send(res, 200, response);
  }
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => { server.off("error", reject); resolveListen(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("MCP listener has no TCP address");
  const authority = `${host.includes(":") ? `[${host}]` : host}:${address.port}`;
  if (options.allowedHosts === undefined) allowedHosts.add(authority.toLowerCase());
  const assertAuthorizationOpen = () => {
    if (closed || sessions.size > 0) throw new Error("MCP host authorization is frozen after first initialization");
  };
  return { url: `http://${authority}${endpoint}`, authorizeHost: (candidate) => {
    assertAuthorizationOpen();
    for (const value of authorities([candidate])) allowedHosts.add(value);
  }, replaceAuthorizedHosts: (candidates) => {
    assertAuthorizationOpen();
    const replacements = authorities(candidates);
    allowedHosts.clear();
    for (const value of replacements) allowedHosts.add(value);
  }, auditSnapshot: snapshot, sealAudit: () => {
    if (sealedAuditSnapshot) return sealedAuditSnapshot;
    if (activeHandlers !== 0) throw new Error("MCP audit cannot be sealed while requests are active");
    auditSealed = true;
    sealedAuditSnapshot = snapshot();
    return sealedAuditSnapshot;
  }, close: async () => {
    closed = true;
    sessions.clear();
    await new Promise<void>((resolveClose) => { server.close(() => resolveClose()); for (const socket of sockets) socket.destroy(); });
  } };
}

/** Reauthenticate a persisted audit snapshot without accepting raw tool data or
 * caller-defined diagnostic codes. */
export function parseReviewReadMcpAuditSnapshot(
  value: unknown,
  label = "review read MCP audit snapshot",
): ReviewReadMcpAuditSnapshot {
  if (!fields(value, ["schemaVersion", "protocol", "requests", "sessions", "tools", "toolCalls",
    "incompleteResultCodes", "denialCodes", "transportFailures", "snapshotSha256"])) {
    throw new Error(`${label} has invalid fields`);
  }
  if (value.schemaVersion !== 1 || value.protocol !== "review-read-mcp-audit-v1") {
    throw new Error(`${label} identity is invalid`);
  }
  const requests = auditCounts(value.requests, ["observed", "budgeted", "parsed", "denied"], `${label}.requests`);
  const sessions = auditCounts(value.sessions, ["attempted", "initialized", "ready", "denied"], `${label}.sessions`);
  const tools = auditCounts(value.tools, ["attempted", "complete", "incomplete", "denied"], `${label}.tools`);
  if (requests.budgeted > requests.observed || requests.parsed > requests.budgeted || requests.denied > requests.observed ||
      sessions.initialized > sessions.attempted || sessions.ready > sessions.initialized || sessions.denied > sessions.attempted) {
    throw new Error(`${label} counts are inconsistent`);
  }
  if (!Array.isArray(value.toolCalls)) throw new Error(`${label}.toolCalls must be an array`);
  const toolCalls = value.toolCalls.map((entry, index): ReviewReadMcpAuditToolCall => {
    if (!fields(entry, ["sequence", "name", "status", "resultSha256", "incompleteCodes"])) {
      throw new Error(`${label}.toolCalls[${index}] has invalid fields`);
    }
    const sequence = positiveAuditCount(entry.sequence, `${label}.toolCalls[${index}].sequence`);
    if (entry.name !== "list_tree" && entry.name !== "read_file" && entry.name !== "search_text" && entry.name !== "unrecognized") {
      throw new Error(`${label}.toolCalls[${index}].name is invalid`);
    }
    if (entry.status !== "complete-for-indexed-export" && entry.status !== "incomplete" && entry.status !== "denied") {
      throw new Error(`${label}.toolCalls[${index}].status is invalid`);
    }
    if (typeof entry.resultSha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.resultSha256)) {
      throw new Error(`${label}.toolCalls[${index}].resultSha256 is invalid`);
    }
    const incompleteCodes = auditCodeList(entry.incompleteCodes, INCOMPLETE_RESULT_CODES,
      `${label}.toolCalls[${index}].incompleteCodes`);
    if (entry.status !== "incomplete" && incompleteCodes.length) {
      throw new Error(`${label}.toolCalls[${index}] carries incomplete codes for a non-incomplete result`);
    }
    return Object.freeze({ sequence, name: entry.name, status: entry.status,
      resultSha256: entry.resultSha256, incompleteCodes });
  });
  if (toolCalls.some((entry, index) => entry.sequence > requests.observed ||
      (index > 0 && toolCalls[index - 1]!.sequence >= entry.sequence))) {
    throw new Error(`${label}.toolCalls are not in unique request order`);
  }
  const statusCounts = {
    complete: toolCalls.filter((entry) => entry.status === "complete-for-indexed-export").length,
    incomplete: toolCalls.filter((entry) => entry.status === "incomplete").length,
    denied: toolCalls.filter((entry) => entry.status === "denied").length,
  };
  if (tools.attempted !== toolCalls.length || tools.complete !== statusCounts.complete ||
      tools.incomplete !== statusCounts.incomplete || tools.denied !== statusCounts.denied) {
    throw new Error(`${label}.tools do not match toolCalls`);
  }
  const incompleteResultCodes = auditCodeCounts(value.incompleteResultCodes, INCOMPLETE_RESULT_CODES,
    `${label}.incompleteResultCodes`);
  const expectedIncomplete = new Map<string, number>();
  for (const call of toolCalls) for (const code of call.incompleteCodes) {
    expectedIncomplete.set(code, (expectedIncomplete.get(code) ?? 0) + 1);
  }
  if (JSON.stringify(incompleteResultCodes) !== JSON.stringify(codeCounts(expectedIncomplete))) {
    throw new Error(`${label}.incompleteResultCodes do not match toolCalls`);
  }
  const denialCodes = auditCodeCounts(value.denialCodes, DENIAL_CODES, `${label}.denialCodes`);
  if (denialCodes.reduce((total, entry) => total + entry.count, 0) !== requests.denied) {
    throw new Error(`${label}.denialCodes do not match denied requests`);
  }
  const transportFailures = auditCodeCounts(value.transportFailures, TRANSPORT_FAILURE_CODES,
    `${label}.transportFailures`);
  if (typeof value.snapshotSha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.snapshotSha256)) {
    throw new Error(`${label}.snapshotSha256 is invalid`);
  }
  const body = {
    schemaVersion: 1 as const,
    protocol: "review-read-mcp-audit-v1" as const,
    requests: Object.freeze(requests),
    sessions: Object.freeze(sessions),
    tools: Object.freeze(tools),
    toolCalls: Object.freeze(toolCalls),
    incompleteResultCodes,
    denialCodes,
    transportFailures,
  };
  const snapshotSha256 = createHash("sha256").update("review-read-mcp-audit-snapshot-v1\0")
    .update(JSON.stringify(body)).digest("hex");
  if (snapshotSha256 !== value.snapshotSha256) throw new Error(`${label} digest mismatch`);
  return Object.freeze({ ...body, snapshotSha256 });
}

class BodyError extends Error { constructor(readonly status: number) { super("request body rejected"); } }
function readBody(req: IncomingMessage, maximum: number, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => finish(new BodyError(408)), timeoutMs);
    const finish = (error?: BodyError) => {
      clearTimeout(timer);
      req.off("data", onData); req.off("end", onEnd); req.off("error", onError); req.off("aborted", onError);
      if (error) { req.pause(); reject(error); } else resolveBody(Buffer.concat(chunks, size));
    };
    const onData = (chunk: Buffer) => { size += chunk.length; if (size > maximum) finish(new BodyError(413)); else chunks.push(chunk); };
    const onEnd = () => finish();
    const onError = () => finish(new BodyError(400));
    req.on("data", onData); req.on("end", onEnd); req.on("error", onError); req.on("aborted", onError);
    const length = req.headers["content-length"];
    if (length !== undefined && Number(length) > maximum) finish(new BodyError(413));
  });
}
function rpcError(id: RpcId | null, code: number, message: string) { return { jsonrpc: "2.0", id, error: { code, message } }; }
function validId(value: unknown): value is RpcId {
  return typeof value === "string" ? value.length <= 128 : typeof value === "number" && Number.isSafeInteger(value);
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function fields(value: unknown, required: string[], optional: string[] = []): value is Record<string, unknown> {
  return object(value) && required.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => required.includes(key) || optional.includes(key));
}
function accepts(value: string | undefined, type: string): boolean {
  return typeof value === "string" && value.split(",").some((entry) => {
    const [media, ...parameters] = entry.trim().toLowerCase().split(";");
    return media === type && !parameters.some((part) => /^\s*q\s*=\s*0(?:\.0*)?\s*$/.test(part));
  });
}
function authorities(value: unknown): Set<string> {
  if (!Array.isArray(value) || !value.length) throw new Error("invalid allowedHosts");
  return new Set(value.map((authority) => {
    if (typeof authority !== "string") throw new Error("invalid allowedHosts");
    const parsed = new URL(`http://${authority}`);
    if (parsed.host !== authority || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error("invalid allowedHosts");
    return authority.toLowerCase();
  }));
}
function codeCounts(values: ReadonlyMap<string, number>): readonly ReviewReadMcpAuditCodeCount[] {
  return Object.freeze([...values.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([code, count]) => Object.freeze({ code, count })));
}
function auditCounts<K extends string>(value: unknown, keys: readonly K[], label: string): Record<K, number> {
  if (!fields(value, [...keys])) throw new Error(`${label} has invalid fields`);
  return Object.fromEntries(keys.map((key) => [key, nonnegativeAuditCount(value[key], `${label}.${key}`)])) as Record<K, number>;
}
function auditCodeList(value: unknown, allowed: ReadonlySet<string>, label: string): readonly string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !allowed.has(entry)) ||
      value.some((entry, index) => index > 0 && value[index - 1] >= entry)) {
    throw new Error(`${label} is invalid or noncanonical`);
  }
  return Object.freeze([...value]);
}
function auditCodeCounts(value: unknown, allowed: ReadonlySet<string>, label: string): readonly ReviewReadMcpAuditCodeCount[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return Object.freeze(value.map((entry, index) => {
    const previousCode = index > 0 && fields(value[index - 1], ["code", "count"])
      ? value[index - 1].code
      : undefined;
    if (!fields(entry, ["code", "count"]) || typeof entry.code !== "string" || !allowed.has(entry.code) ||
        (index > 0 && (typeof previousCode !== "string" || previousCode >= entry.code))) {
      throw new Error(`${label} is invalid or noncanonical`);
    }
    return Object.freeze({ code: entry.code, count: positiveAuditCount(entry.count, `${label}[${index}].count`) });
  }));
}
function nonnegativeAuditCount(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} must be a nonnegative safe integer`);
  return Number(value);
}
function positiveAuditCount(value: unknown, label: string): number {
  const count = nonnegativeAuditCount(value, label);
  if (count === 0) throw new Error(`${label} must be positive`);
  return count;
}
