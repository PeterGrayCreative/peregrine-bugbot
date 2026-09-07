import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { connect } from 'node:net';
import { startReviewReadMcpServer } from '/capsule/methodology-read-mcp.js';

assert.equal(existsSync('/home/peregrine/.codex/auth.json'), false);
assert.equal(existsSync('/client-only-canary.json'), false);
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.GITHUB_TOKEN, undefined);
assert.throws(() => writeFileSync('/review/source.txt', 'write must fail'));
const routes = readFileSync('/proc/net/route', 'utf8').trim().split('\n').slice(1);
assert.equal(routes.some(line => line.trim().split(/\s+/)[1] === '00000000'), false);
const outboundConnected = await new Promise(resolve => {
  const socket = connect({ host: '1.1.1.1', port: 443 });
  const finish = value => { socket.destroy(); resolve(value); };
  socket.setTimeout(1500, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
});
assert.equal(outboundConnected, false);
const server = await startReviewReadMcpServer('/review', {
  maxIndexEntries: 100, maxFileBytes: 4096, maxOutputBytes: 8192,
  maxSearchMatches: 20, excludedNamespaces: [],
}, {
  host: '0.0.0.0', port: 3099, allowedHosts: ['review-tools:3099'],
  allowedOrigins: [], maxRequestBytes: 16384, maxResponseBytes: 65536,
  requestTimeoutMs: 5000, maxConnections: 4, maxRequests: 100,
});
const endpoint = new URL(server.url);
endpoint.hostname = 'review-tools';
console.log(JSON.stringify({ ready: true, endpoint: endpoint.href,
  sourceWriteDenied: true, clientCanaryAbsent: true, noIpv4DefaultRoute: true,
  testedOutboundTcpDenied: true, node: process.version }));
process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
