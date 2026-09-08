// Capture this one named synthetic probe. Never launches Codex or a provider.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, copyFileSync, constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const output = dirname(fileURLToPath(import.meta.url));
const repo = resolve(output, '../../../..');
const capsule = '/Users/petergray/Documents/peregrine-bugbot/.worktrees/evidence-curation/read-mcp-runtime-probe-v1/capsule';
const image = 'ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3';
const server = 'peregrine-read-mcp-server-20260907-v1';
const client = 'peregrine-read-mcp-client-20260907-v1';
const network = 'peregrine-read-mcp-probe-20260907-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const docker = args => execFileSync('docker', args, { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
const inspect = docker(['inspect', server, client]);
const networkRaw = docker(['network', 'inspect', network]);
const imageRaw = docker(['image', 'inspect', image]);
const containers = JSON.parse(inspect);
const imageInfo = JSON.parse(imageRaw)[0];
assert.equal(imageInfo.Id, image.split('@')[1]);
for (const container of containers) {
  assert.equal(container.Image, imageInfo.Id);
  assert.deepEqual(container.Config.Env, imageInfo.Config.Env);
  assert.equal(container.Config.User, '1000:1000');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.deepEqual(container.HostConfig.SecurityOpt, ['no-new-privileges']);
  assert.equal(container.HostConfig.Privileged, false);
  assert.equal(container.HostConfig.NetworkMode, network);
  assert.deepEqual(container.HostConfig.PortBindings, {});
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network]);
  assert.ok(container.Mounts.every(mount => mount.Type === 'bind' && mount.RW === false));
}
assert.equal(containers[0].State.Running, true);
assert.equal(containers[1].State.Status, 'exited');
assert.equal(containers[1].State.ExitCode, 0);
const expectedServer = [[capsule, '/capsule'], [join(output, 'probe-server.mjs'), '/probe-server.mjs'], [join(output, 'source.txt'), '/review/source.txt']];
const expectedClient = [[join(output, 'probe-client.mjs'), '/probe-client.mjs'], [join(output, 'client-only-canary.json'), '/client-only-canary.json']];
for (const [index, expected] of [expectedServer, expectedClient].entries()) {
  assert.deepEqual(containers[index].Mounts.map(mount => [mount.Source, mount.Destination]).sort(), expected.sort());
}
assert.equal(JSON.parse(networkRaw)[0].Internal, true);
assert.equal(JSON.parse(networkRaw)[0].EnableIPv6, false);
const serverLog = docker(['logs', server]);
const clientLog = docker(['logs', client]);
assert.equal(JSON.parse(serverLog).ready, true);
assert.equal(JSON.parse(clientLog).status, 'passed');
const files = [];
function save(name, bytes) {
  writeFileSync(join(output, name), bytes, { flag: 'wx' });
  files.push({ path: name, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) });
}
save('containers.json', inspect);
save('network.json', networkRaw);
save('image.json', imageRaw);
save('server.stdout.json', serverLog);
save('client.stdout.json', clientLog);
for (const name of ['methodology-read-mcp.js', 'methodology-read-tools.js', 'package.json']) {
  copyFileSync(join(capsule, name), join(output, name), constants.COPYFILE_EXCL);
}
for (const name of ['probe-server.mjs', 'probe-client.mjs', 'source.txt', 'client-only-canary.json',
  'capture-runtime-probe.mjs', 'methodology-read-mcp.js', 'methodology-read-tools.js', 'package.json']) {
  const bytes = readFileSync(join(output, name));
  files.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
}
const sources = ['eval/methodology-read-mcp.ts', 'eval/methodology-read-tools.ts', 'package-lock.json'].map(path => {
  const bytes = readFileSync(join(repo, path));
  return { path, bytes: bytes.length, sha256: hash(bytes) };
});
save('cleanup.stdout.txt', docker(['stop', '--time', '5', server]) + docker(['rm', server, client]) + docker(['network', 'rm', network]));
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ schemaVersion: 1, evidenceClass: 'credential-free-synthetic-protocol-probe',
  capturedAt: new Date().toISOString(), image, sourceHeadBeforeUncommittedAdapter: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(),
  sources, files, providerCalls: 0, codexInvocations: 0, realCredentialsMounted: false,
  limitations: ['No Codex initialization or model-visible tool catalog was tested.',
    'No provider-connected network or credential-bearing runtime was tested.',
    'One outbound IPv4 TCP target and the IPv4 default route were checked, not an exhaustive egress policy.',
    'This authored synthetic probe is not an independent signed runtime attestation.',
    'The captured random MCP endpoint/session capabilities expired with container cleanup.'],
}, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ capturedFiles: files.length, sourceBindings: sources.length, cleanup: 'completed' }));
