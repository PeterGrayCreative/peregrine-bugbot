import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { ExecResult } from "../src/util/exec.js";
import {
  ACCEPTED_METHODOLOGY_EGRESS_IMAGE,
  createMethodologyEgressSupervisor,
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
      const name = args[args.length - 1]!;
      if (stopped && name === gateway) { const body = { schemaVersion: 1, protocol: "egress-gateway-audit-v1", events: [] }; return result(JSON.stringify({ status: "sealed", protocol: "egress-gateway-v1", audit: { ...body, sealed: true, sha256: digest("egress-gateway-audit-v1", body) } })); }
      if (stopped && name === forwarder) { const body = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 0, allowed: 0, denied: 0, forwarded: 0, budgeted: 0 }, events: [] }; return result(JSON.stringify({ status: "sealed", protocol: "methodology-mcp-forwarder-v1", audit: { ...body, snapshotSha256: digest("methodology-mcp-forwarder-audit-v1", body) } })); }
      if (name.includes("gateway")) return result(JSON.stringify({ status: "ready", protocol: "egress-gateway-v1", ready: true }) + "\n");
      if (name.includes("forwarder")) return result(JSON.stringify({ status: "ready", protocol: "methodology-mcp-forwarder-v1", ready: true }) + "\n");
      return result();
    }
    if (args[0] === "inspect" && args[1] !== undefined) return result(JSON.stringify([
      ...[args[1]!, args[2]!].map((name) => ({ Name: `/${name}`, Path: name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder", Args: [], State: { Running: true }, Mounts: [{ Type: "tmpfs", Destination: "/tmp" }, { Type: "tmpfs", Destination: "/home/peregrine" }], Config: { Image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, Entrypoint: [name === gateway ? "/usr/local/bin/peregrine-egress-gateway" : "/usr/local/bin/peregrine-methodology-mcp-forwarder"], Env: sidecarEnvs.get(name) }, HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], PidsLimit: 64, User: "65532:65532", Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777", "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700" }, ExtraHosts: name === gateway ? [] : ["host.docker.internal:host-gateway"] }, NetworkSettings: { Networks: { [externalNetwork]: { Aliases: [name], IPAddress: `${externalSubnet.replace(".0/28", name === gateway ? ".2" : ".3")}` }, [network]: { Aliases: [name === gateway ? "egress-gateway" : "mcp-forwarder", name], IPAddress: `${subnet.replace(".0/28", name === gateway ? ".2" : ".3")}` } } } }))
    ]));
    if (args[0] === "network" && args[1] === "inspect") { const target = args[2]!; const isInternal = target === network; const selectedSubnet = isInternal ? subnet : externalSubnet; return result(JSON.stringify([{ Name: target, Driver: "bridge", Internal: isInternal, EnableIPv6: false, IPAM: { Config: [{ Subnet: selectedSubnet }] }, Containers: { a: { Name: `/${gateway}`, IPv4Address: `${selectedSubnet.replace(".0/28", ".2")}/28`, IPv6Address: "" }, b: { Name: `/${forwarder}`, IPv4Address: `${selectedSubnet.replace(".0/28", ".3")}/28`, IPv6Address: "" } } }])); }
    if (args[0] === "stop") { stopped = true; return result(); }
    return result();
  };
  const supervisor = await createStructuralMockMethodologyEgressSupervisor({ attemptId: "attempt-000001", armId: "A", sourceHeadTree: "a".repeat(40), providerAuthorities: ["api.openai.com:443"], hostMcpPort: 43123, mcpLimits: limits, run });
  assert.match(supervisor.internalMcpUrl, /^http:\/\/mcp-forwarder:8082\/mcp\/[a-f0-9]{64}$/u);
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

test("container inspect parser rejects environment additions, duplicates, stopped sidecars, and out-of-subnet endpoints", () => {
  const expected = { name: "gateway", network: "internal", externalNetwork: "external", subnet: "10.254.1.0/28", externalSubnet: "10.254.2.0/28", image: ACCEPTED_METHODOLOGY_EGRESS_IMAGE, entrypoint: "/usr/local/bin/peregrine-egress-gateway", alias: "egress-gateway", env: { EGRESS_ALLOWED_AUTHORITIES: "api.openai.com:443" } };
  const base = {
    Name: "/gateway", Path: expected.entrypoint, Args: [], State: { Running: true }, Mounts: [{ Type: "tmpfs", Destination: "/tmp" }, { Type: "tmpfs", Destination: "/home/peregrine" }],
    Config: { Image: expected.image, Entrypoint: [expected.entrypoint], Env: [...METHODOLOGY_EGRESS_BASE_ENV, "EGRESS_ALLOWED_AUTHORITIES=api.openai.com:443"] },
    HostConfig: { ReadonlyRootfs: true, CapDrop: ["ALL"], SecurityOpt: ["no-new-privileges"], PidsLimit: 64, User: "65532:65532", Tmpfs: { "/tmp": "rw,noexec,nosuid,nodev,size=32m,uid=65532,gid=65532,mode=1777", "/home/peregrine": "rw,noexec,nosuid,nodev,size=16m,uid=65532,gid=65532,mode=0700" }, ExtraHosts: [] },
    NetworkSettings: { Networks: { external: { Aliases: ["gateway"], IPAddress: "10.254.2.2" }, internal: { Aliases: ["egress-gateway", "gateway"], IPAddress: "10.254.1.2" } } },
  };
  assert.doesNotThrow(() => parseMethodologyEgressContainerInspect(JSON.stringify(base), expected));
  const added = structuredClone(base); added.Config.Env.push("EXTRA=value");
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(added), expected), /environment/);
  const duplicate = structuredClone(base); duplicate.Config.Env.push("EGRESS_ALLOWED_AUTHORITIES=api.openai.com:443");
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(duplicate), expected), /environment/);
  const stopped = structuredClone(base); stopped.State.Running = false;
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(stopped), expected), /running/);
  const outside = structuredClone(base); outside.NetworkSettings.Networks.internal.IPAddress = "10.254.9.2";
  assert.throws(() => parseMethodologyEgressContainerInspect(JSON.stringify(outside), expected), /IPv4/);
});
