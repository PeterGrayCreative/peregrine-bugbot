import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { canonicalJsonSha256 } from "../eval/experiment.js";
import {
  readMethodologyGradeSet,
} from "../eval/methodology-analysis-artifacts.js";
import {
  gradeMethodologyAttempt,
  methodologyComparisonId,
  methodologyFindingEvidenceSha256,
  methodologyReviewOutputSha256,
  type MethodologyGradingProjection,
} from "../eval/methodology-grading-contract.js";
import type { MethodologySealedJudgeGradeSet } from "../eval/methodology-judge-grading.js";
import {
  METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE,
  assertLegacyMethodologyGradeSetMatchesSealed,
  readMethodologySealedJudgeGradeSet,
  writeMethodologyGradeSetFromSealedJudge,
  writeMethodologySealedJudgeGradeSet,
} from "../eval/methodology-sealed-grade-artifact.js";
import {
  buildMethodologySchedule,
  methodologyArmConfigIdentitySha256,
  type MethodologyDesign,
} from "../eval/methodology-schedule.js";
import { historicalTruthScopeSha256 } from "../eval/historical-curation.js";
import { historicalPermittedMetrics, parseHistoricalGroundTruth } from "../eval/historical-truth.js";

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");
const recordedAt = "2026-09-08T00:00:00.000Z";

function fixture(): {
  root: string;
  schedule: ReturnType<typeof buildMethodologySchedule>;
  sealed: MethodologySealedJudgeGradeSet;
} {
  const executionEvidenceSha256 = digest("execution");
  const inputPlanSha256 = digest("input-plan");
  const judgeConfigSha256 = digest("judge-config");
  const designWithoutArms: Omit<MethodologyDesign, "arms"> = {
    schemaVersion: 1,
    protocol: "historical-methodology-v1",
    seed: 17,
    repeats: 1,
    callerConfig: {
      runner: "codex",
      model: "gpt-5.6-sol",
      effort: "high",
      identitySha256: digest("caller-config"),
    },
    totalDeadlineMs: 60_000,
    twoWorkerStageSplit: { discoveryDeadlineMs: 20_000, reviewerDeadlineMs: 40_000 },
  };
  const design: MethodologyDesign = {
    ...designWithoutArms,
    arms: (["A", "B", "C", "D"] as const).map((armId) => {
      const configName = `arm-${armId.toLowerCase()}`;
      return {
        armId,
        configName,
        configIdentitySha256: methodologyArmConfigIdentitySha256({
          design: designWithoutArms,
          armId,
          configName,
        }),
      };
    }),
  };
  const schedule = buildMethodologySchedule({
    design,
    cases: [{ caseName: "development/case-aaaaaaaa", corpus: "development", expectedBugCount: 1 }],
  });
  const truth = parseHistoricalGroundTruth({
    schemaVersion: 2,
    scope: {
      protocol: "historical-efficacy-v1",
      truthVersion: "fixture-v1",
      status: "known-roots",
      completeness: "partial",
      reviewedScope: "The deferred write root.",
      permittedMetrics: historicalPermittedMetrics("known-roots"),
    },
    bugs: [{
      id: "bug-aaaaaaaa",
      lane: "logic-correctness",
      mechanismFamily: "async-lifecycle",
      proofLevel: "complete-static-trace",
      expectedDisposition: "fix-in-pr",
      expectedSeverity: "high",
      file: "src/worker.ts",
      startLine: 2,
      endLine: 3,
      description: "Completion precedes a deferred write.",
      reachablePreconditions: "The request takes the deferred branch.",
      observableImpact: "Success can be observed before persistence.",
      provenance: "fixture",
    }],
  });
  const review = {
    status: "completed" as const,
    limitations: [],
    findings: [{
      file: "src/worker.ts",
      startLine: 2,
      endLine: 3,
      explanation: "Completion precedes the deferred write.",
      impact: "The write can be lost after success.",
      severity: "high" as const,
    }],
  };
  const grades = schedule.attempts.map((attempt) => {
    const projection: MethodologyGradingProjection = {
      schemaVersion: 2,
      kind: "methodology-grading-projection",
      executionEvidenceSha256,
      inputPlanSha256,
      caseRegistrationSha256: digest(`${attempt.id}-case`),
      truthSha256: canonicalJsonSha256(truth),
      truthScopeSha256: historicalTruthScopeSha256(truth),
      attemptId: attempt.id,
      caseName: attempt.caseName,
      status: "completed",
      statusReason: "authenticated-complete",
      lifecycleTerminalSha256: digest(`${attempt.id}-lifecycle`),
      reviewTerminalSha256: digest(`${attempt.id}-review-terminal`),
      reviewRawOutputSha256: digest(`${attempt.id}-raw`),
      reviewOutputSha256: methodologyReviewOutputSha256(review),
    };
    return gradeMethodologyAttempt({
      projection,
      expectedProjectionSha256: canonicalJsonSha256(projection),
      truth,
      reviewOutput: review,
      judgeConfigSha256,
      pairVerdicts: [{
        comparisonId: methodologyComparisonId({ bug: truth.bugs[0]!, finding: review.findings[0]!, judgeConfigSha256 }),
        bugId: truth.bugs[0]!.id,
        findingIndex: 0,
        findingEvidenceSha256: methodologyFindingEvidenceSha256(review.findings[0]!),
        verdict: "same-root-cause",
      }],
    });
  }).sort((left, right) => left.projection.attemptId.localeCompare(right.projection.attemptId));
  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({
    attemptId: grade.projection.attemptId,
    gradeSha256: grade.gradeSha256,
  })));
  const body = {
    schemaVersion: 1 as const,
    protocol: "historical-methodology-sealed-judge-grading-v1" as const,
    runId: "run-sealed-grade-artifact-001",
    executionEvidenceSha256,
    invocationRegistrationSha256: digest("registration"),
    inputPlanSha256,
    projectionSetSha256: digest("projection-set"),
    occurrenceArtifactSha256: digest("occurrence-artifact"),
    judgeManifestSha256: digest("judge-manifest"),
    judgeTerminalSealSha256: digest("judge-terminal"),
    judgeConfigSha256,
    grades,
    gradeSetSha256,
    claims: {
      verdictSource: "completed-sealed-semantic-judge-ledger" as const,
      semanticCorrectness: "not-established" as const,
      humanCalibration: "required" as const,
    },
  };
  return {
    root: mkdtempSync(join(tmpdir(), "methodology-sealed-grade-artifact-")),
    schedule,
    sealed: { ...body, artifactSha256: canonicalJsonSha256(body) },
  };
}

function rehashGradeSet(
  sealed: MethodologySealedJudgeGradeSet,
  grades: MethodologySealedJudgeGradeSet["grades"],
): MethodologySealedJudgeGradeSet {
  const gradeSetSha256 = canonicalJsonSha256(grades.map((grade) => ({
    attemptId: grade.projection.attemptId,
    gradeSha256: grade.gradeSha256,
  })));
  const { artifactSha256: _artifact, gradeSetSha256: _gradeSet, grades: _grades, ...rest } = sealed;
  const body = { ...rest, grades, gradeSetSha256 };
  return { ...body, artifactSha256: canonicalJsonSha256(body) };
}

test("round-trips the canonical sealed judge grade set", () => {
  const data = fixture();
  try {
    const written = writeMethodologySealedJudgeGradeSet(data.root, data.sealed);
    const read = readMethodologySealedJudgeGradeSet(data.root, written.artifactSha256);
    assert.deepEqual(read, data.sealed);
    assert.deepEqual(JSON.parse(readFileSync(join(data.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE), "utf8")), data.sealed);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("sealed judge grade-set writes are append-only", () => {
  const data = fixture();
  try {
    writeMethodologySealedJudgeGradeSet(data.root, data.sealed);
    assert.throws(() => writeMethodologySealedJudgeGradeSet(data.root, data.sealed), /exist|EEXIST/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("rejects caller digest mismatch and stored tampering", () => {
  const caller = fixture();
  try {
    writeMethodologySealedJudgeGradeSet(caller.root, caller.sealed);
    assert.throws(() => readMethodologySealedJudgeGradeSet(caller.root, digest("wrong")), /caller digest/i);
  } finally { rmSync(caller.root, { recursive: true, force: true }); }

  const tampered = fixture();
  try {
    writeMethodologySealedJudgeGradeSet(tampered.root, tampered.sealed);
    const path = join(tampered.root, METHODOLOGY_SEALED_JUDGE_GRADE_SET_FILE);
    const stored = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    stored.runId = "run-tampered";
    writeFileSync(path, `${JSON.stringify(stored)}\n`);
    assert.throws(() => readMethodologySealedJudgeGradeSet(tampered.root, tampered.sealed.artifactSha256), /artifact digest/i);
  } finally { rmSync(tampered.root, { recursive: true, force: true }); }
});

test("rejects an invalid grade digest and an invalid grade-set digest", () => {
  const invalidGrade = fixture();
  try {
    const grades = invalidGrade.sealed.grades.map((grade, index) => index === 0
      ? { ...grade, rootCauseMatches: { ...grade.rootCauseMatches, forged: true } }
      : grade);
    const forged = rehashGradeSet(invalidGrade.sealed, grades);
    assert.throws(() => writeMethodologySealedJudgeGradeSet(invalidGrade.root, forged), /grade.*digest/i);
  } finally { rmSync(invalidGrade.root, { recursive: true, force: true }); }

  const invalidSet = fixture();
  try {
    const { artifactSha256: _artifact, ...body } = invalidSet.sealed;
    const forgedBody = { ...body, gradeSetSha256: digest("wrong-grade-set") };
    const forged = { ...forgedBody, artifactSha256: canonicalJsonSha256(forgedBody) };
    assert.throws(() => writeMethodologySealedJudgeGradeSet(invalidSet.root, forged), /grade-set digest/i);
  } finally { rmSync(invalidSet.root, { recursive: true, force: true }); }
});

test("deterministically bridges sealed grades into the existing v1 artifact", () => {
  const data = fixture();
  try {
    const legacy = writeMethodologyGradeSetFromSealedJudge(data.root, {
      sealedGradeSet: data.sealed,
      schedule: data.schedule,
      recordedAt,
    });
    assertLegacyMethodologyGradeSetMatchesSealed(legacy, data.sealed);
    const reread = readMethodologyGradeSet(data.root, legacy.artifactSha256);
    assert.deepEqual(reread.grades, data.sealed.grades);
    assert.equal(reread.gradeSetSha256, data.sealed.gradeSetSha256);
    assert.equal(reread.runId, data.sealed.runId);
    assert.equal(reread.executionEvidenceSha256, data.sealed.executionEvidenceSha256);
    assert.equal(reread.inputPlanSha256, data.sealed.inputPlanSha256);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("rejects a mismatched legacy artifact", () => {
  const data = fixture();
  try {
    const legacy = writeMethodologyGradeSetFromSealedJudge(data.root, {
      sealedGradeSet: data.sealed,
      schedule: data.schedule,
      recordedAt,
    });
    assert.throws(() => assertLegacyMethodologyGradeSetMatchesSealed({ ...legacy, runId: "different-run" }, data.sealed), /does not exactly match/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});

test("refuses to persist a secret-bearing sealed grade set", () => {
  const data = fixture();
  try {
    const grades = data.sealed.grades.map((grade, index) => {
      if (index !== 0) return grade;
      const findings = grade.findings.map((finding, findingIndex) => findingIndex === 0
        ? { ...finding, explanation: "token=SecretValue123456" }
        : finding);
      return { ...grade, findings };
    });
    const secretBearing = rehashGradeSet(data.sealed, grades);
    assert.throws(() => writeMethodologySealedJudgeGradeSet(data.root, secretBearing), /secret pattern|credential-like/i);
  } finally { rmSync(data.root, { recursive: true, force: true }); }
});
