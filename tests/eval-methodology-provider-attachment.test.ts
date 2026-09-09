import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { ExecResult } from "../src/util/exec.js";
import {
  ACCEPTED_EVAL_RUNTIME_IMAGE,
  createMethodologyProviderAttacher,
  createStructuralMockMethodologyProviderAttacher,
  assertMethodologyProviderAttachment,
  assertMethodologyProviderScopeRecord,
  type MethodologyProviderAttachmentRequest,
} from "../eval/methodology-provider-attachment.js";
import { ACCEPTED_METHODOLOGY_EGRESS_IMAGE, METHODOLOGY_EGRESS_BASE_ENV } from "../eval/methodology-egress.js";

const READ_LIMITS = { maxIndexEntries: 20, maxFileBytes: 10_000, maxOutputBytes: 20_000,
  maxSearchMatches: 10, excludedNamespaces: ["private"] } as const;
const MCP_LIMITS = { maxRequestBytes: 4096, maxResponseBytes: 8192, requestTimeoutMs: 3000,
  maxConnections: 4, maxRequests: 100 } as const;
const TREE = "a".repeat(40);
const PROVIDER_AUTHORITIES = ["api.openai.com:443"] as const;
process.env.OPENAI_API_KEY ??= "synthetic-test-key";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "methodology-provider-attachment-"));
  const paths = { repo: join(root, "repo"), home: join(root, "home"), assets: join(root, "assets"), output: join(root, "output") };
  for (const path of Object.values(paths)) mkdirSync(path);
  chmodSync(paths.output, 0o700);
  mkdirSync(join(paths.output, "methodology-test"));
  mkdirSync(join(paths.assets, "schemas"));
  writeFileSync(join(paths.assets, "schemas", "methodology-review.schema.json"), "{}\n");
  writeFileSync(join(paths.repo, "source.ts"), "export const visible = true;\n");
  return { root, paths };
}
function req(paths: ReturnType<typeof fixture>["paths"], armId: "A" | "B" | "C" | "D" = "A"): MethodologyProviderAttachmentRequest {
  return { attemptId: "attempt-000001", armId, sourceHeadTree: TREE, paths };
}
function fakeDocker(calls: string[][]) {
  return async (command: string, args: string[]) => {
    calls.push([command, ...args]);
    if (args[0] === "rm") return { stdout: "", stderr: "", code: 0, timedOut: false };
    if (args[0] === "ps") return { stdout: "", stderr: "", code: 0, timedOut: false };
    return { stdout: "", stderr: "", code: 0, timedOut: false };
  };
}
function call(url: string, body: unknown, headers: Record<string, string> = {}): Promise<{
  status: number;
  text: string;
  headers: Record<string, string | string[] | undefined>;
}> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    // host.docker.internal is intentionally a container-only URL; use the
    // listener address while preserving the exact authorized Host authority.
    const req = request({ hostname: "127.0.0.1", port: parsed.port, path: parsed.pathname,
      method: "POST", headers: { Host: parsed.host, Accept: "application/json, text/event-stream",
        "Content-Type": "application/json", ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, text: Buffer.concat(chunks).toString("utf8"),
        headers: res.headers }));
    });
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

test("attachment canonicalizes exact roots, uses methodology profile, and exposes source through MCP", async () => {
  const { root, paths } = fixture();
  const calls: string[][] = [];
  const requestValue = req(paths);
  const attacher = createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024, run: fakeDocker(calls) });
  const attachment = await attacher(requestValue);
  try {
    assert.equal(attachment.attestation.image, ACCEPTED_EVAL_RUNTIME_IMAGE);
    assert.equal(attachment.attestation.runner, "codex");
    assert.equal(attachment.attestation.profile, "methodology-review");
    assert.equal(attachment.neutralReadMcp.protocol, "neutral-read-mcp-v2");
    assert.equal(attachment.neutralReadMcp.attachment.attemptId, requestValue.attemptId);
    assert.equal(attachment.neutralReadMcp.attachment.sourceHeadTree, requestValue.sourceHeadTree);
    assert.equal(attachment.neutralReadMcp.attachment.executionClass, "structural-mock");
    assert.equal(attachment.neutralReadMcp.attachment.outputByteLimit, 1024);
    assert.equal(attachment.neutralReadMcp.attachment.attestationSha256.length, 64);
    assert.deepEqual(attachment.attestation.effectiveRoots, Object.fromEntries(
      Object.entries(paths).map(([key, value]) => [key, requireCanonical(value)]),
    ));
    assert.match(attachment.neutralReadMcp.url, /^http:\/\/host\.docker\.internal:\d+\/mcp\/[a-f0-9]{64}$/);
    assert.equal((await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "spoof", version: "1" } } },
    { Host: "host.docker.internal:1" })).status, 403);
    const initialized = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1" } } });
    assert.equal(initialized.status, 200);
    assert.ok(JSON.parse(initialized.text).result);
    const headers = { "Mcp-Session-Id": String(initialized.headers["mcp-session-id"]),
      "MCP-Protocol-Version": "2025-06-18" };
    assert.match(headers["Mcp-Session-Id"], /^[a-f0-9]{64}$/);
    assert.equal((await call(attachment.neutralReadMcp.url,
      { jsonrpc: "2.0", method: "notifications/initialized" }, headers)).status, 202);
    const read = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 2, method: "tools/call",
      params: { name: "read_file", arguments: { path: "source.ts" } } }, headers);
    assert.equal(JSON.parse(JSON.parse(read.text).result.content[0].text).text,
      "export const visible = true;\n");
    await attachment.runProvider("codex", ["exec", "--ephemeral", "--ignore-user-config", "--ignore-rules",
      "--config", "project_doc_max_bytes=0", "--config", "project_doc_fallback_filenames=[]", "--config",
      'projects."/workspace".trust_level="untrusted"', "--disable", "shell_tool", "--disable", "unified_exec",
      "--config", `mcp_servers.source_read.url=${JSON.stringify(attachment.neutralReadMcp.url)}`,
      "--config", 'mcp_servers.source_read.enabled_tools=["list_tree","read_file","search_text"]',
      "--config", "mcp_servers.source_read.required=true",
      "--strict-config", "--sandbox", "read-only", "--model", "gpt-5.6-sol", "--config",
      'model_reasoning_effort="high"', "--cd", paths.repo, "--output-schema", join(paths.assets, "schemas", "methodology-review.schema.json"),
      "--output-last-message", join(paths.output, "methodology-test", "stage-1.json"), "--json", "--color", "never", "-"], { inheritEnv: false });
    const run = calls.find((entry) => entry[0] === "docker" && entry[1] === "run");
    assert.ok(run);
    assert.ok(run.includes("--network") && run.includes("bridge"));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.repo)},target=/workspace,readonly`));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.assets)},target=/opt/peregrine,readonly`));
    assert.ok(run.includes(`type=bind,source=${requireCanonical(paths.output)},target=/output`));
    assert.ok(run.includes("--add-host") && run.includes("host.docker.internal:host-gateway"));
  } finally {
    await attachment.close();
    await attachment.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("A/B allow one session while C/D allow two, and Host/Origin remain strict", async () => {
  for (const armId of ["A", "C"] as const) {
    const { root, paths } = fixture();
    const calls: string[][] = [];
    const attachment = await createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES, readToolLimits: READ_LIMITS,
      run: fakeDocker(calls),
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(req(paths, armId));
    try {
      const first = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "one", version: "1" } } });
      assert.equal(first.status, 200);
      const second = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 2, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "two", version: "1" } } });
      assert.equal(second.status, armId === "C" ? 200 : 409);
      const wrongOrigin = await call(attachment.neutralReadMcp.url, { jsonrpc: "2.0", id: 3, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } }, { Origin: "https://attacker.invalid" });
      assert.equal(wrongOrigin.status, 403);
    } finally {
      await attachment.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("branding rejects cross-request substitution, forged shape, and mutable request drift", async () => {
  const first = fixture();
  const second = fixture();
  const original = req(first.paths);
  const attachment = await createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES, readToolLimits: READ_LIMITS,
    run: fakeDocker([]),
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(original);
  const attestation = attachment.attestation;
  try {
    assertMethodologyProviderAttachment(attachment, original, attestation);
    assert.throws(() => assertMethodologyProviderAttachment({ ...attachment }, req(first.paths), attestation), /not trusted/);
    assert.throws(() => assertMethodologyProviderAttachment(attachment, req(second.paths), attestation), /mismatch/);
    const bound = await createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES, readToolLimits: READ_LIMITS,
      run: fakeDocker([]),
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 })(original);
    original.sourceHeadTree = "b".repeat(40);
    assert.throws(() => assertMethodologyProviderAttachment(bound, original, bound.attestation), /mismatch/);
    await bound.close();
  } finally {
    await attachment.close();
    rmSync(first.root, { recursive: true, force: true });
    rmSync(second.root, { recursive: true, force: true });
  }
});

function requireCanonical(path: string): string {
  // macOS temp directories may be exposed through /var while realpath uses
  // /private/var; this keeps the assertion about canonicalization explicit.
  return realpathSync(path);
}

test("cross-root and substitution paths are rejected before an MCP listener is created", async () => {
  const { root, paths } = fixture();
  try {
    const factory = createStructuralMockMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES, readToolLimits: READ_LIMITS,
      run: fakeDocker([]),
      mcpLimits: MCP_LIMITS, outputByteLimit: 1024 });
    await assert.rejects(() => factory(req({ ...paths, output: paths.repo })), /roots must be distinct/);
    await assert.rejects(() => factory(req({ ...paths, assets: join(paths.repo, "missing") })), /ENOENT/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("production attachments cannot inject a mock executor", () => {
  assert.throws(() => createMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES, readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS, outputByteLimit: 1024, run: fakeDocker([]) } as never),
  /cannot inject/);
});

test("production attachments cannot inject a sidecar executor", () => {
  const calls: string[][] = [];
  assert.throws(() => createMethodologyProviderAttacher({ providerAccess: "api-key", providerAuthorities: PROVIDER_AUTHORITIES,
    readToolLimits: READ_LIMITS, mcpLimits: MCP_LIMITS, outputByteLimit: 1024,
    egressRun: fakeDocker(calls) } as never), /cannot inject/);
  assert.deepEqual(calls, []);
});

test("attachment factory rejects limits outside the bundled forwarder contract", () => {
  for (const [key, value] of [
    ["maxRequestBytes", 50 * 1024 * 1024 + 1],
    ["maxResponseBytes", 50 * 1024 * 1024 + 1],
    ["requestTimeoutMs", 120_001],
    ["maxConnections", 1_025],
    ["maxRequests", 1_000_001],
  ] as const) {
    assert.throws(() => createStructuralMockMethodologyProviderAttacher({
      providerAccess: "api-key",
      readToolLimits: READ_LIMITS,
      mcpLimits: { ...MCP_LIMITS, [key]: value },
      outputByteLimit: 1024,
      run: fakeDocker([]),
    }), new RegExp(`invalid ${key}`));
  }
});

function installPersistentDockerStub(root: string): { bin: string; statePath: string } {
  const bin = join(root, "fake-docker-bin");
  mkdirSync(bin);
  const statePath = join(bin, "state.json");
  const source = `#!${process.execPath}
const fs = require("node:fs");
const crypto = require("node:crypto");
const statePath = ${JSON.stringify(statePath)};
const baseEnv = ${JSON.stringify(METHODOLOGY_EGRESS_BASE_ENV)};
const tmpfs = {
  "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777",
  "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700",
};
function load() {
  try { return JSON.parse(fs.readFileSync(statePath, "utf8")); }
  catch { return { calls: [], networks: {}, containers: {} }; }
}
const state = load();
const args = process.argv.slice(2);
state.calls.push(args);
function save() { fs.writeFileSync(statePath, JSON.stringify(state)); }
function fail(message) { save(); process.stderr.write(message + "\\n"); process.exit(2); }
function out(value) { save(); process.stdout.write(typeof value === "string" ? value : JSON.stringify(value)); }
function exact(expected, label) {
  if (JSON.stringify(args) !== JSON.stringify(expected)) fail("unexpected " + label + " command");
}
function subnetHost(subnet, index) {
  return subnet.split(".").slice(0, 3).join(".") + "." + String(index);
}
function containerNetworks(container) {
  return Object.fromEntries(Object.entries(container.networks).map(([name, network]) => [name, {
    Aliases: network.aliases,
    IPAddress: network.ip,
    IPv6Address: "",
  }]));
}
function inspectContainer(container) {
  return {
    Name: "/" + container.name,
    Path: container.entrypoint,
    Args: [],
    Config: {
      Image: container.image,
      Entrypoint: [container.entrypoint],
      Env: [...baseEnv, ...container.env],
    },
    Mounts: [{ Type: "tmpfs", Destination: "/tmp" }, { Type: "tmpfs", Destination: "/home/peregrine" }],
    HostConfig: {
      ReadonlyRootfs: true,
      CapDrop: ["ALL"],
      SecurityOpt: ["no-new-privileges"],
      PidsLimit: 64,
      User: "65532:65532",
      Tmpfs: tmpfs,
      ExtraHosts: container.addHost === undefined ? [] : [container.addHost],
    },
    State: { Running: container.running },
    NetworkSettings: { Networks: containerNetworks(container) },
  };
}
function inspectNetwork(name) {
  const network = state.networks[name];
  if (!network) fail("unknown network");
  const containers = {};
  for (const container of Object.values(state.containers)) {
    const member = container.networks[name];
    if (member) containers[container.id] = {
      Name: "/" + container.name,
      IPv4Address: member.ip + "/28",
      IPv6Address: "",
    };
  }
  return { Name: name, Driver: "bridge", Internal: network.internal, EnableIPv6: false,
    IPAM: { Config: [{ Subnet: network.subnet }] }, Containers: containers };
}
function digestAudit(protocol, body, field) {
  const copy = { ...body };
  delete copy[field];
  if (protocol === "egress-gateway-audit-v1") delete copy.sealed;
  return crypto.createHash("sha256").update(protocol + "\\0").update(JSON.stringify(copy)).digest("hex");
}
function sidecarLogs(container, readinessOnly) {
  const gateway = container.role === "gateway";
  const protocol = gateway ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1";
  const lines = [{ status: "ready", protocol, ready: true }];
  if (!readinessOnly) {
    const auditProtocol = gateway ? "egress-gateway-audit-v1" : "methodology-mcp-forwarder-audit-v1";
    const field = gateway ? "sha256" : "snapshotSha256";
    const audit = { protocol: auditProtocol, sealed: true, requests: 0 };
    audit[field] = digestAudit(auditProtocol, audit, field);
    lines.push({ status: "sealed", protocol, audit });
  }
  return lines.map((line) => JSON.stringify(line)).join("\\n") + "\\n";
}
if (args[0] === "network" && args[1] === "create") {
  const internal = args[2] === "--internal";
  const expected = internal
    ? ["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", "--subnet", args[7], args[8]]
    : ["network", "create", "--ipv6=false", "--driver", "bridge", "--subnet", args[6], args[7]];
  if (args.length !== (internal ? 9 : 8) || JSON.stringify(args) !== JSON.stringify(expected) || state.networks[internal ? args[8] : args[7]]) {
    if (state.networks[internal ? args[8] : args[7]]) fail("duplicate network");
    fail("unexpected network create command");
  }
  const name = internal ? args[8] : args[7];
  state.networks[name] = { internal, subnet: internal ? args[7] : args[6] };
  out(name + "\\n");
} else if (args[0] === "run") {
  if (args[1] !== "--detach" || args[2] !== "--name" || args[4] !== "--pull" || args[5] !== "never" || args[6] !== "--network") fail("unexpected sidecar run command");
  const name = args[3];
  const networkName = args[7];
  const entrypointIndex = args.indexOf("--entrypoint");
  const entrypoint = args[entrypointIndex + 1];
  const image = args[args.length - 1];
  const role = entrypoint === "/usr/local/bin/peregrine-egress-gateway" ? "gateway"
    : entrypoint === "/usr/local/bin/peregrine-methodology-mcp-forwarder" ? "forwarder" : undefined;
  if (!role || entrypointIndex < 0 || !state.networks[networkName] || state.containers[name]) fail("unexpected sidecar run identity");
  const env = [];
  for (let i = 0; i < args.length; i++) if (args[i] === "--env") env.push(args[i + 1]);
  const addHostIndex = args.indexOf("--add-host");
  const addHost = addHostIndex === -1 ? undefined : args[addHostIndex + 1];
  const network = state.networks[networkName];
  state.containers[name] = { id: "id-" + name, name, image, entrypoint, role, env, addHost, running: true,
    networks: { [networkName]: { ip: subnetHost(network.subnet, role === "gateway" ? 2 : 3), aliases: [name] } } };
  out("id-" + name + "\\n");
} else if (args[0] === "logs") {
  const name = args[args.length - 1];
  const container = state.containers[name];
  if (!container || (args.length !== 6 && args.length !== 4) || args[1] !== "--tail" || args[2] !== "64") fail("unexpected logs command");
  if (args.length === 6 && (args[3] !== "--since" || args[4] !== "0s")) fail("unexpected readiness logs command");
  out(sidecarLogs(container, args.length === 6));
} else if (args[0] === "network" && args[1] === "connect") {
  exact(["network", "connect", "--alias", args[3], args[4], args[5]], "network connect");
  const network = state.networks[args[4]];
  const container = state.containers[args[5]];
  if (!network || !container) fail("unknown network connect member");
  container.networks[args[4]] = { ip: subnetHost(network.subnet, container.role === "gateway" ? 2 : 3), aliases: [container.name, args[3]] };
  out("");
} else if (args[0] === "inspect") {
  if (args.length !== 3 || !state.containers[args[1]] || !state.containers[args[2]]) fail("unexpected container inspect command");
  out(JSON.stringify([inspectContainer(state.containers[args[1]]), inspectContainer(state.containers[args[2]])]));
} else if (args[0] === "network" && args[1] === "inspect") {
  if (args.length !== 3 || !state.networks[args[2]]) fail("unexpected network inspect command");
  out(JSON.stringify([inspectNetwork(args[2])]));
} else if (args[0] === "stop") {
  if (args.length !== 4 || args[1] !== "--time" || args[2] !== "15" || !state.containers[args[3]]) fail("unexpected stop command");
  state.containers[args[3]].running = false;
  out(args[3] + "\\n");
} else if (args[0] === "rm") {
  if (args.length !== 3 || args[1] !== "--force") fail("unexpected remove command");
  delete state.containers[args[2]];
  out(args[2] + "\\n");
} else if (args[0] === "ps") {
  if (args.length !== 5 || args[1] !== "--all" || args[2] !== "--quiet" || args[3] !== "--filter" || !args[4].startsWith("name=^/") || !args[4].endsWith("$")) fail("unexpected ps command");
  const name = args[4].slice("name=^/".length, -1);
  out(state.containers[name] ? state.containers[name].id + "\\n" : "");
} else if (args[0] === "network" && args[1] === "rm") {
  if (args.length !== 3 || !state.networks[args[2]]) fail("unexpected network remove command");
  delete state.networks[args[2]];
  out(args[2] + "\\n");
} else if (args[0] === "network" && args[1] === "ls") {
  if (args.length !== 5 || args[2] !== "--quiet" || args[3] !== "--filter" || !args[4].startsWith("name=^") || !args[4].endsWith("$")) fail("unexpected network ls command");
  const name = args[4].slice("name=^".length, -1);
  out(state.networks[name] ? name + "\\n" : "");
} else {
  fail("unexpected docker command");
}
`;
  const executable = join(bin, "docker");
  writeFileSync(executable, source, { mode: 0o700 });
  writeFileSync(statePath, JSON.stringify({ calls: [], networks: {}, containers: {} }));
  chmodSync(executable, 0o700);
  return { bin, statePath };
}

test("real provider v3 finalizer validates before sidecar cleanup and seals a branded scope record", async () => {
  const { root, paths } = fixture();
  const fake = installPersistentDockerStub(root);
  const originalPath = process.env.PATH;
  process.env.PATH = `${fake.bin}:${originalPath ?? ""}`;
  const requestValue = req(paths);
  const attacher = createMethodologyProviderAttacher({
    providerAccess: "api-key",
    providerAuthorities: PROVIDER_AUTHORITIES,
    readToolLimits: READ_LIMITS,
    mcpLimits: MCP_LIMITS,
    outputByteLimit: 1024,
  });
  let attachment: Awaited<ReturnType<typeof attacher>> | undefined;
  try {
    attachment = await attacher(requestValue);
    const attached = attachment;
    const before = JSON.parse(readFileSync(fake.statePath, "utf8")) as {
      calls: string[][];
      networks: Record<string, unknown>;
      containers: Record<string, unknown>;
    };
    assert.equal(Object.keys(before.networks).length, 2);
    assert.equal(Object.keys(before.containers).length, 2);
    assert.equal(attached.neutralReadMcp.protocol, "neutral-read-mcp-v3");
    assert.equal(attached.attestation.schemaVersion, 2);
    await assert.rejects(async () => await attached.finalizeScope({
      registeredReviewScopeSha256: "malformed",
      modelLimitations: [],
      findingCount: 0,
    }), /input identity is invalid/);
    const afterMalformed = JSON.parse(readFileSync(fake.statePath, "utf8")) as typeof before;
    assert.deepEqual(afterMalformed.calls.filter((call) => ["stop", "rm"].includes(call[0]!) || call[0] === "network" && ["rm"].includes(call[1]!)), []);
    assert.equal(Object.keys(afterMalformed.networks).length, 2);
    assert.equal(Object.keys(afterMalformed.containers).length, 2);

    const record = await attached.finalizeScope({
      registeredReviewScopeSha256: "c".repeat(64),
      modelLimitations: [{ kind: "unable-to-complete", detail: "synthetic deterministic provider test" }],
      findingCount: 0,
    });
    assert.equal(record.schemaVersion, 2);
    assert.equal(record.protocol, "historical-methodology-scope-record-v2");
    assert.equal(record.sidecarDiagnostics.length, 2);
    assert.deepEqual(record.sidecarDiagnostics, [
      { sidecar: "gateway", ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
      { sidecar: "forwarder", ready: true, sealed: true, selfDigestValid: true, lineObserved: true },
    ]);
    assertMethodologyProviderScopeRecord(record, attached.finalizeScope);
    const afterValid = JSON.parse(readFileSync(fake.statePath, "utf8")) as typeof before;
    assert.equal(Object.keys(afterValid.networks).length, 0);
    assert.equal(Object.keys(afterValid.containers).length, 0);
    assert.equal(afterValid.calls.filter((call) => call[0] === "stop").length, 2);
    assert.equal(afterValid.calls.filter((call) => call[0] === "rm").length, 2);
    assert.equal(afterValid.calls.filter((call) => call[0] === "network" && call[1] === "rm").length, 2);
    await attached.close();
  } finally {
    process.env.PATH = originalPath;
    await attachment?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  }
});
