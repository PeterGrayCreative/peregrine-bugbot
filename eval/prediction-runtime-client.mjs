// Credential-free, zero-provider container probe. Never launches a model CLI.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

const [url, linkPath] = process.argv.slice(2);
assert.match(url, /^http:\/\/mcp-forwarder:8082\/mcp\/[a-f0-9]{64}$/);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
function inventory(path) {
  const stat = lstatSync(path);
  if (stat.isDirectory()) for (const name of readdirSync(path).sort()) inventory(join(path, name));
  else if (stat.isFile()) { const bytes = readFileSync(path); files.push({ path, bytes: bytes.length, sha256: sha(bytes) }); }
  else throw new Error('unexpected immutable client entry');
}
inventory(process.execPath);
for (const name of readdirSync('/opt/peregrine-provider/node_modules/@openai').filter(name => name.startsWith('codex')).sort()) inventory('/opt/peregrine-provider/node_modules/@openai/' + name);
for (const path of ['/usr/local/bin/peregrine-egress-gateway', '/usr/local/bin/peregrine-methodology-mcp-forwarder']) inventory(path);
assert.deepEqual(readdirSync('/workspace'), []); assert.deepEqual(readdirSync('/home/peregrine'), []); assert.deepEqual(readdirSync('/opt/peregrine'), []);
const protocol = '2025-06-18'; let headers = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' };
async function call(body) {
  const response = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  const text = await response.text(); assert.ok(response.ok, 'neutral MCP request failed: ' + response.status);
  return { response, body: text ? JSON.parse(text) : null };
}
const rpc = (method, params = {}, id = 1) => ({ jsonrpc: '2.0', method, params, id });
const init = await call(rpc('initialize', { protocolVersion: protocol, capabilities: {}, clientInfo: { name: 'zero-provider-probe', version: '1' } }));
headers = { ...headers, 'Mcp-Session-Id': init.response.headers.get('mcp-session-id'), 'MCP-Protocol-Version': protocol };
await call({ jsonrpc: '2.0', method: 'notifications/initialized' });
const listed = (await call(rpc('tools/list'))).body;
assert.deepEqual(listed.result.tools.map(tool => tool.name), ['list_tree', 'read_file', 'search_text', 'read_link']);
assert.equal(JSON.stringify([init.body, listed]).toLowerCase().includes('peregrine'), false);
const diff = (await call(rpc('tools/call', { name: 'read_file', arguments: { path: 'review.diff' } }))).body;
assert.equal(diff.result.isError, false);
const link = (await call(rpc('tools/call', { name: 'read_link', arguments: { path: linkPath } }))).body;
if (linkPath !== 'unavailable-native-link') {
  assert.equal(link.result.isError, false); assert.equal(JSON.parse(link.result.content[0].text).followed, false);
}
const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'], { stdio: 'ignore', env: {} });
process.on('SIGTERM', () => {});
const report = { kind: 'zero-provider-runtime-client-ready', providerCalls: 0, node: process.version,
  pid: process.pid, childPid: child.pid, files, tools: listed.result.tools, diffResponseSha256: sha(diff.result.content[0].text),
  linkResponseSha256: sha(link.result.content[0].text), literalLinkTested: linkPath !== 'unavailable-native-link', emptyWorkspaceHomeAssets: true };
writeFileSync('/output/ready.json', JSON.stringify(report) + '\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ kind: report.kind, providerCalls: 0, pid: report.pid, childPid: report.childPid }) + '\n');
setInterval(() => {}, 1000);
