import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  buildMethodologyJudgePlan,
  readMethodologyJudgeOccurrences,
  readMethodologyJudgeLedger,
  runMethodologyJudgeLedger,
  type MethodologyJudgeInputs,
} from "../eval/methodology-judge-ledger.js";
import { methodologyGradingProjectionSha256, methodologyReviewOutputSha256 } from "../eval/methodology-grading-contract.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import type { MethodologyReviewOutput } from "../eval/methodology-output.js";
import type { AuthenticatedMethodologyGradingProjection, AuthenticatedMethodologyGradingProjectionSet } from "../eval/methodology-grading-projection.js";
import type { Usage } from "../src/types.js";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const limits = { maxProviderCostUsd: null, maxProviderAttempts: 10, maxWallTimeMs: 60_000, maxFailureRate: 1, minAttemptsForFailureRate: 2, maxConsecutiveFailures: 3 } as const;
const usage: Usage = { inputTokens: 0, baseInputTokens: 0, uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0, cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, turns: 0, toolCalls: 0, toolCallsByType: {}, toolOutputBytes: 0, promptBytes: 0, costUsd: 0, provider: "mock", costSource: "estimated", aggregation: "single-envelope" };

function fixtureSet(options: { attemptIds?: string[]; zeroBugs?: boolean; truthStatus?: "known-roots" | "reviewed-comparison"; status?: "completed" | "incomplete" | "failed" | "missing"; distinctTruth?: boolean } = {}): AuthenticatedMethodologyGradingProjectionSet {
  const attemptIds = options.attemptIds ?? ["attempt-000001", "attempt-000002"];
  const truth: HistoricalGroundTruth = {
    schemaVersion: 2,
    scope: { protocol: "historical-efficacy-v1", truthVersion: "fixture", status: options.truthStatus ?? "known-roots", completeness: "partial", reviewedScope: "fixture", permittedMetrics: historicalPermittedMetrics(options.truthStatus ?? "known-roots") },
    bugs: options.zeroBugs ? [] : [{ id: "bug-11111111", lane: "logic-correctness", mechanismFamily: "async-lifecycle", proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high", file: "src/a.ts", startLine: 2, endLine: 3, description: "The deferred write is observed after completion.", reachablePreconditions: "The request takes the deferred branch.", observableImpact: "Success can be observed before persistence.", provenance: "fixture" }],
  };
  const projections = attemptIds.map((attemptId, index): AuthenticatedMethodologyGradingProjection => {
    const sourceTruth = options.distinctTruth && index > 0 ? { ...truth, bugs: truth.bugs.map((bug) => ({ ...bug, startLine: bug.startLine + 10, endLine: bug.endLine + 10 })) } : truth;
    const status = options.status ?? "completed";
    const review: MethodologyReviewOutput | null = status === "incomplete" ? { status: "unable-to-complete", limitations: ["fixture limitation"], findings: [] } : status === "completed" ? { status: "completed", limitations: [], findings: [{ file: "src/a.ts", startLine: 2, endLine: 3, severity: "high", explanation: "Completion precedes the deferred write.", impact: "The write can be lost after success." }] } : null;
    const lifecycleTerminalSha256 = status === "missing" ? null : hash("l");
    const reviewTerminalSha256 = status === "completed" || status === "incomplete" ? hash("r") : null;
    const projection = { schemaVersion: 2 as const, kind: "methodology-grading-projection" as const, executionEvidenceSha256: hash("e"), inputPlanSha256: hash("p"), caseRegistrationSha256: hash("c"), truthSha256: canonicalJsonSha256(sourceTruth), truthScopeSha256: historicalTruthScopeSha256(sourceTruth), attemptId, caseName: "development/case-11111111", status, statusReason: status === "completed" ? "authenticated-complete" as const : status === "incomplete" ? "model-unable-to-complete" as const : status === "failed" ? "preflight-failed" as const : "outer-run-missing" as const, lifecycleTerminalSha256, reviewTerminalSha256, reviewRawOutputSha256: review === null ? null : hash("{}"), reviewOutputSha256: review === null ? null : methodologyReviewOutputSha256(review) };
    return { projection, projectionSha256: methodologyGradingProjectionSha256(projection), truth: sourceTruth, reviewOutput: review, reviewRawOutput: review === null ? null : "{}", resource: { attemptId, caseName: projection.caseName, armId: "A", expectedStages: 1, observedStages: review === null ? 0 : 1, outcome: status === "missing" ? "missing" : status === "failed" ? "preflight-failed" : "completed", wallDurationMs: 1, reviewDurationMs: review === null ? null : 1, usage: review === null ? null : usage, lifecycleTerminalSha256, reviewTerminalSha256 } };
  });
  return { runId: "run-methodology-001", executionEvidenceSha256: hash("e"), invocationRegistrationSha256: hash("i"), inputPlanSha256: hash("p"), projections };
}

function inputs(projections = fixtureSet()): MethodologyJudgeInputs {
  return { runId: "run-methodology-001", projections, providerAccess: "cli-session", limits, judgeImplementationSha256: hash("j") };
}

test("builds the complete Cartesian plan while retaining deduplicated occurrences", () => {
  const plan = buildMethodologyJudgePlan(inputs());
  assert.equal(plan.pairs.length, 2);
  assert.equal(plan.manifest.schedule.length, 1);
  assert.equal(plan.occurrences.length, 2);
  assert.equal(plan.occurrences[0]!.judgeComparisonId, plan.occurrences[1]!.judgeComparisonId);
  assert.equal(plan.manifest.experimentId, "run-methodology-001");
  assert.equal(plan.manifest.experimentManifestSha256, hash("i"));
  assert.equal(plan.manifest.experimentTerminalSealSha256, hash("e"));
  assert.equal(plan.manifest.corpusSha256, plan.projectionSetSha256);
});

test("completed reviewed-comparison and non-completed projections with no bugs schedule no pairs", () => {
  for (const options of [
    { zeroBugs: true, truthStatus: "reviewed-comparison" as const },
    { zeroBugs: true, truthStatus: "reviewed-comparison" as const, status: "incomplete" as const },
    { zeroBugs: true, truthStatus: "reviewed-comparison" as const, status: "failed" as const },
  ]) {
    const plan = buildMethodologyJudgePlan(inputs(fixtureSet(options)));
    assert.equal(plan.pairs.length, 0);
    assert.equal(plan.manifest.schedule.length, 0);
    assert.equal(plan.occurrences.length, 0);
  }
});

test("writes occurrences before execution and maps one decision to every occurrence", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-ledger-"));
  try {
    let calls = 0;
    const result = await runMethodologyJudgeLedger({ ...inputs(), runDirectory: root, execute: async (prompt) => { calls += 1; assert.match(prompt, /BEGIN_UNTRUSTED_HISTORICAL_TRUTH_JSON/); assert.match(prompt, /BEGIN_UNTRUSTED_METHODOLOGY_FINDING_JSON/); return { verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } }; } });
    assert.equal(calls, 1);
    assert.equal(result.terminal, "completed");
    assert.equal(result.occurrences.length, 2);
    assert.ok(result.occurrences.every(({ decision }) => decision.verdict === "same-root-cause"));
    const artifactBytes = readFileSync(join(root, "methodology-judge-occurrences.json"), "utf8");
    const sealSha256 = createHash("sha256").update(readFileSync(join(root, "judge/terminal-seal.json"))).digest("hex");
    const read = readMethodologyJudgeLedger({ ...inputs(), runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: sealSha256, expectedProjectionSetSha256: result.artifact.projectionSetSha256 });
    assert.equal(read.occurrences.length, 2);
    void artifactBytes;
    void read;
    const resumed = await runMethodologyJudgeLedger({ ...inputs(), runDirectory: root, execute: async () => { throw new Error("must not call provider on resume"); } });
    assert.equal(resumed.occurrences.length, 2);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("failed generic judge ledgers cannot produce definitive methodology verdicts", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-failed-"));
  try {
    const result = await runMethodologyJudgeLedger({ ...inputs(), runDirectory: root, execute: async () => { throw new Error("provider failure"); } });
    assert.equal(result.terminal, "stopped");
    const sealSha256 = hash(readFileSync(join(root, "judge/terminal-seal.json")).toString());
    assert.throws(() => readMethodologyJudgeLedger({ ...inputs(), runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: sealSha256, expectedProjectionSetSha256: result.artifact.projectionSetSha256 }), /completed successful judge ledger/);
    const artifactPath = join(root, "methodology-judge-occurrences.json");
    const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
    artifact.occurrences[0].bugId = "tampered";
    writeFileSync(artifactPath, `${JSON.stringify(artifact, null, 2)}\n`);
    assert.throws(() => readMethodologyJudgeOccurrencesForTest(root), /digest|canonical|rederived/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("stopped multi-pair ledgers return only the decisions that actually ran", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-stopped-"));
  try {
    const base = inputs(fixtureSet({ attemptIds: ["attempt-000001", "attempt-000002"], distinctTruth: true }));
    const result = await runMethodologyJudgeLedger({ ...base, limits: { ...limits, maxProviderAttempts: 1 }, runDirectory: root, execute: async () => ({ verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } }) });
    assert.equal(result.terminal, "stopped");
    assert.equal(result.generic.decisions.length, 1);
    assert.equal(result.occurrences.length, 1);
    assert.throws(() => readMethodologyJudgeLedger({ ...base, limits: { ...limits, maxProviderAttempts: 1 }, runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: hash(readFileSync(join(root, "judge/terminal-seal.json")).toString()), expectedProjectionSetSha256: result.artifact.projectionSetSha256 }), /completed successful judge ledger/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("definitive reads require every caller-held trust anchor", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-anchors-"));
  try {
    const base = inputs();
    const result = await runMethodologyJudgeLedger({ ...base, runDirectory: root, execute: async () => ({ verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } }) });
    const expected = { ...base, runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: hash(readFileSync(join(root, "judge/terminal-seal.json")).toString()), expectedProjectionSetSha256: result.artifact.projectionSetSha256 };
    assert.equal(readMethodologyJudgeLedger(expected).occurrences.length, 2);
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, expectedOccurrenceArtifactSha256: hash("wrong-occurrence") }), /occurrence digest/);
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, expectedJudgeManifestSha256: hash("wrong-manifest") }), /manifest digest/);
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, expectedJudgeTerminalSealSha256: hash("wrong-seal") }), /terminal-seal digest/);
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, expectedProjectionSetSha256: hash("wrong-projections") }), /projection-set digest/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("changed projections, truth, findings, prompt maps, extra/missing artifacts, and symlinks fail closed", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-integrity-"));
  try {
    const base = inputs();
    const result = await runMethodologyJudgeLedger({ ...base, runDirectory: root, execute: async () => ({ verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } }) });
    const expected = { ...base, runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: hash(readFileSync(join(root, "judge/terminal-seal.json")).toString()), expectedProjectionSetSha256: result.artifact.projectionSetSha256 };
    const changedProjection = structuredClone(base.projections); changedProjection.projections[0]!.projection.caseName = "development/case-22222222";
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, projections: changedProjection }), /projection digest is stale/);
    const changedTruth = structuredClone(base.projections); changedTruth.projections[0]!.truth.bugs[0]!.description = "changed";
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, projections: changedTruth }), /truth digest is stale/);
    const changedFinding = structuredClone(base.projections); changedFinding.projections[0]!.reviewOutput!.findings[0]!.impact = "changed";
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, projections: changedFinding }), /review output digest is stale/);
    const artifactPath = join(root, "methodology-judge-occurrences.json");
    const original = readFileSync(artifactPath, "utf8");
    const mutateArtifact = (mutator: (value: any) => void) => { const value = JSON.parse(original); mutator(value); const { artifactSha256: ignored, ...body } = value; value.artifactSha256 = canonicalJsonSha256(body); writeFileSync(artifactPath, `${JSON.stringify(value, null, 2)}\n`); };
    mutateArtifact((value) => value.occurrences.pop());
    assert.throws(() => readMethodologyJudgeLedger(expected), /occurrence digest|rederived plan|deterministically sorted/);
    writeFileSync(artifactPath, original);
    mutateArtifact((value) => value.occurrences.push({ ...value.occurrences[0], findingIndex: 99 }));
    assert.throws(() => readMethodologyJudgeLedger(expected), /occurrence digest|rederived plan|deterministically sorted/);
    writeFileSync(artifactPath, original);
    mutateArtifact((value) => { value.occurrences[0].promptSha256 = hash("changed-prompt"); });
    assert.throws(() => readMethodologyJudgeLedger(expected), /occurrence digest|rederived plan|deterministically sorted/);
    writeFileSync(artifactPath, original);
    rmSync(artifactPath);
    symlinkSync(join(root, "judge", "manifest.json"), artifactPath);
    assert.throws(() => readMethodologyJudgeLedger(expected), /regular non-symlink/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("run identity and stale projection sets cannot reuse an existing artifact", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-cross-run-"));
  try {
    const base = inputs();
    const result = await runMethodologyJudgeLedger({ ...base, runDirectory: root, execute: async () => ({ verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } }) });
    const expected = { ...base, runDirectory: root, expectedOccurrenceArtifactSha256: result.artifact.artifactSha256, expectedJudgeManifestSha256: result.manifest.manifestSha256, expectedJudgeTerminalSealSha256: hash(readFileSync(join(root, "judge/terminal-seal.json")).toString()), expectedProjectionSetSha256: result.artifact.projectionSetSha256 };
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, runId: "another-run" }), /runId does not match the authenticated projection set/);
    const stale = structuredClone(base.projections); stale.projections[1]!.projection.caseName = "development/case-33333333";
    assert.throws(() => readMethodologyJudgeLedger({ ...expected, projections: stale }), /projection digest is stale/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("fresh runs reject cross-run projections before artifacts or provider work", async () => {
  const root = mkdtempSync(join(tmpdir(), "methodology-judge-fresh-cross-run-"));
  try {
    let calls = 0;
    await assert.rejects(
      runMethodologyJudgeLedger({
        ...inputs(),
        runId: "another-run",
        runDirectory: root,
        execute: async () => {
          calls += 1;
          return { verdict: true, durationMs: 1, providerCostUsd: null, usage: { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null, turns: null, toolCalls: null } };
        },
      }),
      /runId does not match the authenticated projection set/,
    );
    assert.equal(calls, 0);
    assert.equal(existsSync(join(root, "methodology-judge-occurrences.json")), false);
    assert.equal(existsSync(join(root, "judge")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// Keep the tamper assertion independent of the main read API's terminal gate.
function readMethodologyJudgeOccurrencesForTest(root: string): unknown {
  return readMethodologyJudgeOccurrences(root);
}
