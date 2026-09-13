import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { analyzeSyntheticPredictions, predictionLabelSensitivity } from "../eval/prediction-analysis.js";
import { buildSyntheticAdjudicationPacket, sealSyntheticPredictionLedger, verifySyntheticAdjudicationBundle, verifySyntheticPredictionLedger, type PredictionJudgmentInput, type PredictionVote } from "../eval/prediction-adjudication.js";
import { digest, sha } from "../eval/prediction-contract.js";
import { createPredictionReadBudget, persistSyntheticPredictionRun, sealSyntheticPredictionRun, UNKNOWN_USAGE, verifySyntheticPredictionRun, type SyntheticAttemptInput } from "../eval/prediction-evidence.js";
import { bindPredictionRegistration, verifyPredictionPlan } from "../eval/prediction-plan.js";
import { screenPredictionDisclosure } from "../eval/prediction-disclosure.js";
import { syntheticPlan, syntheticRegistration } from "./eval-prediction-fixture.js";

const planPromise = syntheticPlan();
const finding = { file: "example.ts", startLine: 1, endLine: 1, explanation: "Synthetic mechanism", impact: "Synthetic impact", severity: "high" };
const raw = (findings: unknown[] = [finding]) => JSON.stringify({ status: "completed", limitations: [], findings });
const input = (attemptId: string, status: SyntheticAttemptInput["status"] = "completed", response = raw()): SyntheticAttemptInput => ({ attemptId, status, rawResponse: response, observedRoute: { model: "gpt-5.6-sol", effort: "high", version: "synthetic-pinned-version" }, usage: { ...UNKNOWN_USAGE } });
const assessors = { initial: { sessionId: "synthetic-xhigh", model: "gpt-6-astra" as const, effort: "xhigh" as const }, review: { sessionId: "synthetic-medium", model: "gpt-6-astra" as const, effort: "medium" as const } };
const vote = (category: PredictionVote["category"], conditions: string[] = [], root = "synthetic-root"): PredictionVote => ({ category, causalRoot: root, matchedConditions: conditions, evidence: "Synthetic source-based trace", abstention: null, dissent: null });
function reseal<T extends { sha256: string }>(value: T): T {
  const { sha256: _, ...body } = value; value.sha256 = digest(body); return value;
}

test("bind exact bytes, all exclusions, 64-attempt order and zero-provider registration", () => {
  const registration = syntheticRegistration(), bytes = JSON.stringify(registration);
  const bound = bindPredictionRegistration(bytes, sha(bytes));
  assert.equal(bound.schedule.length, 64); assert.equal(bound.cases.length, 16);
  assert.deepEqual(bound.schedule.slice(0, 4).map(row => row.arm), ["A", "B", "B", "A"]);
  assert.throws(() => bindPredictionRegistration(`${bytes}\n`, sha(bytes)), /digest/);
  const mutate = (change: (value: ReturnType<typeof syntheticRegistration>) => void) => { const changed = structuredClone(registration); change(changed); const data = JSON.stringify(changed); assert.throws(() => bindPredictionRegistration(data, sha(data))); };
  mutate(value => { value.schedule.reverse(); });
  mutate(value => { value.schedule.pop(); });
  mutate(value => { value.providerExecutionAuthorized = true; });
  mutate(value => { value.cases[0]!.label = "human-verified"; });
  mutate(value => { value.cases[16]!.included = true; });
  mutate(value => { value.retainedLosses.pop(); });
  mutate(value => { value.schedule[0]!.arm = "D"; });
  mutate(value => { Object.assign(value, { groundTruth: [] }); });
  const excluded = structuredClone(registration); excluded.cases[35]!.proposedClass = "other/unclassified";
  const excludedBytes = JSON.stringify(excluded); assert.equal(bindPredictionRegistration(excludedBytes, sha(excludedBytes)).cases.length, 16);
  mutate(value => { value.cases[0]!.proposedClass = "other/unclassified"; });
  assert.throws(() => bound.schedule.push(bound.schedule[0]!));
});

test("same raw scope/schema and limits; compiler fixes complete core method only for B", async () => {
  const plan = await planPromise;
  assert.equal(plan.kind, "synthetic-prediction-plan-v1");
  for (const { prompts } of plan.cases) {
    assert.equal(prompts.A.rawScopeSha256, prompts.B.rawScopeSha256);
    assert.equal(prompts.A.schemaPath, prompts.B.schemaPath);
    assert.equal(prompts.A.methodSourceSha256, null); assert.ok(prompts.B.methodSourceSha256);
    assert.doesNotMatch(prompts.A.prompt, /PEREGRINE_ROLE|Activated lane details/);
    assert.match(prompts.B.prompt, /PEREGRINE_ROLE: investigation-worker/);
    assert.equal(prompts.A.promptSha256, sha(prompts.A.prompt));
    assert.equal(prompts.B.promptSha256, sha(prompts.B.prompt));
  }
  assert.deepEqual(plan.limits, { aggregateTokens: 120000, readCalls: 100, returnedToolBytes: 2000000, outputTokens: 16000, wallMs: 1200000, retries: 0 });
});

test("resealed plans need normative registration and compiler reconstruction", async () => {
  const plan = await planPromise, bytes = JSON.stringify(syntheticRegistration());
  const restored = await verifyPredictionPlan(JSON.parse(JSON.stringify(plan)), bytes, sha(bytes));
  assert.equal(sealSyntheticPredictionRun(restored, "authenticated-restoration", []).attempts.length, 64);
  const alteredArm = structuredClone(plan); Object.assign(alteredArm.registration.schedule[0]!, { arm: "D" }); reseal(alteredArm);
  const alteredContract = structuredClone(plan); alteredContract.registration.cases[0]!.contract = "Rewritten label"; reseal(alteredContract);
  const injectedMethod = structuredClone(plan); injectedMethod.cases[0]!.prompts.A.prompt += "\nUse Peregrine's investigation method."; injectedMethod.cases[0]!.prompts.A.promptSha256 = sha(injectedMethod.cases[0]!.prompts.A.prompt); reseal(injectedMethod);
  for (const changed of [alteredArm, alteredContract, injectedMethod]) {
    assert.throws(() => sealSyntheticPredictionRun(changed, "forged-plan", []), /authentication/);
    await assert.rejects(verifyPredictionPlan(changed, bytes, sha(bytes)), /normative registration or compiler reconstruction/);
  }
  await assert.rejects(verifyPredictionPlan(plan, `${bytes}\n`, sha(bytes)), /digest mismatch/);
});

test("unknown requested version never erases a known model or effort mismatch", async () => {
  const plan = await syntheticPlan(null);
  const model = input("synthetic-0/1/A"); model.observedRoute!.model = "different-model";
  const effort = input("synthetic-0/1/B"); effort.observedRoute!.effort = "low";
  const unknownVersion = input("synthetic-0/2/B");
  const unknownRoute = input("synthetic-0/2/A"); unknownRoute.observedRoute = null;
  const run = sealSyntheticPredictionRun(plan, "unknown-version", [model, effort, unknownVersion, unknownRoute]);
  assert.deepEqual(run.attempts.slice(0, 4).map(item => item.routeMatchesRequested), [false, false, null, null]);
  assert.deepEqual(run.attempts.slice(0, 2).map(item => item.status), ["incomplete", "incomplete"]);
  verifySyntheticPredictionRun(plan, run);
});

test("missing, failed partial, parse failures, mismatched observed routes, caps and immutable evidence", async () => {
  const plan = await planPromise;
  const attempts = [input("synthetic-0/1/A", "timeout"), input("synthetic-0/1/B", "completed", JSON.stringify({ findings: [finding, { invalid: true }] })), input("synthetic-0/2/B")];
  attempts[2]!.observedRoute!.version = "wrong-version";
  const run = sealSyntheticPredictionRun(plan, "synthetic-run", attempts);
  assert.equal(run.attempts.length, 64); assert.equal(run.providerCalls, 0);
  assert.equal(run.attempts[0]!.status, "timeout"); assert.equal(run.attempts[0]!.findings.length, 1);
  assert.equal(run.attempts[1]!.status, "parse-failure"); assert.equal(run.attempts[1]!.findings.length, 1);
  assert.equal(run.attempts[2]!.status, "incomplete"); assert.equal(run.attempts[2]!.routeMatchesRequested, false);
  assert.equal(run.attempts[3]!.status, "missing"); assert.equal(run.attempts[3]!.usage.costUsd, null);
  attempts[0]!.rawResponse = "changed"; verifySyntheticPredictionRun(plan, run);
  const changed = structuredClone(run); changed.attempts[0]!.findings = []; assert.throws(() => verifySyntheticPredictionRun(plan, changed), /mismatch/);
  assert.throws(() => sealSyntheticPredictionRun(plan, "duplicate", [input("synthetic-0/1/A"), input("synthetic-0/1/A")]), /duplicate/);
  assert.throws(() => sealSyntheticPredictionRun(plan, "retry", [input("synthetic-0/3/A")]), /unscheduled/);
  const over = input("synthetic-0/1/A"); over.usage.aggregateTokens = 120001;
  assert.equal(sealSyntheticPredictionRun(plan, "over", [over]).attempts[0]!.status, "incomplete");
  const directory = mkdtempSync(join(tmpdir(), "peregrine-synthetic-prediction-"));
  try {
    const path = join(directory, `${run.sha256}.json`); persistSyntheticPredictionRun(path, plan, run);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).sha256, run.sha256);
    assert.throws(() => persistSyntheticPredictionRun(path, plan, run), /EEXIST/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("read accounting accumulates UTF-8 bytes and failures, reservations cannot be replayed", () => {
  const budget = createPredictionReadBudget({ calls: 3, bytes: 5 });
  const a = budget.reserve(), b = budget.reserve();
  assert.equal(budget.settle(a, "é", false), true); // two bytes
  assert.equal(budget.settle(b, "err", true), true); // failed call still costs three bytes
  const c = budget.reserve(); assert.equal(budget.settle(c, "x", false), false);
  assert.deepEqual(budget.snapshot().events.map(row => row.status), ["returned", "failed", "over-budget"]);
  assert.equal(budget.snapshot().bytes, 6); assert.equal(budget.snapshot().calls, 3);
  assert.throws(() => budget.reserve(), /exhausted/); assert.throws(() => budget.settle(a, "", false), /settled/);
  const pending = createPredictionReadBudget({ calls: 1, bytes: 1 }); pending.reserve();
  assert.deepEqual(pending.snapshot().pending, [1]); assert.throws(() => pending.reserve());
});

test("finding metadata is blinded and every finding reviewed twice; dissent and original votes survive", async () => {
  const plan = await planPromise;
  const run = sealSyntheticPredictionRun(plan, "synthetic-adjudication", [input("synthetic-0/1/A", "timeout"), input("synthetic-9/1/B")]);
  const bundle = buildSyntheticAdjudicationPacket(plan, run);
  assert.equal(bundle.packet.findings.length, 2);
  assert.equal(bundle.packet.blinding, "metadata-only"); assert.equal(bundle.packet.freeTextBlindnessEstablished, false);
  assert.doesNotMatch(JSON.stringify(bundle.packet), /attemptId|\/1\/A|\/1\/B|"arm"|requestedRoute/);
  verifySyntheticAdjudicationBundle(plan, run, bundle);
  const judgments = bundle.packet.findings.map(item => ({ findingId: item.id, initial: vote("predicted-additional-supported"), review: vote("predicted-unsupported"), resolution: null }));
  const ledger = sealSyntheticPredictionLedger(bundle, assessors, judgments);
  assert.ok(ledger.judgments.every(item => item.final.category === "unresolved"));
  assert.throws(() => sealSyntheticPredictionLedger(bundle, assessors, judgments.slice(1)), /every finding/);
  assert.throws(() => sealSyntheticPredictionLedger(bundle, { ...assessors, review: { ...assessors.review, sessionId: "synthetic-xhigh" } }, judgments), /distinct/);
  const resolved: PredictionJudgmentInput[] = judgments.map(item => ({ ...item, resolution: { vote: vote("predicted-additional-supported"), sourceEvidence: "Synthetic explicit source resolution" } }));
  const next = sealSyntheticPredictionLedger(bundle, assessors, resolved, ledger);
  assert.equal(next.version, 2); assert.equal(next.previousSha256, ledger.sha256);
  verifySyntheticPredictionLedger(bundle, next, [ledger]);
  assert.throws(() => verifySyntheticPredictionLedger(bundle, next), /predecessor chain/);
  assert.throws(() => analyzeSyntheticPredictions(plan, run, bundle, next), /predecessor chain/);
  analyzeSyntheticPredictions(plan, run, bundle, next, [ledger]);
  const fakeVersion = structuredClone(next); fakeVersion.version = 99; fakeVersion.previousSha256 = "f".repeat(64); reseal(fakeVersion);
  assert.throws(() => verifySyntheticPredictionLedger(bundle, fakeVersion), /predecessor chain/);
  const wrongHash = structuredClone(next); wrongHash.previousSha256 = "f".repeat(64); reseal(wrongHash);
  assert.throws(() => verifySyntheticPredictionLedger(bundle, wrongHash, [ledger]), /predecessor hash/);
  for (const stage of ["initial", "review"] as const) {
    const rewrite = structuredClone(next); rewrite.judgments[0]![stage].evidence = "Replaced old evidence"; reseal(rewrite);
    assert.throws(() => verifySyntheticPredictionLedger(bundle, rewrite, [ledger]), /cannot replace/);
  }
  const third = sealSyntheticPredictionLedger(bundle, assessors, resolved, next, [ledger]);
  verifySyntheticPredictionLedger(bundle, third, [ledger, next]);
  const rewrittenResolution = structuredClone(third); rewrittenResolution.judgments[0]!.resolution!.sourceEvidence = "Replacement of old resolution"; reseal(rewrittenResolution);
  assert.throws(() => verifySyntheticPredictionLedger(bundle, rewrittenResolution, [ledger, next]), /preserve prior resolution/);
  assert.equal(ledger.judgments[0]!.final.category, "unresolved");
  const rewritten = structuredClone(resolved); rewritten[0]!.initial.evidence = "Replacement of original assessment";
  assert.throws(() => sealSyntheticPredictionLedger(bundle, assessors, rewritten, ledger), /initial prediction/);
  const missing = structuredClone(bundle); missing.packet.findings.pop(); assert.throws(() => verifySyntheticAdjudicationBundle(plan, run, missing));
});

test("explicit arm, method and winner disclosure blocks assessor packets and preserves raw findings", async () => {
  const plan = await planPromise;
  for (const disclosure of ["I am arm B using Peregrine; expect B to win.", "The baseline arm should win.", "Our method is PEREGRINE.", "Expect A to win.", "This is arm: A."]) {
    const response = raw([{ ...finding, explanation: disclosure }]);
    const run = sealSyntheticPredictionRun(plan, "synthetic-disclosure", [input("synthetic-0/1/A", "completed", response)]);
    const before = JSON.stringify(run);
    assert.throws(() => buildSyntheticAdjudicationPacket(plan, run), /detectable arm\/method\/winner disclosure/);
    assert.equal(JSON.stringify(run), before); assert.equal(run.attempts[0]!.rawResponse, response);
    assert.equal(run.attempts[0]!.findings[0]!.explanation, disclosure);
    const screen = screenPredictionDisclosure(run.attempts[0]!.findings);
    assert.equal(screen.status, "blocked-detectable-disclosure");
    assert.deepEqual(screen, screenPredictionDisclosure(run.attempts[0]!.findings));
    assert.equal(screen.freeTextBlindnessEstablished, false);
  }
});

test("hand-calculated label and match intervals include invalid-all undefined scenario", () => {
  const rows = [{ caseId: "positive", lower: 1, upper: 1 }, { caseId: "negative", lower: -1, upper: -1 }];
  assert.equal(predictionLabelSensitivity(rows, 0).lower, 0);
  assert.deepEqual([predictionLabelSensitivity(rows, 1).lower, predictionLabelSensitivity(rows, 1).upper], [-1, 1]);
  assert.equal(predictionLabelSensitivity(rows, 1).scenarios, 3);
  assert.equal(predictionLabelSensitivity(rows, 2).emptyTruthSetResult, "undefined");
  assert.deepEqual([predictionLabelSensitivity([{ caseId: "x", lower: -0.5, upper: 1 }, { caseId: "y", lower: 0, upper: 0.5 }], 0).lower, predictionLabelSensitivity([{ caseId: "x", lower: -0.5, upper: 1 }, { caseId: "y", lower: 0, upper: 0.5 }], 0).upper], [-0.25, 0.75]);
  assert.throws(() => predictionLabelSensitivity([...rows, rows[0]!], 0)); assert.throws(() => predictionLabelSensitivity([{ caseId: "bad", lower: NaN, upper: 1 }], 0));
});

test("bundle coverage needs both conditions, failures count zero, noise includes failed comparisons and unknown costs", async () => {
  const plan = await planPromise;
  const run = sealSyntheticPredictionRun(plan, "synthetic-analysis", [input("synthetic-0/1/B", "completed", raw([finding, { ...finding, explanation: "Second synthetic condition" }])), input("synthetic-0/2/B"), input("synthetic-9/1/A", "timeout")]);
  const bundle = buildSyntheticAdjudicationPacket(plan, run);
  const judgments = bundle.packet.findings.map(item => {
    const mapping = bundle.binding.mapping.find(row => row.id === item.id)!;
    const judgment = item.caseId === "synthetic-9" ? vote("predicted-unsupported") : vote("predicted-matched", [mapping.findingIndex === 1 ? "condition-b" : "condition-a"], `root-${mapping.findingIndex}`);
    return { findingId: item.id, initial: judgment, review: judgment, resolution: null };
  });
  const ledger = sealSyntheticPredictionLedger(bundle, assessors, judgments);
  const report = analyzeSyntheticPredictions(plan, run, bundle, ledger);
  // One of two B repeats covers both conditions; the second covers only one. 0.5 / 9 bugs.
  assert.equal(report.predictionAgreement.lower, 1 / 18); assert.equal(report.predictionAgreement.upper, 1 / 18);
  assert.equal(report.counts.conditions, 17); assert.equal(report.counts.families, 15);
  assert.equal(report.noise[0]!.unsupportedRootsPerScheduledReview, 1 / 32);
  assert.equal(report.noise[0]!.comparisonCasesWithPredictedUnsupportedRoot, 1);
  assert.equal(report.noise[0]!.completedOnly, null);
  // Family 3 contains a bug and a comparison. Their case means are averaged before 15 families.
  assert.equal(report.familyNoise[0]!.unsupportedPerScheduledReview, 1 / 60);
  assert.equal(report.usage.costUsd!.total, null); assert.equal(report.usage.costUsd!.observedTotal, null);
  assert.equal(report.sensitivity.observed!.length, 10);
  assert.equal(report.sensitivity.observed![9]!.emptyTruthSetPossible, true);
  assert.ok(report.sensitivity.missingExecution![0]!.lower < report.predictionAgreement.lower);
  assert.equal(report.metric, "prediction agreement");
  assert.equal(report.robustness.equalRepository.lower, 1 / 24);
  assert.equal(report.robustness.leaveOneRepositoryOut.find(row => row.omitted === "synthetic-repo-0")!.lower, 0);
  assert.equal(report.robustness.equalFamily.lower, 1 / 18);
  assert.equal(report.sensitivity.unboundedMatching![0]!.lower, 0);
  assert.equal(report.sensitivity.unboundedMatching![0]!.upper, 1 / 9);
  const drift = structuredClone(ledger); drift.judgments.find(item => item.final.category === "predicted-matched")!.final.category = "predicted-unsupported"; drift.sha256 = digest(Object.fromEntries(Object.entries(drift).filter(([key]) => key !== "sha256")));
  assert.throws(() => analyzeSyntheticPredictions(plan, run, bundle, drift), /adjudication mismatch/);
});

test("contradictory root predictions widen coverage and noisy-root bounds; failed costs are retained", async () => {
  const plan = await planPromise;
  const chargedFailure = input("synthetic-1/1/B", "transport-failure", "{broken");
  chargedFailure.usage = { aggregateTokens: 250, outputTokens: 10, wallMs: 1000, readCalls: 2, returnedToolBytes: 20, costUsd: 0.02 };
  const run = sealSyntheticPredictionRun(plan, "synthetic-conflict", [input("synthetic-1/1/A", "completed", raw([finding, { ...finding, impact: "Different prediction for same root" }])), chargedFailure]);
  const bundle = buildSyntheticAdjudicationPacket(plan, run);
  const judgments = bundle.packet.findings.map(item => {
    const mapping = bundle.binding.mapping.find(row => row.id === item.id)!;
    const judgment = mapping.findingIndex === 0 ? vote("predicted-matched", ["condition-a"]) : vote("predicted-unsupported");
    return { findingId: item.id, initial: judgment, review: judgment, resolution: null };
  });
  const report = analyzeSyntheticPredictions(plan, run, bundle, sealSyntheticPredictionLedger(bundle, assessors, judgments));
  assert.deepEqual(report.predictionAgreement, { lower: -1 / 18, upper: 0 });
  assert.equal(report.noise[0]!.unresolvedRootsPerScheduledReview, 1 / 32);
  assert.deepEqual(report.noise[0]!.unresolvedNoiseBounds, { lower: 0, upper: 1 / 32 });
  assert.equal(report.usage.costUsd!.observedTotal, 0.02); assert.equal(report.usage.costUsd!.total, null);
  assert.equal(report.usage.aggregateTokens!.observedTotal, 250);
  assert.equal(report.attempts.find(row => row.id === "synthetic-1/1/B")!.status, "transport-failure");
});

test("prediction adapter has no admitted-truth conversion or provider dispatch imports", () => {
  for (const name of ["contract", "plan", "evidence", "adjudication", "analysis", "disclosure"]) {
    const source = readFileSync(new URL(`../eval/prediction-${name}.ts`, import.meta.url), "utf8");
    const imports = source.match(/^import .*$/gm) ?? [];
    assert.ok(imports.every(line => !/historical-|methodology-(?:runner|provider|grading|contrast)|src\/engines|child_process/.test(line)), name);
    assert.doesNotMatch(source, /\bfetch\s*\(|\bspawn\s*\(|\bexecFile\s*\(/);
  }
});
