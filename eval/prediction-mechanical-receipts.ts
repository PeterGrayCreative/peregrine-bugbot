import { array, digest, exact, hash, integer, same, sha, text, unique } from "./prediction-contract.js";

export const MECHANICAL_RECEIPT_PATH = /^canary\/mechanical-(client|sidecars)\/([0-9]{6})-(start|terminal|failure)\.json$/;
const fail = (condition: unknown, message: string) => { if (!condition) throw new Error(message); };

/** Offline validation of the actual independently inventoried receipt bytes.
 * Names, self-hashes or an observer assertion alone cannot replace these bytes. */
export function validateMechanicalReceipts(artifacts: { path: string; bytes: string }[], retained: any, scope: any, get: (path: string) => any) {
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
  const cliIndex = client.args.lastIndexOf("codex");
  fail(client.args[0] === "run" && cliIndex > 0, "mechanical client invocation missing");
  same([client.args.slice(cliIndex + 1), client.args[cliIndex - 1], client.args[client.args.indexOf("--name") + 1], client.args[client.args.indexOf("--network") + 1], client.start.stdinSha256, client.start.deadlineAttached, client.start.cleanup],
    [invocation.args, invocation.providerImage, lifecycle.clientContainer, egress.network, scope.promptSha256, true, false], "mechanical actual client route, image, prompt or topology drift");
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
  for (const row of sidecars) {
    const a = row.args; same(row.start.stdinSha256, null, "unexpected sidecar stdin");
    fail(!a.includes("--privileged") && !a.includes("--volume") && !a.includes("-v"), "unexpected sidecar resource capability");
    if (a[0] === "run") fail(named.includes(a[a.indexOf("--name") + 1]) && a.at(-1) === invocation.providerImage && a.includes("--entrypoint"), "mechanical sidecar launch scope drift");
    else if (a[0] === "network") fail(["create", "connect", "inspect", "rm", "ls"].includes(a[1]) && (a[1] === "connect" ? networks.includes(a.at(-2)) && named.includes(a.at(-1)) : a[1] === "ls" ? networks.some(n => a.at(-1) === `name=^${n}$`) : networks.includes(a.at(-1))), "mechanical network scope drift");
    else fail(["inspect", "logs", "stop", "rm", "ps"].includes(a[0]) && (a[0] === "inspect" ? a.slice(1).every((n: string) => named.includes(n)) : a[0] === "ps" ? named.some(n => a.at(-1) === `name=^/${n}$`) : named.includes(a.at(-1))), "unknown mechanical sidecar command");
    if (!row.start.cleanup) same(row.start.deadlineAttached, true, "sidecar preparation deadline missing");
  }
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
