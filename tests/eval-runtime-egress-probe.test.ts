import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import test from "node:test";
// @ts-expect-error The runtime gateway is an intentionally declaration-free ESM fixture.
import { createAudit } from "../container/eval-runtime/egress-gateway.mjs";
// @ts-expect-error The probe fixture is an intentionally declaration-free ESM module.
import { connectionWasBlocked } from "../scripts/eval-egress-probe-fixture.mjs";
import {
  buildEgressProbeAbsenceArgs,
  buildEgressProbeContainerArgs,
  buildEgressProbeImageAbsenceArgs,
  buildEgressProbeImageRemoveArgs,
  buildEgressProbeNetworkConnectArgs,
  buildEgressProbeNetworkCreateArgs,
  buildEgressProbeNetworkInspectArgs,
  buildEgressProbeNetworkAliasInspectArgs,
  buildEgressProbeRemoveArgs,
  buildEgressProbeStopArgs,
  parseEgressProbeContainerArgs,
  parseEgressProbeContainerInspect,
  parseEgressProbeCliArgs,
  parseEgressProbeForwarderAudit,
  parseEgressProbeGatewayAudit,
  parseEgressProbeNetworkConnectArgs,
  parseEgressProbeNetworkInspect,
  parseEgressProbeNetworkAliases,
  parseEgressProbeNetworkCreateArgs,
  parseEgressProbeFixtureAuditLine,
  VERIFIER_FIXTURE_SHA256,
  VERIFIER_IMAGE,
  runEgressProbe,
  assertEgressProbeSourceWitness,
  validateEgressProbeDockerArgs,
  type ProbeRuntime,
} from "../scripts/run-eval-egress-probe.js";

test("egress Docker argv is exact and rejects isolation/network mutations", () => {
  assert.match(VERIFIER_FIXTURE_SHA256, /^[a-f0-9]{64}$/u);
  const network = buildEgressProbeNetworkCreateArgs("reviewer-test");
  assert.deepEqual(network, ["network", "create", "--internal", "--ipv6=false", "--driver", "bridge", "reviewer-test"]);
  assert.deepEqual(parseEgressProbeNetworkCreateArgs(network), { name: "reviewer-test" });
  const ipv6Enabled = [...network]; ipv6Enabled[3] = "--ipv6";
  assert.throws(() => parseEgressProbeNetworkCreateArgs(ipv6Enabled), /network create/);
  assert.deepEqual(parseEgressProbeNetworkCreateArgs(buildEgressProbeNetworkCreateArgs("external-test", "8.8.8.0/24")), { name: "external-test", subnet: "8.8.8.0/24" });
  assert.deepEqual(parseEgressProbeNetworkConnectArgs(buildEgressProbeNetworkConnectArgs("reviewer-test", "gateway-test", "egress-gateway")), { network: "reviewer-test", container: "gateway-test", alias: "egress-gateway" });
  assert.doesNotThrow(() => validateEgressProbeDockerArgs(buildEgressProbeNetworkCreateArgs("reviewer-test")));
  assert.doesNotThrow(() => validateEgressProbeDockerArgs(buildEgressProbeNetworkConnectArgs("reviewer-test", "gateway-test", "egress-gateway")));
  const args = buildEgressProbeContainerArgs({ role: "gateway", image: "candidate:pr", name: "gateway-test", network: "external-test", alias: "egress-gateway" });
  assert.deepEqual(parseEgressProbeContainerArgs(args), { name: "gateway-test", network: "external-test", alias: "egress-gateway", image: "candidate:pr", role: "gateway" });
  assert.deepEqual(args.slice(-3), ["--entrypoint", "/usr/local/bin/peregrine-egress-gateway", "candidate:pr"]);
  const missingEntrypoint = [...args]; missingEntrypoint.splice(missingEntrypoint.indexOf("--entrypoint"), 2);
  assert.throws(() => parseEgressProbeContainerArgs(missingEntrypoint), /fixture command|invalid container/);
  const forwarder = buildEgressProbeContainerArgs({ role: "forwarder", image: "candidate:pr", name: "forwarder-test", network: "external-test", alias: "mcp-forwarder", token: "b".repeat(64) });
  assert.deepEqual(parseEgressProbeContainerArgs(forwarder), { name: "forwarder-test", network: "external-test", alias: "mcp-forwarder", image: "candidate:pr", role: "forwarder" });
  assert.deepEqual(forwarder.slice(-3), ["--entrypoint", "/usr/local/bin/peregrine-methodology-mcp-forwarder", "candidate:pr"]);
  const alteredEntrypoint = [...args]; alteredEntrypoint[alteredEntrypoint.indexOf("--entrypoint") + 1] = "peregrine-egress-gateway";
  assert.throws(() => parseEgressProbeContainerArgs(alteredEntrypoint), /entrypoint/);
  const sidecarCommand = [...args, "--debug"];
  assert.throws(() => parseEgressProbeContainerArgs(sidecarCommand), /command arguments|container/);
  const fixturePath = resolve("scripts/eval-egress-probe-fixture.mjs");
  const challenge = "a".repeat(64);
  const provider = buildEgressProbeContainerArgs({ role: "provider", image: VERIFIER_IMAGE, name: "provider-test", network: "external-test", alias: "fake-provider.invalid", fixturePath, challenge });
  assert.deepEqual(parseEgressProbeContainerArgs(provider), { name: "provider-test", network: "external-test", alias: "fake-provider.invalid", image: VERIFIER_IMAGE, role: "provider" });
  assert.throws(() => buildEgressProbeContainerArgs({ role: "provider", image: "candidate:pr", name: "provider-test", network: "external-test", alias: "fake-provider.invalid", fixturePath }), /verifier/);
  assert.throws(() => buildEgressProbeContainerArgs({ role: "provider", image: VERIFIER_IMAGE, name: "provider-test", network: "external-test", alias: "fake-provider.invalid", fixturePath }), /challenge/);
  for (const mutate of [
    (copy: string[]) => { copy[copy.indexOf("--network") + 1] = "none"; },
    (copy: string[]) => { copy.splice(copy.indexOf("--read-only"), 1); },
    (copy: string[]) => { copy[copy.indexOf("ALL")] = "NET_ADMIN"; },
    (copy: string[]) => { copy[copy.indexOf("128")] = "64"; },
    (copy: string[]) => { copy[copy.indexOf("EGRESS_ALLOWED_AUTHORITIES=fake-provider.invalid:443")] = "EGRESS_ALLOWED_AUTHORITIES=attacker.invalid:443"; },
    (copy: string[]) => { copy.push("--volume", "/:/host"); },
  ]) {
    const copy = [...args];
    mutate(copy);
    assert.throws(() => parseEgressProbeContainerArgs(copy));
    assert.throws(() => validateEgressProbeDockerArgs(copy));
  }
  assert.throws(() => buildEgressProbeNetworkCreateArgs("bad", "192.168.0.0/24"));
  assert.throws(() => buildEgressProbeStopArgs(["bad/name"]));
  assert.throws(() => buildEgressProbeRemoveArgs([]));
  assert.deepEqual(buildEgressProbeAbsenceArgs("network", "external-test"), ["network", "inspect", "external-test"]);
  const digest = `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"a".repeat(64)}`;
  assert.deepEqual(parseEgressProbeCliArgs(["--image", digest, "--platform", "linux/arm64"]), { image: digest, platform: "linux/arm64" });
  assert.deepEqual(buildEgressProbeImageRemoveArgs(digest, "linux/arm64"), ["image", "rm", "--force", digest]);
  assert.deepEqual(buildEgressProbeImageAbsenceArgs(digest), ["image", "inspect", digest]);
  assert.throws(() => parseEgressProbeCliArgs(["--image", "candidate:pr", "--platform", "linux/arm64"]), /immutable image digest/);
  assert.throws(() => parseEgressProbeCliArgs(["--image", "candidate:pr", "--image", "other:pr"]), /repeated/);
});

test("network inspect proves the fixed internal topology and rejects mutations", () => {
  const names = { reviewerNetwork: "reviewer-net", externalNetwork: "external-net", provider: "provider", mcp: "mcp", gateway: "gateway", forwarder: "forwarder", reviewer: "reviewer" };
  assert.deepEqual(buildEgressProbeNetworkInspectArgs(names.reviewerNetwork, names.externalNetwork), ["network", "inspect", "reviewer-net", "external-net"]);
  const endpoint = (name: string, ip = "172.20.0.2", prefix = 24) => ({ Name: name, EndpointID: `endpoint-${name}`, MacAddress: "02:42:ac:14:00:02", IPv4Address: `${ip}/${prefix}`, IPv6Address: "" });
  const topology = [
    { Name: names.reviewerNetwork, Driver: "bridge", Internal: true, EnableIPv6: false, IPAM: { Config: [{ Subnet: "172.20.0.0/16" }] }, Containers: { a: endpoint(names.gateway, "172.20.0.2", 16), b: endpoint(names.forwarder, "172.20.0.3", 16), c: endpoint(names.reviewer, "172.20.0.4", 16) } },
    { Name: names.externalNetwork, Driver: "bridge", Internal: true, EnableIPv6: false, IPAM: { Config: [{ Subnet: "8.8.8.0/24" }] }, Containers: { d: endpoint(names.provider, "8.8.8.2"), e: endpoint(names.mcp, "8.8.8.3"), f: endpoint(names.gateway, "8.8.8.4"), g: endpoint(names.forwarder, "8.8.8.5") } },
  ];
  const aliases = [
    { Name: `/${names.provider}`, NetworkSettings: { Networks: { [names.externalNetwork]: { Aliases: ["fake-provider.invalid"] } } } },
    { Name: `/${names.mcp}`, NetworkSettings: { Networks: { [names.externalNetwork]: { Aliases: ["fake-mcp", "host.docker.internal"] } } } },
    { Name: `/${names.gateway}`, NetworkSettings: { Networks: { [names.externalNetwork]: { Aliases: ["egress-gateway"] }, [names.reviewerNetwork]: { Aliases: ["egress-gateway"] } } } },
    { Name: `/${names.forwarder}`, NetworkSettings: { Networks: { [names.externalNetwork]: { Aliases: ["mcp-forwarder"] }, [names.reviewerNetwork]: { Aliases: ["mcp-forwarder"] } } } },
    { Name: `/${names.reviewer}`, NetworkSettings: { Networks: { [names.reviewerNetwork]: { Aliases: ["reviewer"] } } } },
  ];
  assert.deepEqual(buildEgressProbeNetworkAliasInspectArgs(names), ["container", "inspect", "provider", "mcp", "gateway", "forwarder", "reviewer"]);
  parseEgressProbeNetworkAliases(aliases, names);
  for (const mutate of [
    (copy: typeof aliases) => { copy[0]!.NetworkSettings.Networks[names.externalNetwork]!.Aliases = [names.provider]; },
    (copy: typeof aliases) => { copy[4]!.NetworkSettings.Networks[names.reviewerNetwork]!.Aliases = [names.reviewer, "unexpected"]; },
  ]) {
    const copy = structuredClone(aliases);
    mutate(copy);
    assert.throws(() => parseEgressProbeNetworkAliases(copy, names));
  }
  assert.deepEqual(parseEgressProbeNetworkInspect(topology, names), { gateway: "8.8.8.4", forwarder: "8.8.8.5" });
  for (const mutate of [
    (copy: typeof topology) => { copy[0]!.Internal = false; },
    (copy: typeof topology) => { (copy[1]!.Containers as unknown as Record<string, ReturnType<typeof endpoint>>).reviewer = endpoint(names.reviewer); },
    (copy: typeof topology) => { copy[1]!.Containers.d = endpoint(names.provider, "8.8.8.4"); },
    (copy: typeof topology) => { copy[1]!.Driver = "host"; },
    (copy: typeof topology) => { copy[0]!.EnableIPv6 = true; },
    (copy: typeof topology) => { copy[1]!.IPAM.Config.push({ Subnet: "192.0.2.0/24" }); },
    (copy: typeof topology) => { (copy[1]!.IPAM.Config[0] as Record<string, string>).IPv6Subnet = "2001:db8::/64"; },
    (copy: typeof topology) => { copy[1]!.Containers.d!.IPv6Address = "2001:db8::2/64"; },
    (copy: typeof topology) => { copy[1]!.IPAM.Config[0]!.Subnet = "8.8.9.0/24"; },
    (copy: typeof topology) => { copy[0]!.IPAM.Config[0]!.Subnet = "8.8.8.0/25"; },
    (copy: typeof topology) => { copy[1]!.Containers.f = endpoint(names.gateway, "10.0.0.4"); },
    (copy: typeof topology) => { delete copy[1]!.Containers.e; },
  ]) {
    const copy = structuredClone(topology);
    mutate(copy);
    assert.throws(() => parseEgressProbeNetworkInspect(copy, names));
  }
  const wrongSource = structuredClone(topology);
  wrongSource[1]!.Containers.f = endpoint(names.gateway, "8.8.8.6");
  assert.deepEqual(parseEgressProbeNetworkInspect(wrongSource, names), { gateway: "8.8.8.6", forwarder: "8.8.8.5" });
  assert.doesNotThrow(() => assertEgressProbeSourceWitness(["8.8.8.4"], "8.8.8.4", "provider"));
  assert.throws(() => assertEgressProbeSourceWitness(["8.8.8.6"], "8.8.8.4", "provider"), /source endpoint/);
  assert.throws(() => buildEgressProbeNetworkInspectArgs("same", "same"));
});

test("runner-owned fixture oracle authenticates the exact fixed protocol", () => {
  const audit = { mcpViaSourceRead: true, wrongTokenDenied: true, gatewayProviderReached: true, mismatchedSniDenied: true, directProviderFailed: true, directMcpFailed: true, directProviderIpFailed: true, directMcpIpFailed: true };
  const body = { status: "sealed", schemaVersion: 1, protocol: "eval-egress-fixture-v1", sealed: true, role: "reviewer", audit };
  const sha256 = createHash("sha256").update("eval-egress-fixture-v1\0").update(JSON.stringify(body)).digest("hex");
  const line = JSON.stringify({ ...body, sha256 });
  assert.deepEqual(parseEgressProbeFixtureAuditLine(line, "reviewer").audit, audit);
  assert.throws(() => parseEgressProbeFixtureAuditLine(JSON.stringify({ ...body, sha256: "0".repeat(64) }), "reviewer"), /digest/);
  const missing = { ...audit } as Record<string, unknown>;
  delete missing.directMcpIpFailed;
  const missingBody = { ...body, audit: missing };
  const missingDigest = createHash("sha256").update("eval-egress-fixture-v1\0").update(JSON.stringify(missingBody)).digest("hex");
  assert.throws(() => parseEgressProbeFixtureAuditLine(JSON.stringify({ ...missingBody, sha256: missingDigest }), "reviewer"), /shape/);
});

test("runner-owned sidecar oracles reject authenticated snapshot mutations", () => {
  const gateway = createAudit();
  gateway.record({ kind: "connect", decision: "allow", reason: "connected", authority: "fake-provider.invalid:443" });
  const gatewaySnapshot = gateway.seal();
  assert.equal(parseEgressProbeGatewayAudit(gatewaySnapshot).events[0]?.reason, "connected");
  const alteredGateway = structuredClone(gatewaySnapshot);
  alteredGateway.events[0]!.reason = "forged";
  assert.throws(() => parseEgressProbeGatewayAudit(alteredGateway), /digest/);
  const forwarderBody = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 1, allowed: 1, denied: 0, forwarded: 1, budgeted: 1 }, events: [{ sequence: 1, decision: "allow", code: "forwarded" }] };
  const snapshotSha256 = createHash("sha256").update("methodology-mcp-forwarder-audit-v1\0").update(JSON.stringify(forwarderBody)).digest("hex");
  const forwarderSnapshot = { ...forwarderBody, snapshotSha256 };
  assert.equal(parseEgressProbeForwarderAudit(forwarderSnapshot).requests.observed, 1);
  const alteredForwarder = structuredClone(forwarderSnapshot);
  alteredForwarder.requests.observed = 2;
  assert.throws(() => parseEgressProbeForwarderAudit(alteredForwarder), /digest|inconsistent/);
});

test("egress probe CLI rejects missing arguments instead of becoming a no-op", () => {
  const result = spawnSync(process.execPath, ["--import", "tsx", resolve("scripts/run-eval-egress-probe.ts")], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /--image is required/);
});

test("direct-route checks remain bounded connectivity diagnostics", async (t) => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  assert.equal(await connectionWasBlocked("127.0.0.1", address.port), false);
});

test("sidecar inspect validation rejects mounts and provider credentials", () => {
  const gatewayPath = "/usr/local/bin/peregrine-egress-gateway";
  const forwarderPath = "/usr/local/bin/peregrine-methodology-mcp-forwarder";
  parseEgressProbeContainerInspect([
    { Name: "/gateway-test", Path: gatewayPath, Args: [], Mounts: [], Config: { Entrypoint: [gatewayPath], Env: ["NODE_ENV=production"] } },
    { Name: "/forwarder-test", Path: forwarderPath, Args: [], Mounts: [], Config: { Entrypoint: [forwarderPath], Env: ["NODE_ENV=production", "MCP_FORWARDER_TOKEN=abc"] } },
  ], ["gateway-test", "forwarder-test"]);
  assert.throws(() => parseEgressProbeContainerInspect([{ Name: "/gateway-test", Path: "peregrine-egress-gateway", Args: [], Mounts: [], Config: { Entrypoint: [gatewayPath], Env: [] } }], ["gateway-test"]), /entrypoint/);
  assert.throws(() => parseEgressProbeContainerInspect([{ Name: "/gateway-test", Path: gatewayPath, Args: ["--debug"], Mounts: [], Config: { Entrypoint: [gatewayPath], Env: [] } }], ["gateway-test"]), /entrypoint/);
  assert.throws(() => parseEgressProbeContainerInspect([{ Name: "/gateway-test", Path: gatewayPath, Args: [], Mounts: [], Config: { Entrypoint: [gatewayPath, "--debug"], Env: [] } }], ["gateway-test"]), /entrypoint/);
  assert.throws(() => parseEgressProbeContainerInspect([{ Name: "/gateway-test", Path: gatewayPath, Args: [], Mounts: [{}], Config: { Entrypoint: [gatewayPath], Env: [] } }], ["gateway-test"]), /mount/);
  for (const credential of ["AWS_SESSION_TOKEN=x", "GOOGLE_APPLICATION_CREDENTIALS=/tmp/key.json", "HF_TOKEN=x", "OPENAI_API_KEY=secret"]) {
    assert.throws(() => parseEgressProbeContainerInspect([{ Name: "/gateway-test", Path: gatewayPath, Args: [], Mounts: [], Config: { Entrypoint: [gatewayPath], Env: [credential] } }], ["gateway-test"]), /credential/);
  }
});

test("full egress proof runs against an injected fake runtime only", () => {
  const audit = createAudit();
  // Candidate audit records are deliberately decoys: they remain authenticated
  // format diagnostics, but cannot make or break the verifier proof.
  audit.record({ kind: "connect", decision: "deny", reason: "connection-failed", authority: "fake-provider:443" });
  const gatewayAudit = audit.seal();
  const forwarderBody = { schemaVersion: 1, protocol: "methodology-mcp-forwarder-audit-v1", sealed: true, requests: { observed: 1, allowed: 0, denied: 1, forwarded: 0, budgeted: 1 }, events: [{ sequence: 1, decision: "deny", code: "upstream-failure" }] };
  const forwarderDigest = createHash("sha256").update("methodology-mcp-forwarder-audit-v1\0").update(JSON.stringify(forwarderBody)).digest("hex");
  const fixtureLine = (role: string, value: unknown) => {
    const body = { status: "sealed", schemaVersion: 1, protocol: "eval-egress-fixture-v1", sealed: true, role, audit: value };
    const sha256 = createHash("sha256").update("eval-egress-fixture-v1\0").update(JSON.stringify(body)).digest("hex");
    return `${JSON.stringify({ ...body, sha256 })}\n`;
  };
  const logs = new Map<string, string>();
  const commands: string[][] = [];
  let reviewerName: string | undefined;
  let reviewerAlive = false;
  const endpoint = (name: string, ip = "172.20.0.2", prefix = 24) => ({ Name: name, EndpointID: `endpoint-${name}`, MacAddress: "02:42:ac:14:00:02", IPv4Address: `${ip}/${prefix}`, IPv6Address: "" });
  const networkInspect = (reviewerNetwork: string, externalNetwork: string, provider: string, mcp: string, gateway: string, forwarder: string, reviewer: string) => JSON.stringify([
    { Name: reviewerNetwork, Driver: "bridge", Internal: true, EnableIPv6: false, IPAM: { Config: [{ Subnet: "172.20.0.0/16" }] }, Containers: { a: endpoint(gateway, "172.20.0.2", 16), b: endpoint(forwarder, "172.20.0.3", 16), c: endpoint(reviewer, "172.20.0.4", 16) } },
    { Name: externalNetwork, Driver: "bridge", Internal: true, EnableIPv6: false, IPAM: { Config: [{ Subnet: "8.8.8.0/24" }] }, Containers: { d: endpoint(provider, "8.8.8.2"), e: endpoint(mcp, "8.8.8.3"), f: endpoint(gateway, "8.8.8.4"), g: endpoint(forwarder, "8.8.8.5") } },
  ]);
  const fake: ProbeRuntime = {
    spawn(_command, args) {
      commands.push([...args]);
      if (args[0] === "run") {
        const name = args[args.indexOf("--name") + 1]!;
        const command = args.at(-1);
        if (args.includes("--reviewer")) { reviewerName = name; reviewerAlive = true; logs.set(name, fixtureLine("reviewer", { mcpViaSourceRead: true, wrongTokenDenied: true, gatewayProviderReached: true, mismatchedSniDenied: true, directProviderFailed: true, directMcpFailed: true, directProviderIpFailed: true, directMcpIpFailed: true })); }
        else if (args.includes("--provider")) {
          const challenge = args[args.indexOf("--expected-challenge") + 1]!;
          logs.set(name, JSON.stringify({ status: "ready", protocol: "eval-egress-fixture-v1", role: "provider" }) + "\n" + fixtureLine("provider", { connections: 1, hellos: 1, acceptedSni: ["fake-provider.invalid"], mismatchedSni: 0, acceptedChallenges: [challenge], unexpectedChallenges: 0, sourceAddresses: ["8.8.8.4"] }));
        }
        else if (args.includes("--mcp")) {
          const challenge = args[args.indexOf("--expected-challenge") + 1]!;
          logs.set(name, JSON.stringify({ status: "ready", protocol: "eval-egress-fixture-v1", role: "mcp" }) + "\n" + fixtureLine("mcp", { requests: 1, acceptedChallenges: [challenge], unexpectedChallenges: 0, sourceAddresses: ["8.8.8.5"] }));
        }
        else if (args.includes("/usr/local/bin/peregrine-egress-gateway")) logs.set(name, JSON.stringify({ status: "ready", protocol: "egress-gateway-v1" }) + "\n" + JSON.stringify({ status: "sealed", protocol: "egress-gateway-v1", audit: gatewayAudit }) + "\n");
        else logs.set(name, JSON.stringify({ status: "ready", protocol: "methodology-mcp-forwarder-v1" }) + "\n" + JSON.stringify({ status: "sealed", protocol: "methodology-mcp-forwarder-v1", audit: { ...forwarderBody, snapshotSha256: forwarderDigest } }) + "\n");
        return { status: 0, stdout: "container-id\n" };
      }
      if (args[0] === "logs") return { status: 0, stdout: logs.get(args[1]!) ?? "" };
      if (args[0] === "stop" && reviewerName !== undefined && args.includes(reviewerName)) reviewerAlive = false;
      if (args[0] === "network" && args[1] === "inspect" && args.length === 4) {
        if (!reviewerAlive) return { status: 1, stderr: "reviewer is no longer alive" };
        const reviewerNetwork = args[2]!;
        const externalNetwork = args[3]!;
        const latestRun = (predicate: (command: string[]) => boolean) => {
          const command = commands.filter((candidate) => candidate[0] === "run" && predicate(candidate)).at(-1)!;
          return command[command.indexOf("--name") + 1]!;
        };
        const reviewer = latestRun((command) => command.includes("--reviewer"));
        const provider = latestRun((command) => command.includes("--provider") && !command.includes("--reviewer"));
        const mcp = latestRun((command) => command.includes("--mcp") && !command.includes("--reviewer"));
        const gateway = latestRun((command) => command.includes("/usr/local/bin/peregrine-egress-gateway"));
        const forwarder = latestRun((command) => command.includes("/usr/local/bin/peregrine-methodology-mcp-forwarder"));
        return { status: 0, stdout: networkInspect(reviewerNetwork, externalNetwork, provider, mcp, gateway, forwarder, reviewer) };
      }
      if (args[0] === "network" && args[1] === "inspect") return { status: 1, stderr: "Error response from daemon: No such network" };
      if (args[0] === "container" && args[1] === "inspect" && args.length === 7) {
        const reviewerNetwork = commands.filter((command) => command[0] === "network" && command[1] === "create").at(-2)!.at(-1)!;
        const externalNetwork = commands.filter((command) => command[0] === "network" && command[1] === "create").at(-1)!.at(-1)!;
        const [provider, mcp, gateway, forwarder, reviewer] = args.slice(2);
        const endpointAliases = (name: string, networkNames: string[], aliases: string[][]) => ({ Name: `/${name}`, NetworkSettings: { Networks: Object.fromEntries(networkNames.map((network, index) => [network, { Aliases: aliases[index] }])) } });
        return { status: 0, stdout: JSON.stringify([
          endpointAliases(provider!, [externalNetwork], [["fake-provider.invalid"]]),
          endpointAliases(mcp!, [externalNetwork], [["fake-mcp", "host.docker.internal"]]),
          endpointAliases(gateway!, [externalNetwork, reviewerNetwork], [["egress-gateway"], ["egress-gateway"]]),
          endpointAliases(forwarder!, [externalNetwork, reviewerNetwork], [["mcp-forwarder"], ["mcp-forwarder"]]),
          endpointAliases(reviewer!, [reviewerNetwork], [["reviewer"]]),
        ]) };
      }
      if (args[0] === "container" && args[1] === "inspect" && args.length === 4) return { status: 0, stdout: JSON.stringify([
        { Name: `/${args[2]}`, Path: "/usr/local/bin/peregrine-egress-gateway", Args: [], Mounts: [], Config: { Entrypoint: ["/usr/local/bin/peregrine-egress-gateway"], Env: ["NODE_ENV=production"] } },
        { Name: `/${args[3]}`, Path: "/usr/local/bin/peregrine-methodology-mcp-forwarder", Args: [], Mounts: [], Config: { Entrypoint: ["/usr/local/bin/peregrine-methodology-mcp-forwarder"], Env: ["NODE_ENV=production", "MCP_FORWARDER_TOKEN=abc"] } },
      ]) };
      if (args[0] === "container" && args[1] === "inspect") return { status: 1, stderr: "Error response from daemon: No such object" };
      if (args[0] === "image" && args[1] === "inspect") return { status: 1, stderr: "Error response from daemon: No such image" };
      return { status: 0 };
    },
  };
  runEgressProbe("candidate:pr", undefined, fake, resolve("scripts/eval-egress-probe-fixture.mjs"));
  const digest = `ghcr.io/petergraycreative/peregrine-eval-runtime@sha256:${"b".repeat(64)}`;
  runEgressProbe(digest, "linux/amd64", fake, resolve("scripts/eval-egress-probe-fixture.mjs"));
  assert.ok(commands.some((args) => JSON.stringify(args) === JSON.stringify(["image", "rm", "--force", digest])));
  assert.ok(commands.some((args) => JSON.stringify(args) === JSON.stringify(["image", "inspect", digest])));
  assert.ok(commands.some((args) => args[0] === "network" && args[1] === "inspect"));
  const topologyIndex = commands.findIndex((args) => args[0] === "network" && args[1] === "inspect");
  const reviewerStopIndex = commands.findIndex((args) => args[0] === "stop" && reviewerName !== undefined && args.includes(reviewerName));
  assert.ok(topologyIndex >= 0 && reviewerStopIndex > topologyIndex, "topology must be inspected while reviewer is alive");
  assert.ok(commands.some((args) => args[0] === "run" && args.includes("--provider") && args[args.indexOf("--name") + 1] && args.includes(VERIFIER_IMAGE)));
  assert.ok(commands.some((args) => args[0] === "run" && args.includes("--reviewer") && args.includes(VERIFIER_IMAGE)));
  assert.ok(commands.filter((args) => args[0] === "image" && args[1] === "rm").some((args) => args.at(-1) === VERIFIER_IMAGE));
});
