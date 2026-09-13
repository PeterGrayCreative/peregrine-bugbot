import { ipv4EndpointFixture, sidecarHostFixture } from "./eval-methodology-inspect-fixture.js";
import { validateIpv4OnlyEndpoint } from "../eval/methodology-inspect-policy.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ExecResult } from "../src/util/exec.js";
import { readFileSync } from "node:fs";
import { ACCEPTED_EVAL_RUNTIME_IMAGE } from "../eval/runtime-containment.js";
import { isRecordedMethodologyEgressImage, METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE, PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE } from "../eval/methodology-runtime-image.js";
import {
  ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
  createMethodologyEgressSupervisor,
  createZeroProviderCandidateEgressSupervisor,
  ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE,
  createStructuralMockMethodologyEgressSupervisor,
  METHODOLOGY_EGRESS_BASE_ENV,
  parseMethodologyEgressNetworkConnectArgs,
  parseMethodologyEgressNetworkCreateArgs,
  parseMethodologyEgressExternalNetworkCreateArgs,
  parseMethodologyEgressContainerInspect,
  parseMethodologyEgressNetworkInspect,
  parseMethodologyEgressSidecarRunArgs,
  parseProviderHostAllowlist,
} from "../eval/methodology-egress.js";

const limits = {
  maxRequestBytes: 4096,
  maxResponseBytes: 8192,
  maxHeaderBytes: 8192,
  requestTimeoutMs: 500,
  maxConnections: 4,
  maxRequests: 20,
};

function result(stdout = "", code = 0): ExecResult { return { stdout, stderr: "", code, timedOut: false }; }

test("provider allowlist is exact, nonempty, DNS-only, and port 443", () => {
  assert.deepEqual(parseProviderHostAllowlist(["api.openai.com:443", "api.anthropic.com:443"]), ["api.openai.com:443", "api.anthropic.com:443"]);
  for (const value of [[], ["api.openai.com:80"], ["*.openai.com:443"], ["127.0.0.1:443"], ["API.OPENAI.COM:443"], ["api.openai.com:443", "api.openai.com:443"]]) {
    assert.throws(() => parseProviderHostAllowlist(value), /allowlist|port|DNS|invalid|duplicate/i);
  }
});

test("topology parsers reject mutations", () => {
  assert.deepEqual(parseMethodologyEgressNetworkCreateArgs(["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", "--subnet", "172.20.16.0/28", "attempt-network"]), { name: "attempt-network", subnet: "172.20.16.0/28", internal: true });
  assert.deepEqual(parseMethodologyEgressExternalNetworkCreateArgs(["network", "create", "--ipv6=false", "--driver", "bridge", "--subnet", "172.20.17.0/28", "attempt-external"]), { name: "attempt-external", subnet: "172.20.17.0/28", internal: false });
  assert.throws(() => parseMethodologyEgressNetworkCreateArgs(["network", "create", "--internal", "--ipv6", "--driver", "bridge", "--subnet", "172.20.16.0/28", "attempt-network"]));
  assert.doesNotThrow(() => parseMethodologyEgressNetworkConnectArgs(["network", "connect", "--alias", "egress-gateway", "attempt-network", "gateway"] , { network: "attempt-network", container: "gateway", alias: "egress-gateway" }));
});

test("network inspect accepts Docker's pretty-printed array output", () => {
  const network = {
    Name: "attempt-network",
    Driver: "bridge",
    Internal: true,
    EnableIPv6: false,
    IPAM: { Config: [{ Subnet: "172.20.16.0/28" }] },
    Containers: {
      a: { Name: "/gateway", IPv4Address: "172.20.16.2/28", IPv6Address: "" },
      b: { Name: "/forwarder", IPv4Address: "172.20.16.3/28", IPv6Address: "" },
    },
  };
  const expected = {
    name: "attempt-network",
    network: "attempt-network",
    subnet: "172.20.16.0/28",
    sidecars: ["gateway", "forwarder"],
  };
  assert.doesNotThrow(() => parseMethodologyEgressNetworkInspect(JSON.stringify([network], null, 2), expected));
  assert.throws(() => parseMethodologyEgressNetworkInspect(JSON.stringify([network, network], null, 2), expected), /exactly one/);
});

test("provider supervisor rejects an injected executor", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    return result();
  };
  await assert.rejects(() => createMethodologyEgressSupervisor({
    attemptId: "attempt-000001", armId: "A", sourceHeadTree: "a".repeat(40),
    providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, mcpLimits: limits,
    run,
  } as never), /cannot inject/);
  assert.deepEqual(calls, []);
});

test("local zero-provider candidate cannot replace the accepted provider image or choose a provider destination", async () => {
  const options = { attemptId: "attempt-000001", armId: "A", sourceHeadTree: "a".repeat(40),
    providerAuthorities: ["zero-provider.invalid:443"], hostMcpPort: 43123, mcpLimits: limits };
  await assert.rejects(createMethodologyEgressSupervisor({ ...options, image: ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE }), /accepted immutable digest/);
  await assert.rejects(createMethodologyEgressSupervisor({ ...options, image: PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE }), /accepted immutable digest/);
  await assert.rejects(createZeroProviderCandidateEgressSupervisor({ ...options, providerAuthorities: ["api.openai.com:443"] }), /candidate options/);
  await assert.rejects(createZeroProviderCandidateEgressSupervisor({ ...options, image: ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE }), /candidate options/);
  await assert.rejects(createZeroProviderCandidateEgressSupervisor({ ...options, run: async () => result() } as never), /candidate options/);
});

test("published experimental image acceptance binds source bytes without accepting a provider canary or changing general review runtime", () => {
  const acceptance = METHODOLOGY_RUNTIME_IMAGE_ACCEPTANCE;
  assert.equal(ACCEPTED_METHODOLOGY_EGRESS_IMAGE, "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:ccad8c4087d95936231b9c0ac38f4db0782e74da7183c08eee59b71114e15826");
  assert.equal(acceptance.image, ACCEPTED_METHODOLOGY_EGRESS_IMAGE);
  assert.equal(acceptance.workflowRunId, 34758654512);
  assert.equal(acceptance.sourceCommit, "b01d15680705ff7e8d28047f5b529298acbb1c95");
  assert.deepEqual(Object.keys(acceptance.platforms), ["linux/amd64", "linux/arm64"]);
  for (const [path, expected] of Object.entries(acceptance.sourceSha256)) {
    assert.equal(createHash("sha256").update(readFileSync(path)).digest("hex"), expected, path);
  }
  assert.equal(ACCEPTED_EVAL_RUNTIME_IMAGE, "ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:0ad23c12cc2172a54b2b298ebde4096d3e4924efc3d3bf5c2c4f616c7d00e6b3");
  assert.deepEqual([acceptance.providerAuthorized, acceptance.cliAgentCanaryProven, acceptance.exactServedModel, acceptance.exactServedVersion], [false, false, null, null]);
  assert.equal(isRecordedMethodologyEgressImage(PREVIOUS_METHODOLOGY_EGRESS_RUNTIME_IMAGE), true);
  assert.equal(isRecordedMethodologyEgressImage(acceptance.image), true);
  for (const invalid of [ZERO_PROVIDER_FORWARDER_CANDIDATE_IMAGE, ACCEPTED_EVAL_RUNTIME_IMAGE, acceptance.image.replace(/@.*/, ":latest"), null]) assert.equal(isRecordedMethodologyEgressImage(invalid), false);
});

test("prediction source endpoint token is exact and setup cancellation cannot cancel cleanup", async () => {
  const deadline = new AbortController(), calls: { args: string[]; signal: AbortSignal | undefined }[] = [];
  const run = async (_command: string, args: string[], options?: { deadlineSignal?: AbortSignal }) => {
    calls.push({ args, signal: options?.deadlineSignal });
    if (args[0] === "network" && args[1] === "create") deadline.abort();
    return result();
  };
  await assert.rejects(createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000004", armId: "A", sourceHeadTree: "a".repeat(40),
    providerAuthorities: ["zero-provider.invalid:443"], hostMcpPort: 43123, hostMcpToken: "a".repeat(64), deadlineSignal: deadline.signal, mcpLimits: limits, run }), /deadline/);
  assert.equal(calls.filter(call => call.args[1] === "create").length, 1);
  assert.strictEqual(calls[0]!.signal, deadline.signal);
  assert.ok(calls.some(call => call.args[1] === "rm")); assert.ok(calls.some(call => call.args[1] === "ls"));
  assert.ok(calls.slice(1).every(call => call.signal === undefined));
  const before = calls.length;
  await assert.rejects(createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000004", armId: "A", sourceHeadTree: "a".repeat(40),
    providerAuthorities: ["zero-provider.invalid:443"], hostMcpPort: 43123, hostMcpToken: "../bad", mcpLimits: limits, run }), /endpoint token/);
  assert.equal(calls.length, before);
});

test("supervisor rejects limits the bundled forwarder cannot honor", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    return result();
  };
  for (const [key, value] of [
    ["maxRequestBytes", 50 * 1024 * 1024 + 1],
    ["maxResponseBytes", 50 * 1024 * 1024 + 1],
    ["maxHeaderBytes", 64 * 1024 + 1],
    ["requestTimeoutMs", 120_001],
    ["maxConnections", 1_025],
    ["maxRequests", 1_000_001],
  ] as const) {
    await assert.rejects(() => createStructuralMockMethodologyEgressSupervisor({
      attemptId: "attempt-000001",
      armId: "A",
      sourceHeadTree: "a".repeat(40),
      providerAuthorities: ["api.openai.com:443"],
      hostMcpPort: 43123,
      mcpLimits: { ...limits, [key]: value },
      run,
    }), new RegExp(`invalid MCP limit ${key}`));
  }
  assert.deepEqual(calls, []);
});

test("supervisor uses only injected Docker and closes idempotently", async () => {
  const calls: string[][] = [];
  let network = ""; let externalNetwork = ""; let subnet = ""; let externalSubnet = ""; let gateway = ""; let forwarder = ""; let stopped = false; let failNetworkRemoval = false; let retainedNetwork = ""; const sidecarEnvs = new Map<string, string[]>();
  const digest = (protocol: string, body: Record<string, unknown>): string => {
    return createHash("sha256").update(`${protocol}\0${JSON.stringify(body)}`).digest("hex");
  };
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    if (args[0] === "network" && args[1] === "create") { const internal = args.includes("--internal"); if (internal) { network = args.at(-1)!; subnet = args[7]!; } else { externalNetwork = args.at(-1)!; externalSubnet = args[6]!; } return result(`${args.at(-1)!}\n`); }
    if (args[0] === "network" && args[1] === "rm" && failNetworkRemoval) { failNetworkRemoval = false; retainedNetwork = args[2]!; return result("", 1); }
    if (args[0] === "network" && args[1] === "ls" && retainedNetwork === args.at(-1)?.replace(/^name=\^|\$$/gu, "")) {
      const retained = retainedNetwork;
      retainedNetwork = "";
      return result(`${retained}\n`);
    }
    if (args[0] === "run" && args.includes("/usr/local/bin/peregrine-egress-gateway")) { gateway = args[3]!; sidecarEnvs.set(gateway, [...METHODOLOGY_EGRESS_BASE_ENV, ...args.flatMap((value, index) => value === "--env" && args[index + 1] ? [args[index + 1]!] : [])]); }
    if (args[0] === "run" && args.includes("/usr/local/bin/peregrine-methodology-mcp-forwarder")) { forwarder = args[3]!; sidecarEnvs.set(forwarder, [...METHODOLOGY_EGRESS_BASE_ENV, ...args.flatMap((value, index) => value === "--env" && args[index + 1] ? [args[index + 1]!] : [])]); }
    if (args[0] === "logs") {
      // A ready record emitted before this query is absent from --since 0s.
      if (args.includes("--since")) return result();
      const name = args[args.length - 1]!;
      if (stopped && name === gateway) { const body = { schemaVersion: 1, protocol: "egress-gateway-audit-v1", events: [] }; return result(JSON.stringify({ status: "sealed", protocol: "egress-gateway-v1", audit: { ...body, sealed: true, sha256: digest("egress-gateway-audit-v1", body) } })); }
      if (stopped && name === forwarder) { const body = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 0, allowed: 0, denied: 0, forwarded: 0, budgeted: 0 }, events: [] }; return result(JSON.stringify({ status: "sealed", protocol: "methodology-mcp-forwarder-v1", audit: { ...body, snapshotSha256: digest("methodology-mcp-forwarder-audit-v1", body) } })); }
      if (name.includes("gateway")) return result(JSON.stringify({ status: "ready", protocol: "egress-gateway-v1", host: "0.0.0.0", port: 8081 }) + "\n");
      if (name.includes("forwarder")) return result(JSON.stringify({ status: "ready", protocol: "methodology-mcp-forwarder-v1", ready: true, host: "0.0.0.0", port: 8082 }) + "\n");
      return result();
    }
    if (args[0] === "inspect" && args[1] !== undefined) return result(JSON.stringify([
      ...[args[1]!, args[2]!].map((name) => ({ Name: `/${name}`, Path: name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder", Args: [], State: { Running: true }, Mounts: [], Config: { Cmd: null, Volumes: null, WorkingDir: "/workspace", Tty: false, OpenStdin: false, StdinOnce: false, User: "65532:65532", Image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, Entrypoint: [name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder"], Env: sidecarEnvs.get(name) }, HostConfig: sidecarHostFixture(externalNetwork, name === gateway ? undefined : "host.docker.internal:host-gateway"), NetworkSettings: { Ports: {}, Networks: { [externalNetwork]: { ...ipv4EndpointFixture(), Aliases: [name], IPAddress: `${externalSubnet.replace(".0/28", name === gateway ? ".2" : ".3")}` }, [network]: { ...ipv4EndpointFixture(), Aliases: [name === gateway ? "egress-gateway" : "mcp-forwarder", name], IPAddress: `${subnet.replace(".0/28", name === gateway ? ".2" : ".3")}` } } } }))
    ]));
    if (args[0] === "network" && args[1] === "inspect") { const target = args[2]!; const isInternal = target === network; const selectedSubnet = isInternal ? subnet : externalSubnet; return result(JSON.stringify([{ Name: target, Driver: "bridge", Internal: isInternal, EnableIPv6: false, IPAM: { Config: [{ Subnet: selectedSubnet }] }, Containers: { a: { Name: `/${gateway}`, IPv4Address: `${selectedSubnet.replace(".0/28", ".2")}/28`, IPv6Address: "" }, b: { Name: `/${forwarder}`, IPv4Address: `${selectedSubnet.replace(".0/28", ".3")}/28`, IPv6Address: "" } } }])); }
    if (args[0] === "stop") { stopped = true; return result(); }
    return result();
  };
  const supervisor = await createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000001", armId: "A", sourceHeadTree: "a".repeat(40), providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, hostMcpToken: "b".repeat(64), mcpLimits: limits, run });
  assert.match(supervisor.internalMcpUrl, /^http:\/\/mcp-forwarder:8082\/mcp\/[a-f0-9]{64}$/u);
  assert.equal(new URL(supervisor.internalMcpUrl).pathname, `/mcp/${"b".repeat(64)}`);
  assert.equal(supervisor.attestation.image, ACCEPTED_METHODOLOGY_EGRESS_IMAGE);
  assert.equal(supervisor.attestation.executionClass, "structural-mock");
  assert.equal(supervisor.attestation.externalNetwork, supervisor.names.externalNetwork);
  assert.match(supervisor.attestation.externalNetworkSubnet, /^10\.254\.[0-9]+\.0\/28$/u);
  assert.match(supervisor.attestation.attestationSha256, /^[a-f0-9]{64}$/u);
  failNetworkRemoval = true;
  const failedFirst = supervisor.close();
  const failedSecond = supervisor.close();
  assert.equal(failedFirst, failedSecond);
  await assert.rejects(failedFirst, /cleanup failed/);
  await supervisor.close();
  const stableClose = supervisor.close();
  assert.equal(stableClose, supervisor.close());
  await stableClose;
  assert.equal(calls.filter((args) => args[0] === "network" && args[1] === "create").length, 2);
  assert.equal(calls.filter((args) => args[0] === "network" && args[1] === "rm").length, 3);
  assert.equal(calls.filter((args) => args[0] === "stop").length, 2);
  assert.equal(calls.filter((args) => args[0] === "logs").every((args) => args.includes("--tail") && args[args.indexOf("--tail") + 1] === "64"), true);
  assert.equal(supervisor.auditDiagnostics.every((diagnostic) => diagnostic.selfDigestValid), true);
});

test("partial startup performs bounded cleanup and aggregates cleanup evidence", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    if (args[0] === "run" && args.includes("methodology-mcp-forwarder")) return result("", 1);
    return result();
  };
  await assert.rejects(() => createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000002", armId: "B", sourceHeadTree: "b".repeat(40), providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, mcpLimits: limits, readyTimeoutMs: 100, run }), /forwarder sidecar start|operation/);
  assert.equal(calls.some((args) => args[0] === "stop" && args.some((arg) => arg.includes("gateway"))), true);
  assert.equal(calls.some((args) => args[0] === "network" && args[1] === "rm"), true);
});

test("cleanup failures remain observable while every partial-startup resource is attempted", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    if (args[0] === "run" && args.includes("methodology-mcp-forwarder")) return result("", 1);
    if (args[0] === "stop" || args[0] === "network" && args[1] === "rm") return result("", 1);
    return result();
  };
  await assert.rejects(
    () => createStructuralMockMethodologyEgressSupervisor({
      attemptId: "attempt-000004", armId: "D", sourceHeadTree: "d".repeat(40),
      providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, mcpLimits: limits,
      readyTimeoutMs: 100, run,
    }),
    (error: unknown) => error instanceof AggregateError &&
      error.message === "methodology egress operation and cleanup both failed" &&
      error.errors.length >= 3,
  );
  assert.equal(calls.filter((args) => args[0] === "stop").length, 2);
  assert.equal(calls.filter((args) => args[0] === "rm").length, 2);
  assert.equal(calls.filter((args) => args[0] === "network" && args[1] === "rm").length, 2);
  assert.equal(calls.filter((args) => args[0] === "ps").length, 2);
  assert.equal(calls.filter((args) => args[0] === "network" && args[1] === "ls").length, 2);
});

test("malformed readiness fails closed before topology inspection", async () => {
  const calls: string[][] = [];
  const run = async (_command: string, args: string[]): Promise<ExecResult> => {
    calls.push(args);
    if (args[0] === "logs") return result(JSON.stringify({ status: "ready", protocol: "wrong-sidecar", ready: true }));
    return result();
  };
  await assert.rejects(() => createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000003", armId: "C", sourceHeadTree: "c".repeat(40), providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, mcpLimits: limits, readyTimeoutMs: 100, run }), /readiness|both/);
  assert.equal(calls.some((args) => args[0] === "inspect"), false);
});

test("sidecar argv parser rejects injected credentials and proxy variables", () => {
  const args = ["run", "--detach", "--name", "gateway", "--pull", "never", "--network", "network", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--pids-limit", "64", "--user", "65532:65532", "--tmpfs", "/tmp:rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777", "--tmpfs", "/home/peregrine:rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700", "--env", "EGRESS_ALLOWED_AUTHORITIES=api.openai.com:443", "--env", "OPENAI_API_KEY=secret", "--entrypoint", "/usr/local/bin/peregrine-egress-gateway", ACCEPTED_METHODOLOGY_EGRESS_IMAGE];
  assert.throws(() => parseMethodologyEgressSidecarRunArgs(args, { name: "gateway", network: "network", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, entrypoint: "/usr/local/bin/peregrine-egress-gateway", role: "gateway" }), /credential|environment/);
});

test("container inspect parser rejects missing containment topology", () => {
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify({ Name: "/gateway", Path: "/usr/local/bin/peregrine-egress-gateway", Args: [], Mounts: [] }), { name: "gateway", network: "network", externalNetwork: "external", subnet: "10.254.1.0/28", externalSubnet: "10.254.2.0/28", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, entrypoint: "/usr/local/bin/peregrine-egress-gateway", alias: "egress-gateway", env: {} }), /config/);
});

test("container inspect uses Docker Config.User and rejects environment additions, stopped sidecars, and out-of-subnet endpoints", () => {
  const expected = { name: "gateway", network: "internal", externalNetwork: "external", subnet: "10.254.1.0/28", externalSubnet: "10.254.2.0/28", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, entrypoint: "/usr/local/bin/peregrine-egress-gateway", alias: "egress-gateway", env: { EGRESS_ALLOWED_AUTHORITIES: "api.openai.com:443" } };
  const base = {
    Name: "/gateway", Path: expected.entrypoint, Args: [], State: { Running: true }, Mounts: [],
    Config: { Cmd: null, Volumes: null, WorkingDir: "/workspace", Tty: false, OpenStdin: false, StdinOnce: false, Image: expected.image, User: "65532:65532", Entrypoint: [expected.entrypoint], Env: [...METHODOLOGY_EGRESS_BASE_ENV, "EGRESS_ALLOWED_AUTHORITIES=api.openai.com:443"] },
    HostConfig: sidecarHostFixture("external"),
    NetworkSettings: { Ports: {}, Networks: { external: { ...ipv4EndpointFixture(), Aliases: ["gateway"], IPAddress: "10.254.2.2" }, internal: { ...ipv4EndpointFixture(), Aliases: ["egress-gateway", "gateway"], IPAddress: "10.254.1.2" } } },
  };
  assert.doesNotThrow(() => parseMethodologyEgressContainerInspect(JSON.stringify(base), expected));
  const spoofed = structuredClone(base); spoofed.Config.User = "0:0"; Object.assign(spoofed.HostConfig, { User: "65532:65532" });
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(spoofed), expected), /containment policy/);
  const absentUser = structuredClone(base); delete (absentUser.Config as { User?: string }).User;
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(absentUser), expected), /containment policy/);
  const dockerMapOrder = structuredClone(base);
  dockerMapOrder.HostConfig.Tmpfs = Object.fromEntries(Object.entries(base.HostConfig.Tmpfs).reverse()) as typeof base.HostConfig.Tmpfs;
  assert.doesNotThrow(() => parseMethodologyEgressContainerInspect(JSON.stringify(dockerMapOrder), expected));
  const extraMount = structuredClone(base); Object.assign(extraMount.HostConfig.Tmpfs, { "/unexpected": "rw" });
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(extraMount), expected), /containment policy/);
  const weakerMount = structuredClone(base); weakerMount.HostConfig.Tmpfs["/tmp"] = "rw";
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(weakerMount), expected), /containment policy/);
  const added = structuredClone(base); added.Config.Env.push("EXTRA=value");
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(added), expected), /environment/);
  const duplicate = structuredClone(base); duplicate.Config.Env.push("EGRESS_ALLOWED_AUTHORITIES=api.openai.com:443");
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(duplicate), expected), /environment/);
  const stopped = structuredClone(base); stopped.State.Running = false;
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(stopped), expected), /running/);
  const outside = structuredClone(base); outside.NetworkSettings.Networks.internal.IPAddress = "10.254.9.2";
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(outside), expected), /IPv4/);
});

test("sidecar inspect rejects every unknown, missing or mutated HostConfig field", () => {
  const expected = { name: "gateway", network: "internal", externalNetwork: "external", subnet: "10.254.1.0/28", externalSubnet: "10.254.2.0/28", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, entrypoint: "/usr/local/bin/peregrine-egress-gateway", alias: "egress-gateway", env: {} };
  const base: any = {
    Name: "/gateway", Path: expected.entrypoint, Args: [], State: { Running: true }, Mounts: [],
    Config: { Image: expected.image, User: "65532:65532", Entrypoint: [expected.entrypoint], Cmd: null, Volumes: null, WorkingDir: "/workspace", Tty: false, OpenStdin: false, StdinOnce: false, Env: [...METHODOLOGY_EGRESS_BASE_ENV] },
    HostConfig: sidecarHostFixture("external"),
    NetworkSettings: { Ports: {}, Networks: { external: { ...ipv4EndpointFixture(), Aliases: ["gateway"], IPAddress: "10.254.2.2" }, internal: { ...ipv4EndpointFixture(), Aliases: ["egress-gateway", "gateway"], IPAddress: "10.254.1.2" } } },
  };
  const verify = (value: any) => parseMethodologyEgressContainerInspect(JSON.stringify(value), expected);
  assert.doesNotThrow(() => verify(base));
  for (const key of Object.keys(base.HostConfig)) {
    const missing = structuredClone(base); delete missing.HostConfig[key];
    assert.throws(() => verify(missing), /containment policy/, "missing " + key);
    const changed = structuredClone(base); changed.HostConfig[key] = { unexpected: "host" };
    assert.throws(() => verify(changed), /containment policy/, "mutated " + key);
  }
  for (const key of ["Mounts", "Sysctls", "Init", "Annotations", "FutureCapability"]) {
    const changed = structuredClone(base); changed.HostConfig[key] = {};
    assert.throws(() => verify(changed), /containment policy/, "unknown " + key);
  }
  // Only explicit equivalent no-access list forms are normalized.
  const emptyLists = structuredClone(base);
  for (const key of ["Binds", "VolumesFrom", "CapAdd", "Dns", "ExtraHosts", "GroupAdd", "Links", "DeviceCgroupRules", "DeviceRequests"]) emptyLists.HostConfig[key] = [];
  assert.doesNotThrow(() => verify(emptyLists));
  const emptyCmd = structuredClone(base); emptyCmd.Config.Cmd = [];
  assert.doesNotThrow(() => verify(emptyCmd));
  const variants: [string, (v: any) => void][] = [
    ["port state only", v => { v.NetworkSettings.Ports = { "8081/tcp": [{ HostIp: "::", HostPort: "8081" }] }; }],
    ["port declaration only", v => { v.HostConfig.PortBindings = { "8081/tcp": [{ HostIp: "127.0.0.1", HostPort: "8081" }] }; }],
    ["missing ports", v => { delete v.NetworkSettings.Ports; }],
    ["host IPC", v => { v.HostConfig.IpcMode = "host"; }],
    ["shared IPC", v => { v.HostConfig.IpcMode = "container:other"; }],
    ["shared PID", v => { v.HostConfig.PidMode = "container:other"; }],
    ["host UTS", v => { v.HostConfig.UTSMode = "host"; }],
    ["host user namespace", v => { v.HostConfig.UsernsMode = "host"; }],
    ["host cgroup namespace", v => { v.HostConfig.CgroupnsMode = "host"; }],
    ["privileged", v => { v.HostConfig.Privileged = true; }],
    ["weakened mask", v => { v.HostConfig.MaskedPaths = []; }],
    ["weakened readonly paths", v => { v.HostConfig.ReadonlyPaths = []; }],
    ["seccomp drift", v => { v.HostConfig.SecurityOpt.push("seccomp=unconfined"); }],
    ["host bind", v => { v.HostConfig.Binds = ["/:/host"]; }],
    ["host mount", v => { v.Mounts = [{ Type: "bind", Source: "/", Destination: "/host" }]; }],
    ["tmpfs mount substitution", v => { v.Mounts = [{ Type: "tmpfs", Source: "/", Destination: "/tmp" }]; }],
    ["extra host access", v => { v.HostConfig.ExtraHosts = ["host.docker.internal:host-gateway"]; }],
    ["entrypoint", v => { v.Config.Entrypoint = ["/bin/sh"]; }],
    ["command", v => { v.Config.Cmd = ["arbitrary"]; }],
    ["missing command", v => { delete v.Config.Cmd; }],
    ["args", v => { v.Args = ["arbitrary"]; }],
    ["volume", v => { v.Config.Volumes = { "/host": {} }; }],
    ["working directory", v => { v.Config.WorkingDir = "/host"; }],
    ["healthcheck", v => { v.Config.Healthcheck = { Test: ["CMD", "/bin/sh"] }; }],
    ["exposed port", v => { v.Config.ExposedPorts = { "8081/tcp": {} }; }],
    ["interactive", v => { v.Config.OpenStdin = true; }],
  ];
  for (const [label, mutate] of variants) { const value = structuredClone(base); mutate(value); assert.throws(() => verify(value), Error, label); }
  assert.throws(() => verify([base, base]), /nonunique/);
});

test("IPv6 endpoint defaults are explicit and missing, malformed or unknown representations reject", () => {
  const defaults = ipv4EndpointFixture();
  assert.doesNotThrow(() => validateIpv4OnlyEndpoint(defaults));
  for (const key of Object.keys(defaults)) {
    const missing = structuredClone(defaults); delete missing[key];
    assert.throws(() => validateIpv4OnlyEndpoint(missing), /IPv4-only/, "missing " + key);
    for (const value of [undefined, {}, [], false, "unknown", "0", null, 1, -1, "2001:db8::1", "::"]) {
      if (value === defaults[key]) continue;
      assert.throws(() => validateIpv4OnlyEndpoint({ ...defaults, [key]: value }), /IPv4-only/, key + ":" + JSON.stringify(value));
    }
  }
  for (const key of ["IPv6Address", "LinkLocalIPv6Address", "LinkLocalIPv6PrefixLen", "IPv6Enabled", "LinkLocalIPs"])
    for (const value of ["", 0, false, null, []])
      assert.throws(() => validateIpv4OnlyEndpoint({ ...defaults, [key]: value }), /IPv4-only/, "unknown " + key);
  for (const override of [{ IPv6Address: "2001:db8::1" }, { IPv6Address: "" }, { LinkLocalIPs: ["fe80::1"] }])
    assert.throws(() => validateIpv4OnlyEndpoint({ ...defaults, IPAMConfig: override }), /IPv4-only/);
});

test("IPv6 network-member evidence must be an explicit empty address", () => {
  const expected = { name: "internal", network: "internal", subnet: "10.254.1.0/28", sidecars: ["gateway", "forwarder"] };
  const base: any = { Name: "internal", Driver: "bridge", Internal: true, EnableIPv6: false, IPAM: { Config: [{ Subnet: expected.subnet }] }, Containers: {
    gateway: { Name: "gateway", IPv4Address: "10.254.1.2/28", IPv6Address: "" },
    forwarder: { Name: "forwarder", IPv4Address: "10.254.1.3/28", IPv6Address: "" },
  } };
  assert.doesNotThrow(() => parseMethodologyEgressNetworkInspect(JSON.stringify(base), expected));
  for (const name of expected.sidecars) for (const address of [undefined, null, false, 0, [], {}, "2001:db8::1"]) {
    const value = structuredClone(base); value.Containers[name].IPv6Address = address;
    assert.throws(() => parseMethodologyEgressNetworkInspect(JSON.stringify(value), expected), /IPv4-only/);
  }
});
