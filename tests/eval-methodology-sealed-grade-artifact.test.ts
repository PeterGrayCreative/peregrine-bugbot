import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import { readMethodologyGradeSet } from "../eval/methodology-analysis-artifacts.js";
import { methodologyGradingProjectionSha256, methodologyReviewOutputSha256 } from "../eval/methodology-grading-contract.js";
import { methodologyJudgeImplementationSha256, writeMethodologyJudgeBinding } from "../eval/methodology-judge-binding.js";
import { gradeMethodologySealedJudge } from "../eval/methodology-judge-grading.js";
import { runMethodologyJudgeLedger } from "../eval/methodology-judge-ledger.js";
import {
  METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE,
  assertLegacyMethodologyGradeSetMatchesSealed,
  readMethodologySealedJudgeGradeSet,
  writeMethodologyGradeSetFromSealedJudge,
  writeMethodologySealedJudgeGradeSet,
  type MethodologySealedJudgeDerivationInputs,
} from "../eval/methodology-sealed-grade-artifact.js";
import { buildMethodologySchedule, methodologyArmConfigIdentitySha256, type MethodologyDesign } from "../eval/methodology-schedule.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, type HistoricalGroundTruth } from "../eval/historical-truth.js";
import type { AuthenticatedMethodologyGradingProjectionSet } from "../eval/methodology-grading-projection.js";

const sha = (value: string | Buffer): string => createHash("sha256").update(value).digest("hex");
const recordedAt = "2026-09-08T00:00:00.000Z";
const limits = { maxProviderCostUsd: null, maxProviderAttempts: 10, maxWallTimeMs: 60_000,
  maxFailureRate: 1, minAttemptsForFailureRate: 1, maxConsecutiveFailures: 2 } as const;
const judgeUsage = { inputTokens: null, cachedInputTokens: null, outputTokens: null,
  reasoningTokens: null, turns: null, toolCalls: null };
const reviewUsage = { provider: "mock" as const, inputTokens: 0, baseInputTokens: 0,
  uncachedInputTokens: 0, cachedInputTokens: 0, cacheWriteInputTokens: 0,
  cacheReadInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, turns: 0,
  toolCalls: 0, toolCallsByType: {}, toolOutputBytes: 0, promptBytes: 0, costUsd: 0,
  costSource: "estimated" as const, aggregation: "single-envelope" as const };

function scheduleFixture() {
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1, protocol: "historical-methodology-v1", seed: 17, repeats: 1,
    callerConfig: { runner: "codex", model: "gpt-5.6-sol", effort: "high", identitySha256: sha("caller-config") },
    totalDeadlineMs: 60_000, twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = { ...designWithoutArms, arms: (["A", "B", "C", "D"] as const).map((armId) => {
    const configName = `arm-${armId.toLowerCase()}`;
    return { armId, configName, configIdentitySha256: methodologyArmConfigIdentitySha256({ design: designWithoutArms, armId, configName }) };
  }) };
  return buildMethodologySchedule({ design,
    cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }] });
}

function projectionFixture(schedule: ReturnType<typeof scheduleFixture>): AuthenticatedMethodologyGradingProjectionSet {
  const executionEvidenceSha256 = sha("execution");
  const inputPlanSha256 = sha("input-plan");
  const truth: HistoricalGroundTruth = {
    schemaVersion: 2,
    scope: { protocol: "historical-efficacy-v1", truthVersion: "fixture-v1", status: "known-roots",
      completeness: "partial", reviewedScope: "The deferred write root.",
      permittedMetrics: historicalPermittedMetrics("known-roots") },
    bugs: [{ id: "bug-aaaaaaaa", lane: "logic-correctness", mechanismFamily: "async-lifecycle",
      proofLevel: "complete-static-trace", expectedDisposition: "fix-in-pr", expectedSeverity: "high",
      file: "src/worker.ts", startLine: 2, endLine: 3,
      description: "Completion precedes a deferred write.", reachablePreconditions: "The request takes the deferred branch.",
      observableImpact: "Success can be observed before persistence.", provenance: "fixture" }],
  };
  const review = { status: "completed" as const, limitations: [], findings: [{ file: "src/worker.ts",
    startLine: 2, endLine: 3, explanation: "Completion precedes the deferred write.",
    impact: "The write can be lost after success.", severity: "high" as const }] };
  return {
    runId: "run-sealed-grade-artifact-001", executionEvidenceSha256,
    invocationRegistrationSha256: sha("registration"), inputPlanSha256,
    projections: schedule.attempts.map((attempt) => {
      const projection = { schemaVersion: 2 as const, kind: "methodology-grading-projection" as const,
        executionEvidenceSha256, inputPlanSha256, caseRegistrationSha256: sha(`${attempt.id}-case`),
        truthSha256: canonicalJsonSha256(truth), truthScopeSha256: historicalTruthScopeSha256(truth),
        attemptId: attempt.id, caseName: attempt.caseName, status: "completed" as const,
        statusReason: "authenticated-complete" as const, lifecycleTerminalSha256: sha(`${attempt.id}-lifecycle`),
        reviewTerminalSha256: sha(`${attempt.id}-review-terminal`), reviewRawOutputSha256: sha(`${attempt.id}-raw`),
        reviewOutputSha256: methodologyReviewOutputSha256(review) };
      return { projection, projectionSha256: methodologyGradingProjectionSha256(projection), truth,
        reviewOutput: review, reviewRawOutput: `${attempt.id}-raw`, resource: {
          attemptId: attempt.id, caseName: attempt.caseName, armId: attempt.armId,
          expectedStages: attempt.expectedStages, observedStages: attempt.expectedStages,
          outcome: "completed" as const, wallDurationMs: 1, reviewDurationMs: 1, usage: reviewUsage,
          lifecycleTerminalSha256: projection.lifecycleTerminalSha256,
          reviewTerminalSha256: projection.reviewTerminalSha256,
        } };
    }),
  };
}

async function completedFixture() {
  const root = mkdtempSync(join(tmpdir(), "methodology-sealed-grade-artifact-"));
  const repositoryRoot = process.cwd();
  const schedule = scheduleFixture();
  const projections = projectionFixture(schedule);
  const base = { runId: projections.runId, projections, providerAccess: "cli-session" as const, limits,
    judgeImplementationSha256: methodologyJudgeImplementationSha256(repositoryRoot), runDirectory: root, repositoryRoot };
  const ledger = await runMethodologyJudgeLedger({ ...base, execute: async () => ({ verdict: true,
    durationMs: 1, providerCostUsd: null, usage: judgeUsage }) });
  const anchors = { ...base, expectedOccurrenceArtifactSha256: ledger.artifact.artifactSha256,
    expectedJudgeManifestSha256: ledger.manifest.manifestSha256,
    expectedJudgeTerminalSealSha256: sha(readFileSync(join(root, "judge/terminal-seal.json"))),
    expectedProjectionSetSha256: ledger.artifact.projectionSetSha256 };
  const binding = writeMethodologyJudgeBinding(root, { ...anchors, boundAt: recordedAt });
  const derivation: MethodologySealedJudgeDerivationInputs = { ...anchors,
    expectedJudgeBindingSha256: binding.bindingSha256 };
  return { root, schedule, derivation };
}

function rewriteArtifactDigest(value: Record<string, unknown>): Record<string, unknown> {
  const { artifactSha256: _artifact, ...body } = value;
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

test("derives, persists, and integrity-reads the canonical bound sealed grade set", async () => {
  const data = await completedFixture();
  try {
    const expected = gradeMethodologySealedJudge(data.derivation);
    const written = writeMethodologySealedJudgeGradeSet(data.root, data.derivation);
    assert.deepEqual(written, expected);
    assert.deepEqual(readMethodologySealedJudgeGradeSet(data.root, written.artifactSha256), expected);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("canonical writes remain append-only", async () => {
  const data = await completedFixture();
  try {
    writeMethodologySealedJudgeGradeSet(data.root, data.derivation);
    assert.throws(() => writeMethodologySealedJudgeGradeSet(data.root, data.derivation), /exist|EEXIST/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("raw integrity reads reject caller mismatch, grade tamper, and grade-set tamper", async () => {
  const caller = await completedFixture();
  try {
    const sealed = writeMethodologySealedJudgeGradeSet(caller.root, caller.derivation);
    assert.throws(() => readMethodologySealedJudgeGradeSet(caller.root, sha("wrong")), /caller digest/i);
    assert.equal(readMethodologySealedJudgeGradeSet(caller.root, sealed.artifactSha256).artifactSha256, sealed.artifactSha256);
  } finally { rmSync(caller.root, { recursive: true, force: true }); }

  const invalidGrade = await completedFixture();
  try {
    const sealed = gradeMethodologySealedJudge(invalidGrade.derivation);
    const grades = sealed.grades.map((grade, index) => index === 0
      ? { ...grade, rootCauseMatches: { ...grade.rootCauseMatches, forged: true } } : grade);
    const forged = rewriteArtifactDigest({ ...sealed, grades });
    writeFileSync(join(invalidGrade.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), `${JSON.stringify(forged)}\n`);
    assert.throws(() => readMethodologySealedJudgeGradeSet(invalidGrade.root, String(forged.artifactSha256)), /grade.*digest/i);
  } finally { rmSync(invalidGrade.root, { recursive: true, force: true }); }

  const invalidSet = await completedFixture();
  try {
    const sealed = gradeMethodologySealedJudge(invalidSet.derivation);
    const forged = rewriteArtifactDigest({ ...sealed, gradeSetSha256: sha("wrong-grade-set") });
    writeFileSync(join(invalidSet.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), `${JSON.stringify(forged)}\n`);
    assert.throws(() => readMethodologySealedJudgeGradeSet(invalidSet.root, String(forged.artifactSha256)), /grade-set digest/i);
  } finally { rmSync(invalidSet.root, { recursive: true, force: true }); }
});

test("ignores forged caller grade fields and persists only authenticated derivation", async () => {
  const data = await completedFixture();
  try {
    const expected = gradeMethodologySealedJudge(data.derivation);
    const forgedInput = { ...data.derivation, grades: [{ forged: true }],
      sealedGradeSet: { ...expected, runId: "forged-run" } } as MethodologySealedJudgeDerivationInputs & Record<string, unknown>;
    const written = writeMethodologySealedJudgeGradeSet(data.root, forgedInput);
    assert.deepEqual(written, expected);
    assert.notEqual(written.runId, "forged-run");
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("wrong binding and cross-run inputs reject before artifact writes", async () => {
  const wrongBinding = await completedFixture();
  try {
    assert.throws(() => writeMethodologySealedJudgeGradeSet(wrongBinding.root, {
      ...wrongBinding.derivation, expectedJudgeBindingSha256: sha("wrong-binding") }), /binding digest/i);
    assert.equal(existsSync(join(wrongBinding.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE)), false);
  } finally { rmSync(wrongBinding.root, { recursive: true, force: true }); }

  const crossRun = await completedFixture();
  try {
    assert.throws(() => writeMethodologySealedJudgeGradeSet(crossRun.root, {
      ...crossRun.derivation, runId: "different-run" }), /binding|different run|caller-held/i);
    assert.equal(existsSync(join(crossRun.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE)), false);
  } finally { rmSync(crossRun.root, { recursive: true, force: true }); }
});

test("bridge rederives the stored sealed artifact before writing legacy v1", async () => {
  const data = await completedFixture();
  try {
    const sealed = writeMethodologySealedJudgeGradeSet(data.root, data.derivation);
    const legacy = writeMethodologyGradeSetFromSealedJudge(data.root, { ...data.derivation,
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256, schedule: data.schedule, recordedAt });
    assertLegacyMethodologyGradeSetMatchesSealed(legacy, sealed);
    const reread = readMethodologyGradeSet(data.root, legacy.artifactSha256);
    assert.deepEqual(reread.grades, sealed.grades);
    assert.equal(reread.gradeSetSha256, sealed.gradeSetSha256);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("bridge rejects forged input and wrong binding before writing legacy", async () => {
  const data = await completedFixture();
  try {
    const sealed = writeMethodologySealedJudgeGradeSet(data.root, data.derivation);
    const forged = { ...data.derivation, expectedJudgeBindingSha256: sha("wrong-binding"),
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256, schedule: data.schedule, recordedAt,
      sealedGradeSet: { ...sealed, grades: [] } } as Parameters<typeof writeMethodologyGradeSetFromSealedJudge>[1] & Record<string, unknown>;
    assert.throws(() => writeMethodologyGradeSetFromSealedJudge(data.root, forged), /binding digest/i);
    assert.equal(existsSync(join(data.root, "methodology-grade-set.json")), false);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("exact legacy equality rejects mismatched artifacts", async () => {
  const data = await completedFixture();
  try {
    const sealed = writeMethodologySealedJudgeGradeSet(data.root, data.derivation);
    const legacy = writeMethodologyGradeSetFromSealedJudge(data.root, { ...data.derivation,
      expectedSealedGradeSetArtifactSha256: sealed.artifactSha256, schedule: data.schedule, recordedAt });
    assert.throws(() => assertLegacyMethodologyGradeSetMatchesSealed({ ...legacy, runId: "different-run" }, sealed),
      /does not exactly match/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("raw integrity reader rejects secret-bearing stored grade data", async () => {
  const data = await completedFixture();
  try {
    const sealed = gradeMethodologySealedJudge(data.derivation);
    const grades = sealed.grades.map((grade, index) => index === 0
      ? { ...grade, findings: grade.findings.map((finding, findingIndex) => findingIndex === 0
        ? { ...finding, explanation: "token=SecretValue123456" } : finding) } : grade);
    const forged = rewriteArtifactDigest({ ...sealed, grades });
    writeFileSync(join(data.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), `${JSON.stringify(forged)}\n`);
    assert.throws(() => readMethodologySealedJudgeGradeSet(data.root, String(forged.artifactSha256)),
      /secret pattern|credential-like/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});
