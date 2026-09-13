import { array, digest, exact, hash, integer, same, sha, text, unique } from "./prediction-contract.js";
import { isAbsolute, join, normalize } from "node:path";
import { renderContainedProviderArgs } from "./runtime-containment.js";
import { renderMethodologySidecarArgs, methodologyGatewayEnvironment, methodologyForwarderEnvironment, GATEWAY_ENTRYPOINT, FORWARDER_ENTRYPOINT,
  parseMethodologyEgressNetworkCreateArgs, parseMethodologyEgressExternalNetworkCreateArgs, parseMethodologyEgressContainerInspect, parseMethodologyEgressNetworkInspect } from "./methodology-egress.js";
import { PREDICTION_MCP_LIMITS } from "./prediction-runtime-attachment.js";
import { canonicalJsonSha256 } from "./experiment.js";

export const MECHANICAL_RECEIPT_PATH = /^canary\/mechanical-(client|sidecars)\/([0-9]{6})-(start|terminal|failure)\.json$/;
const fail = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

/** Offline validation of the actual independently inventoried receipt bytes.
 * Names, self-hashes or an observer assertion alone cannot replace these bytes. */
export function validateMechanicalReceipts(artifacts: { path: string; bytes: string }[], retained: any, scope: any, get: (path: string) => any, context: { directory: string; session: any }) {
  const receipts = artifacts.filter(a => MECHANICAL_RECEIPT_PATH.test(a.path));
  const listed = array(retained.inventory).filter((v: any) => typeof v.path === "string" && v.path.startsWith("canary/mechanical-")) as any[];
  fail(receipts.length > 0 && receipts.length <= 1000, "bounded actual mechanical receipts required");
  unique(listed.map(v => text(v.path))); unique(receipts.map(v => v.path));
  same(receipts.map(v => v.path).sort(), listed.map(v => v.path).sort(), "mechanical receipt bytes missing or substituted");
  let total = 0;
  for (const receipt of receipts) {
    const bytes = Buffer.byteLength(receipt.bytes); total += bytes;
    fail(bytes > 0 && bytes <= 16_777_216 && total <= 64_000_000, "mechanical receipt byte limit");
    same(listed.find(v => v.path === receipt.path), { path: receipt.path, bytes, sha256: sha(receipt.bytes) }, "mechanical receipt inventory byte/digest mismatch");
  }
  const channels = { client: [] as any[], sidecars: [] as any[] };
  for (const channel of ["client", "sidecars"] as const) {
    const selected = receipts.filter(v => MECHANICAL_RECEIPT_PATH.exec(v.path)![1] === channel);
    fail(selected.length >= 2 && selected.length % 2 === 0, "incomplete mechanical receipt pairs");
    for (let sequence = 1; sequence <= selected.length / 2; sequence++) {
      const prefix = `canary/mechanical-${channel}/${String(sequence).padStart(6, "0")}`;
      const startRaw = selected.find(v => v.path === prefix + "-start.json"), terminalRaw = selected.find(v => v.path === prefix + "-terminal.json");
      fail(startRaw && terminalRaw, "missing, duplicate, failed or noncontiguous mechanical disposition");
      const start = JSON.parse(startRaw!.bytes), terminal = JSON.parse(terminalRaw!.bytes);
      exact(start, ["kind", "binding", "sequence", "command", "args", "stdinSha256", "deadlineAttached", "aborted", "timeoutMs", "cleanup", "startedAt"], "mechanical start");
      exact(terminal, ["kind", "binding", "sequence", "result", "closedAt", "evidenceError"], "mechanical terminal");
      const binding = { runId: scope.runId, attemptId: scope.attemptId, scopeSha256: digest(scope), sourceSha256: scope.sourceSha256, channel };
      same([start.kind, terminal.kind, start.binding, terminal.binding, start.sequence, terminal.sequence, start.command, start.aborted, terminal.evidenceError],
        ["prediction-mechanical-start-v1", "prediction-mechanical-terminal-v1", binding, binding, sequence, sequence, "docker", false, null], "mechanical binding, completion or persistence failure");
      const args = array(start.args).map(text); fail(args.length > 0 && args.length <= 1000, "mechanical argv bound");
      fail(typeof start.deadlineAttached === "boolean" && typeof start.cleanup === "boolean" && Number.isFinite(start.timeoutMs) && start.timeoutMs > 0 && start.timeoutMs <= 1200000, "mechanical deadline metadata gap");
      if (start.stdinSha256 !== null) hash(start.stdinSha256);
      fail(integer(terminal.closedAt) >= integer(start.startedAt) && (!channels[channel].length || start.startedAt >= channels[channel].at(-1).terminal.closedAt), "mechanical ordering gap");
      const result = terminal.result;
      exact(result, ["stdout", "stderr", "code", "timedOut", "processId", ...(Object.hasOwn(result, "cleanupErrors") ? ["cleanupErrors"] : [])], "mechanical result");
      same([result.code, result.timedOut, result.cleanupErrors ?? []], [0, false, []], "mechanical execution or cleanup failed");
      fail(integer(result.processId) > 0, "mechanical child identity unavailable");
      const output = (value: any) => { exact(value, ["bytes", "complete", "sha256"], "mechanical captured stream"); fail(typeof value.bytes === "string" && Buffer.byteLength(value.bytes) <= 16_777_216, "mechanical stream bound");
        same([value.complete, value.sha256], [true, sha(value.bytes)], "mechanical stream truncated or substituted"); return value.bytes; };
      channels[channel].push({ start, terminal, args, result: { ...result, stdout: output(result.stdout), stderr: output(result.stderr) } });
    }
  }
  const invocation = get("canary/invocation.json"), execution = get("canary/execution.json"), lifecycle = get("observer/lifecycle.json"), egress = invocation.egress;
  const [client, removed, absent] = channels.client;
  fail(channels.client.length === 3, "exact one client execution and two cleanup receipts required");
  const session = exact(context.session, ["providerAccess", "directory", "identity", "credentialContentsRead"], "recorded session metadata");
  const recordedIdentity = exact(session.identity, ["uid", "gid"], "recorded host identity"), identity = { uid: integer(recordedIdentity.uid), gid: integer(recordedIdentity.gid) };
  fail(identity.uid > 0 && identity.gid >= 0, "invalid recorded host identity");
  for (const path of [context.directory, session.directory]) fail(typeof path === "string" && isAbsolute(path) && normalize(path) === path && path !== "/" && !/[,\r\n\0]/.test(path), "unsafe recorded host path");
  same([session.providerAccess, session.credentialContentsRead], ["cli-session", false], "unregistered session access");
  fail(/^peregrine-eval-[a-f0-9-]{36}$/.test(lifecycle.clientContainer), "invalid client container identity");
  const directory = join(context.directory, "canary");
  same(client.args, renderContainedProviderArgs({ runner: "codex", profile: "prediction-sol-low-canary", image: invocation.providerImage, containerName: lifecycle.clientContainer,
    identity, checkoutDir: join(directory, "workspace"), assetsDir: join(directory, "assets"), outputDir: join(directory, "output"),
    access: ["--mount", `type=bind,source=${join(text(session.directory), "auth.json")},target=/home/peregrine/.codex/auth.json,readonly`],
    command: "codex", commandArgs: invocation.args, methodologyEgress: { network: egress.network, proxyUrl: "http://egress-gateway:8081" } }), "complete client Docker invocation drift");
  same([client.start.stdinSha256, client.start.deadlineAttached, client.start.cleanup], [scope.promptSha256, true, false], "client prompt or deadline drift");
  same(client.result, execution, "mechanical client result differs from terminal evidence");
  same(client.result.processId, lifecycle.clientProcessId, "mechanical client process mismatch");
  const cleanup = (row: any, args: string[], empty = false) => { same(row.args, args, "mechanical cleanup resource mismatch");
    same([row.start.cleanup, row.start.deadlineAttached, row.start.stdinSha256], [true, false, null], "mechanical cleanup cancellation or input gap");
    if (empty) same(row.result.stdout.trim(), "", "mechanical absence query found resources"); };
  cleanup(removed, ["rm", "--force", lifecycle.clientContainer]);
  cleanup(absent, ["ps", "--all", "--quiet", "--filter", `name=^/${lifecycle.clientContainer}$`], true);
  const sidecars = channels.sidecars;
  const only = (predicate: (r: any) => boolean) => { const rows = sidecars.filter(predicate); fail(rows.length === 1, "mechanical sidecar operation missing or duplicated"); return rows[0]; };
  const named = [egress.gateway.name, egress.forwarder.name], networks = [egress.network, egress.externalNetwork];
  validateSidecarPreparation(sidecars.filter(r => !r.start.cleanup), invocation, client.start.startedAt);
  const teardown = sidecars.filter(r => r.start.cleanup), expectedTeardown = named.flatMap(name => [["stop", "--time", "15", name], ["logs", "--tail", "64", name], ["rm", "--force", name], ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`]])
    .concat([egress.externalNetwork, egress.network].flatMap(name => [["network", "rm", name], ["network", "ls", "--quiet", "--filter", `name=^${name}$`]]));
  same(teardown.map(r => r.args), expectedTeardown, "complete sidecar teardown command closure drift");
  for (const [index, name] of named.entries()) {
    const launched = only(r => r.args[0] === "run" && r.args[r.args.indexOf("--name") + 1] === name);
    fail(launched.terminal.closedAt <= client.start.startedAt, "client started before sidecar launch closed");
    const stopped = only(r => r.args[0] === "stop" && r.args.at(-1) === name), rm = only(r => r.args[0] === "rm" && r.args.at(-1) === name), ps = only(r => r.args[0] === "ps" && r.args.at(-1) === `name=^/${name}$`);
    cleanup(stopped, ["stop", "--time", "15", name]); cleanup(rm, ["rm", "--force", name]); cleanup(ps, ["ps", "--all", "--quiet", "--filter", `name=^/${name}$`], true);
    fail(stopped.start.startedAt >= client.terminal.closedAt && stopped.terminal.closedAt <= rm.start.startedAt && rm.terminal.closedAt <= ps.start.startedAt, "sidecar teardown ordering gap");
    const logs = only(r => r.args[0] === "logs" && r.args.at(-1) === name && r.start.cleanup);
    cleanup(logs, ["logs", "--tail", "64", name]); fail(logs.start.startedAt >= stopped.terminal.closedAt && logs.terminal.closedAt <= rm.start.startedAt, "sealed audit collection order gap");
    const sealed = logs.result.stdout.split("\n").flatMap((line: string) => { try { const v = JSON.parse(line); return v.status === "sealed" ? [v] : []; } catch { return []; } });
    fail(sealed.length === 1, "sealed mechanical sidecar audit missing or ambiguous");
    same(sealed[0].protocol, index === 0 ? "egress-gateway-v1" : "methodology-mcp-forwarder-v1", "sealed mechanical protocol mismatch");
    same(sealed[0].audit, get(index === 0 ? "observer/gateway-audit.json" : "observer/forwarder-audit.json"), "mechanical audit differs from authenticated observer bytes");
  }
  for (const name of networks) {
    only(r => r.args[0] === "network" && r.args[1] === "create" && r.args.at(-1) === name);
    const rm = only(r => r.args[0] === "network" && r.args[1] === "rm" && r.args.at(-1) === name), ls = only(r => r.args[0] === "network" && r.args[1] === "ls" && r.args.at(-1) === `name=^${name}$`);
    cleanup(rm, ["network", "rm", name]); cleanup(ls, ["network", "ls", "--quiet", "--filter", `name=^${name}$`], true);
    fail(rm.start.startedAt >= client.terminal.closedAt && ls.start.startedAt >= rm.terminal.closedAt, "network teardown ordering gap");
  }
}

function validateSidecarPreparation(rows: any[], invocation: any, clientStarted: number) {
  const e = invocation.egress, names = [e.gateway.name, e.forwarder.name], entrypoints = [GATEWAY_ENTRYPOINT, FORWARDER_ENTRYPOINT], aliases = ["egress-gateway", "mcp-forwarder"];
  unique([e.network, e.externalNetwork, ...names]); fail(e.networkSubnet !== e.externalNetworkSubnet, "overlapping registered sidecar networks");
  fail(/^peregrine-egress-[a-f0-9-]{36}$/.test(e.network) && /^peregrine-egress-gateway-000001-[a-f0-9-]{36}$/.test(names[0]), "unregistered sidecar resource names");
  same([e.externalNetwork, names[1]], [e.network.replace("peregrine-egress-", "peregrine-egress-x-"), names[0].replace("-gateway-", "-forwarder-")], "sidecar name pairing drift");
  same(e.providerAuthoritiesSha256, canonicalJsonSha256(e.providerAuthorities), "sidecar authority digest drift");
  const urlArg = array(invocation.args).map(text).find(v => v.startsWith("mcp_servers.source_read.url=")); fail(urlArg, "missing forwarder endpoint");
  const endpoint = JSON.parse(urlArg!.slice("mcp_servers.source_read.url=".length));
  fail(/^http:\/\/mcp-forwarder:8082\/mcp\/[a-f0-9]{64}$/.test(endpoint), "unregistered forwarder endpoint");
  fail(Number.isSafeInteger(e.hostMcpPort) && e.hostMcpPort > 0 && e.hostMcpPort <= 65535, "invalid host MCP port");
  const { maxSessions: _, ...transport } = PREDICTION_MCP_LIMITS, limits = { ...transport, maxHeaderBytes: 8192 };
  same(e.mcpLimitsSha256, canonicalJsonSha256(limits), "forwarder budget binding drift");
  const environments = [methodologyGatewayEnvironment(e.providerAuthorities), methodologyForwarderEnvironment(endpoint.slice(-64), e.hostMcpPort, limits)];
  for (const r of rows) same([r.start.stdinSha256, r.start.deadlineAttached, r.start.cleanup, r.terminal.closedAt <= clientStarted], [null, true, false, true], "sidecar preparation lifecycle gap");
  let cursor = 0;
  const take = (args: string[]) => { const row = rows[cursor++]; fail(row, "missing sidecar preparation receipt"); same(row.args, args, "complete sidecar preparation argv/order drift"); return row; };
  for (const [name, subnet, internal] of [[e.externalNetwork, e.externalNetworkSubnet, false], [e.network, e.networkSubnet, true]] as const) {
    const args = ["network", "create", ...(internal ? ["--internal"] : []), "--ipv6=false", "--driver", "bridge", "--subnet", subnet, name];
    same((internal ? parseMethodologyEgressNetworkCreateArgs : parseMethodologyEgressExternalNetworkCreateArgs)(take(args).args), { name, subnet, internal }, "network identity drift");
  }
  for (let i = 0; i < 2; i++) {
    same([e[i ? "forwarder" : "gateway"].entrypoint, e[i ? "forwarder" : "gateway"].alias], [entrypoints[i], aliases[i]], "sidecar identity drift");
    take(renderMethodologySidecarArgs(names[i], e.externalNetwork, invocation.providerImage, entrypoints[i]!, environments[i]!, i ? "host.docker.internal:host-gateway" : undefined));
  }
  for (let i = 0; i < 2; i++) {
    let last: any;
    while (rows[cursor]?.args[0] === "logs" && rows[cursor].args.at(-1) === names[i]) last = take(["logs", "--tail", "64", names[i]]);
    fail(last, "missing sidecar readiness receipt");
    const protocol = i ? "methodology-mcp-forwarder-v1" : "egress-gateway-v1";
    fail(last.result.stdout.split("\n").some((line: string) => { try { const v = JSON.parse(line); return v.status === "ready" && v.protocol === protocol && v.host === "0.0.0.0" && v.port === (i ? 8082 : 8081) && (i ? v.ready === true : v.ready === undefined); } catch { return false; } }), "sidecar readiness missing");
  }
  for (let i = 0; i < 2; i++) take(["network", "connect", "--alias", aliases[i]!, e.network, names[i]]);
  const inspected = JSON.parse(take(["inspect", ...names]).result.stdout); fail(Array.isArray(inspected) && inspected.length === 2, "sidecar inspect closure missing");
  for (let i = 0; i < 2; i++) {
    parseMethodologyEgressContainerInspect(JSON.stringify(inspected[i]), { name: names[i], network: e.network, externalNetwork: e.externalNetwork, subnet: e.networkSubnet,
      externalSubnet: e.externalNetworkSubnet, image: invocation.providerImage, entrypoint: entrypoints[i]!, alias: aliases[i]!, env: environments[i]!, ...(i ? { addHost: "host.docker.internal:host-gateway" } : {}) });
  }
  for (const [network, subnet, internal] of [[e.network, e.networkSubnet, true], [e.externalNetwork, e.externalNetworkSubnet, false]] as const)
    parseMethodologyEgressNetworkInspect(take(["network", "inspect", network]).result.stdout, { name: network, network, subnet, sidecars: names, internal });
  same(cursor, rows.length, "extra sidecar preparation operation");
}
