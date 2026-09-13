import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../eval/prediction-contract.js";
import { preflightSolLowOperator } from "../eval/prediction-sol-low-operator-contract.js";
import { runStructuralSolLowOperator } from "../eval/prediction-sol-low-operator.js";
import { assessPredictionCanary, assessPredictionSolLowCanary, requirePredictionBatchAuthorization } from "../eval/prediction-canary-assessment.js";
import { observePredictionExec } from "../eval/prediction-mechanical-evidence.js";
import { parseSolLowOperatorArgs } from "../scripts/evidence/run-sol-low-canary.js";
import { solLowOperatorFixture, solLowAssessmentFixture } from "./eval-prediction-sol-low-operator-fixture.js";
import { trustedLowFixture as trusted } from "./eval-prediction-sol-low-canary-fixture.js";
import { predictionDockerFixture } from "./eval-prediction-cli-bridge-fixture.js";
import { exec } from "../src/util/exec.js";

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
  const f = await solLowOperatorFixture(t); let calls = 0;
  const docker = predictionDockerFixture(async (args, settings) => {
    calls++; assert.ok(args.includes('model_reasoning_effort="low"')); assert.ok(settings?.deadlineSignal); assert.ok(settings!.timeoutMs! <= 1200000);
    const out = args.find(a => a.includes("target=/output"))!.split("source=")[1]!.split(",target=")[0]!; writeFileSync(join(out, "result.json"), "synthetic canary");
    return { code: 0, timedOut: false, stdout: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 20, output_tokens: 5 } }), stderr: "", processId: 12345 };
  });
  const executor: typeof docker.run = (command, args, settings) => args[0] === "image" ? Promise.resolve({ code: 0, timedOut: false, stdout: JSON.stringify([f.amendment.runtimeAcceptance.image]), stderr: "" }) : docker.run(command, args, settings);
  const result = await runStructuralSolLowOperator(f.request, executor);
  assert.equal(result.status, "awaiting-independent-observations"); assert.equal(calls, 1);
  for (const part of ["client", "sidecars"]) assert.ok(readdirSync(join(f.options.directory, `canary/mechanical-${part}`)).some(n => n.endsWith("-terminal.json")));
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
  const directory = join(f.root, "mechanical"), run = observePredictionExec(directory, async () => { calls++; return { code: 0, stdout: "", stderr: "", timedOut: false }; });
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
  assert.equal(result.kind, "prediction-sol-low-canary-assessment-v1"); assert.equal(result.batchAuthorized, false); assert.equal(result.executionReady, false);
  assert.equal(assessPredictionCanary(f.input).recommendation, "not-eligible"); assert.throws(() => requirePredictionBatchAuthorization(result));
  assert.equal(assessPredictionSolLowCanary({ ...f.input, observer: null }).recommendation, "not-eligible");
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
    assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
  }
  Object.assign(f.files, structuredClone(original)); const transcript = f.files["canary/cleanup.json"].reader.transcript;
  const search = JSON.parse(transcript[2].response); search.matches.push({ path: "secret/ground-truth.json", line: 1, text: "diff --git injected" }); transcript[2].response = JSON.stringify(search);
  f.syncReads(); assert.equal(assessPredictionSolLowCanary(f.repin()).recommendation, "not-eligible");
});
