import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { digest, sha } from "../eval/prediction-contract.js";
import { PREDICTION_LIMITS } from "../eval/prediction-plan.js";
import { checkPredictionObservedRoute, consumePredictionAuthorization, issuePredictionAuthorization, predictionRuntimePreflight, requirePredictionAuthorization, requirePredictionRuntimePreflight } from "../eval/prediction-execution-contract.js";
import { createPredictionAttemptMonitor, createStructuralPredictionAttemptMonitor, readPredictionMonitorEvidence, type PredictionTokenSnapshot } from "../eval/prediction-attempt-monitor.js";
import { authenticatePredictionAdjudicationGate, sealGuardedPredictionLedger } from "../eval/prediction-adjudication-gate.js";
import { predictionExecutionSourceManifest } from "../eval/prediction-execution-freeze.js";
import { buildSyntheticAdjudicationPacket } from "../eval/prediction-adjudication.js";
import { sealSyntheticPredictionRun } from "../eval/prediction-evidence.js";
import { syntheticPlan } from "./eval-prediction-fixture.js";

const freezeSha = sha("synthetic frozen execution"), attemptId = "synthetic-case/1/A", version = "synthetic-served-version";
const authorizationRecord = () => ({ kind: "explicit-user-provider-authorization-v1", decision: "authorize-exact-frozen-schedule", authorityReference: "synthetic-test-control-plane-only", freezeSha256: freezeSha,
  model: "gpt-5.6-sol", effort: "high", version, attemptIds: [attemptId], expiresAtMs: Number.MAX_SAFE_INTEGER });
const route = () => ({ model: "gpt-5.6-sol", effort: "high", version, sourceEventSha256: sha("synthetic served event") });
const tokens = (values: Partial<PredictionTokenSnapshot> = {}): PredictionTokenSnapshot => ({ inputTokens: 100_000, outputTokens: 10_000, reasoningTokens: 3_000, preprocessingTokens: 2_000,
  semantics: "cumulative-input-includes-cache-output-includes-reasoning-v1", sourceEventSha256: sha("synthetic usage"), ...values });
function root(t: TestContext) { const directory = mkdtempSync(join(tmpdir(), "prediction-execution-test-")); t.after(() => rmSync(directory, { recursive: true, force: true })); return directory; }
function monitor(t: TestContext) {
  const directory = join(root(t), "attempt"); let now = 0;
  return { directory, advance(ms: number) { now += ms; },
    observer: createStructuralPredictionAttemptMonitor({ directory, freezeSha256: freezeSha, attemptId, requestedVersion: version }, () => now) };
}

test("authorization is default-deny, digest-bound, scoped, expiring, non-serializable and consumed once even before a failure", () => {
  const record = authorizationRecord(), bytes = JSON.stringify(record);
  assert.throws(() => requirePredictionAuthorization(null, freezeSha, attemptId, version), /absent/);
  assert.throws(() => issuePredictionAuthorization(bytes, sha("other"), freezeSha), /trusted approval digest/);
  const capability = issuePredictionAuthorization(bytes, digest(record), freezeSha);
  requirePredictionAuthorization(capability, freezeSha, attemptId, version);
  for (const [f, a, v] of [[sha("other"), attemptId, version], [freezeSha, "unscheduled", version], [freezeSha, attemptId, null]]) assert.throws(() => requirePredictionAuthorization(capability, f!, a!, v!), /does not cover/);
  assert.throws(() => requirePredictionAuthorization(JSON.parse(JSON.stringify(capability)), freezeSha, attemptId, version), /absent/);
  consumePredictionAuthorization(capability, freezeSha, attemptId, version);
  assert.throws(() => requirePredictionAuthorization(capability, freezeSha, attemptId, version), /consumed/);
  const expired = { ...record, expiresAtMs: 0 }, denied = issuePredictionAuthorization(JSON.stringify(expired), digest(expired), freezeSha);
  assert.throws(() => requirePredictionAuthorization(denied, freezeSha, attemptId, version), /expired/);
});

test("current CLI preflight stays closed despite authorization, route claims or forged containment objects", () => {
  const record = authorizationRecord(), authorization = issuePredictionAuthorization(JSON.stringify(record), digest(record), freezeSha);
  const input = { freezeSha256: freezeSha, attemptId, runtimeAttemptId: "attempt-000001", arm: "A" as const, sourceHeadTree: "a".repeat(40), requestedVersion: version, authorization };
  const result = predictionRuntimePreflight(input);
  assert.equal(result.allowed, false); assert.equal(result.providerCalls, 0);
  for (const reason of ["aggregate-token-cap-unenforceable", "output-token-cap-unenforceable", "live-complete-token-accounting-unavailable", "prediction-read-policy-unattached", "whole-attempt-deadline-unattached"]) assert.ok(result.blockers.includes(reason));
  assert.throws(() => requirePredictionRuntimePreflight(input), /execution blocked/);
  const forged = predictionRuntimePreflight({ ...input, attachment: { executionClass: "provider" }, attachmentRequest: { attemptId: input.runtimeAttemptId, armId: "A", sourceHeadTree: input.sourceHeadTree, paths: { repo: "/fake/source", assets: "/fake/assets", home: "/fake/home", output: "/fake/output" } } });
  assert.ok(forged.blockers.includes("containment-brand-scope-or-egress-mismatch"));
});

test("served model and effort mismatches survive unknown version; only exact observed identity matches", () => {
  assert.equal(checkPredictionObservedRoute(version, route()).matches, true);
  assert.equal(checkPredictionObservedRoute(version, null).matches, false);
  const mismatch = checkPredictionObservedRoute(null, { ...route(), model: "other", effort: "medium" });
  assert.deepEqual(mismatch.mismatches, ["served-model-mismatch", "served-effort-mismatch"]);
  assert.ok(mismatch.unavailable.includes("requested-served-version-unfrozen"));
  assert.deepEqual(checkPredictionObservedRoute(version, { ...route(), version: "other" }).mismatches, ["served-version-mismatch"]);
});

test("20-minute whole-attempt deadline aborts, retains late partial bytes and closes immutable evidence", t => {
  const f = monitor(t); f.observer.recordRawOutput("first partial "); f.advance(PREDICTION_LIMITS.wallMs);
  f.observer.checkDeadline(); assert.equal(f.observer.signal.aborted, true);
  f.observer.recordRawOutput("late output");
  const terminal = f.observer.finish("partial");
  assert.equal(terminal.stopReason, "whole-attempt-deadline"); assert.equal(terminal.rawResponseSha256, sha("first partial late output"));
  assert.equal(terminal.terminationProven, false); assert.equal(terminal.compliantProviderResult, false);
  const evidence = readPredictionMonitorEvidence(f.directory, terminal.sha256);
  assert.equal(evidence.events.filter(e => e.kind === "stop").length, 1);
  assert.throws(() => f.observer.recordRawOutput("after terminal"), /sealed/);
  assert.throws(() => createStructuralPredictionAttemptMonitor({ directory: f.directory, freezeSha256: freezeSha, attemptId, requestedVersion: version }, () => 0), /EEXIST/);
  const raw = readFileSync(join(f.directory, "000001.json"), "utf8"); writeFileSync(join(f.directory, "000001.json"), raw.replace("first partial", "changed bytes"));
  assert.throws(() => readPredictionMonitorEvidence(f.directory, terminal.sha256), /event seal drift/);
});

test("host timer issues the same cancellation signal without waiting for a later tool event", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const observer = createPredictionAttemptMonitor({ directory: join(root(t), "timer"), freezeSha256: freezeSha, attemptId, requestedVersion: version });
  t.mock.timers.tick(PREDICTION_LIMITS.wallMs - 1); assert.equal(observer.signal.aborted, false);
  t.mock.timers.tick(1); assert.equal(observer.signal.aborted, true);
  assert.equal(observer.finish("missing").status, "stopped");
});

test("cumulative counters include preprocessing and reasoning once; overrun, unknown data and rollback stop", t => {
  const f = monitor(t); f.observer.recordTokens(tokens()); f.observer.recordRoute(route()); f.observer.recordRawOutput("synthetic output");
  const first = f.observer.finish("completed"); assert.equal(first.status, "completed"); assert.equal(first.usage!.inputTokens + first.usage!.outputTokens + first.usage!.preprocessingTokens, 112_000);
  assert.equal(first.compliantProviderResult, false);
  for (const [label, update, expected] of [
    ["aggregate", { inputTokens: 109_000, outputTokens: 11_001 }, "aggregate-token-cap-exceeded"],
    ["output", { inputTokens: 1, outputTokens: 16_001 }, "output-token-cap-exceeded"],
    ["unknown", { reasoningTokens: null }, "token-accounting-incomplete-or-invalid"],
  ] as const) {
    const observer = createStructuralPredictionAttemptMonitor({ directory: join(root(t), label), freezeSha256: freezeSha, attemptId, requestedVersion: version }, () => 0);
    observer.recordTokens(tokens(update as Partial<PredictionTokenSnapshot>)); assert.equal(observer.finish("partial").stopReason, expected);
  }
  const rollback = monitor(t); rollback.observer.recordTokens(tokens()); rollback.observer.recordTokens(tokens({ inputTokens: 1, sourceEventSha256: sha("later") }));
  assert.equal(rollback.observer.finish("partial").stopReason, "token-accounting-incomplete-or-invalid");
  const missing = monitor(t); assert.equal(missing.observer.finish("missing").rawResponseSha256, null);
  const incomplete = monitor(t); assert.equal(incomplete.observer.finish("completed").status, "stopped");
});

test("adjudication requires separately authenticated fresh identities and reviewed free-text blinding", async () => {
  const plan = await syntheticPlan(), run = sealSyntheticPredictionRun(plan, "synthetic-empty", []), bundle = buildSyntheticAdjudicationPacket(plan, run);
  assert.throws(() => authenticatePredictionAdjudicationGate(plan, run, bundle, null), /identities and reviewed/);
  assert.throws(() => sealGuardedPredictionLedger(null, bundle, []), /gate absent/);
  const identity = { kind: "authenticated-assessor-sessions-v1", packetSha256: bundle.packet.sha256, runSha256: run.sha256, observerReference: "synthetic-only", sessions: [
    { role: "initial", sessionId: "synthetic-initial", model: "gpt-6-astra", effort: "xhigh", transcriptSha256: sha("initial") },
    { role: "review", sessionId: "synthetic-review", model: "gpt-6-astra", effort: "medium", transcriptSha256: sha("review") }] };
  const blind = { kind: "reviewed-prediction-packet-blinding-v1", packetSha256: bundle.packet.sha256, runSha256: run.sha256, reviewSessionId: "synthetic-blind-reviewer", reviewEvidenceSha256: sha("blinding"), findingIds: [], decision: "no-arm-or-expected-winner-disclosure-in-reviewed-packet" };
  const record = (value: unknown) => ({ bytes: JSON.stringify(value), expectedSha256: digest(value) });
  const evidence = { assessorIdentities: record(identity), reviewedBlinding: record(blind) };
  const gate = authenticatePredictionAdjudicationGate(plan, run, bundle, evidence);
  assert.equal(sealGuardedPredictionLedger(gate, bundle, []).ledger.judgments.length, 0);
  assert.throws(() => sealGuardedPredictionLedger(JSON.parse(JSON.stringify(gate)), bundle, []), /gate absent/);
  const changedBundle = structuredClone(bundle); changedBundle.packet.rubric = "tampered after gate";
  assert.throws(() => sealGuardedPredictionLedger(gate, changedBundle, []), /gate absent or mismatched/);
  assert.throws(() => authenticatePredictionAdjudicationGate(plan, run, bundle, { ...evidence, reviewedBlinding: record({ ...blind, reviewSessionId: "synthetic-initial" }) }), /cannot assess outcomes/);
  assert.throws(() => authenticatePredictionAdjudicationGate(plan, run, bundle, { ...evidence, reviewedBlinding: record({ ...blind, decision: "pattern-screen-only" }) }), /blinding unresolved/);
  assert.throws(() => authenticatePredictionAdjudicationGate(plan, run, bundle, { ...evidence, assessorIdentities: { ...record(identity), expectedSha256: sha("untrusted") } }), /trusted assessor identity digest/);
});

test("execution freeze source closure includes transitive runtime, credential, prompt, rubric and analysis inputs", () => {
  const source = predictionExecutionSourceManifest();
  for (const path of ["eval/prediction-execution-contract.ts", "eval/prediction-attempt-monitor.ts", "eval/prediction-adjudication-gate.ts", "eval/prediction-analysis.ts", "eval/methodology-provider-attachment.ts", "eval/runtime-containment.ts", "src/util/exec.ts", "src/security/provider-env.ts", "src/core/method-packet.ts", "container/eval-runtime/Dockerfile", "package-lock.json"]) assert.ok(source.files.some(f => f.path === path), path);
  assert.equal(new Set(source.files.map(f => f.path)).size, source.files.length);
  assert.equal(source.sourceSha256, digest(source.files));
});
