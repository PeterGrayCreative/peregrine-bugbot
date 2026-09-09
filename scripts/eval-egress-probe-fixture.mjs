#!/usr/bin/env node

import { createHash } from "node:crypto";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";

export const EVAL_EGRESS_FIXTURE_PROTOCOL = "eval-egress-fixture-v1";
const MCP_UPSTREAM_PORT = 8080;
const CORRELATION_EXTENSION = 0xffa5;
const CHALLENGE = /^[a-f0-9]{64}$/u;

function fail(message) {
  throw new TypeError(message);
}

function option(args, name, { required = true, pattern = /^[^\r\n\0]+$/u } = {}) {
  const index = args.indexOf(name);
  if (index < 0) {
    if (!required) return undefined;
    fail(`missing fixture option ${name}`);
  }
  if (index !== args.lastIndexOf(name) || index + 1 >= args.length) fail(`invalid fixture option ${name}`);
  const value = args[index + 1];
  if (!pattern.test(value)) fail(`invalid fixture option ${name}`);
  return value;
}

function port(args) {
  const value = option(args, "--port", { pattern: /^[0-9]+$/u });
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535) fail("fixture port is out of bounds");
  return number;
}

function host(args) {
  return option(args, "--host", { pattern: /^[a-zA-Z0-9.:[\]-]+$/u });
}

function parseClientHelloMetadata(buffer) {
  if (buffer.length < 9 || buffer[0] !== 22 || buffer[1] !== 3 || buffer[2] !== 3) return undefined;
  const recordLength = buffer.readUInt16BE(3);
  if (recordLength + 5 > buffer.length || recordLength < 4 || buffer[5] !== 1) return undefined;
  const helloLength = buffer.readUIntBE(6, 3);
  if (helloLength + 9 > buffer.length) return undefined;
  const body = buffer.subarray(9, 9 + helloLength);
  if (body.length < 34) return undefined;
  let cursor = 34;
  if (cursor + 1 > body.length) return undefined;
  cursor += 1 + body[cursor];
  if (cursor + 2 > body.length) return undefined;
  const ciphers = body.readUInt16BE(cursor);
  cursor += 2 + ciphers;
  if (cursor + 1 > body.length) return undefined;
  cursor += 1 + body[cursor];
  if (cursor + 2 > body.length) return undefined;
  const extensionsLength = body.readUInt16BE(cursor);
  cursor += 2;
  if (cursor + extensionsLength > body.length) return undefined;
  const end = cursor + extensionsLength;
  let serverName;
  let challenge;
  while (cursor + 4 <= end) {
    const type = body.readUInt16BE(cursor);
    const length = body.readUInt16BE(cursor + 2);
    cursor += 4;
    if (cursor + length > end) return undefined;
    if (type === 0 && length >= 5) {
      const listLength = body.readUInt16BE(cursor);
      if (listLength + 2 !== length || body[cursor + 2] !== 0) return undefined;
      const nameLength = body.readUInt16BE(cursor + 3);
      if (nameLength + 5 !== length) return undefined;
      serverName = body.subarray(cursor + 5, cursor + 5 + nameLength).toString("utf8");
    } else if (type === CORRELATION_EXTENSION) {
      const value = body.subarray(cursor, cursor + length).toString("utf8");
      if (challenge !== undefined || !CHALLENGE.test(value)) return undefined;
      challenge = value;
    }
    cursor += length;
  }
  return serverName === undefined ? undefined : { serverName, challenge };
}

function parseSni(buffer) {
  return parseClientHelloMetadata(buffer)?.serverName;
}

function clientHello(hostname, challenge) {
  if (!CHALLENGE.test(challenge)) fail("invalid provider correlation challenge");
  const name = Buffer.from(hostname, "utf8");
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
  const challengeBytes = Buffer.from(challenge, "utf8");
  const challengeExtension = Buffer.alloc(4 + challengeBytes.length);
  challengeExtension.writeUInt16BE(CORRELATION_EXTENSION, 0);
  challengeExtension.writeUInt16BE(challengeBytes.length, 2);
  challengeBytes.copy(challengeExtension, 4);
  const extensionBody = Buffer.concat([sni, challengeExtension]);
  const extensions = Buffer.alloc(2 + extensionBody.length);
  extensions.writeUInt16BE(extensionBody.length, 0);
  extensionBody.copy(extensions, 2);
  const body = Buffer.alloc(34 + 1 + 2 + 2 + 1 + 2 + extensions.length);
  body.writeUInt16BE(0x0303, 0);
  let cursor = 34;
  body[cursor++] = 0;
  body.writeUInt16BE(2, cursor);
  cursor += 2;
  body.writeUInt16BE(0x1301, cursor);
  cursor += 2;
  body[cursor++] = 1;
  body[cursor++] = 0;
  extensions.copy(body, cursor);
  const handshake = Buffer.alloc(4 + body.length);
  handshake[0] = 1;
  handshake.writeUIntBE(body.length, 1, 3);
  body.copy(handshake, 4);
  const record = Buffer.alloc(5 + handshake.length);
  record[0] = 22;
  record[1] = 3;
  record[2] = 3;
  record.writeUInt16BE(handshake.length, 3);
  handshake.copy(record, 5);
  return record;
}

function sealedLine(role, audit) {
  const body = { status: "sealed", schemaVersion: 1, protocol: EVAL_EGRESS_FIXTURE_PROTOCOL, sealed: true, role, audit };
  const digest = createHash("sha256").update(`${EVAL_EGRESS_FIXTURE_PROTOCOL}\0`).update(JSON.stringify(body)).digest("hex");
  return JSON.stringify({ ...body, sha256: digest });
}

async function serveProvider(args) {
  const expectedSni = option(args, "--expected-sni", { pattern: /^[a-z0-9.-]+$/u });
  const expectedChallenge = option(args, "--expected-challenge", { pattern: CHALLENGE });
  const server = createServer();
  const sockets = new Set();
  const audit = { connections: 0, hellos: 0, acceptedSni: [], mismatchedSni: 0, acceptedChallenges: [], unexpectedChallenges: 0, sourceAddresses: [] };
  server.on("connection", (socket) => {
    sockets.add(socket);
    audit.connections += 1;
    audit.sourceAddresses.push(socket.remoteAddress ?? "");
    let buffer = Buffer.alloc(0);
    let answered = false;
    socket.on("data", (chunk) => {
      if (answered) return;
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length > 64 * 1024) return socket.destroy();
      const hello = parseClientHelloMetadata(buffer);
      if (!hello) return;
      answered = true;
      audit.hellos += 1;
      audit.acceptedSni.push(hello.serverName);
      if (hello.serverName !== expectedSni) audit.mismatchedSni += 1;
      if (hello.challenge === expectedChallenge) audit.acceptedChallenges.push(hello.challenge);
      else audit.unexpectedChallenges += 1;
      socket.write(`PEREGRINE_FAKE_PROVIDER_OK:${hello.serverName}\n`, () => socket.end());
    });
    socket.on("close", () => sockets.delete(socket));
  });
  await listen(server, port(args), host(args));
  process.stdout.write(`${JSON.stringify({ status: "ready", protocol: EVAL_EGRESS_FIXTURE_PROTOCOL, role: "provider" })}\n`);
  await shutdown(async () => {
    for (const socket of sockets) socket.destroy();
    await close(server);
    process.stdout.write(`${sealedLine("provider", audit)}\n`);
  });
}

async function serveMcp(args) {
  const token = option(args, "--token", { pattern: /^[a-f0-9]{64}$/u });
  const expectedChallenge = option(args, "--expected-challenge", { pattern: CHALLENGE });
  const endpoint = `/mcp/${token}`;
  const server = createHttpServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      let parsed;
      try { parsed = JSON.parse(body); } catch { parsed = undefined; }
      const valid = request.method === "POST" && request.url === endpoint && request.headers["content-type"] === "application/json" && parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.method === "source-read" && parsed.challenge === expectedChallenge && Object.keys(parsed).length === 2;
      if (valid) {
        acceptedChallenges.push(parsed.challenge);
        response.writeHead(200, { "content-type": "application/json", connection: "close" });
        response.end('{"result":"source-read"}');
      } else {
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && typeof parsed.challenge === "string") {
          unexpectedChallenges += 1;
        }
        response.writeHead(404, { connection: "close" });
        response.end("not found");
      }
    });
  });
  let requests = 0;
  const acceptedChallenges = [];
  let unexpectedChallenges = 0;
  const sourceAddresses = [];
  server.on("request", (request) => { requests += 1; sourceAddresses.push(request.socket.remoteAddress ?? ""); });
  await listen(server, port(args), host(args));
  process.stdout.write(`${JSON.stringify({ status: "ready", protocol: EVAL_EGRESS_FIXTURE_PROTOCOL, role: "mcp" })}\n`);
  await shutdown(async () => {
    await close(server);
    process.stdout.write(`${sealedLine("mcp", { requests, acceptedChallenges, unexpectedChallenges, sourceAddresses })}\n`);
  });
}

function authority(value) {
  const match = /^(\[[^\]]+\]|[a-z0-9.-]+):([0-9]+)$/u.exec(value ?? "");
  if (!match) fail("invalid reviewer authority");
  const number = Number(match[2]);
  if (!Number.isSafeInteger(number) || number < 1 || number > 65535) fail("invalid reviewer port");
  return { host: match[1].replace(/^\[|\]$/gu, ""), port: number };
}

async function gatewayExchange(gatewayAuthority, providerHost, sni, challenge, { expectDenied = false } = {}) {
  const target = authority(gatewayAuthority);
  return new Promise((resolve, reject) => {
    const socket = connect({ host: target.host, port: target.port });
    let data = Buffer.alloc(0);
    let sentHello = false;
    let settled = false;
    const timer = setTimeout(() => finish(new Error("gateway exchange deadline")), 1500);
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(value); };
    socket.on("connect", () => socket.write(`CONNECT ${providerHost}:443 HTTP/1.1\r\nHost: ${providerHost}:443\r\n\r\n`));
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      const headerEnd = data.indexOf("\r\n\r\n");
      if (headerEnd >= 0 && !sentHello) {
        const header = data.subarray(0, headerEnd).toString("latin1");
        if (!/^HTTP\/1\.1 200 /u.test(header)) finish(expectDenied ? undefined : new Error("gateway CONNECT denied"), false);
        else { sentHello = true; socket.write(clientHello(sni, challenge)); }
      }
      if (data.includes("PEREGRINE_FAKE_PROVIDER_OK:")) finish(expectDenied ? new Error("mismatched SNI reached provider") : undefined, !expectDenied);
    });
    socket.on("close", () => {
      if (settled) return;
      if (expectDenied && sentHello) finish(undefined, true);
      else finish(new Error("gateway socket closed"));
    });
    socket.on("error", (error) => { if (!expectDenied) finish(error); });
  });
}

function post(url, path, challenge) {
  if (!CHALLENGE.test(challenge)) fail("invalid MCP correlation challenge");
  const body = JSON.stringify({ method: "source-read", challenge });
  return new Promise((resolve, reject) => {
    const request = httpRequest({ ...authority(url), path, method: "POST", headers: { host: url, "content-type": "application/json", "content-length": Buffer.byteLength(body) }, agent: false }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end(body);
  });
}

export function connectionWasBlocked(host, exchangePort, timeoutMs = 500) {
  return new Promise((resolve) => {
    const socket = connect({ host, port: exchangePort });
    let settled = false;
    const finish = (blocked) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(blocked);
    };
    const timer = setTimeout(() => finish(true), timeoutMs);
    socket.once("connect", () => finish(false));
    socket.once("error", () => finish(true));
  });
}

async function serveReviewer(args) {
  const gateway = option(args, "--gateway", { pattern: /^[a-z0-9.-]+:[0-9]+$/u });
  const forwarder = option(args, "--forwarder", { pattern: /^[a-z0-9.-]+:[0-9]+$/u });
  const token = option(args, "--token", { pattern: /^[a-f0-9]{64}$/u });
  const provider = option(args, "--provider", { pattern: /^[a-z0-9.-]+$/u });
  const mcp = option(args, "--mcp", { pattern: /^[a-z0-9.-]+$/u });
  const allowedProviderChallenge = option(args, "--allowed-provider-challenge", { pattern: CHALLENGE });
  const deniedProviderChallenge = option(args, "--denied-provider-challenge", { pattern: CHALLENGE });
  const allowedMcpChallenge = option(args, "--allowed-mcp-challenge", { pattern: CHALLENGE });
  const deniedMcpChallenge = option(args, "--denied-mcp-challenge", { pattern: CHALLENGE });
  const forwarderPath = `/mcp/${token}`;
  const wrongTokenPath = `/mcp/${"0".repeat(64)}`;
  const forwarderPort = authority(forwarder).port;
  const exact = await post(forwarder, forwarderPath, allowedMcpChallenge);
  const wrong = await post(forwarder, wrongTokenPath, deniedMcpChallenge);
  const gatewayProviderReached = await gatewayExchange(gateway, provider, provider, allowedProviderChallenge);
  const mismatchedSniDenied = await gatewayExchange(gateway, provider, "other.invalid", deniedProviderChallenge, { expectDenied: true });
  const audit = {
    mcpViaSourceRead: exact.status === 200 && exact.body === '{"result":"source-read"}',
    wrongTokenDenied: wrong.status >= 400 && wrong.status < 500,
    gatewayProviderReached,
    mismatchedSniDenied,
    directProviderFailed: await connectionWasBlocked(provider, 443),
    directMcpFailed: await connectionWasBlocked(mcp, MCP_UPSTREAM_PORT),
    directProviderIpFailed: await connectionWasBlocked("8.8.8.2", 443),
    directMcpIpFailed: await connectionWasBlocked("8.8.8.3", MCP_UPSTREAM_PORT),
  };
  process.stdout.write(`${sealedLine("reviewer", audit)}\n`);
  await shutdown(async () => {});
}

function listen(server, listenPort, listenHost) {
  return new Promise((resolve, reject) => {
    const onError = (error) => { server.off("listening", onListening); reject(error); };
    const onListening = () => { server.off("error", onError); resolve(); };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(listenPort, listenHost);
  });
}
function close(server) { return new Promise((resolve) => server.close(() => resolve())); }
function shutdown(callback) {
  return new Promise((resolve) => {
    let stopping = false;
    const keepAlive = setInterval(() => {}, 60_000);
    const stop = async () => {
      if (stopping) return;
      stopping = true;
      clearInterval(keepAlive);
      try { await callback(); } finally { resolve(); }
    };
    process.once("SIGTERM", stop);
    process.once("SIGINT", stop);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  try {
    if (args[0] === "--provider") await serveProvider(args);
    else if (args[0] === "--mcp") await serveMcp(args);
    else if (args[0] === "--reviewer") await serveReviewer(args);
    else if (args[0] === "--describe" && args.length === 1) process.stdout.write(`${JSON.stringify({ protocol: EVAL_EGRESS_FIXTURE_PROTOCOL, roles: ["provider", "mcp", "reviewer"] })}\n`);
    else fail("fixture role is required");
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "fixture failed"}\n`);
    process.exitCode = 1;
  }
}
