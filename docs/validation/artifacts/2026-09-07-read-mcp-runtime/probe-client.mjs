import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const url = new URL(process.argv[2]);
assert.equal(url.origin, 'http://review-tools:3099');
assert.match(url.pathname, /^\/mcp\/[a-f0-9]{64}$/);
assert.equal(existsSync('/review/source.txt'), false);
assert.equal(JSON.parse(readFileSync('/client-only-canary.json')).syntheticCanary,
  'public-test-marker-not-a-real-credential');
let session;
let id = 0;
const checks = ['client-source-mount-absent', 'synthetic-client-canary-present'];
async function post(method, params = {}, notify = false, extra = {}) {
  const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(6000),
    headers: { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json',
      ...(session ? { 'Mcp-Session-Id': session, 'MCP-Protocol-Version': '2025-06-18' } : {}), ...extra },
    body: JSON.stringify({ jsonrpc: '2.0', ...(!notify ? { id: ++id } : {}), method, params }) });
  const raw = await response.text();
  return { response, body: raw ? JSON.parse(raw) : null };
}
const initialized = await post('initialize', { protocolVersion: '2025-06-18',
  capabilities: {}, clientInfo: { name: 'credential-free-probe', version: '1' } });
assert.equal(initialized.response.status, 200);
assert.equal(initialized.body.result.protocolVersion, '2025-06-18');
session = initialized.response.headers.get('mcp-session-id');
assert.ok(session);
assert.equal((await post('notifications/initialized', {}, true)).response.status, 202);
checks.push('initialize-and-ready');
const listed = await post('tools/list');
assert.deepEqual(listed.body.result.tools.map(tool => tool.name).sort(), ['list_tree', 'read_file', 'search_text']);
checks.push('exact-neutral-tool-catalog');
for (const [name, args] of [['list_tree', {}], ['read_file', { path: 'source.txt' }],
  ['search_text', { query: 'review-source-canary' }]]) {
  const result = await post('tools/call', { name, arguments: args });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.result.isError, false);
  const value = JSON.parse(result.body.result.content[0].text);
  assert.equal(value.status, 'complete-for-indexed-export');
  if (name === 'list_tree') assert.ok(value.entries.some(entry => entry.path === 'source.txt'));
  if (name === 'read_file') assert.equal(value.text, 'review-source-canary\n');
  if (name === 'search_text') assert.equal(value.matches[0].path, 'source.txt');
  checks.push(name);
}
for (const path of ['/client-only-canary.json', '../client-only-canary.json', '.git/config']) {
  const denied = await post('tools/call', { name: 'read_file', arguments: { path } });
  assert.ok(denied.body.error || denied.body.result?.isError);
  assert.equal(JSON.stringify(denied.body).includes('public-test-marker-not-a-real-credential'), false);
}
checks.push('outside-traversal-history-denied');
assert.ok((await post('tools/call', { name: 'exec', arguments: {} })).body.error);
assert.equal((await post('tools/list', {}, false, { Origin: 'https://untrusted.invalid' })).response.status, 403);
assert.equal((await post('tools/list', {}, false, { 'Mcp-Session-Id': 'wrong-session' })).response.status, 404);
checks.push('unknown-tool-origin-session-denied');
console.log(JSON.stringify({ status: 'passed', evidenceClass: 'credential-free-synthetic-protocol-probe',
  checks, providerCalls: 0, codexInvocations: 0, realCredentialsMounted: false, node: process.version }));
