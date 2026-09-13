import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digest, sha } from "../eval/prediction-contract.js";
import { preflightSolLowOperator } from "../eval/prediction-sol-low-operator-contract.js";
import { runStructuralSolLowOperator } from "../eval/prediction-sol-low-operator.js";
import { assessPredictionCanary, assessPredictionSolLowCanary, requirePredictionBatchAuthorization } from "../eval/prediction-canary-assessment.js";
import { observePredictionExec } from "../eval/prediction-mechanical-evidence.js";
import { validateMechanicalReceipts } from "../eval/prediction-mechanical-receipts.js";
import { parseSolLowOperatorArgs } from "../scripts/evidence/run-sol-low-canary.js";
import { solLowOperatorFixture, solLowAssessmentFixture } from "./eval-prediction-sol-low-operator-fixture.js";
import { trustedLowFixture as trusted } from "./eval-prediction-sol-low-canary-fixture.js";
import { predictionDockerFixture } from "./eval-prediction-cli-bridge-fixture.js";
import { exec } from "../src/util/exec.js";
import { sealFixture } from "./eval-prediction-canary-assessment-fixture.js";

test("operator preflight authenticates gates/source/mounts without consuming a canary or reading session content", async t => {
  const f = await solLowOperatorFixture(t);
  assert.deepEqual(await preflightSolLowOperator(f.frozen, f.gate), f.contract);
  const result = await runStructuralSolLowOperator({ ...f.request, action: "preflight" }, async (_command, args) => {
    assert.deepEqual(args, ["image", "inspect", "--format", "{{json .RepoDigests}}", f.amendment.runtimeAcceptance.image]);
    return { code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" };
  });
  assert.equal(result.status, "preflight-passed-no-dispatch"); assert.equal(existsSync(f.options.directory), false);
  assert.equal(JSON.parse(readFileSync(join(f.request.reportDirectory, "preflight.json"), "utf8")).session.credentialContentsRead, false);
  assert.equal(f.pack.preauthorization.attempts.filter(a => a.status === "unstarted").length, 64);
});

test("gate reproduction: wrong freeze digest retains a rejection report without execution state", async t => {
  const f = await solLowOperatorFixture(t); let calls = 0, intake: string | undefined;
  await assert.rejects(runStructuralSolLowOperator({ ...f.request, freeze: { ...f.frozen, expectedSha256: sha("wrong digest") } }, async () => { calls++; throw new Error("must not invoke"); }), error => {
    intake = (error as any).preflightReportDirectory; return Boolean(intake);
  });
  assert.equal(calls, 0); assert.equal(existsSync(f.options.directory), false);
  assert.equal(existsSync(f.request.reportDirectory), false);
  assert.ok(existsSync(join(intake!, "failure.json")), "pre-authentication rejection must be durable");
  const request = JSON.parse(readFileSync(join(intake!, "request.json"), "utf8"));
  assert.equal(request.supplied.freeze.actualSha256, f.frozen.expectedSha256); assert.equal(request.supplied.freeze.expectedSha256, sha("wrong digest"));
  assert.equal(readFileSync(join(intake!, "freeze.supplied.utf8"), "utf8"), f.frozen.bytes);
});

test("gate reproduction: receipt inventory names cannot substitute for actual mechanical bytes", async t => {
  const f = await solLowAssessmentFixture(t), input = f.repin();
  input.artifacts = input.artifacts.filter(a => !a.path.startsWith("canary/mechanical-"));
  const observer = JSON.parse(input.observer!.bytes);
  observer.inventory = input.artifacts.map(a => ({ path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
  observer.review.inventorySha256 = digest(observer.inventory); input.observer = trusted(observer);
  assert.equal(assessPredictionSolLowCanary(input).recommendation, "not-eligible");
});

test("unauthenticated embedded directories cannot steer rejection reads or writes", async t => {
  const f = await solLowOperatorFixture(t), victim = join(f.root, "victim"); mkdirSync(victim);
  writeFileSync(join(victim, "canary-ledger-terminal.json"), "not an operator ledger");
  const bytes = JSON.stringify({ contract: { execution: { directory: victim }, runId: "untrusted-run" } });
  let intake: string | undefined, calls = 0;
  await assert.rejects(runStructuralSolLowOperator({ ...f.request, freeze: { bytes, expectedSha256: sha("not the supplied bytes") }, reportDirectory: join(victim, "report"),
    sourcePaths: { freeze: "/operator-supplied/freeze.json", gate: "/operator-supplied/gate.json" } }, async () => { calls++; throw new Error("must not run"); }), error => {
    intake = (error as any).preflightReportDirectory; return Boolean(intake);
  });
  assert.equal(calls, 0); assert.deepEqual(readdirSync(victim), ["canary-ledger-terminal.json"]);
  assert.equal(existsSync(f.options.directory), false);
  const retained = JSON.parse(readFileSync(join(intake!, "request.json"), "utf8"));
  assert.equal(retained.supplied.freeze.operatorSuppliedPath, "/operator-supplied/freeze.json");
  assert.equal(retained.supplied.freeze.actualSha256, sha(bytes)); assert.equal(retained.embeddedIdentitiesTrusted, false);
  assert.equal(JSON.parse(readFileSync(join(intake!, "failure.json"), "utf8")).providerCalls, 0);
});

test("preflight failures retain separate evidence and never construct or dispatch the canary", async t => {
  const f = await solLowOperatorFixture(t); let calls = 0;
  for (const [i, change] of [{ verdict: "FAIL" }, { sourceSha256: sha("stale") }, { freezeSha256: sha("other") }].entries()) {
    const gate = trusted({ ...JSON.parse(f.gate.bytes), ...change });
    await assert.rejects(runStructuralSolLowOperator({ ...f.request, gate, reportDirectory: join(f.root, `failed-${i}`) }, async () => { calls++; throw new Error("must not run"); }));
    assert.equal(JSON.parse(readFileSync(join(f.root, `failed-${i}/failure.json`), "utf8")).providerCalls, 0);
  }
  const old = process.env.PEREGRINE_CODEX_SESSION_DIR; delete process.env.PEREGRINE_CODEX_SESSION_DIR;
  try { await assert.rejects(runStructuralSolLowOperator({ ...f.request, reportDirectory: join(f.root, "missing-session") }, async () => { calls++; throw new Error("must not run"); }), /session/); }
  finally { process.env.PEREGRINE_CODEX_SESSION_DIR = old; }
  assert.equal(calls, 0); assert.equal(existsSync(f.options.directory), false);
});

test("supported operator dispatch runs one synthetic low client, retains mechanical receipts and denies restart", async t => {
  const f = await solLowOperatorFixture(t); let calls = 0, token = "";
  const docker = predictionDockerFixture(async (args, settings) => {
    calls++; assert.ok(args.includes('model_reasoning_effort="low"')); assert.ok(settings?.deadlineSignal); assert.ok(settings!.timeoutMs! <= 1200000);
    token = JSON.parse(args.find(a => a.startsWith("mcp_servers.source_read.url="))!.split("=").slice(1).join("=")).slice(-64);
    const out = args.find(a => a.includes("target=/output"))!.split("source=")[1]!.split(",target=")[0]!; writeFileSync(join(out, "result.json"), "synthetic canary " + token);
    return { code: 0, timedOut: false, stdout: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 }, echoedCapability: token }), stderr: token, processId: 12345 };
  });
  const executor: typeof docker.run = async (command, args, settings) => args[0] === "image" ? { code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" } : { processId: 20000, ...await docker.run(command, args, settings) };
  const result = await runStructuralSolLowOperator(f.request, executor);
  assert.equal(result.status, "awaiting-independent-observations"); assert.equal(calls, 1);
  for (const part of ["client", "sidecars"]) assert.ok(readdirSync(join(f.options.directory, `canary/mechanical-${part}`)).some(n => n.endsWith("-terminal.json")));
  const retained = JSON.parse(readFileSync(join(f.request.reportDirectory, "retained-inventory.json"), "utf8"));
  const artifacts = retained.inventory.map((v: any) => ({ path: v.path, bytes: readFileSync(join(f.options.directory, v.path), "utf8") }));
  assert.match(token, /^[a-f0-9]{64}$/);
  for (const artifact of artifacts) assert.equal(artifact.bytes.includes(token), false, artifact.path);
  assert.equal(readFileSync(join(f.options.directory, "canary/output/result.json"), "utf8"), "synthetic canary " + sha(token));
  const records: Record<string, any> = Object.fromEntries(artifacts.filter((v: any) => v.path !== "canary/output/result.json").map((v: any) => [v.path, JSON.parse(v.bytes)]));
  const launch = records["canary/mechanical-client/000001-start.json"];
  records["observer/lifecycle.json"] = { clientProcessId: 12345, clientContainer: launch.args[launch.args.indexOf("--name") + 1] };
  for (const value of Object.values(records)) if (value.kind === "prediction-mechanical-terminal-v3" && value.binding.channel === "sidecars") {
    for (const line of value.result.stdout.bytes.split("\n")) { let item: any; try { item = JSON.parse(line); } catch { continue; }
      if (item.status === "sealed") records[item.protocol === "egress-gateway-v1" ? "observer/gateway-audit.json" : "observer/forwarder-audit.json"] = item.audit;
    }
  }
  // Uses emitted bytes from the actual producer. These local synthesized
  // observer fields test compatibility only, never external provenance.
  assert.doesNotThrow(() => validateMechanicalReceipts(artifacts, retained, records["canary/start.json"].scope, path => records[path],
    { directory: f.contract.execution.directory, session: JSON.parse(readFileSync(join(f.request.reportDirectory, "preflight.json"), "utf8")).session }));
  assert.equal(JSON.parse(readFileSync(join(f.request.reportDirectory, "terminal.json"), "utf8")).snapshot.batch.unstartedAttemptIds.length, 64);
  await assert.rejects(runStructuralSolLowOperator({ ...f.request, reportDirectory: join(f.root, "restart-report") }, executor), /ledger already exists/); assert.equal(calls, 1);
  assert.ok(docker.calls.filter(c => ["rm", "stop", "ps"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!)).every(c => c.signal === undefined));
});

test("exact operator arguments default deny route, retry, batch and absent authorization flags", async t => {
  const f = await solLowOperatorFixture(t), freezePath = join(f.root, "freeze.json"), gatePath = join(f.root, "gate.json");
  writeFileSync(freezePath, f.frozen.bytes); writeFileSync(gatePath, f.gate.bytes);
  const args = ["--freeze", freezePath, "--freeze-sha256", f.frozen.expectedSha256, "--gate", gatePath, "--gate-sha256", f.gate.expectedSha256, "--report-directory", f.request.reportDirectory, "--preflight"];
  assert.equal(parseSolLowOperatorArgs(args).action, "preflight");
  for (const a of [args.slice(0, -1), [...args, "--retry"], [...args.slice(0, -1), "--batch"], [...args.slice(0, -1), "--effort=high"]]) assert.throws(() => parseSolLowOperatorArgs(a));
  assert.equal(existsSync(f.options.directory), false);
});

test("cleanup diagnostics are redacted before the deadline guard persists them", async t => {
  const f = await solLowOperatorFixture(t); let token = "";
  const docker = predictionDockerFixture(async args => {
    token = JSON.parse(args.find(a => a.startsWith("mcp_servers.source_read.url="))!.split("=").slice(1).join("=")).slice(-64);
    return { code: 1, timedOut: false, stdout: "", stderr: token, processId: 12345, cleanupErrors: ["cleanup " + token] };
  });
  await runStructuralSolLowOperator(f.request, async (command, args, options) => args[0] === "image" ? { code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" } : { processId: 20000, ...await docker.run(command, args, options) });
  assert.match(token, /^[a-f0-9]{64}$/);
  const inventory = JSON.parse(readFileSync(join(f.request.reportDirectory, "retained-inventory.json"), "utf8")).inventory;
  for (const entry of inventory) assert.equal(readFileSync(join(f.options.directory, entry.path), "utf8").includes(token), false, entry.path);
  const deadline = JSON.parse(readFileSync(join(f.options.directory, "canary/deadline/terminal.json"), "utf8"));
  assert.notEqual(deadline.cleanupError, null); assert.equal(deadline.teardownCompleted, false);
});

test("runtime preflight failure cannot consume the one-shot ledger or pull an image", async t => {
  const f = await solLowOperatorFixture(t), calls: string[][] = [];
  await assert.rejects(runStructuralSolLowOperator(f.request, async (_command, args) => {
    calls.push(args); return { code: 1, timedOut: false, stdout: "", stderr: "synthetic image unavailable" };
  }), /runtime unavailable/);
  assert.equal(calls.length, 1); assert.equal(calls[0]![0], "image"); assert.ok(!calls.flat().includes("pull"));
  assert.equal(existsSync(f.options.directory), false); assert.ok(existsSync(join(f.request.reportDirectory, "runtime-preflight.json")));
});

test("concurrent operators can invoke only one client and preserve partial failure evidence", async t => {
  const f = await solLowOperatorFixture(t); let calls = 0;
  const docker = predictionDockerFixture(async args => {
    calls++; const out = args.find(a => a.includes("target=/output"))!.split("source=")[1]!.split(",target=")[0]!;
    writeFileSync(join(out, "result.json"), "partial synthetic evidence"); throw new Error("synthetic client failed");
  });
  const executor: typeof docker.run = (command, args, settings) => args[0] === "image" ? Promise.resolve({ code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" }) : docker.run(command, args, settings);
  const results = await Promise.allSettled([runStructuralSolLowOperator(f.request, executor), runStructuralSolLowOperator({ ...f.request, reportDirectory: join(f.root, "racing-report") }, executor)]);
  assert.equal(calls, 1); assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  const terminal = JSON.parse(readFileSync(join(f.options.directory, "canary/terminal.json"), "utf8"));
  assert.equal(terminal.terminal.rawOutput, "partial synthetic evidence"); assert.equal(terminal.tokens.status, "unknown");
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, "canary-ledger-terminal.json"), "utf8")).ledger.unstartedReviewAttempts, 64);
  assert.ok(existsSync(join(f.options.directory, "canary/execution-failure.json"))); assert.ok(existsSync(join(f.options.directory, "canary/cleanup.json")));
});

test("mechanical persistence gates invocation but never skips mandatory cleanup", async t => {
  const f = await solLowOperatorFixture(t); let calls = 0;
  const directory = join(f.root, "mechanical"), run = observePredictionExec(directory, { runId: "synthetic", attemptId: "synthetic", scopeSha256: sha("scope"), sourceSha256: sha("source"), channel: "client" }, async () => { calls++; return { code: 0, stdout: "", stderr: "", timedOut: false }; });
  writeFileSync(join(directory, "000001-start.json"), "immutable collision");
  await assert.rejects(run("docker", ["run", "synthetic"]), /EEXIST/); assert.equal(calls, 0);
  writeFileSync(join(directory, "000002-start.json"), "immutable collision");
  await assert.rejects(run("docker", ["rm", "--force", "synthetic"]), /persistence/); assert.equal(calls, 1);
  assert.equal(readFileSync(join(directory, "000001-start.json"), "utf8"), "immutable collision");
});

test("opt-in PID capture uses the existing child executor and does not alter its default results", async () => {
  const observed = await exec(process.execPath, ["-e", "process.stdout.write('synthetic')"], { captureProcessId: true, timeoutMs: 5000 });
  assert.equal(observed.stdout, "synthetic"); assert.ok(Number.isSafeInteger(observed.processId) && observed.processId! > 0);
  const legacy = await exec(process.execPath, ["-e", "process.stdout.write('synthetic')"], { timeoutMs: 5000 });
  assert.deepEqual(legacy, { stdout: "synthetic", stderr: "", code: 0, timedOut: false });
});

test("low assessor independently validates the explicit low route without high/batch promotion", async t => {
  const f = await solLowAssessmentFixture(t), result = assessPredictionSolLowCanary(f.input);
  assert.equal(result.recommendation, "infrastructure-canary-observed-no-batch-eligibility", JSON.stringify(result.failure));
  assert.equal(result.kind, "prediction-sol-low-canary-assessment-v9"); assert.equal(result.batchAuthorized, false); assert.equal(result.executionReady, false);
  assert.equal(assessPredictionCanary(f.input).recommendation, "not-eligible"); assert.throws(() => requirePredictionBatchAuthorization(result));
  assert.equal(assessPredictionSolLowCanary({ ...f.input, observer: null }).recommendation, "not-eligible");
});

test("successor rejects inconsistent helper defaults and missing or cross-record redaction evidence", async t => {
  const mutations: ((f: Awaited<ReturnType<typeof solLowAssessmentFixture>>) => void)[] = [
    f => { delete f.files["canary/invocation.json"].forwarderCapability; },
    f => { f.files["canary/mechanical-sidecars/000004-start.json"].forwarderCapability = { kind: "forwarding-capability-sha256-v1", sha256: sha("foreign") }; },
    f => { f.files["canary/mechanical-client/000001-terminal.json"].forwarderCapability = null; },
    f => { f.files["canary/mechanical-sidecars/000009-terminal.json"].kind = "prediction-mechanical-terminal-v2"; },
    f => { f.files["canary/terminal.json"].outputRedaction.persistedSha256 = sha("foreign output"); },
    ...[0, 1].map(index => (f: Awaited<ReturnType<typeof solLowAssessmentFixture>>) => {
      const stream = f.files["canary/mechanical-sidecars/000009-terminal.json"].result.stdout, containers = JSON.parse(stream.bytes);
      containers[index].HostConfig.OomKillDisable = false; stream.bytes = JSON.stringify(containers); stream.sha256 = sha(stream.bytes);
    }),
  ];
  for (const mutate of mutations) { const f = await solLowAssessmentFixture(t); mutate(f); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible"); }
});

test("low assessor rejects route/identity/catalog/cleanup/slot/gate and inventory mutations", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  for (const mutate of [
    () => { f.files["observer/identity.json"].observedRequest.effort = "high"; },
    () => { f.files["observer/identity.json"].servedModel = "gpt-6-astra"; },
    () => { f.files["observer/identity.json"].servedVersion = "model-claimed"; },
    () => { f.files["observer/catalog.json"].complete = false; },
    () => { f.files["observer/catalog.json"].repositoryTools.push({ name: "shell" }); },
    () => { f.files["observer/absence.json"].resources[0].observedAbsent = false; },
    () => { f.files["observer/batch-after.json"].unstartedAttemptIds.pop(); },
    () => { f.files["canary/start.json"].approval.independentGateSha256 = sha("wrong gate"); },
  ]) {
    Object.assign(f.files, structuredClone(original)); mutate(); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
  }
  assert.equal(assessPredictionSolLowCanary({ ...f.input, operatorGate: trusted({ ...JSON.parse(f.op.gate.bytes), freezeSha256: sha("stale") }) }).recommendation, "not-eligible");
});

test("low assessor rejects resealed missing, substituted, truncated, duplicate and cross-run receipts", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const start = "canary/mechanical-client/000001-start.json", end = "canary/mechanical-client/000001-terminal.json";
  const mutations: [string, () => void][] = [
    ["missing start", () => { delete f.files[start]; }],
    ["missing completion", () => { delete f.files[end]; }],
    ["substituted completion", () => { f.files[end] = { status: "complete" }; }],
    ["cross-run start", () => { f.files[start].binding.runId = "other"; }],
    ["cross-source end", () => { f.files[end].binding.sourceSha256 = sha("stale source"); }],
    ["cross-scope end", () => { f.files[end].binding.scopeSha256 = sha("other scope"); }],
    ["truncated stdout", () => { f.files[end].result.stdout.complete = false; }],
    ["wrong stdout hash", () => { f.files[end].result.stdout.sha256 = sha("other"); }],
    ["missing process", () => { delete f.files[end].result.processId; }],
    ["nonzero exit", () => { f.files[end].result.code = 1; }],
    ["timeout", () => { f.files[end].result.timedOut = true; }],
    ["persistence failure", () => { f.files[end].evidenceError = { primaryError: "disk full" }; }],
    ["cleanup error", () => { f.files[end].result.cleanupErrors = ["not removed"]; }],
    ["failure disposition", () => { f.files["canary/mechanical-client/000001-failure.json"] = { failure: "synthetic" }; }],
    ["duplicate sequence", () => { f.files["canary/mechanical-client/000002-start.json"].sequence = 1; }],
    ["wrong route", () => { f.files[start].args.push("--resume"); }],
    ["deadline missing", () => { f.files[start].deadlineAttached = false; }],
    ["cancelled cleanup", () => { f.files["canary/mechanical-client/000002-start.json"].deadlineAttached = true; }],
    ["resource remains", () => { const r = f.files["canary/mechanical-client/000003-terminal.json"].result; r.stdout = { bytes: "remaining", complete: true, sha256: sha("remaining") }; }],
    ["late sidecar", () => { f.files["canary/mechanical-sidecars/000004-terminal.json"].closedAt = 1000; }],
    ["audit substitution", () => { const r = f.files["canary/mechanical-sidecars/000013-terminal.json"].result; const bytes = JSON.stringify({ status: "sealed", audit: {} }); r.stdout = { bytes, complete: true, sha256: sha(bytes) }; }],
  ];
  for (const [name, mutate] of mutations) {
    for (const key of Object.keys(f.files)) delete f.files[key]; Object.assign(f.files, structuredClone(original));
    mutate(); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", name);
  }
  for (const key of Object.keys(f.files)) delete f.files[key]; Object.assign(f.files, structuredClone(original));
  const input = f.repin(); input.artifacts.push(input.artifacts.find(a => a.path === end)!);
  assert.equal(assessPredictionSolLowCanary(input).recommendation, "not-eligible", "duplicate actual artifact");
});

test("receipt raw size/digest authentication cannot be bypassed by resealing observer inventory", async t => {
  const f = await solLowAssessmentFixture(t);
  for (const bytes of ["{}", "{", JSON.stringify({ kind: "injected" })]) {
    const input = f.repin(); input.artifacts.find(a => a.path === "canary/mechanical-client/000001-terminal.json")!.bytes = bytes;
    const observer = JSON.parse(input.observer!.bytes);
    observer.inventory = input.artifacts.map(a => ({ path: a.path, bytes: Buffer.byteLength(a.bytes), sha256: sha(a.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
    observer.review.inventorySha256 = digest(observer.inventory); input.observer = trusted(observer);
    assert.equal(assessPredictionSolLowCanary(input).recommendation, "not-eligible");
  }
});

for (const [name, channel, change] of [
  ["client privileged", "client", (a: string[]) => a.splice(1, 0, "--privileged")],
  ["client host root mount", "client", (a: string[]) => a.splice(1, 0, "--mount", "type=bind,source=/,target=/host")],
  ["client additional network", "client", (a: string[]) => a.splice(a.indexOf("--network") + 2, 0, "--network", "host")],
  ["sidecar arbitrary entrypoint", "sidecars", (a: string[]) => { a[a.indexOf("--entrypoint") + 1] = "/malicious/entrypoint"; }],
  ["sidecar host root mount", "sidecars", (a: string[]) => a.splice(1, 0, "--mount", "type=bind,source=/,target=/host")],
] as const) test(`gate v3 reproduction: ${name}`, async t => {
  const f = await solLowAssessmentFixture(t);
  const receipt = Object.entries(f.files).find(([path, value]) => path.startsWith(`canary/mechanical-${channel}/`) && path.endsWith("-start.json") && value.args[0] === "run")![1];
  change(receipt.args); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
});

test("complete Docker argv rejects nearby insertions, substitutions, duplicates and ordering tricks", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "infrastructure-canary-observed-no-batch-eligibility");
  const insert = (...extra: string[]) => (a: string[]) => a.splice(1, 0, ...extra);
  const replace = (flag: string, value: string) => (a: string[]) => { a[a.indexOf(flag) + 1] = value; };
  const mutations: [string, string, (a: string[]) => void][] = [
    ["privilege equals form", "client", insert("--privileged=true")], ["short volume", "client", insert("-v", "/:/host")],
    ["volume equals form", "client", insert("--volume=/:/host")], ["extra network equals", "client", insert("--network=host")],
    ["extra entrypoint", "client", insert("--entrypoint", "/bin/sh")], ["capability addition", "client", insert("--cap-add", "SYS_ADMIN")],
    ["security option addition", "client", insert("--security-opt", "seccomp=unconfined")], ["environment addition", "client", insert("--env", "OPENAI_API_KEY=synthetic")],
    ["environment file", "client", insert("--env-file", "/host/env")], ["duplicate name", "client", insert("--name", "other-container")],
    ["root UID", "client", replace("--user", "0:0")], ["working directory", "client", replace("--workdir", "/")],
    ["altered proxy", "client", replace("--env", "HTTPS_PROXY=http://evil:8081")],
    ["writable source", "client", a => { const i = a.findIndex(v => v.includes("target=/workspace,")); a[i] = a[i]!.replace(",readonly", ""); }],
    ["substituted source", "client", a => { const i = a.findIndex(v => v.includes("target=/workspace,")); a[i] = "type=bind,source=/,target=/workspace,readonly"; }],
    ["substituted session", "client", a => { const i = a.findIndex(v => v.includes("target=/home/peregrine/.codex/auth.json")); a[i] = "type=bind,source=/other/auth.json,target=/home/peregrine/.codex/auth.json,readonly"; }],
    ["executable tmpfs", "client", a => { const i = a.indexOf("--tmpfs") + 1; a[i] = a[i]!.replace("noexec", "exec"); }],
    ["removed read-only", "client", a => { a.splice(a.indexOf("--read-only"), 1); }],
    ["mount option order", "client", a => { const i = a.indexOf("--mount") + 1; a[i] = a[i]!.split(",").reverse().join(","); }],
    ["sidecar short mount", "gateway", insert("-v", "/:/host")], ["sidecar volume equals", "gateway", insert("--volume=/:/host")],
    ["sidecar second network", "gateway", insert("--network", "host")], ["sidecar replacement network", "gateway", replace("--network", "host")],
    ["sidecar port publish", "gateway", insert("--publish", "8081:8081")], ["sidecar host gateway", "gateway", insert("--add-host", "host.docker.internal:host-gateway")],
    ["sidecar capability", "gateway", insert("--cap-add", "NET_ADMIN")], ["sidecar security", "gateway", replace("--security-opt", "seccomp=unconfined")],
    ["sidecar duplicate environment", "gateway", insert("--env", "EGRESS_BIND_PORT=8081")],
    ["sidecar expanded authority", "gateway", a => { const i = a.findIndex(v => v.startsWith("EGRESS_ALLOWED_AUTHORITIES=")); a[i] += ",evil.example:443"; }],
    ["sidecar extra command", "gateway", a => { a.push("/bin/sh"); }],
    ["forwarder token", "forwarder", a => { const i = a.findIndex(v => v.startsWith("MCP_FORWARDER_TOKEN=")); a[i] = "MCP_FORWARDER_TOKEN=" + "b".repeat(64); }],
    ["forwarder limit", "forwarder", a => { const i = a.findIndex(v => v.startsWith("MCP_FORWARDER_MAX_REQUESTS=")); a[i] = "MCP_FORWARDER_MAX_REQUESTS=99999"; }],
    ["external driver", "network", replace("--driver", "host")], ["network extra option", "network", insert("--attachable")],
  ];
  for (const [name, target, mutate] of mutations) {
    Object.assign(f.files, structuredClone(original));
    const row = Object.entries(f.files).find(([path, value]) => path.endsWith("-start.json") &&
      (target === "client" ? path.startsWith("canary/mechanical-client/") && value.args[0] === "run" :
        path.startsWith("canary/mechanical-sidecars/") && (target === "network" ? value.args[0] === "network" && value.args[1] === "create" : value.args[0] === "run" && value.args[value.args.indexOf("--name") + 1].includes(target))))![1];
    mutate(row.args); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", name);
  }
  for (const [name, change] of [
    ["privileged inspect", (v: any) => { v[0].HostConfig.Privileged = true; }],
    ["capability inspect", (v: any) => { v[0].HostConfig.CapAdd = ["SYS_ADMIN"]; }],
    ["host mount inspect", (v: any) => { v[0].Mounts.push({ Type: "bind", Source: "/", Destination: "/host" }); }],
    ["extra topology inspect", (v: any) => { v[0].NetworkSettings.Networks.host = {}; }],
  ] as const) {
    Object.assign(f.files, structuredClone(original));
    const result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result, inspected = JSON.parse(result.stdout.bytes); change(inspected);
    const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
    assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", name);
  }
});

for (const [name, mutate] of [
  ["published gateway port", (v: any) => { v.HostConfig.PortBindings = { "8081/tcp": [{ HostIp: "0.0.0.0", HostPort: "8081" }] }; v.NetworkSettings.Ports = structuredClone(v.HostConfig.PortBindings); }],
  ["host PID namespace", (v: any) => { v.HostConfig.PidMode = "host"; }],
  ["host device", (v: any) => { v.HostConfig.Devices = [{ PathOnHost: "/dev/sda", PathInContainer: "/dev/sda", CgroupPermissions: "rwm" }]; }],
] as const) test(`gate v4 reproduction: ${name}`, async t => {
  const f = await solLowAssessmentFixture(t), result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result;
  const inspected = JSON.parse(result.stdout.bytes); mutate(inspected[0]); const bytes = JSON.stringify(inspected);
  result.stdout = { bytes, complete: true, sha256: sha(bytes) };
  assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
});

test("low assessor retains all previous turn/item/read/search closure regressions", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  for (const mutate of [
    (events: any[]) => events.splice(1, 1),
    (events: any[]) => events.splice(2, 0, { type: "turn.started" }),
    (events: any[]) => events.splice(2, 0, { type: "item.started", item: { id: "unfinished", type: "reasoning" } }),
    (events: any[]) => events.splice(2, 0, { type: "item.completed", item: { id: "tool-1", type: "agent_message" } }),
    (events: any[]) => events.splice(events.findIndex(e => e.type === "item.completed"), 1),
  ]) {
    Object.assign(f.files, structuredClone(original)); const events = f.files["canary/terminal.json"].terminal.events; mutate(events);
    f.files["canary/execution.json"].stdout = events.map((e: any) => JSON.stringify(e)).join("\n");
    f.syncMechanicalExecution();
    assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
  }
  Object.assign(f.files, structuredClone(original)); const transcript = f.files["canary/cleanup.json"].reader.transcript;
  const search = JSON.parse(transcript[2].response); search.matches.push({ path: "secret/ground-truth.json", line: 1, text: "diff --git injected" }); transcript[2].response = JSON.stringify(search);
  f.syncReads(); f.syncMechanicalExecution(); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
});

test("low assessor rejects resealed observed containment contradictions for either sidecar", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const mutations: [string, (v: any) => void][] = [
    ["publication only in network state", v => { v.NetworkSettings.Ports = { "8081/tcp": [{ HostIp: "0.0.0.0", HostPort: "8081" }] }; }],
    ["publication only in host config", v => { v.HostConfig.PortBindings = { "8081/tcp": [{ HostIp: "::", HostPort: "8081" }] }; }],
    ["PID sharing", v => { v.HostConfig.PidMode = "container:other"; }],
    ["IPC sharing", v => { v.HostConfig.IpcMode = "host"; }],
    ["UTS sharing", v => { v.HostConfig.UTSMode = "host"; }],
    ["user namespace", v => { v.HostConfig.UsernsMode = "host"; }],
    ["device request", v => { v.HostConfig.DeviceRequests = [{ Capabilities: [["gpu"]] }]; }],
    ["device cgroup", v => { v.HostConfig.DeviceCgroupRules = ["a *:* rwm"]; }],
    ["capability drop drift", v => { v.HostConfig.CapDrop = []; }],
    ["security drift", v => { v.HostConfig.SecurityOpt.push("apparmor=unconfined"); }],
    ["host bind", v => { v.HostConfig.Binds = ["/:/host"]; }],
    ["additional mount", v => { v.HostConfig.Mounts = [{ Type: "bind", Source: "/", Target: "/host" }]; }],
    ["writable root", v => { v.HostConfig.ReadonlyRootfs = false; }],
    ["host network", v => { v.HostConfig.NetworkMode = "host"; }],
    ["command drift", v => { v.Config.Cmd = ["/malicious"]; }],
    ["entrypoint drift", v => { v.Config.Entrypoint = ["/malicious"]; }],
  ];
  for (const index of [0, 1]) for (const [name, mutate] of mutations) {
    Object.assign(f.files, structuredClone(original));
    const result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result, values = JSON.parse(result.stdout.bytes);
    mutate(values[index]); const bytes = JSON.stringify(values); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
    assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", index + ": " + name);
  }
});

for (const [index, role] of [[0, "gateway"], [1, "forwarder"]] as const)
  test(`gate v5 reproduction: ${role} IPv6 contradicts disabled network`, async t => {
    const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
    const source = JSON.parse(f.files["canary/mechanical-sidecars/000009-terminal.json"].result.stdout.bytes);
    for (const network of Object.keys(source[index].NetworkSettings.Networks)) {
      Object.assign(f.files, structuredClone(original));
      const result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result, inspected = JSON.parse(result.stdout.bytes);
      Object.assign(inspected[index].NetworkSettings.Networks[network], {
        GlobalIPv6Address: "2001:db8::2", GlobalIPv6PrefixLen: 64, IPv6Gateway: "2001:db8::1",
      });
      const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
      assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", network);
    }
  });

test("low assessor reconciles IPv6 endpoint evidence for every helper/network pair", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const source = JSON.parse(f.files["canary/mechanical-sidecars/000009-terminal.json"].result.stdout.bytes);
  const mutations: [string, (v: any) => void][] = [
    ["address only", v => { v.GlobalIPv6Address = "2001:db8::2"; }],
    ["prefix only", v => { v.GlobalIPv6PrefixLen = 64; }],
    ["gateway only", v => { v.IPv6Gateway = "2001:db8::1"; }],
    ["missing address", v => { delete v.GlobalIPv6Address; }],
    ["missing prefix", v => { delete v.GlobalIPv6PrefixLen; }],
    ["missing gateway", v => { delete v.IPv6Gateway; }],
    ["missing IPAM", v => { delete v.IPAMConfig; }],
    ["null unknown", v => { v.GlobalIPv6Address = null; }],
    ["string zero", v => { v.GlobalIPv6PrefixLen = "0"; }],
    ["IPAM IPv6 override", v => { v.IPAMConfig = { IPv6Address: "2001:db8::2" }; }],
    ["unknown empty field", v => { v.IPv6Address = ""; }],
    ["link-local override", v => { v.LinkLocalIPv6Address = "fe80::2"; }],
  ];
  for (const index of [0, 1]) for (const network of Object.keys(source[index].NetworkSettings.Networks))
    for (const [name, mutate] of mutations) {
      Object.assign(f.files, structuredClone(original));
      const result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result, inspected = JSON.parse(result.stdout.bytes);
      mutate(inspected[index].NetworkSettings.Networks[network]);
      const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
      assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", index + ":" + network + ":" + name);
    }
});

for (const [index, role] of [[0, "gateway"], [1, "forwarder"]] as const) {
  for (const [field, value] of [["IPAddress", "10.254.2.14"], ["IPPrefixLen", 0], ["NetworkID", "f".repeat(64)], ["EndpointID", "f".repeat(64)], ["Gateway", "192.0.2.1"]] as const)
    test(`gate v6 reproduction: ${role} endpoint ${field}`, async t => {
      const f = await solLowAssessmentFixture(t), result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result;
      const inspected = JSON.parse(result.stdout.bytes), endpoint = Object.values(inspected[index].NetworkSettings.Networks)[0] as any;
      endpoint[field] = value; const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
      assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
    });
  for (const [flag, status] of [["Paused", "paused"], ["Restarting", "restarting"]] as const)
    test(`gate v6 reproduction: ${role} ${flag}`, async t => {
      const f = await solLowAssessmentFixture(t), result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result;
      const inspected = JSON.parse(result.stdout.bytes); Object.assign(inspected[index].State, { [flag]: true, Status: status });
      const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
      assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
    });
  for (const suffix of ["/0", "", "/28/garbage"])
    test(`gate v6 reproduction: ${role} malformed member CIDR ${suffix || "missing"}`, async t => {
      const f = await solLowAssessmentFixture(t), result = f.files["canary/mechanical-sidecars/000010-terminal.json"].result;
      const inspected = JSON.parse(result.stdout.bytes), member = Object.values(inspected[0].Containers)[index] as any;
      member.IPv4Address = `10.254.1.${index + 2}` + suffix;
      const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
      assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
    });
}

test("canonical profile mismatch fails before client invocation and retains mandatory uncancelled cleanup without retry", async t => {
  const f = await solLowOperatorFixture(t); let clientCalls = 0;
  const docker = predictionDockerFixture(async () => { clientCalls++; throw new Error("must not invoke client"); });
  const executor: typeof docker.run = async (command, args, settings) => {
    if (args[0] === "image") return { code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" };
    const result = await docker.run(command, args, settings);
    if (args[0] === "inspect") { const values = JSON.parse(result.stdout); values[0].State.UnknownProducerField = false; result.stdout = JSON.stringify(values); }
    return { processId: 20000, ...result };
  };
  await assert.rejects(runStructuralSolLowOperator(f.request, executor), /container state: unexpected or missing field/);
  assert.equal(clientCalls, 0);
  const cleanup = docker.calls.filter(c => ["stop", "rm", "ps"].includes(c.args[0]!) || c.args[0] === "network" && ["rm", "ls"].includes(c.args[1]!));
  assert.equal(cleanup.length, 10); assert.ok(cleanup.every(c => c.signal === undefined));
  assert.ok(existsSync(join(f.options.directory, "canary/failure.json")));
  const retained = JSON.parse(readFileSync(join(f.request.reportDirectory, "retained-inventory.json"), "utf8"));
  assert.ok(retained.inventory.some((v: any) => v.path === "canary/mechanical-sidecars/000009-terminal.json"));
  assert.equal(JSON.parse(readFileSync(join(f.options.directory, "canary-ledger-failure.json"), "utf8")).ledger.unstartedReviewAttempts, 64);
  await assert.rejects(runStructuralSolLowOperator({ ...f.request, reportDirectory: join(f.root, "retry-blocked") }, executor), /ledger already exists/);
  assert.equal(clientCalls, 0);
});

test("gate v7 reproduction: resealed distinct SandboxIDs cannot alias one namespace path", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  for (const index of [0, 1]) {
    Object.assign(f.files, structuredClone(original));
    const result = f.files["canary/mechanical-sidecars/000009-terminal.json"].result, inspected = JSON.parse(result.stdout.bytes);
    const target = inspected[index].NetworkSettings, other = inspected[1 - index].NetworkSettings;
    target.SandboxID = other.SandboxID.slice(0, 12) + "f".repeat(52); target.SandboxKey = other.SandboxKey;
    assert.notEqual(target.SandboxID, other.SandboxID);
    const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
    const assessment = assessPredictionSolLowCanary(f.repin());
    assert.equal(assessment.recommendation, "not-eligible", String(index)); assert.ok(assessment.failure);
  }
});

test("gate v7 reproduction: resealed one-nanosecond producer inversions reject", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  for (const index of [0, 1]) for (const mode of ["created-after-started", "started-after-close", "network-after-close"]) {
    Object.assign(f.files, structuredClone(original));
    const network = mode === "network-after-close", path = `canary/mechanical-sidecars/${network ? (index ? "000011" : "000010") : "000009"}-terminal.json`;
    const result = f.files[path].result, inspected = JSON.parse(result.stdout.bytes);
    if (network) {
      const sequence = index ? "000001" : "000002", closed = f.files[`canary/mechanical-sidecars/${sequence}-terminal.json`].closedAt;
      inspected[0].Created = new Date(closed).toISOString().replace("Z", "000001Z");
    } else if (mode === "created-after-started") inspected[index].Created = inspected[index].State.StartedAt.replace("Z", "000001Z");
    else {
      const closed = f.files[`canary/mechanical-sidecars/${index ? "000004" : "000003"}-terminal.json`].closedAt;
      inspected[index].State.StartedAt = new Date(closed).toISOString().replace("Z", "000001Z");
    }
    const bytes = JSON.stringify(inspected); result.stdout = { bytes, complete: true, sha256: sha(bytes) };
    const assessment = assessPredictionSolLowCanary(f.repin());
    assert.equal(assessment.recommendation, "not-eligible", index + ":" + mode); assert.ok(assessment.failure);
  }
});

for (const [phase, times] of [["execution", [0,100,100,300]], ["teardown", [0,100,200,200]], ["preparation", [0,0,200,300]]] as const)
  test(`gate v8 reproduction: zero ${phase} phase cannot contain positive receipts`, async t => {
    const f = await solLowAssessmentFixture(t), deadline = f.files["canary/deadline/terminal.json"];
    deadline.events.forEach((e: any, i: number) => { e.elapsedMs = times[i]; }); sealFixture(deadline);
    f.files["canary/terminal.json"].deadline = deadline;
    for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
    const result = assessPredictionSolLowCanary(f.repin());
    assert.equal(result.recommendation, "not-eligible"); assert.ok(result.failure);
  });

test("resealed deadline and receipt boundaries retain producer precision without rounding", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const sealDeadline = () => {
    const deadline = sealFixture(f.files["canary/deadline/terminal.json"]);
    f.files["canary/terminal.json"].deadline = deadline;
    for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
    return f.repin();
  };
  const deadline = f.files["canary/deadline/terminal.json"];
  deadline.elapsedMs += 0.123456; deadline.events.slice(1).forEach((e: any, i: number) => { e.elapsedMs += i ? 0.123456 : -0.123456; });
  assert.equal(assessPredictionSolLowCanary(sealDeadline()).recommendation, "infrastructure-canary-observed-no-batch-eligibility");
  for (const mutate of [
    (d: any) => { d.events[2].elapsedMs = d.events[1].elapsedMs - 0.000001; },
    (d: any) => { d.events[3].elapsedMs = d.events[2].elapsedMs - 0.000001; },
    (d: any) => { d.elapsedMs = d.events[3].elapsedMs - 0.000001; },
    (d: any) => { d.elapsedMs = 1200000; },
    (d: any) => { d.elapsedMs = 1200000.000001; },
  ]) {
    Object.assign(f.files, structuredClone(original)); mutate(f.files["canary/deadline/terminal.json"]);
    assert.equal(assessPredictionSolLowCanary(sealDeadline()).recommendation, "not-eligible");
  }
  for (const [path, key] of [["canary/mechanical-sidecars/000001-start.json", "startedAt"], ["canary/mechanical-sidecars/000023-terminal.json", "closedAt"], ["canary/mechanical-client/000001-start.json", "startedAt"], ["canary/mechanical-client/000003-terminal.json", "closedAt"]]) {
    Object.assign(f.files, structuredClone(original)); f.files[path!][key!] += 0.000001;
    assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible", path);
  }
});

test("resealed phase assessment binds every stage and refuses missing or mismatched clock provenance", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const deadlinePath = "canary/deadline/terminal.json", client = "canary/mechanical-client/000001-start.json";
  const mutations: [string, () => void][] = [
    ["missing deadline clock", () => { delete f.files[deadlinePath].clock; }],
    ["legacy deadline", () => { f.files[deadlinePath].kind = "prediction-cli-deadline-terminal-v1"; }],
    ["foreign process", () => { f.files[client].clock.processId++; }],
    ["foreign time origin", () => { f.files[client].clock.timeOriginMs++; }],
    ["missing sidecar clock", () => { delete f.files["canary/mechanical-sidecars/000009-terminal.json"].clock; }],
    ["receipt wall mismatch", () => { f.files[client].clock.unixMs++; }],
    ["wall and monotonic drift", () => { f.files[client].clock.monotonicMs += 5; }],
    ["client removal outside execution", () => { f.files[deadlinePath].events[2].elapsedMs = 105; }],
    ["client absence outside execution", () => { f.files[deadlinePath].events[2].elapsedMs = 110; }],
    ["preparation inspect outside phase", () => { f.files[deadlinePath].events[1].elapsedMs = 30; }],
    ["preparation before guard start", () => { f.files[deadlinePath].events[0].elapsedMs = 15; }],
    ["network absence outside teardown", () => { f.files[deadlinePath].events[3].elapsedMs = 240; }],
  ];
  for (const [name, mutate] of mutations) {
    Object.assign(f.files, structuredClone(original)); mutate();
    const deadline = sealFixture(f.files[deadlinePath]); f.files["canary/terminal.json"].deadline = deadline;
    for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
    const assessment = assessPredictionSolLowCanary(f.repin());
    assert.equal(assessment.recommendation, "not-eligible", name); assert.ok(assessment.failure, name);
  }
});

test("resealed execution phase cannot borrow a separate millisecond at every endpoint", async t => {
  const f = await solLowAssessmentFixture(t), deadline = f.files["canary/deadline/terminal.json"];
  deadline.events[2].elapsedMs = 100.1; sealFixture(deadline); f.files["canary/terminal.json"].deadline = deadline;
  for (const path of ["observer/lifecycle.json", "observer/absence.json"]) f.files[path].deadlineSha256 = deadline.sha256;
  for (let i = 1; i <= 3; i++) for (const part of ["start", "terminal"]) {
    const record = f.files[`canary/mechanical-client/00000${i}-${part}.json`];
    record.clock.monotonicMs = 100; record.clock.unixMs = 98 + i;
    record[part === "start" ? "startedAt" : "closedAt"] = 98 + i;
  }
  const result = assessPredictionSolLowCanary(f.repin()); assert.equal(result.recommendation, "not-eligible"); assert.ok(result.failure);
});

test("resealed assessor evidence reconciles command identities, both inspect graphs and final cleanup chronology", async t => {
  const f = await solLowAssessmentFixture(t), original = structuredClone(f.files);
  const editStream = (path: string, mutate: (value: any) => void) => {
    const result = f.files[path].result, value = JSON.parse(result.stdout.bytes); mutate(value);
    const bytes = JSON.stringify(value); result.stdout = { bytes, sha256: sha(bytes), complete: true };
  };
  const mutations: [string, () => void][] = [
    ["network create ID", () => { const bytes = "a".repeat(64) + "\n"; f.files["canary/mechanical-sidecars/000001-terminal.json"].result.stdout = { bytes, complete: true, sha256: sha(bytes) }; }],
    ["container launch ID", () => { const bytes = "b".repeat(64) + "\n"; f.files["canary/mechanical-sidecars/000003-terminal.json"].result.stdout = { bytes, complete: true, sha256: sha(bytes) }; }],
    ["container order", () => editStream("canary/mechanical-sidecars/000009-terminal.json", v => v.reverse())],
    ["coherent static address substitution", () => {
      editStream("canary/mechanical-sidecars/000009-terminal.json", v => { const n = f.files["canary/invocation.json"].egress.network; v[0].NetworkSettings.Networks[n].IPAddress = "10.254.1.14"; });
      editStream("canary/mechanical-sidecars/000010-terminal.json", v => { (Object.values(v[0].Containers)[0] as any).IPv4Address = "10.254.1.14/28"; });
    }],
    ["member endpoint identity", () => editStream("canary/mechanical-sidecars/000011-terminal.json", v => { (Object.values(v[0].Containers)[1] as any).EndpointID = "c".repeat(64); })],
    ["container created before command", () => editStream("canary/mechanical-sidecars/000009-terminal.json", v => { v[0].Created = "1970-01-01T00:00:00.001Z"; })],
    ["unclosed inspect interval", () => { f.files["canary/mechanical-sidecars/000009-terminal.json"].closedAt = 150; }],
    ["setup after client", () => { f.files["canary/mechanical-client/000001-start.json"].startedAt = 20; }],
    ["client absence after sidecar teardown", () => { f.files["canary/mechanical-client/000003-terminal.json"].closedAt = 250; }],
    ["cleanup exceeds whole attempt", () => { f.files["canary/mechanical-sidecars/000023-terminal.json"].closedAt = 100000; }],
    ["cleanup resource substitution", () => { f.files["canary/mechanical-sidecars/000014-start.json"].args[2] = "foreign"; }],
  ];
  for (const [label, mutate] of mutations) { Object.assign(f.files, structuredClone(original)); mutate(); const assessment = assessPredictionSolLowCanary(f.repin()); assert.equal(assessment.recommendation, "not-eligible", label); assert.ok(assessment.failure, label); }
});
