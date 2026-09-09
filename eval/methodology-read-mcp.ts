import { randomBytes } from "node:crypto";
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
type RpcId = string | number;
type RpcMessage = { jsonrpc: "2.0"; id?: RpcId; method: string; params?: Record<string, unknown> };
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

/** One initialization per server lifetime. Close and create a fresh service for
 * another client/run. No SSE, outgoing requests, resources, prompts, or shell. */
export async function startReviewReadMcpServer(exportRoot: string, readLimits: ReviewReadToolLimits,
  options: ReviewReadMcpOptions): Promise<{
    url: string;
    authorizeHost(authority: string): void;
    replaceAuthorizedHosts(authorities: readonly string[]): void;
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
  let requests = 0;
  const sockets = new Set<Socket>();

  function send(res: ServerResponse, status: number, body?: unknown, sessionId?: string) {
    if (res.writableEnded || res.destroyed) return;
    let encoded = body === undefined ? "" : JSON.stringify(body);
    if (Buffer.byteLength(encoded) > limits.maxResponseBytes) {
      status = 500;
      encoded = JSON.stringify(rpcError(null, -32603, "Response exceeds configured byte limit"));
    }
    res.writeHead(status, { "Connection": "close", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
      ...(encoded ? { "Content-Type": "application/json" } : {}), "Content-Length": Buffer.byteLength(encoded),
      ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}) });
    res.end(encoded);
  }
  function transportError(res: ServerResponse, status: number, message: string) {
    send(res, status, { error: message });
  }
  const server = createServer({ maxHeaderSize: 8192, requestTimeout: limits.requestTimeoutMs,
    headersTimeout: limits.requestTimeoutMs }, (req, res) => {
    void handle(req, res).catch(() => transportError(res, 500, "Request could not be processed"));
  });
  server.maxConnections = limits.maxConnections;
  server.maxRequestsPerSocket = 1;
  server.on("connection", (socket) => {
    sockets.add(socket);
    // Absolute connection lifetime also bounds trickled headers before the
    // request callback exists. Normal responses close their connection.
    const deadline = setTimeout(() => socket.destroy(), limits.requestTimeoutMs);
    deadline.unref();
    socket.on("close", () => { clearTimeout(deadline); sockets.delete(socket); });
  });
  server.on("clientError", (_error, socket) => { socket.destroy(); });
  server.on("checkContinue", (_req, res) => transportError(res, 417, "Expect is not supported"));

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const started = performance.now();
    for (const header of ["host", "origin", "mcp-session-id", "mcp-protocol-version"]) {
      if (req.rawHeaders.filter((_value, index) => index % 2 === 0 && req.rawHeaders[index]!.toLowerCase() === header).length > 1) {
        transportError(res, 400, "Duplicate routing header"); return;
      }
    }
    if (typeof req.headers.host !== "string" || !allowedHosts.has(req.headers.host.toLowerCase())) {
      transportError(res, 403, "Host is not allowed"); return;
    }
    if (req.headers.origin !== undefined && (typeof req.headers.origin !== "string" || !allowedOrigins.has(req.headers.origin))) {
      transportError(res, 403, "Origin is not allowed"); return;
    }
    if (req.url !== endpoint) { transportError(res, 404, "Endpoint not found"); return; }
    if (closed) { transportError(res, 404, "Session not found"); return; }
    const suppliedSession = req.headers["mcp-session-id"];
    if (suppliedSession !== undefined && (typeof suppliedSession !== "string" || !sessions.has(suppliedSession))) {
      transportError(res, 404, "Session not found"); return;
    }
    const version = req.headers["mcp-protocol-version"];
    if (version !== undefined && version !== REVIEW_READ_MCP_PROTOCOL) {
      transportError(res, 400, "Unsupported protocol version"); return;
    }
    if (req.method !== "POST") { res.setHeader("Allow", "POST"); transportError(res, 405, "Method not supported"); return; }
    if (!accepts(req.headers.accept, "application/json") || !accepts(req.headers.accept, "text/event-stream")) {
      transportError(res, 406, "Accept must include application/json and text/event-stream"); return;
    }
    if (typeof req.headers["content-type"] !== "string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers["content-type"]) ||
        req.headers["content-encoding"] !== undefined) { transportError(res, 415, "Expected uncompressed UTF-8 JSON"); return; }
    if (++requests > limits.maxRequests) { transportError(res, 429, "Run request limit reached"); return; }
    let bytes: Buffer;
    try { bytes = await readBody(req, limits.maxRequestBytes, limits.requestTimeoutMs); }
    catch (error) {
      transportError(res, error instanceof BodyError ? error.status : 400, "Request body unavailable or exceeds limits"); return;
    }
    if (performance.now() - started >= limits.requestTimeoutMs) { transportError(res, 408, "Request deadline exceeded"); return; }
    let raw: unknown;
    try { raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { send(res, 400, rpcError(null, -32700, "Parse error")); return; }
    if (!fields(raw, ["jsonrpc", "method"], ["id", "params"]) || raw.jsonrpc !== "2.0" ||
        typeof raw.method !== "string" || raw.method.length > 128 ||
        (Object.hasOwn(raw, "id") && !validId(raw.id)) ||
        (Object.hasOwn(raw, "params") && !object(raw.params))) {
      send(res, 400, rpcError(null, -32600, "Invalid request")); return;
    }
    const message = raw as RpcMessage;
    const params = message.params ?? {};
    const id = message.id;
    if (message.method === "initialize" && id !== undefined) {
      if (suppliedSession !== undefined || sessions.size >= maxSessions) { send(res, 409, rpcError(id, -32600, "Session already initialized")); return; }
      if (!fields(params, ["protocolVersion", "capabilities", "clientInfo"], ["_meta"]) ||
          typeof params.protocolVersion !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(params.protocolVersion) ||
          !object(params.capabilities) || !object(params.clientInfo) ||
          typeof params.clientInfo.name !== "string" || typeof params.clientInfo.version !== "string") {
        send(res, 200, rpcError(id, -32602, "Invalid initialization parameters")); return;
      }
      const sessionId = randomBytes(32).toString("hex");
      sessions.set(sessionId, "initializing");
      send(res, 200, { jsonrpc: "2.0", id, result: { protocolVersion: REVIEW_READ_MCP_PROTOCOL,
        capabilities: { tools: {} }, serverInfo: { name: "source-read-tools", version: "0.1.0" } } }, sessionId);
      return;
    }
    if (suppliedSession === undefined) { transportError(res, 400, "Initialized session is required"); return; }
    if (version !== REVIEW_READ_MCP_PROTOCOL) { transportError(res, 400, "Negotiated protocol header is required"); return; }
    const state = sessions.get(suppliedSession)!;
    if (id === undefined) {
      if (message.method === "notifications/initialized" && fields(params, [], ["_meta"])) {
        if (state !== "initializing") { transportError(res, 409, "Session already initialized"); return; }
        sessions.set(suppliedSession, "ready"); send(res, 202); return;
      }
      if (state === "ready" && message.method === "notifications/cancelled" &&
          fields(params, ["requestId"], ["reason", "_meta"]) && validId(params.requestId) &&
          (params.reason === undefined || typeof params.reason === "string")) { send(res, 202); return; }
      transportError(res, 400, "Notification is not supported in this state"); return;
    }
    if (message.method === "ping" && fields(params, [], ["_meta"])) { send(res, 200, { jsonrpc: "2.0", id, result: {} }); return; }
    if (state !== "ready") { send(res, 200, rpcError(id, -32600, "Initialization notification is required")); return; }
    if (message.method === "tools/list") {
      send(res, 200, fields(params, [], ["_meta"]) ? { jsonrpc: "2.0", id, result: { tools: TOOL_DEFINITIONS } }
        : rpcError(id, -32602, "Pagination is not supported")); return;
    }
    if (message.method !== "tools/call") { send(res, 200, rpcError(id, -32601, "Method not found")); return; }
    if (!fields(params, ["name"], ["arguments", "_meta"]) || typeof params.name !== "string" ||
        !TOOL_DEFINITIONS.some((tool) => tool.name === params.name) ||
        (params.arguments !== undefined && !object(params.arguments))) {
      send(res, 200, rpcError(id, -32602, "Invalid tool call")); return;
    }
    let result;
    try {
      const args = params.arguments ?? {};
      result = params.name === "list_tree" ? tools.list_tree(args) : params.name === "read_file"
        ? tools.read_file(args as { path: string }) : tools.search_text(args as { query: string; path?: string });
    } catch { send(res, 200, rpcError(id, -32602, "Tool arguments or source path are invalid")); return; }
    if (performance.now() - started >= limits.requestTimeoutMs) { transportError(res, 408, "Request deadline exceeded"); return; }
    let response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }],
      isError: result.status === "incomplete" } };
    if (Buffer.byteLength(JSON.stringify(response)) > limits.maxResponseBytes) {
      response = { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({
        status: "incomplete", truncated: true, limitations: [...new Set([...result.limitations, "transport-response-byte-limit"])],
        unavailable: [{ path: "", reason: "transport-response-byte-limit" }],
      }) }], isError: true } };
    }
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
  }, close: async () => {
    closed = true;
    sessions.clear();
    await new Promise<void>((resolveClose) => { server.close(() => resolveClose()); for (const socket of sockets) socket.destroy(); });
  } };
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
